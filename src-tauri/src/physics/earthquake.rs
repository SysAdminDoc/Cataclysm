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
//! This scaffold provides an order-of-magnitude estimate from moment magnitude
//! using Abe (1979) `log M0 = 1.5 M_w + 9.1`. A full Okada-1985 dislocation
//! field (strike, dip, rake, slip, fault length × width, depth) is planned for
//! v0.3.0 — it requires elliptic-integral evaluations that we'll add when the
//! full propagation grid is in place.

use serde::{Deserialize, Serialize};

use super::constants::G_EARTH;
use super::{GeoPoint, InitialDisplacement};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EarthquakeSource {
    /// Moment magnitude.
    pub mw: f64,
    /// Hypocentral depth, meters.
    pub depth_m: f64,
    /// Fault strike, degrees clockwise from north. For Okada (planned).
    pub strike_deg: f64,
    /// Fault dip, degrees from horizontal. For Okada (planned).
    pub dip_deg: f64,
    /// Slip rake, degrees. For Okada (planned).
    pub rake_deg: f64,
    /// Average slip on the fault, meters. For Okada (planned).
    pub slip_m: f64,
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

    /// Equivalent cavity radius for downstream propagation. For megathrust
    /// events the fault length scales with magnitude: `log L ≈ 0.5 M_w − 1.85`
    /// (Wells & Coppersmith 1994). We use half the fault length as a proxy
    /// for the dominant feature size of the tsunami source.
    pub fn effective_cavity_radius_m(&self) -> f64 {
        let length_km = 10f64.powf(0.5 * self.mw - 1.85);
        0.5 * length_km * 1000.0
    }

    pub fn initial_displacement(&self) -> InitialDisplacement {
        InitialDisplacement {
            center: self.location,
            cavity_radius_m: self.effective_cavity_radius_m(),
            peak_amplitude_m: self.peak_seafloor_uplift_m(),
            source_energy_j: self.energy_j(),
            seismic_mw_equivalent: self.mw,
            dominant_wavelength_m: Some(2.0 * self.effective_cavity_radius_m()),
            label: format!(
                "M_w {:.1} fault, depth {:.0} km",
                self.mw,
                self.depth_m / 1000.0
            ),
        }
    }
}

/// 2011 Tōhoku M_w 9.1 megathrust off the Sanriku coast (Mori et al. 2011).
pub fn tohoku_2011() -> EarthquakeSource {
    EarthquakeSource {
        mw: 9.1,
        depth_m: 30_000.0,
        strike_deg: 195.0,
        dip_deg: 12.0,
        rake_deg: 85.0,
        slip_m: 30.0,
        water_depth_m: 1_500.0,
        location: GeoPoint {
            lat_deg: 38.297,
            lon_deg: 142.372,
            depth_m: 1_500.0,
        },
    }
}

/// 2004 Sumatra-Andaman M_w 9.2 megathrust (Synolakis et al. 2005; Lay et al. 2005).
pub fn indian_ocean_2004() -> EarthquakeSource {
    EarthquakeSource {
        mw: 9.2,
        depth_m: 30_000.0,
        strike_deg: 329.0,
        dip_deg: 8.0,
        rake_deg: 110.0,
        slip_m: 20.0,
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
        // Our M_w → uplift empirical (Geist-Dmowska) for M9.1 gives ≈ 10^1.25 ≈ 17.8 m.
        // We allow a wide band — this is an OOM scaling, not a true Okada solve.
        assert!(
            (3.0..=50.0).contains(&d.peak_amplitude_m),
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
