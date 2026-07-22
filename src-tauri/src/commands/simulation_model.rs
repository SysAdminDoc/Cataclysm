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
    /// Resolution policy. `simple` lets the convergence-calibrated preflight
    /// choose an affordable grid; `advanced` preserves `cells_per_deg` and
    /// records whether it differs from the recommendation. Omission retains
    /// the legacy explicit-resolution behavior without claiming an override.
    #[serde(default)]
    pub resolution_mode: Option<String>,
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
    /// Optional time-dependent moving atmospheric-pressure disturbance.
    #[serde(default)]
    pub meteotsunami_forcing: Option<crate::physics::meteotsunami::MeteotsunamiSource>,
    #[serde(default)]
    pub colormap: String,
    #[serde(default)]
    pub gauge_points: Vec<GridGaugePoint>,
    /// Boundary mode: "sponge" (default), "radiation", or "zero_flux".
    #[serde(default)]
    pub boundary_mode: Option<String>,
}

pub(crate) fn local_offset_m(center_lat: f64, center_lon: f64, lat: f64, lon: f64) -> (f64, f64) {
    let north_m = (lat - center_lat).to_radians() * R_EARTH_M;
    let delta_lon = (lon - center_lon + 540.0).rem_euclid(360.0) - 180.0;
    let east_m = delta_lon.to_radians() * R_EARTH_M * center_lat.to_radians().cos();
    (east_m, north_m)
}

pub(crate) fn inject_source_initial_field(
    grid: &mut SwGrid,
    req: &SimulateGridRequest,
) -> Result<(), String> {
    // Moving-pressure scenarios generate their wave through momentum forcing;
    // injecting the generic Gaussian as well would double-count the source.
    if req.meteotsunami_forcing.is_some() {
        return Ok(());
    }
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
    pub resolution_preflight: ResolutionPreflight,
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
    /// Opaque handle for a bounded CF-compliant NetCDF artifact retained in
    /// the application cache. Raw numerical arrays never cross IPC.
    pub scientific_export: Option<ScientificExportDescriptor>,
    /// A non-fatal reason why this completed run could not produce NetCDF.
    pub scientific_export_error: Option<String>,
    pub run_quality: RunQualityRecord,
}

/// Hard cap on the SWE grid size — protects us against runaway requests.
pub(crate) const SWE_MAX_CELLS: usize = 4_000_000;
/// Process-wide reservation ceiling for live SWE runs. One maximum-size
/// streaming run remains admissible; a second comparable run is rejected
/// before either grid can double the process working set.
pub(crate) const SWE_MEMORY_BUDGET_BYTES: u64 = 512 * 1024 * 1024;
/// Conservative peak per-cell residency across the f64 host grid,
/// scratch/max-field arrays, f32 GPU ping-pong/readback/upload buffers, packed
/// resident GPU max fields, and one in-flight RGBA/PNG/base64 encoding.
/// Source-level accounting is about 196 bytes before allocator and codec
/// overhead, so admission keeps headroom.
pub(crate) const SWE_CORE_BYTES_PER_CELL: u64 = 208;
/// Retained base64 PNG size per cell for each non-streaming snapshot. Tiled
/// snapshots no longer retain a duplicate full image; raw RGBA encoded as
/// base64 approaches 5.34 bytes/cell before small PNG/container overhead.
pub(crate) const SWE_RETAINED_SNAPSHOT_BYTES_PER_CELL: u64 = 6;
/// Hard cap on total *work* (grid cells × time steps). The cell cap and the
/// step cap are each individually bounded, but their product is what actually
/// determines wall-clock time; without this a request that passes both (e.g.
/// 4 M cells × ~250 k steps) could wedge the blocking worker for many minutes.
/// 5e10 cell-steps is a few seconds of CPU on this solver and far above any
/// legitimate interactive request (a typical run is well under 1e7).
pub(crate) const SWE_MAX_CELL_STEPS: u64 = 50_000_000_000;
/// Hard cap on number of snapshots per simulation.
pub(crate) const SWE_MAX_SNAPSHOTS: usize = 240;
pub(crate) const SWE_MAX_GAUGES: usize = 256;
/// Hard cap on simulated time — runaway scrubs.
pub(crate) const SWE_MAX_T_END_S: f64 = 24.0 * 3600.0;
/// Simple mode stays comfortably below the process-wide hard ceiling so the
/// recommendation leaves room for the renderer and compare workflows.
const SWE_SIMPLE_MEMORY_BUDGET_BYTES: u64 = 256 * 1024 * 1024;
/// Conservative, measured-order runtime proxy used only for a relative
/// preflight estimate. It is deliberately labeled as an estimate in the IPC
/// contract and is not a deadline or performance guarantee.
const SWE_ESTIMATED_CPU_CELL_STEPS_PER_SECOND: f64 = 20_000_000.0;
const SWE_SIMPLE_RUNTIME_BUDGET_S: f64 = 120.0;
const RESOLUTION_TARGET_CELLS_ACROSS_FEATURE: f64 = 16.0;
const RESOLUTION_CANDIDATES: [f64; 19] = [
    3.0, 4.0, 6.0, 8.0, 10.0, 12.0, 16.0, 20.0, 24.0, 32.0, 40.0, 48.0, 64.0, 80.0, 100.0, 120.0,
    140.0, 160.0, 200.0,
];
/// Hard cap on coastal-runup query batch size — protects against IPC flooding.
pub(crate) const RUNUP_MAX_POINTS: usize = 2_000;
/// Hard cap on wavefront sample count.
pub(crate) const WAVEFRONT_MAX_SAMPLES: usize = 2_000;
/// Minimum analytical-basin depth. Below this the solver CFL and celerity
/// become unrepresentative; the solver used to silently clamp requests up to
/// this floor, diverging the simulated depth from the reported one.
pub(crate) const SWE_MIN_MEAN_DEPTH_M: f64 = 50.0;

#[derive(Debug, Clone, Copy)]
pub(crate) struct SimulationGridPlan {
    pub(crate) lat: f64,
    pub(crate) lon: f64,
    pub(crate) south: f64,
    pub(crate) north: f64,
    pub(crate) west: f64,
    pub(crate) east: f64,
    pub(crate) cell_deg: f64,
    pub(crate) nx: usize,
    pub(crate) ny: usize,
    pub(crate) cells: usize,
}

impl SimulationGridPlan {
    pub(crate) fn from_request(req: &SimulateGridRequest) -> Result<Self, String> {
        let cells_per_deg = if req.resolution_mode.as_deref() == Some("simple") {
            build_resolution_preflight(req)?.recommended_cells_per_deg
        } else {
            req.cells_per_deg
        };
        Self::from_request_at_resolution(req, cells_per_deg)
    }

    fn from_request_at_resolution(
        req: &SimulateGridRequest,
        cells_per_deg: f64,
    ) -> Result<Self, String> {
        let lat = req.source.lat_deg.clamp(-90.0, 90.0);
        let lon = ((req.source.lon_deg + 180.0).rem_euclid(360.0)) - 180.0;
        let half = req.box_half_size_deg;
        let cell_deg = 1.0 / cells_per_deg;
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

#[derive(Debug, Clone, Serialize)]
pub struct ResolutionFeature {
    pub id: String,
    pub size_m: f64,
    pub cells_across: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResolutionPreflight {
    pub schema_version: u32,
    pub requested_cells_per_deg: f64,
    pub recommended_cells_per_deg: f64,
    pub selected_cells_per_deg: f64,
    pub simple_auto_selected: bool,
    pub advanced_override: bool,
    pub dx_m: f64,
    pub dy_m: f64,
    pub estimated_dt_s: f64,
    pub nx: u32,
    pub ny: u32,
    pub estimated_steps: u64,
    pub estimated_cell_steps: u64,
    pub estimated_memory_bytes: u64,
    pub estimated_runtime_s: f64,
    pub features: Vec<ResolutionFeature>,
    pub shortest_feature_id: String,
    pub minimum_cells_across_feature: f64,
    /// Numerical-discretization grade calibrated to the 8/16/32 cells-across
    /// ranges exercised by the smooth-wave convergence fixture. This is not a
    /// model-validity, bathymetry-quality, forecast, or operational-use grade.
    pub numerical_grade: String,
    pub limitations: Vec<String>,
}

fn resolution_features(req: &SimulateGridRequest) -> Vec<(&'static str, f64)> {
    let mut features = match &req.source_geometry {
        Some(InitialSourceGeometry::CavityRing {
            rim_radius_m,
            rim_width_m,
        }) => vec![
            ("cavity_rim_radius", *rim_radius_m),
            ("cavity_rim_width", *rim_width_m),
        ],
        Some(InitialSourceGeometry::Landslide {
            longitudinal_sigma_m,
            transverse_sigma_m,
            ..
        }) => vec![
            ("landslide_longitudinal_sigma", *longitudinal_sigma_m),
            ("landslide_transverse_sigma", *transverse_sigma_m),
        ],
        Some(InitialSourceGeometry::Okada { fault }) => vec![
            ("fault_length", fault.length_m),
            ("fault_width", fault.width_m),
        ],
        None => vec![("gaussian_sigma", req.source_sigma_m.max(1_000.0))],
    };
    if let Some(forcing) = req.meteotsunami_forcing {
        features.extend([
            ("pressure_along_track_sigma", forcing.along_track_sigma_m),
            ("pressure_cross_track_sigma", forcing.cross_track_sigma_m),
        ]);
    }
    if req.include_lamb_wave {
        features.push((
            "lamb_wave_source_radius",
            req.lamb_wave_source_radius_m.unwrap_or(30_000.0),
        ));
    }
    features
}

fn physical_cell_spacing_m(plan: &SimulationGridPlan) -> (f64, f64, f64) {
    let dy_m = R_EARTH_M * plan.cell_deg.to_radians();
    let dx_m = dy_m * plan.lat.to_radians().cos().abs().max(1.0e-6);
    let edge_lat = plan.south.abs().max(plan.north.abs()).min(89.999_9);
    let minimum_dx_m = dy_m * edge_lat.to_radians().cos().abs().max(1.0e-6);
    (dx_m, dy_m, minimum_dx_m)
}

fn estimate_resolution_candidate(
    req: &SimulateGridRequest,
    cells_per_deg: f64,
) -> Result<(SimulationGridPlan, f64, u64, u64, f64), String> {
    let plan = SimulationGridPlan::from_request_at_resolution(req, cells_per_deg)?;
    let (_, dy_m, minimum_dx_m) = physical_cell_spacing_m(&plan);
    let conservative_depth_m = if req.use_real_bathymetry {
        11_000.0
    } else {
        req.mean_depth_m.max(SWE_MIN_MEAN_DEPTH_M)
    };
    let dt_s = 0.4 * dy_m.min(minimum_dx_m)
        / (crate::physics::constants::G_EARTH * conservative_depth_m).sqrt();
    let estimated_steps = if req.t_end_s <= 0.0 {
        0
    } else {
        (req.t_end_s / dt_s).ceil().clamp(1.0, u64::MAX as f64) as u64
    };
    let cell_steps = (plan.cells as u64).saturating_mul(estimated_steps);
    let runtime_s = cell_steps as f64 / SWE_ESTIMATED_CPU_CELL_STEPS_PER_SECOND;
    Ok((plan, dt_s, estimated_steps, cell_steps, runtime_s.max(0.01)))
}

pub(crate) fn build_resolution_preflight(
    req: &SimulateGridRequest,
) -> Result<ResolutionPreflight, String> {
    validate_simulate_grid(req)?;
    let declared_features = resolution_features(req);
    let shortest_feature_m = declared_features
        .iter()
        .map(|(_, size_m)| *size_m)
        .fold(f64::INFINITY, f64::min);

    let mut best_affordable = None;
    let mut recommended = None;
    for candidate in RESOLUTION_CANDIDATES {
        let Ok((plan, _, _, cell_steps, runtime_s)) = estimate_resolution_candidate(req, candidate)
        else {
            continue;
        };
        let memory = SimulationMemoryEstimate::for_plan(&plan, 0).estimated_bytes;
        let (_, dy_m, dx_min_m) = physical_cell_spacing_m(&plan);
        let cells_across = shortest_feature_m / dy_m.max(dx_min_m);
        let affordable = memory <= SWE_SIMPLE_MEMORY_BUDGET_BYTES
            && cell_steps <= SWE_MAX_CELL_STEPS
            && runtime_s <= SWE_SIMPLE_RUNTIME_BUDGET_S;
        if affordable {
            best_affordable = Some(candidate);
            if cells_across >= RESOLUTION_TARGET_CELLS_ACROSS_FEATURE {
                recommended = Some(candidate);
                break;
            }
        }
    }
    let recommended_cells_per_deg = recommended.or(best_affordable).ok_or_else(|| {
        "no affordable grid fits the simulation extent and time window".to_string()
    })?;
    let simple_auto_selected = req.resolution_mode.as_deref() == Some("simple");
    let selected_cells_per_deg = if simple_auto_selected {
        recommended_cells_per_deg
    } else {
        req.cells_per_deg
    };
    let advanced_override = req.resolution_mode.as_deref() == Some("advanced")
        && (selected_cells_per_deg - recommended_cells_per_deg).abs() > f64::EPSILON;
    let (plan, estimated_dt_s, estimated_steps, estimated_cell_steps, estimated_runtime_s) =
        estimate_resolution_candidate(req, selected_cells_per_deg)?;
    let memory = SimulationMemoryEstimate::for_plan(&plan, 0).estimated_bytes;
    let (dx_m, dy_m, _) = physical_cell_spacing_m(&plan);
    let limiting_cell_m = dx_m.max(dy_m);
    let features = declared_features
        .into_iter()
        .map(|(id, size_m)| ResolutionFeature {
            id: id.into(),
            size_m,
            cells_across: size_m / limiting_cell_m,
        })
        .collect::<Vec<_>>();
    let shortest = features
        .iter()
        .min_by(|left, right| left.cells_across.total_cmp(&right.cells_across))
        .ok_or_else(|| "resolution preflight has no declared source feature".to_string())?;
    let minimum_cells_across_feature = shortest.cells_across;
    let shortest_feature_id = shortest.id.clone();
    let numerical_grade = if minimum_cells_across_feature >= 32.0 {
        "gci_fine_range"
    } else if minimum_cells_across_feature >= 16.0 {
        "gci_refined_range"
    } else if minimum_cells_across_feature >= 8.0 {
        "gci_baseline_range"
    } else {
        "under_resolved"
    };
    Ok(ResolutionPreflight {
        schema_version: 1,
        requested_cells_per_deg: req.cells_per_deg,
        recommended_cells_per_deg,
        selected_cells_per_deg,
        simple_auto_selected,
        advanced_override,
        dx_m,
        dy_m,
        estimated_dt_s,
        nx: plan.nx.min(u32::MAX as usize) as u32,
        ny: plan.ny.min(u32::MAX as usize) as u32,
        estimated_steps,
        estimated_cell_steps,
        estimated_memory_bytes: memory,
        estimated_runtime_s,
        features,
        shortest_feature_id,
        minimum_cells_across_feature,
        numerical_grade: numerical_grade.into(),
        limitations: vec![
            "The grade is a numerical-resolution comparison with the smooth-wave GCI fixture, not a forecast or operational-fitness rating.".into(),
            "Source, bathymetry, wet/dry-front, and model-form uncertainty are not included.".into(),
            "Runtime is a conservative CPU work estimate; hardware and GPU availability change wall time.".into(),
        ],
    })
}

#[tauri::command]
pub fn preflight_simulation_resolution(
    req: SimulateGridRequest,
) -> Result<ResolutionPreflight, String> {
    build_resolution_preflight(&req)
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct SimulationMemoryEstimate {
    pub(crate) nx: usize,
    pub(crate) ny: usize,
    pub(crate) cells: usize,
    pub(crate) estimated_bytes: u64,
}

impl SimulationMemoryEstimate {
    pub(crate) fn for_plan(plan: &SimulationGridPlan, retained_snapshots: usize) -> Self {
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

pub(crate) fn parse_boundary_mode(
    req: &SimulateGridRequest,
) -> crate::physics::solver::BoundaryMode {
    match req.boundary_mode.as_deref() {
        Some("radiation") => crate::physics::solver::BoundaryMode::Radiation,
        Some("zero_flux") => crate::physics::solver::BoundaryMode::ZeroFlux,
        _ => crate::physics::solver::BoundaryMode::default_sponge(),
    }
}

pub(crate) fn validate_simulate_grid(req: &SimulateGridRequest) -> Result<(), String> {
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
    if !matches!(
        req.resolution_mode.as_deref(),
        None | Some("simple") | Some("advanced")
    ) {
        return Err("resolution_mode must be 'simple' or 'advanced' when provided".into());
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
    if let Some(source) = req.meteotsunami_forcing {
        let values = [
            source.peak_pressure_pa,
            source.speed_m_s,
            source.heading_deg,
            source.along_track_sigma_m,
            source.cross_track_sigma_m,
            source.track_length_m,
            source.water_depth_m,
            source.location.lat_deg,
            source.location.lon_deg,
        ];
        if values.iter().any(|value| !value.is_finite())
            || source.peak_pressure_pa <= 0.0
            || source.peak_pressure_pa > 10_000.0
            || source.speed_m_s <= 0.0
            || source.speed_m_s > 500.0
            || !(0.0..360.0).contains(&source.heading_deg)
            || source.along_track_sigma_m <= 0.0
            || source.along_track_sigma_m > 2.0e6
            || source.cross_track_sigma_m <= 0.0
            || source.cross_track_sigma_m > 2.0e6
            || source.track_length_m <= 0.0
            || source.track_length_m > 1.0e7
            || source.water_depth_m < SWE_MIN_MEAN_DEPTH_M
            || source.water_depth_m > 12_000.0
            || source.location.lat_deg.abs() > 90.0
            || source.location.lon_deg.abs() > LON_ABS_MAX
        {
            return Err("meteotsunami_forcing contains out-of-range source parameters".into());
        }
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

pub(crate) fn populate_grid_bathymetry(
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
