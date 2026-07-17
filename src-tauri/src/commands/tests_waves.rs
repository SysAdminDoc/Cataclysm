use super::*;

#[test]
fn run_preset_rejects_unknown_id() {
    let req = RunPresetRequest {
        preset_id: "does-not-exist".to_string(),
        time_s: 1800.0,
        mean_depth_m: 0.0,
        n_samples: 48,
    };
    assert!(run_preset(req).is_err());
}

#[test]
fn run_preset_clamps_huge_n_samples() {
    let req = RunPresetRequest {
        preset_id: "tohoku_2011".to_string(),
        time_s: 1800.0,
        mean_depth_m: 0.0,
        n_samples: 999_999,
    };
    let resp = run_preset(req).expect("preset should resolve");
    // Sample count is clamped at WAVEFRONT_MAX_SAMPLES = 2 000; the
    // function emits a roughly 80/20 split so the returned vector is
    // approximately that many samples (always <= 2 × WAVEFRONT_MAX_SAMPLES).
    assert!(resp.wavefront.ranges_m.len() <= WAVEFRONT_MAX_SAMPLES * 2);
}

#[test]
fn far_field_rejects_nonfinite_ipc_input() {
    let res = far_field_amplitude(FarFieldRequest {
        initial_amplitude_m: f64::NAN,
        cavity_radius_m: 1_000.0,
        range_m: 10_000.0,
        mean_depth_m: 4_000.0,
        decay_alpha: 0.5,
    });
    assert!(res.is_err());
}

#[test]
fn far_field_uses_decay_alpha() {
    let base = FarFieldRequest {
        initial_amplitude_m: 10.0,
        cavity_radius_m: 1_000.0,
        range_m: 10_000.0,
        mean_depth_m: 4_000.0,
        decay_alpha: 5.0 / 6.0,
    };
    let resp_a = far_field_amplitude(base.clone()).unwrap();
    let resp_b = far_field_amplitude(FarFieldRequest {
        decay_alpha: 0.5,
        ..base
    })
    .unwrap();
    assert!(resp_a.amplitude_m < resp_b.amplitude_m);
}

#[test]
fn far_field_rejects_bad_decay_alpha() {
    let res = far_field_amplitude(FarFieldRequest {
        initial_amplitude_m: 10.0,
        cavity_radius_m: 1_000.0,
        range_m: 10_000.0,
        mean_depth_m: 4_000.0,
        decay_alpha: -1.0,
    });
    assert!(res.is_err());
}

#[test]
fn attenuation_curve_endpoints_match_far_field() {
    let curve = attenuation_curve(AttenuationCurveRequest {
        initial_amplitude_m: 4_500.0,
        cavity_radius_m: 50_000.0,
        decay_alpha: 5.0 / 6.0,
        max_range_m: 10_000_000.0,
        n_samples: 80,
    })
    .unwrap();
    assert_eq!(curve.len(), 80);
    let last = curve.last().unwrap();
    let reference = far_field_amplitude(FarFieldRequest {
        initial_amplitude_m: 4_500.0,
        cavity_radius_m: 50_000.0,
        range_m: last.range_m,
        mean_depth_m: 4_000.0,
        decay_alpha: 5.0 / 6.0,
    })
    .unwrap();
    assert!((last.amplitude_m - reference.amplitude_m).abs() < 1.0e-9);
    // First sample sits at the cavity edge → full initial amplitude.
    assert!((curve[0].amplitude_m - 4_500.0).abs() < 1.0e-9);
}

#[test]
fn attenuation_curve_is_monotonically_decreasing() {
    let curve = attenuation_curve(AttenuationCurveRequest {
        initial_amplitude_m: 10.0,
        cavity_radius_m: 2_000.0,
        decay_alpha: 0.5,
        max_range_m: 1_000_000.0,
        n_samples: 64,
    })
    .unwrap();
    for pair in curve.windows(2) {
        assert!(pair[1].amplitude_m <= pair[0].amplitude_m);
    }
}

#[test]
fn attenuation_curve_rejects_bad_inputs() {
    let base = AttenuationCurveRequest {
        initial_amplitude_m: 10.0,
        cavity_radius_m: 2_000.0,
        decay_alpha: 0.5,
        max_range_m: 1_000_000.0,
        n_samples: 64,
    };
    assert!(
        attenuation_curve(AttenuationCurveRequest {
            n_samples: 1,
            ..base.clone()
        })
        .is_err()
    );
    assert!(
        attenuation_curve(AttenuationCurveRequest {
            max_range_m: 500.0,
            ..base.clone()
        })
        .is_err()
    );
    assert!(
        attenuation_curve(AttenuationCurveRequest {
            decay_alpha: f64::NAN,
            ..base
        })
        .is_err()
    );
}

#[test]
fn coastal_runup_rejects_invalid_slope() {
    let res = coastal_runup(RunupRequest {
        offshore_amplitude_m: 1.0,
        offshore_depth_m: 50.0,
        beach_slope_deg: 0.0,
    });
    assert!(res.is_err());
}

#[test]
fn runup_at_points_rejects_bad_point_coordinates() {
    let res = runup_at_points(RunupAtPointsRequest {
        source: good_loc(),
        initial_amplitude_m: 1.0,
        cavity_radius_m: 1_000.0,
        is_impact: true,
        mean_depth_m: 4_000.0,
        time_s: 0.0,
        point_ids: vec!["bad".to_string()],
    });
    assert!(res.is_err());
}

#[test]
fn runup_at_points_rejects_zero_slope() {
    let res = runup_at_points(RunupAtPointsRequest {
        source: good_loc(),
        initial_amplitude_m: 1.0,
        cavity_radius_m: 1_000.0,
        is_impact: true,
        mean_depth_m: 4_000.0,
        time_s: 0.0,
        point_ids: vec!["tohoku_dart_21413".to_string()],
    });
    assert!(res.is_err());
}

#[test]
fn runup_at_points_returns_exact_bundled_provenance() {
    let res = runup_at_points(RunupAtPointsRequest {
        source: good_loc(),
        initial_amplitude_m: 1.0,
        cavity_radius_m: 1_000.0,
        is_impact: true,
        mean_depth_m: 4_000.0,
        time_s: 0.0,
        point_ids: vec!["miyako_jp".to_string()],
    })
    .expect("bundled runup point should resolve");
    assert_eq!(res[0].slope_provenance.sample_id, "miyako_jp:slope");
    assert_eq!(res[0].depth_provenance.sample_id, "miyako_jp:depth");
    assert_eq!(res[0].quantitative_confidence, ProvenanceConfidence::Low);
    assert_eq!(res[0].quantitative_label, "illustrative");
}

#[test]
fn haversine_handles_same_point() {
    assert_eq!(haversine_m(45.0, -75.0, 45.0, -75.0), 0.0);
}

#[test]
fn haversine_handles_nan() {
    // Should not panic; returns 0 as documented.
    assert_eq!(haversine_m(f64::NAN, 0.0, 0.0, 0.0), 0.0);
}
