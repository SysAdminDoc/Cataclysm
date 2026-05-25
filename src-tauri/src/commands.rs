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

fn check_lat_lon(loc: &GeoPoint) -> Result<(), String> {
    if !loc.lat_deg.is_finite() || loc.lat_deg.abs() > 90.0 {
        return Err(format!("location.lat_deg {} out of range", loc.lat_deg));
    }
    if !loc.lon_deg.is_finite() || loc.lon_deg.abs() > 360.0 {
        return Err(format!("location.lon_deg {} out of range", loc.lon_deg));
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
        return Err(format!("angle_deg must be in (0, 90] (got {})", input.angle_deg));
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
pub fn earthquake_initial_conditions(input: EarthquakeSource) -> Result<InitialDisplacement, String> {
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
pub fn far_field_amplitude(req: FarFieldRequest) -> FarFieldResponse {
    let amplitude_m = if req.is_impact {
        impact_far_field(req.initial_amplitude_m, req.cavity_radius_m, req.range_m)
    } else {
        nuclear_far_field(req.initial_amplitude_m, req.cavity_radius_m, req.range_m)
    };
    let travel_time_s = long_wave_travel_time_s(req.range_m, req.mean_depth_m);
    FarFieldResponse {
        amplitude_m,
        travel_time_s,
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RunupRequest {
    pub offshore_amplitude_m: f64,
    pub offshore_depth_m: f64,
    pub beach_slope_deg: f64,
}

#[tauri::command]
pub fn coastal_runup(req: RunupRequest) -> f64 {
    synolakis_runup_m(req.offshore_amplitude_m, req.offshore_depth_m, req.beach_slope_deg)
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
    if !req.source.lat_deg.is_finite() || req.source.lat_deg.abs() > 90.0 {
        return Err("source latitude out of range".into());
    }
    if !req.source.lon_deg.is_finite() || req.source.lon_deg.abs() > 360.0 {
        return Err("source longitude out of range".into());
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
        if p.is_finite() && p > 0.0 {
            s.peak_pressure_pa = p;
        }
    }
    if let Some(r) = req.source_radius_m {
        if r.is_finite() && r > 0.0 {
            s.source_radius_m = r;
        }
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
    if !req.source.lat_deg.is_finite() || req.source.lat_deg.abs() > 90.0 {
        return Err("source latitude out of range".into());
    }
    if !req.source.lon_deg.is_finite() || req.source.lon_deg.abs() > 360.0 {
        return Err("source longitude out of range".into());
    }
    if !req.click_lat.is_finite() || req.click_lat.abs() > 90.0 {
        return Err("click latitude out of range".into());
    }
    if !req.click_lon.is_finite() || req.click_lon.abs() > 360.0 {
        return Err("click longitude out of range".into());
    }
    let range_m = haversine_m(req.source.lat_deg, req.source.lon_deg, req.click_lat, req.click_lon);
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
}

#[derive(Debug, Serialize)]
pub struct SimulateGridResponse {
    pub snapshots: Vec<GridSnapshot>,
    pub dt_s: f64,
    pub nx: u32,
    pub ny: u32,
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
        return Err(format!("source latitude {} out of range", req.source.lat_deg));
    }
    if !req.source.lon_deg.is_finite() || req.source.lon_deg.abs() > 360.0 {
        return Err(format!("source longitude {} out of range", req.source.lon_deg));
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
    if !(req.box_half_size_deg.is_finite() && req.box_half_size_deg > 0.0 && req.box_half_size_deg <= 60.0)
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
        return Err(format!(
            "n_snapshots must be in [1, {}]",
            SWE_MAX_SNAPSHOTS
        ));
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

        let dt = grid.recommended_dt_s(0.4);
        let stepper = TimeStepper::new(dt);
        let nx = grid.nx as u32;
        let ny = grid.ny as u32;
        let snapshots = run_simulation(&mut grid, &stepper, req.t_end_s, req.n_snapshots);
        Ok(SimulateGridResponse {
            snapshots,
            dt_s: dt,
            nx,
            ny,
        })
    })
    .await
    .map_err(|e| format!("simulate_grid worker failed: {e}"))?
}

#[tauri::command]
pub fn run_preset(req: RunPresetRequest) -> Result<RunPresetResponse, String> {
    if !req.time_s.is_finite() || req.time_s < 0.0 || req.time_s > SWE_MAX_T_END_S {
        return Err(format!("time_s must be finite and in [0, {}]", SWE_MAX_T_END_S));
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
    fn haversine_handles_same_point() {
        assert_eq!(haversine_m(45.0, -75.0, 45.0, -75.0), 0.0);
    }

    #[test]
    fn haversine_handles_nan() {
        // Should not panic; returns 0 as documented.
        assert_eq!(haversine_m(f64::NAN, 0.0, 0.0, 0.0), 0.0);
    }
}
