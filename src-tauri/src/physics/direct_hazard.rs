//! Rust-authoritative direct asteroid and nuclear hazard products.
//!
//! These models preserve the v0.8 TypeScript engine coefficients while moving
//! every quantitative result, ring radius, readout value, casualty estimate,
//! and timeline event behind the Tauri boundary. The frontend is presentation
//! only and cannot silently diverge from the scientific backend.

use serde::{Deserialize, Serialize};

const EARTH_RADIUS_M: f64 = 6.371e6;
const GRAVITY: f64 = 9.81;
const SEA_LEVEL_DENSITY: f64 = 1.225;
const SCALE_HEIGHT_M: f64 = 8_500.0;
const SEA_LEVEL_PRESSURE_PA: f64 = 1.013e5;
const KT_TO_JOULES: f64 = 4.184e12;
const MT_TO_JOULES: f64 = 4.184e15;
const SEAWATER_DENSITY: f64 = 1_025.0;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HazardCenter {
    pub lat: f64,
    pub lon: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectRing {
    pub label: String,
    pub radius_m: f64,
    pub color: String,
    pub category: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReadoutItem {
    pub label: String,
    pub value: String,
    pub hint: Option<String>,
}

/// Share of the global population under age 15 (UN World Population Prospects
/// 2024 revision: ~25%). Used to report an approximate child slice of casualties
/// assuming the affected population mirrors the global age structure — a
/// demographic breakdown, not a differential-vulnerability model.
const GLOBAL_UNDER15_FRACTION: f64 = 0.25;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CasualtyEstimate {
    pub deaths: u64,
    pub injuries: u64,
    /// Approximate children (under 15) among the fatalities, assuming the
    /// affected population mirrors the global age structure. Demographic slice,
    /// not a separate vulnerability model.
    pub child_deaths: u64,
    pub child_injuries: u64,
    pub population_density: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HazardResult {
    #[serde(skip_serializing_if = "String::is_empty")]
    pub result_id: String,
    pub kind: String,
    pub center: HazardCenter,
    pub rings: Vec<EffectRing>,
    pub readout: Vec<ReadoutItem>,
    pub casualties: Option<CasualtyEstimate>,
    pub detail: HazardDetail,
    pub authority: &'static str,
    pub model_version: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum HazardDetail {
    Asteroid(AsteroidDetail),
    Nuclear(NuclearDetail),
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AsteroidTargetType {
    SedimentaryRock,
    CrystallineRock,
    Water,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AsteroidHazardRequest {
    pub center: HazardCenter,
    pub diameter_m: f64,
    pub density_kg_m3: f64,
    pub velocity_km_s: f64,
    pub angle_deg: f64,
    pub target_type: AsteroidTargetType,
    pub water_depth_m: f64,
    pub beach_slope_rad: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AsteroidAtmosphericDetail {
    pub reaches_ground: bool,
    pub airburst_altitude: f64,
    pub airburst_energy: f64,
    pub impact_velocity: f64,
    pub breakup_altitude: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AsteroidCraterDetail {
    pub final_diameter: f64,
    pub crater_depth: f64,
    pub is_complex: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AsteroidTsunamiDetail {
    pub applies: bool,
    pub cavity_diameter: f64,
    pub cavity_depth: f64,
    pub initial_amplitude: f64,
    pub amplitude_at_distance: f64,
    pub runup_height: f64,
    pub arrival_time: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AsteroidDetail {
    pub kinetic_energy_j: f64,
    pub megatons: f64,
    pub impactor_mass_kg: f64,
    pub atmospheric_entry: AsteroidAtmosphericDetail,
    pub crater: Option<AsteroidCraterDetail>,
    pub seismic_magnitude: f64,
    pub fireball_radius_m: f64,
    pub radius_window_breakage_m: f64,
    pub radius_severe_damage_m: f64,
    pub radius_total_destruction_m: f64,
    pub thermal_radius_first_degree_m: f64,
    pub thermal_radius_third_degree_m: f64,
    pub tsunami: AsteroidTsunamiDetail,
}

#[derive(Clone, Copy)]
struct EntryState {
    v: f64,
    m: f64,
    theta: f64,
    z: f64,
    x: f64,
    r: f64,
}

fn atmospheric_density(altitude_m: f64) -> f64 {
    if altitude_m < 0.0 {
        SEA_LEVEL_DENSITY
    } else {
        SEA_LEVEL_DENSITY * (-altitude_m / SCALE_HEIGHT_M).exp()
    }
}

fn composition_constants(density: f64) -> (f64, f64) {
    if density <= 1_200.0 {
        (1e5, 2.5e6)
    } else if density <= 2_000.0 {
        (5e5, 5e6)
    } else if density <= 3_200.0 {
        (5e6, 8e6)
    } else if density <= 5_000.0 {
        (1e7, 8e6)
    } else {
        (2e8, 8e6)
    }
}

fn entry_derivatives(
    state: EntryState,
    strength: f64,
    ablation_heat: f64,
    impactor_density: f64,
    initial_radius: f64,
) -> EntryState {
    let rho_air = atmospheric_density(state.z);
    let area = std::f64::consts::PI * state.r.powi(2);
    let sin_theta = state.theta.sin();
    let cos_theta = state.theta.cos();
    let mass = state.m.max(1e-12);
    let velocity = state.v.max(1e-12);
    let mut drdt = 0.0;
    if rho_air * state.v.powi(2) > strength {
        let spread_factor = 1.0 + (state.r / initial_radius - 1.0) * 0.5;
        drdt = state.v * 0.5 * (rho_air / impactor_density).sqrt() * spread_factor;
    }
    EntryState {
        v: (-rho_air * area * state.v.powi(2)) / (2.0 * mass) + GRAVITY * sin_theta,
        m: (-0.1 * rho_air * area * state.v.powi(3)) / (2.0 * ablation_heat),
        theta: (GRAVITY * cos_theta) / velocity
            - (state.v * cos_theta) / (EARTH_RADIUS_M + state.z),
        z: -state.v * sin_theta,
        x: (state.v * cos_theta * EARTH_RADIUS_M) / (EARTH_RADIUS_M + state.z),
        r: drdt,
    }
}

fn add_entry(left: EntryState, right: EntryState, scale: f64) -> EntryState {
    EntryState {
        v: left.v + right.v * scale,
        m: left.m + right.m * scale,
        theta: left.theta + right.theta * scale,
        z: left.z + right.z * scale,
        x: left.x + right.x * scale,
        r: left.r + right.r * scale,
    }
}

fn rk4_entry(
    state: EntryState,
    dt: f64,
    strength: f64,
    ablation_heat: f64,
    density: f64,
    radius: f64,
) -> EntryState {
    let derive = |value| entry_derivatives(value, strength, ablation_heat, density, radius);
    let k1 = derive(state);
    let k2 = derive(add_entry(state, k1, dt / 2.0));
    let k3 = derive(add_entry(state, k2, dt / 2.0));
    let k4 = derive(add_entry(state, k3, dt));
    EntryState {
        v: state.v + dt / 6.0 * (k1.v + 2.0 * k2.v + 2.0 * k3.v + k4.v),
        m: state.m + dt / 6.0 * (k1.m + 2.0 * k2.m + 2.0 * k3.m + k4.m),
        theta: state.theta + dt / 6.0 * (k1.theta + 2.0 * k2.theta + 2.0 * k3.theta + k4.theta),
        z: state.z + dt / 6.0 * (k1.z + 2.0 * k2.z + 2.0 * k3.z + k4.z),
        x: state.x + dt / 6.0 * (k1.x + 2.0 * k2.x + 2.0 * k3.x + k4.x),
        r: state.r + dt / 6.0 * (k1.r + 2.0 * k2.r + 2.0 * k3.r + k4.r),
    }
}

fn atmospheric_entry(
    diameter: f64,
    density: f64,
    velocity: f64,
    angle_deg: f64,
) -> AsteroidAtmosphericDetail {
    let (strength, ablation_heat) = composition_constants(density);
    let radius = diameter / 2.0;
    let mass = density * 4.0 / 3.0 * std::f64::consts::PI * radius.powi(3);
    let initial_energy = 0.5 * mass * velocity.powi(2);
    let mut state = EntryState {
        v: velocity,
        m: mass,
        theta: angle_deg.to_radians(),
        z: 100_000.0,
        x: 0.0,
        r: radius,
    };
    let mut breakup_altitude = -1.0;
    let mut peak_energy_loss_per_m = 0.0;
    let mut airburst_altitude: f64 = 0.0;
    let mut previous_energy = initial_energy;
    let mut previous_altitude = state.z;
    let mut past_peak = false;
    let mut peak_steps = 0;
    const DT: f64 = 0.02;

    for _ in 0..5_000_000 {
        if breakup_altitude < 0.0 && atmospheric_density(state.z) * state.v.powi(2) > strength {
            breakup_altitude = state.z;
        }
        state = rk4_entry(state, DT, strength, ablation_heat, density, radius);
        // A near-stopped body drives the 1/velocity term in the theta
        // derivative unbounded; if the integrator diverges, stop with the energy
        // deposited so far rather than emitting a spurious authoritative result.
        if !(state.v.is_finite()
            && state.m.is_finite()
            && state.z.is_finite()
            && state.theta.is_finite())
        {
            return AsteroidAtmosphericDetail {
                reaches_ground: false,
                airburst_altitude: airburst_altitude.max(previous_altitude.max(0.0)),
                airburst_energy: (initial_energy - previous_energy).max(0.0),
                impact_velocity: 0.0,
                breakup_altitude,
            };
        }
        let current_energy = 0.5 * state.m.max(0.0) * state.v.max(0.0).powi(2);
        let altitude_step = previous_altitude - state.z;
        if altitude_step > 0.0 {
            let loss_per_m = (previous_energy - current_energy) / altitude_step;
            if loss_per_m > peak_energy_loss_per_m {
                peak_energy_loss_per_m = loss_per_m;
                airburst_altitude = state.z;
                past_peak = false;
                peak_steps = 0;
            } else if peak_energy_loss_per_m > 0.0 {
                peak_steps += 1;
                past_peak = peak_steps > 50;
            }
        }
        previous_energy = current_energy;
        previous_altitude = state.z;

        if state.m <= mass * 0.01 {
            return AsteroidAtmosphericDetail {
                reaches_ground: false,
                airburst_altitude: airburst_altitude.max(0.0),
                airburst_energy: initial_energy * (1.0 - state.m / mass),
                impact_velocity: state.v.max(0.0),
                breakup_altitude,
            };
        }
        if state.r > radius * 4.0 && breakup_altitude > 0.0 {
            return AsteroidAtmosphericDetail {
                reaches_ground: false,
                airburst_altitude: if airburst_altitude > 0.0 {
                    airburst_altitude
                } else {
                    state.z.max(0.0)
                },
                airburst_energy: current_energy,
                impact_velocity: state.v.max(0.0),
                breakup_altitude,
            };
        }
        if past_peak && breakup_altitude > 0.0 && state.v < velocity * 0.3 {
            return AsteroidAtmosphericDetail {
                reaches_ground: false,
                airburst_altitude: airburst_altitude.max(0.0),
                airburst_energy: (initial_energy - current_energy).max(0.0),
                impact_velocity: state.v.max(0.0),
                breakup_altitude,
            };
        }
        if state.z <= 0.0 {
            return AsteroidAtmosphericDetail {
                reaches_ground: true,
                airburst_altitude: 0.0,
                airburst_energy: current_energy,
                impact_velocity: state.v.max(0.0),
                breakup_altitude,
            };
        }
        if state.v < 1.0 {
            let reaches_ground = state.z < 500.0;
            return AsteroidAtmosphericDetail {
                reaches_ground,
                airburst_altitude: if reaches_ground {
                    0.0
                } else {
                    state.z.max(0.0)
                },
                airburst_energy: current_energy,
                impact_velocity: state.v.max(0.0),
                breakup_altitude,
            };
        }
    }
    // The integrator ran its full ~100 000 s budget without an airburst or
    // ground contact — the body is effectively stalled/ablated. Report a
    // non-ground terminal outcome with the energy deposited so far rather than a
    // spurious authoritative ground impact.
    AsteroidAtmosphericDetail {
        reaches_ground: false,
        airburst_altitude: airburst_altitude.max(state.z.max(0.0)),
        airburst_energy: (initial_energy - 0.5 * state.m.max(0.0) * state.v.max(0.0).powi(2))
            .max(0.0),
        impact_velocity: state.v.max(0.0),
        breakup_altitude,
    }
}

fn luminous_efficiency(energy: f64) -> f64 {
    if energy <= 0.0 {
        return 0.0;
    }
    let log_energy = energy.log10();
    if log_energy >= 23.0 {
        1e-4
    } else if log_energy <= 14.0 {
        0.01
    } else {
        10_f64.powf(-2.0 + (log_energy - 14.0) * (-2.0) / 9.0)
    }
}

fn thermal_radius(energy: f64, threshold: f64, altitude: f64) -> f64 {
    let efficiency = luminous_efficiency(energy);
    let mut low = 1.0;
    let mut high = 1e8;
    for _ in 0..80 {
        let mid: f64 = (low + high) / 2.0;
        let slant = mid.hypot(altitude);
        let exposure = energy * efficiency * (-1.5e-5 * slant).exp()
            / (2.0 * std::f64::consts::PI * slant.powi(2));
        if exposure > threshold {
            low = mid;
        } else {
            high = mid;
        }
    }
    (low + high) / 2.0
}

pub(crate) fn overpressure_at_scaled_distance(distance: f64) -> f64 {
    if distance <= 0.0 {
        SEA_LEVEL_PRESSURE_PA * 1_000.0
    } else {
        3.14e11 * distance.powf(-2.6) + 1.8e7 * distance.powf(-1.13)
    }
}

/// Peak wind velocity behind the shock front for a given peak overpressure, from
/// the Rankine-Hugoniot relation used by Collins, Melosh & Marcus (2005),
/// eqn. 56: `u = (5p / 7P0) · c0 / sqrt(1 + 6p / 7P0)`, with ambient pressure
/// `P0` and sound speed `c0 = 340 m/s`. At 5 psi (34.5 kPa) this yields
/// ≈ 72 m/s (≈ 160 mph), consistent with the damage-ring copy. Gated to the
/// validation test build — it is only exercised by the impact-scaling benchmarks.
#[cfg(all(feature = "validation", test))]
pub(crate) fn peak_wind_velocity_m_s(overpressure_pa: f64) -> f64 {
    const SOUND_SPEED_M_S: f64 = 340.0;
    let scaled = overpressure_pa / (7.0 * SEA_LEVEL_PRESSURE_PA);
    5.0 * scaled * SOUND_SPEED_M_S / (1.0 + 6.0 * scaled).sqrt()
}

fn ground_reflection(altitude: f64, ground_range: f64) -> f64 {
    if altitude <= 0.0 {
        return 1.8;
    }
    let ratio = altitude / ground_range.max(1.0);
    if ratio > 2.0 {
        1.0
    } else if ratio < 0.1 {
        1.8
    } else {
        1.0 + 0.8 * (1.0 - (ratio / 2.0).min(1.0))
    }
}

fn blast_radius(target_pa: f64, energy_j: f64, altitude: f64) -> f64 {
    let energy_kt = energy_j / KT_TO_JOULES;
    if energy_kt <= 0.0 {
        return 0.0;
    }
    let scale = energy_kt.powf(1.0 / 3.0);
    let mut low = 1.0;
    let mut high = 1e8;
    for _ in 0..100 {
        let mid: f64 = (low + high) / 2.0;
        let slant = mid.hypot(altitude);
        let pressure =
            overpressure_at_scaled_distance(slant / scale) * ground_reflection(altitude, mid);
        if pressure > target_pa {
            low = mid;
        } else {
            high = mid;
        }
    }
    (low + high) / 2.0
}

fn asteroid_crater(request: &AsteroidHazardRequest, impact_velocity: f64) -> AsteroidCraterDetail {
    let (target_density, transition) = match request.target_type {
        AsteroidTargetType::SedimentaryRock => (2_500.0, 3_200.0),
        AsteroidTargetType::CrystallineRock => (2_750.0, 4_000.0),
        AsteroidTargetType::Water => (1_025.0, 3_200.0),
    };
    let sin_theta = request.angle_deg.to_radians().sin();
    let transient = 1.161
        * (request.density_kg_m3 / target_density).powf(1.0 / 3.0)
        * request.diameter_m.powf(0.78)
        * impact_velocity.powf(0.44)
        * GRAVITY.powf(-0.22)
        * sin_theta.powf(1.0 / 3.0);
    let is_complex = transient * 1.25 >= transition;
    let (diameter, depth) = if is_complex {
        let final_diameter = 1.17 * transient.powf(1.13) * transition.powf(-0.13);
        (
            final_diameter,
            0.15 * final_diameter.powf(0.43) * transition.powf(0.57),
        )
    } else {
        let final_diameter = 1.25 * transient;
        (final_diameter, final_diameter / 5.0)
    };
    AsteroidCraterDetail {
        final_diameter: diameter.max(0.0),
        crater_depth: depth.max(0.0),
        is_complex,
    }
}

fn asteroid_tsunami(request: &AsteroidHazardRequest, energy_j: f64) -> AsteroidTsunamiDetail {
    if !matches!(request.target_type, AsteroidTargetType::Water) || request.water_depth_m <= 0.0 {
        return AsteroidTsunamiDetail {
            applies: false,
            cavity_diameter: 0.0,
            cavity_depth: 0.0,
            initial_amplitude: 0.0,
            amplitude_at_distance: 0.0,
            runup_height: 0.0,
            arrival_time: 0.0,
        };
    }
    let distance_m = 1_000.0;
    let cavity_diameter = 1.27 * (energy_j / (SEAWATER_DENSITY * GRAVITY)).powf(0.25);
    let cavity_depth = (cavity_diameter / 2.0).min(request.water_depth_m);
    let initial_amplitude = cavity_depth / 2.0;
    let source_radius = cavity_diameter / 2.0;
    let decay = if cavity_diameter < request.water_depth_m * 4.0 {
        1.0
    } else {
        0.5
    };
    let amplitude = if distance_m > source_radius {
        initial_amplitude * (source_radius / distance_m).powf(decay)
    } else {
        initial_amplitude
    };
    let runup = if amplitude > 0.01 {
        2.831
            * (1.0 / request.beach_slope_rad).sqrt()
            * amplitude
            * (amplitude / request.water_depth_m).powf(1.25)
    } else {
        0.0
    };
    AsteroidTsunamiDetail {
        applies: true,
        cavity_diameter,
        cavity_depth,
        initial_amplitude,
        amplitude_at_distance: amplitude.max(0.0),
        runup_height: runup.max(0.0),
        arrival_time: distance_m / (GRAVITY * request.water_depth_m).sqrt(),
    }
}

fn fmt_meters(value: f64) -> String {
    if !value.is_finite() {
        "--".to_string()
    } else if value < 1_000.0 {
        format!("{value:.0} m")
    } else if value < 100_000.0 {
        format!("{:.2} km", value / 1_000.0)
    } else {
        format!("{:.0} km", value / 1_000.0)
    }
}

fn fmt_energy(megatons: f64) -> String {
    if megatons >= 1e6 {
        format!("{:.1} Gt", megatons / 1e6)
    } else if megatons >= 1.0 {
        format!("{megatons:.1} Mt")
    } else {
        format!("{:.0} kt", megatons * 1_000.0)
    }
}

/// Average interval between impacts delivering at least this energy, in years,
/// from the Earth Impact Effects Program recurrence relation
/// `T ≈ 109 · E_Mt^0.78` (Collins, Melosh & Marcus 2005). Order-of-magnitude
/// only — the impactor flux is uncertain to a factor of a few.
fn impact_recurrence_interval_years(megatons: f64) -> f64 {
    if megatons.is_nan() || megatons <= 0.0 {
        return f64::INFINITY;
    }
    109.0 * megatons.powf(0.78)
}

/// Human-readable "how often" phrasing for a recurrence interval in years.
fn fmt_recurrence_interval(years: f64) -> String {
    if !years.is_finite() {
        return "—".to_string();
    }
    if years >= 1.0e6 {
        format!("~1 in {:.0} million yr", years / 1.0e6)
    } else if years >= 1.0e3 {
        format!("~1 in {:.0} thousand yr", years / 1.0e3)
    } else {
        format!("~1 in {:.0} yr", years.max(1.0))
    }
}

/// Hiroshima "Little Boy" yield (kt TNT), the canonical comparison anchor.
const HIROSHIMA_YIELD_KT: f64 = 15.0;

/// Yield expressed relative to Hiroshima, e.g. "≈ 6.7× Hiroshima". Weapon
/// effects have no natural recurrence, so nuclear results state scale context
/// rather than a return period.
fn fmt_yield_context(yield_kt: f64) -> String {
    let ratio = yield_kt / HIROSHIMA_YIELD_KT;
    if ratio >= 10.0 {
        format!("≈ {:.0}× Hiroshima", ratio)
    } else if ratio >= 0.1 {
        format!("≈ {:.1}× Hiroshima", ratio)
    } else {
        format!("≈ {:.2}× Hiroshima", ratio)
    }
}

pub fn simulate_asteroid_hazard(request: AsteroidHazardRequest) -> Result<HazardResult, String> {
    validate_center(request.center, "DirectAsteroid")?;
    let validate = |field, value| crate::data::source_input_contract::validate_number("DirectAsteroid", field, value);
    crate::data::source_input_contract::validate_serialized_enum("DirectAsteroid", "target_type", request.target_type)?;
    validate("diameter_m", request.diameter_m)?;
    validate("density_kg_m3", request.density_kg_m3)?;
    validate("velocity_km_s", request.velocity_km_s)?;
    validate("angle_deg", request.angle_deg)?;
    validate("water_depth_m", request.water_depth_m)?;
    validate("beach_slope_rad", request.beach_slope_rad)?;

    let velocity_m_s = request.velocity_km_s * 1_000.0;
    let radius = request.diameter_m / 2.0;
    let mass = request.density_kg_m3 * 4.0 / 3.0 * std::f64::consts::PI * radius.powi(3);
    let kinetic_energy = 0.5 * mass * velocity_m_s.powi(2);
    let entry = atmospheric_entry(
        request.diameter_m,
        request.density_kg_m3,
        velocity_m_s,
        request.angle_deg,
    );
    let effective_energy = entry.airburst_energy;
    let crater = entry
        .reaches_ground
        .then(|| asteroid_crater(&request, entry.impact_velocity));
    let fireball_radius = 0.002 * effective_energy.powf(1.0 / 3.0);
    let thermal_first = thermal_radius(effective_energy, 60e3, entry.airburst_altitude);
    let thermal_third = thermal_radius(effective_energy, 250e3, entry.airburst_altitude);
    let blast_window = blast_radius(6.9e3, effective_energy, entry.airburst_altitude);
    let blast_severe = blast_radius(48.3e3, effective_energy, entry.airburst_altitude);
    let blast_total = blast_radius(137.9e3, effective_energy, entry.airburst_altitude);
    let seismic_magnitude = (0.67 * effective_energy.log10() - 5.87).max(0.0);
    let tsunami = asteroid_tsunami(&request, effective_energy);

    let mut rings = vec![
        ring(
            "1st° burns",
            thermal_first,
            "#f5c2e7",
            "thermal",
            "First-degree burns to exposed skin.",
        ),
        ring(
            "Window breakage (1 psi)",
            blast_window,
            "#f9e2af",
            "blast",
            "Glass shatters; light injuries.",
        ),
        ring(
            "3rd° burns",
            thermal_third,
            "#fab387",
            "thermal",
            "Third-degree burns; widespread ignition.",
        ),
        ring(
            "Severe damage (7 psi)",
            blast_severe,
            "#cba6f7",
            "blast",
            "Most buildings collapse.",
        ),
        ring(
            "Total destruction (20 psi)",
            blast_total,
            "#89b4fa",
            "blast",
            "Reinforced structures destroyed.",
        ),
        ring(
            "Fireball",
            fireball_radius,
            "#f5e0dc",
            "fireball",
            "Thermal fireball radius.",
        ),
    ];
    if let Some(crater) = &crater {
        rings.push(ring(
            "Final crater",
            crater.final_diameter / 2.0,
            "#eba0ac",
            "crater",
            "Excavated crater (radius).",
        ));
    }
    rings.retain(|item| item.radius_m > 0.5);
    rings.sort_by(|left, right| right.radius_m.total_cmp(&left.radius_m));

    let mut readout_items = vec![
        readout(
            "Impact energy",
            fmt_energy(kinetic_energy / MT_TO_JOULES),
            None,
        ),
        readout(
            "Recurrence interval",
            fmt_recurrence_interval(impact_recurrence_interval_years(
                kinetic_energy / MT_TO_JOULES,
            )),
            Some("order-of-magnitude average; Collins et al. 2005".to_string()),
        ),
        readout(
            "Reaches ground",
            if entry.reaches_ground {
                "Yes".to_string()
            } else {
                "No (airburst)".to_string()
            },
            (!entry.reaches_ground)
                .then(|| format!("burst @ {}", fmt_meters(entry.airburst_altitude))),
        ),
        readout(
            "Seismic magnitude",
            format!("M {seismic_magnitude:.1}"),
            None,
        ),
        readout("Fireball radius", fmt_meters(fireball_radius), None),
        readout("20 psi radius", fmt_meters(blast_total), None),
    ];
    if let Some(crater) = &crater {
        readout_items.push(readout(
            "Crater diameter",
            fmt_meters(crater.final_diameter),
            Some(
                if crater.is_complex {
                    "complex crater"
                } else {
                    "simple crater"
                }
                .to_string(),
            ),
        ));
    }
    if tsunami.applies {
        readout_items.push(readout(
            "Tsunami runup",
            fmt_meters(tsunami.runup_height),
            None,
        ));
    }
    let detail = AsteroidDetail {
        kinetic_energy_j: kinetic_energy,
        megatons: kinetic_energy / MT_TO_JOULES,
        impactor_mass_kg: mass,
        atmospheric_entry: entry,
        crater,
        seismic_magnitude,
        fireball_radius_m: fireball_radius,
        radius_window_breakage_m: blast_window,
        radius_severe_damage_m: blast_severe,
        radius_total_destruction_m: blast_total,
        thermal_radius_first_degree_m: thermal_first,
        thermal_radius_third_degree_m: thermal_third,
        tsunami,
    };
    Ok(HazardResult {
        result_id: String::new(),
        kind: "asteroid".to_string(),
        center: request.center,
        rings,
        readout: readout_items,
        casualties: None,
        detail: HazardDetail::Asteroid(detail),
        authority: "rust",
        model_version: "asteroid-direct-1.0.0",
    })
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NuclearBurstType {
    Airburst,
    Surface,
    Custom,
    Hemp,
    Water,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct NuclearHazardRequest {
    pub center: HazardCenter,
    pub yield_kt: f64,
    pub burst_type: NuclearBurstType,
    pub height_m: Option<f64>,
    pub fission_pct: f64,
    pub population_density: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct FalloutZone {
    pub length: f64,
    pub width: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct FalloutPlume {
    pub heavy: FalloutZone,
    pub light: FalloutZone,
}

#[derive(Debug, Clone, Serialize)]
pub struct TimelineEvent {
    pub time: String,
    pub description: String,
    pub category: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShelterAssessment {
    pub shelter_type: &'static str,
    pub survival_pct: u8,
    pub blast_ok: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShelterZoneAssessment {
    pub label: &'static str,
    pub distance_km: f64,
    pub overpressure_psi: f64,
    pub thermal_cal_cm2: f64,
    pub shelters: Vec<ShelterAssessment>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NuclearShelterReport {
    pub result_id: String,
    pub model: &'static str,
    pub zones: Vec<ShelterZoneAssessment>,
    pub limitations: Vec<&'static str>,
}

/// Latent (delayed) cancer fatalities among blast/thermal survivors, BEIR VII
/// (2006) linear-no-threshold model at ~5.5% excess cancer mortality per Sv.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatentCancerEstimate {
    pub exposed: u64,
    pub cancers_10yr: u64,
    pub cancers_30yr: u64,
    pub genetic_effects: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NuclearDetail {
    pub yield_kt: f64,
    pub is_surface: bool,
    pub is_water: bool,
    pub fireball: f64,
    pub psi_20: f64,
    pub psi_5: f64,
    pub psi_1: f64,
    pub thermal_3: f64,
    pub thermal_1: f64,
    pub radiation: f64,
    pub neutron_rad: f64,
    pub gamma_rad: f64,
    pub crater_r: f64,
    pub cloud_top_h: f64,
    pub optimal_height: f64,
    pub wave_height: f64,
    pub fallout: Option<FalloutPlume>,
    pub timeline: Vec<TimelineEvent>,
    pub latent_cancer: Option<LatentCancerEstimate>,
}

#[derive(Clone)]
struct NuclearEffects {
    yield_kt: f64,
    is_surface: bool,
    is_water: bool,
    fireball: f64,
    psi_200: f64,
    psi_20: f64,
    psi_5: f64,
    psi_3: f64,
    psi_1: f64,
    psi_0_25: f64,
    thermal_3: f64,
    thermal_1: f64,
    radiation: f64,
    neutron_rad: f64,
    gamma_rad: f64,
    crater_r: f64,
    cloud_top_h: f64,
    optimal_height: f64,
    wave_height: f64,
    fallout: Option<FalloutPlume>,
    flash_blind_day: f64,
    flash_blind_night: f64,
    firestorm_r: f64,
}

fn nuclear_effects(request: &NuclearHazardRequest) -> NuclearEffects {
    let yield_kt = request.yield_kt.max(0.001);
    let is_water = matches!(request.burst_type, NuclearBurstType::Water);
    let is_surface = matches!(request.burst_type, NuclearBurstType::Surface) || is_water;
    let factor = if is_surface { 0.8 } else { 1.0 };
    let cube = yield_kt.powf(1.0 / 3.0);
    let attenuation = if yield_kt > 1_000.0 {
        (1.0 - (yield_kt.log10() - 3.0) * 0.15).max(0.7)
    } else {
        1.0
    };
    let fission_fraction = request.fission_pct / 100.0;
    let surface_fallout = is_surface
        || request
            .height_m
            .is_some_and(|value| value < 0.066 * yield_kt.powf(0.4) * 1_000.0);
    NuclearEffects {
        yield_kt,
        is_surface,
        is_water,
        fireball: if is_surface { 0.05 } else { 0.066 } * yield_kt.powf(0.4),
        psi_200: factor * 0.13 * cube,
        psi_20: factor * 0.28 * cube,
        psi_5: factor * 0.71 * cube,
        psi_3: factor * 0.95 * cube,
        psi_1: factor * 2.2 * cube,
        // 0.25 psi light-damage / window-breakage ring. Coefficient extrapolated
        // from the same Glasstone-Dolan scaled-overpressure fit as the rings
        // above (coeff ∝ overpressure^-0.69, fitted from the 20/5/1 psi points):
        // 2.2 * 0.25^-0.69 ≈ 5.5 km per kt^(1/3). This is the band that
        // dominates the affected-population count for large yields; see
        // NUKEMAP's 2026 extension to 0.25 psi citing Capabilities of Nuclear
        // Weapons (1960/1972).
        psi_0_25: factor * 5.5 * cube,
        thermal_3: 0.67 * yield_kt.powf(0.41) * attenuation,
        thermal_1: 1.2 * yield_kt.powf(0.38) * attenuation,
        radiation: 1.15 * yield_kt.powf(0.19),
        neutron_rad: (0.7 * yield_kt.powf(0.19)).min(2.5),
        gamma_rad: yield_kt.powf(0.19).min(3.0),
        crater_r: if is_surface {
            0.038 * yield_kt.powf(1.0 / 3.4)
        } else {
            0.0
        },
        cloud_top_h: if is_surface { 0.24 } else { 0.29 } * yield_kt.powf(0.42),
        optimal_height: 0.22 * cube * 1_000.0,
        wave_height: if is_water {
            10.0 * yield_kt.powf(0.54)
        } else {
            0.0
        },
        fallout: surface_fallout.then(|| FalloutPlume {
            heavy: FalloutZone {
                length: 1.3 * (yield_kt * fission_fraction).powf(0.45),
                width: 0.39 * (yield_kt * fission_fraction).powf(0.35),
            },
            light: FalloutZone {
                length: 4.6 * (yield_kt * fission_fraction).powf(0.45),
                width: 1.1 * (yield_kt * fission_fraction).powf(0.35),
            },
        }),
        flash_blind_day: 2.1 * yield_kt.powf(0.4),
        flash_blind_night: 55.0 * yield_kt.powf(0.25),
        firestorm_r: if is_water {
            0.0
        } else {
            let density_factor = if request.population_density > 5_000.0 {
                1.0
            } else if request.population_density > 1_000.0 {
                0.8
            } else if request.population_density > 200.0 {
                0.5
            } else {
                0.15
            };
            0.67 * yield_kt.powf(0.41) * 0.85 * density_factor
        },
    }
}

fn fmt_km(value: f64) -> String {
    if !value.is_finite() {
        "--".to_string()
    } else if value < 1.0 {
        format!("{:.0} m", value * 1_000.0)
    } else if value < 10.0 {
        format!("{value:.2} km")
    } else if value < 100.0 {
        format!("{value:.1} km")
    } else {
        format!("{value:.0} km")
    }
}

fn fmt_yield(yield_kt: f64) -> String {
    if yield_kt < 0.001 {
        format!("{:.0} g", yield_kt * 1e6)
    } else if yield_kt < 1.0 {
        if yield_kt < 0.01 {
            format!("{:.1} tons", yield_kt * 1_000.0)
        } else {
            format!("{:.0} tons", yield_kt * 1_000.0)
        }
    } else if yield_kt < 1_000.0 {
        if yield_kt >= 100.0 {
            format!("{yield_kt:.0} kT")
        } else {
            format!("{yield_kt:.1} kT")
        }
    } else {
        if yield_kt >= 10_000.0 {
            format!("{:.0} MT", yield_kt / 1_000.0)
        } else {
            format!("{:.1} MT", yield_kt / 1_000.0)
        }
    }
}

fn fmt_time(seconds: f64) -> String {
    if seconds < 1.0 {
        format!("{:.0} ms", seconds * 1_000.0)
    } else if seconds < 60.0 {
        format!("{seconds:.1} sec")
    } else {
        format!("{:.1} min", seconds / 60.0)
    }
}

fn nuclear_timeline(effects: &NuclearEffects) -> Vec<TimelineEvent> {
    let mut events = vec![
        timeline(
            "0 ms",
            "Detonation. X-ray pulse heats the air to millions of degrees.",
            "radiation",
        ),
        timeline(
            "0.01 ms",
            &format!(
                "Prompt neutron/gamma pulse. Lethal radiation to {} (neutrons), {} (gamma).",
                fmt_km(effects.neutron_rad),
                fmt_km(effects.gamma_rad)
            ),
            "radiation",
        ),
        timeline(
            "0.1 ms",
            &format!(
                "Thermal flash. Temporary flash blindness to {} (day) / {} (night).",
                fmt_km(effects.flash_blind_day),
                fmt_km(effects.flash_blind_night)
            ),
            "thermal",
        ),
        timeline(
            &format!("{:.0} ms", 1.3 * effects.yield_kt.powf(0.4)),
            &format!(
                "Fireball reaches maximum size ({} radius). Surface ~10,000,000 °C.",
                fmt_km(effects.fireball)
            ),
            "thermal",
        ),
        timeline(
            &fmt_time(effects.psi_5 / 0.34),
            &format!(
                "Blast wave at 5 psi ({}). Most buildings destroyed; ~160 mph winds.",
                fmt_km(effects.psi_5)
            ),
            "blast",
        ),
        timeline(
            &fmt_time(effects.psi_1 / 0.34),
            &format!(
                "Blast wave at 1 psi ({}). Windows shatter into shrapnel.",
                fmt_km(effects.psi_1)
            ),
            "blast",
        ),
    ];
    if effects.firestorm_r > 0.1 {
        events.push(timeline(
            "~5 min",
            &format!(
                "Firestorm ignites within {}. Hurricane-force inward winds feed the fire.",
                fmt_km(effects.firestorm_r)
            ),
            "firestorm",
        ));
    }
    if effects.is_surface {
        if let Some(fallout) = &effects.fallout {
            events.push(timeline(
                "~10 min",
                &format!(
                    "Mushroom cloud stabilizes at ~{:.1} km. Fallout begins.",
                    effects.cloud_top_h
                ),
                "cloud",
            ));
            events.push(timeline(
                "~30 min",
                &format!(
                    "Heaviest fallout within {} downwind.",
                    fmt_km(fallout.heavy.length)
                ),
                "fallout",
            ));
            events.push(timeline(
                "~24 hrs",
                &format!(
                    "Light fallout extends {} downwind. 7:10 decay rule applies.",
                    fmt_km(fallout.light.length)
                ),
                "fallout",
            ));
        }
    } else {
        events.push(timeline(
            "~10 min",
            &format!(
                "Mushroom cloud reaches ~{:.1} km altitude.",
                effects.cloud_top_h
            ),
            "cloud",
        ));
    }
    events
}

struct ShelterType {
    name: &'static str,
    blast_resistance_psi: f64,
    thermal_survival: f64,
    radiation_exposure_fraction: f64,
}

const SHELTER_TYPES: [ShelterType; 8] = [
    ShelterType {
        name: "Open air",
        blast_resistance_psi: 0.5,
        thermal_survival: 0.1,
        radiation_exposure_fraction: 1.0,
    },
    ShelterType {
        name: "Automobile",
        blast_resistance_psi: 1.5,
        thermal_survival: 0.3,
        radiation_exposure_fraction: 0.9,
    },
    ShelterType {
        name: "Wood-frame house",
        blast_resistance_psi: 2.5,
        thermal_survival: 0.5,
        radiation_exposure_fraction: 0.6,
    },
    ShelterType {
        name: "Brick building",
        blast_resistance_psi: 5.0,
        thermal_survival: 0.7,
        radiation_exposure_fraction: 0.3,
    },
    ShelterType {
        name: "Concrete building",
        blast_resistance_psi: 12.0,
        thermal_survival: 0.9,
        radiation_exposure_fraction: 0.1,
    },
    ShelterType {
        name: "Basement",
        blast_resistance_psi: 15.0,
        thermal_survival: 0.95,
        radiation_exposure_fraction: 0.05,
    },
    ShelterType {
        name: "Reinforced bunker",
        blast_resistance_psi: 50.0,
        thermal_survival: 1.0,
        radiation_exposure_fraction: 0.01,
    },
    ShelterType {
        name: "Deep underground",
        blast_resistance_psi: 200.0,
        thermal_survival: 1.0,
        radiation_exposure_fraction: 0.001,
    },
];

fn shelter_overpressure_psi(detail: &NuclearDetail, distance_km: f64) -> f64 {
    if distance_km <= 0.0 {
        return 999.0;
    }
    let mut pairs = vec![
        (detail.fireball, 3_000.0),
        (detail.fireball * 1.5, 200.0),
        (detail.psi_20, 20.0),
        (detail.psi_5, 5.0),
        (detail.psi_5 * 1.3, 3.0),
        (detail.psi_1, 1.0),
        (detail.psi_1 * 2.0, 0.2),
    ];
    pairs.retain(|(radius, _)| radius.is_finite() && *radius > 0.0);
    pairs.sort_by(|left, right| left.0.total_cmp(&right.0));
    pairs.dedup_by(|left, right| left.0.to_bits() == right.0.to_bits());
    if pairs.is_empty() {
        return 0.0;
    }
    if distance_km <= pairs[0].0 {
        return pairs[0].1;
    }
    if distance_km >= pairs[pairs.len() - 1].0 {
        return 0.0;
    }
    for pair in pairs.windows(2) {
        let [(near_radius, near_psi), (far_radius, far_psi)] = pair else {
            unreachable!()
        };
        if distance_km >= *near_radius && distance_km <= *far_radius {
            let fraction = (distance_km - near_radius) / (far_radius - near_radius);
            return near_psi * (far_psi / near_psi).powf(fraction);
        }
    }
    0.0
}

fn shelter_thermal_cal_cm2(detail: &NuclearDetail, distance_km: f64) -> f64 {
    if distance_km <= detail.fireball {
        1_000.0
    } else if distance_km <= detail.thermal_3 {
        8.0 * (detail.thermal_3 / distance_km).powi(2)
    } else if distance_km <= detail.thermal_1 {
        2.0 * (detail.thermal_1 / distance_km).powi(2)
    } else {
        0.0
    }
}

pub fn nuclear_shelter_report(result_id: String, detail: &NuclearDetail) -> NuclearShelterReport {
    let radii = [
        ("Fireball edge", detail.fireball),
        ("20 psi zone", detail.psi_20),
        ("5 psi zone", detail.psi_5),
        ("1 psi zone", detail.psi_1),
        ("Beyond 1 psi", detail.psi_1 * 1.5),
        ("1st-degree burn edge", detail.thermal_1),
    ];
    let zones = radii
        .into_iter()
        .filter(|(_, distance_km)| distance_km.is_finite() && *distance_km > 0.001)
        .map(|(label, distance_km)| {
            let overpressure_psi = shelter_overpressure_psi(detail, distance_km);
            let thermal_cal_cm2 = shelter_thermal_cal_cm2(detail, distance_km);
            let radiation_fraction = if distance_km <= 0.001 {
                1.0
            } else {
                (detail.radiation / distance_km).powi(2).clamp(0.0, 1.0)
            };
            let shelters = SHELTER_TYPES
                .iter()
                .map(|shelter| {
                    let blast_survival = if overpressure_psi <= shelter.blast_resistance_psi {
                        1.0
                    } else {
                        (1.0 - (overpressure_psi - shelter.blast_resistance_psi)
                            / (shelter.blast_resistance_psi * 2.0))
                            .max(0.0)
                    };
                    let thermal_survival = if thermal_cal_cm2 > 8.0 {
                        shelter.thermal_survival
                    } else {
                        1.0
                    };
                    let radiation_survival =
                        1.0 - radiation_fraction * shelter.radiation_exposure_fraction;
                    ShelterAssessment {
                        shelter_type: shelter.name,
                        survival_pct: (100.0
                            * (blast_survival * thermal_survival * radiation_survival)
                                .clamp(0.0, 1.0))
                        .round() as u8,
                        blast_ok: overpressure_psi <= shelter.blast_resistance_psi,
                    }
                })
                .collect();
            ShelterZoneAssessment {
                label,
                distance_km,
                overpressure_psi,
                thermal_cal_cm2,
                shelters,
            }
        })
        .collect();
    NuclearShelterReport {
        result_id,
        model: "NukeMap shelter heuristic port 1.0",
        zones,
        limitations: vec![
            "Screening scores are simplified scenario comparisons, not personal survival probabilities or protective-action guidance.",
            "Terrain, building condition, orientation, fire, fallout timing, emergency response, and individual vulnerability are not modeled.",
            "Follow official emergency-management instructions; do not choose a shelter from this educational table.",
        ],
    }
}

fn nuclear_casualties(effects: &NuclearEffects, density: f64) -> CasualtyEstimate {
    let shield = if density > 5_000.0 {
        0.65
    } else if density > 1_000.0 {
        0.75
    } else if density > 200.0 {
        0.85
    } else {
        1.0
    };
    // Effect radii come from independent blast/thermal/radiation scalings and
    // are NOT guaranteed to be monotone (e.g. thermal_1 can exceed psi_1 for
    // large airbursts). Sort by radius ascending so the running-annulus
    // accumulation never drops a real ring or double-counts an overlap.
    let mut zones = [
        (effects.fireball, 1.0, 1.0, 1.0, 0.0, 0.0),
        (effects.psi_200, 0.98, 0.9, 0.8, 0.02, 0.05),
        (effects.psi_20, 0.85, 0.6, 0.3, 0.12, 0.15),
        (effects.psi_5, 0.4, 0.3, 0.05, 0.45, 0.2),
        (
            effects.thermal_3.max(effects.psi_3),
            0.15,
            0.25,
            0.02,
            0.35,
            0.3,
        ),
        (effects.psi_1, 0.02, 0.05, 0.0, 0.2, 0.15),
        // 0.25 psi light-damage annulus: no lethality, a small glass-cut injury
        // fraction.
        (effects.psi_0_25, 0.0, 0.0, 0.0, 0.03, 0.0),
        (effects.thermal_1, 0.0, 0.01, 0.0, 0.05, 0.1),
    ];
    zones.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut deaths = 0.0;
    let mut injuries = 0.0;
    let mut previous_area = 0.0;
    for (radius, blast, thermal, radiation, injury_blast, injury_thermal) in zones {
        if radius < 0.001 {
            continue;
        }
        let area = std::f64::consts::PI * radius.powi(2);
        let population = (area - previous_area).max(0.0) * density;
        let outdoor = population * 0.2;
        let indoor = population * 0.8;
        let outdoor_death: f64 = 1.0 - (1.0 - blast) * (1.0 - thermal) * (1.0 - radiation);
        let outdoor_injury: f64 = (1.0_f64 - outdoor_death).min(injury_blast + injury_thermal);
        let indoor_death: f64 =
            1.0 - (1.0 - blast) * (1.0 - thermal * 0.4) * (1.0 - radiation * 0.4);
        let indoor_injury: f64 = (1.0_f64 - indoor_death).min(injury_blast + injury_thermal * 0.4);
        deaths += ((outdoor * outdoor_death + indoor * indoor_death) * shield).round();
        injuries += ((outdoor * outdoor_injury + indoor * indoor_injury) * shield).round();
        previous_area = area;
    }
    let deaths = deaths.max(0.0);
    let injuries = injuries.max(0.0);
    CasualtyEstimate {
        deaths: deaths.round() as u64,
        injuries: injuries.round() as u64,
        child_deaths: (deaths * GLOBAL_UNDER15_FRACTION).round() as u64,
        child_injuries: (injuries * GLOBAL_UNDER15_FRACTION).round() as u64,
        population_density: density,
    }
}

/// Delayed cancer fatalities among survivors, ported from the NukeMap
/// `estimateLatentCancer` model. BEIR VII (2006) linear-no-threshold:
/// ~5.5% excess cancer mortality per sievert. Dose zones are approximated from
/// Glasstone & Dolan radiation scaling; ~50% of the population in the outer
/// dose rings is assumed to survive the prompt blast/thermal effects.
fn latent_cancer(effects: &NuclearEffects, density: f64) -> LatentCancerEstimate {
    // (radius_km, whole-body dose in Sv). Doses are labelled innermost→outermost
    // but the radii come from independent scalings and can invert (e.g. the
    // 500-rem radius can exceed the 1-psi radius for low-yield/enhanced-radiation
    // cases). Sort by radius ascending so annuli are non-negative, and cap each
    // ring's dose to be non-increasing outward so a mis-ordered radius cannot
    // assign a high dose to an outer ring and inflate the cancer estimate.
    let mut zones: [(f64, f64); 3] = [
        (effects.radiation, 5.0), // ~500 rem at the 500-rem radius edge
        (effects.psi_1, 0.5),     // ~50 rem near the 1 psi boundary
        (effects.thermal_1, 0.1), // ~10 rem near the 1st-degree burn edge
    ];
    zones.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut exposed = 0.0;
    let mut cancers_10 = 0.0;
    let mut cancers_30 = 0.0;
    let mut prev_area = 0.0;
    let mut prev_dose = f64::INFINITY;
    for (radius, dose) in zones {
        if radius < 0.001 {
            continue;
        }
        let dose = dose.min(prev_dose);
        prev_dose = dose;
        let area = std::f64::consts::PI * radius * radius;
        let ring = (area - prev_area).max(0.0);
        let pop = ring * density * 0.5; // survivors only
        let cancer_rate = dose * 0.055; // BEIR VII: 5.5% per Sv
        exposed += pop;
        cancers_10 += pop * cancer_rate * 0.3; // ~30% manifest within 10 years
        cancers_30 += pop * cancer_rate * 0.8; // ~80% manifest within 30 years
        prev_area = area;
    }
    LatentCancerEstimate {
        exposed: exposed.max(0.0).round() as u64,
        cancers_10yr: cancers_10.max(0.0).round() as u64,
        cancers_30yr: cancers_30.max(0.0).round() as u64,
        genetic_effects: (exposed * 0.001).max(0.0).round() as u64, // ~0.1% per UNSCEAR
    }
}

pub fn simulate_nuclear_hazard(request: NuclearHazardRequest) -> Result<HazardResult, String> {
    validate_center(request.center, "DirectNuclear")?;
    let validate = |field, value| crate::data::source_input_contract::validate_number("DirectNuclear", field, value);
    crate::data::source_input_contract::validate_serialized_enum("DirectNuclear", "burst_type", request.burst_type)?;
    validate("yield_kt", request.yield_kt)?;
    validate("fission_pct", request.fission_pct)?;
    validate("population_density", request.population_density)?;
    if let Some(height) = request.height_m {
        validate("height_m", height)?;
    }
    let effects = nuclear_effects(&request);
    let mut rings = vec![
        ring_km(
            "1st° burns",
            effects.thermal_1,
            "#f5c2e7",
            "thermal",
            "≥2.5 cal/cm² — first-degree burns to exposed skin.",
        ),
        ring_km(
            "1 psi — window breakage",
            effects.psi_1,
            "#f9e2af",
            "blast",
            "Glass shatters into shrapnel; light injuries widespread.",
        ),
        ring_km(
            "0.25 psi — light damage",
            effects.psi_0_25,
            "#fef9c3",
            "blast",
            "Most windows break over a wide area; scattered cuts from flying glass.",
        ),
        ring_km(
            "3rd° burns",
            effects.thermal_3,
            "#fab387",
            "thermal",
            "≥8 cal/cm² — third-degree burns; ignition of many materials.",
        ),
        ring_km(
            "5 psi — buildings destroyed",
            effects.psi_5,
            "#cba6f7",
            "blast",
            "Most residential buildings collapse; ~160 mph winds.",
        ),
        ring_km(
            "500 rem radiation",
            effects.radiation,
            "#94e2d5",
            "radiation",
            "Acute lethal dose to unsheltered survivors of blast/thermal.",
        ),
        ring_km(
            "20 psi — heavy destruction",
            effects.psi_20,
            "#89b4fa",
            "blast",
            "Reinforced structures destroyed; near-total fatalities.",
        ),
        ring_km(
            "Fireball",
            effects.fireball,
            "#f5e0dc",
            "fireball",
            "Everything within is vaporized.",
        ),
    ];
    if let Some(fallout) = &effects.fallout {
        rings.push(ring_km(
            "Light fallout (heavy zone shown)",
            fallout.heavy.length,
            "#a6e3a1",
            "fallout",
            "Downwind heavy-fallout reach (idealized plume length).",
        ));
    }
    rings.retain(|item| item.radius_m > 0.5);
    rings.sort_by(|left, right| right.radius_m.total_cmp(&left.radius_m));

    let mut readout_items = vec![
        readout("Yield", fmt_yield(effects.yield_kt), None),
        readout(
            "Yield context",
            fmt_yield_context(effects.yield_kt),
            Some("scale anchor; weapon effects have no natural recurrence".to_string()),
        ),
        readout(
            "Burst",
            if effects.is_water {
                "Water"
            } else if effects.is_surface {
                "Surface"
            } else {
                "Air"
            }
            .to_string(),
            Some(format!(
                "optimal air-burst height {}",
                fmt_km(effects.optimal_height / 1_000.0)
            )),
        ),
        readout("Fireball radius", fmt_km(effects.fireball), None),
        readout(
            "5 psi radius",
            fmt_km(effects.psi_5),
            Some("residential destruction".to_string()),
        ),
        readout("3rd° burn radius", fmt_km(effects.thermal_3), None),
        readout("500 rem radius", fmt_km(effects.radiation), None),
        readout("Mushroom cloud top", fmt_km(effects.cloud_top_h), None),
    ];
    if effects.crater_r > 0.0 {
        readout_items.push(readout("Crater radius", fmt_km(effects.crater_r), None));
    }
    if effects.is_water {
        readout_items.push(readout(
            "Wave height @1 km",
            format!("{:.0} m", effects.wave_height),
            None,
        ));
    }
    let timeline = nuclear_timeline(&effects);
    let detail = NuclearDetail {
        yield_kt: effects.yield_kt,
        is_surface: effects.is_surface,
        is_water: effects.is_water,
        fireball: effects.fireball,
        psi_20: effects.psi_20,
        psi_5: effects.psi_5,
        psi_1: effects.psi_1,
        thermal_3: effects.thermal_3,
        thermal_1: effects.thermal_1,
        radiation: effects.radiation,
        neutron_rad: effects.neutron_rad,
        gamma_rad: effects.gamma_rad,
        crater_r: effects.crater_r,
        cloud_top_h: effects.cloud_top_h,
        optimal_height: effects.optimal_height,
        wave_height: effects.wave_height,
        fallout: effects.fallout.clone(),
        timeline,
        latent_cancer: (request.population_density > 0.0)
            .then(|| latent_cancer(&effects, request.population_density)),
    };
    Ok(HazardResult {
        result_id: String::new(),
        kind: "nuclear".to_string(),
        center: request.center,
        rings,
        readout: readout_items,
        casualties: (request.population_density > 0.0)
            .then(|| nuclear_casualties(&effects, request.population_density)),
        detail: HazardDetail::Nuclear(detail),
        authority: "rust",
        model_version: "nuclear-direct-1.0.0",
    })
}

fn ring(label: &str, radius_m: f64, color: &str, category: &str, description: &str) -> EffectRing {
    EffectRing {
        label: label.to_string(),
        radius_m,
        color: color.to_string(),
        category: category.to_string(),
        description: Some(description.to_string()),
    }
}

fn ring_km(
    label: &str,
    radius_km: f64,
    color: &str,
    category: &str,
    description: &str,
) -> EffectRing {
    ring(label, radius_km * 1_000.0, color, category, description)
}

fn readout(label: &str, value: String, hint: Option<String>) -> ReadoutItem {
    ReadoutItem {
        label: label.to_string(),
        value,
        hint,
    }
}

fn timeline(time: &str, description: &str, category: &str) -> TimelineEvent {
    TimelineEvent {
        time: time.to_string(),
        description: description.to_string(),
        category: category.to_string(),
    }
}

fn validate_center(center: HazardCenter, source: &str) -> Result<(), String> {
    crate::data::source_input_contract::validate_number(source, "lat_deg", center.lat)?;
    crate::data::source_input_contract::validate_number(source, "lon_deg", center.lon)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_relative(actual: f64, expected: f64, tolerance: f64) {
        let scale = expected.abs().max(1.0);
        assert!(
            (actual - expected).abs() <= tolerance * scale,
            "expected {expected}, got {actual}"
        );
    }

    fn center() -> HazardCenter {
        HazardCenter {
            lat: 40.0,
            lon: -74.0,
        }
    }

    /// A `NuclearEffects` with a deliberate radius inversion: `thermal_1` (5 km)
    /// is smaller than `psi_0_25` (8 km) yet appears after it in the zone array,
    /// and `radiation` (8 km) is larger than `psi_1` (2 km). Exercises the
    /// ring-ordering fix.
    fn inverted_effects() -> NuclearEffects {
        NuclearEffects {
            yield_kt: 100.0,
            is_surface: false,
            is_water: false,
            fireball: 0.1,
            psi_200: 0.3,
            psi_20: 0.6,
            psi_5: 1.0,
            psi_3: 1.2,
            psi_1: 2.0,
            psi_0_25: 8.0,
            thermal_3: 1.3,
            thermal_1: 5.0,
            radiation: 8.0,
            neutron_rad: 0.0,
            gamma_rad: 0.0,
            crater_r: 0.0,
            cloud_top_h: 0.0,
            optimal_height: 0.0,
            wave_height: 0.0,
            fallout: None,
            flash_blind_day: 0.0,
            flash_blind_night: 0.0,
            firestorm_r: 0.0,
        }
    }

    /// Regression: an out-of-order `thermal_1` ring must still be counted rather
    /// than dropped by a negative `(area - previous_area)` term. Removing
    /// `thermal_1` must strictly reduce injuries; the old unsorted code counted
    /// the same value either way.
    #[test]
    fn casualty_rings_count_out_of_order_zones() {
        let density = 1_000.0;
        let with = nuclear_casualties(&inverted_effects(), density);
        let mut without = inverted_effects();
        without.thermal_1 = 0.0;
        let without = nuclear_casualties(&without, density);
        assert!(with.injuries >= without.injuries);
        assert!(
            with.injuries > without.injuries,
            "thermal_1 ring was dropped: {} !> {}",
            with.injuries,
            without.injuries
        );
        assert!(with.deaths < density as u64 * 1_000); // sane, finite
    }

    /// Regression: latent-cancer rings must partition the whole exposed disc
    /// (union up to the largest radius) with no dropped negative annulus, so the
    /// exposed count equals 0.5·density·π·maxR² regardless of zone order.
    #[test]
    fn latent_cancer_rings_conserve_exposed_population() {
        let density = 1_000.0;
        let est = latent_cancer(&inverted_effects(), density);
        let max_r = 8.0_f64; // radiation radius, the largest zone
        let expected = 0.5 * density * std::f64::consts::PI * max_r * max_r;
        assert!(
            (est.exposed as f64 - expected).abs() <= expected * 0.001 + 1.0,
            "exposed {} != conserved {} (dropped ring?)",
            est.exposed,
            expected
        );
        // The dose cap keeps the estimate physical (non-inflated).
        assert!(est.cancers_30yr as f64 <= est.exposed as f64);
    }

    /// Pathological entry inputs (shallow grazing, dense, extreme speed) must
    /// stay finite and non-negative rather than returning a spurious result from
    /// a diverged integrator.
    #[test]
    fn atmospheric_entry_pathological_inputs_stay_finite() {
        for (d, rho, v, angle) in [
            (1000.0, 8000.0, 11_000.0, 1.0), // shallow grazing dense body
            (0.5, 500.0, 72_000.0, 80.0),    // tiny fragile fast entry
            (50.0, 3000.0, 20_000.0, 0.5),   // very shallow stony body
        ] {
            let detail = atmospheric_entry(d, rho, v, angle);
            assert!(
                detail.airburst_energy.is_finite() && detail.airburst_energy >= 0.0,
                "airburst_energy {} for ({d},{rho},{v},{angle})",
                detail.airburst_energy
            );
            assert!(
                detail.impact_velocity.is_finite() && detail.impact_velocity >= 0.0,
                "impact_velocity {}",
                detail.impact_velocity
            );
            assert!(detail.airburst_altitude.is_finite() && detail.airburst_altitude >= 0.0);
        }
    }

    #[test]
    fn impact_recurrence_matches_earth_impact_effects_program() {
        // Collins et al. 2005: T ≈ 109·E_Mt^0.78. Order-of-magnitude checks
        // against known events.
        // Tunguska ~12 Mt → several hundred years.
        let tunguska = impact_recurrence_interval_years(12.0);
        assert!(
            (300.0..2_000.0).contains(&tunguska),
            "Tunguska recurrence {tunguska} yr outside plausible band"
        );
        // Chicxulub ~1e8 Mt → ~10^8 years.
        let chicxulub = impact_recurrence_interval_years(1.0e8);
        assert!(
            (1.0e7..1.0e9).contains(&chicxulub),
            "Chicxulub recurrence {chicxulub} yr outside plausible band"
        );
        // Monotonic in energy; non-positive energy is never-recurring.
        assert!(impact_recurrence_interval_years(100.0) > impact_recurrence_interval_years(10.0));
        assert!(impact_recurrence_interval_years(0.0).is_infinite());
        assert!(impact_recurrence_interval_years(-5.0).is_infinite());
        assert_eq!(fmt_recurrence_interval(f64::INFINITY), "—");
    }

    #[test]
    fn yield_context_anchors_on_hiroshima() {
        assert_eq!(fmt_yield_context(15.0), "≈ 1.0× Hiroshima");
        assert_eq!(fmt_yield_context(1_000.0), "≈ 67× Hiroshima");
        assert_eq!(fmt_yield_context(1.5), "≈ 0.1× Hiroshima");
    }

    #[test]
    fn nuclear_parity_calibrations_and_timeline_are_rust_authoritative() {
        let ten = nuclear_effects(&NuclearHazardRequest {
            center: center(),
            yield_kt: 10.0,
            burst_type: NuclearBurstType::Airburst,
            height_m: None,
            fission_pct: 50.0,
            population_density: 5_000.0,
        });
        assert!((1.359..1.661).contains(&ten.psi_5));
        let result = simulate_nuclear_hazard(NuclearHazardRequest {
            center: center(),
            yield_kt: 100.0,
            burst_type: NuclearBurstType::Surface,
            height_m: None,
            fission_pct: 50.0,
            population_density: 5_000.0,
        })
        .unwrap();
        assert_eq!(result.authority, "rust");
        let casualties = result.casualties.as_ref().expect("casualty product");
        // Re-frozen after the ring-ordering fix: effect radii are now sorted
        // ascending before annulus accumulation, so each band is assigned the
        // most-severe threshold it actually satisfies and no out-of-order ring
        // (here thermal_1 < psi_1 with psi_0_25 between them) is dropped or
        // mis-weighted. Deaths fell from the pre-fix 112_019 (which over-counted
        // the 4.4–8.2 km thermal band at the 1 psi lethality) to 98_691.
        assert_eq!(casualties.deaths, 98_691);
        assert_eq!(casualties.injuries, 329_644);
        // Child slice ≈ 25% of the global age structure (UN WPP 2024).
        assert_eq!(casualties.child_deaths, 24_673);
        assert_eq!(casualties.child_injuries, 82_411);
        let HazardDetail::Nuclear(detail) = result.detail else {
            panic!("wrong detail");
        };
        assert_relative(detail.psi_20, 1.039_715_898_729_262_5, 1e-12);
        assert_relative(detail.psi_5, 2.636_422_457_492_058, 1e-12);
        assert_relative(detail.psi_1, 8.169_196_347_158_492, 1e-12);
        assert_relative(detail.fireball, 0.315_478_672_240_096_7, 1e-12);
        assert_relative(detail.thermal_3, 4.426_646_101_650_893, 1e-12);
        assert_relative(detail.radiation, 2.758_657_856_872_414, 1e-12);
        assert_relative(detail.crater_r, 0.147_237_654_577_332_98, 1e-12);
        let fallout = detail.fallout.as_ref().expect("surface fallout");
        assert_relative(fallout.heavy.length, 7.559_269_941_246_139, 1e-12);
        assert_relative(fallout.light.length, 26.748_185_945_947_878, 1e-12);
        assert!(
            detail
                .timeline
                .iter()
                .any(|event| event.category == "blast")
        );
        assert!(
            detail
                .timeline
                .iter()
                .any(|event| event.category == "fallout")
        );
    }

    #[test]
    fn asteroid_parity_handles_airburst_crater_and_water_targets() {
        let chelyabinsk = simulate_asteroid_hazard(AsteroidHazardRequest {
            center: center(),
            diameter_m: 19.0,
            density_kg_m3: 3_300.0,
            velocity_km_s: 19.0,
            angle_deg: 18.0,
            target_type: AsteroidTargetType::SedimentaryRock,
            water_depth_m: 0.0,
            beach_slope_rad: 0.02,
        })
        .unwrap();
        let HazardDetail::Asteroid(detail) = chelyabinsk.detail else {
            panic!("wrong detail");
        };
        assert!(!detail.atmospheric_entry.reaches_ground);
        assert!(detail.crater.is_none());

        let chicxulub = simulate_asteroid_hazard(AsteroidHazardRequest {
            center: center(),
            diameter_m: 12_000.0,
            density_kg_m3: 2_600.0,
            velocity_km_s: 20.0,
            angle_deg: 60.0,
            target_type: AsteroidTargetType::CrystallineRock,
            water_depth_m: 0.0,
            beach_slope_rad: 0.02,
        })
        .unwrap();
        let HazardDetail::Asteroid(detail) = chicxulub.detail else {
            panic!("wrong detail");
        };
        assert!(detail.atmospheric_entry.reaches_ground);
        assert!(
            detail
                .crater
                .as_ref()
                .is_some_and(|value| value.final_diameter > 100_000.0)
        );

        let default_impact = simulate_asteroid_hazard(AsteroidHazardRequest {
            center: center(),
            diameter_m: 300.0,
            density_kg_m3: 4_000.0,
            velocity_km_s: 20.0,
            angle_deg: 45.0,
            target_type: AsteroidTargetType::SedimentaryRock,
            water_depth_m: 4_000.0,
            beach_slope_rad: 0.02,
        })
        .unwrap();
        let HazardDetail::Asteroid(default_detail) = default_impact.detail else {
            panic!("wrong detail");
        };
        // Frozen renderer-facing values from the removed TypeScript engine.
        assert_relative(default_detail.megatons, 2_703.091_193_337_298, 1e-10);
        assert_relative(
            default_detail.atmospheric_entry.impact_velocity,
            19_203.924_381_948_41,
            1e-10,
        );
        assert_relative(
            default_detail.fireball_radius_m,
            4_077.597_395_706_633_5,
            1e-10,
        );
        assert_relative(
            default_detail.radius_total_destruction_m,
            49_985.088_060_526_99,
            1e-10,
        );
        assert_relative(
            default_detail
                .crater
                .expect("default crater")
                .final_diameter,
            5_922.093_285_090_788,
            1e-10,
        );

        let ocean = simulate_asteroid_hazard(AsteroidHazardRequest {
            center: center(),
            diameter_m: 500.0,
            density_kg_m3: 3_000.0,
            velocity_km_s: 20.0,
            angle_deg: 45.0,
            target_type: AsteroidTargetType::Water,
            water_depth_m: 4_000.0,
            beach_slope_rad: 0.02,
        })
        .unwrap();
        assert!(
            ocean
                .readout
                .iter()
                .any(|item| item.label == "Tsunami runup")
        );
        assert!(
            ocean
                .rings
                .windows(2)
                .all(|pair| pair[0].radius_m >= pair[1].radius_m)
        );
    }

    #[test]
    fn direct_hazard_validation_rejects_nonfinite_inputs() {
        let request = NuclearHazardRequest {
            center: center(),
            yield_kt: f64::NAN,
            burst_type: NuclearBurstType::Airburst,
            height_m: None,
            fission_pct: 50.0,
            population_density: 0.0,
        };
        assert!(simulate_nuclear_hazard(request).is_err());
    }

    #[test]
    fn renderer_contract_serializes_camel_case_authority_fields() {
        let result = simulate_nuclear_hazard(NuclearHazardRequest {
            center: center(),
            yield_kt: 100.0,
            burst_type: NuclearBurstType::Airburst,
            height_m: None,
            fission_pct: 50.0,
            population_density: 0.0,
        })
        .unwrap();
        let json = serde_json::to_value(result).unwrap();
        assert_eq!(json["authority"], "rust");
        assert_eq!(json["modelVersion"], "nuclear-direct-1.0.0");
        assert!(json["rings"][0]["radiusM"].is_number());
        assert!(json["detail"]["psi20"].is_number());
        assert!(json["detail"]["timeline"].is_array());
    }

    #[test]
    fn capture_fixtures_are_exact_rust_products() {
        fn assert_fixture(expected: &serde_json::Value, actual: &serde_json::Value, path: &str) {
            match (expected, actual) {
                (serde_json::Value::Number(left), serde_json::Value::Number(right)) => {
                    let left = left.as_f64().unwrap();
                    let right = right.as_f64().unwrap();
                    let tolerance = 1e-12 * left.abs().max(right.abs()).max(1.0);
                    assert!(
                        (left - right).abs() <= tolerance,
                        "{path}: {left} != {right}"
                    );
                }
                (serde_json::Value::Array(left), serde_json::Value::Array(right)) => {
                    assert_eq!(left.len(), right.len(), "{path}: array length");
                    for (index, (left, right)) in left.iter().zip(right).enumerate() {
                        assert_fixture(left, right, &format!("{path}[{index}]"));
                    }
                }
                (serde_json::Value::Object(left), serde_json::Value::Object(right)) => {
                    assert_eq!(left.len(), right.len(), "{path}: object length");
                    for (key, left) in left {
                        assert_fixture(
                            left,
                            right.get(key).unwrap_or(&serde_json::Value::Null),
                            &format!("{path}.{key}"),
                        );
                    }
                }
                _ => assert_eq!(expected, actual, "{path}"),
            }
        }
        let expected: serde_json::Value = serde_json::from_str(include_str!(
            "../../../src/data/direct-hazard-capture-fixtures.json"
        ))
        .unwrap();
        let asteroid = |center,
                        diameter_m,
                        density_kg_m3,
                        velocity_km_s,
                        angle_deg,
                        target_type,
                        water_depth_m| {
            serde_json::to_value(
                simulate_asteroid_hazard(AsteroidHazardRequest {
                    center,
                    diameter_m,
                    density_kg_m3,
                    velocity_km_s,
                    angle_deg,
                    target_type,
                    water_depth_m,
                    beach_slope_rad: 0.02,
                })
                .unwrap(),
            )
            .unwrap()
        };
        assert_fixture(
            &expected["asteroid-entry"],
            &asteroid(
                HazardCenter {
                    lat: 42.5,
                    lon: -102.5,
                },
                19.0,
                3_300.0,
                19.0,
                18.0,
                AsteroidTargetType::SedimentaryRock,
                0.0,
            ),
            "asteroid-entry",
        );
        assert_fixture(
            &expected["asteroid-land-impact"],
            &asteroid(
                HazardCenter {
                    lat: 35.68,
                    lon: 139.76,
                },
                300.0,
                4_000.0,
                20.0,
                45.0,
                AsteroidTargetType::SedimentaryRock,
                0.0,
            ),
            "asteroid-land-impact",
        );
        assert_fixture(
            &expected["asteroid-ocean-impact"],
            &asteroid(
                HazardCenter {
                    lat: 0.0,
                    lon: -140.0,
                },
                500.0,
                3_000.0,
                20.0,
                45.0,
                AsteroidTargetType::Water,
                4_000.0,
            ),
            "asteroid-ocean-impact",
        );
        for (id, burst_type, center) in [
            (
                "nuclear-airburst",
                NuclearBurstType::Airburst,
                HazardCenter {
                    lat: 35.68,
                    lon: 139.76,
                },
            ),
            (
                "nuclear-surface-burst",
                NuclearBurstType::Surface,
                HazardCenter {
                    lat: 40.71,
                    lon: -74.01,
                },
            ),
        ] {
            let actual = serde_json::to_value(
                simulate_nuclear_hazard(NuclearHazardRequest {
                    center,
                    yield_kt: 100.0,
                    burst_type,
                    height_m: None,
                    fission_pct: 50.0,
                    population_density: 0.0,
                })
                .unwrap(),
            )
            .unwrap();
            assert_fixture(&expected[id], &actual, id);
        }
    }

    #[test]
    fn latent_cancer_scales_with_yield_and_density_and_is_zero_without_population() {
        let effects = |yield_kt| {
            nuclear_effects(&NuclearHazardRequest {
                center: center(),
                yield_kt,
                burst_type: NuclearBurstType::Surface,
                height_m: None,
                fission_pct: 50.0,
                population_density: 5_000.0,
            })
        };
        let small = latent_cancer(&effects(10.0), 5_000.0);
        let big = latent_cancer(&effects(1_000.0), 5_000.0);
        assert!(big.cancers_30yr > small.cancers_30yr);
        assert!(big.cancers_30yr >= big.cancers_10yr);
        assert!(big.exposed > 0);
        // No population means no latent cancers.
        let empty = latent_cancer(&effects(1_000.0), 0.0);
        assert_eq!(empty.exposed, 0);
        assert_eq!(empty.cancers_30yr, 0);
        // Nuclear results omit the estimate entirely when density is zero.
        let result = simulate_nuclear_hazard(NuclearHazardRequest {
            center: center(),
            yield_kt: 100.0,
            burst_type: NuclearBurstType::Surface,
            height_m: None,
            fission_pct: 50.0,
            population_density: 0.0,
        })
        .unwrap();
        let HazardDetail::Nuclear(detail) = result.detail else {
            panic!("wrong detail");
        };
        assert!(detail.latent_cancer.is_none());
    }

}
