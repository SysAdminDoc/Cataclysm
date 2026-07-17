use super::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FarFieldRequest {
    pub initial_amplitude_m: f64,
    pub cavity_radius_m: f64,
    pub range_m: f64,
    pub mean_depth_m: f64,
    pub decay_alpha: f64,
}

#[derive(Debug, Serialize)]
pub struct FarFieldResponse {
    pub amplitude_m: f64,
    pub travel_time_s: f64,
}

#[tauri::command]
pub fn far_field_amplitude(req: FarFieldRequest) -> Result<FarFieldResponse, String> {
    check_finite("initial_amplitude_m", req.initial_amplitude_m)?;
    if req.initial_amplitude_m.abs() > 1.0e5 {
        return Err("initial_amplitude_m must be ≤ 100 km".into());
    }
    check_finite_positive("cavity_radius_m", req.cavity_radius_m)?;
    if req.cavity_radius_m > 1.0e7 {
        return Err("cavity_radius_m must be ≤ 10 000 km".into());
    }
    check_finite_nonnegative("range_m", req.range_m)?;
    check_finite_nonnegative("mean_depth_m", req.mean_depth_m)?;
    if req.mean_depth_m > 12_000.0 {
        return Err("mean_depth_m must be ≤ 12 000 m".into());
    }
    check_finite("decay_alpha", req.decay_alpha)?;
    if req.decay_alpha < 0.0 || req.decay_alpha > 3.0 {
        return Err("decay_alpha must be in [0, 3]".into());
    }
    let amplitude_m = if req.range_m <= req.cavity_radius_m {
        req.initial_amplitude_m
    } else {
        req.initial_amplitude_m * (req.cavity_radius_m / req.range_m).powf(req.decay_alpha)
    };
    let travel_time_s = long_wave_travel_time_s(req.range_m, req.mean_depth_m);
    Ok(FarFieldResponse {
        amplitude_m,
        travel_time_s,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttenuationCurveRequest {
    pub initial_amplitude_m: f64,
    pub cavity_radius_m: f64,
    pub decay_alpha: f64,
    /// Outer edge of the sampled curve, metres from the source.
    pub max_range_m: f64,
    pub n_samples: u32,
}

#[derive(Debug, Serialize)]
pub struct AttenuationSample {
    pub range_m: f64,
    pub amplitude_m: f64,
}

/// Sample the far-field decay curve `A(r) = A0 * (r_cavity / r)^alpha` at
/// `n_samples` evenly spaced ranges. Uses the same amplitude branch as
/// `far_field_amplitude` so the attenuation chart renders exactly what the
/// solver-side physics computes (chart sampling starts at a 1 km floor so the
/// log-range axis stays readable for very small sources).
#[tauri::command]
pub fn attenuation_curve(req: AttenuationCurveRequest) -> Result<Vec<AttenuationSample>, String> {
    check_finite("initial_amplitude_m", req.initial_amplitude_m)?;
    if req.initial_amplitude_m.abs() > 1.0e5 {
        return Err("initial_amplitude_m must be ≤ 100 km".into());
    }
    check_finite_positive("cavity_radius_m", req.cavity_radius_m)?;
    if req.cavity_radius_m > 1.0e7 {
        return Err("cavity_radius_m must be ≤ 10 000 km".into());
    }
    check_finite("decay_alpha", req.decay_alpha)?;
    if req.decay_alpha < 0.0 || req.decay_alpha > 3.0 {
        return Err("decay_alpha must be in [0, 3]".into());
    }
    check_finite_positive("max_range_m", req.max_range_m)?;
    if req.max_range_m > 4.0e7 {
        return Err("max_range_m must be ≤ 40 000 km".into());
    }
    if req.n_samples < 2 || req.n_samples > 2048 {
        return Err("n_samples must be in [2, 2048]".into());
    }
    let start_range_m = req.cavity_radius_m.max(1_000.0);
    if req.max_range_m <= start_range_m {
        return Err("max_range_m must exceed the curve start range".into());
    }
    let n = req.n_samples as usize;
    let mut samples = Vec::with_capacity(n);
    for i in 0..n {
        let frac = i as f64 / (n - 1) as f64;
        let range_m = start_range_m + frac * (req.max_range_m - start_range_m);
        let amplitude_m = if range_m <= req.cavity_radius_m {
            req.initial_amplitude_m
        } else {
            req.initial_amplitude_m * (req.cavity_radius_m / range_m).powf(req.decay_alpha)
        };
        samples.push(AttenuationSample {
            range_m,
            amplitude_m,
        });
    }
    Ok(samples)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RunupRequest {
    pub offshore_amplitude_m: f64,
    pub offshore_depth_m: f64,
    pub beach_slope_deg: f64,
}

#[tauri::command]
pub fn coastal_runup(req: RunupRequest) -> Result<f64, String> {
    check_finite("offshore_amplitude_m", req.offshore_amplitude_m)?;
    if req.offshore_amplitude_m.abs() > 1.0e5 {
        return Err("offshore_amplitude_m must be ≤ 100 km".into());
    }
    check_finite_positive("offshore_depth_m", req.offshore_depth_m)?;
    if req.offshore_depth_m > 12_000.0 {
        return Err("offshore_depth_m must be ≤ 12 000 m".into());
    }
    check_finite("beach_slope_deg", req.beach_slope_deg)?;
    if req.beach_slope_deg <= 0.0 || req.beach_slope_deg > 90.0 {
        return Err("beach_slope_deg must be in (0, 90]".into());
    }
    Ok(synolakis_runup_m(
        req.offshore_amplitude_m,
        req.offshore_depth_m,
        req.beach_slope_deg,
    ))
}

#[tauri::command]
pub fn list_presets() -> Vec<Preset> {
    all_presets()
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RunPresetRequest {
    pub preset_id: String,
    /// Time, in seconds since the source event, to sample.
    pub time_s: f64,
    /// Mean ocean depth assumption for arrival time, meters.
    pub mean_depth_m: f64,
    /// Number of range samples in the returned wavefront.
    pub n_samples: usize,
}

#[derive(Debug, Serialize)]
pub struct RunPresetResponse {
    pub preset: Preset,
    pub initial: InitialDisplacement,
    pub wavefront: PropagationSnapshot,
}

/// Great-circle distance, meters, between two WGS84 points (Haversine).
/// Clamps `s` to `[0, 1]` so float-precision drift on near-antipodal points
/// doesn't produce NaN from `sqrt(1 - s)` when s slightly exceeds 1.0.
pub(super) fn haversine_m(a_lat: f64, a_lon: f64, b_lat: f64, b_lon: f64) -> f64 {
    if !(a_lat.is_finite() && a_lon.is_finite() && b_lat.is_finite() && b_lon.is_finite()) {
        return 0.0;
    }
    let phi1 = a_lat.to_radians();
    let phi2 = b_lat.to_radians();
    let dphi = (b_lat - a_lat).to_radians();
    let dlmb = (b_lon - a_lon).to_radians();
    let s = ((dphi * 0.5).sin().powi(2) + phi1.cos() * phi2.cos() * (dlmb * 0.5).sin().powi(2))
        .clamp(0.0, 1.0);
    2.0 * R_EARTH_M * s.sqrt().atan2((1.0 - s).sqrt())
}

#[derive(Debug, Deserialize)]
pub struct RunupAtPointsRequest {
    /// Source center (typically the preset's initial displacement center).
    pub source: GeoPoint,
    /// Peak amplitude at the source, meters.
    pub initial_amplitude_m: f64,
    /// Cavity radius at the source, meters (used by both impact + nuclear decay laws).
    pub cavity_radius_m: f64,
    /// True for asteroid impacts (Ward-Asphaug `r^(-5/6)` decay), false for other sources (`r^(-1)`).
    pub is_impact: bool,
    /// Mean ocean depth assumed for travel-time, meters. Pass 4000 for transoceanic.
    pub mean_depth_m: f64,
    /// Time, seconds, at which to sample (only points whose wave has arrived are returned).
    pub time_s: f64,
    /// Stable IDs resolved against the validated bundled coastal database.
    pub point_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct RunupAtPoint {
    pub id: String,
    pub name: String,
    pub lat: f64,
    pub lon: f64,
    pub beach_slope_deg: f64,
    pub offshore_depth_m: f64,
    pub slope_provenance: MeasurementProvenance,
    pub depth_provenance: MeasurementProvenance,
    pub quantitative_confidence: ProvenanceConfidence,
    pub quantitative_label: String,
    pub range_m: f64,
    pub offshore_amplitude_m: f64,
    pub runup_m: f64,
    pub arrival_time_s: f64,
    pub has_arrived: bool,
    /// Inland inundation extent estimate, meters: `runup_m / tan(slope)`.
    /// First-order geometric — assumes a uniform local beach slope and
    /// ignores topographic obstacles. Used by the frontend to render an
    /// inundation polygon (a flat disc) around each named coastal point
    /// at amplitude-appropriate scale (I-V02).
    pub inundation_extent_m: f64,
}

/// For each coastal point, compute the offshore amplitude (far-field decay
/// from the source) and the Synolakis runup at the local beach. Used by the
/// `CoastalRunupOverlay` Cesium component.
#[tauri::command]
pub fn runup_at_points(req: RunupAtPointsRequest) -> Result<Vec<RunupAtPoint>, String> {
    if req.point_ids.len() > RUNUP_MAX_POINTS {
        return Err(format!(
            "too many coastal points ({}); cap is {}",
            req.point_ids.len(),
            RUNUP_MAX_POINTS
        ));
    }
    check_lat_lon_values("source", req.source.lat_deg, req.source.lon_deg)?;
    check_finite("initial_amplitude_m", req.initial_amplitude_m)?;
    if req.initial_amplitude_m.abs() > 1.0e5 {
        return Err("initial_amplitude_m must be ≤ 100 km".into());
    }
    check_finite_positive("cavity_radius_m", req.cavity_radius_m)?;
    if req.cavity_radius_m > 1.0e7 {
        return Err("cavity_radius_m must be ≤ 10 000 km".into());
    }
    check_finite_nonnegative("mean_depth_m", req.mean_depth_m)?;
    if req.mean_depth_m > 12_000.0 {
        return Err("mean_depth_m must be ≤ 12 000 m".into());
    }
    check_finite_nonnegative("time_s", req.time_s)?;
    if req.time_s > SWE_MAX_T_END_S {
        return Err(format!("time_s must be in [0, {}]", SWE_MAX_T_END_S));
    }
    let points = resolve_runup_points(&req.point_ids)?;
    let out = points
        .into_iter()
        .map(|p| {
            let range_m = haversine_m(req.source.lat_deg, req.source.lon_deg, p.lat, p.lon);
            let amp = if req.is_impact {
                impact_far_field(req.initial_amplitude_m, req.cavity_radius_m, range_m)
            } else {
                nuclear_far_field(req.initial_amplitude_m, req.cavity_radius_m, range_m)
            };
            let runup_m = synolakis_runup_m(amp, p.offshore_depth_m, p.beach_slope_deg);
            let c = (G_EARTH * req.mean_depth_m.max(1.0)).sqrt();
            let arrival_time_s = range_m / c;
            // Inland inundation extent: runup_m / tan(beach_slope). For
            // a 0° "reference" point (deep-water gauge) tan(0) → 0 and
            // we'd divide-by-zero; cap at 0 to indicate "no land here".
            let slope_rad = p.beach_slope_deg.to_radians();
            let inundation_extent_m = if slope_rad > 0.0 {
                (runup_m / slope_rad.tan()).clamp(0.0, 50_000.0)
            } else {
                0.0
            };
            let quantitative_confidence = match (
                &p.slope_provenance.record.confidence,
                &p.depth_provenance.record.confidence,
            ) {
                (ProvenanceConfidence::Low, _) | (_, ProvenanceConfidence::Low) => {
                    ProvenanceConfidence::Low
                }
                (ProvenanceConfidence::Medium, _) | (_, ProvenanceConfidence::Medium) => {
                    ProvenanceConfidence::Medium
                }
                _ => ProvenanceConfidence::High,
            };
            let quantitative_label =
                if p.slope_provenance.record.placeholder || p.depth_provenance.record.placeholder {
                    "illustrative"
                } else if quantitative_confidence == ProvenanceConfidence::High {
                    "quantitative"
                } else {
                    "screening_estimate"
                };
            RunupAtPoint {
                id: p.id,
                name: p.name,
                lat: p.lat,
                lon: p.lon,
                beach_slope_deg: p.beach_slope_deg,
                offshore_depth_m: p.offshore_depth_m,
                slope_provenance: p.slope_provenance,
                depth_provenance: p.depth_provenance,
                quantitative_confidence,
                quantitative_label: quantitative_label.into(),
                range_m,
                offshore_amplitude_m: amp,
                runup_m,
                arrival_time_s,
                has_arrived: req.time_s >= arrival_time_s,
                inundation_extent_m,
            }
        })
        .collect();
    Ok(out)
}
