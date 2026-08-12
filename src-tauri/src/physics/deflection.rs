//! Educational asteroid-deflection screening.
//!
//! This deliberately small model turns an impulse and warning lead time into
//! an along-track displacement. It is a linearized teaching approximation,
//! not an n-body mission design: it omits ephemerides, planetary gravity,
//! targeting geometry, momentum enhancement, and fragmentation.
//!
//! The useful lesson is the ordering: `Δs ≈ 1/2 · (J / m) · t`. A small change
//! in velocity can accumulate when an object is found early, while the same
//! impulse applied late produces a much smaller displacement.
//!
//! Motivation: NASA/JPL's 2026 DART update reports a measurable heliocentric
//! orbit change after the Dimorphos kinetic impactor experiment:
//! https://www.jpl.nasa.gov/news/nasas-dart-mission-changed-orbit-of-asteroid-didymos-around-sun/

use std::f64::consts::PI;

use serde::{Deserialize, Serialize};

use super::constants::R_EARTH_M;

const SECONDS_PER_DAY: f64 = 86_400.0;
const UNCERTAINTY_FRACTION: f64 = 0.25;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct AsteroidDeflectionRequest {
    pub diameter_m: f64,
    pub density_kg_m3: f64,
    /// Delivered impulse, N·s.
    pub impulse_n_s: f64,
    /// Time between the impulse and the nominal centerline encounter, days.
    pub lead_time_days: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AsteroidDeflectionEstimate {
    pub asteroid_mass_kg: f64,
    pub impulse_n_s: f64,
    pub lead_time_s: f64,
    pub delta_v_m_s: f64,
    pub along_track_displacement_m: f64,
    pub nominal_miss_distance_m: f64,
    pub nominal_miss_distance_low_m: f64,
    pub nominal_miss_distance_high_m: f64,
    pub earth_radius_m: f64,
    /// Nominal miss distance divided by Earth's mean radius, clamped to 1.
    pub earth_radius_fraction: f64,
    /// Positive means the linearized path clears Earth's mean radius; negative
    /// means the nominal path still intersects the Earth in this toy geometry.
    pub impact_margin_m: f64,
    pub impact_avoided: bool,
    pub uncertainty_fraction: f64,
    pub model: &'static str,
}

impl AsteroidDeflectionRequest {
    /// Sphere-mass estimate used only to convert impulse to Δv.
    pub fn asteroid_mass_kg(&self) -> f64 {
        PI / 6.0 * self.diameter_m.powi(3) * self.density_kg_m3
    }

    pub fn estimate(&self) -> Result<AsteroidDeflectionEstimate, String> {
        for (name, value) in [
            ("diameter_m", self.diameter_m),
            ("density_kg_m3", self.density_kg_m3),
            ("impulse_n_s", self.impulse_n_s),
            ("lead_time_days", self.lead_time_days),
        ] {
            if !value.is_finite() {
                return Err(format!("{name} must be finite"));
            }
        }
        if self.diameter_m <= 0.0 || self.density_kg_m3 <= 0.0 {
            return Err("asteroid diameter and density must be positive".into());
        }
        if self.impulse_n_s < 0.0 || self.lead_time_days <= 0.0 {
            return Err("deflection impulse must be non-negative and lead time positive".into());
        }

        let mass = self.asteroid_mass_kg();
        let lead_time_s = self.lead_time_days * SECONDS_PER_DAY;
        let delta_v_m_s = self.impulse_n_s / mass;
        let along_track_displacement_m = 0.5 * delta_v_m_s * lead_time_s;
        if !mass.is_finite()
            || mass <= 0.0
            || !lead_time_s.is_finite()
            || !delta_v_m_s.is_finite()
            || !along_track_displacement_m.is_finite()
        {
            return Err("deflection estimate exceeded the finite teaching-model range".into());
        }

        let nominal_miss_distance_m = along_track_displacement_m;
        let nominal_miss_distance_low_m = nominal_miss_distance_m * (1.0 - UNCERTAINTY_FRACTION);
        let nominal_miss_distance_high_m = nominal_miss_distance_m * (1.0 + UNCERTAINTY_FRACTION);
        let impact_margin_m = nominal_miss_distance_m - R_EARTH_M;
        Ok(AsteroidDeflectionEstimate {
            asteroid_mass_kg: mass,
            impulse_n_s: self.impulse_n_s,
            lead_time_s,
            delta_v_m_s,
            along_track_displacement_m,
            nominal_miss_distance_m,
            nominal_miss_distance_low_m,
            nominal_miss_distance_high_m,
            earth_radius_m: R_EARTH_M,
            earth_radius_fraction: (nominal_miss_distance_m / R_EARTH_M).clamp(0.0, 1.0),
            impact_margin_m,
            impact_avoided: nominal_miss_distance_m > R_EARTH_M,
            uncertainty_fraction: UNCERTAINTY_FRACTION,
            model: "linearized_constant_delta_v",
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> AsteroidDeflectionRequest {
        AsteroidDeflectionRequest {
            diameter_m: 100.0,
            density_kg_m3: 3_000.0,
            impulse_n_s: 1.0e9,
            lead_time_days: 3_650.0,
        }
    }

    #[test]
    fn impulse_and_lead_time_accumulate_linearly() {
        let base = request().estimate().expect("base estimate");
        let mut doubled = request();
        doubled.impulse_n_s *= 2.0;
        doubled.lead_time_days *= 2.0;
        let result = doubled.estimate().expect("doubled estimate");
        assert!((result.delta_v_m_s - 2.0 * base.delta_v_m_s).abs() < 1.0e-12);
        assert!((result.nominal_miss_distance_m - 4.0 * base.nominal_miss_distance_m).abs() < 1.0e-6);
    }

    #[test]
    fn zero_impulse_leaves_nominal_centerline_as_an_impact() {
        let mut input = request();
        input.impulse_n_s = 0.0;
        let result = input.estimate().expect("zero estimate");
        assert_eq!(result.nominal_miss_distance_m, 0.0);
        assert!(result.impact_margin_m < 0.0);
        assert!(!result.impact_avoided);
    }

    #[test]
    fn large_early_deflection_crosses_the_earth_radius_threshold() {
        let mut input = request();
        input.impulse_n_s = 1.0e12;
        input.lead_time_days = 36_500.0;
        let result = input.estimate().expect("large estimate");
        assert!(result.impact_avoided);
        assert_eq!(result.earth_radius_fraction, 1.0);
        assert!(result.nominal_miss_distance_high_m > result.nominal_miss_distance_m);
    }
}
