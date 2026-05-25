//! Asteroid / comet ocean-impact source physics.
//!
//! References:
//! - Ward, S. N., & Asphaug, E. (2000). Asteroid impact tsunami: a
//!   probabilistic hazard assessment. *Icarus*, 145, 64–78.
//! - Schmidt, R. M., & Holsapple, K. A. (1982). Estimates of crater size for
//!   large-body impact: gravity-scaling results. *GSA Spec. Paper*, 190.
//! - Collins, G. S., Melosh, H. J., & Marcus, R. A. (2005). Earth Impact
//!   Effects Program. *Meteoritics & Planetary Science*, 40, 817–840.
//! - Range, M. M. et al. (2022). The Chicxulub Impact Produced a Powerful
//!   Global Tsunami. *AGU Advances*. https://doi.org/10.1029/2021AV000627
//!
//! The Ward–Asphaug framework treats the impact cavity as a parabolic transient
//! crater. Its diameter follows the Schmidt–Holsapple gravity-scaling rule. The
//! cavity collapses, generating a primary wave whose amplitude in deep water
//! attenuates as `r^(-5/6)` due to geometric spreading + frequency dispersion.

use std::f64::consts::PI;

use serde::{Deserialize, Serialize};

use super::constants::{
    G_EARTH, IMPACT_FAR_FIELD_EXPONENT, J_PER_MT_TNT, RHO_SEAWATER, SCHMIDT_HOLSAPPLE_BETA,
    SCHMIDT_HOLSAPPLE_CT,
};
use super::{GeoPoint, InitialDisplacement};

#[cfg(test)]
use super::constants::RHO_ASTEROID_STONY;

/// Input parameters for an asteroid / comet ocean impact.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsteroidImpact {
    /// Diameter of the impactor, meters.
    pub diameter_m: f64,
    /// Bulk density of the impactor, kg/m³.
    /// Stony: 3000, iron: 7800, comet: 535 (see `constants`).
    pub density_kg_m3: f64,
    /// Atmospheric impact velocity, m/s. Earth's escape velocity is ~11.2 km/s;
    /// typical NEO impacts are 15–25 km/s; Chicxulub was estimated at ~20 km/s.
    pub velocity_m_s: f64,
    /// Impact angle measured from the horizontal, degrees. 90° = vertical;
    /// most impacts (~50% probability) are within ±15° of 45°.
    pub angle_deg: f64,
    /// Water depth at impact site, meters.
    pub water_depth_m: f64,
    /// Surface coordinates of the impact site.
    pub location: GeoPoint,
}

impl AsteroidImpact {
    /// Mass of the impactor, kg, treating it as a sphere of bulk density.
    pub fn mass_kg(&self) -> f64 {
        let r = self.diameter_m / 2.0;
        (4.0 / 3.0) * PI * r.powi(3) * self.density_kg_m3
    }

    /// Kinetic energy at atmospheric entry, joules.
    pub fn kinetic_energy_j(&self) -> f64 {
        0.5 * self.mass_kg() * self.velocity_m_s.powi(2)
    }

    /// Kinetic energy in megatons of TNT.
    pub fn kinetic_energy_mt(&self) -> f64 {
        self.kinetic_energy_j() / J_PER_MT_TNT
    }

    /// Transient cavity diameter, meters, via Schmidt–Holsapple gravity-scaling
    /// for water targets (Ward & Asphaug 2000, eqn. 3, calibrated to lab impacts):
    ///
    /// ```text
    /// d_tc = C_T · d_i · (ρ_i / ρ_w)^(1/3) · (v² / (g · d_i))^β · (sin θ)^(1/3)
    /// ```
    /// with `C_T = 1.88`, `β = 0.22` for water.
    pub fn transient_cavity_diameter_m(&self) -> f64 {
        let theta_rad = self.angle_deg.to_radians();
        let pi_term = self.velocity_m_s.powi(2) / (G_EARTH * self.diameter_m);
        SCHMIDT_HOLSAPPLE_CT
            * self.diameter_m
            * (self.density_kg_m3 / RHO_SEAWATER).powf(1.0 / 3.0)
            * pi_term.powf(SCHMIDT_HOLSAPPLE_BETA)
            * theta_rad.sin().powf(1.0 / 3.0)
    }

    /// Transient cavity depth, meters. Ward & Asphaug treat the cavity as a
    /// parabola of revolution; for water targets the depth/diameter ratio is
    /// well-approximated by ≈ 1/2.83 (paper figure 1; cf. Schmidt-Housen).
    pub fn transient_cavity_depth_m(&self) -> f64 {
        self.transient_cavity_diameter_m() / 2.83
    }

    /// Initial peak wave amplitude, meters, at the rim of the cavity.
    /// Ward & Asphaug 2000 eqn. 7: the cavity collapse forms a rim wave with
    /// amplitude scaling as ≈ 0.5 · cavity depth. When the cavity is deeper
    /// than the ocean, the cavity bottoms out on the seafloor and the effective
    /// amplitude saturates at the local water depth.
    pub fn initial_amplitude_m(&self) -> f64 {
        let cavity_depth = self.transient_cavity_depth_m();
        let saturated = cavity_depth.min(self.water_depth_m);
        0.5 * saturated.max(0.0)
    }

    /// Equivalent seismic moment magnitude (Hanks & Kanamori 1979 inverted),
    /// assuming ~1% of kinetic energy radiated as seismic waves (Schultz &
    /// Gault 1975 for hypervelocity oceanic impacts).
    pub fn seismic_mw_equivalent(&self) -> f64 {
        let radiated_j = 0.01 * self.kinetic_energy_j();
        // log10(M0) = log10(E_s / 5e-5)  ⇒  Mw = (2/3) (log10 M0 − 9.1)
        let m0 = radiated_j / 5.0e-5;
        (2.0 / 3.0) * (m0.log10() - 9.1)
    }

    /// Snapshot of the source ready for the propagation solver.
    pub fn initial_displacement(&self) -> InitialDisplacement {
        let cavity_r = self.transient_cavity_diameter_m() / 2.0;
        let center = GeoPoint {
            depth_m: self.water_depth_m,
            ..self.location
        };
        InitialDisplacement {
            center,
            cavity_radius_m: cavity_r,
            peak_amplitude_m: self.initial_amplitude_m(),
            source_energy_j: self.kinetic_energy_j(),
            seismic_mw_equivalent: self.seismic_mw_equivalent(),
            dominant_wavelength_m: Some(2.0 * cavity_r),
            label: format!(
                "{:.1}-m {:.0} kg/m³ asteroid @ {:.1} km/s, {:.0}° → {:.1} Mt",
                self.diameter_m,
                self.density_kg_m3,
                self.velocity_m_s / 1000.0,
                self.angle_deg,
                self.kinetic_energy_mt()
            ),
        }
    }
}

/// Far-field amplitude attenuation at distance `r` from the impact center.
///
/// Ward & Asphaug 2000: in a uniform deep ocean, geometric spreading combined
/// with frequency dispersion gives `A(r) = A_0 · (R_c / r)^(5/6)` for r ≫ R_c.
/// At distances less than the cavity radius this would diverge, so the formula
/// is clamped at `A_0`.
pub fn far_field_amplitude_m(initial_amplitude_m: f64, cavity_radius_m: f64, range_m: f64) -> f64 {
    if range_m <= cavity_radius_m {
        return initial_amplitude_m;
    }
    initial_amplitude_m * (cavity_radius_m / range_m).powf(IMPACT_FAR_FIELD_EXPONENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Sanity-check Chicxulub against the Range et al. 2022 AGU Advances result:
    /// 14-km bolide, 20 km/s, 60° impact angle. They reported a 4.5-km initial
    /// "ejecta-driven" wall and a 1.5-km ring wave at r = 220 km.
    /// Our analytical Ward–Asphaug formula doesn't include the ejecta wall — it
    /// models the cavity rim wave — but the cavity-rim amplitude and the
    /// far-field decay should land in the right order of magnitude.
    #[test]
    fn chicxulub_order_of_magnitude() {
        let chicxulub = AsteroidImpact {
            diameter_m: 14_000.0,
            density_kg_m3: RHO_ASTEROID_STONY,
            velocity_m_s: 20_000.0,
            angle_deg: 60.0,
            water_depth_m: 1_500.0, // Yucatan shelf at impact time
            location: GeoPoint {
                lat_deg: 21.4,
                lon_deg: -89.5,
                depth_m: 1_500.0,
            },
        };

        let d = chicxulub.initial_displacement();
        let cavity_km = d.cavity_radius_m / 1000.0;
        // Transient cavity diameter for Chicxulub is widely cited as ~100 km
        // (Morgan et al. 2016 IODP-ICDP Exp 364). Our scaling gives a cavity
        // radius in the 20–100 km range with these parameters.
        assert!(
            (10.0..=120.0).contains(&cavity_km),
            "cavity radius {} km outside plausible Chicxulub band",
            cavity_km
        );
        assert!(d.source_energy_j > 1e23, "energy way too low for Chicxulub");
    }

    /// A 1-km stony impactor at 20 km/s — the Ward-Asphaug 2003 1950DA case.
    /// They reported a tsunami over 100 m high on the US east coast (~6000 km
    /// from a mid-Atlantic impact). Our far-field formula should produce an
    /// amplitude in that ballpark order.
    #[test]
    fn ward_asphaug_1km_atlantic() {
        let impactor = AsteroidImpact {
            diameter_m: 1_000.0,
            density_kg_m3: RHO_ASTEROID_STONY,
            velocity_m_s: 20_000.0,
            angle_deg: 45.0,
            water_depth_m: 4_500.0,
            location: GeoPoint {
                lat_deg: 35.0,
                lon_deg: -45.0,
                depth_m: 4_500.0,
            },
        };
        let d = impactor.initial_displacement();
        let amp_6000km = far_field_amplitude_m(d.peak_amplitude_m, d.cavity_radius_m, 6_000_000.0);
        // Order of magnitude: tens to low hundreds of meters; not a 1-m ripple,
        // not a 10-km wall.
        assert!(
            (10.0..=500.0).contains(&amp_6000km),
            "1 km Atlantic impact gave {} m at 6000 km — off the Ward-Asphaug ballpark",
            amp_6000km
        );
    }
}
