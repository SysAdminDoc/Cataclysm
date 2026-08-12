//! Ephemeral exploratory wave sandbox.
//!
//! This is deliberately outside `SimulateGridRequest`, checkpoints, run
//! archives, comparison slots, and scientific exports. It keeps a small
//! in-memory list of bounded linear pulse perturbations and returns a visual
//! wavefront description as the user advances or pauses the sandbox. The
//! authoritative SWE pipeline remains untouched; this command is an
//! educational interaction controller, not a validated solver run.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;

const MAX_SESSIONS: usize = 16;
const MAX_POKES_PER_SESSION: usize = 12;
const MAX_SESSION_TIME_S: f64 = 180.0;
const MAX_ADVANCE_S: f64 = 0.5;
const MAX_WAVE_AGE_S: f64 = 120.0;
const MIN_AMPLITUDE_M: f64 = -5.0;
const MAX_AMPLITUDE_M: f64 = 5.0;
const MIN_RADIUS_M: f64 = 1_000.0;
const MAX_RADIUS_M: f64 = 100_000.0;
const REFERENCE_DEPTH_M: f64 = 4_000.0;
const GRAVITY_M_S2: f64 = 9.80665;

#[derive(Debug, Default)]
pub struct ExploratorySandboxState {
    sessions: Mutex<HashMap<String, ExploratorySession>>,
}

#[derive(Debug)]
struct ExploratorySession {
    time_s: f64,
    next_poke_id: u64,
    pokes: Vec<ExploratoryPoke>,
}

#[derive(Debug, Clone)]
struct ExploratoryPoke {
    id: u64,
    lat_deg: f64,
    lon_deg: f64,
    amplitude_m: f64,
    radius_m: f64,
    created_at_s: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ExploratoryWavePoke {
    pub lat_deg: f64,
    pub lon_deg: f64,
    pub amplitude_m: f64,
    pub radius_m: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ExploratoryWaveStepRequest {
    pub session_id: String,
    #[serde(default)]
    pub advance_s: f64,
    #[serde(default)]
    pub paused: bool,
    #[serde(default)]
    pub poke: Option<ExploratoryWavePoke>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ExploratoryWave {
    pub id: u64,
    pub lat_deg: f64,
    pub lon_deg: f64,
    /// Current radial distance of the idealized linear pulse, in meters.
    pub radius_m: f64,
    /// Presentation amplitude after bounded age attenuation, in meters.
    pub amplitude_m: f64,
    pub age_s: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExploratoryWaveStepResponse {
    pub schema_version: u32,
    pub session_id: String,
    pub time_s: f64,
    pub waves: Vec<ExploratoryWave>,
    pub model: &'static str,
}

fn validate_session_id(value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 80 {
        return Err("exploratory session_id must contain 1-80 characters".into());
    }
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("exploratory session_id contains an invalid character".into());
    }
    Ok(())
}

fn validate_poke(poke: &ExploratoryWavePoke) -> Result<(), String> {
    if !poke.lat_deg.is_finite() || !(-90.0..=90.0).contains(&poke.lat_deg) {
        return Err("exploratory poke latitude must be finite and in [-90, 90]".into());
    }
    if !poke.lon_deg.is_finite() || !(-180.0..=180.0).contains(&poke.lon_deg) {
        return Err("exploratory poke longitude must be finite and in [-180, 180]".into());
    }
    if !poke.amplitude_m.is_finite()
        || !(MIN_AMPLITUDE_M..=MAX_AMPLITUDE_M).contains(&poke.amplitude_m)
        || poke.amplitude_m == 0.0
    {
        return Err(format!(
            "exploratory poke amplitude must be non-zero and in [{MIN_AMPLITUDE_M}, {MAX_AMPLITUDE_M}] m"
        ));
    }
    if !poke.radius_m.is_finite() || !(MIN_RADIUS_M..=MAX_RADIUS_M).contains(&poke.radius_m) {
        return Err(format!(
            "exploratory poke radius must be in [{MIN_RADIUS_M}, {MAX_RADIUS_M}] m"
        ));
    }
    Ok(())
}

fn waves_for(session: &ExploratorySession) -> Vec<ExploratoryWave> {
    let speed_m_s = (GRAVITY_M_S2 * REFERENCE_DEPTH_M).sqrt();
    session
        .pokes
        .iter()
        .filter_map(|poke| {
            let age_s = (session.time_s - poke.created_at_s).max(0.0);
            if age_s > MAX_WAVE_AGE_S {
                return None;
            }
            let radius_m = (poke.radius_m + speed_m_s * age_s).min(2_000_000.0);
            let attenuation = (-age_s / 90.0).exp()
                * (-(radius_m / (poke.radius_m * 12.0).max(1.0))).exp();
            Some(ExploratoryWave {
                id: poke.id,
                lat_deg: poke.lat_deg,
                lon_deg: poke.lon_deg,
                radius_m,
                amplitude_m: poke.amplitude_m * attenuation,
                age_s,
            })
        })
        .collect()
}

#[tauri::command]
pub fn exploratory_wave_step(
    state: State<'_, ExploratorySandboxState>,
    req: ExploratoryWaveStepRequest,
) -> Result<ExploratoryWaveStepResponse, String> {
    validate_session_id(&req.session_id)?;
    if !req.advance_s.is_finite() || !(0.0..=MAX_ADVANCE_S).contains(&req.advance_s) {
        return Err(format!(
            "exploratory advance_s must be in [0, {MAX_ADVANCE_S}]"
        ));
    }
    if let Some(poke) = req.poke.as_ref() {
        validate_poke(poke)?;
    }

    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "exploratory sandbox state is unavailable".to_string())?;
    if !sessions.contains_key(&req.session_id) && sessions.len() >= MAX_SESSIONS {
        return Err("too many exploratory sandbox sessions; close one before starting another".into());
    }
    let session = sessions
        .entry(req.session_id.clone())
        .or_insert_with(|| ExploratorySession {
            time_s: 0.0,
            next_poke_id: 1,
            pokes: Vec::new(),
        });
    if !req.paused {
        session.time_s = (session.time_s + req.advance_s).min(MAX_SESSION_TIME_S);
    }
    if let Some(poke) = req.poke {
        let id = session.next_poke_id;
        session.next_poke_id = session.next_poke_id.saturating_add(1);
        session.pokes.push(ExploratoryPoke {
            id,
            lat_deg: poke.lat_deg,
            lon_deg: poke.lon_deg,
            amplitude_m: poke.amplitude_m,
            radius_m: poke.radius_m,
            created_at_s: session.time_s,
        });
        if session.pokes.len() > MAX_POKES_PER_SESSION {
            let excess = session.pokes.len() - MAX_POKES_PER_SESSION;
            session.pokes.drain(..excess);
        }
    }
    session.pokes.retain(|poke| session.time_s - poke.created_at_s <= MAX_WAVE_AGE_S);
    Ok(ExploratoryWaveStepResponse {
        schema_version: 1,
        session_id: req.session_id,
        time_s: session.time_s,
        waves: waves_for(session),
        model: "bounded_linear_surface_pulse_visualization",
    })
}

#[tauri::command]
pub fn clear_exploratory_wave(
    state: State<'_, ExploratorySandboxState>,
    session_id: String,
) -> Result<(), String> {
    validate_session_id(&session_id)?;
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "exploratory sandbox state is unavailable".to_string())?;
    sessions.remove(&session_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounded_poke_expands_when_running_and_stays_put_when_paused() {
        let poke = ExploratoryPoke {
            id: 1,
            lat_deg: 1.0,
            lon_deg: 2.0,
            amplitude_m: 2.0,
            radius_m: 10_000.0,
            created_at_s: 0.0,
        };
        let paused = ExploratorySession {
            time_s: 0.0,
            next_poke_id: 2,
            pokes: vec![poke.clone()],
        };
        let running = ExploratorySession {
            time_s: 0.5,
            ..paused
        };
        assert_eq!(waves_for(&running)[0].age_s, 0.5);
        assert!(waves_for(&running)[0].radius_m > waves_for(&ExploratorySession {
            time_s: 0.0,
            next_poke_id: 2,
            pokes: vec![poke],
        })[0].radius_m);
    }

    #[test]
    fn invalid_pokes_fail_closed() {
        assert!(validate_poke(&ExploratoryWavePoke {
            lat_deg: 91.0,
            lon_deg: 0.0,
            amplitude_m: 2.0,
            radius_m: 10_000.0,
        })
        .is_err());
    }
}
