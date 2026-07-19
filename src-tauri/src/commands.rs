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
    asteroid::AsteroidImpact,
    constants::R_EARTH_M,
    earthquake::EarthquakeSource,
    lamb_wave::{LAMB_WAVE_SPEED_M_S, LambWaveSource, proudman_resonance_depth_m},
    landslide::LandslideSource,
    meteotsunami::MeteotsunamiSource,
    nuclear::NuclearBurst,
    screening::{ScreeningPoint, screen_point},
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
use crate::presets::{Preset, PresetSource, all_presets, find_preset};
use tauri::{AppHandle, Emitter, Manager, ipc::Response};

mod direct;
mod observations;
mod scientific_export;
mod simulation;
mod system;
mod waves;
pub use direct::*;
pub use observations::*;
pub use scientific_export::*;
pub use simulation::{GridGaugeHistoryFrame, SimulateGridRequest, SimulateGridResponse, SimulateGridStreamMeta, SimulationRunLifecycle, simulate_grid, simulate_grid_streaming};
pub use system::*;
use simulation::*;
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
    let wavefront = if matches!(&preset.source, PresetSource::Meteotsunami(_)) {
        // A moving atmospheric source has no instantaneous radial wavefront;
        // its physically meaningful product comes from the forced SWE run.
        PropagationSnapshot { time_s: req.time_s, ranges_m: Vec::new(), amplitudes_m: Vec::new() }
    } else {
        sample_wavefront(
            initial.peak_amplitude_m,
            initial.cavity_radius_m,
            alpha,
            mean_depth_m,
            req.time_s,
            n_samples,
        )
    };
    Ok(RunPresetResponse {
        preset,
        initial,
        wavefront,
    })
}

#[tauri::command]
pub fn sample_preset_wavefront(
    preset_id: String,
    time_s: f64,
    n_samples: usize,
) -> Result<PropagationSnapshot, String> {
    if preset_id.is_empty() || preset_id.len() > 128 {
        return Err("preset_id must be 1..128 characters".into());
    }
    if !time_s.is_finite() || !(0.0..=SWE_MAX_T_END_S).contains(&time_s) {
        return Err(format!("time_s must be finite and in [0, {}]", SWE_MAX_T_END_S));
    }
    let preset = find_preset(&preset_id)
        .ok_or_else(|| format!("unknown preset id: {}", preset_id))?;
    if matches!(&preset.source, PresetSource::Meteotsunami(_)) {
        return Ok(PropagationSnapshot { time_s, ranges_m: Vec::new(), amplitudes_m: Vec::new() });
    }
    let initial = preset.source.initial_displacement();
    let alpha = preset.source.far_field_decay_alpha();
    let mean_depth_m = initial.center.depth_m.max(50.0);
    let n = n_samples.clamp(2, WAVEFRONT_MAX_SAMPLES);
    Ok(sample_wavefront(
        initial.peak_amplitude_m,
        initial.cavity_radius_m,
        alpha,
        mean_depth_m,
        time_s,
        n,
    ))
}

#[cfg(test)]
#[path = "commands/tests.rs"]
mod tests;
