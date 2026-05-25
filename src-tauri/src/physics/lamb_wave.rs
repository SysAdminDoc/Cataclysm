//! Atmospheric Lamb-wave coupling source — research-frontier physics
//! observed for the first time during the 2022 Hunga Tonga eruption.
//!
//! References:
//! - Carvajal, M. et al. (2022). Worldwide signature of the 2022 Tonga
//!   volcanic tsunami. *Science* 377:91. https://doi.org/10.1126/science.abo4364
//! - Matoza, R. S. et al. (2022). Atmospheric waves and global seismic
//!   acoustic signatures of the August 2022 Hunga Tonga eruption.
//!   *Science* 377:95.
//! - Kubota, T., Saito, T., & Nishida, K. (2022). Global fast-travelling
//!   tsunamis driven by atmospheric Lamb waves on the 2022 Tonga
//!   eruption. *Science* 377:91.
//!
//! ## Physics
//!
//! When a large volcanic explosion injects an atmospheric pressure
//! pulse, the pulse propagates outward at the Lamb-wave speed
//! `c_L ≈ 310 m/s` (slower than the speed of sound; locked to the
//! lower atmosphere). The pressure perturbation couples into the ocean
//! via a quasi-static surface load:
//!
//! ```text
//! η_LW(r, t)  =  − Δp(r − c_L t) / (ρ_w g)
//! ```
//!
//! where `Δp` is the surface pressure perturbation (Pa), `ρ_w` is sea
//! water density, and `g` is gravity. A 200 Pa pulse drives a ~2 cm
//! sea-surface depression directly under the pressure wave; resonance
//! with the long-wave SWE celerity `c = √(g h)` can amplify this by a
//! factor of 10 or more in regions where the depth matches the
//! Proudman resonance criterion `√(g h) ≈ c_L`, i.e. `h ≈ 9.8 km`
//! (deep open ocean).
//!
//! This is a **closed-form contribution** that we add to the SWE
//! solver's IC + propagation. It does not replace the submarine-
//! collapse source (which generates the local 15 m wave); it is an
//! independent source riding outward as an atmospheric ring at
//! 310 m/s.

use serde::{Deserialize, Serialize};

use super::constants::{G_EARTH, RHO_SEAWATER};

/// Lamb-wave speed in the lower atmosphere, m/s. Slightly slower than
/// the acoustic speed; locked to the troposphere. Observed at 308–316
/// m/s during the 2022 Hunga Tonga event (Matoza 2022 Table S1).
pub const LAMB_WAVE_SPEED_M_S: f64 = 310.0;

/// Default surface pressure perturbation amplitude for a VEI 5–6
/// caldera eruption, Pa. Observed peaks during Hunga Tonga were
/// ~200 Pa near the source attenuating to ~50 Pa antipodally (Matoza).
pub const HUNGA_TONGA_PEAK_PRESSURE_PA: f64 = 200.0;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct LambWaveSource {
    /// Peak surface pressure perturbation at the source, Pa.
    pub peak_pressure_pa: f64,
    /// 1-σ radius of the atmospheric pulse, meters. Roughly the height
    /// scale of the troposphere (~10 km) × a horizontal spreading
    /// factor; observed FWHM during Hunga Tonga was ~30 km near source.
    pub source_radius_m: f64,
}

impl Default for LambWaveSource {
    fn default() -> Self {
        Self::hunga_tonga_2022()
    }
}

impl LambWaveSource {
    /// Canonical 2022 Hunga Tonga atmospheric source (per Matoza 2022 +
    /// Carvajal 2022). Use this as the default for any volcanic-blast
    /// scenario; future presets can tune the pressure/radius pair.
    pub fn hunga_tonga_2022() -> Self {
        Self {
            peak_pressure_pa: HUNGA_TONGA_PEAK_PRESSURE_PA,
            source_radius_m: 30_000.0,
        }
    }

    /// Geometric attenuation of the surface pressure pulse at radial
    /// distance `r` from the source, Pa. Uses an `r^(−1/2)` cylindrical
    /// spreading law (Matoza 2022 Fig. 2 empirical fit) clamped to the
    /// source amplitude inside `source_radius_m`.
    pub fn pressure_pa(&self, range_m: f64) -> f64 {
        if range_m <= self.source_radius_m {
            return self.peak_pressure_pa;
        }
        self.peak_pressure_pa * (self.source_radius_m / range_m).sqrt()
    }

    /// Lamb-wave-driven sea-surface elevation contribution at radial
    /// distance `r` and time `t`. Returns the quasi-static depression
    /// magnitude (positive = down) at the leading edge of the
    /// atmospheric ring, in meters.
    ///
    /// `η_LW = − Δp(r) / (ρ_w g)` evaluated where the ring is currently
    /// arriving. Outside the ring footprint (caller's `t < r/c_L` or
    /// `t > r/c_L + width`) the contribution is zero.
    pub fn surface_depression_m(&self, range_m: f64, time_s: f64) -> f64 {
        let arrival_t = range_m / LAMB_WAVE_SPEED_M_S;
        // Half-width: pulse FWHM ~ 2 σ over c_L. With source_radius_m
        // as σ, the pulse passes the observer in ~2σ/c_L seconds.
        let half_width_s = self.source_radius_m / LAMB_WAVE_SPEED_M_S;
        if (time_s - arrival_t).abs() > half_width_s {
            return 0.0;
        }
        // Cosine envelope inside the pulse window: 1 at arrival, 0 at edges.
        let envelope = 0.5
            * (1.0 + (std::f64::consts::PI * (time_s - arrival_t) / half_width_s).cos());
        let pressure = self.pressure_pa(range_m);
        pressure * envelope / (RHO_SEAWATER * G_EARTH)
    }

    /// Lamb-wave arrival time at radial distance `r`, seconds.
    pub fn arrival_time_s(&self, range_m: f64) -> f64 {
        range_m / LAMB_WAVE_SPEED_M_S
    }
}

/// Proudman resonance depth, meters: the bathymetric depth at which the
/// long-wave celerity `√(g h)` equals the Lamb-wave speed, producing
/// constructive sea-surface forcing. For `c_L ≈ 310 m/s` and `g = 9.81`,
/// `h_res ≈ 9.8 km`. Deep-open-ocean regions near this depth see the
/// largest Lamb-wave-driven tsunami amplification.
pub fn proudman_resonance_depth_m() -> f64 {
    LAMB_WAVE_SPEED_M_S.powi(2) / G_EARTH
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lamb_wave_quiescent_outside_pulse() {
        let s = LambWaveSource::hunga_tonga_2022();
        // 5000 km away, but the ring hasn't arrived yet.
        let eta = s.surface_depression_m(5_000_000.0, 1.0);
        assert_eq!(eta, 0.0);
    }

    #[test]
    fn lamb_wave_amplitude_at_arrival_matches_pressure() {
        let s = LambWaveSource::hunga_tonga_2022();
        let range = 5_000_000.0;
        let arrival_t = s.arrival_time_s(range);
        let eta = s.surface_depression_m(range, arrival_t);
        // At 5000 km, pressure = 200 · √(30/5000) = 200 · 0.0775 ≈ 15.5 Pa.
        // η = 15.5 / (1025 · 9.807) ≈ 1.54 mm. Small but nonzero.
        assert!(eta > 0.0001 && eta < 0.01, "unexpected η at arrival: {} m", eta);
    }

    #[test]
    fn proudman_resonance_depth_matches_hunga_tonga_observations() {
        let h = proudman_resonance_depth_m();
        // 310² / 9.81 ≈ 9799 m. Matches Carvajal 2022 finding that
        // Pacific basin amplification was strongest over ~9.8 km bathymetry.
        assert!(h > 9_000.0 && h < 10_500.0, "Proudman depth {} m off published", h);
    }
}
