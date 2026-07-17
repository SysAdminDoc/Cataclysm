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
mod simulation;
mod system;
mod waves;
pub use direct::*;
pub use observations::*;
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
