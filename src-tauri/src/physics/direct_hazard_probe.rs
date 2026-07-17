//! Point probes over registered Rust-authoritative direct-hazard results.
//!
//! Registration happens once when a direct simulation completes. Moving a
//! probe only reads the bounded registry and never reruns the hazard model.

use std::collections::VecDeque;
use std::sync::{LazyLock, Mutex};

use serde::{Deserialize, Serialize};

use super::direct_hazard::{EffectRing, HazardResult};

const MAX_REGISTERED_RESULTS: usize = 16;
const BLAST_SPEED_M_S: f64 = 343.0;
const LIGHT_SPEED_M_S: f64 = 299_792_458.0;

static RESULTS: LazyLock<Mutex<VecDeque<HazardResult>>> =
    LazyLock::new(|| Mutex::new(VecDeque::new()));

#[derive(Debug, Deserialize)]
pub struct DirectHazardProbeRequest {
    pub result_id: String,
    pub click_lat: f64,
    pub click_lon: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProbeStatus {
    ThresholdExceeded,
    NoDisplayedThreshold,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProbeConfidence {
    ScreeningEstimate,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProbeEffect {
    pub label: String,
    pub category: String,
    pub description: Option<String>,
    pub threshold_value: Option<f64>,
    pub threshold_unit: Option<String>,
    pub value_qualifier: Option<String>,
    pub arrival_time_s: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DirectHazardProbeResult {
    pub result_id: String,
    pub kind: String,
    pub click_lat: f64,
    pub click_lon: f64,
    pub range_m: f64,
    pub status: ProbeStatus,
    pub effects: Vec<ProbeEffect>,
    pub governing_model: String,
    pub citations: Vec<String>,
    pub assumptions: Vec<String>,
    pub confidence: ProbeConfidence,
    pub unknowns: Vec<String>,
}

pub fn register_result(mut result: HazardResult, canonical_request: &[u8]) -> HazardResult {
    let digest = crate::render_protocol::sha256_hex(canonical_request);
    result.result_id = format!("{}-{digest}", result.kind);
    let mut results = RESULTS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    results.retain(|entry| entry.result_id != result.result_id);
    results.push_back(result.clone());
    while results.len() > MAX_REGISTERED_RESULTS {
        results.pop_front();
    }
    result
}

pub fn probe(request: DirectHazardProbeRequest) -> Result<DirectHazardProbeResult, String> {
    validate_coordinate("probe latitude", request.click_lat, 90.0)?;
    validate_coordinate("probe longitude", request.click_lon, 180.0)?;
    if request.result_id.len() > 80
        || !request
            .result_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err("result_id has an invalid format".to_string());
    }

    let result = RESULTS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .iter()
        .find(|entry| entry.result_id == request.result_id)
        .cloned()
        .ok_or_else(|| {
            "The selected direct-hazard result is no longer available; rerun the scenario once to inspect it."
                .to_string()
        })?;
    let range_m = haversine_m(
        result.center.lat,
        result.center.lon,
        request.click_lat,
        request.click_lon,
    );
    let effects = result
        .rings
        .iter()
        .filter(|ring| ring.category != "fallout" && range_m <= ring.radius_m)
        .map(|ring| effect_at_range(&result.kind, ring, range_m))
        .collect::<Vec<_>>();
    let mut unknowns = vec![
        "Peak local pressure, thermal fluence, and dose between displayed thresholds are not resolved by this screening model."
            .to_string(),
        "Terrain, structures, shielding, weather, and individual vulnerability are not modeled at this coordinate."
            .to_string(),
    ];
    if effects.is_empty() {
        unknowns.insert(
            0,
            "No displayed threshold reaches this coordinate; this is not a declaration that the location is safe."
                .to_string(),
        );
    }
    if result.kind == "nuclear" {
        unknowns.push(
            "Fallout membership and dose require wind-oriented plume sampling and are not inferred from radial distance."
                .to_string(),
        );
    }

    Ok(DirectHazardProbeResult {
        result_id: result.result_id,
        kind: result.kind.clone(),
        click_lat: request.click_lat,
        click_lon: request.click_lon,
        range_m,
        status: if effects.is_empty() {
            ProbeStatus::NoDisplayedThreshold
        } else {
            ProbeStatus::ThresholdExceeded
        },
        effects,
        governing_model: result.model_version.to_string(),
        citations: citations(&result.kind),
        assumptions: vec![
            "Great-circle distance is measured from the modeled event center on a spherical Earth."
                .to_string(),
            "Displayed effect radii are treated as screening thresholds on level, unobstructed terrain."
                .to_string(),
            "Blast arrival uses 343 m/s; thermal and prompt-radiation arrival uses light speed."
                .to_string(),
        ],
        confidence: ProbeConfidence::ScreeningEstimate,
        unknowns,
    })
}

fn effect_at_range(kind: &str, ring: &EffectRing, range_m: f64) -> ProbeEffect {
    let (threshold_value, threshold_unit) = threshold(kind, &ring.label);
    let arrival_time_s = match ring.category.as_str() {
        "blast" => Some(range_m / BLAST_SPEED_M_S),
        "thermal" | "radiation" | "fireball" => Some(range_m / LIGHT_SPEED_M_S),
        _ => None,
    };
    ProbeEffect {
        label: ring.label.clone(),
        category: ring.category.clone(),
        description: ring.description.clone(),
        threshold_value,
        threshold_unit: threshold_unit.map(str::to_string),
        value_qualifier: threshold_value.map(|_| "at_least".to_string()),
        arrival_time_s,
    }
}

fn threshold(kind: &str, label: &str) -> (Option<f64>, Option<&'static str>) {
    match (kind, label) {
        ("asteroid", "1st° burns") => (Some(60.0), Some("kJ/m²")),
        ("asteroid", "3rd° burns") => (Some(250.0), Some("kJ/m²")),
        ("asteroid", "Window breakage (1 psi)") => (Some(1.0), Some("psi")),
        ("asteroid", "Severe damage (7 psi)") => (Some(7.0), Some("psi")),
        ("asteroid", "Total destruction (20 psi)") => (Some(20.0), Some("psi")),
        ("nuclear", "1st° burns") => (Some(2.5), Some("cal/cm²")),
        ("nuclear", "3rd° burns") => (Some(8.0), Some("cal/cm²")),
        ("nuclear", "0.25 psi — light damage") => (Some(0.25), Some("psi")),
        ("nuclear", "1 psi — window breakage") => (Some(1.0), Some("psi")),
        ("nuclear", "5 psi — buildings destroyed") => (Some(5.0), Some("psi")),
        ("nuclear", "20 psi — heavy destruction") => (Some(20.0), Some("psi")),
        ("nuclear", "500 rem radiation") => (Some(500.0), Some("rem")),
        _ => (None, None),
    }
}

fn citations(kind: &str) -> Vec<String> {
    match kind {
        "asteroid" => vec![
            "Collins, Melosh & Marcus (2005), Earth Impact Effects Program".to_string(),
            "Glasstone & Dolan (1977), The Effects of Nuclear Weapons".to_string(),
        ],
        "nuclear" => vec![
            "Glasstone & Dolan (1977), The Effects of Nuclear Weapons".to_string(),
            "Defense Nuclear Agency (1996), Nuclear Weapons Effects Handbook".to_string(),
        ],
        _ => Vec::new(),
    }
}

fn validate_coordinate(label: &str, value: f64, maximum: f64) -> Result<(), String> {
    if !value.is_finite() || value.abs() > maximum {
        return Err(format!("{label} {value} out of range"));
    }
    Ok(())
}

fn haversine_m(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let dlat = (lat2 - lat1).to_radians();
    let dlon = (lon2 - lon1).to_radians();
    let a = (dlat / 2.0).sin().powi(2)
        + lat1.to_radians().cos() * lat2.to_radians().cos() * (dlon / 2.0).sin().powi(2);
    2.0 * 6_371_000.0 * a.clamp(0.0, 1.0).sqrt().asin()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::physics::direct_hazard::{
        HazardCenter, NuclearBurstType, NuclearHazardRequest, simulate_nuclear_hazard,
    };

    fn registered_nuclear() -> HazardResult {
        let request = NuclearHazardRequest {
            center: HazardCenter { lat: 0.0, lon: 0.0 },
            yield_kt: 1_000.0,
            burst_type: NuclearBurstType::Airburst,
            height_m: None,
            fission_pct: 50.0,
            population_density: 0.0,
        };
        let canonical = serde_json::to_vec(&request).unwrap();
        register_result(simulate_nuclear_hazard(request).unwrap(), &canonical)
    }

    #[test]
    fn probe_reuses_registered_result_and_reports_thresholds() {
        let result = registered_nuclear();
        let probe = probe(DirectHazardProbeRequest {
            result_id: result.result_id,
            click_lat: 0.0,
            click_lon: 0.0,
        })
        .unwrap();
        assert!(matches!(probe.status, ProbeStatus::ThresholdExceeded));
        assert!(
            probe
                .effects
                .iter()
                .any(|effect| effect.threshold_value == Some(500.0))
        );
        assert_eq!(probe.governing_model, "nuclear-direct-1.0.0");
    }

    #[test]
    fn outside_thresholds_is_explicitly_not_safe() {
        let result = registered_nuclear();
        let probe = probe(DirectHazardProbeRequest {
            result_id: result.result_id,
            click_lat: 80.0,
            click_lon: 170.0,
        })
        .unwrap();
        assert!(matches!(probe.status, ProbeStatus::NoDisplayedThreshold));
        assert!(probe.effects.is_empty());
        assert!(
            probe
                .unknowns
                .iter()
                .any(|item| item.contains("not a declaration"))
        );
    }

    #[test]
    fn stale_or_unknown_results_fail_closed() {
        let error = probe(DirectHazardProbeRequest {
            result_id: format!("nuclear-{}", "0".repeat(64)),
            click_lat: 0.0,
            click_lon: 0.0,
        })
        .unwrap_err();
        assert!(error.contains("no longer available"));
    }
}
