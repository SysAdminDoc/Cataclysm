use super::*;

const SENSITIVITY_SCHEMA_VERSION: u32 = 1;
const SENSITIVITY_MIN_SAMPLES: usize = 3;
const SENSITIVITY_MAX_SAMPLES: usize = 31;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum SensitivityParameterId {
    InitialAmplitude,
    SourceWidth,
    MeanDepth,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SensitivityParameterSpec {
    pub id: SensitivityParameterId,
    pub lower_factor: f64,
    pub upper_factor: f64,
    pub bound_basis: String,
    pub citation_url: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SensitivityEnsembleRequest {
    pub base: SimulateGridRequest,
    pub parameters: Vec<SensitivityParameterSpec>,
    pub sample_count: usize,
    pub seed: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SensitivityParameterSample {
    pub id: SensitivityParameterId,
    pub factor: f64,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SensitivityMemberStatus {
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct SensitivityMetricValues {
    pub peak_elevation_m: Option<f64>,
    pub arrival_s: Option<f64>,
    pub runup_m: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SensitivityMemberResult {
    pub index: usize,
    pub parameters: Vec<SensitivityParameterSample>,
    pub status: SensitivityMemberStatus,
    pub metrics: SensitivityMetricValues,
    pub used_gpu: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct MetricPercentiles {
    pub p05: Option<f64>,
    pub p50: Option<f64>,
    pub p95: Option<f64>,
    pub valid_samples: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct SensitivityDirectEffects {
    pub applicable: bool,
    pub reason: String,
}

#[derive(Debug, Serialize)]
pub struct SensitivityEnsembleResponse {
    pub schema_version: u32,
    pub run_id: String,
    pub product: String,
    pub seed: u64,
    pub requested_sample_count: usize,
    pub completed_members: usize,
    pub failed_members: usize,
    pub cancelled_members: usize,
    pub parameters: Vec<SensitivityParameterSpec>,
    pub members: Vec<SensitivityMemberResult>,
    pub peak_elevation_m: MetricPercentiles,
    pub arrival_s: MetricPercentiles,
    pub runup_m: MetricPercentiles,
    pub direct_effects: SensitivityDirectEffects,
    pub resolution_preflight: ResolutionPreflight,
    pub caveats: Vec<String>,
}

#[derive(Debug)]
struct MemberMetrics {
    values: SensitivityMetricValues,
    used_gpu: bool,
}

pub(crate) fn validate_sensitivity_request(
    req: &SensitivityEnsembleRequest,
) -> Result<(ResolutionPreflight, SimulationGridPlan), String> {
    validate_simulate_grid(&req.base)?;
    if !(SENSITIVITY_MIN_SAMPLES..=SENSITIVITY_MAX_SAMPLES).contains(&req.sample_count) {
        return Err(format!(
            "sample_count must be in [{SENSITIVITY_MIN_SAMPLES}, {SENSITIVITY_MAX_SAMPLES}]"
        ));
    }
    if !(1..=3).contains(&req.parameters.len()) {
        return Err("select 1-3 sensitivity parameters".into());
    }
    let mut ids = HashSet::new();
    for spec in &req.parameters {
        if !ids.insert(spec.id) {
            return Err("sensitivity parameters must be unique".into());
        }
        if !spec.lower_factor.is_finite()
            || !spec.upper_factor.is_finite()
            || !(0.1..1.0).contains(&spec.lower_factor)
            || !(1.0..=10.0).contains(&spec.upper_factor)
        {
            return Err(
                "each sensitivity bound must be finite with lower_factor in [0.1, 1) and upper_factor in (1, 10]"
                    .into(),
            );
        }
        if spec.bound_basis.trim().len() < 8 {
            return Err("each sensitivity bound requires a descriptive bound_basis".into());
        }
        if !spec.citation_url.starts_with("https://") {
            return Err("each sensitivity bound requires an HTTPS citation_url".into());
        }
        if spec.id == SensitivityParameterId::MeanDepth && req.base.use_real_bathymetry {
            return Err(
                "mean_depth sensitivity is unavailable with spatial bathymetry because the fallback depth does not control wet cells"
                    .into(),
            );
        }
    }

    let preflight = build_resolution_preflight(&req.base)?;
    let plan = SimulationGridPlan::from_request(&req.base)?;
    let depth_work_factor = req
        .parameters
        .iter()
        .find(|spec| spec.id == SensitivityParameterId::MeanDepth)
        .map_or(1.0, |spec| spec.upper_factor.sqrt());
    let aggregate_work =
        (preflight.estimated_cell_steps as f64 * req.sample_count as f64 * depth_work_factor)
            .ceil()
            .min(u64::MAX as f64) as u64;
    if aggregate_work > SWE_MAX_CELL_STEPS {
        return Err(format!(
            "sensitivity ensemble too expensive (~{aggregate_work} aggregate cell-steps; cap {SWE_MAX_CELL_STEPS}). Reduce sample_count, cells_per_deg, box_half_size_deg, or t_end_s."
        ));
    }
    Ok((preflight, plan))
}

fn splitmix64(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9e37_79b9_7f4a_7c15);
    let mut value = *state;
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^ (value >> 31)
}

pub(crate) fn latin_hypercube_samples(
    specs: &[SensitivityParameterSpec],
    sample_count: usize,
    seed: u64,
) -> Vec<Vec<SensitivityParameterSample>> {
    let mut members = vec![Vec::with_capacity(specs.len()); sample_count];
    for (parameter_index, spec) in specs.iter().enumerate() {
        let mut strata = (0..sample_count).collect::<Vec<_>>();
        let mut state = seed
            ^ (parameter_index as u64 + 1).wrapping_mul(0xd1b5_4a32_d192_ed03)
            ^ (sample_count as u64).rotate_left(17);
        for index in (1..sample_count).rev() {
            let selected = (splitmix64(&mut state) % (index as u64 + 1)) as usize;
            strata.swap(index, selected);
        }
        for (member_index, stratum) in strata.into_iter().enumerate() {
            let unit = (stratum as f64 + 0.5) / sample_count as f64;
            members[member_index].push(SensitivityParameterSample {
                id: spec.id,
                factor: spec.lower_factor + unit * (spec.upper_factor - spec.lower_factor),
            });
        }
    }
    members
}

pub(crate) fn apply_parameter_sample(
    req: &mut SimulateGridRequest,
    sample: &SensitivityParameterSample,
) {
    let factor = sample.factor;
    match sample.id {
        SensitivityParameterId::InitialAmplitude => {
            req.initial_amplitude_m *= factor;
            if let Some(InitialSourceGeometry::Okada { fault }) = req.source_geometry.as_mut() {
                fault.slip_m *= factor;
            }
            if let Some(forcing) = req.meteotsunami_forcing.as_mut() {
                forcing.peak_pressure_pa *= factor;
            }
            if req.include_lamb_wave {
                let base_pressure = req.lamb_wave_peak_pressure_pa.unwrap_or(200.0);
                req.lamb_wave_peak_pressure_pa = Some(base_pressure * factor);
            }
        }
        SensitivityParameterId::SourceWidth => {
            req.source_sigma_m *= factor;
            match req.source_geometry.as_mut() {
                Some(InitialSourceGeometry::CavityRing {
                    rim_radius_m,
                    rim_width_m,
                }) => {
                    *rim_radius_m *= factor;
                    *rim_width_m *= factor;
                }
                Some(InitialSourceGeometry::Landslide {
                    longitudinal_sigma_m,
                    transverse_sigma_m,
                    ..
                }) => {
                    *longitudinal_sigma_m *= factor;
                    *transverse_sigma_m *= factor;
                }
                Some(InitialSourceGeometry::Okada { fault }) => {
                    fault.length_m *= factor;
                    fault.width_m *= factor;
                }
                None => {}
            }
            if let Some(forcing) = req.meteotsunami_forcing.as_mut() {
                forcing.along_track_sigma_m *= factor;
                forcing.cross_track_sigma_m *= factor;
            }
            if req.include_lamb_wave {
                let base_radius = req.lamb_wave_source_radius_m.unwrap_or(30_000.0);
                req.lamb_wave_source_radius_m = Some(base_radius * factor);
            }
        }
        SensitivityParameterId::MeanDepth => {
            req.mean_depth_m *= factor;
            if let Some(forcing) = req.meteotsunami_forcing.as_mut() {
                forcing.water_depth_m *= factor;
            }
        }
    }
}

fn apply_lamb_wave_initial_field(
    grid: &mut SwGrid,
    req: &SimulateGridRequest,
    plan: &SimulationGridPlan,
) {
    if !req.include_lamb_wave {
        return;
    }
    let mut lamb = crate::physics::lamb_wave::LambWaveSource::hunga_tonga_2022();
    if let Some(pressure) = req.lamb_wave_peak_pressure_pa {
        lamb.peak_pressure_pa = pressure;
    }
    if let Some(radius) = req.lamb_wave_source_radius_m {
        lamb.source_radius_m = radius;
    }
    grid.apply_lamb_wave(&lamb, plan.lat, plan.lon, 0.0);
}

fn run_sensitivity_member(
    req: &SimulateGridRequest,
    plan: &SimulationGridPlan,
    app_data_dir: &Path,
    cancel: &AtomicBool,
    diagnostics: Option<&DiagnosticSink<'_>>,
) -> Result<MemberMetrics, String> {
    validate_simulate_grid(req)?;
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
    populate_grid_bathymetry(&mut grid, req, Some(app_data_dir))?;
    inject_source_initial_field(&mut grid, req)?;
    apply_lamb_wave_initial_field(&mut grid, req, plan);

    let dt = grid.recommended_dt_s(0.4);
    let estimated_steps = (req.t_end_s / dt).ceil().clamp(1.0, u64::MAX as f64) as u64;
    let work = (plan.cells as u64).saturating_mul(estimated_steps);
    if work > SWE_MAX_CELL_STEPS {
        return Err(format!(
            "ensemble member too expensive (~{work} cell-steps; cap {SWE_MAX_CELL_STEPS})"
        ));
    }
    let boundary = parse_boundary_mode(req);
    let baseline = if req.meteotsunami_forcing.is_some() {
        QualityBaseline::capture_with_external_forcing(&grid, boundary)
    } else {
        QualityBaseline::capture(&grid, boundary)
    };
    let admission = baseline.assess(&grid, dt);
    if let Some(failure) = admission.failure {
        return Err(format!(
            "numerical-integrity admission gate rejected member: {failure}"
        ));
    }
    let (snapshots, used_gpu, accumulator) = run_simulation_dispatch(
        &mut grid,
        dt,
        req.t_end_s,
        2,
        cancel,
        diagnostics,
        &[],
        MaxFieldAccumulator::threshold_for_amplitude(req.initial_amplitude_m),
        req.meteotsunami_forcing.as_ref(),
    );
    drop(snapshots);
    let quality = baseline.assess(&grid, dt);
    publish_run_quality(&quality);
    if let Some(failure) = quality.failure {
        return Err(format!(
            "numerical-integrity gate rejected member: {failure}"
        ));
    }
    let (peak_elevation_m, arrival_s, runup_m) = accumulator.sensitivity_metrics(&grid);
    Ok(MemberMetrics {
        values: SensitivityMetricValues {
            peak_elevation_m: Some(peak_elevation_m),
            arrival_s,
            runup_m,
        },
        used_gpu,
    })
}

fn percentile(values: &[f64], quantile: f64) -> Option<f64> {
    let mut finite = values
        .iter()
        .copied()
        .filter(|value| value.is_finite())
        .collect::<Vec<_>>();
    if finite.is_empty() {
        return None;
    }
    finite.sort_by(f64::total_cmp);
    let position = quantile.clamp(0.0, 1.0) * (finite.len() - 1) as f64;
    let lower = position.floor() as usize;
    let upper = position.ceil() as usize;
    let fraction = position - lower as f64;
    Some(finite[lower] + fraction * (finite[upper] - finite[lower]))
}

pub(crate) fn summarize(values: Vec<f64>) -> MetricPercentiles {
    MetricPercentiles {
        p05: percentile(&values, 0.05),
        p50: percentile(&values, 0.50),
        p95: percentile(&values, 0.95),
        valid_samples: values.iter().filter(|value| value.is_finite()).count(),
    }
}

#[tauri::command]
pub async fn simulate_sensitivity_ensemble(
    app: AppHandle,
    run_id: String,
    req: SensitivityEnsembleRequest,
) -> Result<SensitivityEnsembleResponse, String> {
    let (resolution_preflight, plan) = validate_sensitivity_request(&req)?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("application data directory is unavailable: {error}"))?;
    let memory = SimulationMemoryEstimate::for_plan(&plan, 2);
    let cancel = Arc::new(AtomicBool::new(false));
    register_simulation(&run_id, &cancel, &memory)?;
    let worker_run_id = run_id.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let result = {
            let samples = latin_hypercube_samples(&req.parameters, req.sample_count, req.seed);
            let mut members = Vec::with_capacity(req.sample_count);
            for (index, parameters) in samples.into_iter().enumerate() {
                if cancel.load(Ordering::Acquire) {
                    members.push(SensitivityMemberResult {
                        index,
                        parameters,
                        status: SensitivityMemberStatus::Cancelled,
                        metrics: SensitivityMetricValues::default(),
                        used_gpu: false,
                        error: Some("cancelled before member started".into()),
                    });
                    continue;
                }
                let mut member_request = req.base.clone();
                member_request.cells_per_deg = 1.0 / plan.cell_deg;
                member_request.resolution_mode = Some("advanced".into());
                member_request.n_snapshots = 2;
                for sample in &parameters {
                    apply_parameter_sample(&mut member_request, sample);
                }
                let diagnostics = |message: &str| emit_solver_diagnostic(&app, message);
                match run_sensitivity_member(
                    &member_request,
                    &plan,
                    &app_data_dir,
                    cancel.as_ref(),
                    Some(&diagnostics),
                ) {
                    Ok(metrics) if !cancel.load(Ordering::Acquire) => {
                        members.push(SensitivityMemberResult {
                            index,
                            parameters,
                            status: SensitivityMemberStatus::Completed,
                            metrics: metrics.values,
                            used_gpu: metrics.used_gpu,
                            error: None,
                        });
                    }
                    Ok(_) => members.push(SensitivityMemberResult {
                        index,
                        parameters,
                        status: SensitivityMemberStatus::Cancelled,
                        metrics: SensitivityMetricValues::default(),
                        used_gpu: false,
                        error: Some("cancelled while member was running".into()),
                    }),
                    Err(error) if cancel.load(Ordering::Acquire) => {
                        members.push(SensitivityMemberResult {
                            index,
                            parameters,
                            status: SensitivityMemberStatus::Cancelled,
                            metrics: SensitivityMetricValues::default(),
                            used_gpu: false,
                            error: Some(error),
                        });
                    }
                    Err(error) => members.push(SensitivityMemberResult {
                        index,
                        parameters,
                        status: SensitivityMemberStatus::Failed,
                        metrics: SensitivityMetricValues::default(),
                        used_gpu: false,
                        error: Some(error),
                    }),
                }
            }

            let completed_members = members
                .iter()
                .filter(|member| member.status == SensitivityMemberStatus::Completed)
                .count();
            let failed_members = members
                .iter()
                .filter(|member| member.status == SensitivityMemberStatus::Failed)
                .count();
            let cancelled_members = members
                .iter()
                .filter(|member| member.status == SensitivityMemberStatus::Cancelled)
                .count();
            let metric_values = |select: fn(&SensitivityMetricValues) -> Option<f64>| {
                members
                    .iter()
                    .filter(|member| member.status == SensitivityMemberStatus::Completed)
                    .filter_map(|member| select(&member.metrics))
                    .collect::<Vec<_>>()
            };
            Ok(SensitivityEnsembleResponse {
                schema_version: SENSITIVITY_SCHEMA_VERSION,
                run_id: worker_run_id.clone(),
                product: "sensitivity_envelope_not_probability_or_forecast".into(),
                seed: req.seed,
                requested_sample_count: req.sample_count,
                completed_members,
                failed_members,
                cancelled_members,
                parameters: req.parameters,
                peak_elevation_m: summarize(metric_values(|metrics| metrics.peak_elevation_m)),
                arrival_s: summarize(metric_values(|metrics| metrics.arrival_s)),
                runup_m: summarize(metric_values(|metrics| metrics.runup_m)),
                members,
                direct_effects: SensitivityDirectEffects {
                    applicable: false,
                    reason: "This ensemble evaluates the shallow-water propagation model only; asteroid and nuclear direct-effect engines are outside this run and are not assigned synthetic percentiles."
                        .into(),
                },
                resolution_preflight,
                caveats: vec![
                    "This is a deterministic sensitivity envelope over declared input bounds, not an occurrence probability, confidence interval, forecast, warning, or evacuation product."
                        .into(),
                    "P05/P50/P95 describe the sampled response distribution; the inputs are stratified without probability weights."
                        .into(),
                    "Arrival is the first threshold crossing at the simulation-domain edge. Runup is the maximum resolved surface elevation in wet cells at or shallower than 50 m and is unavailable when the grid has no such cells."
                        .into(),
                    "The grid and solver settings remain fixed across members so input sensitivity is not confounded by automatic resolution changes."
                        .into(),
                ],
            })
        };
        unregister_simulation(&worker_run_id, &cancel);
        result
    })
    .await
    .map_err(|error| format!("sensitivity ensemble worker failed: {error}"))?
}

#[cfg(test)]
mod member_tests {
    use super::*;

    #[test]
    fn completed_member_returns_step_cadence_peak_and_edge_arrival() {
        let request = SimulateGridRequest {
            source: GeoPoint {
                lat_deg: 0.0,
                lon_deg: 0.0,
                depth_m: 4_000.0,
            },
            initial_amplitude_m: 2.0,
            source_sigma_m: 50_000.0,
            source_geometry: None,
            mean_depth_m: 4_000.0,
            use_real_bathymetry: false,
            bathymetry_asset_id: None,
            box_half_size_deg: 0.25,
            cells_per_deg: 4.0,
            resolution_mode: Some("advanced".into()),
            t_end_s: 5.0,
            n_snapshots: 2,
            include_lamb_wave: false,
            lamb_wave_peak_pressure_pa: None,
            lamb_wave_source_radius_m: None,
            meteotsunami_forcing: None,
            colormap: "diverging".into(),
            gauge_points: vec![],
            boundary_mode: None,
        };
        let plan = SimulationGridPlan::from_request(&request).expect("small grid plan");
        let cancel = AtomicBool::new(false);
        let metrics = run_sensitivity_member(
            &request,
            &plan,
            Path::new("."),
            &cancel,
            None,
        )
        .expect("small analytical member");
        assert!(metrics.values.peak_elevation_m.is_some_and(|value| value > 0.0));
        assert!(metrics.values.arrival_s.is_some());
        assert_eq!(metrics.values.runup_m, None);
    }
}
