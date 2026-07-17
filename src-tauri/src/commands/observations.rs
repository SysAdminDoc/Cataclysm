use super::*;

#[derive(Debug, Deserialize)]
pub struct DartRmseRequest {
    /// Receiver buoy location.
    pub buoy_lat: f64,
    pub buoy_lon: f64,
    /// Observation series (paired `[t_s, eta_m]` from
    /// `src/data/dart_buoys.json`).
    pub observations: Vec<(f64, f64)>,
    /// Snapshot sequence from `simulate_grid` — each entry carries
    /// its t_s, bbox, and a sparse spatial sample at the buoy (the
    /// caller is expected to extract that via `Cesium`-side bilinear
    /// interp; here we accept the time-series directly).
    pub model_samples: Vec<(f64, f64)>,
}

#[derive(Debug, Serialize)]
pub struct DartRmseResult {
    /// Time-series RMSE in meters over the overlapping window.
    pub rmse_m: Option<f64>,
    /// Number of paired samples used in the RMSE.
    pub n_samples: usize,
    /// Bounds of the time window shared by both finite series.
    pub overlap_start_s: Option<f64>,
    pub overlap_end_s: Option<f64>,
    /// Peak amplitudes from the actual finite input series.
    pub observed_peak_m: f64,
    pub model_peak_m: f64,
    /// NOAA's documented North-Pacific minimum threshold for de-tided DART
    /// residuals, adopted here as the explicit educational noise floor.
    pub noise_floor_m: f64,
    pub noise_method: &'static str,
    /// Arrival is the first of two consecutive absolute samples at or above
    /// this threshold. Requiring confirmation screens isolated artifacts in
    /// these down-sampled historical and solver series.
    pub arrival_threshold_m: f64,
    pub arrival_method: &'static str,
    pub observed_arrival_s: Option<f64>,
    pub model_arrival_s: Option<f64>,
    /// Model arrival minus observed arrival; positive means the model is late.
    pub arrival_residual_s: Option<f64>,
}

const DART_NOISE_FLOOR_M: f64 = 0.03;
const DART_NOISE_METHOD: &str =
    "fixed 0.03 m NOAA DART North-Pacific minimum for de-tided residuals";
const DART_ARRIVAL_METHOD: &str = "first of two consecutive |eta| samples at or above threshold; isolated samples are screened as artifacts";

fn normalize_dart_series(samples: &[(f64, f64)]) -> Vec<(f64, f64)> {
    let mut sorted: Vec<(f64, f64)> = samples
        .iter()
        .copied()
        .filter(|(t, eta)| t.is_finite() && eta.is_finite())
        .collect();
    sorted.sort_by(|a, b| a.0.total_cmp(&b.0));

    let mut normalized: Vec<(f64, f64)> = Vec::with_capacity(sorted.len());
    for sample in sorted {
        if let Some(last) = normalized.last_mut()
            && last.0 == sample.0
        {
            *last = sample;
            continue;
        }
        normalized.push(sample);
    }
    normalized
}

fn interpolate_dart_series(series: &[(f64, f64)], t: f64) -> Option<f64> {
    let first = series.first()?;
    let last = series.last()?;
    if t < first.0 || t > last.0 {
        return None;
    }
    let i = series.partition_point(|sample| sample.0 <= t);
    if i == 0 {
        return Some(first.1);
    }
    if i >= series.len() {
        return Some(last.1);
    }
    let (t0, v0) = series[i - 1];
    let (t1, v1) = series[i];
    let span = t1 - t0;
    if span <= 0.0 {
        return Some(v1);
    }
    Some(v0 + (v1 - v0) * ((t - t0) / span))
}

fn dart_series_peak(series: &[(f64, f64)]) -> f64 {
    series
        .iter()
        .map(|(_, eta)| eta.abs())
        .fold(0.0_f64, f64::max)
}

fn dart_series_arrival(series: &[(f64, f64)], threshold_m: f64) -> Option<f64> {
    series.windows(2).find_map(|pair| {
        let candidate = pair[0].1.abs();
        let confirmation = pair[1].1.abs();
        if candidate >= threshold_m && confirmation >= threshold_m {
            Some(pair[0].0)
        } else {
            None
        }
    })
}

/// F4-06 — compare bundled DART observations with the actual SWE gauge
/// series at one buoy. Rust owns overlap, interpolation, peaks, and the
/// declared threshold-based arrival method so the UI cannot substitute a
/// great-circle travel-time estimate for solver evidence.
#[tauri::command]
pub fn dart_buoy_rmse(req: DartRmseRequest) -> Result<DartRmseResult, String> {
    if !req.buoy_lat.is_finite() || req.buoy_lat.abs() > 90.0 {
        return Err("buoy latitude out of range".into());
    }
    if !req.buoy_lon.is_finite() || req.buoy_lon.abs() > 180.0 {
        return Err("buoy longitude out of range".into());
    }
    if req.observations.len() > 10_000 || req.model_samples.len() > 10_000 {
        return Err("observation / model series exceed 10 000 samples".into());
    }
    if req.observations.is_empty() || req.model_samples.is_empty() {
        return Err("observation and model series must both be non-empty".into());
    }
    let observations = normalize_dart_series(&req.observations);
    let model = normalize_dart_series(&req.model_samples);
    if observations.is_empty() {
        return Err("observation series has no finite samples".into());
    }
    if model.is_empty() {
        return Err("model series has no finite samples".into());
    }

    let observed_peak_m = dart_series_peak(&observations);
    let model_peak_m = dart_series_peak(&model);
    let observed_arrival_s = dart_series_arrival(&observations, DART_NOISE_FLOOR_M);
    let model_arrival_s = dart_series_arrival(&model, DART_NOISE_FLOOR_M);
    let arrival_residual_s = observed_arrival_s
        .zip(model_arrival_s)
        .map(|(observed, model)| model - observed);

    let candidate_start = observations[0].0.max(model[0].0);
    let candidate_end = observations[observations.len() - 1]
        .0
        .min(model[model.len() - 1].0);
    let (overlap_start_s, overlap_end_s) = if candidate_start <= candidate_end {
        (Some(candidate_start), Some(candidate_end))
    } else {
        (None, None)
    };

    let mut sum_sq = 0.0;
    let mut n_samples = 0usize;
    // Preserve observation cadence: interpolate the solver at each actual
    // observation timestamp inside the shared window, never extrapolating.
    if let (Some(start), Some(end)) = (overlap_start_s, overlap_end_s) {
        for &(t, observed_eta) in observations
            .iter()
            .filter(|(t, _)| *t >= start && *t <= end)
        {
            let Some(model_eta) = interpolate_dart_series(&model, t) else {
                continue;
            };
            let residual = model_eta - observed_eta;
            sum_sq += residual * residual;
            n_samples += 1;
        }
    }
    let rmse_m = (n_samples > 0).then(|| (sum_sq / n_samples as f64).sqrt());

    Ok(DartRmseResult {
        rmse_m,
        n_samples,
        overlap_start_s,
        overlap_end_s,
        observed_peak_m,
        model_peak_m,
        noise_floor_m: DART_NOISE_FLOOR_M,
        noise_method: DART_NOISE_METHOD,
        arrival_threshold_m: DART_NOISE_FLOOR_M,
        arrival_method: DART_ARRIVAL_METHOD,
        observed_arrival_s,
        model_arrival_s,
        arrival_residual_s,
    })
}

#[derive(Debug, Deserialize)]
pub struct LambWaveSampleRequest {
    /// Source location of the atmospheric pulse (typically the volcanic
    /// preset's center).
    pub source: GeoPoint,
    /// Receiver location to evaluate η_LW at.
    pub lat: f64,
    pub lon: f64,
    /// Time since source event, seconds.
    pub time_s: f64,
    /// Override the default Hunga-Tonga 200 Pa peak pressure if you
    /// want to simulate a different VEI eruption.
    #[serde(default)]
    pub peak_pressure_pa: Option<f64>,
    #[serde(default)]
    pub source_radius_m: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct LambWaveSampleResult {
    pub range_m: f64,
    pub arrival_time_s: f64,
    pub pressure_pa: f64,
    /// Sea-surface depression in meters at (lat, lon, time_s). Negative
    /// = sea surface down under the high-pressure ring.
    pub surface_depression_m: f64,
    /// Proudman resonance depth (constant for the canonical
    /// `LAMB_WAVE_SPEED_M_S = 310 m/s`). Surfaced for the UI so users
    /// can see why bathymetry near 9.8 km amplifies the signal.
    pub proudman_resonance_depth_m: f64,
    pub lamb_wave_speed_m_s: f64,
}

/// F-V09 — sample the atmospheric Lamb-wave-driven sea-surface
/// elevation contribution at a receiver point for a Hunga-Tonga-class
/// volcanic source.
#[tauri::command]
pub fn lamb_wave_sample(req: LambWaveSampleRequest) -> Result<LambWaveSampleResult, String> {
    check_lat_lon_values("source", req.source.lat_deg, req.source.lon_deg)?;
    check_lat_lon_values("receiver", req.lat, req.lon)?;
    if !req.time_s.is_finite() || req.time_s < 0.0 {
        return Err("time_s must be finite and non-negative".into());
    }
    let mut s = LambWaveSource::hunga_tonga_2022();
    if let Some(p) = req.peak_pressure_pa {
        if !p.is_finite() || p <= 0.0 || p > 1.0e6 {
            return Err("peak_pressure_pa must be finite and in (0, 1 000 000]".into());
        }
        s.peak_pressure_pa = p;
    }
    if let Some(r) = req.source_radius_m {
        if !r.is_finite() || r <= 0.0 || r > 1.0e7 {
            return Err("source_radius_m must be finite and in (0, 10 000 km]".into());
        }
        s.source_radius_m = r;
    }
    let range_m = haversine_m(req.source.lat_deg, req.source.lon_deg, req.lat, req.lon);
    Ok(LambWaveSampleResult {
        range_m,
        arrival_time_s: s.arrival_time_s(range_m),
        pressure_pa: s.pressure_pa(range_m),
        surface_depression_m: s.surface_depression_m(range_m, req.time_s),
        proudman_resonance_depth_m: proudman_resonance_depth_m(),
        lamb_wave_speed_m_s: LAMB_WAVE_SPEED_M_S,
    })
}

#[derive(Debug, Deserialize)]
pub struct InspectAtPointRequest {
    pub source: GeoPoint,
    pub initial_amplitude_m: f64,
    pub cavity_radius_m: f64,
    pub is_impact: bool,
    pub mean_depth_m: f64,
    pub time_s: f64,
    pub click_lat: f64,
    pub click_lon: f64,
    /// Local beach slope at the click point, deg. The frontend supplies a
    /// reasonable default (~1°) when the user hasn't picked a coastal preset.
    pub beach_slope_deg: f64,
    /// Local offshore depth (50 m isobath equivalent) at the click point, m.
    pub offshore_depth_m: f64,
}

#[derive(Debug, Serialize)]
pub struct InspectAtPointResult {
    pub range_m: f64,
    pub offshore_amplitude_m: f64,
    pub runup_m: f64,
    pub arrival_time_s: f64,
    pub has_arrived: bool,
    pub inundation_extent_m: f64,
    pub governing_model: &'static str,
    pub citations: Vec<&'static str>,
    pub assumptions: Vec<String>,
    pub confidence: &'static str,
    pub unknowns: Vec<&'static str>,
}

/// Single-point readout for the F-V11 Inspect overlay. Mirrors the math
/// of `runup_at_points` but for one arbitrary lat/lon picked by the
/// user from the globe.
#[tauri::command]
pub fn inspect_at_point(req: InspectAtPointRequest) -> Result<InspectAtPointResult, String> {
    check_lat_lon_values("source", req.source.lat_deg, req.source.lon_deg)?;
    check_lat_lon_values("click", req.click_lat, req.click_lon)?;
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
    check_finite("beach_slope_deg", req.beach_slope_deg)?;
    if req.beach_slope_deg <= 0.0 || req.beach_slope_deg > 90.0 {
        return Err("beach_slope_deg must be in (0, 90]".into());
    }
    check_finite_positive("offshore_depth_m", req.offshore_depth_m)?;
    if req.offshore_depth_m > 12_000.0 {
        return Err("offshore_depth_m must be ≤ 12 000 m".into());
    }
    let range_m = haversine_m(
        req.source.lat_deg,
        req.source.lon_deg,
        req.click_lat,
        req.click_lon,
    );
    let amp = if req.is_impact {
        impact_far_field(req.initial_amplitude_m, req.cavity_radius_m, range_m)
    } else {
        nuclear_far_field(req.initial_amplitude_m, req.cavity_radius_m, range_m)
    };
    let runup_m = synolakis_runup_m(amp, req.offshore_depth_m, req.beach_slope_deg);
    let c = (G_EARTH * req.mean_depth_m.max(1.0)).sqrt();
    let arrival_time_s = range_m / c;
    let slope_rad = req.beach_slope_deg.to_radians();
    let inundation_extent_m = if slope_rad > 0.0 {
        (runup_m / slope_rad.tan()).clamp(0.0, 50_000.0)
    } else {
        0.0
    };
    Ok(InspectAtPointResult {
        range_m,
        offshore_amplitude_m: amp,
        runup_m,
        arrival_time_s,
        has_arrived: req.time_s >= arrival_time_s,
        inundation_extent_m,
        governing_model: if req.is_impact {
            "impact-far-field + synolakis-runup"
        } else {
            "nuclear-far-field + synolakis-runup"
        },
        citations: vec![
            if req.is_impact {
                "Ward & Asphaug (2000), Asteroid impact tsunami"
            } else {
                "Glasstone & Dolan (1977), The Effects of Nuclear Weapons"
            },
            "Synolakis (1987), The runup of solitary waves",
        ],
        assumptions: vec![
            format!("Uniform mean ocean depth of {:.0} m", req.mean_depth_m),
            format!(
                "Nominal {:.1}° beach slope and {:.0} m offshore depth",
                req.beach_slope_deg, req.offshore_depth_m
            ),
            "Radial far-field attenuation over a spherical-Earth distance".to_string(),
        ],
        confidence: "illustrative",
        unknowns: vec![
            "Local bathymetry, shoreline geometry, reflection, and dispersion are not resolved",
            "An absent or small estimate is not an emergency-safety determination",
        ],
    })
}
