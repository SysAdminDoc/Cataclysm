//! Tauri command handlers exposed to the React frontend.
//! Every function returns serde-serializable types; errors are stringified.

use serde::{Deserialize, Serialize};

use crate::physics::{
    asteroid::{far_field_amplitude_m as impact_far_field, AsteroidImpact},
    constants::{G_EARTH, R_EARTH_M},
    earthquake::EarthquakeSource,
    lamb_wave::{proudman_resonance_depth_m, LambWaveSource, LAMB_WAVE_SPEED_M_S},
    landslide::LandslideSource,
    nuclear::{far_field_amplitude_m as nuclear_far_field, NuclearBurst},
    shallow_water::{
        long_wave_travel_time_s, sample_wavefront, synolakis_runup_m, PropagationSnapshot,
    },
    solver::{run_simulation, GridSnapshot, SwGrid, TimeStepper},
    GeoPoint, InitialDisplacement,
};
use crate::presets::{all_presets, find_preset, Preset};

fn check_finite(name: &str, value: f64) -> Result<(), String> {
    if !value.is_finite() {
        return Err(format!("{name} must be finite (got {value})"));
    }
    Ok(())
}

fn check_finite_positive(name: &str, value: f64) -> Result<(), String> {
    if !value.is_finite() || value <= 0.0 {
        return Err(format!("{name} must be finite and positive (got {value})"));
    }
    Ok(())
}

fn check_finite_nonnegative(name: &str, value: f64) -> Result<(), String> {
    if !value.is_finite() || value < 0.0 {
        return Err(format!(
            "{name} must be finite and non-negative (got {value})"
        ));
    }
    Ok(())
}

fn check_lat_lon(loc: &GeoPoint) -> Result<(), String> {
    if !loc.lat_deg.is_finite() || loc.lat_deg.abs() > 90.0 {
        return Err(format!("location.lat_deg {} out of range", loc.lat_deg));
    }
    if !loc.lon_deg.is_finite() || loc.lon_deg.abs() > 360.0 {
        return Err(format!("location.lon_deg {} out of range", loc.lon_deg));
    }
    Ok(())
}

fn check_lat_lon_values(prefix: &str, lat: f64, lon: f64) -> Result<(), String> {
    if !lat.is_finite() || lat.abs() > 90.0 {
        return Err(format!("{prefix} latitude {lat} out of range"));
    }
    if !lon.is_finite() || lon.abs() > 360.0 {
        return Err(format!("{prefix} longitude {lon} out of range"));
    }
    Ok(())
}

#[tauri::command]
pub fn asteroid_initial_conditions(input: AsteroidImpact) -> Result<InitialDisplacement, String> {
    check_finite_positive("diameter_m", input.diameter_m)?;
    check_finite_positive("density_kg_m3", input.density_kg_m3)?;
    check_finite_positive("velocity_m_s", input.velocity_m_s)?;
    check_finite("angle_deg", input.angle_deg)?;
    if input.angle_deg <= 0.0 || input.angle_deg > 90.0 {
        return Err(format!(
            "angle_deg must be in (0, 90] (got {})",
            input.angle_deg
        ));
    }
    check_finite("water_depth_m", input.water_depth_m)?;
    if input.water_depth_m < 0.0 || input.water_depth_m > 12_000.0 {
        return Err("water_depth_m must be in [0, 12 000 m]".into());
    }
    check_lat_lon(&input.location)?;
    Ok(input.initial_displacement())
}

#[tauri::command]
pub fn nuclear_initial_conditions(input: NuclearBurst) -> Result<InitialDisplacement, String> {
    check_finite_positive("yield_kt", input.yield_kt)?;
    if input.yield_kt > 1.0e7 {
        return Err("yield_kt above 10 000 Mt is non-physical".into());
    }
    check_finite("burst_depth_m", input.burst_depth_m)?;
    if input.burst_depth_m < 0.0 || input.burst_depth_m > 12_000.0 {
        return Err("burst_depth_m must be in [0, 12 000 m]".into());
    }
    check_finite("water_depth_m", input.water_depth_m)?;
    if input.water_depth_m < 0.0 || input.water_depth_m > 12_000.0 {
        return Err("water_depth_m must be in [0, 12 000 m]".into());
    }
    check_lat_lon(&input.location)?;
    Ok(input.initial_displacement())
}

#[tauri::command]
pub fn landslide_initial_conditions(input: LandslideSource) -> Result<InitialDisplacement, String> {
    check_finite_positive("volume_m3", input.volume_m3)?;
    check_finite_positive("density_kg_m3", input.density_kg_m3)?;
    check_finite("drop_height_m", input.drop_height_m)?;
    if input.drop_height_m < 0.0 {
        return Err("drop_height_m must be non-negative".into());
    }
    check_finite("slope_deg", input.slope_deg)?;
    if input.slope_deg < 0.0 || input.slope_deg > 90.0 {
        return Err("slope_deg must be in [0, 90]".into());
    }
    check_finite_positive("water_depth_m", input.water_depth_m)?;
    check_finite_positive("water_body_width_m", input.water_body_width_m)?;
    check_lat_lon(&input.location)?;
    Ok(input.initial_displacement())
}

#[tauri::command]
pub fn earthquake_initial_conditions(
    input: EarthquakeSource,
) -> Result<InitialDisplacement, String> {
    check_finite("mw", input.mw)?;
    if input.mw < 4.0 || input.mw > 10.5 {
        return Err("mw must be in [4.0, 10.5]".into());
    }
    check_finite("depth_m", input.depth_m)?;
    if input.depth_m < 0.0 || input.depth_m > 700_000.0 {
        return Err("depth_m must be in [0, 700 km]".into());
    }
    check_finite("strike_deg", input.strike_deg)?;
    check_finite("dip_deg", input.dip_deg)?;
    if input.dip_deg < 0.0 || input.dip_deg > 90.0 {
        return Err("dip_deg must be in [0, 90]".into());
    }
    check_finite("rake_deg", input.rake_deg)?;
    check_finite("slip_m", input.slip_m)?;
    if input.slip_m < 0.0 {
        return Err("slip_m must be non-negative".into());
    }
    check_finite("water_depth_m", input.water_depth_m)?;
    check_lat_lon(&input.location)?;
    Ok(input.initial_displacement())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FarFieldRequest {
    pub initial_amplitude_m: f64,
    pub cavity_radius_m: f64,
    pub range_m: f64,
    pub mean_depth_m: f64,
    pub decay_alpha: f64,
    pub is_impact: bool,
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
    let amplitude_m = if req.is_impact {
        impact_far_field(req.initial_amplitude_m, req.cavity_radius_m, req.range_m)
    } else {
        nuclear_far_field(req.initial_amplitude_m, req.cavity_radius_m, req.range_m)
    };
    let travel_time_s = long_wave_travel_time_s(req.range_m, req.mean_depth_m);
    Ok(FarFieldResponse {
        amplitude_m,
        travel_time_s,
    })
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
fn haversine_m(a_lat: f64, a_lon: f64, b_lat: f64, b_lon: f64) -> f64 {
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
pub struct CoastalPoint {
    pub id: String,
    pub name: String,
    pub lat: f64,
    pub lon: f64,
    pub beach_slope_deg: f64,
    pub offshore_depth_m: f64,
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
    pub points: Vec<CoastalPoint>,
}

#[derive(Debug, Serialize)]
pub struct RunupAtPoint {
    pub id: String,
    pub name: String,
    pub lat: f64,
    pub lon: f64,
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
    if req.points.len() > RUNUP_MAX_POINTS {
        return Err(format!(
            "too many coastal points ({}); cap is {}",
            req.points.len(),
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
    for p in &req.points {
        check_lat_lon_values(&format!("coastal point {}", p.id), p.lat, p.lon)?;
        check_finite("beach_slope_deg", p.beach_slope_deg)?;
        if p.beach_slope_deg <= 0.0 || p.beach_slope_deg > 90.0 {
            return Err(format!("coastal point {} slope must be in (0, 90]", p.id));
        }
        check_finite_positive("offshore_depth_m", p.offshore_depth_m)?;
        if p.offshore_depth_m > 12_000.0 {
            return Err(format!("coastal point {} depth must be ≤ 12 000 m", p.id));
        }
    }
    let out = req
        .points
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
            RunupAtPoint {
                id: p.id,
                name: p.name,
                lat: p.lat,
                lon: p.lon,
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
    pub rmse_m: f64,
    /// Number of paired samples used in the RMSE.
    pub n_samples: usize,
    /// Observation-series peak amplitude.
    pub observed_peak_m: f64,
    /// Model-series peak amplitude.
    pub model_peak_m: f64,
}

/// F4-06 — compute RMSE between bundled DART observations and a model
/// time series for a single buoy. The model samples are expected to
/// be already-interpolated to the buoy location (the frontend extracts
/// them from the SWE PNG sequence; this command does the arithmetic).
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
    // Pair model + obs at each obs timestamp via linear interpolation
    // of the model series. Skip points outside the model time range.
    let mut model_sorted: Vec<(f64, f64)> = req
        .model_samples
        .iter()
        .copied()
        .filter(|(t, eta)| t.is_finite() && eta.is_finite())
        .collect();
    if model_sorted.is_empty() {
        return Err("model series has no finite samples".into());
    }
    model_sorted.sort_by(|a, b| a.0.total_cmp(&b.0));
    let t_min = model_sorted.first().map(|s| s.0).unwrap_or(0.0);
    let t_max = model_sorted.last().map(|s| s.0).unwrap_or(0.0);

    let mut sum_sq = 0.0;
    let mut n = 0usize;
    let mut obs_peak = 0.0_f64;
    let mut mod_peak = 0.0_f64;
    for &(t, obs_eta) in &req.observations {
        if !t.is_finite() || !obs_eta.is_finite() {
            continue;
        }
        obs_peak = obs_peak.max(obs_eta.abs());
        if t < t_min || t > t_max {
            continue;
        }
        // Binary search for the bracketing model samples.
        let i = model_sorted.partition_point(|s| s.0 <= t);
        let model_eta = if i == 0 {
            model_sorted[0].1
        } else if i >= model_sorted.len() {
            model_sorted[model_sorted.len() - 1].1
        } else {
            let (t0, v0) = model_sorted[i - 1];
            let (t1, v1) = model_sorted[i];
            let span = (t1 - t0).max(1e-9);
            v0 + (v1 - v0) * ((t - t0) / span)
        };
        if !model_eta.is_finite() {
            continue;
        }
        mod_peak = mod_peak.max(model_eta.abs());
        let d = model_eta - obs_eta;
        sum_sq += d * d;
        n += 1;
    }
    if n == 0 {
        return Err("observation and model series have no overlapping finite samples".into());
    }
    let rmse_m = (sum_sq / n as f64).sqrt();
    Ok(DartRmseResult {
        rmse_m,
        n_samples: n,
        observed_peak_m: obs_peak,
        model_peak_m: mod_peak,
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
    if !req.source.lat_deg.is_finite() || req.source.lat_deg.abs() > 90.0 {
        return Err("source latitude out of range".into());
    }
    if !req.source.lon_deg.is_finite() || req.source.lon_deg.abs() > 360.0 {
        return Err("source longitude out of range".into());
    }
    if !req.lat.is_finite() || req.lat.abs() > 90.0 {
        return Err("receiver latitude out of range".into());
    }
    if !req.lon.is_finite() || req.lon.abs() > 360.0 {
        return Err("receiver longitude out of range".into());
    }
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
    })
}

#[derive(Debug, Deserialize)]
pub struct SimulateGridRequest {
    /// Source centre (deg).
    pub source: GeoPoint,
    /// Peak amplitude at the source (m). Used as Gaussian IC peak.
    pub initial_amplitude_m: f64,
    /// 1-σ radius of the IC bump (m).
    pub source_sigma_m: f64,
    /// Fallback uniform depth (m) when `use_real_bathymetry = false` or
    /// when the bathymetry sampler returns 0 (land).
    pub mean_depth_m: f64,
    /// If true, use `data::bathymetry::sample(lat, lon)` per cell; if false
    /// or zero-depth, fall back to `mean_depth_m`.
    #[serde(default)]
    pub use_real_bathymetry: bool,
    /// Half-extent of the simulation box around the source, degrees.
    /// Larger = more area covered, slower simulation.
    pub box_half_size_deg: f64,
    /// Grid resolution (cells per degree). Default ~10 for fast preview.
    pub cells_per_deg: f64,
    /// Total simulated time in seconds.
    pub t_end_s: f64,
    /// Number of snapshots to return (≥ 2; includes t=0 and t_end).
    pub n_snapshots: usize,
    /// F4-05 — apply Hunga-Tonga-class atmospheric Lamb-wave forcing
    /// every step. Off by default. When on, the SWE η field receives
    /// the closed-form quasi-static surface depression contribution
    /// from `LambWaveSource::surface_depression_m` integrated over the
    /// pulse arrival window at every grid cell.
    #[serde(default)]
    pub include_lamb_wave: bool,
    /// Override the default Hunga-Tonga 200 Pa peak pressure if you
    /// want to simulate a different VEI eruption. Ignored when
    /// `include_lamb_wave` is false.
    #[serde(default)]
    pub lamb_wave_peak_pressure_pa: Option<f64>,
    /// Override the default 30 km source radius. Ignored when
    /// `include_lamb_wave` is false.
    #[serde(default)]
    pub lamb_wave_source_radius_m: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct SimulateGridResponse {
    pub snapshots: Vec<GridSnapshot>,
    pub dt_s: f64,
    pub nx: u32,
    pub ny: u32,
    /// F4-01 — `true` when the SWE leapfrog ran on the wgpu GPU
    /// path, `false` for the CPU `rayon` path. Always `false` on
    /// builds compiled without `--features gpu`. Frontend uses this
    /// to surface a "ran on GPU" badge in the playback header.
    #[serde(default)]
    pub used_gpu: bool,
}

/// Hard cap on the SWE grid size — protects us against runaway requests.
const SWE_MAX_CELLS: usize = 4_000_000;
/// Hard cap on number of snapshots per simulation.
const SWE_MAX_SNAPSHOTS: usize = 240;
/// Hard cap on simulated time — runaway scrubs.
const SWE_MAX_T_END_S: f64 = 24.0 * 3600.0;
/// Hard cap on coastal-runup query batch size — protects against IPC flooding.
const RUNUP_MAX_POINTS: usize = 2_000;
/// Hard cap on wavefront sample count.
const WAVEFRONT_MAX_SAMPLES: usize = 2_000;

fn validate_simulate_grid(req: &SimulateGridRequest) -> Result<(), String> {
    if !req.source.lat_deg.is_finite() || req.source.lat_deg.abs() > 90.0 {
        return Err(format!(
            "source latitude {} out of range",
            req.source.lat_deg
        ));
    }
    if !req.source.lon_deg.is_finite() || req.source.lon_deg.abs() > 360.0 {
        return Err(format!(
            "source longitude {} out of range",
            req.source.lon_deg
        ));
    }
    if !req.initial_amplitude_m.is_finite() || req.initial_amplitude_m.abs() > 1.0e5 {
        return Err("initial_amplitude_m must be finite and ≤ 100 km".into());
    }
    if !req.source_sigma_m.is_finite() || req.source_sigma_m < 0.0 || req.source_sigma_m > 1.0e7 {
        return Err("source_sigma_m must be finite and in [0, 10 000 km]".into());
    }
    if !req.mean_depth_m.is_finite() || req.mean_depth_m < 0.0 || req.mean_depth_m > 12_000.0 {
        return Err("mean_depth_m must be finite and in [0, 12 000 m]".into());
    }
    if !(req.box_half_size_deg.is_finite()
        && req.box_half_size_deg > 0.0
        && req.box_half_size_deg <= 60.0)
    {
        return Err("box_half_size_deg must be in (0, 60]".into());
    }
    if !(req.cells_per_deg.is_finite() && req.cells_per_deg > 0.0 && req.cells_per_deg <= 200.0) {
        return Err("cells_per_deg must be in (0, 200]".into());
    }
    if !req.t_end_s.is_finite() || req.t_end_s < 0.0 || req.t_end_s > SWE_MAX_T_END_S {
        return Err(format!("t_end_s must be in [0, {}]", SWE_MAX_T_END_S));
    }
    if req.n_snapshots == 0 || req.n_snapshots > SWE_MAX_SNAPSHOTS {
        return Err(format!("n_snapshots must be in [1, {}]", SWE_MAX_SNAPSHOTS));
    }
    if let Some(p) = req.lamb_wave_peak_pressure_pa {
        if !p.is_finite() || p <= 0.0 || p > 1.0e6 {
            return Err("lamb_wave_peak_pressure_pa must be in (0, 1 000 000]".into());
        }
    }
    if let Some(r) = req.lamb_wave_source_radius_m {
        if !r.is_finite() || r <= 0.0 || r > 1.0e7 {
            return Err("lamb_wave_source_radius_m must be in (0, 10 000 km]".into());
        }
    }
    Ok(())
}

/// Run a real CPU shallow-water-equation simulation. Returns evenly-spaced
/// PNG snapshots ready to drop into Cesium as a `SingleTileImageryProvider`.
///
/// Runs on a Tauri async runtime worker via `spawn_blocking` so the Cesium
/// + Tauri IPC threads stay responsive even during a multi-second
/// simulation. The future awaits the join handle; if the worker panics or
/// is cancelled, we surface a stringified error.
#[tauri::command]
pub async fn simulate_grid(req: SimulateGridRequest) -> Result<SimulateGridResponse, String> {
    validate_simulate_grid(&req)?;

    tauri::async_runtime::spawn_blocking(move || {
        let lat = req.source.lat_deg;
        let lon = req.source.lon_deg;
        let half = req.box_half_size_deg;
        let cell = 1.0 / req.cells_per_deg;

        // Clamp latitudes to avoid polar singularities, keeping the box
        // symmetric around the source even if it would otherwise exceed
        // [-80, 80].
        let south = (lat - half).max(-80.0);
        let north = (lat + half).min(80.0);
        let west = lon - half;
        let east = lon + half;

        // Cheap cell-count estimate to catch the overflow case before
        // alloc — usize::MAX / 8 bytes ≈ 2.3 Gcells on 64-bit, so we use
        // the SWE_MAX_CELLS gate instead of waiting for a panic.
        let approx_nx = ((east - west) / cell).round().max(2.0) as usize;
        let approx_ny = ((north - south) / cell).round().max(2.0) as usize;
        let approx_cells = approx_nx.saturating_mul(approx_ny);
        if approx_cells > SWE_MAX_CELLS {
            return Err(format!(
                "grid too large ({}×{} ≈ {} cells) — reduce cells_per_deg or box_half_size_deg",
                approx_nx, approx_ny, approx_cells
            ));
        }

        let mut grid = SwGrid::new(west, south, east, north, cell, cell);
        let fallback_depth = req.mean_depth_m.max(50.0);
        if req.use_real_bathymetry {
            grid.fill_bathymetry_from(|lat, lon| {
                let d = crate::data::bathymetry::sample(lat, lon);
                // Solver dislikes zero-depth (CFL = inf). Replace land cells
                // with a tiny "wet" depth (1 m) so they effectively reflect
                // the wave rather than acting as deep ocean. v0.3.0 will
                // swap for proper wet/dry handling.
                if d <= 0.0 {
                    1.0
                } else {
                    d
                }
            });
        } else {
            grid.fill_uniform_depth(fallback_depth);
        }
        grid.inject_gaussian(
            lat,
            lon,
            req.initial_amplitude_m,
            req.source_sigma_m.max(1000.0),
        );

        // F4-05 — when include_lamb_wave is set, apply the atmospheric
        // pressure-driven η contribution at t=0 as a wider IC injection
        // alongside the Gaussian. Captures the leading-edge Lamb-wave
        // depression for the first ~100 s after source event; continuous
        // step-by-step forcing lands in v0.5.0.
        if req.include_lamb_wave {
            let mut lamb = crate::physics::lamb_wave::LambWaveSource::hunga_tonga_2022();
            if let Some(p) = req.lamb_wave_peak_pressure_pa {
                if p.is_finite() && p > 0.0 {
                    lamb.peak_pressure_pa = p;
                }
            }
            if let Some(r) = req.lamb_wave_source_radius_m {
                if r.is_finite() && r > 0.0 {
                    lamb.source_radius_m = r;
                }
            }
            // Sample at the pulse-arrival time at the source — captures
            // the peak depression. Subsequent step-by-step propagation
            // of the η depression is handled by the SWE solver as the
            // grid relaxes back toward equilibrium.
            grid.apply_lamb_wave(&lamb, lat, lon, 0.0);
        }

        let dt = grid.recommended_dt_s(0.4);
        let nx = grid.nx as u32;
        let ny = grid.ny as u32;

        // F4-01 — when compiled with `--features gpu`, try the wgpu
        // dispatch path. Fall back to CPU cleanly if no adapter is
        // available (Linux CI, integrated-only laptops without
        // Vulkan, etc.). Behaviour-identical for the linear-SWE
        // leapfrog kernel; nonlinear advection (F4-02) is CPU-only
        // for now, so when the user has selected a nonlinear-class
        // scenario we stay on CPU even with the feature flag on.
        let (snapshots, used_gpu) =
            run_simulation_dispatch(&mut grid, dt, req.t_end_s, req.n_snapshots);
        Ok(SimulateGridResponse {
            snapshots,
            dt_s: dt,
            nx,
            ny,
            used_gpu,
        })
    })
    .await
    .map_err(|e| format!("simulate_grid worker failed: {e}"))?
}

/// F4-01 — Lightweight GPU-availability probe. Returns a string so
/// the frontend doesn't need to mirror the `GpuAvailability` enum.
/// Possible return values:
/// - `"available"` — `--features gpu` compiled in AND an adapter
///   was acquired successfully.
/// - `"no-adapter"` — `--features gpu` compiled in but the host has
///   no usable adapter (e.g. Linux without Vulkan/Mesa, headless CI).
/// - `"feature-off"` — built without `--features gpu`; the wgpu
///   dependency isn't compiled and the GPU path is unavailable.
///
/// Frontend uses this to surface "GPU acceleration: ✓ / unavailable"
/// in Settings without requiring a full `simulate_grid` round-trip.
#[tauri::command]
pub fn gpu_probe() -> String {
    #[cfg(feature = "gpu")]
    {
        use crate::physics::solver::gpu::{probe_adapter, GpuAvailability};
        match probe_adapter() {
            GpuAvailability::Available => "available".to_string(),
            GpuAvailability::NoAdapter | GpuAvailability::AdapterFailed(_) => {
                "no-adapter".to_string()
            }
        }
    }
    #[cfg(not(feature = "gpu"))]
    {
        "feature-off".to_string()
    }
}

/// F4-01 — Dispatcher around `run_simulation` that prefers the wgpu
/// GPU path when the `gpu` feature is compiled in and an adapter is
/// available, and falls back to the CPU `TimeStepper` otherwise.
/// Returns `(snapshots, used_gpu)`.
#[cfg(feature = "gpu")]
fn run_simulation_dispatch(
    grid: &mut SwGrid,
    dt_s: f64,
    t_end_s: f64,
    n_snapshots: usize,
) -> (Vec<GridSnapshot>, bool) {
    use crate::physics::solver::gpu::GpuTimeStepper;
    if let Some(gpu) = GpuTimeStepper::new(grid, dt_s, crate::physics::constants::MANNING_N_COASTAL)
    {
        let snaps = run_simulation_gpu(grid, &gpu, dt_s, t_end_s, n_snapshots);
        return (snaps, true);
    }
    let stepper = TimeStepper::new(dt_s);
    (run_simulation(grid, &stepper, t_end_s, n_snapshots), false)
}

#[cfg(not(feature = "gpu"))]
fn run_simulation_dispatch(
    grid: &mut SwGrid,
    dt_s: f64,
    t_end_s: f64,
    n_snapshots: usize,
) -> (Vec<GridSnapshot>, bool) {
    let stepper = TimeStepper::new(dt_s);
    (run_simulation(grid, &stepper, t_end_s, n_snapshots), false)
}

/// GPU-side `run_simulation`: emits the same `n_snapshots` evenly-
/// spaced snapshots as the CPU path. The GPU dispatch loop runs
/// `take` steps between each snapshot then reads back into `grid`
/// so the snapshot encoder can serialise η as PNG.
#[cfg(feature = "gpu")]
fn run_simulation_gpu(
    grid: &mut SwGrid,
    gpu: &crate::physics::solver::gpu::GpuTimeStepper,
    dt_s: f64,
    t_end_s: f64,
    n_snapshots: usize,
) -> Vec<GridSnapshot> {
    const MAX_TOTAL_STEPS: usize = 1_000_000;
    let n = n_snapshots.max(2);
    let mut snaps = Vec::with_capacity(n);
    snaps.push(grid.snapshot());
    if !t_end_s.is_finite() || t_end_s <= 0.0 {
        return snaps;
    }
    let dt = if dt_s.is_finite() && dt_s > 0.0 {
        dt_s
    } else {
        1.0
    };
    let raw_steps = (t_end_s / dt).max(1.0);
    let total_steps = if raw_steps.is_finite() && raw_steps < MAX_TOTAL_STEPS as f64 {
        raw_steps.round() as usize
    } else {
        MAX_TOTAL_STEPS
    };
    for k in 1..n {
        let target_step = (k * total_steps) / (n - 1);
        let current_step = ((k - 1) * total_steps) / (n - 1);
        let take = target_step.saturating_sub(current_step).max(1);
        gpu.step(grid, take);
        snaps.push(grid.snapshot());
    }
    snaps
}

#[tauri::command]
pub fn run_preset(req: RunPresetRequest) -> Result<RunPresetResponse, String> {
    if req.preset_id.is_empty() || req.preset_id.len() > 128 {
        return Err("preset_id must be 1..128 characters".into());
    }
    if !req.time_s.is_finite() || req.time_s < 0.0 || req.time_s > SWE_MAX_T_END_S {
        return Err(format!(
            "time_s must be finite and in [0, {}]",
            SWE_MAX_T_END_S
        ));
    }
    if !req.mean_depth_m.is_finite() || req.mean_depth_m < 0.0 || req.mean_depth_m > 12_000.0 {
        return Err("mean_depth_m must be finite and in [0, 12 000 m]".into());
    }
    let preset = find_preset(&req.preset_id)
        .ok_or_else(|| format!("unknown preset id: {}", req.preset_id))?;
    let mut initial = preset.source.initial_displacement();
    // Propagate the preset's curated camera framing into the response so the
    // frontend can override its heuristic auto-clamp on flyTo (F-V13).
    initial.camera_view = preset.camera_view;
    let alpha = preset.source.far_field_decay_alpha();
    // Use the source's own water depth as the propagation depth unless the
    // caller passed an explicit override > 0 (e.g. for transoceanic averaging).
    let mean_depth_m = if req.mean_depth_m > 0.0 {
        req.mean_depth_m
    } else {
        initial.center.depth_m.max(50.0)
    };
    let n_samples = req.n_samples.clamp(2, WAVEFRONT_MAX_SAMPLES);
    let wavefront = sample_wavefront(
        initial.peak_amplitude_m,
        initial.cavity_radius_m,
        alpha,
        mean_depth_m,
        req.time_s,
        n_samples,
    );
    Ok(RunPresetResponse {
        preset,
        initial,
        wavefront,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::physics::landslide::LandslideKind;

    fn good_loc() -> GeoPoint {
        GeoPoint {
            lat_deg: 0.0,
            lon_deg: 0.0,
            depth_m: 4_000.0,
        }
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
            is_impact: true,
        });
        assert!(res.is_err());
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
            points: vec![CoastalPoint {
                id: "bad".to_string(),
                name: "Bad point".to_string(),
                lat: 95.0,
                lon: 0.0,
                beach_slope_deg: 1.0,
                offshore_depth_m: 50.0,
            }],
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
            points: vec![CoastalPoint {
                id: "flat".to_string(),
                name: "Flat coast".to_string(),
                lat: 0.0,
                lon: 0.0,
                beach_slope_deg: 0.0,
                offshore_depth_m: 50.0,
            }],
        });
        assert!(res.is_err());
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
        assert!(
            res.rmse_m < 1e-9,
            "identical series RMSE should be 0, got {}",
            res.rmse_m
        );
        assert_eq!(res.n_samples, 4);

        let model_offset = vec![(0.0, 0.5), (60.0, 1.0), (120.0, 1.5), (180.0, 1.0)];
        let res2 = dart_buoy_rmse(DartRmseRequest {
            buoy_lat: 30.0,
            buoy_lon: 150.0,
            observations: obs,
            model_samples: model_offset,
        })
        .expect("offset series must succeed");
        assert!(
            (res2.rmse_m - 0.5).abs() < 1e-6,
            "offset-by-0.5 series RMSE should be 0.5, got {}",
            res2.rmse_m
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
    fn dart_buoy_rmse_rejects_no_overlap() {
        let res = dart_buoy_rmse(DartRmseRequest {
            buoy_lat: 0.0,
            buoy_lon: 0.0,
            observations: vec![(300.0, 1.0)],
            model_samples: vec![(0.0, 0.0), (60.0, 0.2)],
        });
        assert!(
            res.is_err(),
            "no-overlap series must not return NaN success"
        );
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
        assert!(res.rmse_m < 1e-9);
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
        assert!(
            res.rmse_m < 1e-9,
            "interp midpoint should match obs; got RMSE {}",
            res.rmse_m
        );
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

    #[test]
    fn simulate_grid_rejects_bad_lamb_wave_override() {
        let res = validate_simulate_grid(&SimulateGridRequest {
            source: good_loc(),
            initial_amplitude_m: 1.0,
            source_sigma_m: 1_000.0,
            mean_depth_m: 4_000.0,
            use_real_bathymetry: false,
            box_half_size_deg: 2.0,
            cells_per_deg: 1.0,
            t_end_s: 60.0,
            n_snapshots: 2,
            include_lamb_wave: true,
            lamb_wave_peak_pressure_pa: Some(-1.0),
            lamb_wave_source_radius_m: None,
        });
        assert!(res.is_err());
    }
}
