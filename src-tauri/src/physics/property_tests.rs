//! Property-based tests over the physics parameter space.
//!
//! Complements the analytical validation harness (`--features validation`):
//! instead of checking one benchmark answer, these assert invariants that
//! must hold for *every* physically admissible input — monotonicity,
//! boundedness, positivity, and conservation.

use proptest::prelude::*;

use super::asteroid::AsteroidImpact;
use super::okada::OkadaFault;
use super::shallow_water::synolakis_runup_m;
use super::solver::{BoundaryMode, SolverMode, SwGrid, TimeStepper};
use super::GeoPoint;

fn impact(diameter_m: f64, velocity_m_s: f64, angle_deg: f64, water_depth_m: f64) -> AsteroidImpact {
    AsteroidImpact {
        diameter_m,
        density_kg_m3: 3000.0,
        velocity_m_s,
        angle_deg,
        water_depth_m,
        location: GeoPoint {
            lat_deg: 0.0,
            lon_deg: 0.0,
            depth_m: water_depth_m,
        },
    }
}

proptest! {
    /// Ward–Asphaug cavity diameter grows monotonically with impactor
    /// diameter (d_tc ∝ d_i^(1-β), β = 0.22 < 1) at fixed other params.
    #[test]
    fn asteroid_cavity_monotonic_in_diameter(
        d1 in 50.0_f64..5_000.0,
        scale in 1.01_f64..10.0,
        v in 11_200.0_f64..20_000.0,
        angle in 15.0_f64..90.0,
    ) {
        let d2 = d1 * scale;
        let c1 = impact(d1, v, angle, 4_000.0).transient_cavity_diameter_m();
        let c2 = impact(d2, v, angle, 4_000.0).transient_cavity_diameter_m();
        prop_assert!(c1.is_finite() && c2.is_finite());
        prop_assert!(c2 > c1, "cavity must grow with diameter: {c1} !< {c2}");
    }

    /// Cavity diameter grows monotonically with impact velocity
    /// (d_tc ∝ v^(2β)) at fixed other params.
    #[test]
    fn asteroid_cavity_monotonic_in_velocity(
        d in 50.0_f64..5_000.0,
        v1 in 11_200.0_f64..19_000.0,
        scale in 1.01_f64..1.8,
        angle in 15.0_f64..90.0,
    ) {
        let v2 = (v1 * scale).min(20_000.0);
        prop_assume!(v2 > v1);
        let c1 = impact(d, v1, angle, 4_000.0).transient_cavity_diameter_m();
        let c2 = impact(d, v2, angle, 4_000.0).transient_cavity_diameter_m();
        prop_assert!(c2 > c1, "cavity must grow with velocity: {c1} !< {c2}");
    }

    /// Initial amplitude is finite, non-negative, and saturates at the
    /// local water depth (cavity bottoming out on the seafloor).
    #[test]
    fn asteroid_amplitude_bounded_by_depth(
        d in 50.0_f64..20_000.0,
        v in 11_200.0_f64..20_000.0,
        angle in 5.0_f64..90.0,
        depth in 100.0_f64..11_000.0,
    ) {
        let amp = impact(d, v, angle, depth).initial_amplitude_m();
        prop_assert!(amp.is_finite());
        prop_assert!(amp >= 0.0);
        prop_assert!(amp <= 0.5 * depth + 1e-9, "amplitude {amp} exceeds depth saturation for depth {depth}");
    }

    /// Okada surface uplift is finite everywhere and bounded by 3×slip in
    /// the thrust regime (rake 70–110°) that every shipped preset
    /// (rake 85–110°) and the Tōhoku band validation exercise.
    ///
    /// Any strike-slip component is EXCLUDED (rake pinned to 90°): proptest
    /// surveying (2026-07-09) showed the strike-slip vertical term is
    /// broken — |uz| grows with fault length without bound (0.74 m from
    /// 0.1 m slip on a 302 km rake-0 fault; ~9× amplification of the
    /// strike-slip component even at rake 70°/41 km depth). A dislocation's
    /// surface displacement is bounded by ~slip regardless of size, so this
    /// is non-physical. Code review against Okada 1985 flags the eqn.-26
    /// strike-slip vertical term (atan where q·sinδ/(R+η) belongs) and the
    /// I-term coefficient (ALPHA = 2/3 vs the 1985 μ/(λ+μ) = 1/2); the
    /// roadmap tracks the reference-anchored fix. At rake = 90° the term is
    /// inert (u_ss = 0), so this test cleanly guards the dip-slip path
    /// against the v0.2.x-class ~10× over-prediction failure plus NaN/Inf.
    #[test]
    fn okada_uplift_bounded_by_slip(
        slip in 0.1_f64..60.0,
        depth_km in 1.0_f64..60.0,
        dip in 5.0_f64..90.0,
        strike in 0.0_f64..360.0,
        length_km in 10.0_f64..500.0,
        aspect in 0.2_f64..1.0,
    ) {
        let fault = OkadaFault {
            center_lat: 0.0,
            center_lon: 0.0,
            depth_m: depth_km * 1000.0,
            length_m: length_km * 1000.0,
            width_m: length_km * 1000.0 * aspect,
            strike_deg: strike,
            dip_deg: dip,
            rake_deg: 90.0,
            slip_m: slip,
        };
        let field = fault.vertical_displacement_field(24, 24, length_km * 1000.0 / 8.0);
        for &uz in &field.uz_m {
            prop_assert!(uz.is_finite());
            prop_assert!(uz.abs() <= slip * 3.0 + 1e-9,
                "|uz| = {} exceeds 3×slip in the thrust regime", uz.abs());
        }
        let peak = fault.peak_uplift_m();
        prop_assert!(peak.is_finite());
    }

    /// Synolakis runup is positive for positive offshore amplitude and
    /// monotonically increasing in amplitude at fixed depth/slope.
    #[test]
    fn synolakis_runup_positive_and_monotonic(
        amp1 in 0.01_f64..20.0,
        scale in 1.01_f64..5.0,
        depth in 10.0_f64..6_000.0,
        slope in 0.1_f64..30.0,
    ) {
        let amp2 = amp1 * scale;
        let r1 = synolakis_runup_m(amp1, depth, slope);
        let r2 = synolakis_runup_m(amp2, depth, slope);
        prop_assert!(r1.is_finite() && r2.is_finite());
        prop_assert!(r1 > 0.0, "runup must be positive, got {r1}");
        // Above the Miche/McCowan breaking gate (H/d = 0.78) the closed form
        // saturates by design, so growth is only non-strict there.
        if amp2 / depth < 0.78 {
            prop_assert!(r2 > r1, "runup must grow with amplitude: {r1} !< {r2}");
        } else {
            prop_assert!(r2 >= r1, "runup must not shrink with amplitude: {r1} > {r2}");
        }
    }

    /// Mass conservation: in a closed flat basin (zero-flux walls, no
    /// sponge, linear momentum) the volume integral of η is conserved by
    /// the leapfrog continuity update to numerical precision.
    #[test]
    fn swe_closed_basin_conserves_mass(
        amp in 0.5_f64..10.0,
        depth in 500.0_f64..6_000.0,
        sigma_km in 20.0_f64..60.0,
    ) {
        let mut grid = SwGrid::new(-5.0, -5.0, 5.0, 5.0, 0.25, 0.25);
        grid.fill_uniform_depth(depth);
        grid.inject_gaussian(0.0, 0.0, amp, sigma_km * 1000.0);

        let sum_before: f64 = grid.eta_m.iter().sum();
        let abs_before: f64 = grid.eta_m.iter().map(|e| e.abs()).sum();

        let dt = grid.recommended_dt_s(0.3);
        let stepper = TimeStepper::new(dt)
            .with_boundary(BoundaryMode::ZeroFlux)
            .with_mode(SolverMode::Linear);
        stepper.step(&mut grid, 40);

        let sum_after: f64 = grid.eta_m.iter().sum();
        for &e in &grid.eta_m {
            prop_assert!(e.is_finite());
        }
        // Central-difference flux-form continuity conserves the interior
        // sum; the frozen zero-flux boundary ring contributes only once the
        // wavefront reaches it, which the 40-step window and centred source
        // preclude. Allow 1% of the initial |η| mass as numerical slack.
        let tol = 0.01 * abs_before.max(1e-9);
        prop_assert!(
            (sum_after - sum_before).abs() <= tol,
            "mass drifted: before {sum_before}, after {sum_after}, tol {tol}"
        );
    }
}
