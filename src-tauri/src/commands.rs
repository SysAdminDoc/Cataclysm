//! Tauri command handlers exposed to the React frontend.
//! Every function returns serde-serializable types; errors are stringified.

use serde::{Deserialize, Serialize};

use crate::physics::{
    asteroid::{far_field_amplitude_m as impact_far_field, AsteroidImpact},
    earthquake::EarthquakeSource,
    landslide::LandslideSource,
    nuclear::{far_field_amplitude_m as nuclear_far_field, NuclearBurst},
    shallow_water::{
        long_wave_travel_time_s, sample_wavefront, synolakis_runup_m, PropagationSnapshot,
    },
    InitialDisplacement,
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

#[derive(Debug, Serialize, Deserialize)]
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

#[derive(Debug, Serialize, Deserialize)]
pub struct RunPresetResponse {
    pub preset: Preset,
    pub initial: InitialDisplacement,
    pub wavefront: PropagationSnapshot,
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
