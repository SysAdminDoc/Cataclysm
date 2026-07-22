use super::*;

/// Run a real CPU shallow-water-equation simulation. Returns evenly-spaced
/// PNG snapshots ready to drop into Cesium as a `SingleTileImageryProvider`.
/// Runs on a blocking worker so the Cesium and Tauri IPC threads remain
/// responsive during a multi-second simulation.
#[tauri::command]
pub async fn simulate_grid(
    app: AppHandle,
    run_id: String,
    req: SimulateGridRequest,
) -> Result<SimulateGridResponse, String> {
    validate_simulate_grid(&req)?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("application data directory is unavailable: {error}"))?;
    let resolution_preflight = build_resolution_preflight(&req)?;
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
        populate_grid_bathymetry(&mut grid, &req, Some(&app_data_dir))?;
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
        let boundary = super::model::parse_boundary_mode(&req);
        let quality_baseline = if req.meteotsunami_forcing.is_some() {
            QualityBaseline::capture_with_external_forcing(&grid, boundary)
        } else {
            QualityBaseline::capture(&grid, boundary)
        };
        let admission_quality = quality_baseline.assess(&grid, dt);
        if let Some(failure) = &admission_quality.failure {
            publish_run_quality(&admission_quality);
            return Err(format!("simulation rejected by numerical-integrity admission gate: {failure}"));
        }
        let (snapshots, used_gpu, max_field_acc) = run_simulation_dispatch(
            &mut grid,
            dt,
            req.t_end_s,
            req.n_snapshots,
            cancel.as_ref(),
            Some(&diagnostics),
            &req.gauge_points,
            MaxFieldAccumulator::threshold_for_amplitude(req.initial_amplitude_m),
            req.meteotsunami_forcing.as_ref(),
        );
        let run_quality = quality_baseline.assess(&grid, dt);
        publish_run_quality(&run_quality);
        if let Some(failure) = &run_quality.failure {
            diagnostics(&format!("numerical-integrity violation: {failure}"));
            return Err(format!("simulation rejected by numerical-integrity gate: {failure}"));
        }
        let emitted_snapshots = snapshots.len().min(u32::MAX as usize) as u32;
        let cancelled = cancel.load(Ordering::Acquire);
        let (scientific_export, scientific_export_error) = if cancelled {
            (None, Some("scientific export is unavailable for a cancelled run".to_string()))
        } else {
            let export_context = ScientificExportContext::new(
                &response_run_id,
                &req,
                &grid,
                &max_field_acc,
                &run_quality,
                used_gpu,
                &resolution_preflight,
            );
            match create_cached_scientific_export(&app_data_dir, &export_context) {
                Ok(descriptor) => (Some(descriptor), None),
                Err(error) => {
                    diagnostics(&error);
                    (None, Some(error))
                }
            }
        };
        let max_field = Some(max_field_acc.into_product(&grid, Some(&diagnostics)));
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
            resolution_preflight,
            bathymetry_asset_id: req.bathymetry_asset_id.clone(),
            used_gpu,
            max_field,
            scientific_export,
            scientific_export_error,
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
    pub resolution_preflight: ResolutionPreflight,
    pub bathymetry_asset_id: Option<String>,
    pub used_gpu: bool,
    pub n_snapshots: u32,
    pub cancelled: bool,
    /// Max-field products (peak |η|, time of maximum, energy proxy,
    /// arrival isochrones) accumulated at solver-step cadence.
    pub max_field: Option<MaxFieldProduct>,
    pub scientific_export: Option<ScientificExportDescriptor>,
    pub scientific_export_error: Option<String>,
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

#[derive(Debug, Serialize)]
pub struct QuickEtaPreviewResult {
    pub bbox: [f64; 4],
    pub nx: u32,
    pub ny: u32,
    /// Per-cell first-arrival time in seconds. `None` for cells the wave never
    /// reached within the run (serialized as JSON `null`), which keeps the
    /// "never arrived" state distinct from a genuine 0 s arrival at the source.
    pub arrival_s: Vec<Option<f64>>,
    pub elapsed_wall_ms: u64,
}

/// Coarse linear-mode first-arrival solve. Synchronous and side-effect-free so
/// it is unit-testable; the Tauri command wraps it on a blocking worker.
pub(crate) fn compute_quick_eta(
    req: &SimulateGridRequest,
    plan: &SimulationGridPlan,
) -> Result<QuickEtaPreviewResult, String> {
    let start = std::time::Instant::now();
    let coarse_cell_deg = plan.cell_deg * 2.0;
    let mut grid = SwGrid::new(
        plan.west,
        plan.south,
        plan.east,
        plan.north,
        coarse_cell_deg,
        coarse_cell_deg,
    );
    grid.fill_uniform_depth(req.mean_depth_m.max(50.0));
    inject_source_initial_field(&mut grid, req)?;

    let dt = grid.recommended_dt_s(0.4);
    let stepper = TimeStepper::new(dt).with_mode(crate::physics::solver::SolverMode::Linear);
    let n_steps = ((req.t_end_s / dt).ceil() as usize).min(50_000);
    let threshold = MaxFieldAccumulator::threshold_for_amplitude(req.initial_amplitude_m);
    let mut acc = MaxFieldAccumulator::new(grid.nx * grid.ny, threshold);
    // Observe every step so first-arrival times carry the wavefront gradient;
    // arrival resolution equals the observe cadence, and on this coarse
    // (half-resolution, linear) grid a per-step observe is cheap.
    acc.observe(&grid);
    for _ in 0..n_steps {
        stepper.step(&mut grid, 1);
        acc.observe(&grid);
    }

    let [_, _, arrival, _] = acc.scientific_fields();
    Ok(QuickEtaPreviewResult {
        bbox: [plan.west, plan.south, plan.east, plan.north],
        nx: grid.nx as u32,
        ny: grid.ny as u32,
        arrival_s: arrival
            .iter()
            .map(|&t| if t.is_finite() { Some(t) } else { None })
            .collect(),
        elapsed_wall_ms: start.elapsed().as_millis() as u64,
    })
}

#[tauri::command]
pub async fn quick_eta_preview(req: SimulateGridRequest) -> Result<QuickEtaPreviewResult, String> {
    validate_simulate_grid(&req)?;
    let plan = SimulationGridPlan::from_request(&req)?;
    let coarse_cell_deg = plan.cell_deg * 2.0;
    let coarse_nx = ((plan.east - plan.west) / coarse_cell_deg).ceil() as usize;
    let coarse_ny = ((plan.north - plan.south) / coarse_cell_deg).ceil() as usize;
    if coarse_nx.saturating_mul(coarse_ny) > 500_000 {
        return Err("Quick ETA grid too large for preview".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || compute_quick_eta(&req, &plan))
        .await
        .map_err(|e| format!("quick_eta_preview worker failed: {e}"))?
}
