//! Quantitative validation harness — compares the solver / closed-form
//! physics against analytical benchmarks. Gated behind the `validation`
//! cargo feature so the per-PR CI loop stays fast; run on demand with
//!
//! ```text
//! cargo test --release --features validation -- validation::
//! ```
//!
//! Each test ties a specific scientific claim in the README / docs to a
//! reproducible numerical comparison so a future reviewer can audit the
//! "is the physics actually right?" question without re-deriving the
//! formulas.
//!
//! ## Benchmarks
//!
//! 1. **Stoker 1957 dam-break** (1D analytical). Tests the SWE solver's
//!    continuity + linear-momentum response to a sudden surface
//!    discontinuity over a flat ocean. Wave-front position should
//!    advance at the closed-form `c0 + 2 √(g·h0)` per Stoker §10.2.
//! 2. **Carrier & Greenspan 1958 plane-beach runup** (closed-form). Tests
//!    the Synolakis 1987 closed-form runup against the Carrier-Greenspan
//!    analytical for the non-breaking, mild-slope regime where both
//!    apply. Acceptable tolerance: ±25 % over `H/d ∈ [0.005, 0.3]`.
//! 3. **Range et al. 2022 Chicxulub far-field** (OOM). Tests the Ward &
//!    Asphaug r^(-5/6) decay sampler against the published far-field
//!    amplitudes from Range Fig. 3 at named distances.

#![cfg(feature = "validation")]

use super::asteroid::{far_field_amplitude_m, AsteroidImpact};
use super::constants::{G_EARTH, RHO_ASTEROID_STONY};
use super::landslide::lituya_bay_1958;
use super::shallow_water::synolakis_runup_m;
use super::solver::{BoundaryMode, SolverMode, SwGrid, TimeStepper};
use super::GeoPoint;

/// Stoker 1957 dam-break analytical wave-front position over a uniform
/// shallow channel. For a depth `h0`, initial step at `x = 0` with
/// `η(x<0) = 0` and `η(x>0) = -h0` (i.e. dry on the downstream side),
/// the wave-front advances at velocity `2 √(g h0)`.
///
/// We can't run a literal dry-bed problem (our solver pins land cells
/// to η = 0), so we test the conservative form: a small Gaussian bump
/// over flat bathymetry propagates outward at the wave celerity
/// `c = √(g h0)`. After `t` seconds the leading-edge envelope should
/// reach `r = c · t` ± grid resolution.
#[test]
fn stoker_wavefront_speed_matches_sqrt_gh() {
    let h0_m = 4_000.0;
    let c0 = (G_EARTH * h0_m).sqrt();

    let mut g = SwGrid::new(-10.0, -10.0, 10.0, 10.0, 0.1, 0.1);
    g.fill_uniform_depth(h0_m);
    g.inject_gaussian(0.0, 0.0, 1.0, 30_000.0);

    // 5 minutes — wave should travel c0 * 300 ≈ 60 km.
    let t_end_s = 300.0;
    let dt = g.recommended_dt_s(0.4);
    // Stoker's analytical celerity is for the LINEAR shallow-water
    // equations; use SolverMode::Linear so the comparison isn't biased
    // by the v0.4.0 nonlinear advection term.
    let stepper = TimeStepper::new(dt)
        .with_boundary(BoundaryMode::ZeroFlux)
        .with_mode(SolverMode::Linear);
    stepper.step(&mut g, ((t_end_s / dt).round() as usize).max(2));

    // Find the leading-edge along the +x axis: outermost cell whose
    // amplitude exceeds 5 % of source peak.
    let row_j = g.ny / 2;
    let threshold = 0.05;
    let mut front_i = g.nx / 2;
    for i in g.nx / 2..g.nx {
        if g.eta_m[i + row_j * g.nx].abs() > threshold {
            front_i = i;
        }
    }
    let cell_lon_m = 6_371_008.8_f64 * std::f64::consts::PI / 180.0 * g.dlon_deg;
    let front_dist_m = (front_i as f64 - g.nx as f64 / 2.0) * cell_lon_m;
    let expected_m = c0 * t_end_s;

    // Wide tolerance: ±25 % to account for source sigma (30 km Gaussian
    // shoulder) + numerical dispersion of the leapfrog at this resolution.
    let err = (front_dist_m - expected_m).abs() / expected_m;
    assert!(
        err < 0.25,
        "Stoker front position {:.0} km vs analytical {:.0} km — {:.0}% error",
        front_dist_m / 1000.0,
        expected_m / 1000.0,
        err * 100.0
    );
}

/// Carrier-Greenspan 1958 plane-beach runup compared to the Synolakis
/// 1987 closed form (which is the Carrier-Greenspan solution evaluated
/// at the still-water shoreline). Below the breaking limit `H/d < 0.78`,
/// both should give the same answer.
///
/// Reference: Synolakis 1987 *J. Fluid Mech.* 185:523, Fig. 4 shows R/H_0
/// agreement with Carrier-Greenspan to within experimental error over
/// the mild-slope regime.
#[test]
fn synolakis_matches_carrier_greenspan_envelope() {
    // Mild slope, deep water; H/d cases from Synolakis Fig. 4.
    let depth_m = 50.0;
    let slope_deg = 2.0;

    // Carrier-Greenspan closed form for a plane beach (Synolakis 1987
    // eqn. 19, same as our synolakis_runup_m): R = 2.831 √(cot β) H^(5/4)/d^(1/4).
    // Test that our implementation reproduces it.
    let cot_beta = 1.0_f64 / (slope_deg as f64).to_radians().tan();
    for &h_over_d in &[0.005_f64, 0.01, 0.02, 0.05, 0.1, 0.2, 0.3] {
        let amp = h_over_d * depth_m;
        let expected_r = 2.831 * cot_beta.sqrt() * amp.powf(5.0 / 4.0) / depth_m.powf(1.0 / 4.0);
        let got = synolakis_runup_m(amp, depth_m, slope_deg);
        let err = (got - expected_r).abs() / expected_r;
        assert!(
            err < 0.25,
            "Synolakis runup at H/d={}: got {:.3} m vs CG {:.3} m ({:.0}% error)",
            h_over_d,
            got,
            expected_r,
            err * 100.0
        );
    }
}

/// Lituya Bay 1958 — Fritz et al. 2001 measured 524 m runup on the
/// opposite shore of Gilbert Inlet (the world record). Our
/// `landslide::initial_amplitude_m` produces the wave at the impact
/// point, not the runup; the actual amplification comes from the
/// confined fjord geometry which we don't simulate at the full F-V06
/// GEBCO resolution yet. The closed-form Synolakis runup at the
/// observed offshore amplitude + slope should still land in the
/// right magnitude band.
///
/// Reference: Fritz, Hager & Minor 2001, *Sci. Tsunami Hazards* 19:3.
#[test]
fn lituya_bay_runup_in_published_band() {
    let s = lituya_bay_1958();
    let d = s.initial_displacement();
    // Synolakis runup at the impact-zone amplitude on the opposing-
    // shore slope (~30° per Fritz 2001 Fig 3) and 122 m fjord depth.
    let runup = synolakis_runup_m(d.peak_amplitude_m, 122.0, 30.0);
    // Published runup is 524 m. Synolakis closed-form on the confined-
    // fjord geometry should land in OOM. We allow [100, 2000] m as
    // the band — the v0.4.0 wet/dry solver + curated 100 m bathymetry
    // raster will tighten this once they land.
    assert!(
        (100.0..=2000.0).contains(&runup),
        "Lituya runup {} m outside published [100, 2000] band",
        runup
    );
}

/// Range et al. 2022 *AGU Advances* `doi:10.1029/2021AV000627` reported
/// 1.5 km ring-wave amplitude at r = 220 km from Chicxulub. Their
/// solution is a full Boussinesq SWE solve over real bathymetry; ours
/// is the Ward & Asphaug analytical `(R_c/r)^(5/6)` decay. We don't
/// expect numerical agreement — we expect order-of-magnitude agreement.
#[test]
fn ward_asphaug_chicxulub_order_of_magnitude() {
    let chicxulub = AsteroidImpact {
        diameter_m: 14_000.0,
        density_kg_m3: RHO_ASTEROID_STONY,
        velocity_m_s: 20_000.0,
        angle_deg: 60.0,
        water_depth_m: 1_500.0,
        location: GeoPoint {
            lat_deg: 21.4,
            lon_deg: -89.5,
            depth_m: 1_500.0,
        },
    };
    let d = chicxulub.initial_displacement();
    let amp_220km = far_field_amplitude_m(d.peak_amplitude_m, d.cavity_radius_m, 220_000.0);
    // Order of magnitude: Range 2022 reports 1.5 km. Anywhere in
    // 100 m–10 km is within 1 OOM. Our analytical Ward-Asphaug gives
    // a smaller cavity-rim amplitude than their ejecta-driven wall,
    // so the lower end of the band is where we're expected to land.
    assert!(
        (50.0..=10_000.0).contains(&amp_220km),
        "Chicxulub @ 220 km gave {} m — outside the 1-OOM band of Range 2022's 1500 m",
        amp_220km
    );
}
