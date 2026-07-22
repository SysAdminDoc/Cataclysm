use super::*;

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
    let resolution_preflight = build_resolution_preflight(&req)?;
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
            let boundary = super::model::parse_boundary_mode(&req);
            let quality_baseline = if req.meteotsunami_forcing.is_some() {
                QualityBaseline::capture_with_external_forcing(&grid, boundary)
            } else {
                QualityBaseline::capture(&grid, boundary)
            };
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
                meteotsunami_forcing: req.meteotsunami_forcing.as_ref(),
                checkpoint: Some(&checkpoint_writer),
                snapshot_interval_offset: start_interval,
                boundary,
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
            let (scientific_export, scientific_export_error) = if cancelled {
                (
                    None,
                    Some("scientific export is unavailable for a cancelled run".to_string()),
                )
            } else {
                let max_field = max_field_acc.borrow();
                let export_context = ScientificExportContext::new(
                    &response_run_id,
                    &req,
                    &grid,
                    &max_field,
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
                resolution_preflight,
                bathymetry_asset_id: req.bathymetry_asset_id.clone(),
                used_gpu,
                n_snapshots: render_stream.frame_count().min(u32::MAX as u64) as u32,
                cancelled,
                max_field: Some(max_field),
                scientific_export,
                scientific_export_error,
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

pub(crate) struct RenderStreamContext<'a> {
    channel: &'a tauri::ipc::Channel<Response>,
    scenario_id: String,
    scenario_sha256: String,
    tick_duration_s: f64,
    next_sequence: Cell<u64>,
    frame_count: Cell<u64>,
    send_error: RefCell<Option<String>>,
}

impl<'a> RenderStreamContext<'a> {
    pub(crate) fn new(
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

    pub(crate) fn send_scenario(
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

    pub(crate) fn send_frame(&self, grid: &SwGrid) -> Result<(), String> {
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

    pub(crate) fn try_send_frame(&self, grid: &SwGrid) -> bool {
        if self.send_error.borrow().is_some() {
            return false;
        }
        if let Err(error) = self.send_frame(grid) {
            *self.send_error.borrow_mut() = Some(error);
            return false;
        }
        true
    }

    pub(crate) fn finish(&self, grid: &SwGrid) -> Result<(), String> {
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

    pub(crate) fn frame_count(&self) -> u64 {
        self.frame_count.get()
    }
}

pub(crate) struct StreamSimulationContext<'a> {
    pub(crate) cancel: &'a AtomicBool,
    pub(crate) on_snapshot: &'a tauri::ipc::Channel<GridSnapshot>,
    pub(crate) diagnostics: Option<&'a DiagnosticSink<'a>>,
    pub(crate) gauges: &'a [GridGaugePoint],
    /// Max-field accumulator, observed after every accepted solver step.
    /// RefCell because the context is shared immutably down the dispatch fns.
    pub(crate) max_field: &'a std::cell::RefCell<MaxFieldAccumulator>,
    pub(crate) render: Option<&'a RenderStreamContext<'a>>,
    pub(crate) quality_baseline: &'a QualityBaseline,
    pub(crate) meteotsunami_forcing: Option<&'a crate::physics::meteotsunami::MeteotsunamiSource>,
    pub(crate) checkpoint: Option<&'a RefCell<StreamCheckpointWriter>>,
    pub(crate) snapshot_interval_offset: usize,
    pub(crate) boundary: crate::physics::solver::BoundaryMode,
}

pub(crate) fn validate_checkpoint_interval(value: Option<u64>) -> Result<Duration, String> {
    let seconds = value.unwrap_or(60);
    if !(15..=3_600).contains(&seconds) {
        return Err("checkpoint_interval_s must be in [15, 3600]".to_string());
    }
    Ok(Duration::from_secs(seconds))
}

pub(crate) struct StreamCheckpointWriter {
    root: PathBuf,
    pub(crate) identity: crate::physics::solver::checkpoint::CheckpointIdentity,
    gauge_points: Vec<GridGaugePoint>,
    gauge_history: Vec<crate::physics::solver::checkpoint::CheckpointGaugeFrame>,
    interval: Duration,
    last_write: Instant,
    disabled: bool,
}

impl StreamCheckpointWriter {
    pub(crate) fn new(
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

    pub(crate) fn record_gauges(&mut self, grid: &SwGrid) {
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

    pub(crate) fn restore_gauge_history(
        &mut self,
        history: Vec<crate::physics::solver::checkpoint::CheckpointGaugeFrame>,
    ) {
        self.gauge_history = history;
    }

    pub(crate) fn maybe_write(
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

    pub(crate) fn remove_completed(&self) {
        let _ = crate::physics::solver::checkpoint::remove(&self.root, &self.identity.run_id);
    }
}

pub(crate) fn checkpoint_gauge_history_for_ipc(
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

pub(crate) fn verify_resume_checkpoint(
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
