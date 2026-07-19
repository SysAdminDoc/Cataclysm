use super::*;

#[test]
fn simulate_grid_rejects_bad_lamb_wave_override() {
    let res = validate_simulate_grid(&SimulateGridRequest {
        source: good_loc(),
        initial_amplitude_m: 1.0,
        source_sigma_m: 1_000.0,
        source_geometry: None,
        mean_depth_m: 4_000.0,
        use_real_bathymetry: false,
        bathymetry_asset_id: None,
        box_half_size_deg: 2.0,
        cells_per_deg: 1.0,
        t_end_s: 60.0,
        n_snapshots: 2,
        include_lamb_wave: true,
        lamb_wave_peak_pressure_pa: Some(-1.0),
        lamb_wave_source_radius_m: None,
        meteotsunami_forcing: None,
        colormap: "diverging".to_string(),
        gauge_points: vec![],
        boundary_mode: None,
    });
    assert!(res.is_err());
}

#[test]
fn simulate_grid_validates_moving_pressure_forcing() {
    let source = crate::physics::meteotsunami::MeteotsunamiSource {
        peak_pressure_pa: 300.0,
        speed_m_s: 39.0,
        heading_deg: 90.0,
        along_track_sigma_m: 40_000.0,
        cross_track_sigma_m: 120_000.0,
        track_length_m: 560_000.0,
        water_depth_m: 155.0,
        location: GeoPoint { lat_deg: 47.1, lon_deg: -92.1, depth_m: 155.0 },
    };
    let mut request = source_grid_request(None);
    request.initial_amplitude_m = source.inverted_barometer_amplitude_m();
    request.mean_depth_m = 155.0;
    request.meteotsunami_forcing = Some(source);
    assert!(validate_simulate_grid(&request).is_ok());

    request.meteotsunami_forcing.as_mut().expect("source").speed_m_s = 0.0;
    assert!(validate_simulate_grid(&request).is_err());
}

#[test]
fn simulate_grid_requires_spatial_bathymetry_for_a_local_asset() {
    let mut request = source_grid_request(None);
    request.bathymetry_asset_id = Some(format!("local-bathymetry-{}", "a".repeat(64)));
    let error = validate_simulate_grid(&request).unwrap_err();
    assert!(error.contains("requires use_real_bathymetry=true"));

    request.use_real_bathymetry = true;
    assert!(validate_simulate_grid(&request).is_ok());
    request.bathymetry_asset_id = Some("../depth.tif".into());
    assert!(
        validate_simulate_grid(&request)
            .unwrap_err()
            .contains("invalid")
    );
}

#[test]
fn simulate_grid_requires_at_least_two_snapshots() {
    let mut request = source_grid_request(None);
    request.n_snapshots = 1;
    let error = validate_simulate_grid(&request).expect_err("one snapshot is ambiguous");
    assert!(
        error.contains("[2,"),
        "unexpected validation error: {error}"
    );

    request.n_snapshots = 2;
    assert!(validate_simulate_grid(&request).is_ok());
}

#[test]
fn simulate_grid_rejects_unknown_colormap() {
    let res = validate_simulate_grid(&SimulateGridRequest {
        source: good_loc(),
        initial_amplitude_m: 1.0,
        source_sigma_m: 1_000.0,
        source_geometry: None,
        mean_depth_m: 4_000.0,
        use_real_bathymetry: false,
        bathymetry_asset_id: None,
        box_half_size_deg: 2.0,
        cells_per_deg: 1.0,
        t_end_s: 60.0,
        n_snapshots: 2,
        include_lamb_wave: false,
        lamb_wave_peak_pressure_pa: None,
        lamb_wave_source_radius_m: None,
        meteotsunami_forcing: None,
        colormap: "rainbow".to_string(),
        gauge_points: vec![],
        boundary_mode: None,
    });
    assert!(res.is_err());
}

#[test]
fn simulate_grid_accepts_viridis_colormap() {
    let res = validate_simulate_grid(&SimulateGridRequest {
        source: good_loc(),
        initial_amplitude_m: 1.0,
        source_sigma_m: 1_000.0,
        source_geometry: None,
        mean_depth_m: 4_000.0,
        use_real_bathymetry: false,
        bathymetry_asset_id: None,
        box_half_size_deg: 2.0,
        cells_per_deg: 1.0,
        t_end_s: 60.0,
        n_snapshots: 2,
        include_lamb_wave: false,
        lamb_wave_peak_pressure_pa: None,
        lamb_wave_source_radius_m: None,
        meteotsunami_forcing: None,
        colormap: "viridis".to_string(),
        gauge_points: vec![],
        boundary_mode: None,
    });
    assert!(res.is_ok());
}

#[test]
fn simulate_grid_rejects_sub_floor_analytical_depth() {
    // Below the 50 m floor with the analytical basin: must be rejected, not
    // silently clamped, so the simulated depth equals the reported one.
    let res = validate_simulate_grid(&SimulateGridRequest {
        source: good_loc(),
        initial_amplitude_m: 1.0,
        source_sigma_m: 1_000.0,
        source_geometry: None,
        mean_depth_m: 10.0,
        use_real_bathymetry: false,
        bathymetry_asset_id: None,
        box_half_size_deg: 2.0,
        cells_per_deg: 1.0,
        t_end_s: 60.0,
        n_snapshots: 2,
        include_lamb_wave: false,
        lamb_wave_peak_pressure_pa: None,
        lamb_wave_source_radius_m: None,
        meteotsunami_forcing: None,
        colormap: "viridis".to_string(),
        gauge_points: vec![],
        boundary_mode: None,
    });
    assert!(res.is_err(), "sub-floor analytical depth must be rejected");
    // The same sub-floor depth is fine when real bathymetry drives the basin.
    let ok = validate_simulate_grid(&SimulateGridRequest {
        source: good_loc(),
        initial_amplitude_m: 1.0,
        source_sigma_m: 1_000.0,
        source_geometry: None,
        mean_depth_m: 10.0,
        use_real_bathymetry: true,
        bathymetry_asset_id: None,
        box_half_size_deg: 2.0,
        cells_per_deg: 1.0,
        t_end_s: 60.0,
        n_snapshots: 2,
        include_lamb_wave: false,
        lamb_wave_peak_pressure_pa: None,
        lamb_wave_source_radius_m: None,
        meteotsunami_forcing: None,
        colormap: "viridis".to_string(),
        gauge_points: vec![],
        boundary_mode: None,
    });
    assert!(ok.is_ok());
}

#[test]
fn simulate_grid_tiles_antimeridian_crossing_box() {
    let request = SimulateGridRequest {
        source: GeoPoint {
            lat_deg: 0.0,
            lon_deg: 179.5,
            depth_m: 4_000.0,
        },
        initial_amplitude_m: 1.0,
        source_sigma_m: 1_000.0,
        source_geometry: None,
        mean_depth_m: 4_000.0,
        use_real_bathymetry: false,
        bathymetry_asset_id: None,
        box_half_size_deg: 5.0,
        cells_per_deg: 1.0,
        t_end_s: 60.0,
        n_snapshots: 2,
        include_lamb_wave: false,
        lamb_wave_peak_pressure_pa: None,
        lamb_wave_source_radius_m: None,
        meteotsunami_forcing: None,
        colormap: "viridis".to_string(),
        gauge_points: vec![],
        boundary_mode: None,
    };
    validate_simulate_grid(&request).expect("antimeridian box must be supported");
    let plan = SimulationGridPlan::from_request(&request).unwrap();
    let grid = SwGrid::new(
        plan.west,
        plan.south,
        plan.east,
        plan.north,
        plan.cell_deg,
        plan.cell_deg,
    );
    let tiles = grid.field_tiles().unwrap();
    assert_eq!(tiles.len(), 2);
    assert_eq!(
        tiles.iter().map(|tile| tile.column_count).sum::<u32>(),
        grid.nx as u32
    );
    assert_eq!(tiles[0].bbox[2], 180.0);
    assert_eq!(tiles[1].bbox[0], -180.0);
}

#[test]
fn simulate_grid_tiles_polar_box() {
    let mut request = source_grid_request(None);
    request.source.lat_deg = 88.0;
    request.box_half_size_deg = 20.0;
    validate_simulate_grid(&request).expect("polar box must be supported");
    let plan = SimulationGridPlan::from_request(&request).unwrap();
    assert_eq!(plan.north, 90.0);
    assert!(plan.south <= request.source.lat_deg);
    let grid = SwGrid::new(
        plan.west,
        plan.south,
        plan.east,
        plan.north,
        plan.cell_deg,
        plan.cell_deg,
    );
    assert!(grid.field_tiles().unwrap().len() > 1);
}

#[test]
fn simulate_grid_rejects_bad_gauge_coordinates() {
    let res = validate_simulate_grid(&SimulateGridRequest {
        source: good_loc(),
        initial_amplitude_m: 1.0,
        source_sigma_m: 1_000.0,
        source_geometry: None,
        mean_depth_m: 4_000.0,
        use_real_bathymetry: false,
        bathymetry_asset_id: None,
        box_half_size_deg: 2.0,
        cells_per_deg: 1.0,
        t_end_s: 60.0,
        n_snapshots: 2,
        include_lamb_wave: false,
        lamb_wave_peak_pressure_pa: None,
        lamb_wave_source_radius_m: None,
        meteotsunami_forcing: None,
        colormap: "diverging".to_string(),
        gauge_points: vec![GridGaugePoint {
            id: "bad".to_string(),
            lat_deg: 91.0,
            lon_deg: 0.0,
        }],
        boundary_mode: None,
    });
    assert!(res.is_err());
}

#[test]
fn simulate_grid_rejects_duplicate_gauge_ids() {
    let mut request = source_grid_request(None);
    request.gauge_points = vec![
        GridGaugePoint {
            id: "duplicate".to_string(),
            lat_deg: 0.0,
            lon_deg: 0.0,
        },
        GridGaugePoint {
            id: "duplicate".to_string(),
            lat_deg: 1.0,
            lon_deg: 1.0,
        },
    ];
    assert!(
        validate_simulate_grid(&request)
            .unwrap_err()
            .contains("unique")
    );
}

#[test]
fn checkpoint_interval_defaults_and_bounds_are_explicit() {
    assert_eq!(validate_checkpoint_interval(None).unwrap().as_secs(), 60);
    assert_eq!(
        validate_checkpoint_interval(Some(15)).unwrap().as_secs(),
        15
    );
    assert_eq!(
        validate_checkpoint_interval(Some(3_600)).unwrap().as_secs(),
        3_600
    );
    assert!(validate_checkpoint_interval(Some(14)).is_err());
    assert!(validate_checkpoint_interval(Some(3_601)).is_err());
}

#[test]
fn surface_probe_uses_shared_wet_dry_contract() {
    let ocean = surface_probe(SurfaceProbeRequest {
        lat_deg: 0.0,
        lon_deg: -150.0,
    })
    .unwrap();
    assert!(ocean.is_wet);
    assert_eq!(
        ocean.surface_class,
        crate::data::surface::SurfaceClass::Ocean,
    );
    assert!(ocean.water_depth_m > 3_000.0);

    let land = surface_probe(SurfaceProbeRequest {
        lat_deg: 0.0,
        lon_deg: 20.0,
    })
    .unwrap();
    assert!(!land.is_wet);
    assert_eq!(land.water_depth_m, 0.0);
}

#[test]
fn surface_probe_rejects_nonfinite_and_out_of_domain_coordinates() {
    assert!(
        surface_probe(SurfaceProbeRequest {
            lat_deg: f64::NAN,
            lon_deg: 0.0,
        })
        .is_err()
    );
    assert!(
        surface_probe(SurfaceProbeRequest {
            lat_deg: 91.0,
            lon_deg: 0.0,
        })
        .is_err()
    );
    assert!(
        surface_probe(SurfaceProbeRequest {
            lat_deg: 0.0,
            lon_deg: 181.0,
        })
        .is_err()
    );
}

#[test]
fn diagnostics_publish_geodesy_and_surface_contract_versions() {
    let diagnostics = diagnostics_bundle();
    assert_eq!(diagnostics.geodesy.contract_version, "1.0.0");
    assert_eq!(diagnostics.surface_mask.mask_version, "1.0.0");
    assert_eq!(diagnostics.surface_mask.horizontal_crs, "EPSG:4326");
    assert!(diagnostics.surface_mask.declared_horizontal_error_m > 100_000.0);
    assert_eq!(
        diagnostics.solver_memory_budget_bytes,
        SWE_MEMORY_BUDGET_BYTES
    );
    assert!(diagnostics.solver_reserved_memory_bytes <= SWE_MEMORY_BUDGET_BYTES);
}

#[test]
fn checkpoint_resume_matches_uninterrupted_cpu_run() {
    let mut req = source_grid_request(None);
    req.t_end_s = 120.0;
    req.n_snapshots = 6;
    req.gauge_points = vec![GridGaugePoint {
        id: "golden-gauge".to_string(),
        lat_deg: req.source.lat_deg,
        lon_deg: req.source.lon_deg,
    }];
    let plan = SimulationGridPlan::from_request(&req).unwrap();
    let mut initial = SwGrid::new(
        plan.west,
        plan.south,
        plan.east,
        plan.north,
        plan.cell_deg,
        plan.cell_deg,
    );
    initial.fill_uniform_depth(req.mean_depth_m);
    inject_source_initial_field(&mut initial, &req).unwrap();
    let dt = initial.recommended_dt_s(0.4);
    let schedule = snapshot_step_schedule(req.t_end_s, dt, req.n_snapshots);
    let stepper = TimeStepper::new(dt);
    let threshold = MaxFieldAccumulator::threshold_for_amplitude(req.initial_amplitude_m);

    let mut uninterrupted = initial.clone();
    let mut uninterrupted_max =
        MaxFieldAccumulator::new(uninterrupted.nx * uninterrupted.ny, threshold);
    uninterrupted_max.observe(&uninterrupted);
    let mut uninterrupted_gauges = vec![crate::physics::solver::checkpoint::CheckpointGaugeFrame {
        time_s: uninterrupted.t_s,
        eta_m: uninterrupted.sample_gauge_values(&req.gauge_points),
    }];
    for &steps in &schedule {
        assert!(
            stepper.step_cancellable_observed(&mut uninterrupted, steps, None, &mut |grid| {
                uninterrupted_max.observe(grid)
            },)
        );
        uninterrupted_gauges.push(crate::physics::solver::checkpoint::CheckpointGaugeFrame {
            time_s: uninterrupted.t_s,
            eta_m: uninterrupted.sample_gauge_values(&req.gauge_points),
        });
    }

    let split = 2;
    let mut partial = initial.clone();
    let mut partial_max = MaxFieldAccumulator::new(partial.nx * partial.ny, threshold);
    partial_max.observe(&partial);
    let mut partial_gauges = vec![crate::physics::solver::checkpoint::CheckpointGaugeFrame {
        time_s: partial.t_s,
        eta_m: partial.sample_gauge_values(&req.gauge_points),
    }];
    for &steps in &schedule[..split] {
        assert!(
            stepper.step_cancellable_observed(&mut partial, steps, None, &mut |grid| partial_max
                .observe(grid),)
        );
        partial_gauges.push(crate::physics::solver::checkpoint::CheckpointGaugeFrame {
            time_s: partial.t_s,
            eta_m: partial.sample_gauge_values(&req.gauge_points),
        });
    }
    let root = tempfile::tempdir().unwrap();
    let mut writer = StreamCheckpointWriter::new(
        root.path().to_path_buf(),
        "resume-golden",
        &req,
        dt,
        Duration::from_secs(60),
    )
    .unwrap();
    writer.identity.next_snapshot_interval = split as u32;
    let encoded = crate::physics::solver::checkpoint::encode_state_with_gauges(
        &writer.identity,
        &partial,
        &partial_max,
        &req.gauge_points,
        &partial_gauges,
    )
    .unwrap();
    let restored = crate::physics::solver::checkpoint::decode(&encoded).unwrap();
    verify_resume_checkpoint(
        &restored,
        &writer.identity,
        &req.gauge_points,
        &initial,
        &schedule,
    )
    .unwrap();

    let mut resumed = restored.grid;
    let mut resumed_max = restored.max_field;
    let mut resumed_gauges = restored.gauge_history;
    for &steps in &schedule[split..] {
        assert!(
            stepper.step_cancellable_observed(&mut resumed, steps, None, &mut |grid| resumed_max
                .observe(grid),)
        );
        resumed_gauges.push(crate::physics::solver::checkpoint::CheckpointGaugeFrame {
            time_s: resumed.t_s,
            eta_m: resumed.sample_gauge_values(&req.gauge_points),
        });
    }
    assert_eq!(resumed.step_index, uninterrupted.step_index);
    assert_eq!(resumed.t_s, uninterrupted.t_s);
    assert_eq!(resumed.eta_m, uninterrupted.eta_m);
    assert_eq!(resumed.u_ms, uninterrupted.u_ms);
    assert_eq!(resumed.v_ms, uninterrupted.v_ms);
    assert_eq!(resumed_gauges, uninterrupted_gauges);
    let resumed_product = resumed_max.into_product(&resumed, None);
    let uninterrupted_product = uninterrupted_max.into_product(&uninterrupted, None);
    assert_eq!(
        resumed_product.peak_png_b64,
        uninterrupted_product.peak_png_b64
    );
    assert_eq!(
        resumed_product.t_of_max_png_b64,
        uninterrupted_product.t_of_max_png_b64
    );
    assert_eq!(
        resumed_product.energy_png_b64,
        uninterrupted_product.energy_png_b64
    );
}

#[cfg(feature = "gpu")]
#[test]
fn gpu_quantitative_products_are_independent_of_snapshot_count() {
    use crate::physics::constants::MANNING_N_COASTAL;
    use crate::physics::solver::gpu::GpuTimeStepper;

    type Fields = (Vec<f64>, Vec<f64>, Vec<f64>, Vec<f64>);

    fn run(n_snapshots: usize) -> Option<(usize, u64, f64, Fields)> {
        let mut grid = SwGrid::new(-2.0, -2.0, 2.0, 2.0, 0.5, 0.5);
        grid.fill_uniform_depth(4_000.0);
        grid.inject_gaussian(0.0, 0.0, 1.0, 50_000.0);
        let gpu = GpuTimeStepper::new(&grid, 1.0, MANNING_N_COASTAL, 0, true)?;
        let cancel = AtomicBool::new(false);
        let mut acc = MaxFieldAccumulator::new(grid.nx * grid.ny, 0.01);
        let snapshots = run_simulation_gpu(
            &mut grid,
            &gpu,
            1.0,
            29.0,
            n_snapshots,
            &cancel,
            None,
            &[],
            &mut |state| acc.observe(state),
            None,
        )?;
        let (peak, t_of_max, arrival, energy) = acc.quantitative_fields();
        Some((
            snapshots.len(),
            grid.step_index,
            grid.t_s,
            (
                peak.to_vec(),
                t_of_max.to_vec(),
                arrival.to_vec(),
                energy.to_vec(),
            ),
        ))
    }

    fn assert_same(left: &[f64], right: &[f64]) {
        for (index, (&a, &b)) in left.iter().zip(right).enumerate() {
            let equal_infinity = a.is_infinite() && b.is_infinite() && a.signum() == b.signum();
            assert!(
                equal_infinity || (a - b).abs() <= 1e-9,
                "GPU field cell {index} differs: {a} vs {b}"
            );
        }
    }

    let Some((count_12, steps_12, time_12, fields_12)) = run(12) else {
        println!("gpu cadence regression: no adapter — skipping");
        return;
    };
    let (count_60, steps_60, time_60, fields_60) =
        run(60).expect("adapter disappeared during cadence test");
    let (count_240, steps_240, time_240, fields_240) =
        run(240).expect("adapter disappeared during cadence test");
    assert_eq!((count_12, count_60, count_240), (12, 60, 240));
    assert_eq!((steps_12, steps_60, steps_240), (29, 29, 29));
    assert_eq!((time_12, time_60, time_240), (29.0, 29.0, 29.0));
    assert_same(&fields_12.0, &fields_60.0);
    assert_same(&fields_12.0, &fields_240.0);
    assert_same(&fields_12.1, &fields_60.1);
    assert_same(&fields_12.1, &fields_240.1);
    assert_same(&fields_12.2, &fields_60.2);
    assert_same(&fields_12.2, &fields_240.2);
    assert_same(&fields_12.3, &fields_60.3);
    assert_same(&fields_12.3, &fields_240.3);
}
