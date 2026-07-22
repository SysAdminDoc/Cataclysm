use super::*;

#[test]
fn cavity_geometry_injects_an_annulus_instead_of_a_centered_bump() {
    let request = source_grid_request(Some(InitialSourceGeometry::CavityRing {
        rim_radius_m: 100_000.0,
        rim_width_m: 15_000.0,
    }));
    let mut grid = SwGrid::new(-2.0, -2.0, 2.0, 2.0, 0.1, 0.1);
    inject_source_initial_field(&mut grid, &request).expect("inject cavity ring");

    let center = grid.eta_m[(grid.ny / 2) * grid.nx + grid.nx / 2];
    let peak = grid.eta_m.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    assert!(peak > 3.5, "annulus must retain the requested rim peak");
    assert!(
        center < peak * 0.05,
        "annulus centre must remain below the rim"
    );
}

#[test]
fn landslide_geometry_injects_directional_positive_and_negative_lobes() {
    let request = source_grid_request(Some(InitialSourceGeometry::Landslide {
        axis_azimuth_deg: 0.0,
        longitudinal_sigma_m: 80_000.0,
        transverse_sigma_m: 20_000.0,
    }));
    let mut grid = SwGrid::new(-2.0, -2.0, 2.0, 2.0, 0.05, 0.05);
    inject_source_initial_field(&mut grid, &request).expect("inject landslide field");

    let peak = grid.eta_m.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let trough = grid.eta_m.iter().copied().fold(f64::INFINITY, f64::min);
    assert!(
        peak > 3.0,
        "slide must preserve its positive displacement lobe"
    );
    assert!(
        trough < -3.0,
        "slide must preserve its negative displacement lobe"
    );
    let east_mid = grid.eta_m[(grid.ny / 2) * grid.nx + (3 * grid.nx / 4)];
    assert!(
        east_mid.abs() < 0.05,
        "cross-axis cells must not form a radial bump"
    );
}

#[test]
fn okada_geometry_injects_uplift_and_subsidence_into_frame_zero() {
    let request = source_grid_request(Some(InitialSourceGeometry::Okada {
        fault: crate::physics::okada::OkadaFault {
            center_lat: 0.0,
            center_lon: 0.0,
            depth_m: 10_000.0,
            length_m: 120_000.0,
            width_m: 60_000.0,
            strike_deg: 20.0,
            dip_deg: 25.0,
            rake_deg: 90.0,
            slip_m: 5.0,
        },
    }));
    let mut grid = SwGrid::new(-2.0, -2.0, 2.0, 2.0, 0.05, 0.05);
    inject_source_initial_field(&mut grid, &request).expect("inject Okada field");

    let peak = grid.eta_m.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let trough = grid.eta_m.iter().copied().fold(f64::INFINITY, f64::min);
    assert!(peak > 0.01, "Okada field must contain uplift");
    assert!(trough < -0.01, "Okada field must contain subsidence");
}

#[test]
fn source_geometry_validation_rejects_degenerate_scales() {
    let request = source_grid_request(Some(InitialSourceGeometry::CavityRing {
        rim_radius_m: 100_000.0,
        rim_width_m: 0.0,
    }));
    assert!(validate_simulate_grid(&request).is_err());
}

#[test]
fn surface_earthquake_geometry_composes_with_grid_validation() {
    let initial = earthquake_initial_conditions(EarthquakeSource {
        mw: 8.0,
        depth_m: 0.0,
        strike_deg: 0.0,
        dip_deg: 30.0,
        rake_deg: 90.0,
        slip_m: 5.0,
        fault_length_m: 100_000.0,
        fault_width_m: 50_000.0,
        water_depth_m: 2_000.0,
        location: good_loc(),
    })
    .expect("the shared earthquake contract permits a surface rupture");
    let mut request = source_grid_request(initial.source_geometry);
    assert!(validate_simulate_grid(&request).is_ok());
    let mut grid = SwGrid::new(-2.0, -2.0, 2.0, 2.0, 0.1, 0.1);
    inject_source_initial_field(&mut grid, &request)
        .expect("a contract-valid surface rupture must produce a finite solver field");

    let Some(InitialSourceGeometry::Okada { fault }) = request.source_geometry.as_mut() else {
        panic!("positive-slip earthquake must produce Okada geometry");
    };
    fault.depth_m = -f64::EPSILON;
    assert!(validate_simulate_grid(&request).is_err());
}

#[test]
fn legacy_grid_requests_deserialize_without_source_geometry() {
    let request = source_grid_request(None);
    let mut value = serde_json::to_value(request).expect("serialize grid request");
    value
        .as_object_mut()
        .expect("request object")
        .remove("source_geometry");
    let decoded: SimulateGridRequest = serde_json::from_value(value).expect("legacy request");
    assert!(decoded.source_geometry.is_none());
}

#[test]
fn simple_resolution_preflight_selects_an_affordable_feature_aware_grid() {
    let mut request = source_grid_request(Some(InitialSourceGeometry::Okada {
        fault: crate::physics::okada::OkadaFault {
            center_lat: 45.0,
            center_lon: 0.0,
            depth_m: 10_000.0,
            length_m: 120_000.0,
            width_m: 40_000.0,
            strike_deg: 0.0,
            dip_deg: 20.0,
            rake_deg: 90.0,
            slip_m: 4.0,
        },
    }));
    request.source.lat_deg = 45.0;
    request.cells_per_deg = 3.0;
    request.resolution_mode = Some("simple".into());
    request.t_end_s = 3_600.0;

    let report = build_resolution_preflight(&request).expect("simple preflight");
    let plan = SimulationGridPlan::from_request(&request).expect("simple grid plan");
    assert!(report.simple_auto_selected);
    assert!(!report.advanced_override);
    assert_eq!(
        report.selected_cells_per_deg,
        report.recommended_cells_per_deg
    );
    assert!(report.selected_cells_per_deg > request.cells_per_deg);
    assert!(report.estimated_memory_bytes <= 256 * 1024 * 1024);
    assert!(report.estimated_cell_steps <= SWE_MAX_CELL_STEPS);
    assert_eq!(plan.nx as u32, report.nx);
    assert_eq!(report.features.len(), 2);
    assert_eq!(report.shortest_feature_id, "fault_width");
    assert!(
        report.dx_m < report.dy_m,
        "longitude cells narrow at 45 degrees"
    );
    assert!(
        report
            .limitations
            .iter()
            .any(|note| note.contains("not a forecast or operational-fitness"))
    );
}

#[test]
fn advanced_resolution_override_is_explicit_and_preserves_requested_grid() {
    let mut request = source_grid_request(None);
    request.cells_per_deg = 4.0;
    request.resolution_mode = Some("advanced".into());
    let report = build_resolution_preflight(&request).expect("advanced preflight");
    let plan = SimulationGridPlan::from_request(&request).expect("advanced grid plan");
    assert!(report.advanced_override);
    assert!(!report.simple_auto_selected);
    assert_eq!(report.selected_cells_per_deg, 4.0);
    assert_eq!(plan.nx, 16);
    assert_eq!(report.numerical_grade, "under_resolved");
}

#[test]
fn simulation_cancellation_is_owned_by_run_id() {
    let run_a = Arc::new(AtomicBool::new(false));
    let run_b = Arc::new(AtomicBool::new(false));
    let negligible = SimulationMemoryEstimate {
        nx: 2,
        ny: 2,
        cells: 4,
        estimated_bytes: 0,
    };
    register_simulation("test-owned-run-a", &run_a, &negligible).expect("register run A");
    register_simulation("test-owned-run-b", &run_b, &negligible).expect("register run B");

    assert!(cancel_simulation("test-owned-run-a".into()).expect("cancel run A"));
    assert!(run_a.load(Ordering::Acquire));
    assert!(!run_b.load(Ordering::Acquire));

    unregister_simulation("test-owned-run-a", &run_a);
    unregister_simulation("test-owned-run-b", &run_b);
    assert!(!cancel_simulation("test-owned-run-a".into()).expect("run A is gone"));
}

#[test]
fn peak_memory_admission_rejects_oversize_and_concurrent_runs() {
    let mut request = source_grid_request(None);
    request.box_half_size_deg = 5.0;
    request.cells_per_deg = 200.0;
    let maximum_plan = SimulationGridPlan::from_request(&request).expect("maximum grid plan");
    let maximum_memory = SimulationMemoryEstimate::for_plan(&maximum_plan, 0);
    assert_eq!(
        (maximum_plan.nx, maximum_plan.ny, maximum_plan.cells),
        (2_000, 2_000, 4_000_000)
    );
    assert!(maximum_memory.estimated_bytes > SWE_MEMORY_BUDGET_BYTES);
    let oversize = Arc::new(AtomicBool::new(false));
    let oversize_error = register_simulation("test-memory-oversize", &oversize, &maximum_memory)
        .expect_err("a single run above the process budget must be rejected");
    assert!(oversize_error.contains("2000×2000"), "{oversize_error}");

    request.cells_per_deg = 160.0;
    let plan = SimulationGridPlan::from_request(&request).expect("concurrent grid plan");
    let memory = SimulationMemoryEstimate::for_plan(&plan, 0);
    let retained = SimulationMemoryEstimate::for_plan(&plan, 60);
    assert_eq!((plan.nx, plan.ny, plan.cells), (1_600, 1_600, 2_560_000));
    assert!(memory.estimated_bytes < SWE_MEMORY_BUDGET_BYTES);
    assert!(memory.estimated_bytes * 2 > SWE_MEMORY_BUDGET_BYTES);
    assert!(retained.estimated_bytes > SWE_MEMORY_BUDGET_BYTES);

    let first = Arc::new(AtomicBool::new(false));
    let second = Arc::new(AtomicBool::new(false));
    register_simulation("test-memory-run-a", &first, &memory).expect("first run admitted");
    let error = register_simulation("test-memory-run-b", &second, &memory)
        .expect_err("second maximum run must exceed the shared budget");
    assert!(error.contains("1600×1600"), "{error}");
    assert!(error.contains("MiB"), "{error}");
    assert!(error.contains("concurrent compare runs"), "{error}");
    unregister_simulation("test-memory-run-a", &first);
}

#[test]
fn simulation_lifecycle_serializes_for_ipc() {
    assert_eq!(
        serde_json::to_value(SimulationRunLifecycle::Completed).expect("serialize lifecycle"),
        serde_json::json!("completed")
    );
    assert_eq!(
        serde_json::to_value(SimulationRunLifecycle::Cancelled).expect("serialize lifecycle"),
        serde_json::json!("cancelled")
    );
}

#[test]
fn simulation_run_ids_reject_unsafe_values() {
    for invalid in ["", "has spaces", "../escape", "line\nbreak"] {
        assert!(validate_run_id(invalid).is_err(), "accepted {invalid:?}");
    }
    assert!(validate_run_id("slot-A_2026-07-11").is_ok());
}

#[test]
fn gpu_stream_fallback_continues_monotonic_snapshot_schedule() {
    // Five 20-step intervals. If the GPU fails seven steps into the
    // second interval, CPU continuation must take only the remaining 13
    // steps before emitting t=40, never restart and re-emit t=0/t=20.
    let total_steps = 100;
    let snapshots = 6;
    let committed_at_failure = 27;
    let completed_in_interval = 7;
    let schedule = snapshot_step_schedule(total_steps as f64, 1.0, snapshots);
    let first_remaining = schedule[1].saturating_sub(completed_in_interval);
    let mut tick = committed_at_failure;
    let mut emitted = Vec::new();
    for (interval, &take) in schedule.iter().enumerate().skip(1) {
        tick += if interval == 1 { first_remaining } else { take };
        emitted.push(tick);
    }
    assert_eq!(emitted, vec![40, 60, 80, 100]);
    assert!(emitted.windows(2).all(|pair| pair[0] < pair[1]));
}

#[test]
fn asteroid_validation_rejects_nan_diameter() {
    let bad = AsteroidImpact {
        diameter_m: f64::NAN,
        density_kg_m3: 3000.0,
        velocity_m_s: 20_000.0,
        angle_deg: 45.0,
        water_depth_m: 4_000.0,
        location: good_loc(),
    };
    assert!(asteroid_initial_conditions(bad).is_err());
}

#[test]
fn asteroid_validation_rejects_zero_velocity() {
    let bad = AsteroidImpact {
        diameter_m: 500.0,
        density_kg_m3: 3000.0,
        velocity_m_s: 0.0,
        angle_deg: 45.0,
        water_depth_m: 4_000.0,
        location: good_loc(),
    };
    assert!(asteroid_initial_conditions(bad).is_err());
}

#[test]
fn asteroid_validation_rejects_out_of_range_angle() {
    let bad = AsteroidImpact {
        diameter_m: 500.0,
        density_kg_m3: 3000.0,
        velocity_m_s: 20_000.0,
        angle_deg: 91.0,
        water_depth_m: 4_000.0,
        location: good_loc(),
    };
    assert!(asteroid_initial_conditions(bad).is_err());
}

#[test]
fn asteroid_validation_accepts_good_input() {
    let good = AsteroidImpact {
        diameter_m: 500.0,
        density_kg_m3: 3000.0,
        velocity_m_s: 20_000.0,
        angle_deg: 45.0,
        water_depth_m: 4_000.0,
        location: good_loc(),
    };
    let d = asteroid_initial_conditions(good).expect("valid input must succeed");
    assert!(d.source_energy_j.is_finite());
    assert!(d.peak_amplitude_m.is_finite());
}

#[test]
fn nuclear_validation_rejects_insane_yield() {
    let bad = NuclearBurst {
        yield_kt: 1.0e9,
        burst_mode: crate::physics::nuclear::BurstMode::DeepOptimal,
        burst_depth_m: 100.0,
        water_depth_m: 4_000.0,
        location: good_loc(),
    };
    assert!(nuclear_initial_conditions(bad).is_err());
}

#[test]
fn landslide_validation_rejects_zero_water_depth() {
    let bad = LandslideSource {
        kind: LandslideKind::Submarine,
        volume_m3: 1.0e9,
        density_kg_m3: 2500.0,
        drop_height_m: 100.0,
        slope_deg: 20.0,
        water_depth_m: 0.0,
        water_body_width_m: 1000.0,
        location: good_loc(),
    };
    assert!(landslide_initial_conditions(bad).is_err());
}

#[test]
fn earthquake_validation_rejects_low_mw() {
    let bad = EarthquakeSource {
        mw: 3.5,
        depth_m: 30_000.0,
        strike_deg: 0.0,
        dip_deg: 30.0,
        rake_deg: 90.0,
        slip_m: 5.0,
        fault_length_m: 0.0,
        fault_width_m: 0.0,
        water_depth_m: 2000.0,
        location: good_loc(),
    };
    assert!(earthquake_initial_conditions(bad).is_err());
}

#[test]
fn earthquake_validation_enforces_angular_bounds() {
    let base = EarthquakeSource {
        mw: 8.0,
        depth_m: 30_000.0,
        strike_deg: 0.0,
        dip_deg: 30.0,
        rake_deg: 90.0,
        slip_m: 5.0,
        fault_length_m: 0.0,
        fault_width_m: 0.0,
        water_depth_m: 2000.0,
        location: good_loc(),
    };
    // Matches the frontend SCENARIO_BOUNDS table.
    assert!(earthquake_initial_conditions(base.clone()).is_ok());
    assert!(
        earthquake_initial_conditions(EarthquakeSource {
            rake_deg: 200.0,
            ..base.clone()
        })
        .is_err()
    );
    assert!(
        earthquake_initial_conditions(EarthquakeSource {
            rake_deg: -200.0,
            ..base.clone()
        })
        .is_err()
    );
    assert!(
        earthquake_initial_conditions(EarthquakeSource {
            strike_deg: 400.0,
            ..base.clone()
        })
        .is_err()
    );
    assert!(
        earthquake_initial_conditions(EarthquakeSource {
            strike_deg: -1.0,
            ..base
        })
        .is_err()
    );
}

#[test]
fn quick_eta_arrival_grows_with_distance_from_source() {
    // A centred Gaussian on uniform depth radiates outward, so first-arrival
    // time must increase monotonically with distance from the source cell.
    let mut request = source_grid_request(None);
    request.source = good_loc();
    request.initial_amplitude_m = 1.0;
    request.source_sigma_m = 40_000.0;
    request.mean_depth_m = 4_000.0;
    request.box_half_size_deg = 6.0;
    request.cells_per_deg = 6.0;
    request.t_end_s = 60.0 * 60.0;
    let plan = SimulationGridPlan::from_request(&request).expect("plan");
    let result = compute_quick_eta(&request, &plan).expect("quick eta");

    assert_eq!(result.arrival_s.len(), (result.nx * result.ny) as usize);
    let nx = result.nx as usize;
    let ny = result.ny as usize;
    let (ci, cj) = (nx / 2, ny / 2);

    // Gather (distance-from-source, arrival) for every propagated cell (t > 0)
    // and confirm a strong positive correlation: the wave arrives later the
    // farther a cell is from the source. This is robust to the coarse grid's
    // exact size and sponge rim, unlike fixed ring radii.
    let mut samples: Vec<(f64, f64)> = Vec::new();
    for j in 0..ny {
        for i in 0..nx {
            if let Some(t) = result.arrival_s[j * nx + i] {
                if t <= 0.0 {
                    continue;
                }
                let d =
                    (((i as f64) - ci as f64).powi(2) + ((j as f64) - cj as f64).powi(2)).sqrt();
                samples.push((d, t));
            }
        }
    }
    assert!(
        samples.len() > 50,
        "the coarse solve must propagate to many cells (got {})",
        samples.len()
    );
    let n = samples.len() as f64;
    let mean_d = samples.iter().map(|s| s.0).sum::<f64>() / n;
    let mean_t = samples.iter().map(|s| s.1).sum::<f64>() / n;
    let cov = samples
        .iter()
        .map(|s| (s.0 - mean_d) * (s.1 - mean_t))
        .sum::<f64>();
    let var_d = samples.iter().map(|s| (s.0 - mean_d).powi(2)).sum::<f64>();
    let var_t = samples.iter().map(|s| (s.1 - mean_t).powi(2)).sum::<f64>();
    let corr = cov / (var_d.sqrt() * var_t.sqrt());
    assert!(
        corr > 0.7,
        "arrival time must grow with distance from the source (corr = {corr:.3})"
    );
}

#[test]
fn quick_eta_marks_unreached_cells_as_none() {
    // A very short run leaves outer cells unreached; those must serialize as
    // `None` (JSON null), never a bogus 0 s or an infinity.
    let mut request = source_grid_request(None);
    request.source = good_loc();
    request.initial_amplitude_m = 1.0;
    request.source_sigma_m = 20_000.0;
    request.mean_depth_m = 4_000.0;
    request.box_half_size_deg = 4.0;
    request.cells_per_deg = 4.0;
    request.t_end_s = 30.0;
    let plan = SimulationGridPlan::from_request(&request).expect("plan");
    let result = compute_quick_eta(&request, &plan).expect("quick eta");
    assert!(
        result.arrival_s.iter().any(|a| a.is_none()),
        "a 30 s run must leave far cells unreached"
    );
    assert!(
        result
            .arrival_s
            .iter()
            .flatten()
            .all(|&t| t.is_finite() && t >= 0.0),
        "reached cells must carry a finite, non-negative arrival time"
    );
}
