use super::*;

#[derive(Debug, Deserialize, Serialize)]
pub struct SimulateGridRequest {
    /// Source centre (deg).
    pub source: GeoPoint,
    /// Peak amplitude at the source (m). Used as Gaussian IC peak.
    pub initial_amplitude_m: f64,
    /// 1-σ radius of the IC bump (m).
    pub source_sigma_m: f64,
    /// Source-specific t=0 geometry. Older clients may omit this and retain
    /// the legacy circular Gaussian initial condition.
    #[serde(default)]
    pub source_geometry: Option<InitialSourceGeometry>,
    /// Fallback uniform depth (m) when `use_real_bathymetry = false` or
    /// when the bathymetry sampler returns 0 (land).
    pub mean_depth_m: f64,
    /// If true, use `data::bathymetry::sample(lat, lon)` per cell; if false
    /// or zero-depth, fall back to `mean_depth_m`.
    #[serde(default)]
    pub use_real_bathymetry: bool,
    /// Optional content-addressed local raster. Requires
    /// `use_real_bathymetry = true`; omission retains the bundled coarse model.
    #[serde(default)]
    pub bathymetry_asset_id: Option<String>,
    /// Half-extent of the simulation box around the source, degrees.
    /// Larger = more area covered, slower simulation.
    pub box_half_size_deg: f64,
    /// Grid resolution (cells per degree). Default ~10 for fast preview.
    pub cells_per_deg: f64,
    /// Total simulated time in seconds.
    pub t_end_s: f64,
    /// Number of snapshots to return (≥ 2; includes t=0 and t_end).
    pub n_snapshots: usize,
    /// F4-05 — apply Hunga-Tonga-class atmospheric Lamb-wave forcing
    /// every step. Off by default. When on, the SWE η field receives
    /// the closed-form quasi-static surface depression contribution
    /// from `LambWaveSource::surface_depression_m` integrated over the
    /// pulse arrival window at every grid cell.
    #[serde(default)]
    pub include_lamb_wave: bool,
    /// Override the default Hunga-Tonga 200 Pa peak pressure if you
    /// want to simulate a different VEI eruption. Ignored when
    /// `include_lamb_wave` is false.
    #[serde(default)]
    pub lamb_wave_peak_pressure_pa: Option<f64>,
    /// Override the default 30 km source radius. Ignored when
    /// `include_lamb_wave` is false.
    #[serde(default)]
    pub lamb_wave_source_radius_m: Option<f64>,
    #[serde(default)]
    pub colormap: String,
    #[serde(default)]
    pub gauge_points: Vec<GridGaugePoint>,
}

pub(super) fn local_offset_m(center_lat: f64, center_lon: f64, lat: f64, lon: f64) -> (f64, f64) {
    let north_m = (lat - center_lat).to_radians() * R_EARTH_M;
    let delta_lon = (lon - center_lon + 540.0).rem_euclid(360.0) - 180.0;
    let east_m = delta_lon.to_radians() * R_EARTH_M * center_lat.to_radians().cos();
    (east_m, north_m)
}

pub(super) fn inject_source_initial_field(
    grid: &mut SwGrid,
    req: &SimulateGridRequest,
) -> Result<(), String> {
    let Some(geometry) = &req.source_geometry else {
        grid.inject_gaussian(
            req.source.lat_deg,
            req.source.lon_deg,
            req.initial_amplitude_m,
            req.source_sigma_m.max(1000.0),
        );
        return Ok(());
    };

    let mut field = Vec::with_capacity(grid.nx * grid.ny);
    for j in 0..grid.ny {
        let lat = grid.south_lat + (j as f64 + 0.5) * grid.dlat_deg;
        for i in 0..grid.nx {
            let lon = grid.west_lon + (i as f64 + 0.5) * grid.dlon_deg;
            let value = match geometry {
                InitialSourceGeometry::CavityRing {
                    rim_radius_m,
                    rim_width_m,
                } => {
                    let (east_m, north_m) =
                        local_offset_m(req.source.lat_deg, req.source.lon_deg, lat, lon);
                    let radial_m = east_m.hypot(north_m);
                    let offset = (radial_m - rim_radius_m) / rim_width_m;
                    req.initial_amplitude_m * (-0.5 * offset * offset).exp()
                }
                InitialSourceGeometry::Landslide {
                    axis_azimuth_deg,
                    longitudinal_sigma_m,
                    transverse_sigma_m,
                } => {
                    let (east_m, north_m) =
                        local_offset_m(req.source.lat_deg, req.source.lon_deg, lat, lon);
                    let azimuth = axis_azimuth_deg.to_radians();
                    let along = east_m * azimuth.sin() + north_m * azimuth.cos();
                    let across = east_m * azimuth.cos() - north_m * azimuth.sin();
                    let x = along / longitudinal_sigma_m;
                    let y = across / transverse_sigma_m;
                    // A normalized derivative-of-Gaussian yields the displaced
                    // positive/negative lobes of a translating slide; |peak| is
                    // the scalar source amplitude at x=±1, y=0.
                    req.initial_amplitude_m * x * (0.5 - 0.5 * (x * x + y * y)).exp()
                }
                InitialSourceGeometry::Okada { fault } => {
                    let (east_m, north_m) =
                        local_offset_m(fault.center_lat, fault.center_lon, lat, lon);
                    fault.vertical_displacement_at_offset_m(east_m, north_m)
                }
            };
            field.push(value);
        }
    }
    grid.inject_field(&field)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SimulationRunLifecycle {
    Completed,
    Cancelled,
}

#[derive(Debug, Serialize)]
pub struct SimulateGridResponse {
    pub run_id: String,
    pub lifecycle: SimulationRunLifecycle,
    pub emitted_snapshots: u32,
    pub cancelled: bool,
    pub snapshots: Vec<GridSnapshot>,
    pub dt_s: f64,
    pub nx: u32,
    pub ny: u32,
    pub bathymetry_asset_id: Option<String>,
    /// F4-01 — `true` when the SWE finite-volume solver ran on the wgpu GPU
    /// path, `false` for the CPU `rayon` path. Always `false` on
    /// builds compiled without `--features gpu`. Frontend uses this
    /// to surface a "ran on GPU" badge in the playback header.
    #[serde(default)]
    pub used_gpu: bool,
    /// Max-field products (peak |η|, time of maximum, energy proxy,
    /// arrival isochrones) accumulated at solver-step cadence.
    pub max_field: Option<MaxFieldProduct>,
    pub run_quality: RunQualityRecord,
}

/// Hard cap on the SWE grid size — protects us against runaway requests.
pub(super) const SWE_MAX_CELLS: usize = 4_000_000;
/// Process-wide reservation ceiling for live SWE runs. One maximum-size
/// streaming run remains admissible; a second comparable run is rejected
/// before either grid can double the process working set.
pub(super) const SWE_MEMORY_BUDGET_BYTES: u64 = 512 * 1024 * 1024;
/// Conservative peak per-cell residency across the f64 host grid,
/// scratch/max-field arrays, f32 GPU ping-pong/readback/upload buffers, and one
/// in-flight RGBA/PNG/base64 encoding. Source-level accounting is about 140
/// bytes before allocator and codec overhead, so admission keeps headroom.
pub(super) const SWE_CORE_BYTES_PER_CELL: u64 = 152;
/// Retained base64 PNG size per cell for each non-streaming snapshot. Tiled
/// snapshots no longer retain a duplicate full image; raw RGBA encoded as
/// base64 approaches 5.34 bytes/cell before small PNG/container overhead.
pub(super) const SWE_RETAINED_SNAPSHOT_BYTES_PER_CELL: u64 = 6;
/// Hard cap on total *work* (grid cells × time steps). The cell cap and the
/// step cap are each individually bounded, but their product is what actually
/// determines wall-clock time; without this a request that passes both (e.g.
/// 4 M cells × ~250 k steps) could wedge the blocking worker for many minutes.
/// 5e10 cell-steps is a few seconds of CPU on this solver and far above any
/// legitimate interactive request (a typical run is well under 1e7).
pub(super) const SWE_MAX_CELL_STEPS: u64 = 50_000_000_000;
/// Hard cap on number of snapshots per simulation.
pub(super) const SWE_MAX_SNAPSHOTS: usize = 240;
pub(super) const SWE_MAX_GAUGES: usize = 256;
/// Hard cap on simulated time — runaway scrubs.
pub(super) const SWE_MAX_T_END_S: f64 = 24.0 * 3600.0;
/// Hard cap on coastal-runup query batch size — protects against IPC flooding.
pub(super) const RUNUP_MAX_POINTS: usize = 2_000;
/// Hard cap on wavefront sample count.
pub(super) const WAVEFRONT_MAX_SAMPLES: usize = 2_000;
/// Minimum analytical-basin depth. Below this the solver CFL and celerity
/// become unrepresentative; the solver used to silently clamp requests up to
/// this floor, diverging the simulated depth from the reported one.
pub(super) const SWE_MIN_MEAN_DEPTH_M: f64 = 50.0;

#[derive(Debug, Clone, Copy)]
pub(super) struct SimulationGridPlan {
    pub(super) lat: f64,
    pub(super) lon: f64,
    pub(super) south: f64,
    pub(super) north: f64,
    pub(super) west: f64,
    pub(super) east: f64,
    pub(super) cell_deg: f64,
    pub(super) nx: usize,
    pub(super) ny: usize,
    pub(super) cells: usize,
}

impl SimulationGridPlan {
    pub(super) fn from_request(req: &SimulateGridRequest) -> Result<Self, String> {
        let lat = req.source.lat_deg.clamp(-90.0, 90.0);
        let lon = ((req.source.lon_deg + 180.0).rem_euclid(360.0)) - 180.0;
        let half = req.box_half_size_deg;
        let cell_deg = 1.0 / req.cells_per_deg;
        let south = (lat - half).max(-90.0);
        let north = (lat + half).min(90.0);
        let west = lon - half;
        let east = lon + half;
        let nx = ((east - west) / cell_deg).round().max(2.0) as usize;
        let ny = ((north - south) / cell_deg).round().max(2.0) as usize;
        let cells = nx.saturating_mul(ny);
        if cells > SWE_MAX_CELLS {
            return Err(format!(
                "grid too large ({nx}×{ny} ≈ {cells} cells) — reduce cells_per_deg or \
                 box_half_size_deg"
            ));
        }
        Ok(Self {
            lat,
            lon,
            south,
            north,
            west,
            east,
            cell_deg,
            nx,
            ny,
            cells,
        })
    }
}

#[derive(Debug, Clone, Copy)]
pub(super) struct SimulationMemoryEstimate {
    pub(super) nx: usize,
    pub(super) ny: usize,
    pub(super) cells: usize,
    pub(super) estimated_bytes: u64,
}

impl SimulationMemoryEstimate {
    pub(super) fn for_plan(plan: &SimulationGridPlan, retained_snapshots: usize) -> Self {
        let bytes_per_cell = SWE_CORE_BYTES_PER_CELL.saturating_add(
            SWE_RETAINED_SNAPSHOT_BYTES_PER_CELL.saturating_mul(retained_snapshots as u64),
        );
        Self {
            nx: plan.nx,
            ny: plan.ny,
            cells: plan.cells,
            estimated_bytes: (plan.cells as u64).saturating_mul(bytes_per_cell),
        }
    }
}

pub(super) fn validate_simulate_grid(req: &SimulateGridRequest) -> Result<(), String> {
    if !req.source.lat_deg.is_finite() || req.source.lat_deg.abs() > 90.0 {
        return Err(format!(
            "source latitude {} out of range",
            req.source.lat_deg
        ));
    }
    if !req.source.lon_deg.is_finite() || req.source.lon_deg.abs() > LON_ABS_MAX {
        return Err(format!(
            "source longitude {} out of range",
            req.source.lon_deg
        ));
    }
    if !req.initial_amplitude_m.is_finite() || req.initial_amplitude_m.abs() > 1.0e5 {
        return Err("initial_amplitude_m must be finite and ≤ 100 km".into());
    }
    if !req.source_sigma_m.is_finite() || req.source_sigma_m < 0.0 || req.source_sigma_m > 1.0e7 {
        return Err("source_sigma_m must be finite and in [0, 10 000 km]".into());
    }
    match &req.source_geometry {
        Some(InitialSourceGeometry::CavityRing {
            rim_radius_m,
            rim_width_m,
        }) => {
            if !rim_radius_m.is_finite()
                || !rim_width_m.is_finite()
                || *rim_radius_m <= 0.0
                || *rim_width_m <= 0.0
                || *rim_radius_m > 1.0e7
                || *rim_width_m > 1.0e7
            {
                return Err("cavity-ring radii must be finite and in (0, 10 000 km]".into());
            }
        }
        Some(InitialSourceGeometry::Landslide {
            axis_azimuth_deg,
            longitudinal_sigma_m,
            transverse_sigma_m,
        }) => {
            if !axis_azimuth_deg.is_finite() || !(0.0..360.0).contains(axis_azimuth_deg) {
                return Err("landslide axis_azimuth_deg must be finite and in [0, 360)".into());
            }
            if !longitudinal_sigma_m.is_finite()
                || !transverse_sigma_m.is_finite()
                || *longitudinal_sigma_m <= 0.0
                || *transverse_sigma_m <= 0.0
                || *longitudinal_sigma_m > 1.0e7
                || *transverse_sigma_m > 1.0e7
            {
                return Err("landslide source scales must be finite and in (0, 10 000 km]".into());
            }
        }
        Some(InitialSourceGeometry::Okada { fault }) => {
            let values = [
                fault.center_lat,
                fault.center_lon,
                fault.depth_m,
                fault.length_m,
                fault.width_m,
                fault.strike_deg,
                fault.dip_deg,
                fault.rake_deg,
                fault.slip_m,
            ];
            if values.iter().any(|value| !value.is_finite())
                || fault.center_lat.abs() > 90.0
                || fault.center_lon.abs() > LON_ABS_MAX
                || fault.depth_m < 0.0
                || fault.length_m <= 0.0
                || fault.width_m <= 0.0
                || fault.slip_m <= 0.0
            {
                return Err("Okada source geometry contains invalid fault parameters".into());
            }
        }
        None => {}
    }
    if !req.mean_depth_m.is_finite() || req.mean_depth_m < 0.0 || req.mean_depth_m > 12_000.0 {
        return Err("mean_depth_m must be finite and in [0, 12 000 m]".into());
    }
    // The analytical basin is simulated at exactly `mean_depth_m`; a sub-floor
    // request was previously clamped to the floor while every readout still
    // reported the request. Reject it so the simulated depth always equals the
    // reported/exported depth. Real-bathymetry runs ignore this field.
    if !req.use_real_bathymetry && req.mean_depth_m < SWE_MIN_MEAN_DEPTH_M {
        return Err(format!(
            "mean_depth_m must be at least {} m for the analytical basin (or enable real bathymetry)",
            SWE_MIN_MEAN_DEPTH_M
        ));
    }
    if let Some(asset_id) = req.bathymetry_asset_id.as_deref() {
        if !req.use_real_bathymetry {
            return Err("bathymetry_asset_id requires use_real_bathymetry=true".into());
        }
        crate::data::bathymetry_cache::validate_asset_id(asset_id)?;
    }
    if !(req.box_half_size_deg.is_finite()
        && req.box_half_size_deg > 0.0
        && req.box_half_size_deg <= 60.0)
    {
        return Err("box_half_size_deg must be in (0, 60]".into());
    }
    if !(req.cells_per_deg.is_finite() && req.cells_per_deg > 0.0 && req.cells_per_deg <= 200.0) {
        return Err("cells_per_deg must be in (0, 200]".into());
    }
    if !req.t_end_s.is_finite() || req.t_end_s < 0.0 || req.t_end_s > SWE_MAX_T_END_S {
        return Err(format!("t_end_s must be in [0, {}]", SWE_MAX_T_END_S));
    }
    if req.n_snapshots < 2 || req.n_snapshots > SWE_MAX_SNAPSHOTS {
        return Err(format!("n_snapshots must be in [2, {}]", SWE_MAX_SNAPSHOTS));
    }
    if let Some(p) = req.lamb_wave_peak_pressure_pa
        && (!p.is_finite() || p <= 0.0 || p > 1.0e6)
    {
        return Err("lamb_wave_peak_pressure_pa must be in (0, 1 000 000]".into());
    }
    if let Some(r) = req.lamb_wave_source_radius_m
        && (!r.is_finite() || r <= 0.0 || r > 1.0e7)
    {
        return Err("lamb_wave_source_radius_m must be in (0, 10 000 km]".into());
    }
    if !(req.colormap.is_empty()
        || req.colormap == "diverging"
        || req.colormap == "cividis"
        || req.colormap == "viridis")
    {
        return Err("colormap must be 'diverging', 'cividis', or 'viridis'".into());
    }
    if req.gauge_points.len() > SWE_MAX_GAUGES {
        return Err(format!(
            "gauge_points must contain at most {SWE_MAX_GAUGES} gauges"
        ));
    }
    let mut gauge_ids = HashSet::with_capacity(req.gauge_points.len());
    for g in &req.gauge_points {
        if g.id.trim().is_empty() || g.id.len() > 128 {
            return Err("gauge point id must be 1..128 characters".into());
        }
        if !gauge_ids.insert(g.id.as_str()) {
            return Err("gauge point ids must be unique".into());
        }
        if !g.lat_deg.is_finite() || g.lat_deg.abs() > 90.0 {
            return Err(format!("gauge latitude {} out of range", g.lat_deg));
        }
        if !g.lon_deg.is_finite() || g.lon_deg.abs() > LON_ABS_MAX {
            return Err(format!("gauge longitude {} out of range", g.lon_deg));
        }
    }
    Ok(())
}

pub(super) fn populate_grid_bathymetry(
    grid: &mut SwGrid,
    req: &SimulateGridRequest,
    app_data_dir: Option<&Path>,
) -> Result<(), String> {
    if let Some(asset_id) = req.bathymetry_asset_id.as_deref() {
        let app_data_dir = app_data_dir.ok_or_else(|| {
            "application data directory is unavailable for local bathymetry".to_owned()
        })?;
        let (_, raster) =
            crate::data::bathymetry_cache::load_cached_raster(app_data_dir, asset_id)?;
        let mut sampled = Vec::with_capacity(grid.nx * grid.ny);
        for row in 0..grid.ny {
            let lat = grid.south_lat + (row as f64 + 0.5) * grid.dlat_deg;
            for column in 0..grid.nx {
                let lon = grid.west_lon + (column as f64 + 0.5) * grid.dlon_deg;
                sampled.push(raster.sample_bilinear(lat, lon)?);
            }
        }
        if sampled.iter().all(|depth| *depth <= 0.0) {
            return Err("local bathymetry crop contains no wet solver cells".into());
        }
        grid.h_m = sampled;
    } else if req.use_real_bathymetry {
        grid.fill_bathymetry_from(|lat, lon| {
            let depth = crate::data::bathymetry::sample(lat, lon);
            depth.max(0.0)
        });
    } else {
        grid.fill_uniform_depth(req.mean_depth_m.max(SWE_MIN_MEAN_DEPTH_M));
    }
    Ok(())
}

/// Run a real CPU shallow-water-equation simulation. Returns evenly-spaced
/// PNG snapshots ready to drop into Cesium as a `SingleTileImageryProvider`.
///
/// Runs on a Tauri async runtime worker via `spawn_blocking` so the Cesium
/// + Tauri IPC threads stay responsive even during a multi-second
/// simulation. The future awaits the join handle; if the worker panics or
/// is cancelled, we surface a stringified error.
#[tauri::command]
pub async fn simulate_grid(
    app: AppHandle,
    run_id: String,
    req: SimulateGridRequest,
) -> Result<SimulateGridResponse, String> {
    validate_simulate_grid(&req)?;
    let app_data_dir = req
        .bathymetry_asset_id
        .as_ref()
        .map(|_| {
            app.path()
                .app_data_dir()
                .map_err(|error| format!("application data directory is unavailable: {error}"))
        })
        .transpose()?;
    let plan = SimulationGridPlan::from_request(&req)?;
    let memory = SimulationMemoryEstimate::for_plan(&plan, req.n_snapshots.max(2));

    let cancel = Arc::new(AtomicBool::new(false));
    register_simulation(&run_id, &cancel, &memory)?;
    let worker_run_id = run_id.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let response_run_id = worker_run_id.clone();
        let diagnostics = |message: &str| emit_solver_diagnostic(&app, message);
        let result = (|| {
        let mut grid = SwGrid::new(
            plan.west,
            plan.south,
            plan.east,
            plan.north,
            plan.cell_deg,
            plan.cell_deg,
        );
        grid.colormap = match req.colormap.as_str() {
            "cividis" => Colormap::Cividis,
            "viridis" => Colormap::Viridis,
            _ => Colormap::Diverging,
        };
        populate_grid_bathymetry(&mut grid, &req, app_data_dir.as_deref())?;
        inject_source_initial_field(&mut grid, &req)?;

        // F4-05 — when include_lamb_wave is set, apply the atmospheric
        // pressure-driven η contribution at t=0 as a wider IC injection
        // alongside the Gaussian. Captures the leading-edge Lamb-wave
        // depression for the first ~100 s after source event; continuous
        // step-by-step forcing lands in v0.5.0.
        if req.include_lamb_wave {
            let mut lamb = crate::physics::lamb_wave::LambWaveSource::hunga_tonga_2022();
            if let Some(p) = req.lamb_wave_peak_pressure_pa
                && p.is_finite()
                && p > 0.0
            {
                lamb.peak_pressure_pa = p;
            }
            if let Some(r) = req.lamb_wave_source_radius_m
                && r.is_finite()
                && r > 0.0
            {
                lamb.source_radius_m = r;
            }
            // Sample at the pulse-arrival time at the source — captures
            // the peak depression. Subsequent step-by-step propagation
            // of the η depression is handled by the SWE solver as the
            // grid relaxes back toward equilibrium.
            grid.apply_lamb_wave(&lamb, plan.lat, plan.lon, 0.0);
        }

        let dt = grid.recommended_dt_s(0.4);
        let nx = grid.nx as u32;
        let ny = grid.ny as u32;

        // Combined work budget (cells × steps). The cell count and the step
        // count are each capped, but only their product bounds wall-clock time.
        let est_steps = if dt.is_finite() && dt > 0.0 {
            (req.t_end_s / dt).clamp(1.0, 1.0e9)
        } else {
            1.0
        };
        let work = (grid.nx as u64)
            .saturating_mul(grid.ny as u64)
            .saturating_mul(est_steps as u64);
        if work > SWE_MAX_CELL_STEPS {
            return Err(format!(
                "simulation too expensive (~{} cell-steps; cap {}). Reduce cells_per_deg, box_half_size_deg, or t_end_s.",
                work, SWE_MAX_CELL_STEPS
            ));
        }

        // F4-01 — when compiled with `--features gpu`, try the wgpu
        // dispatch path. Fall back to CPU cleanly if no adapter is
        // available (Linux CI, integrated-only laptops without
        // Vulkan, etc.). The finite-volume kernel has CPU/GPU parity for
        // both linear and nonlinear transport; live runs request nonlinear
        // mode on either backend.
        let quality_baseline = QualityBaseline::capture(
            &grid,
            crate::physics::solver::BoundaryMode::default_sponge(),
        );
        let admission_quality = quality_baseline.assess(&grid, dt);
        if let Some(failure) = &admission_quality.failure {
            publish_run_quality(&admission_quality);
            return Err(format!("simulation rejected by numerical-integrity admission gate: {failure}"));
        }
        let (snapshots, used_gpu, max_field) = run_simulation_dispatch(
            &mut grid,
            dt,
            req.t_end_s,
            req.n_snapshots,
            cancel.as_ref(),
            Some(&diagnostics),
            &req.gauge_points,
            MaxFieldAccumulator::threshold_for_amplitude(req.initial_amplitude_m),
        );
        let run_quality = quality_baseline.assess(&grid, dt);
        publish_run_quality(&run_quality);
        if let Some(failure) = &run_quality.failure {
            diagnostics(&format!("numerical-integrity violation: {failure}"));
            return Err(format!("simulation rejected by numerical-integrity gate: {failure}"));
        }
        let emitted_snapshots = snapshots.len().min(u32::MAX as usize) as u32;
        let cancelled = cancel.load(Ordering::Acquire);
        Ok(SimulateGridResponse {
            run_id: response_run_id,
            lifecycle: if cancelled {
                SimulationRunLifecycle::Cancelled
            } else {
                SimulationRunLifecycle::Completed
            },
            emitted_snapshots,
            cancelled,
            snapshots,
            dt_s: dt,
            nx,
            ny,
            bathymetry_asset_id: req.bathymetry_asset_id.clone(),
            used_gpu,
            max_field,
            run_quality,
        })
        })();
        unregister_simulation(&worker_run_id, &cancel);
        result
    })
    .await
    .map_err(|e| format!("simulate_grid worker failed: {e}"))?
}

/// Streaming variant of `simulate_grid`. Sends each GridSnapshot
/// through a Tauri Channel as it's computed, enabling real-time
/// playback during simulation instead of waiting for all snapshots.
/// Returns the grid metadata (dt_s, nx, ny, used_gpu) once complete.
#[derive(Debug, Serialize)]
pub struct SimulateGridStreamMeta {
    pub run_id: String,
    pub lifecycle: SimulationRunLifecycle,
    pub dt_s: f64,
    pub nx: u32,
    pub ny: u32,
    pub bathymetry_asset_id: Option<String>,
    pub used_gpu: bool,
    pub n_snapshots: u32,
    pub cancelled: bool,
    /// Max-field products (peak |η|, time of maximum, energy proxy,
    /// arrival isochrones) accumulated at solver-step cadence.
    pub max_field: Option<MaxFieldProduct>,
    /// Stable identity for the Rust-authoritative render stream emitted beside
    /// the legacy PNG snapshots. `None` means no render channel was requested.
    pub render_scenario_id: Option<String>,
    pub render_frame_count: u64,
    pub run_quality: RunQualityRecord,
    pub recovered_gauge_history: Vec<GridGaugeHistoryFrame>,
}

#[derive(Debug, Serialize)]
pub struct GridGaugeHistoryFrame {
    pub time_s: f64,
    pub gauge_samples: Vec<GridGaugeSample>,
}

#[tauri::command]
pub async fn simulate_grid_streaming(
    app: AppHandle,
    run_id: String,
    resume_run_id: Option<String>,
    checkpoint_interval_s: Option<u64>,
    req: SimulateGridRequest,
    on_snapshot: tauri::ipc::Channel<GridSnapshot>,
    on_render_packet: tauri::ipc::Channel<Response>,
) -> Result<SimulateGridStreamMeta, String> {
    validate_simulate_grid(&req)?;
    let checkpoint_interval = validate_checkpoint_interval(checkpoint_interval_s)?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("application data directory is unavailable: {error}"))?;
    let plan = SimulationGridPlan::from_request(&req)?;
    let memory = SimulationMemoryEstimate::for_plan(&plan, 0);

    let cancel = Arc::new(AtomicBool::new(false));
    register_simulation(&run_id, &cancel, &memory)?;
    let worker_run_id = run_id.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let response_run_id = worker_run_id.clone();
        let diagnostics = |message: &str| emit_solver_diagnostic(&app, message);
        let result = (|| {
            let mut grid = SwGrid::new(
                plan.west,
                plan.south,
                plan.east,
                plan.north,
                plan.cell_deg,
                plan.cell_deg,
            );
            grid.colormap = match req.colormap.as_str() {
                "cividis" => Colormap::Cividis,
                "viridis" => Colormap::Viridis,
                _ => Colormap::Diverging,
            };
            populate_grid_bathymetry(&mut grid, &req, Some(&app_data_dir))?;
            inject_source_initial_field(&mut grid, &req)?;

            if req.include_lamb_wave {
                let mut lamb = crate::physics::lamb_wave::LambWaveSource::hunga_tonga_2022();
                if let Some(p) = req.lamb_wave_peak_pressure_pa
                    && p.is_finite()
                    && p > 0.0
                {
                    lamb.peak_pressure_pa = p;
                }
                if let Some(r) = req.lamb_wave_source_radius_m
                    && r.is_finite()
                    && r > 0.0
                {
                    lamb.source_radius_m = r;
                }
                grid.apply_lamb_wave(&lamb, plan.lat, plan.lon, 0.0);
            }

            let dt = grid.recommended_dt_s(0.4);
            let nx = grid.nx as u32;
            let ny = grid.ny as u32;
            let snapshot_schedule = snapshot_step_schedule(req.t_end_s, dt, req.n_snapshots);
            let quality_baseline = QualityBaseline::capture(
                &grid,
                crate::physics::solver::BoundaryMode::default_sponge(),
            );
            let admission_quality = quality_baseline.assess(&grid, dt);
            if let Some(failure) = &admission_quality.failure {
                publish_run_quality(&admission_quality);
                return Err(format!(
                    "simulation rejected by numerical-integrity admission gate: {failure}"
                ));
            }

            let checkpoint_writer = RefCell::new(StreamCheckpointWriter::new(
                app_data_dir.clone(),
                &response_run_id,
                &req,
                dt,
                checkpoint_interval,
            )?);
            let resumed = resume_run_id
                .as_deref()
                .map(|checkpoint_run_id| {
                    let checkpoint = crate::physics::solver::checkpoint::load_latest(
                        &app_data_dir,
                        checkpoint_run_id,
                    )?;
                    verify_resume_checkpoint(
                        &checkpoint,
                        &checkpoint_writer.borrow().identity,
                        &req.gauge_points,
                        &grid,
                        &snapshot_schedule,
                    )?;
                    Ok::<_, String>(checkpoint)
                })
                .transpose()?;
            let (start_interval, restored_max_field, recovered_gauge_history) =
                if let Some(checkpoint) = resumed {
                    let start = checkpoint.identity.next_snapshot_interval as usize;
                    let recovered_gauge_history = checkpoint_gauge_history_for_ipc(&checkpoint);
                    checkpoint_writer.borrow_mut().gauge_history = checkpoint.gauge_history;
                    grid = checkpoint.grid;
                    (start, Some(checkpoint.max_field), recovered_gauge_history)
                } else {
                    (0, None, Vec::new())
                };
            checkpoint_writer
                .borrow_mut()
                .identity
                .next_snapshot_interval = start_interval.min(u32::MAX as usize) as u32;

            let canonical_scenario = serde_json::to_vec(&req)
                .map_err(|error| format!("failed to canonicalize render scenario: {error}"))?;
            let scenario_sha256 = crate::render_protocol::sha256_hex(&canonical_scenario);
            let scenario_id = format!("swe-{}", &scenario_sha256[..16]);
            let render_stream = RenderStreamContext::new(
                &on_render_packet,
                scenario_id.clone(),
                scenario_sha256.clone(),
                dt,
            );
            render_stream.send_scenario(
                &canonical_scenario,
                crate::data::geodesy::GeodeticPosition {
                    lat_deg: plan.lat,
                    lon_deg: plan.lon,
                    ellipsoid_height_m: 0.0,
                },
                req.use_real_bathymetry,
            )?;

            let est_steps = if dt.is_finite() && dt > 0.0 {
                (req.t_end_s / dt).clamp(1.0, 1.0e9)
            } else {
                1.0
            };
            let work = (grid.nx as u64)
                .saturating_mul(grid.ny as u64)
                .saturating_mul(est_steps as u64);
            if work > SWE_MAX_CELL_STEPS {
                return Err(format!(
                    "simulation too expensive (~{} cell-steps; cap {})",
                    work, SWE_MAX_CELL_STEPS
                ));
            }

            // Stream the initial or restored snapshot immediately.
            let initial_snapshot =
                grid.snapshot_with_gauge_samples(&req.gauge_points, Some(&diagnostics));
            on_snapshot
                .send(initial_snapshot)
                .map_err(|error| format!("simulation snapshot receiver closed: {error}"))?;
            if start_interval == 0 {
                checkpoint_writer.borrow_mut().record_gauges(&grid);
            }
            render_stream.send_frame(&grid)?;

            let max_field_threshold_m =
                MaxFieldAccumulator::threshold_for_amplitude(req.initial_amplitude_m);
            let max_field_acc = std::cell::RefCell::new(restored_max_field.unwrap_or_else(|| {
                let mut accumulator =
                    MaxFieldAccumulator::new(grid.nx * grid.ny, max_field_threshold_m);
                accumulator.observe(&grid);
                accumulator
            }));

            let stream_ctx = StreamSimulationContext {
                cancel: cancel.as_ref(),
                on_snapshot: &on_snapshot,
                diagnostics: Some(&diagnostics),
                gauges: &req.gauge_points,
                max_field: &max_field_acc,
                render: Some(&render_stream),
                quality_baseline: &quality_baseline,
                checkpoint: Some(&checkpoint_writer),
                snapshot_interval_offset: start_interval,
            };
            let used_gpu = stream_simulation_dispatch(
                &mut grid,
                dt,
                &snapshot_schedule[start_interval..],
                &stream_ctx,
            )?;
            let run_quality = quality_baseline.assess(&grid, dt);
            publish_run_quality(&run_quality);
            if let Some(failure) = &run_quality.failure {
                diagnostics(&format!("numerical-integrity violation: {failure}"));
                return Err(format!(
                    "simulation rejected by numerical-integrity gate: {failure}"
                ));
            }
            render_stream.finish(&grid)?;
            let cancelled = cancel.load(Ordering::Acquire);
            if cancelled {
                let next_interval =
                    checkpoint_writer.borrow().identity.next_snapshot_interval as usize;
                checkpoint_writer.borrow_mut().record_gauges(&grid);
                checkpoint_writer.borrow_mut().maybe_write(
                    &grid,
                    &max_field_acc.borrow(),
                    next_interval,
                    true,
                    Some(&diagnostics),
                );
            } else {
                checkpoint_writer.borrow().remove_completed();
                if let Some(resume_run_id) = resume_run_id.as_deref() {
                    let _ = crate::physics::solver::checkpoint::remove(
                        &checkpoint_writer.borrow().root,
                        resume_run_id,
                    );
                }
            }
            let max_field = max_field_acc
                .into_inner()
                .into_product(&grid, Some(&diagnostics));
            Ok(SimulateGridStreamMeta {
                run_id: response_run_id,
                lifecycle: if cancelled {
                    SimulationRunLifecycle::Cancelled
                } else {
                    SimulationRunLifecycle::Completed
                },
                dt_s: dt,
                nx,
                ny,
                bathymetry_asset_id: req.bathymetry_asset_id.clone(),
                used_gpu,
                n_snapshots: render_stream.frame_count().min(u32::MAX as u64) as u32,
                cancelled,
                max_field: Some(max_field),
                render_scenario_id: Some(scenario_id),
                render_frame_count: render_stream.frame_count(),
                run_quality,
                recovered_gauge_history,
            })
        })();
        unregister_simulation(&worker_run_id, &cancel);
        result
    })
    .await
    .map_err(|e| format!("simulate_grid_streaming worker failed: {e}"))?
}

pub(super) struct RenderStreamContext<'a> {
    channel: &'a tauri::ipc::Channel<Response>,
    scenario_id: String,
    scenario_sha256: String,
    tick_duration_s: f64,
    next_sequence: Cell<u64>,
    frame_count: Cell<u64>,
    send_error: RefCell<Option<String>>,
}

impl<'a> RenderStreamContext<'a> {
    pub(super) fn new(
        channel: &'a tauri::ipc::Channel<Response>,
        scenario_id: String,
        scenario_sha256: String,
        tick_duration_s: f64,
    ) -> Self {
        Self {
            channel,
            scenario_id,
            scenario_sha256,
            tick_duration_s,
            next_sequence: Cell::new(1),
            frame_count: Cell::new(0),
            send_error: RefCell::new(None),
        }
    }

    pub(super) fn send_scenario(
        &self,
        canonical_scenario: &[u8],
        origin: crate::data::geodesy::GeodeticPosition,
        uses_bundled_bathymetry: bool,
    ) -> Result<(), String> {
        let packet = crate::render_protocol::scenario_packet(
            &self.scenario_id,
            canonical_scenario,
            origin,
            self.tick_duration_s,
            crate::render_protocol::PhysicsProvenanceV1 {
                authority: "rust".into(),
                model_versions: vec![crate::render_protocol::ModelVersionV1 {
                    component: "shallow_water_solver".into(),
                    version: "1.0.0".into(),
                }],
                geodesy_contract_version: crate::data::geodesy::CONTRACT_VERSION.into(),
                surface_mask_version: None,
                bathymetry_asset_id: Some(if uses_bundled_bathymetry {
                    "cataclysm-coarse-bathymetry-v1".into()
                } else {
                    "uniform-depth-request".into()
                }),
                solver_backend: "runtime-selected-cpu-or-gpu".into(),
            },
        )?;
        self.channel
            .send(Response::new(packet))
            .map_err(|error| format!("failed to send render scenario packet: {error}"))
    }

    pub(super) fn send_frame(&self, grid: &SwGrid) -> Result<(), String> {
        let sequence = self.next_sequence.get();
        let packet = crate::render_protocol::frame_packet_from_grid(
            &self.scenario_id,
            &self.scenario_sha256,
            grid,
            self.tick_duration_s,
            sequence,
        )?;
        self.channel
            .send(Response::new(packet))
            .map_err(|error| format!("failed to send render frame packet: {error}"))?;
        self.next_sequence.set(sequence.saturating_add(1));
        self.frame_count
            .set(self.frame_count.get().saturating_add(1));
        Ok(())
    }

    pub(super) fn try_send_frame(&self, grid: &SwGrid) -> bool {
        if self.send_error.borrow().is_some() {
            return false;
        }
        if let Err(error) = self.send_frame(grid) {
            *self.send_error.borrow_mut() = Some(error);
            return false;
        }
        true
    }

    pub(super) fn finish(&self, grid: &SwGrid) -> Result<(), String> {
        if let Some(error) = self.send_error.borrow_mut().take() {
            return Err(error);
        }
        let packet = crate::render_protocol::end_packet(
            &self.scenario_id,
            &self.scenario_sha256,
            grid.step_index,
            self.frame_count.get(),
            self.next_sequence.get(),
        )?;
        self.channel
            .send(Response::new(packet))
            .map_err(|error| format!("failed to send render end packet: {error}"))
    }

    pub(super) fn frame_count(&self) -> u64 {
        self.frame_count.get()
    }
}

pub(super) struct StreamSimulationContext<'a> {
    cancel: &'a AtomicBool,
    on_snapshot: &'a tauri::ipc::Channel<GridSnapshot>,
    diagnostics: Option<&'a DiagnosticSink<'a>>,
    gauges: &'a [GridGaugePoint],
    /// Max-field accumulator, observed after every accepted solver step.
    /// RefCell because the context is shared immutably down the dispatch fns.
    max_field: &'a std::cell::RefCell<MaxFieldAccumulator>,
    render: Option<&'a RenderStreamContext<'a>>,
    quality_baseline: &'a QualityBaseline,
    checkpoint: Option<&'a RefCell<StreamCheckpointWriter>>,
    snapshot_interval_offset: usize,
}

pub(super) fn validate_checkpoint_interval(value: Option<u64>) -> Result<Duration, String> {
    let seconds = value.unwrap_or(60);
    if !(15..=3_600).contains(&seconds) {
        return Err("checkpoint_interval_s must be in [15, 3600]".to_string());
    }
    Ok(Duration::from_secs(seconds))
}

pub(super) struct StreamCheckpointWriter {
    root: PathBuf,
    pub(super) identity: crate::physics::solver::checkpoint::CheckpointIdentity,
    gauge_points: Vec<GridGaugePoint>,
    gauge_history: Vec<crate::physics::solver::checkpoint::CheckpointGaugeFrame>,
    interval: Duration,
    last_write: Instant,
    disabled: bool,
}

impl StreamCheckpointWriter {
    pub(super) fn new(
        root: PathBuf,
        run_id: &str,
        req: &SimulateGridRequest,
        dt_s: f64,
        interval: Duration,
    ) -> Result<Self, String> {
        let canonical = serde_json::to_vec(req)
            .map_err(|error| format!("failed to identify checkpoint scenario: {error}"))?;
        let mut settings_material = b"cataclysm-checkpoint-settings-v1\0".to_vec();
        settings_material.extend_from_slice(&canonical);
        let data_source =
            req.bathymetry_asset_id
                .as_deref()
                .unwrap_or(if req.use_real_bathymetry {
                    "cataclysm-coarse-bathymetry-v1"
                } else {
                    "cataclysm-uniform-depth-v1"
                });
        let data_material = format!("cataclysm-checkpoint-data-v1\0{data_source}");
        let created_at_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |duration| {
                duration.as_millis().min(u64::MAX as u128) as u64
            });
        Ok(Self {
            root,
            identity: crate::physics::solver::checkpoint::CheckpointIdentity {
                run_id: run_id.to_string(),
                scenario_sha256: crate::render_protocol::sha256_hex(&canonical),
                settings_sha256: crate::render_protocol::sha256_hex(&settings_material),
                data_sha256: crate::render_protocol::sha256_hex(data_material.as_bytes()),
                solver_version: "shallow-water-solver-1.0.0".to_string(),
                created_at_ms,
                dt_s,
                t_end_s: req.t_end_s,
                n_snapshots: req.n_snapshots.min(u32::MAX as usize) as u32,
                next_snapshot_interval: 0,
            },
            gauge_points: req.gauge_points.clone(),
            gauge_history: Vec::with_capacity(req.n_snapshots),
            interval,
            last_write: Instant::now(),
            disabled: false,
        })
    }

    pub(super) fn record_gauges(&mut self, grid: &SwGrid) {
        if self
            .gauge_history
            .last()
            .is_some_and(|frame| frame.time_s.to_bits() == grid.t_s.to_bits())
        {
            return;
        }
        self.gauge_history
            .push(crate::physics::solver::checkpoint::CheckpointGaugeFrame {
                time_s: grid.t_s,
                eta_m: grid.sample_gauge_values(&self.gauge_points),
            });
    }

    pub(super) fn maybe_write(
        &mut self,
        grid: &SwGrid,
        max_field: &MaxFieldAccumulator,
        next_interval: usize,
        force: bool,
        diagnostics: Option<&DiagnosticSink<'_>>,
    ) {
        self.identity.next_snapshot_interval = next_interval.min(u32::MAX as usize) as u32;
        if self.disabled || (!force && self.last_write.elapsed() < self.interval) {
            return;
        }
        match crate::physics::solver::checkpoint::write_latest_state_with_gauges(
            &self.root,
            &self.identity,
            grid,
            max_field,
            &self.gauge_points,
            &self.gauge_history,
        ) {
            Ok(_) => self.last_write = Instant::now(),
            Err(error) => {
                self.disabled = true;
                crate::physics::solver::report_diagnostic(
                    diagnostics,
                    format!("[solver] checkpointing disabled for this run: {error}"),
                );
            }
        }
    }

    pub(super) fn remove_completed(&self) {
        let _ = crate::physics::solver::checkpoint::remove(&self.root, &self.identity.run_id);
    }
}

pub(super) fn checkpoint_gauge_history_for_ipc(
    checkpoint: &crate::physics::solver::checkpoint::SolverCheckpoint,
) -> Vec<GridGaugeHistoryFrame> {
    checkpoint
        .gauge_history
        .iter()
        .map(|frame| GridGaugeHistoryFrame {
            time_s: frame.time_s,
            gauge_samples: checkpoint
                .gauge_points
                .iter()
                .zip(&frame.eta_m)
                .map(|(gauge, eta_m)| GridGaugeSample {
                    id: gauge.id.clone(),
                    eta_m: *eta_m,
                })
                .collect(),
        })
        .collect()
}

pub(super) fn verify_resume_checkpoint(
    checkpoint: &crate::physics::solver::checkpoint::SolverCheckpoint,
    expected: &crate::physics::solver::checkpoint::CheckpointIdentity,
    expected_gauges: &[GridGaugePoint],
    initial_grid: &SwGrid,
    snapshot_schedule: &[usize],
) -> Result<(), String> {
    let actual = &checkpoint.identity;
    if actual.scenario_sha256 != expected.scenario_sha256
        || actual.settings_sha256 != expected.settings_sha256
        || actual.data_sha256 != expected.data_sha256
        || actual.solver_version != expected.solver_version
        || actual.dt_s.to_bits() != expected.dt_s.to_bits()
        || actual.t_end_s.to_bits() != expected.t_end_s.to_bits()
        || actual.n_snapshots != expected.n_snapshots
    {
        return Err(
            "checkpoint does not match the current scenario, settings, data, or solver version"
                .to_string(),
        );
    }
    if checkpoint.gauge_points != expected_gauges {
        return Err("checkpoint gauges do not match the current run request".to_string());
    }
    let start_interval = actual.next_snapshot_interval as usize;
    if start_interval > snapshot_schedule.len() {
        return Err("checkpoint progress exceeds the deterministic snapshot schedule".to_string());
    }
    let expected_steps = snapshot_schedule[..start_interval]
        .iter()
        .try_fold(0_u64, |total, steps| total.checked_add(*steps as u64))
        .ok_or_else(|| "checkpoint step schedule overflow".to_string())?;
    let expected_time = expected_steps as f64 * expected.dt_s;
    let time_tolerance = (expected_time.abs() * 1.0e-12).max(1.0e-9);
    let grid = &checkpoint.grid;
    if grid.step_index != expected_steps
        || (grid.t_s - expected_time).abs() > time_tolerance
        || grid.nx != initial_grid.nx
        || grid.ny != initial_grid.ny
        || grid.dlon_deg.to_bits() != initial_grid.dlon_deg.to_bits()
        || grid.dlat_deg.to_bits() != initial_grid.dlat_deg.to_bits()
        || grid.west_lon.to_bits() != initial_grid.west_lon.to_bits()
        || grid.south_lat.to_bits() != initial_grid.south_lat.to_bits()
        || grid.colormap != initial_grid.colormap
        || grid.h_m != initial_grid.h_m
    {
        return Err(
            "checkpoint grid or progress does not match the deterministic run plan".to_string(),
        );
    }
    Ok(())
}

pub(super) fn stream_simulation_cpu(
    grid: &mut SwGrid,
    dt_s: f64,
    snapshot_schedule: &[usize],
    ctx: &StreamSimulationContext<'_>,
) -> Result<(), String> {
    stream_simulation_cpu_from(grid, dt_s, snapshot_schedule, 0, None, ctx)
}

/// Continue the scheduled snapshot stream from an already-committed solver
/// state. `first_take_remaining` is used when a GPU failed partway through the
/// interval at `start_interval`; later intervals use the shared deterministic
/// plan.
pub(super) fn stream_simulation_cpu_from(
    grid: &mut SwGrid,
    dt_s: f64,
    snapshot_schedule: &[usize],
    start_interval: usize,
    first_take_remaining: Option<usize>,
    ctx: &StreamSimulationContext<'_>,
) -> Result<(), String> {
    let stepper = TimeStepper::new(dt_s);
    for (interval, &scheduled_take) in snapshot_schedule.iter().enumerate().skip(start_interval) {
        if ctx.cancel.load(Ordering::Acquire) {
            break;
        }
        let take = if interval == start_interval {
            first_take_remaining.unwrap_or(scheduled_take)
        } else {
            scheduled_take
        };
        if take > 0 {
            match stepper.step_cancellable_checked(
                grid,
                take,
                Some(ctx.cancel),
                ctx.quality_baseline,
                &mut |state| ctx.max_field.borrow_mut().observe(state),
            ) {
                Ok(true) => {}
                Ok(false) => break,
                Err(quality) => {
                    publish_run_quality(&quality);
                    let failure = quality
                        .failure
                        .clone()
                        .unwrap_or_else(|| "unknown numerical-integrity violation".to_string());
                    return Err(format!(
                        "simulation rejected at step {}: {failure}",
                        quality.accepted_steps
                    ));
                }
            }
        }
        if ctx
            .on_snapshot
            .send(grid.snapshot_with_gauge_samples(ctx.gauges, ctx.diagnostics))
            .is_err()
        {
            ctx.cancel.store(true, Ordering::Release);
            break;
        }
        if let Some(checkpoint) = ctx.checkpoint {
            checkpoint.borrow_mut().record_gauges(grid);
        }
        if let Some(render) = ctx.render
            && !render.try_send_frame(grid)
        {
            ctx.cancel.store(true, Ordering::Release);
            break;
        }
        if let Some(checkpoint) = ctx.checkpoint {
            let max_field = ctx.max_field.borrow();
            checkpoint.borrow_mut().maybe_write(
                grid,
                &max_field,
                ctx.snapshot_interval_offset
                    .saturating_add(interval)
                    .saturating_add(1),
                false,
                ctx.diagnostics,
            );
        }
    }
    Ok(())
}

#[cfg(feature = "gpu")]
pub(super) fn stream_simulation_dispatch(
    grid: &mut SwGrid,
    dt_s: f64,
    snapshot_schedule: &[usize],
    ctx: &StreamSimulationContext<'_>,
) -> Result<bool, String> {
    use crate::physics::solver::BoundaryMode;
    use crate::physics::solver::gpu::GpuTimeStepper;

    let sponge_width = match BoundaryMode::default_sponge() {
        BoundaryMode::Sponge { width_cells } => width_cells as u32,
        BoundaryMode::ZeroFlux => 0,
    };
    if let Some(gpu) = GpuTimeStepper::new_with_diagnostics(
        grid,
        dt_s,
        crate::physics::constants::MANNING_N_COASTAL,
        sponge_width,
        true,
        ctx.diagnostics,
    ) {
        for (interval, &take) in snapshot_schedule.iter().enumerate() {
            if ctx.cancel.load(Ordering::Acquire) {
                break;
            }
            let mut completed = 0usize;
            for _ in 0..take {
                if ctx.cancel.load(Ordering::Acquire) {
                    return Ok(true);
                }
                if !gpu.step_with_diagnostics(grid, 1, ctx.diagnostics) {
                    let remaining = take.saturating_sub(completed);
                    stream_simulation_cpu_from(
                        grid,
                        dt_s,
                        snapshot_schedule,
                        interval,
                        Some(remaining),
                        ctx,
                    )?;
                    return Ok(false);
                }
                let quality = ctx.quality_baseline.assess(grid, dt_s);
                if let Some(failure) = quality.failure.clone() {
                    publish_run_quality(&quality);
                    return Err(format!(
                        "GPU simulation rejected at step {}: {failure}",
                        quality.accepted_steps
                    ));
                }
                completed = completed.saturating_add(1);
                ctx.max_field.borrow_mut().observe(grid);
            }
            if ctx
                .on_snapshot
                .send(grid.snapshot_with_gauge_samples(ctx.gauges, ctx.diagnostics))
                .is_err()
            {
                ctx.cancel.store(true, Ordering::Release);
                break;
            }
            if let Some(checkpoint) = ctx.checkpoint {
                checkpoint.borrow_mut().record_gauges(grid);
            }
            if let Some(render) = ctx.render
                && !render.try_send_frame(grid)
            {
                ctx.cancel.store(true, Ordering::Release);
                break;
            }
            if let Some(checkpoint) = ctx.checkpoint {
                let max_field = ctx.max_field.borrow();
                checkpoint.borrow_mut().maybe_write(
                    grid,
                    &max_field,
                    ctx.snapshot_interval_offset
                        .saturating_add(interval)
                        .saturating_add(1),
                    false,
                    ctx.diagnostics,
                );
            }
        }
        return Ok(true);
    }
    stream_simulation_cpu(grid, dt_s, snapshot_schedule, ctx)?;
    Ok(false)
}

#[cfg(not(feature = "gpu"))]
pub(super) fn stream_simulation_dispatch(
    grid: &mut SwGrid,
    dt_s: f64,
    snapshot_schedule: &[usize],
    ctx: &StreamSimulationContext<'_>,
) -> Result<bool, String> {
    stream_simulation_cpu(grid, dt_s, snapshot_schedule, ctx)?;
    Ok(false)
}

#[cfg(feature = "gpu")]
#[allow(clippy::too_many_arguments)]
pub(super) fn run_simulation_dispatch(
    grid: &mut SwGrid,
    dt_s: f64,
    t_end_s: f64,
    n_snapshots: usize,
    cancel: &AtomicBool,
    diagnostics: Option<&DiagnosticSink<'_>>,
    gauges: &[GridGaugePoint],
    max_field_threshold_m: f64,
) -> (Vec<GridSnapshot>, bool, Option<MaxFieldProduct>) {
    use crate::physics::solver::BoundaryMode;
    use crate::physics::solver::gpu::GpuTimeStepper;

    let sponge_width = match BoundaryMode::default_sponge() {
        BoundaryMode::Sponge { width_cells } => width_cells as u32,
        BoundaryMode::ZeroFlux => 0,
    };
    if let Some(gpu) = GpuTimeStepper::new_with_diagnostics(
        grid,
        dt_s,
        crate::physics::constants::MANNING_N_COASTAL,
        sponge_width,
        true,
        diagnostics,
    ) {
        let pristine = grid.clone();
        let mut acc = MaxFieldAccumulator::new(grid.nx * grid.ny, max_field_threshold_m);
        if let Some(snaps) = run_simulation_gpu(
            grid,
            &gpu,
            dt_s,
            t_end_s,
            n_snapshots,
            cancel,
            diagnostics,
            gauges,
            &mut |g| acc.observe(g),
        ) {
            let product = acc.into_product(grid, diagnostics);
            return (snaps, true, Some(product));
        }
        // Discard partial-GPU observations; CPU rerun observes fresh below.
        *grid = pristine;
    }
    let stepper = TimeStepper::new(dt_s);
    let mut acc = MaxFieldAccumulator::new(grid.nx * grid.ny, max_field_threshold_m);
    let snaps = run_simulation_with_gauge_samples(
        grid,
        &stepper,
        t_end_s,
        n_snapshots,
        Some(cancel),
        diagnostics,
        gauges,
        &mut |g| acc.observe(g),
    );
    let product = acc.into_product(grid, diagnostics);
    (snaps, false, Some(product))
}

#[cfg(not(feature = "gpu"))]
#[allow(clippy::too_many_arguments)]
pub(super) fn run_simulation_dispatch(
    grid: &mut SwGrid,
    dt_s: f64,
    t_end_s: f64,
    n_snapshots: usize,
    cancel: &AtomicBool,
    diagnostics: Option<&DiagnosticSink<'_>>,
    gauges: &[GridGaugePoint],
    max_field_threshold_m: f64,
) -> (Vec<GridSnapshot>, bool, Option<MaxFieldProduct>) {
    let stepper = TimeStepper::new(dt_s);
    let mut acc = MaxFieldAccumulator::new(grid.nx * grid.ny, max_field_threshold_m);
    let snaps = run_simulation_with_gauge_samples(
        grid,
        &stepper,
        t_end_s,
        n_snapshots,
        Some(cancel),
        diagnostics,
        gauges,
        &mut |g| acc.observe(g),
    );
    let product = acc.into_product(grid, diagnostics);
    (snaps, false, Some(product))
}

/// GPU-side `run_simulation`: emits the same `n_snapshots` evenly-spaced
/// snapshots as the CPU path while reading back every solver step for
/// quantitative accumulation. Snapshot encoding remains independently paced.
/// Returns `None` if any GPU step fails (map/poll error or non-finite field),
/// signalling the dispatcher to fall back to the CPU path.
#[cfg(feature = "gpu")]
#[allow(clippy::too_many_arguments)]
pub(super) fn run_simulation_gpu(
    grid: &mut SwGrid,
    gpu: &crate::physics::solver::gpu::GpuTimeStepper,
    dt_s: f64,
    t_end_s: f64,
    n_snapshots: usize,
    cancel: &AtomicBool,
    diagnostics: Option<&DiagnosticSink<'_>>,
    gauges: &[GridGaugePoint],
    observe: &mut dyn FnMut(&SwGrid),
) -> Option<Vec<GridSnapshot>> {
    let n = n_snapshots.max(2);
    let mut snaps = Vec::with_capacity(n);
    snaps.push(grid.snapshot_with_gauge_samples(gauges, diagnostics));
    observe(grid);
    if !t_end_s.is_finite() || t_end_s < 0.0 {
        return Some(snaps);
    }
    for take in snapshot_step_schedule(t_end_s, dt_s, n) {
        if cancel.load(Ordering::Acquire) {
            break;
        }
        let mut remaining = take;
        while remaining > 0 {
            if cancel.load(Ordering::Acquire) {
                return Some(snaps);
            }
            if !gpu.step_with_diagnostics(grid, 1, diagnostics) {
                return None;
            }
            observe(grid);
            remaining -= 1;
        }
        snaps.push(grid.snapshot_with_gauge_samples(gauges, diagnostics));
    }
    Some(snaps)
}
