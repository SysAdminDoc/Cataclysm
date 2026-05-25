//! Shallow-water wave propagation and coastal runup.
//!
//! References:
//! - Synolakis, C. E. (1987). The runup of solitary waves. *Journal of Fluid
//!   Mechanics*, 185, 523–545.
//! - Kowalik, Z., & Murty, T. S. (1993). *Numerical Modeling of Ocean
//!   Dynamics*. World Scientific.
//! - Berger, M. J., George, D. L., LeVeque, R. J., & Mandli, K. T. (2011).
//!   The GeoClaw software for depth-averaged flows. *AWR*, 34(9), 1195–1206.
//!
//! In water depths small compared to the tsunami wavelength (the canonical
//! "shallow water" or "long-wave" regime), the depth-averaged 2-D equations
//! govern propagation:
//!
//! ```text
//! ∂η/∂t + ∇·((h + η) u) = 0
//! ∂u/∂t + (u·∇)u + g∇η = − g n² |u| u / (h+η)^(4/3)
//! ```
//!
//! where η is surface elevation, h(x,y) is bathymetric depth, u is the
//! depth-averaged horizontal velocity, n is Manning's roughness coefficient.
//!
//! This scaffold provides:
//! - Linear long-wave dispersion `c = √(gh)` for arrival-time computation.
//! - Synolakis 1987 runup law as a closed-form for coastal amplification.
//! - A solver type that v0.2.0 will fill in with leapfrog time-stepping.

use serde::{Deserialize, Serialize};

use super::constants::G_EARTH;

/// Linear long-wave phase / group velocity in water of depth `h_m`, m/s.
pub fn long_wave_speed_m_s(h_m: f64) -> f64 {
    (G_EARTH * h_m.max(0.0)).sqrt()
}

/// Linear long-wave travel time from a source to a target, seconds.
/// Uses a 1-D constant-depth approximation `t = r / √(gh)`. For variable
/// bathymetry, the v0.2.0 solver will integrate along great-circle ray paths.
pub fn long_wave_travel_time_s(range_m: f64, mean_depth_m: f64) -> f64 {
    range_m / long_wave_speed_m_s(mean_depth_m).max(1.0)
}

/// Synolakis 1987 closed-form runup for a non-breaking solitary wave on a
/// plane beach:
///
/// ```text
/// R / H_0 = 2.831 · √(cot β) · (H_0 / d)^(5/4)
/// ```
///
/// where R is run-up height above still-water, H_0 is the deep-water wave
/// amplitude, d is the offshore depth where H_0 is measured, β is the beach
/// slope angle.
///
/// Valid for H_0 / d ≲ 0.78 (the breaking criterion). For larger amplitudes
/// the wave breaks offshore and run-up saturates — we clamp here at 0.78.
pub fn synolakis_runup_m(offshore_amplitude_m: f64, offshore_depth_m: f64, beach_slope_deg: f64) -> f64 {
    if offshore_depth_m <= 0.0 || beach_slope_deg <= 0.0 {
        return 0.0;
    }
    let h_over_d = (offshore_amplitude_m / offshore_depth_m).min(0.78);
    let cot_beta = 1.0 / beach_slope_deg.to_radians().tan().max(1e-6);
    2.831 * cot_beta.sqrt() * h_over_d.powf(5.0 / 4.0) * offshore_amplitude_m
}

/// Whether a wave at the given amplitude / depth ratio is past the breaking
/// criterion (H/d > 0.78 — Miche 1944, McCowan).
pub fn is_breaking(amplitude_m: f64, depth_m: f64) -> bool {
    depth_m > 0.0 && (amplitude_m / depth_m) > 0.78
}

/// Output of a single propagation snapshot. Frontend renders this as a
/// wavefront ring on the globe.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropagationSnapshot {
    pub time_s: f64,
    /// Ranges from the source, in meters, where amplitude is sampled.
    pub ranges_m: Vec<f64>,
    /// Amplitude at each range, in meters.
    pub amplitudes_m: Vec<f64>,
}

/// Cheap deep-ocean propagation sampler — produces a wavefront ring at the
/// supplied time, assuming linear long-wave decay `A(r) ∝ (R_c / r)^α` with
/// the alpha chosen by source type (0.5 for nuclear / 5/6 for impact).
///
/// Samples cluster near the *leading edge* (the visible wavefront), not the
/// source — the front is what users care about. We linearly sample the last
/// 25% of the radial range from `front - 0.25·front` to `front`, plus a small
/// tail of decay samples behind that for context.
///
/// This is sufficient for v0.0.x — the v0.2.0 grid solver will replace it.
pub fn sample_wavefront(
    initial_amplitude_m: f64,
    cavity_radius_m: f64,
    decay_alpha: f64,
    mean_depth_m: f64,
    time_s: f64,
    n_samples: usize,
) -> PropagationSnapshot {
    let c = long_wave_speed_m_s(mean_depth_m);
    let wavefront_r = c * time_s;
    let r_cavity = cavity_radius_m.max(1.0);
    let r_front = wavefront_r.max(r_cavity * 1.1);
    let r_band_start = (r_front * 0.75).max(r_cavity);

    let n = n_samples.max(2);
    // Reserve 80% of samples for the front band, 20% for the tail toward source.
    let n_front = ((n as f64) * 0.8).round() as usize;
    let n_tail = n.saturating_sub(n_front).max(2);

    let mut ranges_m = Vec::with_capacity(n);
    let mut amplitudes_m = Vec::with_capacity(n);

    // Tail samples: log-spaced from cavity to band-start.
    for i in 0..n_tail {
        let frac = i as f64 / (n_tail - 1).max(1) as f64;
        let r = r_cavity * (r_band_start / r_cavity).powf(frac);
        let a = initial_amplitude_m * (cavity_radius_m / r).powf(decay_alpha);
        ranges_m.push(r);
        amplitudes_m.push(a);
    }
    // Front band samples: linearly spaced (band-start, front].
    for i in 1..=n_front {
        let frac = i as f64 / n_front as f64;
        let r = r_band_start + (r_front - r_band_start) * frac;
        let a = initial_amplitude_m * (cavity_radius_m / r).powf(decay_alpha);
        ranges_m.push(r);
        amplitudes_m.push(a);
    }
    PropagationSnapshot {
        time_s,
        ranges_m,
        amplitudes_m,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pacific_wave_speed() {
        // 4 km depth → 198 m/s
        let c = long_wave_speed_m_s(4_000.0);
        assert!((196.0..200.0).contains(&c));
    }

    #[test]
    fn synolakis_amplifies_for_mild_slope() {
        // 1-m wave, 50-m offshore depth, 2° beach (typical Pacific shelf).
        let r = synolakis_runup_m(1.0, 50.0, 2.0);
        // Mild slopes amplify — expect 3–10× the offshore amplitude.
        assert!((1.0..20.0).contains(&r), "Synolakis runup {}", r);
    }

    #[test]
    fn breaking_criterion() {
        assert!(!is_breaking(1.0, 10.0));
        assert!(is_breaking(8.0, 10.0));
    }

    #[test]
    fn wavefront_decays_monotonically() {
        let snap = sample_wavefront(100.0, 1_000.0, 5.0 / 6.0, 4_000.0, 3_600.0, 50);
        for i in 1..snap.amplitudes_m.len() {
            assert!(
                snap.amplitudes_m[i] <= snap.amplitudes_m[i - 1] + 1e-9,
                "amplitude grew at sample {}",
                i
            );
        }
    }
}
