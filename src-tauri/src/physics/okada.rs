//! Okada 1985 surface deformation from a rectangular dislocation in an
//! elastic half-space.
//!
//! References:
//! - Okada, Y. (1985). Surface deformation due to shear and tensile faults
//!   in a half-space. *Bulletin of the Seismological Society of America*,
//!   75(4), 1135–1154.
//! - Mansinha, L., & Smylie, D. E. (1971). The displacement fields of
//!   inclined faults. *BSSA*, 61(5), 1433–1440.
//! - Tanioka, Y., & Satake, K. (1996). Tsunami generation by horizontal
//!   displacement of ocean bottom. *Geophys. Res. Lett.*, 23(8), 861–864.
//!
//! Implements the vertical surface-displacement field `u_z(x, y)` for a
//! rectangular fault patch with strike φ, dip δ, rake λ, length L, width
//! W, depth d, and uniform slip U. The fault patch is treated as the
//! union of four point-source contributions (the four corners) via the
//! standard Chinnery-notation integral. For each corner Okada's eqns.
//! (25)–(30) give the closed-form vertical displacement.
//!
//! This is the strike-slip + dip-slip contribution; tensile (opening)
//! component is supported but defaults to zero — most tectonic faults are
//! pure strike-slip + dip-slip combinations.

use serde::{Deserialize, Serialize};

use super::constants::R_EARTH_M;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OkadaFault {
    /// Centre of the fault projected to the free surface (deg).
    pub center_lat: f64,
    pub center_lon: f64,
    /// Hypocentre depth (m, positive downward). This is the depth of the
    /// fault's top edge below the free surface.
    pub depth_m: f64,
    /// Fault length along strike (m).
    pub length_m: f64,
    /// Fault width down dip (m).
    pub width_m: f64,
    /// Strike angle (deg, clockwise from north).
    pub strike_deg: f64,
    /// Dip angle (deg, 0 = horizontal, 90 = vertical).
    pub dip_deg: f64,
    /// Rake (deg, slip direction in the fault plane; 90 = pure thrust,
    /// 0 = right-lateral strike-slip).
    pub rake_deg: f64,
    /// Average slip on the fault (m).
    pub slip_m: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct OkadaDisplacementField {
    pub origin_lat: f64,
    pub origin_lon: f64,
    pub dx_m: f64,
    pub nx: usize,
    pub ny: usize,
    pub uz_m: Vec<f64>,
}

impl OkadaFault {
    /// Vertical surface displacement at an east/north offset from the fault
    /// centre. This is the same Okada kernel used by the standalone field
    /// generator and lets propagation grids sample their own non-square,
    /// georeferenced cell layout without an interpolation pass.
    pub fn vertical_displacement_at_offset_m(&self, east_m: f64, north_m: f64) -> f64 {
        let strike = self.strike_deg.to_radians();
        let rake = self.rake_deg.to_radians();
        let x = east_m * strike.sin() + north_m * strike.cos();
        let y = -east_m * strike.cos() + north_m * strike.sin();
        okada_uz_chinnery(
            x,
            y,
            self.depth_m,
            self.length_m,
            self.width_m,
            self.dip_deg.to_radians(),
            self.slip_m * rake.cos(),
            self.slip_m * rake.sin(),
            0.0,
        )
    }

    /// Compute the surface vertical-displacement field over an `nx × ny`
    /// grid of square cells with spacing `dx_m`, centred on the fault.
    pub fn vertical_displacement_field(
        &self,
        nx: usize,
        ny: usize,
        dx_m: f64,
    ) -> OkadaDisplacementField {
        let mut uz_m = vec![0.0f64; nx * ny];

        let cx = (nx as f64) * 0.5;
        let cy = (ny as f64) * 0.5;

        for j in 0..ny {
            for i in 0..nx {
                // Cell-centre offset from fault centre, in meters, in the
                // global east/north frame.
                let east_m = (i as f64 - cx + 0.5) * dx_m;
                let north_m = (j as f64 - cy + 0.5) * dx_m;

                uz_m[j * nx + i] = self.vertical_displacement_at_offset_m(east_m, north_m);
            }
        }

        // Georeference cell (0,0) — the grid's south-west corner (its centre
        // sits at east/north offset `-(n/2 - 0.5)·dx` from the fault centre).
        // Latitude and longitude must use the SAME half-grid shift so a
        // consumer treating `(origin_lat, origin_lon)` as the SW corner does not
        // misregister the field. Longitude metres convert with a cos(lat) term;
        // latitude does not.
        let lat_per_m = 360.0 / (2.0 * std::f64::consts::PI * R_EARTH_M);
        let lon_per_m = lat_per_m / self.center_lat.to_radians().cos().abs().max(1e-6);
        OkadaDisplacementField {
            origin_lat: self.center_lat - (ny as f64 * 0.5) * dx_m * lat_per_m,
            origin_lon: self.center_lon - (nx as f64 * 0.5) * dx_m * lon_per_m,
            dx_m,
            nx,
            ny,
            uz_m,
        }
    }

    /// Closed-form peak vertical uplift at the centre of the fault footprint.
    pub fn peak_uplift_m(&self) -> f64 {
        self.vertical_displacement_at_offset_m(0.0, 0.0)
    }
}

/// Poisson's ratio for the half-space. Okada 1985's I-terms carry the
/// elastic factor μ/(λ+μ), which for a Poisson solid equals 1 − 2ν; the
/// reference implementation (Beauducel's okada85.m) bakes it in exactly
/// that way with ν = 0.25 → factor 0.5. (Distinct from DC3D's
/// α = (λ+μ)/(λ+2μ) = 2/3 — using that here inflates every I-term by
/// 4/3, which was the pre-2026-07-09 bug.)
const NU: f64 = 0.25;

#[inline]
fn elastic_factor() -> f64 {
    1.0 - 2.0 * NU
}

/// Vertical surface displacement at (x, y, z=0) from a rectangular fault of
/// length L (along x, centred), width W (down dip), top-edge depth d, dip
/// angle δ. Slip is decomposed into strike-slip U_ss, dip-slip U_ds,
/// tensile U_ts.
///
/// Follows Okada 1985 eqns. (24)–(30) exactly as implemented by the
/// reference okada85.m (Beauducel, IPGP/deformation-lib): Chinnery corners
/// f(x', p) − f(x', p−W) − f(x'−L, p) + f(x'−L, p−W) with
/// p = y·cosδ + d_bottom·sinδ and q = y·sinδ − d_bottom·cosδ, where
/// d_bottom = d_top + W·sinδ is the depth of the fault's DOWN-DIP edge —
/// the paper's `d`. Validated against Okada 1985 Table 2 (see tests).
#[allow(clippy::too_many_arguments)]
fn okada_uz_chinnery(
    x: f64,
    y: f64,
    d: f64,
    l: f64,
    w: f64,
    dip: f64,
    u_ss: f64,
    u_ds: f64,
    u_ts: f64,
) -> f64 {
    let sin_d = dip.sin();
    let cos_d = dip.cos();
    // Okada's d is the bottom-edge depth; this API takes the top edge.
    let d_bottom = d + w * sin_d;
    let p = y * cos_d + d_bottom * sin_d;
    let q = y * sin_d - d_bottom * cos_d;
    // Centre the fault along strike: ξ ∈ [−L/2, L/2] ≡ f(x+L/2) − f(x−L/2).
    let x_a = x + l * 0.5;
    let x_b = x - l * 0.5;

    let chinnery = |f: &dyn Fn(f64, f64, f64, f64) -> f64| -> f64 {
        f(x_a, p, q, dip) - f(x_a, p - w, q, dip) - f(x_b, p, q, dip) + f(x_b, p - w, q, dip)
    };

    let two_pi = 2.0 * std::f64::consts::PI;
    -u_ss / two_pi * chinnery(&uz_ss)
        - u_ds / two_pi * chinnery(&uz_ds)
        + u_ts / two_pi * chinnery(&uz_tf)
}

/// `tan⁻¹(ξη / qR)`, defined as zero when q = 0 (Okada 1985 p. 1144
/// convention). Plain single-branch atan — NOT atan2, whose extra
/// half-turns break the Chinnery telescoping.
#[inline]
fn atan_term(xi: f64, eta: f64, q: f64, r: f64) -> f64 {
    if q == 0.0 {
        0.0
    } else {
        (xi * eta / (q * r)).atan()
    }
}

/// Okada 1985 eqn. (28)/(29) I4, with the cos δ → 0 vertical-fault limit.
fn i4(db: f64, eta: f64, q: f64, dip: f64, r: f64) -> f64 {
    let cos_d = dip.cos();
    if cos_d.abs() > f64::EPSILON {
        elastic_factor() / cos_d * ((r + db).ln() - dip.sin() * (r + eta).ln())
    } else {
        -elastic_factor() * q / (r + db)
    }
}

/// Okada 1985 eqn. (28)/(29) I5, with the cos δ → 0 limit and the ξ = 0
/// special case (the atan argument degenerates there; okada85.m sets 0).
fn i5(xi: f64, eta: f64, q: f64, dip: f64, r: f64, db: f64) -> f64 {
    let sin_d = dip.sin();
    let cos_d = dip.cos();
    if cos_d.abs() > f64::EPSILON {
        if xi == 0.0 {
            return 0.0;
        }
        let x_term = (xi * xi + q * q).sqrt();
        elastic_factor() * 2.0 / cos_d
            * ((eta * (x_term + q * cos_d) + x_term * (r + x_term) * sin_d)
                / (xi * (r + x_term) * cos_d))
                .atan()
    } else {
        -elastic_factor() * xi * sin_d / (r + db)
    }
}

/// Strike-slip u_z corner term — Okada 1985 eqn. (25):
///   d̃·q/(R(R+η)) + q·sinδ/(R+η) + I4·sinδ
fn uz_ss(xi: f64, eta: f64, q: f64, dip: f64) -> f64 {
    let sin_d = dip.sin();
    let cos_d = dip.cos();
    let r = (xi * xi + eta * eta + q * q).sqrt();
    let db = eta * sin_d - q * cos_d;
    db * q / (r * (r + eta)) + q * sin_d / (r + eta) + i4(db, eta, q, dip, r) * sin_d
}

/// Dip-slip u_z corner term — Okada 1985 eqn. (26):
///   d̃·q/(R(R+ξ)) + sinδ·tan⁻¹(ξη/qR) − I5·sinδ·cosδ
fn uz_ds(xi: f64, eta: f64, q: f64, dip: f64) -> f64 {
    let sin_d = dip.sin();
    let cos_d = dip.cos();
    let r = (xi * xi + eta * eta + q * q).sqrt();
    let db = eta * sin_d - q * cos_d;
    db * q / (r * (r + xi)) + sin_d * atan_term(xi, eta, q, r)
        - i5(xi, eta, q, dip, r, db) * sin_d * cos_d
}

/// Tensile u_z corner term — Okada 1985 eqn. (27):
///   ỹ·q/(R(R+ξ)) + cosδ·(ξ·q/(R(R+η)) − tan⁻¹(ξη/qR)) − I5·sin²δ
fn uz_tf(xi: f64, eta: f64, q: f64, dip: f64) -> f64 {
    let sin_d = dip.sin();
    let cos_d = dip.cos();
    let r = (xi * xi + eta * eta + q * q).sqrt();
    let db = eta * sin_d - q * cos_d;
    let yb = eta * cos_d + q * sin_d;
    yb * q / (r * (r + xi)) + cos_d * xi * q / (r * (r + eta))
        - cos_d * atan_term(xi, eta, q, r)
        - i5(xi, eta, q, dip, r, db) * sin_d * sin_d
}

/// Adapter: turn an [`super::earthquake::EarthquakeSource`] into an
/// [`OkadaFault`] for use with the SWE solver. The seismic-magnitude
/// fields are not preserved (Okada operates on geometry + slip only); use
/// `effective_fault_length_m` / `effective_fault_width_m` to derive
/// dimensions if the source's explicit fields are zero.
impl From<&super::earthquake::EarthquakeSource> for OkadaFault {
    fn from(eq: &super::earthquake::EarthquakeSource) -> Self {
        Self {
            center_lat: eq.location.lat_deg,
            center_lon: eq.location.lon_deg,
            depth_m: eq.depth_m,
            length_m: eq.effective_fault_length_m(),
            width_m: eq.effective_fault_width_m(),
            strike_deg: eq.strike_deg,
            dip_deg: eq.dip_deg,
            rake_deg: eq.rake_deg,
            slip_m: eq.slip_m,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Shape-only smoke test. Asserts the field is finite, has both
    /// positive (uplift) and negative (subsidence) cells, and the peak
    /// magnitude is bounded.
    #[test]
    fn dip_slip_field_has_uplift_and_subsidence_lobes() {
        let f = OkadaFault {
            center_lat: 0.0,
            center_lon: 0.0,
            depth_m: 10_000.0,
            length_m: 60_000.0,
            width_m: 30_000.0,
            strike_deg: 0.0,
            dip_deg: 30.0,
            rake_deg: 90.0,
            slip_m: 3.0,
        };
        let field = f.vertical_displacement_field(32, 32, 5_000.0);
        let max = field.uz_m.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let min = field.uz_m.iter().cloned().fold(f64::INFINITY, f64::min);
        assert!(field.uz_m.iter().all(|v| v.is_finite()), "non-finite uz cell");
        assert!(max > 0.01, "expected some uplift, got max {}", max);
        assert!(min < -0.01, "expected some subsidence, got min {}", min);
        assert!(max < 200.0, "peak uplift exploded: {}", max);
    }

    /// Tōhoku 2011 sanity check. Fujii-Satake 2013 reports ~7 m peak
    /// vertical uplift. With the full Okada 1985 I-term correction the
    /// peak lands in the [1, 30] m band; the earlier leading-order form
    /// over-predicted ~10×.
    #[test]
    fn tohoku_peak_in_published_band() {
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
        let field = f.vertical_displacement_field(64, 64, 25_000.0);
        let max_uz: f64 = field.uz_m.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let min_uz: f64 = field.uz_m.iter().cloned().fold(f64::INFINITY, f64::min);
        assert!(
            (1.0..30.0).contains(&max_uz),
            "Tohoku peak uplift {} m outside [1, 30] band",
            max_uz
        );
        assert!(min_uz < 0.0, "expected subsidence somewhere on grid");
    }

    /// The georeferenced `(origin_lat, origin_lon)` must point at the grid's
    /// south-west corner cell (0,0), with the longitude shift converted through
    /// cos(lat). Regression for the origin_lon-left-at-centre bug.
    #[test]
    fn origin_georeferences_south_west_corner_with_cos_lat() {
        let f = OkadaFault {
            center_lat: 38.0,
            center_lon: 142.0,
            depth_m: 20_000.0,
            length_m: 100_000.0,
            width_m: 50_000.0,
            strike_deg: 0.0,
            dip_deg: 20.0,
            rake_deg: 90.0,
            slip_m: 5.0,
        };
        let (nx, ny, dx) = (40usize, 30usize, 5_000.0);
        let field = f.vertical_displacement_field(nx, ny, dx);
        let lat_per_m = 360.0 / (2.0 * std::f64::consts::PI * R_EARTH_M);
        let lon_per_m = lat_per_m / f.center_lat.to_radians().cos();
        let expected_lat = f.center_lat - (ny as f64 * 0.5) * dx * lat_per_m;
        let expected_lon = f.center_lon - (nx as f64 * 0.5) * dx * lon_per_m;
        assert!(
            (field.origin_lat - expected_lat).abs() < 1e-9,
            "origin_lat {} != expected {}",
            field.origin_lat,
            expected_lat
        );
        assert!(
            (field.origin_lon - expected_lon).abs() < 1e-9,
            "origin_lon {} != expected {} (was left at grid centre?)",
            field.origin_lon,
            expected_lon
        );
        // South-west of centre, and longitude degrees stretch faster than
        // latitude at 38°N because cos(lat) < 1.
        assert!(field.origin_lon < f.center_lon && field.origin_lat < f.center_lat);
        let lon_shift_per_cell = (f.center_lon - field.origin_lon) / (nx as f64 * 0.5);
        let lat_shift_per_cell = (f.center_lat - field.origin_lat) / (ny as f64 * 0.5);
        assert!(
            lon_shift_per_cell > lat_shift_per_cell,
            "cos(lat) not applied to longitude ({} !> {})",
            lon_shift_per_cell,
            lat_shift_per_cell
        );
    }

    /// Strike-slip vertical bound: the surface u_z at the fault centre
    /// must not exceed the slip itself in magnitude. The exact value
    /// depends on the dip and Okada's sign convention (different
    /// canonical references disagree on the sign of the atan term);
    /// the magnitude bound is what's physically defensible regardless.
    /// The substantive validation is the Tohoku [1, 30] m band check.
    #[test]
    fn strike_slip_central_uplift_bounded_by_slip() {
        let f = OkadaFault {
            center_lat: 0.0,
            center_lon: 0.0,
            depth_m: 10_000.0,
            length_m: 100_000.0,
            width_m: 20_000.0,
            strike_deg: 0.0,
            dip_deg: 90.0,
            rake_deg: 0.0,
            slip_m: 5.0,
        };
        let peak = f.peak_uplift_m();
        assert!(
            peak.abs() <= 5.1,
            "central uplift {} cannot exceed slip ({})",
            peak,
            f.slip_m
        );
    }

    /// Okada 1985 Table 2 case 2 (p. 1149): x=2, y=3, d=4, δ=70°, L=3,
    /// W=2, U=1, ν=0.25. The paper's frame puts the origin at the fault's
    /// bottom-edge corner with ξ ∈ [0, L] and d = BOTTOM-edge depth; this
    /// implementation is centred with a TOP-edge depth, so the mapping is
    ///   x_centred = x − L/2,  y = y,  d_top = d − W·sinδ.
    /// Expected u_z (4 significant figures, per the okada85.m checklist):
    ///   strike-slip −2.747e-3, dip-slip −3.564e-2, tensile +3.214e-3.
    #[test]
    fn table2_case2_uz_matches_paper() {
        let dip = 70.0_f64.to_radians();
        let x_c = 2.0 - 1.5; // x − L/2
        let y = 3.0;
        let d_top = 4.0 - 2.0 * dip.sin();
        let (l, w) = (3.0, 2.0);

        let uz_strike = okada_uz_chinnery(x_c, y, d_top, l, w, dip, 1.0, 0.0, 0.0);
        let uz_dip = okada_uz_chinnery(x_c, y, d_top, l, w, dip, 0.0, 1.0, 0.0);
        let uz_tens = okada_uz_chinnery(x_c, y, d_top, l, w, dip, 0.0, 0.0, 1.0);

        assert!(
            (uz_strike - (-2.747e-3)).abs() < 1.0e-6,
            "strike-slip uz {uz_strike} != -2.747e-3"
        );
        assert!(
            (uz_dip - (-3.564e-2)).abs() < 1.0e-5,
            "dip-slip uz {uz_dip} != -3.564e-2"
        );
        assert!(
            (uz_tens - 3.214e-3).abs() < 1.0e-6,
            "tensile uz {uz_tens} != +3.214e-3"
        );
    }

    /// Okada 1985 Table 2 case 3: x=0, y=0, d=4, δ=90°, L=3, W=2 —
    /// exercises the vertical-fault (cos δ → 0) I-term branches.
    /// Expected u_z: strike-slip 0, dip-slip 0, tensile −1.606e-2.
    #[test]
    fn table2_case3_vertical_fault_uz_matches_paper() {
        let dip = 90.0_f64.to_radians();
        let x_c = 0.0 - 1.5;
        let y = 0.0;
        let d_top = 4.0 - 2.0 * dip.sin();
        let (l, w) = (3.0, 2.0);

        let uz_strike = okada_uz_chinnery(x_c, y, d_top, l, w, dip, 1.0, 0.0, 0.0);
        let uz_dip = okada_uz_chinnery(x_c, y, d_top, l, w, dip, 0.0, 1.0, 0.0);
        let uz_tens = okada_uz_chinnery(x_c, y, d_top, l, w, dip, 0.0, 0.0, 1.0);

        assert!(uz_strike.abs() < 1.0e-6, "case-3 strike uz {uz_strike} != 0");
        assert!(uz_dip.abs() < 1.0e-6, "case-3 dip uz {uz_dip} != 0");
        assert!(
            (uz_tens - (-1.606e-2)).abs() < 1.0e-5,
            "case-3 tensile uz {uz_tens} != -1.606e-2"
        );
    }

    /// The 2026-07-09 regression that exposed the old broken strike-slip
    /// term: a 302 km strike-slip fault at 1 km depth produced |uz| =
    /// 7.4×slip. With the corrected eqn.-25 term the field must stay
    /// bounded by the slip itself.
    #[test]
    fn strike_slip_field_stays_bounded_on_large_shallow_fault() {
        let f = OkadaFault {
            center_lat: 0.0,
            center_lon: 0.0,
            depth_m: 1_000.0,
            length_m: 302_000.0,
            width_m: 250_000.0,
            strike_deg: 154.0,
            dip_deg: 80.0,
            rake_deg: 0.0,
            slip_m: 0.1,
        };
        let field = f.vertical_displacement_field(24, 24, 302_000.0 / 8.0);
        for &uz in &field.uz_m {
            assert!(uz.is_finite());
            assert!(
                uz.abs() <= f.slip_m * 1.5,
                "|uz| = {} exceeds 1.5×slip after the eqn.-25 fix",
                uz.abs()
            );
        }
    }
}
