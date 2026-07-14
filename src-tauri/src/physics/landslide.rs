//! Landslide-generated tsunami physics.
//!
//! References:
//! - Fritz, H. M., Hager, W. H., & Minor, H.-E. (2001). Lituya Bay case:
//!   rockslide impact and wave run-up. *Sci. Tsunami Hazards*, 19, 3–22.
//! - Slingerland, R. L., & Voight, B. (1979). Occurrences, properties, and
//!   predictive models of landslide-generated water waves. *Developments in
//!   Geotechnical Engineering*, 14B.
//! - Heller, V., & Hager, W. H. (2010). Impulse product parameter in landslide
//!   generated impulse waves. *J. Waterway, Port, Coastal, and Ocean Eng.*
//! - Watts, P., Grilli, S. T., et al. (2005). Tsunami generation by submarine
//!   mass failure. II: predictive equations and case studies. *J. Waterway*.
//!
//! Two regimes:
//! - **Subaerial** (Lituya Bay 1958): rock falls into water from above,
//!   creating a Froude-scaled impact wave whose amplitude depends on slide
//!   velocity, volume, density, and the receiving water body's depth and
//!   width.
//! - **Submarine** (Storegga ~8150 BP): slope failure under water; modeled
//!   via Watts et al. 2005 with characteristic wavelength `λ = t₀ √(g h)`
//!   where `t₀` is slide duration.

use serde::{Deserialize, Serialize};

use super::constants::{G_EARTH, RHO_ROCK_CRUST, RHO_SEAWATER};
use super::{GeoPoint, InitialDisplacement};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum LandslideKind {
    Subaerial,
    Submarine,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LandslideSource {
    pub kind: LandslideKind,
    /// Slide volume, m³.
    pub volume_m3: f64,
    /// Bulk density of slide material, kg/m³.
    pub density_kg_m3: f64,
    /// Drop height (subaerial) or characteristic slope-failure depth (submarine), meters.
    pub drop_height_m: f64,
    /// Average slope of the failure surface, degrees.
    pub slope_deg: f64,
    /// Water depth at the receiving body, meters. For confined fjords like
    /// Lituya, this is the inlet depth (~120 m for Gilbert Inlet).
    pub water_depth_m: f64,
    /// Width of receiving water body across the slide axis, meters. For Lituya
    /// Bay's Gilbert Inlet, ≈ 1300 m.
    pub water_body_width_m: f64,
    pub location: GeoPoint,
}

impl LandslideSource {
    pub fn mass_kg(&self) -> f64 {
        self.volume_m3 * self.density_kg_m3
    }

    /// Slide impact velocity, m/s, from frictionless free-fall (upper bound):
    /// `v = √(2 g h)`. Real slides include friction; Lituya measurements
    /// suggest the rock fragments reached ≈ 110 m/s vs free-fall ~133 m/s
    /// from 900 m, so we apply a friction factor of 0.8 (Slingerland & Voight).
    pub fn impact_velocity_m_s(&self) -> f64 {
        0.8 * (2.0 * G_EARTH * self.drop_height_m).sqrt()
    }

    pub fn kinetic_energy_j(&self) -> f64 {
        0.5 * self.mass_kg() * self.impact_velocity_m_s().powi(2)
    }

    /// Froude number based on impact velocity and receiving water depth.
    pub fn froude(&self) -> f64 {
        // Floor the depth (as `slide_thickness_ratio`/`m_rel` do) so a zero or
        // degenerate water depth can't divide by zero into an infinite Froude
        // number and NaN-poison the amplitude estimate.
        self.impact_velocity_m_s() / (G_EARTH * self.water_depth_m.max(1.0)).sqrt()
    }

    /// Relative slide thickness (slide vertical extent / water depth).
    /// Used in Heller-Hager 2010 impulse product parameter.
    pub fn slide_thickness_ratio(&self) -> f64 {
        // Approximate slide thickness as ∛V (cube root of volume).
        let s = self.volume_m3.cbrt();
        s / self.water_depth_m.max(1.0)
    }

    /// Initial impact wave amplitude, meters.
    ///
    /// For subaerial slides we use the Heller-Hager 2010 (2D channel) empirical:
    /// `A / h = 0.88 · P^(0.8)` with the impulse product parameter
    /// `P = F · S^(1/2) · M^(1/4) · cos(θ/6)`, where F is Froude, S the
    /// thickness ratio, M the relative slide mass `ρ_s V / (ρ_w b h²)`, and θ
    /// the slope angle. This is a 2D channel form so it tends to over-predict
    /// for open-coast slides; for narrow inlets like Lituya Bay it matches
    /// measured run-up well.
    ///
    /// For submarine slides we use the Watts et al. 2005 form:
    /// `η_0 = 0.5 · S₀ · sin(θ) · (1 − cos(t/t₀))` peaking at `S₀ · sin(θ)`,
    /// where `S₀` is the characteristic slide displacement (≈ slide length).
    /// As a closed-form characteristic amplitude we use
    /// `η_0 ≈ 0.0574 · S · sin(θ) · √V` (Watts 2003 best-fit).
    pub fn initial_amplitude_m(&self) -> f64 {
        match self.kind {
            LandslideKind::Subaerial => {
                let f = self.froude();
                let s = self.slide_thickness_ratio();
                let m_rel = (self.density_kg_m3 * self.volume_m3)
                    / (RHO_SEAWATER
                        * self.water_body_width_m
                        * self.water_depth_m.powi(2).max(1.0));
                let theta = self.slope_deg.to_radians();
                let p = f * s.powf(0.5) * m_rel.powf(0.25) * (theta / 6.0).cos();
                let amp_over_h = 0.88 * p.powf(0.8);
                amp_over_h * self.water_depth_m
            }
            LandslideKind::Submarine => {
                let theta = self.slope_deg.to_radians();
                0.0574 * self.water_depth_m * theta.sin() * self.volume_m3.cbrt() / 100.0
            }
        }
    }

    /// Effective "cavity radius" for downstream propagation — for subaerial
    /// slides this is roughly the slide footprint in the water (`∛V`); for
    /// submarine slides it is the characteristic slide length, ≈ V^(1/3) · 2.
    pub fn effective_cavity_radius_m(&self) -> f64 {
        match self.kind {
            LandslideKind::Subaerial => self.volume_m3.cbrt(),
            LandslideKind::Submarine => 2.0 * self.volume_m3.cbrt(),
        }
    }

    /// Equivalent seismic moment magnitude. Landslide slides radiate ~0.1% of
    /// kinetic energy seismically (Eissler & Kanamori 1987).
    pub fn seismic_mw_equivalent(&self) -> f64 {
        // A subaerial/submarine slide entered with drop_height_m = 0 yields
        // zero free-fall velocity and therefore zero kinetic energy; the
        // floored helper keeps Mw finite (→ very small) instead of -inf.
        let radiated_j = 1.0e-3 * self.kinetic_energy_j();
        super::mw_from_radiated_j(radiated_j)
    }

    pub fn initial_displacement(&self) -> InitialDisplacement {
        // Project the location to the *receiving* water depth so the
        // propagation-depth fallback in `run_preset` uses the right value
        // even for subaerial slides where the source coordinate sits above
        // sea level (e.g. Cumbre Vieja).
        let center = GeoPoint {
            depth_m: self.water_depth_m,
            ..self.location
        };
        InitialDisplacement {
            center,
            cavity_radius_m: self.effective_cavity_radius_m(),
            peak_amplitude_m: self.initial_amplitude_m(),
            source_energy_j: self.kinetic_energy_j(),
            seismic_mw_equivalent: self.seismic_mw_equivalent(),
            dominant_wavelength_m: None,
            label: format!(
                "{:?} slide V={:.2e} m³, drop {:.0} m, slope {:.0}°",
                self.kind, self.volume_m3, self.drop_height_m, self.slope_deg
            ),
            camera_view: None,
        }
    }
}

/// Lituya Bay 1958 reference parameters (Fritz et al. 2001 + USGS):
/// 30 million m³ rock slide, ~900 m drop, ~50° slope, 122 m inlet depth,
/// ~1300 m inlet width. Should reproduce the measured ~150 m peak wave height
/// at the head of Gilbert Inlet (with the 524 m run-up emerging from the bay
/// geometry, not the initial wave amplitude — runup amplification is handled
/// separately in `shallow_water::synolakis_runup`).
pub fn lituya_bay_1958() -> LandslideSource {
    LandslideSource {
        kind: LandslideKind::Subaerial,
        volume_m3: 30.0e6,
        density_kg_m3: RHO_ROCK_CRUST,
        drop_height_m: 900.0,
        slope_deg: 50.0,
        water_depth_m: 122.0,
        water_body_width_m: 1_300.0,
        location: GeoPoint {
            lat_deg: 58.654,
            lon_deg: -137.55,
            depth_m: 122.0,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lituya_bay_order_of_magnitude() {
        let s = lituya_bay_1958();
        let d = s.initial_displacement();
        // Initial wave at the slide-impact point: Fritz 2001 reports ~150 m at
        // entry, then 524 m of run-up on the opposing shore (runup is a
        // bay-geometry amplification of the impact wave). Heller-Hager 2010
        // for a confined channel gives initial amplitudes that can be quite
        // large when the slide is supercritical (Froude > 1). The acceptable
        // band is "tens to ~1000 m" — bigger means a formula bug, smaller
        // means a unit-confusion bug.
        assert!(
            (10.0..=1000.0).contains(&d.peak_amplitude_m),
            "Lituya initial wave {} m outside plausible Heller-Hager band",
            d.peak_amplitude_m
        );
        assert!(d.source_energy_j > 1.0e14, "Lituya energy too low");
    }

    /// A submarine slope-failure entered with drop_height_m = 0 has zero
    /// free-fall energy. The displacement snapshot must stay fully finite —
    /// the seismic Mw used to be -inf (log10 of zero energy), which then
    /// serialised over IPC and surfaced as a non-finite magnitude in the UI.
    #[test]
    fn zero_drop_height_keeps_displacement_finite() {
        let s = LandslideSource {
            kind: LandslideKind::Submarine,
            volume_m3: 1.0e9,
            density_kg_m3: 2500.0,
            drop_height_m: 0.0,
            slope_deg: 10.0,
            water_depth_m: 1000.0,
            water_body_width_m: 5000.0,
            location: GeoPoint { lat_deg: 0.0, lon_deg: 0.0, depth_m: 1000.0 },
        };
        let d = s.initial_displacement();
        assert!(d.seismic_mw_equivalent.is_finite(), "Mw must be finite, got {}", d.seismic_mw_equivalent);
        assert!(d.peak_amplitude_m.is_finite());
        assert!(d.source_energy_j.is_finite());
    }

    /// A subaerial slide into zero-depth water must not divide by zero in the
    /// Froude number and NaN-poison the amplitude. The depth floor keeps every
    /// derived quantity finite.
    #[test]
    fn zero_water_depth_keeps_subaerial_finite() {
        let s = LandslideSource {
            kind: LandslideKind::Subaerial,
            volume_m3: 3.0e7,
            density_kg_m3: 2700.0,
            drop_height_m: 900.0,
            slope_deg: 40.0,
            water_depth_m: 0.0,
            water_body_width_m: 1300.0,
            location: GeoPoint { lat_deg: 0.0, lon_deg: 0.0, depth_m: 0.0 },
        };
        assert!(s.froude().is_finite(), "froude must be finite, got {}", s.froude());
        let d = s.initial_displacement();
        assert!(d.peak_amplitude_m.is_finite());
        assert!(d.source_energy_j.is_finite());
    }
}
