use super::*;

fn spec(
    id: SensitivityParameterId,
    lower_factor: f64,
    upper_factor: f64,
) -> SensitivityParameterSpec {
    SensitivityParameterSpec {
        id,
        lower_factor,
        upper_factor,
        bound_basis: "Declared classroom sensitivity range".into(),
        citation_url: "https://www.usgs.gov/example".into(),
    }
}

fn request(parameters: Vec<SensitivityParameterSpec>) -> SensitivityEnsembleRequest {
    SensitivityEnsembleRequest {
        base: source_grid_request(None),
        parameters,
        sample_count: 9,
        seed: 42,
    }
}

#[test]
fn latin_hypercube_is_seeded_bounded_and_stratified() {
    let specs = vec![
        spec(SensitivityParameterId::InitialAmplitude, 0.8, 1.2),
        spec(SensitivityParameterId::SourceWidth, 0.6, 1.4),
    ];
    let first = latin_hypercube_samples(&specs, 9, 42);
    let repeated = latin_hypercube_samples(&specs, 9, 42);
    let changed = latin_hypercube_samples(&specs, 9, 43);
    assert_eq!(first, repeated);
    assert_ne!(first, changed);
    for parameter_index in 0..specs.len() {
        let spec = &specs[parameter_index];
        let mut strata = first
            .iter()
            .map(|member| {
                let factor = member[parameter_index].factor;
                assert!(factor > spec.lower_factor && factor < spec.upper_factor);
                (((factor - spec.lower_factor) / (spec.upper_factor - spec.lower_factor)) * 9.0)
                    .floor() as usize
            })
            .collect::<Vec<_>>();
        strata.sort_unstable();
        assert_eq!(strata, (0..9).collect::<Vec<_>>());
    }
}

#[test]
fn validation_requires_unique_cited_effective_parameters() {
    assert!(
        validate_sensitivity_request(&request(vec![spec(
            SensitivityParameterId::InitialAmplitude,
            0.8,
            1.2,
        )]))
        .is_ok()
    );

    let duplicate = request(vec![
        spec(SensitivityParameterId::InitialAmplitude, 0.8, 1.2),
        spec(SensitivityParameterId::InitialAmplitude, 0.7, 1.3),
    ]);
    assert!(validate_sensitivity_request(&duplicate).is_err());

    let mut uncited = request(vec![spec(SensitivityParameterId::SourceWidth, 0.8, 1.2)]);
    uncited.parameters[0].citation_url = "http://example.test".into();
    assert!(validate_sensitivity_request(&uncited).is_err());

    let mut spatial_depth = request(vec![spec(SensitivityParameterId::MeanDepth, 0.8, 1.2)]);
    spatial_depth.base.use_real_bathymetry = true;
    assert!(validate_sensitivity_request(&spatial_depth).is_err());
}

#[test]
fn parameter_samples_scale_source_specific_inputs() {
    let mut request = source_grid_request(Some(InitialSourceGeometry::CavityRing {
        rim_radius_m: 20_000.0,
        rim_width_m: 5_000.0,
    }));
    apply_parameter_sample(
        &mut request,
        &SensitivityParameterSample {
            id: SensitivityParameterId::InitialAmplitude,
            factor: 1.25,
        },
    );
    apply_parameter_sample(
        &mut request,
        &SensitivityParameterSample {
            id: SensitivityParameterId::SourceWidth,
            factor: 0.5,
        },
    );
    apply_parameter_sample(
        &mut request,
        &SensitivityParameterSample {
            id: SensitivityParameterId::MeanDepth,
            factor: 1.1,
        },
    );
    assert_eq!(request.initial_amplitude_m, 5.0);
    assert_eq!(request.source_sigma_m, 25_000.0);
    assert_eq!(request.mean_depth_m, 4_400.0);
    let Some(InitialSourceGeometry::CavityRing {
        rim_radius_m,
        rim_width_m,
    }) = request.source_geometry
    else {
        panic!("expected cavity ring");
    };
    assert_eq!(rim_radius_m, 10_000.0);
    assert_eq!(rim_width_m, 2_500.0);
}

#[test]
fn percentile_summary_uses_linear_interpolation_and_ignores_non_finite_values() {
    let summary = summarize(vec![1.0, 2.0, 3.0, f64::NAN]);
    assert_eq!(summary.valid_samples, 3);
    assert!((summary.p05.unwrap() - 1.1).abs() < 1.0e-12);
    assert_eq!(summary.p50, Some(2.0));
    assert!((summary.p95.unwrap() - 2.9).abs() < 1.0e-12);
}
