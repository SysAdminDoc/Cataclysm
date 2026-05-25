//! Okada 1985 surface deformation from a rectangular dislocation in an
//! elastic half-space.
//!
//! Reference:
//! - Okada, Y. (1985). Surface deformation due to shear and tensile faults
//!   in a half-space. *Bulletin of the Seismological Society of America*,
//!   75(4), 1135–1154.
//! - Mansinha, L., & Smylie, D. E. (1971). The displacement fields of
//!   inclined faults. *BSSA*, 61(5), 1433–1440.
//! - Tanioka, Y., & Satake, K. (1996). Tsunami generation by horizontal
//!   displacement of ocean bottom. *Geophys. Res. Lett.*, 23(8), 861–864.
//!
//! For a rectangular fault patch of length L (along strike) and width W
//! (down dip) at depth d, with strike φ, dip δ, rake λ, and uniform slip u,
//! Okada gives closed-form expressions for the three components of surface
//! displacement (u_x, u_y, u_z) at any point on the free surface.
//!
//! Vertical displacement u_z drives the tsunami initial condition: the
//! water-surface elevation η₀(x, y) ≈ u_z(x, y) for tsunami wavelengths
//! much longer than the ocean depth. For dipping faults, Tanioka–Satake
//! 1996 adds a horizontal-bathymetry-coupling correction η₀ += -u_h · ∇h.
//!
//! ## Implementation status (v0.1.x)
//!
//! **Scaffold only.** The struct + public surface are stable; the body of
//! `vertical_displacement_field` returns zero. The next-session task is to
//! fill in the four chi-integral terms from Okada eqns. (25)–(30). Per the
//! research plan F5, validation target is the published Tōhoku 2011
//! Fujii-Satake 2013 finite-fault inversion: peak vertical uplift ~7 m at
//! the central subfault.

use serde::{Deserialize, Serialize};

use super::constants::R_EARTH_M;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OkadaFault {
    /// Centre of the fault projected to the free surface (deg).
    pub center_lat: f64,
    pub center_lon: f64,
    /// Hypocentre depth (m, positive downward).
    pub depth_m: f64,
    /// Fault length along strike (m).
    pub length_m: f64,
    /// Fault width down dip (m).
    pub width_m: f64,
    /// Strike angle (deg, clockwise from north).
    pub strike_deg: f64,
    /// Dip angle (deg, 0 = horizontal, 90 = vertical).
    pub dip_deg: f64,
    /// Rake (deg, slip direction in the fault plane; 90 = pure thrust).
    pub rake_deg: f64,
    /// Average slip on the fault (m).
    pub slip_m: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct OkadaDisplacementField {
    /// Grid origin in WGS84 degrees (centred on the fault).
    pub origin_lat: f64,
    pub origin_lon: f64,
    /// Grid spacing in meters (square cells).
    pub dx_m: f64,
    /// Grid dimensions.
    pub nx: usize,
    pub ny: usize,
    /// Vertical displacement field, row-major (`ny` rows of `nx` cols), meters.
    pub uz_m: Vec<f64>,
}

impl OkadaFault {
    /// Compute the surface vertical-displacement field over an `nx × ny` grid
    /// of square cells with spacing `dx_m`, centred on the fault.
    ///
    /// **v0.1.x scaffold:** returns a Gaussian bump centred on the fault as
    /// a placeholder. The real Okada elliptic-integral form lands in
    /// v0.2.0 — see module-level docstring for the implementation plan.
    pub fn vertical_displacement_field(&self, nx: usize, ny: usize, dx_m: f64) -> OkadaDisplacementField {
        let mut uz_m = vec![0.0f64; nx * ny];

        // Placeholder Gaussian bump until Okada elliptic integrals are wired.
        // Width scales with fault length / width, amplitude scales with slip.
        let cx = (nx as f64) * 0.5;
        let cy = (ny as f64) * 0.5;
        let sigma_x = (self.length_m / dx_m).max(1.0) * 0.4;
        let sigma_y = (self.width_m / dx_m).max(1.0) * 0.4;
        // Conservative placeholder amplitude: half the slip (Tōhoku slip ~30 m
        // → 15 m peak placeholder; observed peak was ~7 m, will refine with Okada).
        let amp = 0.5 * self.slip_m * (self.dip_deg.to_radians().sin());

        for j in 0..ny {
            for i in 0..nx {
                let dx = (i as f64 - cx) / sigma_x;
                let dy = (j as f64 - cy) / sigma_y;
                uz_m[j * nx + i] = amp * (-(dx * dx + dy * dy) * 0.5).exp();
            }
        }

        // Convert grid spacing to degree offset (approximate, near-source).
        let lat_per_m = 360.0 / (2.0 * std::f64::consts::PI * R_EARTH_M);
        let _lon_per_m = lat_per_m / self.center_lat.to_radians().cos().max(0.1);

        OkadaDisplacementField {
            origin_lat: self.center_lat - (ny as f64 * 0.5) * dx_m * lat_per_m,
            origin_lon: self.center_lon, // TODO: longitude offset by lon_per_m
            dx_m,
            nx,
            ny,
            uz_m,
        }
    }

    /// Peak vertical uplift in meters — Gaussian centre value for the
    /// scaffold; once the real Okada is wired this returns the analytical
    /// maximum.
    pub fn peak_uplift_m(&self) -> f64 {
        0.5 * self.slip_m * self.dip_deg.to_radians().sin().abs()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Tōhoku 2011 placeholder: with the Fujii-Satake 2013 fault dimensions
    /// (500 km × 200 km, 30 m slip, 12° dip), the scaffold gives a 3 m peak.
    /// Real Okada is expected to return ~7 m (Mori et al. 2011 survey).
    /// This test pins the current scaffold output so future Okada work has
    /// a known starting point.
    #[test]
    fn tohoku_scaffold_peak_in_band() {
        let f = OkadaFault {
            center_lat: 38.297,
            center_lon: 142.372,
            depth_m: 30_000.0,
            length_m: 500_000.0,
            width_m: 200_000.0,
            strike_deg: 195.0,
            dip_deg: 12.0,
            rake_deg: 85.0,
            slip_m: 30.0,
        };
        let peak = f.peak_uplift_m();
        // Scaffold = 0.5 · slip · sin(dip) = 0.5 · 30 · sin(12°) ≈ 3.12 m
        assert!((1.0..=10.0).contains(&peak), "Tōhoku scaffold peak {} m", peak);

        let field = f.vertical_displacement_field(32, 32, 25_000.0);
        let max_uz: f64 = field.uz_m.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        assert!((peak * 0.95..=peak * 1.05).contains(&max_uz));
    }
}
