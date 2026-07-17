//! Tauri command handlers exposed to the React frontend.
//! Every function returns serde-serializable types; errors are stringified.

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex, Weak};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::data::coastal_points::{
    MeasurementProvenance, ProvenanceConfidence, resolve_runup_points,
};
use crate::physics::{
    GeoPoint, InitialDisplacement, InitialSourceGeometry,
    asteroid::{AsteroidImpact, far_field_amplitude_m as impact_far_field},
    constants::{G_EARTH, R_EARTH_M},
    earthquake::EarthquakeSource,
    lamb_wave::{LAMB_WAVE_SPEED_M_S, LambWaveSource, proudman_resonance_depth_m},
    landslide::LandslideSource,
    nuclear::{NuclearBurst, far_field_amplitude_m as nuclear_far_field},
    shallow_water::{
        PropagationSnapshot, long_wave_travel_time_s, sample_wavefront, synolakis_runup_m,
    },
    solver::{
        Colormap, DiagnosticSink, GridGaugePoint, GridGaugeSample, GridSnapshot, SwGrid,
        TimeStepper,
        max_field::{MaxFieldAccumulator, MaxFieldProduct},
        quality::{QualityBaseline, RunQualityRecord},
        run_simulation_with_gauge_samples, snapshot_step_schedule,
    },
};
use crate::presets::{Preset, all_presets, find_preset};
use tauri::{AppHandle, Emitter, Manager, ipc::Response};

mod direct;
mod observations;
mod system;
mod waves;
pub use direct::*;
pub use observations::*;
pub use system::*;
pub use waves::*;
use waves::haversine_m;

#[derive(Debug)]
struct ActiveSimulation {
    cancel: Weak<AtomicBool>,
    reserved_memory_bytes: u64,
}

static ACTIVE_SIMULATIONS: LazyLock<Mutex<HashMap<String, ActiveSimulation>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static LAST_RUN_QUALITY: LazyLock<Mutex<Option<RunQualityRecord>>> =
    LazyLock::new(|| Mutex::new(None));

fn publish_run_quality(record: &RunQualityRecord) {
    if let Ok(mut last) = LAST_RUN_QUALITY.lock() {
        *last = Some(record.clone());
    }
}

#[derive(Clone, Serialize)]
struct SolverDiagnosticPayload {
    level: &'static str,
    message: String,
}

fn emit_solver_diagnostic(app: &AppHandle, message: impl Into<String>) {
    let _ = app.emit(
        "solver-diagnostic",
        SolverDiagnosticPayload {
            level: "warn",
            message: message.into(),
        },
    );
}

fn validate_run_id(run_id: &str) -> Result<(), String> {
    if run_id.is_empty()
        || run_id.len() > 128
        || !run_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("run_id must contain 1-128 ASCII letters, digits, '-' or '_'".into());
    }
    Ok(())
}

fn register_simulation(
    run_id: &str,
    cancel: &Arc<AtomicBool>,
    memory: &SimulationMemoryEstimate,
) -> Result<(), String> {
    validate_run_id(run_id)?;
    let mut guard = ACTIVE_SIMULATIONS
        .lock()
        .map_err(|_| "simulation registry is unavailable")?;
    guard.retain(|_, run| run.cancel.strong_count() > 0);
    if guard
        .get(run_id)
        .and_then(|run| run.cancel.upgrade())
        .is_some()
    {
        return Err(format!("simulation run '{run_id}' is already active"));
    }
    let active_bytes = guard
        .values()
        .map(|run| run.reserved_memory_bytes)
        .fold(0_u64, u64::saturating_add);
    if active_bytes.saturating_add(memory.estimated_bytes) > SWE_MEMORY_BUDGET_BYTES {
        return Err(format!(
            "simulation run '{run_id}' needs {} for a {}×{} grid ({} cells), but active runs \
             already reserve {} of the {} solver budget; reduce cells_per_deg, \
             box_half_size_deg, or concurrent compare runs",
            format_mib(memory.estimated_bytes),
            memory.nx,
            memory.ny,
            memory.cells,
            format_mib(active_bytes),
            format_mib(SWE_MEMORY_BUDGET_BYTES),
        ));
    }
    guard.insert(
        run_id.to_owned(),
        ActiveSimulation {
            cancel: Arc::downgrade(cancel),
            reserved_memory_bytes: memory.estimated_bytes,
        },
    );
    Ok(())
}

fn unregister_simulation(run_id: &str, cancel: &Arc<AtomicBool>) {
    if let Ok(mut guard) = ACTIVE_SIMULATIONS.lock()
        && guard
            .get(run_id)
            .and_then(|run| run.cancel.upgrade())
            .is_some_and(|registered| Arc::ptr_eq(&registered, cancel))
    {
        guard.remove(run_id);
    }
}

fn format_mib(bytes: u64) -> String {
    format!("{:.1} MiB", bytes as f64 / (1024.0 * 1024.0))
}

fn simulation_resource_status() -> (u32, u64) {
    let Ok(mut guard) = ACTIVE_SIMULATIONS.lock() else {
        return (0, 0);
    };
    guard.retain(|_, run| run.cancel.strong_count() > 0);
    let bytes = guard
        .values()
        .map(|run| run.reserved_memory_bytes)
        .fold(0_u64, u64::saturating_add);
    (guard.len().min(u32::MAX as usize) as u32, bytes)
}

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

// Canonical geographic domain enforced uniformly across every command:
// latitude in [-90, 90], longitude in [-180, 180]. The whole frontend (preset
// registry, coastal-point DB, globe picks) already works in this range, so
// accepting the looser ±360 longitude only admitted un-normalised values that
// then produced off-frame Cesium bounding boxes. Keep all callers in one domain.
const LON_ABS_MAX: f64 = 180.0;

fn check_lat_lon_values(prefix: &str, lat: f64, lon: f64) -> Result<(), String> {
    if !lat.is_finite() || lat.abs() > 90.0 {
        return Err(format!("{prefix} latitude {lat} out of range"));
    }
    if !lon.is_finite() || lon.abs() > LON_ABS_MAX {
        return Err(format!("{prefix} longitude {lon} out of range"));
    }
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SimulateGridRequest {
    /// Source centre (deg).
    pub source: GeoPoint,
    /// Peak amplitude at the source (m). Used as Gaussian IC peak.
    pub initial_amplitude_m: f64,
    /// 1-σ radius of the IC bump (m).
    pub source_sigma_m: f64,
    /// Source-specific t=0 geometry. Older clients may omit this and retain
    /// the legacy circular Gaussian initial condition.
    #[serde(default)]
    pub source_geometry: Option<InitialSourceGeometry>,
    /// Fallback uniform depth (m) when `use_real_bathymetry = false` or
    /// when the bathymetry sampler returns 0 (land).
    pub mean_depth_m: f64,
    /// If true, use `data::bathymetry::sample(lat, lon)` per cell; if false
    /// or zero-depth, fall back to `mean_depth_m`.
    #[serde(default)]
    pub use_real_bathymetry: bool,
    /// Optional content-addressed local raster. Requires
    /// `use_real_bathymetry = true`; omission retains the bundled coarse model.
    #[serde(default)]
    pub bathymetry_asset_id: Option<String>,
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
    #[serde(default)]
    pub colormap: String,
    #[serde(default)]
    pub gauge_points: Vec<GridGaugePoint>,
}

fn local_offset_m(center_lat: f64, center_lon: f64, lat: f64, lon: f64) -> (f64, f64) {
    let north_m = (lat - center_lat).to_radians() * R_EARTH_M;
    let delta_lon = (lon - center_lon + 540.0).rem_euclid(360.0) - 180.0;
    let east_m = delta_lon.to_radians() * R_EARTH_M * center_lat.to_radians().cos();
    (east_m, north_m)
}

fn inject_source_initial_field(grid: &mut SwGrid, req: &SimulateGridRequest) -> Result<(), String> {
    let Some(geometry) = &req.source_geometry else {
        grid.inject_gaussian(
            req.source.lat_deg,
            req.source.lon_deg,
            req.initial_amplitude_m,
            req.source_sigma_m.max(1000.0),
        );
        return Ok(());
    };

    let mut field = Vec::with_capacity(grid.nx * grid.ny);
    for j in 0..grid.ny {
        let lat = grid.south_lat + (j as f64 + 0.5) * grid.dlat_deg;
        for i in 0..grid.nx {
            let lon = grid.west_lon + (i as f64 + 0.5) * grid.dlon_deg;
            let value = match geometry {
                InitialSourceGeometry::CavityRing {
                    rim_radius_m,
                    rim_width_m,
                } => {
                    let (east_m, north_m) =
                        local_offset_m(req.source.lat_deg, req.source.lon_deg, lat, lon);
                    let radial_m = east_m.hypot(north_m);
                    let offset = (radial_m - rim_radius_m) / rim_width_m;
                    req.initial_amplitude_m * (-0.5 * offset * offset).exp()
                }
                InitialSourceGeometry::Landslide {
                    axis_azimuth_deg,
                    longitudinal_sigma_m,
                    transverse_sigma_m,
                } => {
                    let (east_m, north_m) =
                        local_offset_m(req.source.lat_deg, req.source.lon_deg, lat, lon);
                    let azimuth = axis_azimuth_deg.to_radians();
                    let along = east_m * azimuth.sin() + north_m * azimuth.cos();
                    let across = east_m * azimuth.cos() - north_m * azimuth.sin();
                    let x = along / longitudinal_sigma_m;
                    let y = across / transverse_sigma_m;
                    // A normalized derivative-of-Gaussian yields the displaced
                    // positive/negative lobes of a translating slide; |peak| is
                    // the scalar source amplitude at x=±1, y=0.
                    req.initial_amplitude_m * x * (0.5 - 0.5 * (x * x + y * y)).exp()
                }
                InitialSourceGeometry::Okada { fault } => {
                    let (east_m, north_m) =
                        local_offset_m(fault.center_lat, fault.center_lon, lat, lon);
                    fault.vertical_displacement_at_offset_m(east_m, north_m)
                }
            };
            field.push(value);
        }
    }
    grid.inject_field(&field)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SimulationRunLifecycle {
    Completed,
    Cancelled,
}

#[derive(Debug, Serialize)]
pub struct SimulateGridResponse {
    pub run_id: String,
    pub lifecycle: SimulationRunLifecycle,
    pub emitted_snapshots: u32,
    pub cancelled: bool,
    pub snapshots: Vec<GridSnapshot>,
    pub dt_s: f64,
    pub nx: u32,
    pub ny: u32,
    pub bathymetry_asset_id: Option<String>,
    /// F4-01 — `true` when the SWE finite-volume solver ran on the wgpu GPU
    /// path, `false` for the CPU `rayon` path. Always `false` on
    /// builds compiled without `--features gpu`. Frontend uses this
    /// to surface a "ran on GPU" badge in the playback header.
    #[serde(default)]
    pub used_gpu: bool,
    /// Max-field products (peak |η|, time of maximum, energy proxy,
    /// arrival isochrones) accumulated at solver-step cadence.
    pub max_field: Option<MaxFieldProduct>,
    pub run_quality: RunQualityRecord,
}

/// Hard cap on the SWE grid size — protects us against runaway requests.
const SWE_MAX_CELLS: usize = 4_000_000;
/// Process-wide reservation ceiling for live SWE runs. One maximum-size
/// streaming run remains admissible; a second comparable run is rejected
/// before either grid can double the process working set.
const SWE_MEMORY_BUDGET_BYTES: u64 = 512 * 1024 * 1024;
/// Conservative peak per-cell residency across the f64 host grid,
/// scratch/max-field arrays, f32 GPU ping-pong/readback/upload buffers, and one
/// in-flight RGBA/PNG/base64 encoding. Source-level accounting is about 140
/// bytes before allocator and codec overhead, so admission keeps headroom.
const SWE_CORE_BYTES_PER_CELL: u64 = 152;
/// Retained base64 PNG size per cell for each non-streaming snapshot. Tiled
/// snapshots no longer retain a duplicate full image; raw RGBA encoded as
/// base64 approaches 5.34 bytes/cell before small PNG/container overhead.
const SWE_RETAINED_SNAPSHOT_BYTES_PER_CELL: u64 = 6;
/// Hard cap on total *work* (grid cells × time steps). The cell cap and the
/// step cap are each individually bounded, but their product is what actually
/// determines wall-clock time; without this a request that passes both (e.g.
/// 4 M cells × ~250 k steps) could wedge the blocking worker for many minutes.
/// 5e10 cell-steps is a few seconds of CPU on this solver and far above any
/// legitimate interactive request (a typical run is well under 1e7).
const SWE_MAX_CELL_STEPS: u64 = 50_000_000_000;
/// Hard cap on number of snapshots per simulation.
const SWE_MAX_SNAPSHOTS: usize = 240;
const SWE_MAX_GAUGES: usize = 256;
/// Hard cap on simulated time — runaway scrubs.
const SWE_MAX_T_END_S: f64 = 24.0 * 3600.0;
/// Hard cap on coastal-runup query batch size — protects against IPC flooding.
const RUNUP_MAX_POINTS: usize = 2_000;
/// Hard cap on wavefront sample count.
const WAVEFRONT_MAX_SAMPLES: usize = 2_000;
/// Minimum analytical-basin depth. Below this the solver CFL and celerity
/// become unrepresentative; the solver used to silently clamp requests up to
/// this floor, diverging the simulated depth from the reported one.
const SWE_MIN_MEAN_DEPTH_M: f64 = 50.0;

#[derive(Debug, Clone, Copy)]
struct SimulationGridPlan {
    lat: f64,
    lon: f64,
    south: f64,
    north: f64,
    west: f64,
    east: f64,
    cell_deg: f64,
    nx: usize,
    ny: usize,
    cells: usize,
}

impl SimulationGridPlan {
    fn from_request(req: &SimulateGridRequest) -> Result<Self, String> {
        let lat = req.source.lat_deg.clamp(-90.0, 90.0);
        let lon = ((req.source.lon_deg + 180.0).rem_euclid(360.0)) - 180.0;
        let half = req.box_half_size_deg;
        let cell_deg = 1.0 / req.cells_per_deg;
        let south = (lat - half).max(-90.0);
        let north = (lat + half).min(90.0);
        let west = lon - half;
        let east = lon + half;
        let nx = ((east - west) / cell_deg).round().max(2.0) as usize;
        let ny = ((north - south) / cell_deg).round().max(2.0) as usize;
        let cells = nx.saturating_mul(ny);
        if cells > SWE_MAX_CELLS {
            return Err(format!(
                "grid too large ({nx}×{ny} ≈ {cells} cells) — reduce cells_per_deg or \
                 box_half_size_deg"
            ));
        }
        Ok(Self {
            lat,
            lon,
            south,
            north,
            west,
            east,
            cell_deg,
            nx,
            ny,
            cells,
        })
    }
}

#[derive(Debug, Clone, Copy)]
struct SimulationMemoryEstimate {
    nx: usize,
    ny: usize,
    cells: usize,
    estimated_bytes: u64,
}

impl SimulationMemoryEstimate {
    fn for_plan(plan: &SimulationGridPlan, retained_snapshots: usize) -> Self {
        let bytes_per_cell = SWE_CORE_BYTES_PER_CELL.saturating_add(
            SWE_RETAINED_SNAPSHOT_BYTES_PER_CELL.saturating_mul(retained_snapshots as u64),
        );
        Self {
            nx: plan.nx,
            ny: plan.ny,
            cells: plan.cells,
            estimated_bytes: (plan.cells as u64).saturating_mul(bytes_per_cell),
        }
    }
}

fn validate_simulate_grid(req: &SimulateGridRequest) -> Result<(), String> {
    if !req.source.lat_deg.is_finite() || req.source.lat_deg.abs() > 90.0 {
        return Err(format!(
            "source latitude {} out of range",
            req.source.lat_deg
        ));
    }
    if !req.source.lon_deg.is_finite() || req.source.lon_deg.abs() > LON_ABS_MAX {
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
    match &req.source_geometry {
        Some(InitialSourceGeometry::CavityRing {
            rim_radius_m,
            rim_width_m,
        }) => {
            if !rim_radius_m.is_finite()
                || !rim_width_m.is_finite()
                || *rim_radius_m <= 0.0
                || *rim_width_m <= 0.0
                || *rim_radius_m > 1.0e7
                || *rim_width_m > 1.0e7
            {
                return Err("cavity-ring radii must be finite and in (0, 10 000 km]".into());
            }
        }
        Some(InitialSourceGeometry::Landslide {
            axis_azimuth_deg,
            longitudinal_sigma_m,
            transverse_sigma_m,
        }) => {
            if !axis_azimuth_deg.is_finite() || !(0.0..360.0).contains(axis_azimuth_deg) {
                return Err("landslide axis_azimuth_deg must be finite and in [0, 360)".into());
            }
            if !longitudinal_sigma_m.is_finite()
                || !transverse_sigma_m.is_finite()
                || *longitudinal_sigma_m <= 0.0
                || *transverse_sigma_m <= 0.0
                || *longitudinal_sigma_m > 1.0e7
                || *transverse_sigma_m > 1.0e7
            {
                return Err("landslide source scales must be finite and in (0, 10 000 km]".into());
            }
        }
        Some(InitialSourceGeometry::Okada { fault }) => {
            let values = [
                fault.center_lat,
                fault.center_lon,
                fault.depth_m,
                fault.length_m,
                fault.width_m,
                fault.strike_deg,
                fault.dip_deg,
                fault.rake_deg,
                fault.slip_m,
            ];
            if values.iter().any(|value| !value.is_finite())
                || fault.center_lat.abs() > 90.0
                || fault.center_lon.abs() > LON_ABS_MAX
                || fault.depth_m < 0.0
                || fault.length_m <= 0.0
                || fault.width_m <= 0.0
                || fault.slip_m <= 0.0
            {
                return Err("Okada source geometry contains invalid fault parameters".into());
            }
        }
        None => {}
    }
    if !req.mean_depth_m.is_finite() || req.mean_depth_m < 0.0 || req.mean_depth_m > 12_000.0 {
        return Err("mean_depth_m must be finite and in [0, 12 000 m]".into());
    }
    // The analytical basin is simulated at exactly `mean_depth_m`; a sub-floor
    // request was previously clamped to the floor while every readout still
    // reported the request. Reject it so the simulated depth always equals the
    // reported/exported depth. Real-bathymetry runs ignore this field.
    if !req.use_real_bathymetry && req.mean_depth_m < SWE_MIN_MEAN_DEPTH_M {
        return Err(format!(
            "mean_depth_m must be at least {} m for the analytical basin (or enable real bathymetry)",
            SWE_MIN_MEAN_DEPTH_M
        ));
    }
    if let Some(asset_id) = req.bathymetry_asset_id.as_deref() {
        if !req.use_real_bathymetry {
            return Err("bathymetry_asset_id requires use_real_bathymetry=true".into());
        }
        crate::data::bathymetry_cache::validate_asset_id(asset_id)?;
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
    if req.n_snapshots < 2 || req.n_snapshots > SWE_MAX_SNAPSHOTS {
        return Err(format!("n_snapshots must be in [2, {}]", SWE_MAX_SNAPSHOTS));
    }
    if let Some(p) = req.lamb_wave_peak_pressure_pa
        && (!p.is_finite() || p <= 0.0 || p > 1.0e6)
    {
        return Err("lamb_wave_peak_pressure_pa must be in (0, 1 000 000]".into());
    }
    if let Some(r) = req.lamb_wave_source_radius_m
        && (!r.is_finite() || r <= 0.0 || r > 1.0e7)
    {
        return Err("lamb_wave_source_radius_m must be in (0, 10 000 km]".into());
    }
    if !(req.colormap.is_empty()
        || req.colormap == "diverging"
        || req.colormap == "cividis"
        || req.colormap == "viridis")
    {
        return Err("colormap must be 'diverging', 'cividis', or 'viridis'".into());
    }
    if req.gauge_points.len() > SWE_MAX_GAUGES {
        return Err(format!(
            "gauge_points must contain at most {SWE_MAX_GAUGES} gauges"
        ));
    }
    let mut gauge_ids = HashSet::with_capacity(req.gauge_points.len());
    for g in &req.gauge_points {
        if g.id.trim().is_empty() || g.id.len() > 128 {
            return Err("gauge point id must be 1..128 characters".into());
        }
        if !gauge_ids.insert(g.id.as_str()) {
            return Err("gauge point ids must be unique".into());
        }
        if !g.lat_deg.is_finite() || g.lat_deg.abs() > 90.0 {
            return Err(format!("gauge latitude {} out of range", g.lat_deg));
        }
        if !g.lon_deg.is_finite() || g.lon_deg.abs() > LON_ABS_MAX {
            return Err(format!("gauge longitude {} out of range", g.lon_deg));
        }
    }
    Ok(())
}

fn populate_grid_bathymetry(
    grid: &mut SwGrid,
    req: &SimulateGridRequest,
    app_data_dir: Option<&Path>,
) -> Result<(), String> {
    if let Some(asset_id) = req.bathymetry_asset_id.as_deref() {
        let app_data_dir = app_data_dir.ok_or_else(|| {
            "application data directory is unavailable for local bathymetry".to_owned()
        })?;
        let (_, raster) =
            crate::data::bathymetry_cache::load_cached_raster(app_data_dir, asset_id)?;
        let mut sampled = Vec::with_capacity(grid.nx * grid.ny);
        for row in 0..grid.ny {
            let lat = grid.south_lat + (row as f64 + 0.5) * grid.dlat_deg;
            for column in 0..grid.nx {
                let lon = grid.west_lon + (column as f64 + 0.5) * grid.dlon_deg;
                sampled.push(raster.sample_bilinear(lat, lon)?);
            }
        }
        if sampled.iter().all(|depth| *depth <= 0.0) {
            return Err("local bathymetry crop contains no wet solver cells".into());
        }
        grid.h_m = sampled;
    } else if req.use_real_bathymetry {
        grid.fill_bathymetry_from(|lat, lon| {
            let depth = crate::data::bathymetry::sample(lat, lon);
            depth.max(0.0)
        });
    } else {
        grid.fill_uniform_depth(req.mean_depth_m.max(SWE_MIN_MEAN_DEPTH_M));
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
pub async fn simulate_grid(
    app: AppHandle,
    run_id: String,
    req: SimulateGridRequest,
) -> Result<SimulateGridResponse, String> {
    validate_simulate_grid(&req)?;
    let app_data_dir = req
        .bathymetry_asset_id
        .as_ref()
        .map(|_| {
            app.path()
                .app_data_dir()
                .map_err(|error| format!("application data directory is unavailable: {error}"))
        })
        .transpose()?;
    let plan = SimulationGridPlan::from_request(&req)?;
    let memory = SimulationMemoryEstimate::for_plan(&plan, req.n_snapshots.max(2));

    let cancel = Arc::new(AtomicBool::new(false));
    register_simulation(&run_id, &cancel, &memory)?;
    let worker_run_id = run_id.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let response_run_id = worker_run_id.clone();
        let diagnostics = |message: &str| emit_solver_diagnostic(&app, message);
        let result = (|| {
        let mut grid = SwGrid::new(
            plan.west,
            plan.south,
            plan.east,
            plan.north,
            plan.cell_deg,
            plan.cell_deg,
        );
        grid.colormap = match req.colormap.as_str() {
            "cividis" => Colormap::Cividis,
            "viridis" => Colormap::Viridis,
            _ => Colormap::Diverging,
        };
        populate_grid_bathymetry(&mut grid, &req, app_data_dir.as_deref())?;
        inject_source_initial_field(&mut grid, &req)?;

        // F4-05 — when include_lamb_wave is set, apply the atmospheric
        // pressure-driven η contribution at t=0 as a wider IC injection
        // alongside the Gaussian. Captures the leading-edge Lamb-wave
        // depression for the first ~100 s after source event; continuous
        // step-by-step forcing lands in v0.5.0.
        if req.include_lamb_wave {
            let mut lamb = crate::physics::lamb_wave::LambWaveSource::hunga_tonga_2022();
            if let Some(p) = req.lamb_wave_peak_pressure_pa
                && p.is_finite()
                && p > 0.0
            {
                lamb.peak_pressure_pa = p;
            }
            if let Some(r) = req.lamb_wave_source_radius_m
                && r.is_finite()
                && r > 0.0
            {
                lamb.source_radius_m = r;
            }
            // Sample at the pulse-arrival time at the source — captures
            // the peak depression. Subsequent step-by-step propagation
            // of the η depression is handled by the SWE solver as the
            // grid relaxes back toward equilibrium.
            grid.apply_lamb_wave(&lamb, plan.lat, plan.lon, 0.0);
        }

        let dt = grid.recommended_dt_s(0.4);
        let nx = grid.nx as u32;
        let ny = grid.ny as u32;

        // Combined work budget (cells × steps). The cell count and the step
        // count are each capped, but only their product bounds wall-clock time.
        let est_steps = if dt.is_finite() && dt > 0.0 {
            (req.t_end_s / dt).clamp(1.0, 1.0e9)
        } else {
            1.0
        };
        let work = (grid.nx as u64)
            .saturating_mul(grid.ny as u64)
            .saturating_mul(est_steps as u64);
        if work > SWE_MAX_CELL_STEPS {
            return Err(format!(
                "simulation too expensive (~{} cell-steps; cap {}). Reduce cells_per_deg, box_half_size_deg, or t_end_s.",
                work, SWE_MAX_CELL_STEPS
            ));
        }

        // F4-01 — when compiled with `--features gpu`, try the wgpu
        // dispatch path. Fall back to CPU cleanly if no adapter is
        // available (Linux CI, integrated-only laptops without
        // Vulkan, etc.). The finite-volume kernel has CPU/GPU parity for
        // both linear and nonlinear transport; live runs request nonlinear
        // mode on either backend.
        let quality_baseline = QualityBaseline::capture(
            &grid,
            crate::physics::solver::BoundaryMode::default_sponge(),
        );
        let admission_quality = quality_baseline.assess(&grid, dt);
        if let Some(failure) = &admission_quality.failure {
            publish_run_quality(&admission_quality);
            return Err(format!("simulation rejected by numerical-integrity admission gate: {failure}"));
        }
        let (snapshots, used_gpu, max_field) = run_simulation_dispatch(
            &mut grid,
            dt,
            req.t_end_s,
            req.n_snapshots,
            cancel.as_ref(),
            Some(&diagnostics),
            &req.gauge_points,
            MaxFieldAccumulator::threshold_for_amplitude(req.initial_amplitude_m),
        );
        let run_quality = quality_baseline.assess(&grid, dt);
        publish_run_quality(&run_quality);
        if let Some(failure) = &run_quality.failure {
            diagnostics(&format!("numerical-integrity violation: {failure}"));
            return Err(format!("simulation rejected by numerical-integrity gate: {failure}"));
        }
        let emitted_snapshots = snapshots.len().min(u32::MAX as usize) as u32;
        let cancelled = cancel.load(Ordering::Acquire);
        Ok(SimulateGridResponse {
            run_id: response_run_id,
            lifecycle: if cancelled {
                SimulationRunLifecycle::Cancelled
            } else {
                SimulationRunLifecycle::Completed
            },
            emitted_snapshots,
            cancelled,
            snapshots,
            dt_s: dt,
            nx,
            ny,
            bathymetry_asset_id: req.bathymetry_asset_id.clone(),
            used_gpu,
            max_field,
            run_quality,
        })
        })();
        unregister_simulation(&worker_run_id, &cancel);
        result
    })
    .await
    .map_err(|e| format!("simulate_grid worker failed: {e}"))?
}

/// Streaming variant of `simulate_grid`. Sends each GridSnapshot
/// through a Tauri Channel as it's computed, enabling real-time
/// playback during simulation instead of waiting for all snapshots.
/// Returns the grid metadata (dt_s, nx, ny, used_gpu) once complete.
#[derive(Debug, Serialize)]
pub struct SimulateGridStreamMeta {
    pub run_id: String,
    pub lifecycle: SimulationRunLifecycle,
    pub dt_s: f64,
    pub nx: u32,
    pub ny: u32,
    pub bathymetry_asset_id: Option<String>,
    pub used_gpu: bool,
    pub n_snapshots: u32,
    pub cancelled: bool,
    /// Max-field products (peak |η|, time of maximum, energy proxy,
    /// arrival isochrones) accumulated at solver-step cadence.
    pub max_field: Option<MaxFieldProduct>,
    /// Stable identity for the Rust-authoritative render stream emitted beside
    /// the legacy PNG snapshots. `None` means no render channel was requested.
    pub render_scenario_id: Option<String>,
    pub render_frame_count: u64,
    pub run_quality: RunQualityRecord,
    pub recovered_gauge_history: Vec<GridGaugeHistoryFrame>,
}

#[derive(Debug, Serialize)]
pub struct GridGaugeHistoryFrame {
    pub time_s: f64,
    pub gauge_samples: Vec<GridGaugeSample>,
}

#[tauri::command]
pub async fn simulate_grid_streaming(
    app: AppHandle,
    run_id: String,
    resume_run_id: Option<String>,
    checkpoint_interval_s: Option<u64>,
    req: SimulateGridRequest,
    on_snapshot: tauri::ipc::Channel<GridSnapshot>,
    on_render_packet: tauri::ipc::Channel<Response>,
) -> Result<SimulateGridStreamMeta, String> {
    validate_simulate_grid(&req)?;
    let checkpoint_interval = validate_checkpoint_interval(checkpoint_interval_s)?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("application data directory is unavailable: {error}"))?;
    let plan = SimulationGridPlan::from_request(&req)?;
    let memory = SimulationMemoryEstimate::for_plan(&plan, 0);

    let cancel = Arc::new(AtomicBool::new(false));
    register_simulation(&run_id, &cancel, &memory)?;
    let worker_run_id = run_id.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let response_run_id = worker_run_id.clone();
        let diagnostics = |message: &str| emit_solver_diagnostic(&app, message);
        let result = (|| {
            let mut grid = SwGrid::new(
                plan.west,
                plan.south,
                plan.east,
                plan.north,
                plan.cell_deg,
                plan.cell_deg,
            );
            grid.colormap = match req.colormap.as_str() {
                "cividis" => Colormap::Cividis,
                "viridis" => Colormap::Viridis,
                _ => Colormap::Diverging,
            };
            populate_grid_bathymetry(&mut grid, &req, Some(&app_data_dir))?;
            inject_source_initial_field(&mut grid, &req)?;

            if req.include_lamb_wave {
                let mut lamb = crate::physics::lamb_wave::LambWaveSource::hunga_tonga_2022();
                if let Some(p) = req.lamb_wave_peak_pressure_pa
                    && p.is_finite()
                    && p > 0.0
                {
                    lamb.peak_pressure_pa = p;
                }
                if let Some(r) = req.lamb_wave_source_radius_m
                    && r.is_finite()
                    && r > 0.0
                {
                    lamb.source_radius_m = r;
                }
                grid.apply_lamb_wave(&lamb, plan.lat, plan.lon, 0.0);
            }

            let dt = grid.recommended_dt_s(0.4);
            let nx = grid.nx as u32;
            let ny = grid.ny as u32;
            let snapshot_schedule = snapshot_step_schedule(req.t_end_s, dt, req.n_snapshots);
            let quality_baseline = QualityBaseline::capture(
                &grid,
                crate::physics::solver::BoundaryMode::default_sponge(),
            );
            let admission_quality = quality_baseline.assess(&grid, dt);
            if let Some(failure) = &admission_quality.failure {
                publish_run_quality(&admission_quality);
                return Err(format!(
                    "simulation rejected by numerical-integrity admission gate: {failure}"
                ));
            }

            let checkpoint_writer = RefCell::new(StreamCheckpointWriter::new(
                app_data_dir.clone(),
                &response_run_id,
                &req,
                dt,
                checkpoint_interval,
            )?);
            let resumed = resume_run_id
                .as_deref()
                .map(|checkpoint_run_id| {
                    let checkpoint = crate::physics::solver::checkpoint::load_latest(
                        &app_data_dir,
                        checkpoint_run_id,
                    )?;
                    verify_resume_checkpoint(
                        &checkpoint,
                        &checkpoint_writer.borrow().identity,
                        &req.gauge_points,
                        &grid,
                        &snapshot_schedule,
                    )?;
                    Ok::<_, String>(checkpoint)
                })
                .transpose()?;
            let (start_interval, restored_max_field, recovered_gauge_history) =
                if let Some(checkpoint) = resumed {
                    let start = checkpoint.identity.next_snapshot_interval as usize;
                    let recovered_gauge_history = checkpoint_gauge_history_for_ipc(&checkpoint);
                    checkpoint_writer.borrow_mut().gauge_history = checkpoint.gauge_history;
                    grid = checkpoint.grid;
                    (start, Some(checkpoint.max_field), recovered_gauge_history)
                } else {
                    (0, None, Vec::new())
                };
            checkpoint_writer
                .borrow_mut()
                .identity
                .next_snapshot_interval = start_interval.min(u32::MAX as usize) as u32;

            let canonical_scenario = serde_json::to_vec(&req)
                .map_err(|error| format!("failed to canonicalize render scenario: {error}"))?;
            let scenario_sha256 = crate::render_protocol::sha256_hex(&canonical_scenario);
            let scenario_id = format!("swe-{}", &scenario_sha256[..16]);
            let render_stream = RenderStreamContext::new(
                &on_render_packet,
                scenario_id.clone(),
                scenario_sha256.clone(),
                dt,
            );
            render_stream.send_scenario(
                &canonical_scenario,
                crate::data::geodesy::GeodeticPosition {
                    lat_deg: plan.lat,
                    lon_deg: plan.lon,
                    ellipsoid_height_m: 0.0,
                },
                req.use_real_bathymetry,
            )?;

            let est_steps = if dt.is_finite() && dt > 0.0 {
                (req.t_end_s / dt).clamp(1.0, 1.0e9)
            } else {
                1.0
            };
            let work = (grid.nx as u64)
                .saturating_mul(grid.ny as u64)
                .saturating_mul(est_steps as u64);
            if work > SWE_MAX_CELL_STEPS {
                return Err(format!(
                    "simulation too expensive (~{} cell-steps; cap {})",
                    work, SWE_MAX_CELL_STEPS
                ));
            }

            // Stream the initial or restored snapshot immediately.
            let initial_snapshot =
                grid.snapshot_with_gauge_samples(&req.gauge_points, Some(&diagnostics));
            on_snapshot
                .send(initial_snapshot)
                .map_err(|error| format!("simulation snapshot receiver closed: {error}"))?;
            if start_interval == 0 {
                checkpoint_writer.borrow_mut().record_gauges(&grid);
            }
            render_stream.send_frame(&grid)?;

            let max_field_threshold_m =
                MaxFieldAccumulator::threshold_for_amplitude(req.initial_amplitude_m);
            let max_field_acc = std::cell::RefCell::new(restored_max_field.unwrap_or_else(|| {
                let mut accumulator =
                    MaxFieldAccumulator::new(grid.nx * grid.ny, max_field_threshold_m);
                accumulator.observe(&grid);
                accumulator
            }));

            let stream_ctx = StreamSimulationContext {
                cancel: cancel.as_ref(),
                on_snapshot: &on_snapshot,
                diagnostics: Some(&diagnostics),
                gauges: &req.gauge_points,
                max_field: &max_field_acc,
                render: Some(&render_stream),
                quality_baseline: &quality_baseline,
                checkpoint: Some(&checkpoint_writer),
                snapshot_interval_offset: start_interval,
            };
            let used_gpu = stream_simulation_dispatch(
                &mut grid,
                dt,
                &snapshot_schedule[start_interval..],
                &stream_ctx,
            )?;
            let run_quality = quality_baseline.assess(&grid, dt);
            publish_run_quality(&run_quality);
            if let Some(failure) = &run_quality.failure {
                diagnostics(&format!("numerical-integrity violation: {failure}"));
                return Err(format!(
                    "simulation rejected by numerical-integrity gate: {failure}"
                ));
            }
            render_stream.finish(&grid)?;
            let cancelled = cancel.load(Ordering::Acquire);
            if cancelled {
                let next_interval =
                    checkpoint_writer.borrow().identity.next_snapshot_interval as usize;
                checkpoint_writer.borrow_mut().record_gauges(&grid);
                checkpoint_writer.borrow_mut().maybe_write(
                    &grid,
                    &max_field_acc.borrow(),
                    next_interval,
                    true,
                    Some(&diagnostics),
                );
            } else {
                checkpoint_writer.borrow().remove_completed();
                if let Some(resume_run_id) = resume_run_id.as_deref() {
                    let _ = crate::physics::solver::checkpoint::remove(
                        &checkpoint_writer.borrow().root,
                        resume_run_id,
                    );
                }
            }
            let max_field = max_field_acc
                .into_inner()
                .into_product(&grid, Some(&diagnostics));
            Ok(SimulateGridStreamMeta {
                run_id: response_run_id,
                lifecycle: if cancelled {
                    SimulationRunLifecycle::Cancelled
                } else {
                    SimulationRunLifecycle::Completed
                },
                dt_s: dt,
                nx,
                ny,
                bathymetry_asset_id: req.bathymetry_asset_id.clone(),
                used_gpu,
                n_snapshots: render_stream.frame_count().min(u32::MAX as u64) as u32,
                cancelled,
                max_field: Some(max_field),
                render_scenario_id: Some(scenario_id),
                render_frame_count: render_stream.frame_count(),
                run_quality,
                recovered_gauge_history,
            })
        })();
        unregister_simulation(&worker_run_id, &cancel);
        result
    })
    .await
    .map_err(|e| format!("simulate_grid_streaming worker failed: {e}"))?
}

struct RenderStreamContext<'a> {
    channel: &'a tauri::ipc::Channel<Response>,
    scenario_id: String,
    scenario_sha256: String,
    tick_duration_s: f64,
    next_sequence: Cell<u64>,
    frame_count: Cell<u64>,
    send_error: RefCell<Option<String>>,
}

impl<'a> RenderStreamContext<'a> {
    fn new(
        channel: &'a tauri::ipc::Channel<Response>,
        scenario_id: String,
        scenario_sha256: String,
        tick_duration_s: f64,
    ) -> Self {
        Self {
            channel,
            scenario_id,
            scenario_sha256,
            tick_duration_s,
            next_sequence: Cell::new(1),
            frame_count: Cell::new(0),
            send_error: RefCell::new(None),
        }
    }

    fn send_scenario(
        &self,
        canonical_scenario: &[u8],
        origin: crate::data::geodesy::GeodeticPosition,
        uses_bundled_bathymetry: bool,
    ) -> Result<(), String> {
        let packet = crate::render_protocol::scenario_packet(
            &self.scenario_id,
            canonical_scenario,
            origin,
            self.tick_duration_s,
            crate::render_protocol::PhysicsProvenanceV1 {
                authority: "rust".into(),
                model_versions: vec![crate::render_protocol::ModelVersionV1 {
                    component: "shallow_water_solver".into(),
                    version: "1.0.0".into(),
                }],
                geodesy_contract_version: crate::data::geodesy::CONTRACT_VERSION.into(),
                surface_mask_version: None,
                bathymetry_asset_id: Some(if uses_bundled_bathymetry {
                    "cataclysm-coarse-bathymetry-v1".into()
                } else {
                    "uniform-depth-request".into()
                }),
                solver_backend: "runtime-selected-cpu-or-gpu".into(),
            },
        )?;
        self.channel
            .send(Response::new(packet))
            .map_err(|error| format!("failed to send render scenario packet: {error}"))
    }

    fn send_frame(&self, grid: &SwGrid) -> Result<(), String> {
        let sequence = self.next_sequence.get();
        let packet = crate::render_protocol::frame_packet_from_grid(
            &self.scenario_id,
            &self.scenario_sha256,
            grid,
            self.tick_duration_s,
            sequence,
        )?;
        self.channel
            .send(Response::new(packet))
            .map_err(|error| format!("failed to send render frame packet: {error}"))?;
        self.next_sequence.set(sequence.saturating_add(1));
        self.frame_count
            .set(self.frame_count.get().saturating_add(1));
        Ok(())
    }

    fn try_send_frame(&self, grid: &SwGrid) -> bool {
        if self.send_error.borrow().is_some() {
            return false;
        }
        if let Err(error) = self.send_frame(grid) {
            *self.send_error.borrow_mut() = Some(error);
            return false;
        }
        true
    }

    fn finish(&self, grid: &SwGrid) -> Result<(), String> {
        if let Some(error) = self.send_error.borrow_mut().take() {
            return Err(error);
        }
        let packet = crate::render_protocol::end_packet(
            &self.scenario_id,
            &self.scenario_sha256,
            grid.step_index,
            self.frame_count.get(),
            self.next_sequence.get(),
        )?;
        self.channel
            .send(Response::new(packet))
            .map_err(|error| format!("failed to send render end packet: {error}"))
    }

    fn frame_count(&self) -> u64 {
        self.frame_count.get()
    }
}

struct StreamSimulationContext<'a> {
    cancel: &'a AtomicBool,
    on_snapshot: &'a tauri::ipc::Channel<GridSnapshot>,
    diagnostics: Option<&'a DiagnosticSink<'a>>,
    gauges: &'a [GridGaugePoint],
    /// Max-field accumulator, observed after every accepted solver step.
    /// RefCell because the context is shared immutably down the dispatch fns.
    max_field: &'a std::cell::RefCell<MaxFieldAccumulator>,
    render: Option<&'a RenderStreamContext<'a>>,
    quality_baseline: &'a QualityBaseline,
    checkpoint: Option<&'a RefCell<StreamCheckpointWriter>>,
    snapshot_interval_offset: usize,
}

fn validate_checkpoint_interval(value: Option<u64>) -> Result<Duration, String> {
    let seconds = value.unwrap_or(60);
    if !(15..=3_600).contains(&seconds) {
        return Err("checkpoint_interval_s must be in [15, 3600]".to_string());
    }
    Ok(Duration::from_secs(seconds))
}

struct StreamCheckpointWriter {
    root: PathBuf,
    identity: crate::physics::solver::checkpoint::CheckpointIdentity,
    gauge_points: Vec<GridGaugePoint>,
    gauge_history: Vec<crate::physics::solver::checkpoint::CheckpointGaugeFrame>,
    interval: Duration,
    last_write: Instant,
    disabled: bool,
}

impl StreamCheckpointWriter {
    fn new(
        root: PathBuf,
        run_id: &str,
        req: &SimulateGridRequest,
        dt_s: f64,
        interval: Duration,
    ) -> Result<Self, String> {
        let canonical = serde_json::to_vec(req)
            .map_err(|error| format!("failed to identify checkpoint scenario: {error}"))?;
        let mut settings_material = b"cataclysm-checkpoint-settings-v1\0".to_vec();
        settings_material.extend_from_slice(&canonical);
        let data_source =
            req.bathymetry_asset_id
                .as_deref()
                .unwrap_or(if req.use_real_bathymetry {
                    "cataclysm-coarse-bathymetry-v1"
                } else {
                    "cataclysm-uniform-depth-v1"
                });
        let data_material = format!("cataclysm-checkpoint-data-v1\0{data_source}");
        let created_at_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |duration| {
                duration.as_millis().min(u64::MAX as u128) as u64
            });
        Ok(Self {
            root,
            identity: crate::physics::solver::checkpoint::CheckpointIdentity {
                run_id: run_id.to_string(),
                scenario_sha256: crate::render_protocol::sha256_hex(&canonical),
                settings_sha256: crate::render_protocol::sha256_hex(&settings_material),
                data_sha256: crate::render_protocol::sha256_hex(data_material.as_bytes()),
                solver_version: "shallow-water-solver-1.0.0".to_string(),
                created_at_ms,
                dt_s,
                t_end_s: req.t_end_s,
                n_snapshots: req.n_snapshots.min(u32::MAX as usize) as u32,
                next_snapshot_interval: 0,
            },
            gauge_points: req.gauge_points.clone(),
            gauge_history: Vec::with_capacity(req.n_snapshots),
            interval,
            last_write: Instant::now(),
            disabled: false,
        })
    }

    fn record_gauges(&mut self, grid: &SwGrid) {
        if self
            .gauge_history
            .last()
            .is_some_and(|frame| frame.time_s.to_bits() == grid.t_s.to_bits())
        {
            return;
        }
        self.gauge_history
            .push(crate::physics::solver::checkpoint::CheckpointGaugeFrame {
                time_s: grid.t_s,
                eta_m: grid.sample_gauge_values(&self.gauge_points),
            });
    }

    fn maybe_write(
        &mut self,
        grid: &SwGrid,
        max_field: &MaxFieldAccumulator,
        next_interval: usize,
        force: bool,
        diagnostics: Option<&DiagnosticSink<'_>>,
    ) {
        self.identity.next_snapshot_interval = next_interval.min(u32::MAX as usize) as u32;
        if self.disabled || (!force && self.last_write.elapsed() < self.interval) {
            return;
        }
        match crate::physics::solver::checkpoint::write_latest_state_with_gauges(
            &self.root,
            &self.identity,
            grid,
            max_field,
            &self.gauge_points,
            &self.gauge_history,
        ) {
            Ok(_) => self.last_write = Instant::now(),
            Err(error) => {
                self.disabled = true;
                crate::physics::solver::report_diagnostic(
                    diagnostics,
                    format!("[solver] checkpointing disabled for this run: {error}"),
                );
            }
        }
    }

    fn remove_completed(&self) {
        let _ = crate::physics::solver::checkpoint::remove(&self.root, &self.identity.run_id);
    }
}

fn checkpoint_gauge_history_for_ipc(
    checkpoint: &crate::physics::solver::checkpoint::SolverCheckpoint,
) -> Vec<GridGaugeHistoryFrame> {
    checkpoint
        .gauge_history
        .iter()
        .map(|frame| GridGaugeHistoryFrame {
            time_s: frame.time_s,
            gauge_samples: checkpoint
                .gauge_points
                .iter()
                .zip(&frame.eta_m)
                .map(|(gauge, eta_m)| GridGaugeSample {
                    id: gauge.id.clone(),
                    eta_m: *eta_m,
                })
                .collect(),
        })
        .collect()
}

fn verify_resume_checkpoint(
    checkpoint: &crate::physics::solver::checkpoint::SolverCheckpoint,
    expected: &crate::physics::solver::checkpoint::CheckpointIdentity,
    expected_gauges: &[GridGaugePoint],
    initial_grid: &SwGrid,
    snapshot_schedule: &[usize],
) -> Result<(), String> {
    let actual = &checkpoint.identity;
    if actual.scenario_sha256 != expected.scenario_sha256
        || actual.settings_sha256 != expected.settings_sha256
        || actual.data_sha256 != expected.data_sha256
        || actual.solver_version != expected.solver_version
        || actual.dt_s.to_bits() != expected.dt_s.to_bits()
        || actual.t_end_s.to_bits() != expected.t_end_s.to_bits()
        || actual.n_snapshots != expected.n_snapshots
    {
        return Err(
            "checkpoint does not match the current scenario, settings, data, or solver version"
                .to_string(),
        );
    }
    if checkpoint.gauge_points != expected_gauges {
        return Err("checkpoint gauges do not match the current run request".to_string());
    }
    let start_interval = actual.next_snapshot_interval as usize;
    if start_interval > snapshot_schedule.len() {
        return Err("checkpoint progress exceeds the deterministic snapshot schedule".to_string());
    }
    let expected_steps = snapshot_schedule[..start_interval]
        .iter()
        .try_fold(0_u64, |total, steps| total.checked_add(*steps as u64))
        .ok_or_else(|| "checkpoint step schedule overflow".to_string())?;
    let expected_time = expected_steps as f64 * expected.dt_s;
    let time_tolerance = (expected_time.abs() * 1.0e-12).max(1.0e-9);
    let grid = &checkpoint.grid;
    if grid.step_index != expected_steps
        || (grid.t_s - expected_time).abs() > time_tolerance
        || grid.nx != initial_grid.nx
        || grid.ny != initial_grid.ny
        || grid.dlon_deg.to_bits() != initial_grid.dlon_deg.to_bits()
        || grid.dlat_deg.to_bits() != initial_grid.dlat_deg.to_bits()
        || grid.west_lon.to_bits() != initial_grid.west_lon.to_bits()
        || grid.south_lat.to_bits() != initial_grid.south_lat.to_bits()
        || grid.colormap != initial_grid.colormap
        || grid.h_m != initial_grid.h_m
    {
        return Err(
            "checkpoint grid or progress does not match the deterministic run plan".to_string(),
        );
    }
    Ok(())
}

fn stream_simulation_cpu(
    grid: &mut SwGrid,
    dt_s: f64,
    snapshot_schedule: &[usize],
    ctx: &StreamSimulationContext<'_>,
) -> Result<(), String> {
    stream_simulation_cpu_from(grid, dt_s, snapshot_schedule, 0, None, ctx)
}

/// Continue the scheduled snapshot stream from an already-committed solver
/// state. `first_take_remaining` is used when a GPU failed partway through the
/// interval at `start_interval`; later intervals use the shared deterministic
/// plan.
fn stream_simulation_cpu_from(
    grid: &mut SwGrid,
    dt_s: f64,
    snapshot_schedule: &[usize],
    start_interval: usize,
    first_take_remaining: Option<usize>,
    ctx: &StreamSimulationContext<'_>,
) -> Result<(), String> {
    let stepper = TimeStepper::new(dt_s);
    for (interval, &scheduled_take) in snapshot_schedule.iter().enumerate().skip(start_interval) {
        if ctx.cancel.load(Ordering::Acquire) {
            break;
        }
        let take = if interval == start_interval {
            first_take_remaining.unwrap_or(scheduled_take)
        } else {
            scheduled_take
        };
        if take > 0 {
            match stepper.step_cancellable_checked(
                grid,
                take,
                Some(ctx.cancel),
                ctx.quality_baseline,
                &mut |state| ctx.max_field.borrow_mut().observe(state),
            ) {
                Ok(true) => {}
                Ok(false) => break,
                Err(quality) => {
                    publish_run_quality(&quality);
                    let failure = quality
                        .failure
                        .clone()
                        .unwrap_or_else(|| "unknown numerical-integrity violation".to_string());
                    return Err(format!(
                        "simulation rejected at step {}: {failure}",
                        quality.accepted_steps
                    ));
                }
            }
        }
        if ctx
            .on_snapshot
            .send(grid.snapshot_with_gauge_samples(ctx.gauges, ctx.diagnostics))
            .is_err()
        {
            ctx.cancel.store(true, Ordering::Release);
            break;
        }
        if let Some(checkpoint) = ctx.checkpoint {
            checkpoint.borrow_mut().record_gauges(grid);
        }
        if let Some(render) = ctx.render
            && !render.try_send_frame(grid)
        {
            ctx.cancel.store(true, Ordering::Release);
            break;
        }
        if let Some(checkpoint) = ctx.checkpoint {
            let max_field = ctx.max_field.borrow();
            checkpoint.borrow_mut().maybe_write(
                grid,
                &max_field,
                ctx.snapshot_interval_offset
                    .saturating_add(interval)
                    .saturating_add(1),
                false,
                ctx.diagnostics,
            );
        }
    }
    Ok(())
}

#[cfg(feature = "gpu")]
fn stream_simulation_dispatch(
    grid: &mut SwGrid,
    dt_s: f64,
    snapshot_schedule: &[usize],
    ctx: &StreamSimulationContext<'_>,
) -> Result<bool, String> {
    use crate::physics::solver::BoundaryMode;
    use crate::physics::solver::gpu::GpuTimeStepper;

    let sponge_width = match BoundaryMode::default_sponge() {
        BoundaryMode::Sponge { width_cells } => width_cells as u32,
        BoundaryMode::ZeroFlux => 0,
    };
    if let Some(gpu) = GpuTimeStepper::new_with_diagnostics(
        grid,
        dt_s,
        crate::physics::constants::MANNING_N_COASTAL,
        sponge_width,
        true,
        ctx.diagnostics,
    ) {
        for (interval, &take) in snapshot_schedule.iter().enumerate() {
            if ctx.cancel.load(Ordering::Acquire) {
                break;
            }
            let mut completed = 0usize;
            for _ in 0..take {
                if ctx.cancel.load(Ordering::Acquire) {
                    return Ok(true);
                }
                if !gpu.step_with_diagnostics(grid, 1, ctx.diagnostics) {
                    let remaining = take.saturating_sub(completed);
                    stream_simulation_cpu_from(
                        grid,
                        dt_s,
                        snapshot_schedule,
                        interval,
                        Some(remaining),
                        ctx,
                    )?;
                    return Ok(false);
                }
                let quality = ctx.quality_baseline.assess(grid, dt_s);
                if let Some(failure) = quality.failure.clone() {
                    publish_run_quality(&quality);
                    return Err(format!(
                        "GPU simulation rejected at step {}: {failure}",
                        quality.accepted_steps
                    ));
                }
                completed = completed.saturating_add(1);
                ctx.max_field.borrow_mut().observe(grid);
            }
            if ctx
                .on_snapshot
                .send(grid.snapshot_with_gauge_samples(ctx.gauges, ctx.diagnostics))
                .is_err()
            {
                ctx.cancel.store(true, Ordering::Release);
                break;
            }
            if let Some(checkpoint) = ctx.checkpoint {
                checkpoint.borrow_mut().record_gauges(grid);
            }
            if let Some(render) = ctx.render
                && !render.try_send_frame(grid)
            {
                ctx.cancel.store(true, Ordering::Release);
                break;
            }
            if let Some(checkpoint) = ctx.checkpoint {
                let max_field = ctx.max_field.borrow();
                checkpoint.borrow_mut().maybe_write(
                    grid,
                    &max_field,
                    ctx.snapshot_interval_offset
                        .saturating_add(interval)
                        .saturating_add(1),
                    false,
                    ctx.diagnostics,
                );
            }
        }
        return Ok(true);
    }
    stream_simulation_cpu(grid, dt_s, snapshot_schedule, ctx)?;
    Ok(false)
}

#[cfg(not(feature = "gpu"))]
fn stream_simulation_dispatch(
    grid: &mut SwGrid,
    dt_s: f64,
    snapshot_schedule: &[usize],
    ctx: &StreamSimulationContext<'_>,
) -> Result<bool, String> {
    stream_simulation_cpu(grid, dt_s, snapshot_schedule, ctx)?;
    Ok(false)
}

#[cfg(feature = "gpu")]
#[allow(clippy::too_many_arguments)]
fn run_simulation_dispatch(
    grid: &mut SwGrid,
    dt_s: f64,
    t_end_s: f64,
    n_snapshots: usize,
    cancel: &AtomicBool,
    diagnostics: Option<&DiagnosticSink<'_>>,
    gauges: &[GridGaugePoint],
    max_field_threshold_m: f64,
) -> (Vec<GridSnapshot>, bool, Option<MaxFieldProduct>) {
    use crate::physics::solver::BoundaryMode;
    use crate::physics::solver::gpu::GpuTimeStepper;

    let sponge_width = match BoundaryMode::default_sponge() {
        BoundaryMode::Sponge { width_cells } => width_cells as u32,
        BoundaryMode::ZeroFlux => 0,
    };
    if let Some(gpu) = GpuTimeStepper::new_with_diagnostics(
        grid,
        dt_s,
        crate::physics::constants::MANNING_N_COASTAL,
        sponge_width,
        true,
        diagnostics,
    ) {
        let pristine = grid.clone();
        let mut acc = MaxFieldAccumulator::new(grid.nx * grid.ny, max_field_threshold_m);
        if let Some(snaps) = run_simulation_gpu(
            grid,
            &gpu,
            dt_s,
            t_end_s,
            n_snapshots,
            cancel,
            diagnostics,
            gauges,
            &mut |g| acc.observe(g),
        ) {
            let product = acc.into_product(grid, diagnostics);
            return (snaps, true, Some(product));
        }
        // Discard partial-GPU observations; CPU rerun observes fresh below.
        *grid = pristine;
    }
    let stepper = TimeStepper::new(dt_s);
    let mut acc = MaxFieldAccumulator::new(grid.nx * grid.ny, max_field_threshold_m);
    let snaps = run_simulation_with_gauge_samples(
        grid,
        &stepper,
        t_end_s,
        n_snapshots,
        Some(cancel),
        diagnostics,
        gauges,
        &mut |g| acc.observe(g),
    );
    let product = acc.into_product(grid, diagnostics);
    (snaps, false, Some(product))
}

#[cfg(not(feature = "gpu"))]
#[allow(clippy::too_many_arguments)]
fn run_simulation_dispatch(
    grid: &mut SwGrid,
    dt_s: f64,
    t_end_s: f64,
    n_snapshots: usize,
    cancel: &AtomicBool,
    diagnostics: Option<&DiagnosticSink<'_>>,
    gauges: &[GridGaugePoint],
    max_field_threshold_m: f64,
) -> (Vec<GridSnapshot>, bool, Option<MaxFieldProduct>) {
    let stepper = TimeStepper::new(dt_s);
    let mut acc = MaxFieldAccumulator::new(grid.nx * grid.ny, max_field_threshold_m);
    let snaps = run_simulation_with_gauge_samples(
        grid,
        &stepper,
        t_end_s,
        n_snapshots,
        Some(cancel),
        diagnostics,
        gauges,
        &mut |g| acc.observe(g),
    );
    let product = acc.into_product(grid, diagnostics);
    (snaps, false, Some(product))
}

/// GPU-side `run_simulation`: emits the same `n_snapshots` evenly-spaced
/// snapshots as the CPU path while reading back every solver step for
/// quantitative accumulation. Snapshot encoding remains independently paced.
/// Returns `None` if any GPU step fails (map/poll error or non-finite field),
/// signalling the dispatcher to fall back to the CPU path.
#[cfg(feature = "gpu")]
#[allow(clippy::too_many_arguments)]
fn run_simulation_gpu(
    grid: &mut SwGrid,
    gpu: &crate::physics::solver::gpu::GpuTimeStepper,
    dt_s: f64,
    t_end_s: f64,
    n_snapshots: usize,
    cancel: &AtomicBool,
    diagnostics: Option<&DiagnosticSink<'_>>,
    gauges: &[GridGaugePoint],
    observe: &mut dyn FnMut(&SwGrid),
) -> Option<Vec<GridSnapshot>> {
    let n = n_snapshots.max(2);
    let mut snaps = Vec::with_capacity(n);
    snaps.push(grid.snapshot_with_gauge_samples(gauges, diagnostics));
    observe(grid);
    if !t_end_s.is_finite() || t_end_s < 0.0 {
        return Some(snaps);
    }
    for take in snapshot_step_schedule(t_end_s, dt_s, n) {
        if cancel.load(Ordering::Acquire) {
            break;
        }
        let mut remaining = take;
        while remaining > 0 {
            if cancel.load(Ordering::Acquire) {
                return Some(snaps);
            }
            if !gpu.step_with_diagnostics(grid, 1, diagnostics) {
                return None;
            }
            observe(grid);
            remaining -= 1;
        }
        snaps.push(grid.snapshot_with_gauge_samples(gauges, diagnostics));
    }
    Some(snaps)
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

    fn source_grid_request(source_geometry: Option<InitialSourceGeometry>) -> SimulateGridRequest {
        SimulateGridRequest {
            source: good_loc(),
            initial_amplitude_m: 4.0,
            source_sigma_m: 50_000.0,
            source_geometry,
            mean_depth_m: 4_000.0,
            use_real_bathymetry: false,
            bathymetry_asset_id: None,
            box_half_size_deg: 2.0,
            cells_per_deg: 10.0,
            t_end_s: 60.0,
            n_snapshots: 2,
            include_lamb_wave: false,
            lamb_wave_peak_pressure_pa: None,
            lamb_wave_source_radius_m: None,
            colormap: "diverging".into(),
            gauge_points: vec![],
        }
    }

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
        let oversize_error =
            register_simulation("test-memory-oversize", &oversize, &maximum_memory)
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
            colormap: "diverging".to_string(),
            gauge_points: vec![],
        });
        assert!(res.is_err());
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
            colormap: "rainbow".to_string(),
            gauge_points: vec![],
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
            colormap: "viridis".to_string(),
            gauge_points: vec![],
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
            colormap: "viridis".to_string(),
            gauge_points: vec![],
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
            colormap: "viridis".to_string(),
            gauge_points: vec![],
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
            colormap: "viridis".to_string(),
            gauge_points: vec![],
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
            colormap: "diverging".to_string(),
            gauge_points: vec![GridGaugePoint {
                id: "bad".to_string(),
                lat_deg: 91.0,
                lon_deg: 0.0,
            }],
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
        assert_eq!(validate_checkpoint_interval(Some(15)).unwrap().as_secs(), 15);
        assert_eq!(
            validate_checkpoint_interval(Some(3_600))
                .unwrap()
                .as_secs(),
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
        let mut uninterrupted_gauges =
            vec![crate::physics::solver::checkpoint::CheckpointGaugeFrame {
                time_s: uninterrupted.t_s,
                eta_m: uninterrupted.sample_gauge_values(&req.gauge_points),
            }];
        for &steps in &schedule {
            assert!(stepper.step_cancellable_observed(
                &mut uninterrupted,
                steps,
                None,
                &mut |grid| uninterrupted_max.observe(grid),
            ));
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
                stepper
                    .step_cancellable_observed(&mut partial, steps, None, &mut |grid| partial_max
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
                stepper
                    .step_cancellable_observed(&mut resumed, steps, None, &mut |grid| resumed_max
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
}
