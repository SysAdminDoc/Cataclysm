//! Tauri command handlers exposed to the React frontend.
//! Every function returns serde-serializable types; errors are stringified.

use serde::{Deserialize, Serialize};

use crate::physics::{
    asteroid::{far_field_amplitude_m as impact_far_field, AsteroidImpact},
    constants::{G_EARTH, R_EARTH_M},
    earthquake::EarthquakeSource,
    landslide::LandslideSource,
    nuclear::{far_field_amplitude_m as nuclear_far_field, NuclearBurst},
    shallow_water::{
        long_wave_travel_time_s, sample_wavefront, synolakis_runup_m, PropagationSnapshot,
    },
    solver::{run_simulation, GridSnapshot, SwGrid, TimeStepper},
    GeoPoint, InitialDisplacement,
};
use crate::presets::{all_presets, find_preset, Preset};

#[tauri::command]
pub fn asteroid_initial_conditions(input: AsteroidImpact) -> InitialDisplacement {
    input.initial_displacement()
}

#[tauri::command]
pub fn nuclear_initial_conditions(input: NuclearBurst) -> InitialDisplacement {
    input.initial_displacement()
}

#[tauri::command]
pub fn landslide_initial_conditions(input: LandslideSource) -> InitialDisplacement {
    input.initial_displacement()
}

#[tauri::command]
pub fn earthquake_initial_conditions(input: EarthquakeSource) -> InitialDisplacement {
    input.initial_displacement()
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
}

/// For each coastal point, compute the offshore amplitude (far-field decay
/// from the source) and the Synolakis runup at the local beach. Used by the
/// `CoastalRunupOverlay` Cesium component.
#[tauri::command]
pub fn runup_at_points(req: RunupAtPointsRequest) -> Vec<RunupAtPoint> {
    req.points
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
            }
        })
        .collect()
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
    if req.n_snapshots > SWE_MAX_SNAPSHOTS {
        return Err(format!("n_snapshots must be ≤ {}", SWE_MAX_SNAPSHOTS));
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
    let preset = find_preset(&req.preset_id)
        .ok_or_else(|| format!("unknown preset id: {}", req.preset_id))?;
    let initial = preset.source.initial_displacement();
    let alpha = preset.source.far_field_decay_alpha();
    // Use the source's own water depth as the propagation depth unless the
    // caller passed an explicit override > 0 (e.g. for transoceanic averaging).
    let mean_depth_m = if req.mean_depth_m > 0.0 {
        req.mean_depth_m
    } else {
        initial.center.depth_m.max(50.0)
    };
    let wavefront = sample_wavefront(
        initial.peak_amplitude_m,
        initial.cavity_radius_m,
        alpha,
        mean_depth_m,
        req.time_s,
        req.n_samples.max(2),
    );
    Ok(RunPresetResponse {
        preset,
        initial,
        wavefront,
    })
}
