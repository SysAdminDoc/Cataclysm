//! Minimal browser ABI over Cataclysm's shared Rust source physics.
//!
//! The ABI deliberately uses JSON in linear memory instead of generated JS
//! glue. That keeps the checked-in browser module auditable and lets Vite load
//! it with the platform WebAssembly API alone.

use std::{cell::RefCell, mem, slice};

use serde::{Deserialize, Serialize};
use serde_json::Value;

// `data` must be declared before `physics`: direct_hazard resolves its input
// validators through `crate::data::source_input_contract`.
#[allow(dead_code)]
mod data;

#[allow(dead_code)]
#[path = "../../src/physics/mod.rs"]
mod physics;

use physics::{
    InitialDisplacement,
    asteroid::AsteroidImpact,
    direct_hazard::{
        AsteroidHazardRequest, NuclearHazardRequest, simulate_asteroid_hazard,
        simulate_nuclear_hazard,
    },
    earthquake::EarthquakeSource,
    landslide::LandslideSource,
    meteotsunami::MeteotsunamiSource,
    nuclear::NuclearBurst,
    screening::{ScreeningPoint, attenuation_curve, screen_point},
    shallow_water::sample_wavefront,
};

#[derive(Debug, Deserialize)]
#[serde(tag = "kind")]
enum SourceInput {
    Asteroid { source: AsteroidImpact },
    Nuclear { source: NuclearBurst },
    Earthquake { source: EarthquakeSource },
    Landslide { source: LandslideSource },
    Meteotsunami { source: MeteotsunamiSource },
}

impl SourceInput {
    fn initial_displacement(&self) -> InitialDisplacement {
        match self {
            Self::Asteroid { source } => source.initial_displacement(),
            Self::Nuclear { source } => source.initial_displacement(),
            Self::Earthquake { source } => source.initial_displacement(),
            Self::Landslide { source } => source.initial_displacement(),
            Self::Meteotsunami { source } => source.initial_displacement(),
        }
    }
}

#[derive(Debug, Deserialize)]
struct RunupPointInput {
    lat: f64,
    lon: f64,
    beach_slope_deg: f64,
    offshore_depth_m: f64,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case")]
enum Request {
    Initial {
        input: SourceInput,
    },
    Wavefront {
        initial_amplitude_m: f64,
        cavity_radius_m: f64,
        decay_alpha: f64,
        mean_depth_m: f64,
        time_s: f64,
        n_samples: usize,
    },
    Attenuation {
        initial_amplitude_m: f64,
        cavity_radius_m: f64,
        decay_alpha: f64,
        max_range_m: f64,
        n_samples: usize,
    },
    Runup {
        source: physics::GeoPoint,
        initial_amplitude_m: f64,
        cavity_radius_m: f64,
        is_impact: bool,
        mean_depth_m: f64,
        time_s: f64,
        points: Vec<RunupPointInput>,
    },
    Inspect {
        source: physics::GeoPoint,
        initial_amplitude_m: f64,
        cavity_radius_m: f64,
        is_impact: bool,
        mean_depth_m: f64,
        time_s: f64,
        click_lat: f64,
        click_lon: f64,
        beach_slope_deg: f64,
        offshore_depth_m: f64,
    },
    /// Full Rust-authoritative asteroid impact effects (rings, crater, thermal
    /// and blast radii, seismic, coupled tsunami). Same model the desktop
    /// `simulate_asteroid_hazard` command runs.
    AsteroidHazard {
        request: AsteroidHazardRequest,
    },
    /// Full Rust-authoritative nuclear detonation effects (fireball, blast and
    /// thermal rings, fallout, casualties). Same model the desktop
    /// `simulate_nuclear_hazard` command runs.
    NuclearHazard {
        request: NuclearHazardRequest,
    },
}

#[derive(Serialize)]
struct Response {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

thread_local! {
    static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

fn execute(request: Request) -> Result<Value, String> {
    match request {
        Request::Initial { input } => serde_json::to_value(input.initial_displacement()),
        Request::Wavefront {
            initial_amplitude_m,
            cavity_radius_m,
            decay_alpha,
            mean_depth_m,
            time_s,
            n_samples,
        } => serde_json::to_value(sample_wavefront(
            initial_amplitude_m,
            cavity_radius_m,
            decay_alpha,
            mean_depth_m,
            time_s,
            n_samples.clamp(2, 2_048),
        )),
        Request::Attenuation {
            initial_amplitude_m,
            cavity_radius_m,
            decay_alpha,
            max_range_m,
            n_samples,
        } => {
            if !(2..=2_048).contains(&n_samples) {
                return Err("n_samples must be in [2, 2048]".into());
            }
            serde_json::to_value(attenuation_curve(
                initial_amplitude_m,
                cavity_radius_m,
                decay_alpha,
                max_range_m,
                n_samples,
            ))
        }
        Request::Runup {
            source,
            initial_amplitude_m,
            cavity_radius_m,
            is_impact,
            mean_depth_m,
            time_s,
            points,
        } => serde_json::to_value(
            points
                .into_iter()
                .map(|point| {
                    screen_point(
                        source,
                        initial_amplitude_m,
                        cavity_radius_m,
                        is_impact,
                        mean_depth_m,
                        time_s,
                        ScreeningPoint {
                            lat: point.lat,
                            lon: point.lon,
                            beach_slope_deg: point.beach_slope_deg,
                            offshore_depth_m: point.offshore_depth_m,
                        },
                    )
                })
                .collect::<Vec<_>>(),
        ),
        Request::Inspect {
            source,
            initial_amplitude_m,
            cavity_radius_m,
            is_impact,
            mean_depth_m,
            time_s,
            click_lat,
            click_lon,
            beach_slope_deg,
            offshore_depth_m,
        } => serde_json::to_value(screen_point(
            source,
            initial_amplitude_m,
            cavity_radius_m,
            is_impact,
            mean_depth_m,
            time_s,
            ScreeningPoint {
                lat: click_lat,
                lon: click_lon,
                beach_slope_deg,
                offshore_depth_m,
            },
        )),
        // The direct-hazard models return `Result<HazardResult, String>`, so
        // short-circuit here instead of feeding the shared serde `.map_err`.
        Request::AsteroidHazard { request } => {
            let result = simulate_asteroid_hazard(request)?;
            return serde_json::to_value(result).map_err(|error| error.to_string());
        }
        Request::NuclearHazard { request } => {
            let result = simulate_nuclear_hazard(request)?;
            return serde_json::to_value(result).map_err(|error| error.to_string());
        }
    }
    .map_err(|error| error.to_string())
}

fn set_output(response: Response) {
    OUTPUT.with(|output| {
        let bytes = serde_json::to_vec(&response).unwrap_or_else(|_| {
            br#"{"ok":false,"error":"could not serialize browser physics response"}"#.to_vec()
        });
        *output.borrow_mut() = bytes;
    });
}

#[unsafe(no_mangle)]
pub extern "C" fn cataclysm_alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len);
    let pointer = buffer.as_mut_ptr();
    mem::forget(buffer);
    pointer
}

/// # Safety
/// `pointer` and `capacity` must be values returned by `cataclysm_alloc`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn cataclysm_dealloc(pointer: *mut u8, capacity: usize) {
    if capacity == 0 {
        return;
    }
    // SAFETY: the browser adapter returns exactly the pointer and capacity
    // allocated by `cataclysm_alloc`, after the compute call has finished.
    unsafe { drop(Vec::from_raw_parts(pointer, 0, capacity)) };
}

/// Parse and execute one UTF-8 JSON request from WASM linear memory.
#[unsafe(no_mangle)]
pub extern "C" fn cataclysm_compute(pointer: *const u8, len: usize) -> i32 {
    let result = (|| {
        if pointer.is_null() || len == 0 || len > 1_048_576 {
            return Err("browser physics request must contain 1..1048576 bytes".into());
        }
        // SAFETY: JavaScript writes exactly `len` bytes into the allocation it
        // received from `cataclysm_alloc` before making this synchronous call.
        let bytes = unsafe { slice::from_raw_parts(pointer, len) };
        let request =
            serde_json::from_slice::<Request>(bytes).map_err(|error| error.to_string())?;
        execute(request)
    })();
    match result {
        Ok(value) => {
            set_output(Response {
                ok: true,
                value: Some(value),
                error: None,
            });
            0
        }
        Err(error) => {
            set_output(Response {
                ok: false,
                value: None,
                error: Some(error),
            });
            1
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn cataclysm_result_ptr() -> *const u8 {
    OUTPUT.with(|output| output.borrow().as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn cataclysm_result_len() -> usize {
    OUTPUT.with(|output| output.borrow().len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_source_request() {
        let request: Request = serde_json::from_value(serde_json::json!({
            "operation": "initial",
            "input": {
                "kind": "Asteroid",
                "source": {
                    "diameter_m": 1000.0,
                    "density_kg_m3": 3000.0,
                    "velocity_m_s": 20000.0,
                    "angle_deg": 45.0,
                    "water_depth_m": 4500.0,
                    "location": { "lat_deg": 0.0, "lon_deg": 0.0, "depth_m": 4500.0 }
                }
            }
        }))
        .expect("request parses");
        let value = execute(request).expect("request executes");
        assert!(value["peak_amplitude_m"].as_f64().unwrap() > 0.0);
    }
}
