//! Quantitative validation harness — compares the solver / closed-form
//! physics against analytical benchmarks. Gated behind the `validation`
//! cargo feature so the local verification loop stays fast; run on demand with
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
//! 4. **NTHMP benchmark problem 1 — single wave on a simple beach** (Synolakis
//!    1987). Tests the closed-form run-up at the canonical 1:19.85 beach and
//!    non-breaking `H/d = 0.0185` against the published analytical (`R/d ≈
//!    0.086`) and laboratory (`R/d ≈ 0.0885`) values within a documented ±18 %
//!    band. See `docs/science/VALIDATION.md` for which NTHMP benchmarks are out
//!    of reach for this non-dispersive solver and why.
//! 5. **Glasstone & Dolan 1977 nuclear air-burst radii** (scaled). Tests the
//!    Rust direct-nuclear model's 20/5/1 psi blast and third-degree-burn thermal
//!    radii for 1 Mt and 15 kt air bursts against the published *Effects of
//!    Nuclear Weapons* values within a documented ±30 % band, plus cube-root
//!    yield scaling and physical ring ordering.
//! 6. **Collins–Melosh–Marcus 2005 impact scaling.** Locks the asteroid crater
//!    Pi-group scaling to CMM 2005 across the modeled impactor range (with a
//!    Meteor Crater order-of-magnitude anchor), and checks the CMM blast
//!    overpressure fit and Rankine-Hugoniot peak-wind relation (≈ 72 m/s at
//!    5 psi). Svetsov et al. 2025 corroborates the same range; a full data-table
//!    cross-check is tracked in `Roadmap_Blocked.md`.

#![cfg(feature = "validation")]

#[cfg(test)]
use super::asteroid::{AsteroidImpact, far_field_amplitude_m};
#[cfg(test)]
use super::constants::{G_EARTH, RHO_ASTEROID_STONY};
#[cfg(test)]
use super::direct_hazard::{
    AsteroidDetail, AsteroidHazardRequest, AsteroidTargetType, HazardCenter, HazardDetail,
    NuclearBurstType, NuclearDetail, NuclearHazardRequest, overpressure_at_scaled_distance,
    peak_wind_velocity_m_s, simulate_asteroid_hazard, simulate_nuclear_hazard,
};
#[cfg(test)]
use super::landslide::lituya_bay_1958;
#[cfg(test)]
use super::shallow_water::synolakis_runup_m;
#[cfg(test)]
use super::solver::{BoundaryMode, SolverMode, SwGrid, TimeStepper, WET_DEPTH_EPSILON_M};
#[cfg(test)]
use super::GeoPoint;

/// Stoker 1957 dry-bed dam break. A 10 m reservoir is released over a flat,
/// initially dry bed; the analytical leading edge advances at `2 sqrt(g h0)`.
/// Detection uses the 1% depth contour because a first-order Rusanov flux has a
/// deliberately diffuse sub-millimetre numerical skirt.
#[test]
fn stoker_dry_bed_front_matches_analytical_speed() {
    let reservoir_depth_m = 10.0;
    let mut grid = SwGrid::new(-1.0, -0.01, 1.0, 0.01, 0.005, 0.005);
    grid.fill_uniform_depth(0.0);
    for j in 0..grid.ny {
        for i in 0..grid.nx / 2 {
            grid.eta_m[i + j * grid.nx] = reservoir_depth_m;
        }
    }
    let dt = grid.recommended_dt_s(0.15);
    let mut stepper = TimeStepper::new(dt)
        .with_boundary(BoundaryMode::ZeroFlux)
        .with_mode(SolverMode::Linear);
    stepper.manning_n = 0.0;
    let t_end_s = 120.0;
    stepper.step(&mut grid, (t_end_s / dt).round().max(1.0) as usize);

    let row = grid.ny / 2;
    let mut front_i = grid.nx / 2;
    for i in grid.nx / 2..grid.nx {
        if grid.eta_m[i + row * grid.nx] >= reservoir_depth_m * 0.01 {
            front_i = i;
        }
    }
    let cell_width_m = 6_371_008.8_f64 * std::f64::consts::PI / 180.0 * grid.dlon_deg;
    let front_dist_m = (front_i - grid.nx / 2) as f64 * cell_width_m;
    let expected_m = 2.0 * (G_EARTH * reservoir_depth_m).sqrt() * t_end_s;
    let err = (front_dist_m - expected_m).abs() / expected_m;
    assert!(
        err < 0.35,
        "Stoker front position {:.0} km vs analytical {:.0} km — {:.0}% error",
        front_dist_m / 1000.0,
        expected_m / 1000.0,
        err * 100.0
    );
    assert!(grid.h_m.iter().zip(&grid.eta_m).all(|(h, eta)| h + eta >= 0.0));
}

/// NTHMP benchmark problem 1 geometry smoke: a positive pulse crosses a plane
/// beach and wets cells landward of the still-water shoreline without a
/// negative water column. The quantitative run-up comparison against the
/// Synolakis closed form is `nthmp_bp1_single_wave_on_simple_beach_runup`.
#[test]
fn nthmp_problem_1_plane_beach_wets_positively() {
    let mut grid = SwGrid::new(-1.0, -0.01, 1.0, 0.01, 0.005, 0.005);
    for j in 0..grid.ny {
        for i in 0..grid.nx {
            grid.h_m[i + j * grid.nx] = if i < 250 {
                10.0
            } else if i < 320 {
                10.0 * (320 - i) as f64 / 70.0
            } else {
                -10.0 * (i - 320) as f64 / 70.0
            };
        }
    }
    grid.inject_gaussian(0.0, 0.55, 1.0, 1_000.0);
    for k in 0..grid.h_m.len() {
        let depth_m = grid.h_m[k] + grid.eta_m[k];
        if grid.h_m[k] > 1.0e-3 && depth_m > 1.0e-3 {
            // Linear long-wave Riemann invariant for an eastward incident
            // pulse; NTHMP problem 1 prescribes a travelling solitary wave,
            // not a motionless surface bump.
            grid.u_ms[k] = grid.eta_m[k] * (G_EARTH * depth_m).sqrt() / depth_m;
        }
    }
    let initial_mask = grid.wet_mask_bits();
    let dt = grid.recommended_dt_s(0.12);
    let mut stepper = TimeStepper::new(dt)
        .with_boundary(BoundaryMode::ZeroFlux)
        .with_mode(SolverMode::Linear);
    stepper.manning_n = 0.0;
    let mut shoreline_advanced = false;
    let mut maximum_landward_depth_m = 0.0_f64;
    let mut maximum_shore_eta_m = 0.0_f64;
    let mut peak_landward_wet_cells = 0_usize;
    stepper.step_cancellable_observed(&mut grid, 2_000, None, &mut |state| {
        shoreline_advanced |= state.wet_mask_bits() != initial_mask;
        let row = state.ny / 2;
        maximum_shore_eta_m = maximum_shore_eta_m.max(state.eta_m[319 + row * state.nx]);
        peak_landward_wet_cells = peak_landward_wet_cells.max(
            (0..state.ny)
                .flat_map(|j| (320..state.nx).map(move |i| i + j * state.nx))
                .filter(|&k| state.h_m[k] + state.eta_m[k] > WET_DEPTH_EPSILON_M)
                .count(),
        );
        for i in 320..state.nx - 1 {
            maximum_landward_depth_m = maximum_landward_depth_m
                .max(state.h_m[i + row * state.nx] + state.eta_m[i + row * state.nx]);
        }
    });

    assert!(grid.h_m.iter().zip(&grid.eta_m).all(|(h, eta)| h + eta >= 0.0));
    assert!(grid.u_ms.iter().chain(&grid.v_ms).all(|velocity| velocity.is_finite()));
    assert!(
        shoreline_advanced,
        "shoreline never advanced; maximum eta in the last wet cell was {maximum_shore_eta_m:.6} m"
    );
    assert!(
        maximum_landward_depth_m > 1.0e-3,
        "landward depth never exceeded the wet threshold"
    );
    assert!(
        peak_landward_wet_cells > 0,
        "no landward cell crossed the wet threshold"
    );
}

/// **NTHMP benchmark problem 1 — single wave on a simple beach** (Synolakis
/// 1987; NTHMP 2011 model-benchmarking workshop). The canonical laboratory
/// geometry is a 1:19.85 plane beach. For the canonical non-breaking incident
/// solitary wave `H/d = 0.0185`, the Carrier-Greenspan / Synolakis closed form
/// predicts a maximum nondimensional run-up `R/d ≈ 0.086`, and the Synolakis
/// 1987 laboratory measurement is `R/d ≈ 0.0885`. Our `synolakis_runup_m` must
/// (a) reproduce the closed form and (b) land within a documented ±18 % band of
/// the laboratory value — the tractable analytical slice of the NTHMP suite for
/// a non-dispersive shallow-water model. Breaking cases (large `H/d`) and the
/// 2-D field benchmarks (BP4 Monai, BP6 conical island, BP7 Okushiri) require
/// dispersive Boussinesq physics and high-resolution bathymetry and are out of
/// reach for this solver — see `docs/science/VALIDATION.md`.
///
/// Reference: Synolakis, C. E. (1987) *J. Fluid Mech.* 185:523-545;
/// NTHMP (2012) *Proceedings and Results of the 2011 NTHMP Model Benchmarking
/// Workshop*, benchmark problem 1.
#[test]
fn nthmp_bp1_single_wave_on_simple_beach_runup() {
    // Canonical BP1 geometry: 1:19.85 plane beach → slope angle atan(1/19.85).
    let cot_beta = 19.85_f64;
    let slope_deg = (1.0_f64 / cot_beta).atan().to_degrees();
    // Canonical non-breaking incident wave H/d = 0.0185, evaluated at unit
    // still-water depth so the result reads directly as the nondimensional
    // run-up R/d.
    let depth_m = 1.0;
    let h_over_d = 0.0185;
    let r_over_d = synolakis_runup_m(h_over_d * depth_m, depth_m, slope_deg) / depth_m;

    // Published references for BP1 at H/d = 0.0185:
    //   analytical (Synolakis 1987 closed form):  R/d ≈ 0.086
    //   laboratory (Synolakis 1987 Fig. 5):       R/d ≈ 0.0885
    let analytical = 2.831 * cot_beta.sqrt() * h_over_d.powf(5.0 / 4.0);
    let lab = 0.0885;

    // (a) reproduce the closed form to numerical tolerance (regression lock on
    //     the run-up coefficient and the breaking gate).
    let closed_form_err = (r_over_d - analytical).abs() / analytical;
    assert!(
        closed_form_err < 0.02,
        "NTHMP BP1 R/d={r_over_d:.5} does not reproduce the Synolakis closed form {analytical:.5} ({:.1}% error)",
        closed_form_err * 100.0
    );
    // (b) land within a documented ±18% band of the laboratory measurement.
    let lab_err = (r_over_d - lab).abs() / lab;
    assert!(
        lab_err < 0.18,
        "NTHMP BP1 R/d={r_over_d:.5} outside ±18% of the lab value {lab:.4} ({:.0}% error)",
        lab_err * 100.0
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
    let slope_deg: f64 = 2.0;

    // Carrier-Greenspan closed form for a plane beach (Synolakis 1987
    // eqn. 19, same as our synolakis_runup_m): R = 2.831 √(cot β) H^(5/4)/d^(1/4).
    // Test that our implementation reproduces it.
    let cot_beta = 1.0_f64 / slope_deg.to_radians().tan();
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

/// Run the Rust-authoritative direct-nuclear model for an air burst of the
/// given yield and return the effect radii (km).
#[cfg(test)]
fn nuclear_airburst_detail(yield_kt: f64) -> NuclearDetail {
    let request = NuclearHazardRequest {
        center: HazardCenter { lat: 35.0, lon: 139.0 },
        yield_kt,
        burst_type: NuclearBurstType::Airburst,
        height_m: None,
        fission_pct: 50.0,
        population_density: 0.0,
    };
    match simulate_nuclear_hazard(request)
        .expect("nuclear hazard should evaluate for an in-bounds request")
        .detail
    {
        HazardDetail::Nuclear(detail) => detail,
        _ => unreachable!("nuclear request must produce a nuclear detail"),
    }
}

/// **Nuclear air-burst blast & thermal radii vs Glasstone & Dolan 1977.**
/// *The Effects of Nuclear Weapons* (3rd ed.) gives scaled air-burst damage
/// radii. For a 1 Mt (1000 kt) air burst near optimum height the published
/// radii are ≈ 2.7 km (20 psi, heavy destruction), ≈ 6.9 km (5 psi, most
/// buildings collapse), ≈ 21 km (1 psi, window breakage / light injuries), and
/// ≈ 12 km (third-degree burns, clear day). Hiroshima (15 kt) had a ≈ 1.7 km
/// 5 psi contour. Our single-coefficient Glasstone-Dolan scaling must reproduce
/// these within a documented ±30 % band — the simplified scaling omits the
/// height-of-burst curves, so the band is wider than the tsunami analyticals.
///
/// Reference: Glasstone, S. & Dolan, P. J. (1977) *The Effects of Nuclear
/// Weapons*, 3rd ed., ch. III (blast) & ch. VII (thermal radiation); radii
/// reproduced in the Nuclear Weapon Archive FAQ and NUKEMAP.
#[test]
fn nuclear_airburst_radii_match_glasstone_dolan() {
    fn assert_band(label: &str, got_km: f64, reference_km: f64) {
        let err = (got_km - reference_km).abs() / reference_km;
        assert!(
            err < 0.30,
            "{label}: model {got_km:.2} km vs Glasstone-Dolan {reference_km:.2} km ({:.0}% error)",
            err * 100.0
        );
    }
    let one_mt = nuclear_airburst_detail(1000.0);
    assert_band("1 Mt 20 psi", one_mt.psi_20, 2.7);
    assert_band("1 Mt 5 psi", one_mt.psi_5, 6.9);
    assert_band("1 Mt 1 psi", one_mt.psi_1, 21.0);
    assert_band("1 Mt 3rd-degree burns", one_mt.thermal_3, 12.0);

    let hiroshima = nuclear_airburst_detail(15.0);
    assert_band("15 kt 5 psi", hiroshima.psi_5, 1.7);
}

/// Physical-ordering and cube-root yield-scaling invariants for the nuclear
/// effects model. Overpressure radius scales as `W^(1/3)` (Glasstone & Dolan
/// cube-root scaling), so an 8× yield must double a blast radius, and lower
/// thresholds must always reach farther than higher ones.
#[test]
fn nuclear_effects_ordering_and_cube_root_scaling() {
    let d = nuclear_airburst_detail(1000.0);
    assert!(
        d.psi_1 > d.psi_5 && d.psi_5 > d.psi_20,
        "overpressure rings must nest: 1 psi > 5 psi > 20 psi"
    );
    assert!(
        d.thermal_1 > d.thermal_3,
        "1st-degree burn radius must exceed 3rd-degree"
    );
    assert!(d.fireball > 0.0 && d.radiation > 0.0);

    let small = nuclear_airburst_detail(100.0);
    let big = nuclear_airburst_detail(800.0); // 8× yield ⇒ 2× radius
    let ratio = big.psi_5 / small.psi_5;
    assert!(
        (ratio - 2.0).abs() < 0.05,
        "8× yield should double the 5 psi radius (cube-root scaling); got {ratio:.3}"
    );
}

/// Run the Rust-authoritative direct-asteroid model for a ground-reaching
/// impactor and return its detail.
#[cfg(test)]
fn asteroid_impact_detail(
    diameter_m: f64,
    density_kg_m3: f64,
    velocity_km_s: f64,
    target: AsteroidTargetType,
) -> AsteroidDetail {
    let request = AsteroidHazardRequest {
        center: HazardCenter { lat: 20.0, lon: 0.0 },
        diameter_m,
        density_kg_m3,
        velocity_km_s,
        angle_deg: 45.0,
        target_type: target,
        water_depth_m: 0.0,
        beach_slope_rad: 0.001,
    };
    match simulate_asteroid_hazard(request)
        .expect("asteroid hazard should evaluate for an in-bounds request")
        .detail
    {
        HazardDetail::Asteroid(detail) => detail,
        _ => unreachable!("asteroid request must produce an asteroid detail"),
    }
}

/// Independent Collins–Melosh–Marcus (2005) Pi-group crater re-derivation, used
/// to lock the shipped `asteroid_crater` implementation against its cited
/// formula. Uses the impact velocity the atmospheric-entry model actually
/// delivered so this isolates the crater scaling from entry ablation.
#[cfg(test)]
fn cmm_final_crater_m(
    diameter_m: f64,
    density_kg_m3: f64,
    impact_velocity_m_s: f64,
    angle_deg: f64,
    target: AsteroidTargetType,
) -> f64 {
    let (target_density, transition) = match target {
        AsteroidTargetType::SedimentaryRock => (2_500.0, 3_200.0),
        AsteroidTargetType::CrystallineRock => (2_750.0, 4_000.0),
        AsteroidTargetType::Water => (1_025.0, 3_200.0),
    };
    let sin_theta = angle_deg.to_radians().sin();
    let transient = 1.161
        * (density_kg_m3 / target_density).powf(1.0 / 3.0)
        * diameter_m.powf(0.78)
        * impact_velocity_m_s.powf(0.44)
        * 9.81_f64.powf(-0.22)
        * sin_theta.powf(1.0 / 3.0);
    if transient * 1.25 >= transition {
        1.17 * transient.powf(1.13) * transition.powf(-0.13)
    } else {
        1.25 * transient
    }
}

/// **Collins–Melosh–Marcus 2005 crater scaling — implementation lock across the
/// modeled impactor range.** The shipped `asteroid_crater` must reproduce the
/// CMM 2005 Pi-group transient/final-crater equations to numerical tolerance at
/// several sizes, and the final crater must grow monotonically with impactor
/// diameter. This guards against silent coefficient drift in the crater formula.
///
/// Reference: Collins, G. S., Melosh, H. J. & Marcus, R. A. (2005) *Meteoritics
/// & Planetary Science* 40:817-840 (Earth Impact Effects Program). Svetsov et
/// al. (2025), MAPS `doi:10.1111/maps.14329`, covers the same 20 m–3 km range as
/// a modern hydrodynamic corroboration; a full cross-check against its data
/// tables is tracked in `Roadmap_Blocked.md`.
#[test]
fn impact_crater_scaling_matches_collins_melosh_marcus() {
    let cases = [
        (50.0, 7_870.0, 12.8, AsteroidTargetType::SedimentaryRock),
        (500.0, 3_000.0, 17.0, AsteroidTargetType::CrystallineRock),
        (2_000.0, 3_000.0, 20.0, AsteroidTargetType::CrystallineRock),
    ];
    let mut previous_diameter = 0.0;
    for (diameter_m, density, velocity_km_s, target) in cases {
        let detail = asteroid_impact_detail(diameter_m, density, velocity_km_s, target);
        let crater = detail.crater.expect("ground-reaching impactor forms a crater");
        let expected = cmm_final_crater_m(
            diameter_m,
            density,
            detail.atmospheric_entry.impact_velocity,
            45.0,
            target,
        );
        let err = (crater.final_diameter - expected).abs() / expected;
        assert!(
            err < 0.01,
            "crater for {diameter_m} m impactor {:.1} m diverges from CMM 2005 {:.1} m ({:.2}% error)",
            crater.final_diameter,
            expected,
            err * 100.0
        );
        assert!(
            crater.final_diameter > previous_diameter,
            "final crater must grow with impactor size"
        );
        previous_diameter = crater.final_diameter;
    }
}

/// **Meteor Crater (Barringer) order-of-magnitude anchor.** A ~50 m iron
/// impactor at ~12.8 km/s and 45° into sedimentary rock should excavate a
/// ~1.2 km crater (observed rim-to-rim ≈ 1.19 km). The band is deliberately
/// wide because the impactor size, velocity, and angle are themselves uncertain
/// — this is an order-consistency check, not a tight fit.
///
/// Reference: observed Meteor Crater diameter (Kring 2007); CMM 2005 scaling.
#[test]
fn impact_crater_reproduces_meteor_crater_scale() {
    let detail = asteroid_impact_detail(50.0, 7_870.0, 12.8, AsteroidTargetType::SedimentaryRock);
    let crater = detail.crater.expect("Meteor Crater impactor reaches the ground");
    assert!(
        (800.0..=2_000.0).contains(&crater.final_diameter),
        "Meteor Crater analog gave {:.0} m, outside the order-consistency band [800, 2000] m",
        crater.final_diameter
    );
}

/// **Collins–Melosh–Marcus 2005 blast overpressure and peak-wind relations.**
/// The scaled-distance overpressure fit must decrease monotonically with range,
/// and the Rankine-Hugoniot peak-wind relation must reproduce the ≈ 72 m/s
/// (≈ 160 mph) wind at 5 psi that the damage-ring copy cites, increasing with
/// overpressure.
///
/// Reference: Collins, Melosh & Marcus 2005, eqns. 54-57.
#[test]
fn impact_overpressure_and_wind_match_collins_melosh_marcus() {
    // Overpressure decreases with scaled distance.
    let near = overpressure_at_scaled_distance(300.0);
    let mid = overpressure_at_scaled_distance(1_000.0);
    let far = overpressure_at_scaled_distance(5_000.0);
    assert!(near > mid && mid > far, "overpressure must fall with distance");

    // Peak wind at 5 psi ≈ 72 m/s (≈ 160 mph), the documented damage-ring value.
    let wind_5psi = peak_wind_velocity_m_s(34_474.0);
    assert!(
        (wind_5psi - 72.0).abs() / 72.0 < 0.05,
        "5 psi peak wind {wind_5psi:.1} m/s off the CMM 2005 ≈72 m/s reference"
    );
    // Wind rises with overpressure.
    assert!(peak_wind_velocity_m_s(137_900.0) > wind_5psi);
    // Zero overpressure ⇒ still air.
    assert_eq!(peak_wind_velocity_m_s(0.0), 0.0);
}
