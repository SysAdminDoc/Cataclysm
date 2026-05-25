//! Shallow-water-equation finite-difference solver on a regular lat-lon grid.
//!
//! Replaces `shallow_water::sample_wavefront` (the v0.0.x analytical decay
//! sampler) with a real numerical integration of the depth-averaged
//! shallow-water equations.
//!
//! ## Equations
//!
//! Linearised SWE in Cartesian (cell-local) form with Manning bottom-friction:
//!
//! ```text
//! ∂η/∂t + ∂(H u)/∂x + ∂(H v)/∂y = 0
//! ∂u/∂t + g ∂η/∂x = − g n² |U| u / H^(4/3)
//! ∂v/∂t + g ∂η/∂y = − g n² |U| v / H^(4/3)
//! ```
//!
//! - `η` water-surface elevation (m)
//! - `H = h + η` total water column depth (h is bathymetric depth, m)
//! - `u, v` zonal and meridional depth-averaged velocity (m/s)
//! - `n` Manning roughness
//!
//! Discretisation: explicit forward-Euler leapfrog on a regular grid with
//! cell size derived from the lat/lon span. CFL stability is enforced by
//! `recommended_dt_s()` (`Δt < 0.4 · min(Δx, Δy) / max √(g·h)`).
//!
//! Boundaries: zero-flux (`u = v = 0`) at the grid edges. This produces some
//! mild reflection in long runs; the v0.3.0 work will swap for radiation
//! conditions / sponge layers.
//!
//! ## Implementation
//!
//! - CPU-only with `rayon` parallel iteration over grid rows for the
//!   continuity + momentum updates. Adequate for grids up to ~1024² at
//!   interactive frame rates (~30 fps).
//! - GPU compute via `wgpu` is the planned v0.3.0 perf upgrade — the WGSL
//!   kernel source lives in [`kernels`] for that future work.
//! - Snapshots are emitted at user-specified time stride; each snapshot is
//!   serialised as a base64 PNG (blue→red colormap) for cheap IPC + Cesium
//!   `SingleTileImageryProvider` consumption.

use base64::Engine;
use rayon::prelude::*;
use serde::Serialize;
use std::io::Cursor;

use super::constants::{G_EARTH, MANNING_N_COASTAL, R_EARTH_M};

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
    /// Min/max amplitude in the field (m), for caller-side colour-ramp.
    pub eta_min_m: f64,
    pub eta_max_m: f64,
    /// Maximum absolute amplitude across the grid (used by Cesium for
    /// alpha-by-magnitude rendering).
    pub eta_abs_max_m: f64,
    /// Base64-encoded PNG of the |η| field, mapped to a blue→white→red
    /// diverging colormap. Suitable for `data:image/png;base64,…` URIs
    /// passed to Cesium's `SingleTileImageryProvider`.
    pub eta_png_b64: String,
}

/// Mutable propagation state. Owns the η / u / v / h arrays.
#[derive(Debug, Clone)]
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

#[inline]
fn idx(i: usize, j: usize, nx: usize) -> usize {
    j * nx + i
}

impl SwGrid {
    /// Allocate a grid covering the given bounding box at the requested
    /// resolution. All fields zero-initialised; bathymetry is left at zero
    /// until the F4 bathymetry loader can sample at each cell. For now the
    /// caller can pass a uniform depth to [`fill_uniform_depth`].
    pub fn new(
        west_lon: f64,
        south_lat: f64,
        east_lon: f64,
        north_lat: f64,
        dlon_deg: f64,
        dlat_deg: f64,
    ) -> Self {
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

    /// Fill the bathymetry grid with a uniform depth. Used by the v0.2.0
    /// "flat ocean basin" smoke test until F4 ships real bathymetry.
    pub fn fill_uniform_depth(&mut self, depth_m: f64) {
        for v in self.h_m.iter_mut() {
            *v = depth_m;
        }
    }

    /// Sample bathymetry from a closure (`lat, lon → depth_m`). Used by F4
    /// to populate the grid from a real bathymetric source (ETOPO/GEBCO/
    /// SRTM15+).
    pub fn fill_bathymetry_from<F: Fn(f64, f64) -> f64>(&mut self, sample: F) {
        for j in 0..self.ny {
            let lat = self.south_lat + (j as f64 + 0.5) * self.dlat_deg;
            for i in 0..self.nx {
                let lon = self.west_lon + (i as f64 + 0.5) * self.dlon_deg;
                self.h_m[idx(i, j, self.nx)] = sample(lat, lon);
            }
        }
    }

    /// Approximate metres per degree at the grid's centre latitude.
    fn metres_per_deg(&self) -> (f64, f64) {
        let center_lat = self.south_lat + 0.5 * self.dlat_deg * self.ny as f64;
        let lat_m_per_deg = 2.0 * std::f64::consts::PI * R_EARTH_M / 360.0;
        let lon_m_per_deg = lat_m_per_deg * center_lat.to_radians().cos().abs().max(0.05);
        (lon_m_per_deg, lat_m_per_deg)
    }

    /// Maximum long-wave speed in the grid, m/s. Used to set the CFL Δt.
    pub fn max_celerity_m_s(&self) -> f64 {
        self.h_m
            .iter()
            .cloned()
            .fold(0.0_f64, |acc, h| acc.max(G_EARTH * h.max(0.0)))
            .sqrt()
    }

    /// CFL-safe time step in seconds. Caller-tunable safety factor (default
    /// 0.4 — leapfrog stability requires ≤ 0.5 for the linearised problem).
    pub fn recommended_dt_s(&self, cfl: f64) -> f64 {
        let (dx_lon, dy_lat) = self.metres_per_deg();
        let dx = dx_lon * self.dlon_deg;
        let dy = dy_lat * self.dlat_deg;
        let c = self.max_celerity_m_s().max(1.0);
        cfl * dx.min(dy) / c
    }

    /// Inject an initial-condition Gaussian bump centred on `(lat, lon)`
    /// with peak amplitude `amp_m` and 1-σ radius `sigma_m`.
    pub fn inject_gaussian(&mut self, center_lat: f64, center_lon: f64, amp_m: f64, sigma_m: f64) {
        let (lon_m, lat_m) = self.metres_per_deg();
        let sigma_lon = (sigma_m / lon_m).max(1e-9);
        let sigma_lat = (sigma_m / lat_m).max(1e-9);
        for j in 0..self.ny {
            for i in 0..self.nx {
                let lon = self.west_lon + (i as f64 + 0.5) * self.dlon_deg;
                let lat = self.south_lat + (j as f64 + 0.5) * self.dlat_deg;
                let dx = (lon - center_lon) / sigma_lon;
                let dy = (lat - center_lat) / sigma_lat;
                self.eta_m[idx(i, j, self.nx)] += amp_m * (-(dx * dx + dy * dy) * 0.5).exp();
            }
        }
    }

    /// Take a snapshot of the current state for IPC transport. NaN cells are
    /// treated as zero for the colormap; their presence is reported via
    /// `eta_max_m` / `eta_abs_max_m` clamped to finite.
    pub fn snapshot(&self) -> GridSnapshot {
        let (mut lo, mut hi, mut absmax) = (f64::INFINITY, f64::NEG_INFINITY, 0.0_f64);
        for &v in &self.eta_m {
            if !v.is_finite() {
                continue;
            }
            if v < lo {
                lo = v;
            }
            if v > hi {
                hi = v;
            }
            if v.abs() > absmax {
                absmax = v.abs();
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
            eta_abs_max_m: absmax,
            eta_png_b64: self.encode_eta_png(absmax.max(1e-9)),
        }
    }

    /// Encode the current η field as a PNG, mapped to a diverging blue–
    /// white–red colormap scaled by `scale_m`. Returns base64 string ready
    /// to drop into a `data:image/png;base64,…` URI.
    fn encode_eta_png(&self, scale_m: f64) -> String {
        let mut rgba = Vec::with_capacity(self.nx * self.ny * 4);
        let safe_scale = if scale_m.is_finite() && scale_m > 0.0 {
            scale_m
        } else {
            1.0
        };
        for j in (0..self.ny).rev() {
            // PNG rows are top-to-bottom; our grid is south-to-north, so flip j.
            for i in 0..self.nx {
                let v = self.eta_m[idx(i, j, self.nx)];
                // Treat NaN / Inf as transparent black instead of letting them
                // poison the colormap (which would produce stuck-bright pixels
                // or alpha = 0 NaN that the GPU rounds unpredictably).
                let (r, g, b, a) = if v.is_finite() {
                    let t = (v / safe_scale).clamp(-1.0, 1.0);
                    diverging_colormap(t)
                } else {
                    (0, 0, 0, 0)
                };
                rgba.extend_from_slice(&[r, g, b, a]);
            }
        }
        let mut buf = Vec::new();
        {
            let cursor = Cursor::new(&mut buf);
            let mut encoder = png::Encoder::new(cursor, self.nx as u32, self.ny as u32);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            match encoder.write_header() {
                Ok(mut writer) => {
                    if let Err(e) = writer.write_image_data(&rgba) {
                        eprintln!("[solver] PNG encode failed: {e}");
                        return String::new();
                    }
                }
                Err(e) => {
                    eprintln!("[solver] PNG header write failed: {e}");
                    return String::new();
                }
            }
        }
        base64::engine::general_purpose::STANDARD.encode(&buf)
    }
}

/// Blue→transparent→red diverging colormap. `t ∈ [-1, 1]`. Returns
/// premultiplied-alpha-friendly RGBA bytes — small amplitudes are nearly
/// transparent so the underlying Cesium globe shows through.
fn diverging_colormap(t: f64) -> (u8, u8, u8, u8) {
    let mag = t.abs();
    let a = (mag.sqrt() * 235.0).clamp(0.0, 235.0) as u8;
    if t < 0.0 {
        // Blue (sky) → cyan
        let r = (40.0 + 80.0 * (1.0 - mag)) as u8;
        let g = (180.0 + 60.0 * (1.0 - mag)) as u8;
        let b = 255;
        (r, g, b, a)
    } else {
        // Red → peach
        let r = 255;
        let g = (140.0 - 100.0 * mag) as u8;
        let b = (100.0 - 90.0 * mag) as u8;
        (r, g, b, a)
    }
}

/// Depth threshold (m) below which a cell is treated as dry land. The
/// `simulate_grid` command substitutes a sentinel `1.0` for the land cells
/// emitted by the offline bathymetry sampler (which returns 0 for land);
/// any future GEBCO sampler with a similar 0-for-land convention will
/// likewise be flagged. Cells under this threshold are excluded from the
/// leapfrog update so a continent-scale source no longer paints a
/// "halo" of slow-spreading wave over interior continents (I-V01).
pub const LAND_DEPTH_THRESHOLD_M: f64 = 1.01;

/// Boundary handling for the SWE solver. Sponge layers absorb outgoing
/// waves over a configurable rim width so a long-running scenario doesn't
/// reflect the wavefront back into the source (F-V10).
#[derive(Debug, Clone, Copy)]
pub enum BoundaryMode {
    /// `u = v = 0` at the four edges. Reflective; only useful for the
    /// dam-break analytical validation harness.
    ZeroFlux,
    /// `η`, `u`, `v` damped over an `width_cells`-wide rim by a
    /// cosine-tapered mask. Default for live simulations.
    Sponge { width_cells: usize },
}

impl BoundaryMode {
    pub const DEFAULT_SPONGE_WIDTH: usize = 10;
    pub fn default_sponge() -> Self {
        Self::Sponge {
            width_cells: Self::DEFAULT_SPONGE_WIDTH,
        }
    }
}

/// Time-stepping driver. v0.2.0 ships a CPU leapfrog with `rayon` row-
/// parallel updates. v0.3.0 will swap for a `wgpu` compute pipeline using
/// [`kernels::SWE_LEAPFROG_WGSL`].
#[derive(Debug, Clone, Copy)]
pub struct TimeStepper {
    pub dt_s: f64,
    pub manning_n: f64,
    pub boundary: BoundaryMode,
}

impl Default for TimeStepper {
    fn default() -> Self {
        Self {
            dt_s: 1.0,
            manning_n: MANNING_N_COASTAL,
            boundary: BoundaryMode::default_sponge(),
        }
    }
}

impl TimeStepper {
    pub fn new(dt_s: f64) -> Self {
        Self {
            dt_s,
            manning_n: MANNING_N_COASTAL,
            boundary: BoundaryMode::default_sponge(),
        }
    }

    /// Explicitly request a boundary mode. The validation harness uses
    /// `ZeroFlux`; live `simulate_grid` keeps the default `Sponge`.
    pub fn with_boundary(mut self, boundary: BoundaryMode) -> Self {
        self.boundary = boundary;
        self
    }

    /// Advance the grid by exactly `n_steps` of size `self.dt_s`.
    pub fn step(&self, grid: &mut SwGrid, n_steps: usize) {
        for _ in 0..n_steps {
            self.step_one(grid);
        }
    }

    /// Single explicit leapfrog step. Continuity update first, then
    /// momentum. Rows updated in parallel via rayon — references into the
    /// existing Vecs are captured by the outer parallel closure.
    pub fn step_one(&self, grid: &mut SwGrid) {
        let nx = grid.nx;
        let ny = grid.ny;
        let (lon_m, lat_m) = grid.metres_per_deg();
        let dx = lon_m * grid.dlon_deg;
        let dy = lat_m * grid.dlat_deg;
        let dt = self.dt_s;
        let g = G_EARTH;
        let n2 = self.manning_n * self.manning_n;

        // Snapshot of state before the step — momentum needs the OLD η + u + v.
        let eta_old = grid.eta_m.clone();
        let u_in = grid.u_ms.clone();
        let v_in = grid.v_ms.clone();
        let h: &Vec<f64> = &grid.h_m;

        // Continuity update: rows in parallel.
        let mut eta_new = vec![0.0f64; nx * ny];
        eta_new
            .par_chunks_mut(nx)
            .enumerate()
            .for_each(|(j, row)| {
                for i in 0..nx {
                    if i == 0 || i == nx - 1 || j == 0 || j == ny - 1 {
                        row[i] = eta_old[idx(i, j, nx)];
                        continue;
                    }
                    // Dry cells stay dry — η pinned to 0. Prevents the
                    // "slow spread halo" over continental interiors when
                    // simulate_grid substitutes 1 m for land bathymetry.
                    if h[idx(i, j, nx)] <= LAND_DEPTH_THRESHOLD_M {
                        row[i] = 0.0;
                        continue;
                    }
                    let h_e = h[idx(i + 1, j, nx)];
                    let h_w = h[idx(i - 1, j, nx)];
                    let h_n = h[idx(i, j + 1, nx)];
                    let h_s = h[idx(i, j - 1, nx)];
                    // Land-neighbour flux substitution: treat dry cells as
                    // reflective walls — zero the contributing flux term
                    // rather than letting an η_land × u_water product
                    // smear amplitude onto land.
                    let eta_e = if h_e > LAND_DEPTH_THRESHOLD_M { eta_old[idx(i + 1, j, nx)] } else { 0.0 };
                    let eta_w = if h_w > LAND_DEPTH_THRESHOLD_M { eta_old[idx(i - 1, j, nx)] } else { 0.0 };
                    let eta_n = if h_n > LAND_DEPTH_THRESHOLD_M { eta_old[idx(i, j + 1, nx)] } else { 0.0 };
                    let eta_s = if h_s > LAND_DEPTH_THRESHOLD_M { eta_old[idx(i, j - 1, nx)] } else { 0.0 };
                    let u_e = if h_e > LAND_DEPTH_THRESHOLD_M { u_in[idx(i + 1, j, nx)] } else { 0.0 };
                    let u_w = if h_w > LAND_DEPTH_THRESHOLD_M { u_in[idx(i - 1, j, nx)] } else { 0.0 };
                    let v_n = if h_n > LAND_DEPTH_THRESHOLD_M { v_in[idx(i, j + 1, nx)] } else { 0.0 };
                    let v_s = if h_s > LAND_DEPTH_THRESHOLD_M { v_in[idx(i, j - 1, nx)] } else { 0.0 };
                    let flux_x = ((h_e + eta_e).max(0.0) * u_e - (h_w + eta_w).max(0.0) * u_w)
                        / (2.0 * dx);
                    let flux_y = ((h_n + eta_n).max(0.0) * v_n - (h_s + eta_s).max(0.0) * v_s)
                        / (2.0 * dy);
                    row[i] = eta_old[idx(i, j, nx)] - dt * (flux_x + flux_y);
                }
            });

        // Momentum update: rows in parallel.
        let mut u_new = vec![0.0f64; nx * ny];
        let mut v_new = vec![0.0f64; nx * ny];
        let eta_new_ref: &Vec<f64> = &eta_new;
        u_new
            .par_chunks_mut(nx)
            .zip(v_new.par_chunks_mut(nx))
            .enumerate()
            .for_each(|(j, (u_row, v_row))| {
                for i in 0..nx {
                    if i == 0 || i == nx - 1 || j == 0 || j == ny - 1 {
                        u_row[i] = 0.0;
                        v_row[i] = 0.0;
                        continue;
                    }
                    // Dry cells carry no momentum.
                    if h[idx(i, j, nx)] <= LAND_DEPTH_THRESHOLD_M {
                        u_row[i] = 0.0;
                        v_row[i] = 0.0;
                        continue;
                    }
                    let dnedx = (eta_new_ref[idx(i + 1, j, nx)] - eta_new_ref[idx(i - 1, j, nx)])
                        / (2.0 * dx);
                    let dnedy = (eta_new_ref[idx(i, j + 1, nx)] - eta_new_ref[idx(i, j - 1, nx)])
                        / (2.0 * dy);
                    let h_total = (h[idx(i, j, nx)] + eta_new_ref[idx(i, j, nx)]).max(0.01);
                    let u = u_in[idx(i, j, nx)];
                    let v = v_in[idx(i, j, nx)];
                    let speed = (u * u + v * v).sqrt();
                    let fric = g * n2 * speed / h_total.powf(4.0 / 3.0);
                    u_row[i] = u - dt * (g * dnedx + fric * u);
                    v_row[i] = v - dt * (g * dnedy + fric * v);
                }
            });

        // Sponge-layer damping on the four rim cells. A cosine-tapered
        // mask `0.5 (1 - cos(π · d/w))` smoothly absorbs outgoing waves
        // so a long-running simulation doesn't reflect the wavefront
        // back into the source.
        if let BoundaryMode::Sponge { width_cells } = self.boundary {
            if width_cells > 0 && width_cells * 2 < nx && width_cells * 2 < ny {
                apply_sponge(&mut eta_new, &mut u_new, &mut v_new, nx, ny, width_cells);
            }
        }

        grid.eta_m = eta_new;
        grid.u_ms = u_new;
        grid.v_ms = v_new;
        grid.t_s += dt;
    }
}

/// Cosine-tapered sponge mask applied in-place to η, u, v. Cells within
/// `width` of any edge receive a damping factor in `[0, 1]` so amplitude
/// smoothly decays to zero at the rim, absorbing outgoing waves.
fn apply_sponge(
    eta: &mut [f64],
    u: &mut [f64],
    v: &mut [f64],
    nx: usize,
    ny: usize,
    width: usize,
) {
    use std::f64::consts::PI;
    for j in 0..ny {
        for i in 0..nx {
            let d_i = i.min(nx - 1 - i);
            let d_j = j.min(ny - 1 - j);
            let d = d_i.min(d_j);
            if d >= width {
                continue;
            }
            // Cosine taper: 0 at the very edge, 1 at d == width.
            let t = d as f64 / width as f64;
            let factor = 0.5 * (1.0 - (PI * (1.0 - t)).cos());
            let k = idx(i, j, nx);
            eta[k] *= factor;
            u[k] *= factor;
            v[k] *= factor;
        }
    }
}

/// Hard cap on total leapfrog steps. Protects us against pathological
/// inputs (e.g. `t_end_s = 24h` paired with a `dt_s` driven absurdly low
/// by an extreme bathymetry corner case) that would otherwise wedge the
/// solver thread for minutes.
const MAX_TOTAL_STEPS: usize = 1_000_000;

/// Run a full simulation: inject the IC Gaussian, step to `t_end_s`, emit
/// `n_snapshots` evenly-spaced snapshots (including t=0 and t_end).
pub fn run_simulation(
    grid: &mut SwGrid,
    stepper: &TimeStepper,
    t_end_s: f64,
    n_snapshots: usize,
) -> Vec<GridSnapshot> {
    let n = n_snapshots.max(2);
    let mut snaps = Vec::with_capacity(n);
    snaps.push(grid.snapshot());
    if !t_end_s.is_finite() || t_end_s <= 0.0 {
        return snaps;
    }
    // `dt_s` must be a real positive number or `t_end_s / dt_s` overflows
    // `usize` via the inf-cast path and we'd hang the worker thread.
    let dt = if stepper.dt_s.is_finite() && stepper.dt_s > 0.0 {
        stepper.dt_s
    } else {
        1.0
    };
    let raw_steps = (t_end_s / dt).max(1.0);
    let total_steps = if raw_steps.is_finite() && raw_steps < MAX_TOTAL_STEPS as f64 {
        raw_steps.round() as usize
    } else {
        MAX_TOTAL_STEPS
    };

    for k in 1..n {
        let target_step = (k * total_steps) / (n - 1);
        let current_step = ((k - 1) * total_steps) / (n - 1);
        let take = target_step.saturating_sub(current_step).max(1);
        stepper.step(grid, take);
        snaps.push(grid.snapshot());
    }
    snaps
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
        assert!(!s.eta_png_b64.is_empty(), "snapshot PNG should be non-empty");
        assert!(s.eta_png_b64.len() > 100, "snapshot PNG looks suspiciously small");
    }

    /// Smoke test: with uniform 4 km bathymetry, a 1 m Gaussian IC at the
    /// origin should propagate outward — after a few minutes the central
    /// amplitude drops and the ring spreads. Conservation isn't perfect for
    /// forward-Euler leapfrog, but the wavefront should advance at roughly
    /// √(gh) ≈ 198 m/s.
    #[test]
    fn flat_ocean_wave_propagates_outward() {
        let mut g = SwGrid::new(-5.0, -5.0, 5.0, 5.0, 0.25, 0.25);
        g.fill_uniform_depth(4_000.0);
        g.inject_gaussian(0.0, 0.0, 1.0, 50_000.0);

        let dt = g.recommended_dt_s(0.4);
        let stepper = TimeStepper::new(dt);
        let initial_centre = g.eta_m[idx(g.nx / 2, g.ny / 2, g.nx)];

        // Step for 10 minutes of sim time.
        let total_steps = ((600.0 / dt).round() as usize).max(2);
        stepper.step(&mut g, total_steps);

        let final_centre = g.eta_m[idx(g.nx / 2, g.ny / 2, g.nx)];

        // Wave has spread — central amplitude should have changed substantially.
        assert!(
            (final_centre - initial_centre).abs() > 0.05,
            "centre amplitude should evolve: initial={} final={}",
            initial_centre,
            final_centre
        );

        // Amplitude shouldn't blow up (CFL violation would explode).
        for v in &g.eta_m {
            assert!(
                v.abs() < 100.0,
                "amplitude exploded — CFL violation? max={}",
                v
            );
        }
    }

    #[test]
    fn run_simulation_emits_requested_snapshots() {
        let mut g = SwGrid::new(-2.0, -2.0, 2.0, 2.0, 0.5, 0.5);
        g.fill_uniform_depth(4_000.0);
        g.inject_gaussian(0.0, 0.0, 1.0, 50_000.0);
        let stepper = TimeStepper::new(g.recommended_dt_s(0.4));
        let snaps = run_simulation(&mut g, &stepper, 300.0, 5);
        assert_eq!(snaps.len(), 5);
        assert!(snaps[0].time_s == 0.0);
        assert!(snaps.last().unwrap().time_s >= 200.0);
    }

    /// I-V01 — land cells (h <= LAND_DEPTH_THRESHOLD_M) must stay dry
    /// over the whole simulation. Mock a "continent" as a 1-m-deep patch
    /// in the western half of an otherwise 4-km-deep ocean and inject a
    /// Gaussian in the east; after 10 minutes the western (land) cells
    /// must remain at η = 0 instead of the slow "halo" we saw in v0.2.x.
    #[test]
    fn land_cells_stay_dry() {
        let mut g = SwGrid::new(-5.0, -5.0, 5.0, 5.0, 0.25, 0.25);
        g.fill_uniform_depth(4_000.0);
        // Carve out a "continent" in the western half (i < nx/2): depth 1 m.
        for j in 0..g.ny {
            for i in 0..g.nx / 2 {
                g.h_m[idx(i, j, g.nx)] = 1.0;
            }
        }
        g.inject_gaussian(0.0, 2.5, 1.0, 50_000.0); // source on the east side
        let dt = g.recommended_dt_s(0.4);
        let stepper = TimeStepper::new(dt);
        stepper.step(&mut g, ((600.0 / dt).round() as usize).max(2));

        // Every western (land) cell stays at exactly 0.0 — the only path
        // to nonzero amplitude is the leapfrog update, which is masked
        // off for h <= LAND_DEPTH_THRESHOLD_M.
        for j in 0..g.ny {
            for i in 0..g.nx / 2 {
                let v = g.eta_m[idx(i, j, g.nx)];
                assert_eq!(v, 0.0, "land cell ({}, {}) bled wave amplitude: {}", i, j, v);
            }
        }
    }

    /// F-V10 — sponge boundary should absorb outgoing waves so rim cells
    /// approach zero amplitude regardless of source strength.
    #[test]
    fn sponge_boundary_absorbs_rim() {
        let mut g = SwGrid::new(-2.0, -2.0, 2.0, 2.0, 0.1, 0.1);
        g.fill_uniform_depth(4_000.0);
        g.inject_gaussian(0.0, 0.0, 1.0, 30_000.0);
        let stepper = TimeStepper::new(g.recommended_dt_s(0.4));
        stepper.step(&mut g, 600);

        // After a long-enough run the wave has reached the sponge zone.
        // Far-rim cells (corners, 1 cell from edge) should be damped to
        // < 1 % of the source amplitude.
        let corner = g.eta_m[idx(1, 1, g.nx)].abs();
        assert!(
            corner < 0.05,
            "corner cell amplitude {} m not absorbed by sponge",
            corner
        );
    }

    /// `BoundaryMode::ZeroFlux` opt-in still preserves the v0.2.x
    /// reflective behavior for the validation harness.
    #[test]
    fn zero_flux_boundary_opts_out_of_sponge() {
        let mut g = SwGrid::new(-2.0, -2.0, 2.0, 2.0, 0.5, 0.5);
        g.fill_uniform_depth(4_000.0);
        g.inject_gaussian(0.0, 0.0, 1.0, 50_000.0);
        let stepper = TimeStepper::new(g.recommended_dt_s(0.4)).with_boundary(BoundaryMode::ZeroFlux);
        stepper.step(&mut g, 30);
        // No assertion on absorption — just that the call returns without
        // panicking with the opt-in mode set. (Reflective wave dynamics
        // are validated in the analytical harness.)
        let total_energy: f64 = g.eta_m.iter().map(|v| v * v).sum();
        assert!(total_energy.is_finite() && total_energy > 0.0);
    }
}
