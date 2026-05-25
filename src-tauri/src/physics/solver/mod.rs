//! Shallow-water-equation finite-difference solver on a regular lat-lon grid.
//!
//! The solver replaces `shallow_water::sample_wavefront` — the v0.0.x
//! analytical decay sampler — with a real numerical integration of the
//! depth-averaged shallow-water equations on a sphere.
//!
//! ## Equations
//!
//! ```text
//! ∂η/∂t + (1/cos φ) [∂(H u)/∂λ + ∂(H v cos φ)/∂φ] / R = 0
//! ∂u/∂t + (g / (R cos φ)) ∂η/∂λ = − g n² |U| u / H^(4/3)
//! ∂v/∂t + (g / R) ∂η/∂φ        = − g n² |U| v / H^(4/3)
//! ```
//!
//! - `η` water-surface elevation
//! - `H = h + η` total water column depth (h is bathymetric depth)
//! - `u, v` zonal and meridional depth-averaged velocity
//! - `R` Earth radius, `φ` latitude, `λ` longitude
//! - `g n² |U| U / H^(4/3)` Manning bottom-friction
//!
//! Discretisation: explicit leapfrog (Mader staggered C-grid) on a
//! `(nx × ny)` lat-lon grid with constant `Δλ`, `Δφ`. CFL stability requires
//! `Δt < min(Δx, Δy) / max √(g·h)`.
//!
//! ## Implementation status (v0.1.x)
//!
//! **Scaffold only.** Stubs:
//! - [`SwGrid`] owns the η, u, v ping-pong textures + bathymetry h.
//! - [`TimeStepper::step`] is a no-op CPU placeholder returning the current
//!   field unchanged. The real `wgpu` compute pipeline lands in v0.2.0.
//! - [`GridSnapshot`] is the IPC-friendly serialisation shape — frontend
//!   renders snapshots as a textured layer on Cesium.
//!
//! The v0.2.0 work is broken down in `RESEARCH_FEATURE_PLAN.md` F2:
//! Stoker dam-break analytical validation, Range et al. 2022 Chicxulub
//! far-field comparison, ping-pong buffer pair, WGSL kernel in
//! `kernels.wgsl`.

use serde::Serialize;

pub mod kernels;

/// One snapshot of the propagation field, suitable for IPC transport.
#[derive(Debug, Clone, Serialize)]
pub struct GridSnapshot {
    /// Sim time in seconds since source event.
    pub time_s: f64,
    /// Bounding box: `[west_lon, south_lat, east_lon, north_lat]`, degrees.
    pub bbox: [f64; 4],
    pub nx: u32,
    pub ny: u32,
    /// Min/max amplitude in the field (m), for colour-ramp normalization.
    pub eta_min_m: f64,
    pub eta_max_m: f64,
    /// **TODO v0.2.0**: serialise as base64-PNG (`eta_png_b64`) for cheap
    /// frontend texture binding. Empty in scaffold.
    pub eta_png_b64: String,
}

/// Mutable propagation state. Owns the η / u / v / h arrays and the
/// time-stepping cursor. v0.2.0 will swap this for wgpu-backed textures.
#[derive(Debug)]
pub struct SwGrid {
    pub nx: usize,
    pub ny: usize,
    /// Cell size in degrees.
    pub dlon_deg: f64,
    pub dlat_deg: f64,
    pub west_lon: f64,
    pub south_lat: f64,
    /// Bathymetric depth, meters (positive = below sea level). Row-major.
    pub h_m: Vec<f64>,
    /// Surface elevation, meters. Row-major.
    pub eta_m: Vec<f64>,
    /// Zonal velocity, m/s. Row-major.
    pub u_ms: Vec<f64>,
    /// Meridional velocity, m/s. Row-major.
    pub v_ms: Vec<f64>,
    /// Simulation time, seconds.
    pub t_s: f64,
}

impl SwGrid {
    /// Allocate a grid covering the given bounding box at the requested
    /// resolution. All fields zero-initialised; bathymetry is left at zero
    /// until the F4 bathymetry loader can sample GEBCO at each cell.
    pub fn new(west_lon: f64, south_lat: f64, east_lon: f64, north_lat: f64, dlon_deg: f64, dlat_deg: f64) -> Self {
        let nx = (((east_lon - west_lon) / dlon_deg).round() as usize).max(2);
        let ny = (((north_lat - south_lat) / dlat_deg).round() as usize).max(2);
        let n = nx * ny;
        Self {
            nx,
            ny,
            dlon_deg,
            dlat_deg,
            west_lon,
            south_lat,
            h_m: vec![0.0; n],
            eta_m: vec![0.0; n],
            u_ms: vec![0.0; n],
            v_ms: vec![0.0; n],
            t_s: 0.0,
        }
    }

    /// Inject an initial-condition Gaussian bump centred on `(lat, lon)`
    /// with peak amplitude `amp_m` and 1-σ radius `sigma_m`. Used by the
    /// `initial_displacement → grid` adapter.
    pub fn inject_gaussian(&mut self, center_lat: f64, center_lon: f64, amp_m: f64, sigma_m: f64) {
        // Approximate degrees-per-metre at the centre latitude.
        let lat_per_m = 360.0 / (2.0 * std::f64::consts::PI * super::constants::R_EARTH_M);
        let lon_per_m = lat_per_m / center_lat.to_radians().cos().max(0.1);
        let sigma_lon = sigma_m * lon_per_m;
        let sigma_lat = sigma_m * lat_per_m;
        for j in 0..self.ny {
            for i in 0..self.nx {
                let lon = self.west_lon + (i as f64 + 0.5) * self.dlon_deg;
                let lat = self.south_lat + (j as f64 + 0.5) * self.dlat_deg;
                let dx = (lon - center_lon) / sigma_lon.max(1e-9);
                let dy = (lat - center_lat) / sigma_lat.max(1e-9);
                self.eta_m[j * self.nx + i] += amp_m * (-(dx * dx + dy * dy) * 0.5).exp();
            }
        }
    }

    /// Take a snapshot of the current state for IPC transport.
    pub fn snapshot(&self) -> GridSnapshot {
        let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
        for &v in &self.eta_m {
            if v < lo {
                lo = v;
            }
            if v > hi {
                hi = v;
            }
        }
        GridSnapshot {
            time_s: self.t_s,
            bbox: [
                self.west_lon,
                self.south_lat,
                self.west_lon + self.dlon_deg * self.nx as f64,
                self.south_lat + self.dlat_deg * self.ny as f64,
            ],
            nx: self.nx as u32,
            ny: self.ny as u32,
            eta_min_m: if lo.is_finite() { lo } else { 0.0 },
            eta_max_m: if hi.is_finite() { hi } else { 0.0 },
            eta_png_b64: String::new(),
        }
    }
}

/// Time-stepping driver. v0.2.0 will dispatch a wgpu compute pipeline; the
/// scaffold currently advances time without modifying the field (returns
/// the IC unchanged).
#[derive(Debug, Default)]
pub struct TimeStepper {
    pub dt_s: f64,
    pub manning_n: f64,
}

impl TimeStepper {
    pub fn new(dt_s: f64) -> Self {
        Self {
            dt_s,
            manning_n: super::constants::MANNING_N_COASTAL,
        }
    }

    /// Advance `n_steps` of size `self.dt_s`. **Scaffold**: just increments
    /// the time cursor. The real leapfrog SWE update lands with the wgpu
    /// pipeline in v0.2.0.
    pub fn step(&self, grid: &mut SwGrid, n_steps: usize) {
        grid.t_s += self.dt_s * n_steps as f64;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grid_alloc_and_snapshot() {
        let mut g = SwGrid::new(-180.0, -85.0, 180.0, 85.0, 2.0, 2.0);
        assert_eq!(g.nx, 180);
        assert_eq!(g.ny, 85);
        g.inject_gaussian(0.0, 0.0, 10.0, 1_000_000.0);
        let s = g.snapshot();
        assert!(s.eta_max_m > 9.0 && s.eta_max_m <= 10.0);
        assert!(s.eta_min_m >= 0.0);
    }

    #[test]
    fn stepper_advances_time_only_scaffold() {
        let mut g = SwGrid::new(0.0, 0.0, 10.0, 10.0, 0.5, 0.5);
        let step = TimeStepper::new(1.0);
        step.step(&mut g, 60);
        assert_eq!(g.t_s, 60.0);
        // Field should still be zero (no IC injected).
        assert!(g.eta_m.iter().all(|&v| v == 0.0));
    }
}
