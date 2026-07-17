use super::*;

/// F4-06 — DART RMSE math. Identical series → RMSE 0. Constant
/// offset of K m → RMSE K. Empty series rejected.
#[test]
fn dart_buoy_rmse_basic_math() {
    let obs = vec![(0.0, 0.0), (60.0, 0.5), (120.0, 1.0), (180.0, 0.5)];
    let model_identical = obs.clone();
    let res = dart_buoy_rmse(DartRmseRequest {
        buoy_lat: 30.0,
        buoy_lon: 150.0,
        observations: obs.clone(),
        model_samples: model_identical,
    })
    .expect("identical series must succeed");
    let rmse = res.rmse_m.expect("identical series overlap");
    assert!(
        rmse < 1e-9,
        "identical series RMSE should be 0, got {}",
        rmse
    );
    assert_eq!(res.n_samples, 4);
    assert_eq!(res.overlap_start_s, Some(0.0));
    assert_eq!(res.overlap_end_s, Some(180.0));
    assert_eq!(res.arrival_threshold_m, 0.03);
    assert_eq!(res.noise_floor_m, 0.03);

    let model_offset = vec![(0.0, 0.5), (60.0, 1.0), (120.0, 1.5), (180.0, 1.0)];
    let res2 = dart_buoy_rmse(DartRmseRequest {
        buoy_lat: 30.0,
        buoy_lon: 150.0,
        observations: obs,
        model_samples: model_offset,
    })
    .expect("offset series must succeed");
    let offset_rmse = res2.rmse_m.expect("offset series overlap");
    assert!(
        (offset_rmse - 0.5).abs() < 1e-6,
        "offset-by-0.5 series RMSE should be 0.5, got {}",
        offset_rmse
    );
}

#[test]
fn dart_buoy_rmse_rejects_empty() {
    let res = dart_buoy_rmse(DartRmseRequest {
        buoy_lat: 0.0,
        buoy_lon: 0.0,
        observations: vec![],
        model_samples: vec![(0.0, 0.0)],
    });
    assert!(res.is_err());
}

#[test]
fn dart_buoy_rmse_returns_structured_no_overlap() {
    let res = dart_buoy_rmse(DartRmseRequest {
        buoy_lat: 0.0,
        buoy_lon: 0.0,
        observations: vec![(300.0, 1.0)],
        model_samples: vec![(0.0, 0.0), (60.0, 0.2)],
    })
    .expect("valid disjoint series should return an inspectable comparison");
    assert_eq!(res.rmse_m, None);
    assert_eq!(res.n_samples, 0);
    assert_eq!(res.overlap_start_s, None);
    assert_eq!(res.overlap_end_s, None);
}

#[test]
fn dart_buoy_rmse_filters_nonfinite_model_samples() {
    let res = dart_buoy_rmse(DartRmseRequest {
        buoy_lat: 0.0,
        buoy_lon: 0.0,
        observations: vec![(30.0, 1.0)],
        model_samples: vec![(f64::NAN, 99.0), (0.0, 0.0), (60.0, 2.0)],
    })
    .expect("finite model samples should still be usable");
    assert!(res.rmse_m.expect("finite series overlap") < 1e-9);
}

/// I4-06 — observations outside the model time range must be
/// skipped (not extrapolated). The `obs_peak_m` must still see
/// the out-of-range entry so the caller can tell the model
/// undershoots the observed peak.
#[test]
fn dart_buoy_rmse_skips_out_of_range_obs() {
    let obs = vec![(0.0, 0.0), (60.0, 2.0), (120.0, 0.5), (300.0, 1.5)];
    let model = vec![(0.0, 0.0), (60.0, 1.5), (120.0, 0.5)];
    let res = dart_buoy_rmse(DartRmseRequest {
        buoy_lat: 0.0,
        buoy_lon: 0.0,
        observations: obs,
        model_samples: model,
    })
    .expect("must succeed with partial overlap");
    // Only 3 obs land inside the model time range [0, 120].
    assert_eq!(
        res.n_samples, 3,
        "out-of-range obs at t=300 must be skipped"
    );
    // Observed peak (2.0 at t=60) must register even when not
    // matched to a model sample — but in this case it IS matched.
    assert!((res.observed_peak_m - 2.0).abs() < 1e-9);
    assert!((res.model_peak_m - 1.5).abs() < 1e-9);
}

/// I4-06 — bilinear-in-time interpolation between bracketing
/// model samples. obs at t=30 should sample the model midway
/// between t=0 and t=60.
#[test]
fn dart_buoy_rmse_interpolates_between_samples() {
    let obs = vec![(30.0, 1.0)];
    let model = vec![(0.0, 0.0), (60.0, 2.0)];
    let res = dart_buoy_rmse(DartRmseRequest {
        buoy_lat: 0.0,
        buoy_lon: 0.0,
        observations: obs,
        model_samples: model,
    })
    .expect("must succeed");
    // Model midpoint at t=30 should be 1.0 → identical to obs → RMSE 0.
    let rmse = res.rmse_m.expect("interpolated series overlap");
    assert!(
        rmse < 1e-9,
        "interp midpoint should match obs; got RMSE {}",
        rmse
    );
}

#[test]
fn dart_buoy_rmse_reports_no_arrival_below_declared_threshold() {
    let quiet = vec![(0.0, 0.0), (60.0, 0.02), (120.0, -0.029), (180.0, 0.01)];
    let res = dart_buoy_rmse(DartRmseRequest {
        buoy_lat: 0.0,
        buoy_lon: 0.0,
        observations: quiet.clone(),
        model_samples: quiet,
    })
    .expect("quiet finite series should compare");
    assert_eq!(res.observed_arrival_s, None);
    assert_eq!(res.model_arrival_s, None);
    assert_eq!(res.arrival_residual_s, None);
}

#[test]
fn dart_buoy_rmse_screens_an_early_isolated_artifact() {
    let observations = vec![(0.0, 0.20), (60.0, 0.0), (120.0, 0.04), (180.0, 0.05)];
    let model = vec![(0.0, 0.0), (60.0, 0.0), (120.0, 0.03), (180.0, 0.04)];
    let res = dart_buoy_rmse(DartRmseRequest {
        buoy_lat: 0.0,
        buoy_lon: 0.0,
        observations,
        model_samples: model,
    })
    .expect("artifact fixture should compare");
    assert_eq!(res.observed_arrival_s, Some(120.0));
    assert_eq!(res.model_arrival_s, Some(120.0));
}

#[test]
fn dart_buoy_rmse_derives_known_arrival_residual_from_both_series() {
    let observations = vec![
        (0.0, 0.0),
        (60.0, 0.04),
        (120.0, 0.06),
        (180.0, 0.03),
        (240.0, 0.01),
    ];
    let model = vec![
        (0.0, 0.0),
        (60.0, 0.01),
        (120.0, 0.02),
        (180.0, 0.04),
        (240.0, 0.05),
    ];
    let res = dart_buoy_rmse(DartRmseRequest {
        buoy_lat: 0.0,
        buoy_lon: 0.0,
        observations,
        model_samples: model,
    })
    .expect("known-residual fixture should compare");
    assert_eq!(res.observed_arrival_s, Some(60.0));
    assert_eq!(res.model_arrival_s, Some(180.0));
    assert_eq!(res.arrival_residual_s, Some(120.0));
}

/// I4-06 — invalid buoy location is rejected at the boundary.
#[test]
fn dart_buoy_rmse_rejects_out_of_range_location() {
    let res = dart_buoy_rmse(DartRmseRequest {
        buoy_lat: 95.0,
        buoy_lon: 0.0,
        observations: vec![(0.0, 0.0)],
        model_samples: vec![(0.0, 0.0)],
    });
    assert!(res.is_err(), "lat 95 must be rejected");
}

#[test]
fn inspect_rejects_invalid_depth() {
    let res = inspect_at_point(InspectAtPointRequest {
        source: good_loc(),
        initial_amplitude_m: 1.0,
        cavity_radius_m: 1_000.0,
        is_impact: true,
        mean_depth_m: 4_000.0,
        time_s: 0.0,
        click_lat: 0.0,
        click_lon: 0.0,
        beach_slope_deg: 1.0,
        offshore_depth_m: 0.0,
    });
    assert!(res.is_err());
}

#[test]
fn inspect_rejects_zero_slope() {
    let res = inspect_at_point(InspectAtPointRequest {
        source: good_loc(),
        initial_amplitude_m: 1.0,
        cavity_radius_m: 1_000.0,
        is_impact: true,
        mean_depth_m: 4_000.0,
        time_s: 0.0,
        click_lat: 0.0,
        click_lon: 0.0,
        beach_slope_deg: 0.0,
        offshore_depth_m: 50.0,
    });
    assert!(res.is_err());
}
