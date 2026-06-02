//! Earthquake-generated tsunami source physics.
//!
//! References:
//! - Okada, Y. (1985). Surface deformation due to shear and tensile faults in
//!   a half-space. *Bulletin of the Seismological Society of America*, 75(4),
//!   1135–1154.
//! - Mansinha, L., & Smylie, D. E. (1971). The displacement fields of inclined
//!   faults. *BSSA*, 61, 1433–1440.
//! - Tanioka, Y., & Satake, K. (1996). Tsunami generation by horizontal
//!   displacement of ocean bottom. *Geophys. Res. Lett.*, 23, 861–864.
//!
//! Earthquakes generate tsunamis by displacing the seafloor. The classic
//! approximation: initial water-surface displacement = vertical seafloor
//! displacement (validated for wavelengths much longer than ocean depth).
//!
//! The full Okada-1985 dislocation field (strike, dip, rake, slip, fault
//! length × width, depth) is implemented in [`super::okada`] and is the primary
//! peak-amplitude source whenever `slip_m > 0` (see [`Self::initial_displacement`]).
//! For slip-less, magnitude-only sources we fall back to the Geist-Dmowska 1999
//! empirical `log(η₀) ≈ 0.5·M_w − 3.3`. (Okada 1985 is closed-form algebraic —
//! no elliptic integrals; those appear only in the older Mansinha-Smylie 1971
//! formulation.)

use serde::{Deserialize, Serialize};

use super::constants::G_EARTH;
use super::{GeoPoint, InitialDisplacement};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EarthquakeSource {
    /// Moment magnitude.
    pub mw: f64,
    /// Hypocentral depth, meters.
    pub depth_m: f64,
    /// Fault strike, degrees clockwise from north. Drives the Okada 1985 field.
    pub strike_deg: f64,
    /// Fault dip, degrees from horizontal. Drives the Okada 1985 field.
    pub dip_deg: f64,
    /// Slip rake, degrees. Drives the Okada 1985 field.
    pub rake_deg: f64,
    /// Average slip on the fault, meters. Drives the Okada 1985 field.
    pub slip_m: f64,
    /// Fault length along strike, meters. Pass 0 to derive from Wells &
    /// Coppersmith 1994 scaling: `log L = 0.5·M_w − 1.85`.
    #[serde(default)]
    pub fault_length_m: f64,
    /// Fault width down dip, meters. Pass 0 to derive from Wells & Coppersmith
    /// 1994 scaling: `log W = 0.32·M_w − 1.01`.
    #[serde(default)]
    pub fault_width_m: f64,
    /// Water depth at the epicenter, meters.
    pub water_depth_m: f64,
    pub location: GeoPoint,
}

impl EarthquakeSource {
    /// Seismic moment from moment magnitude (Hanks & Kanamori 1979):
    /// `M0 = 10^(1.5 M_w + 9.1)` (N·m).
    pub fn seismic_moment_nm(&self) -> f64 {
        10f64.powf(1.5 * self.mw + 9.1)
    }

    /// Total radiated energy estimate (N·m → J), assuming a stress drop of
    /// 3 MPa (typical interplate thrust) and shear modulus 32 GPa.
    pub fn energy_j(&self) -> f64 {
        // E ≈ M0 · Δσ / (2 μ) — gives radiated seismic energy.
        let delta_sigma = 3.0e6;
        let mu = 3.2e10;
        self.seismic_moment_nm() * delta_sigma / (2.0 * mu)
    }

    /// Order-of-magnitude peak vertical seafloor displacement from moment
    /// magnitude (Geist & Dmowska 1999 empirical):
    /// `log(η_0_max) ≈ 0.5 · M_w − 3.3` (in meters, for thrust faults).
    pub fn peak_seafloor_uplift_m(&self) -> f64 {
        10f64.powf(0.5 * self.mw - 3.3)
    }

    /// Fault length in meters, using the stored value if positive, otherwise
    /// Wells & Coppersmith 1994 scaling `log L = 0.5·M_w − 1.85` (L in km).
    pub fn effective_fault_length_m(&self) -> f64 {
        if self.fault_length_m > 0.0 {
            self.fault_length_m
        } else {
            10f64.powf(0.5 * self.mw - 1.85) * 1000.0
        }
    }

    /// Fault width in meters, using the stored value if positive, otherwise
    /// Wells & Coppersmith 1994 scaling `log W = 0.32·M_w − 1.01` (W in km).
    pub fn effective_fault_width_m(&self) -> f64 {
        if self.fault_width_m > 0.0 {
            self.fault_width_m
        } else {
            10f64.powf(0.32 * self.mw - 1.01) * 1000.0
        }
    }

    /// Equivalent cavity radius for downstream propagation. Uses half the
    /// stored or derived fault length as a proxy for the dominant feature
    /// size of the tsunami source.
    pub fn effective_cavity_radius_m(&self) -> f64 {
        0.5 * self.effective_fault_length_m()
    }

    pub fn initial_displacement(&self) -> InitialDisplacement {
        let center = GeoPoint {
            depth_m: self.water_depth_m,
            ..self.location
        };
        // Prefer the physics-based Okada 1985 peak when the fault has
        // geometry (slip > 0). Falls back to the Geist-Dmowska empirical
        // when slip is zero (legacy presets with only `mw`).
        let okada_peak = if self.slip_m > 0.0 {
            let fault: super::okada::OkadaFault = self.into();
            fault.peak_uplift_m().abs()
        } else {
            0.0
        };
        let peak_amplitude_m = if okada_peak.is_finite() && okada_peak > 0.0 {
            okada_peak
        } else {
            self.peak_seafloor_uplift_m()
        };
        InitialDisplacement {
            center,
            cavity_radius_m: self.effective_cavity_radius_m(),
            peak_amplitude_m,
            source_energy_j: self.energy_j(),
            seismic_mw_equivalent: self.mw,
            dominant_wavelength_m: Some(2.0 * self.effective_cavity_radius_m()),
            label: format!(
                "M_w {:.1} fault, depth {:.0} km",
                self.mw,
                self.depth_m / 1000.0
            ),
            camera_view: None,
        }
    }
}

/// 2011 Tōhoku M_w 9.1 megathrust off the Sanriku coast (Mori et al. 2011;
/// fault dimensions from Fujii & Satake 2013 finite-fault inversion: ~500 km
/// long along strike, ~200 km wide down dip).
pub fn tohoku_2011() -> EarthquakeSource {
    EarthquakeSource {
        mw: 9.1,
        depth_m: 30_000.0,
        strike_deg: 195.0,
        dip_deg: 12.0,
        rake_deg: 85.0,
        slip_m: 30.0,
        fault_length_m: 500_000.0,
        fault_width_m: 200_000.0,
        water_depth_m: 1_500.0,
        location: GeoPoint {
            lat_deg: 38.297,
            lon_deg: 142.372,
            depth_m: 1_500.0,
        },
    }
}

/// 2004 Sumatra-Andaman M_w 9.2 megathrust (Synolakis et al. 2005; Lay et al.
/// 2005; fault dimensions from Lay 2005 + Stein & Okal 2005: ~1300 km long,
/// ~200 km wide).
pub fn indian_ocean_2004() -> EarthquakeSource {
    EarthquakeSource {
        mw: 9.2,
        depth_m: 30_000.0,
        strike_deg: 329.0,
        dip_deg: 8.0,
        rake_deg: 110.0,
        slip_m: 20.0,
        fault_length_m: 1_300_000.0,
        fault_width_m: 200_000.0,
        water_depth_m: 3_500.0,
        location: GeoPoint {
            lat_deg: 3.316,
            lon_deg: 95.854,
            depth_m: 3_500.0,
        },
    }
}

/// Reference: shallow-water wave speed at the source for arrival-time estimates.
pub fn long_wave_speed_m_s(water_depth_m: f64) -> f64 {
    (G_EARTH * water_depth_m).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tohoku_uplift_in_right_band() {
        let eq = tohoku_2011();
        let d = eq.initial_displacement();
        // Tōhoku observed seafloor uplift was ~7 m peak (Fujii & Satake 2013).
        // v0.3.0 wires the full Okada 1985 I-term solve in as the primary
        // peak-amplitude source (with the Geist-Dmowska empirical kept as
        // a fallback for slip-less / Mw-only sources). Acceptable band is
        // intentionally wide because the underlying fault parameters are
        // approximate.
        assert!(
            (1.0..=50.0).contains(&d.peak_amplitude_m),
            "Tōhoku uplift {} m off ballpark",
            d.peak_amplitude_m
        );
    }

    #[test]
    fn long_wave_speed_pacific() {
        // Deep Pacific ~4000 m → ~200 m/s ≈ 720 km/h. Matches NOAA travel-time
        // charts: a tsunami crosses the Pacific in ~22 hours.
        let c = long_wave_speed_m_s(4_000.0);
        assert!((150.0..=250.0).contains(&c));
    }
}
