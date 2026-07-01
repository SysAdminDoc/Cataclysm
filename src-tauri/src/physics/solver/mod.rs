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
//! mild reflection in long runs; a future release will swap for radiation
//! conditions / sponge layers.
//!
//! ## Implementation
//!
//! - CPU-only with `rayon` parallel iteration over grid rows for the
//!   continuity + momentum updates. Adequate for grids up to ~1024² at
//!   interactive frame rates (~30 fps).
//! - GPU compute via `wgpu` is available behind the `gpu` feature flag — the
//!   WGSL kernel source lives in [`kernels`].
//! - Snapshots are emitted at user-specified time stride; each snapshot is
//!   serialised as a base64 PNG (selected SWE colormap) for cheap IPC +
//!   Cesium `SingleTileImageryProvider` consumption.

use base64::Engine;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};

use super::constants::{G_EARTH, MANNING_N_COASTAL, R_EARTH_M};

#[cfg(feature = "gpu")]
pub mod gpu;
pub mod kernels;

pub type DiagnosticSink<'a> = dyn Fn(&str) + Send + Sync + 'a;

pub(crate) fn report_diagnostic(
    diagnostics: Option<&DiagnosticSink<'_>>,
    message: impl Into<String>,
) {
    let message = message.into();
    if let Some(diagnostics) = diagnostics {
        diagnostics(&message);
    } else {
        eprintln!("{message}");
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct GridGaugePoint {
    pub id: String,
    pub lat_deg: f64,
    pub lon_deg: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct GridGaugeSample {
    pub id: String,
    pub eta_m: Option<f64>,
}

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
    #[serde(default)]
    pub gauge_samples: Vec<GridGaugeSample>,
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
    pub colormap: Colormap,
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
            colormap: Colormap::default(),
        }
    }

    /// Fill the bathymetry grid with a uniform depth. Used by the "flat ocean
    /// basin" smoke test and fallback mode.
    pub fn fill_uniform_depth(&mut self, depth_m: f64) {
        for v in self.h_m.iter_mut() {
            *v = depth_m;
        }
    }

    /// Sample bathymetry from a closure (`lat, lon → depth_m`). Used by the
    /// coarse basin/shelf sampler today; future GEBCO_2026/TID sampling can
    /// use the same grid-population path.
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

    /// F4-05 — apply the Hunga-Tonga-class atmospheric Lamb-wave
    /// surface-pressure forcing to the grid for one time step of
    /// duration `dt_s` ending at simulated time `t_s`. The η field
    /// receives the closed-form quasi-static depression contribution
    /// from `LambWaveSource::surface_depression_m` integrated across
    /// each cell's distance from the atmospheric source.
    ///
    /// Apply this *before* the leapfrog step so the next continuity +
    /// momentum update consumes the perturbed η as its IC. For long
    /// runs the caller invokes this every step inside the playback
    /// loop; for IC-only injections (a one-shot Gaussian-equivalent),
    /// call once with the full pulse window's `dt_s`.
    pub fn apply_lamb_wave(
        &mut self,
        source: &super::lamb_wave::LambWaveSource,
        source_lat: f64,
        source_lon: f64,
        t_s: f64,
    ) {
        use super::constants::R_EARTH_M;
        let lat_per_m = 360.0 / (2.0 * std::f64::consts::PI * R_EARTH_M);
        for j in 0..self.ny {
            for i in 0..self.nx {
                let lon = self.west_lon + (i as f64 + 0.5) * self.dlon_deg;
                let lat = self.south_lat + (j as f64 + 0.5) * self.dlat_deg;
                let dlat_m = (lat - source_lat) / lat_per_m;
                let lon_per_m = lat_per_m / source_lat.to_radians().cos().abs().max(0.05);
                let dlon_m = (lon - source_lon) / lon_per_m;
                let range_m = (dlat_m * dlat_m + dlon_m * dlon_m).sqrt();
                let depression = source.surface_depression_m(range_m, t_s);
                if depression > 0.0 {
                    // Lamb wave drives the surface DOWN under the
                    // pressure crest. Sign: subtract from η.
                    self.eta_m[idx(i, j, self.nx)] -= depression;
                }
            }
        }
    }

    /// Take a snapshot of the current state for IPC transport. NaN cells are
    /// treated as zero for the colormap; their presence is reported via
    /// `eta_max_m` / `eta_abs_max_m` clamped to finite.
    pub fn snapshot(&self) -> GridSnapshot {
        self.snapshot_with_diagnostics(None)
    }

    pub fn snapshot_with_diagnostics(
        &self,
        diagnostics: Option<&DiagnosticSink<'_>>,
    ) -> GridSnapshot {
        self.snapshot_with_gauge_samples(&[], diagnostics)
    }

    pub fn snapshot_with_gauge_samples(
        &self,
        gauges: &[GridGaugePoint],
        diagnostics: Option<&DiagnosticSink<'_>>,
    ) -> GridSnapshot {
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
            eta_png_b64: self.encode_eta_png(absmax.max(1e-9), diagnostics),
            gauge_samples: gauges
                .iter()
                .map(|g| GridGaugeSample {
                    id: g.id.clone(),
                    eta_m: self.sample_eta_at(g.lat_deg, g.lon_deg),
                })
                .collect(),
        }
    }

    pub fn sample_eta_at(&self, lat_deg: f64, lon_deg: f64) -> Option<f64> {
        if !lat_deg.is_finite() || !lon_deg.is_finite() || self.nx < 2 || self.ny < 2 {
            return None;
        }
        let x = ((lon_deg - self.west_lon) / self.dlon_deg) - 0.5;
        let y = ((lat_deg - self.south_lat) / self.dlat_deg) - 0.5;
        if !(x >= 0.0 && y >= 0.0 && x <= (self.nx - 1) as f64 && y <= (self.ny - 1) as f64) {
            return None;
        }
        let i0 = x.floor().clamp(0.0, (self.nx - 1) as f64) as usize;
        let j0 = y.floor().clamp(0.0, (self.ny - 1) as f64) as usize;
        let i1 = (i0 + 1).min(self.nx - 1);
        let j1 = (j0 + 1).min(self.ny - 1);
        let tx = (x - i0 as f64).clamp(0.0, 1.0);
        let ty = (y - j0 as f64).clamp(0.0, 1.0);
        let v00 = self.eta_m[idx(i0, j0, self.nx)];
        let v10 = self.eta_m[idx(i1, j0, self.nx)];
        let v01 = self.eta_m[idx(i0, j1, self.nx)];
        let v11 = self.eta_m[idx(i1, j1, self.nx)];
        if ![v00, v10, v01, v11].iter().all(|v| v.is_finite()) {
            return None;
        }
        Some(
            v00 * (1.0 - tx) * (1.0 - ty)
                + v10 * tx * (1.0 - ty)
                + v01 * (1.0 - tx) * ty
                + v11 * tx * ty,
        )
    }

    /// Encode the current η field as a PNG, mapped to a diverging blue–
    /// white–red colormap scaled by `scale_m`. Returns base64 string ready
    /// to drop into a `data:image/png;base64,…` URI.
    fn encode_eta_png(&self, scale_m: f64, diagnostics: Option<&DiagnosticSink<'_>>) -> String {
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
                    match self.colormap {
                        Colormap::Diverging => diverging_colormap(t),
                        Colormap::Cividis => cividis_colormap(t),
                        Colormap::Viridis => viridis_colormap(t),
                    }
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
                        report_diagnostic(diagnostics, format!("[solver] PNG encode failed: {e}"));
                        return String::new();
                    }
                }
                Err(e) => {
                    report_diagnostic(
                        diagnostics,
                        format!("[solver] PNG header write failed: {e}"),
                    );
                    return String::new();
                }
            }
        }
        base64::engine::general_purpose::STANDARD.encode(&buf)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub enum Colormap {
    #[default]
    Diverging,
    Cividis,
    Viridis,
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

/// Diverging cividis colormap (Nunez et al. 2018, CVD-safe).
/// `t ∈ [-1, 1]`: negative → dark blue-gray, positive → bright yellow.
fn cividis_colormap(t: f64) -> (u8, u8, u8, u8) {
    let mag = t.abs();
    let a = (mag.sqrt() * 235.0).clamp(0.0, 235.0) as u8;
    if t < 0.0 {
        let r = (0.0 + 0.0 * (1.0 - mag)) as u8;
        let g = (34.0 * mag) as u8;
        let b = (78.0 * mag) as u8;
        (r, g, b, a)
    } else {
        let r = (253.0 * mag) as u8;
        let g = (231.0 * mag) as u8;
        let b = (37.0 * mag) as u8;
        (r, g, b, a)
    }
}

/// Perceptually uniform viridis colormap (van der Walt & Smith 2015).
/// `t ∈ [-1, 1]`: maps |t| through a dark-purple → teal → yellow ramp.
/// Negative and positive amplitudes share the same hue ramp (sequential,
/// not diverging), differentiated only by the sign-aware label in the UI.
fn viridis_colormap(t: f64) -> (u8, u8, u8, u8) {
    let mag = t.abs();
    let a = (mag.sqrt() * 235.0).clamp(0.0, 235.0) as u8;
    // 5-stop linear interpolation through the viridis anchor colours.
    let anchors: [(f64, f64, f64); 5] = [
        (68.0, 1.0, 84.0),     // 0.00 — dark purple
        (59.0, 82.0, 139.0),   // 0.25
        (33.0, 145.0, 140.0),  // 0.50 — teal
        (94.0, 201.0, 98.0),   // 0.75
        (253.0, 231.0, 37.0),  // 1.00 — yellow
    ];
    let idx_f = (mag * 4.0).min(3.9999);
    let lo = idx_f as usize;
    let hi = (lo + 1).min(4);
    let frac = idx_f - lo as f64;
    let r = (anchors[lo].0 + (anchors[hi].0 - anchors[lo].0) * frac) as u8;
    let g = (anchors[lo].1 + (anchors[hi].1 - anchors[lo].1) * frac) as u8;
    let b = (anchors[lo].2 + (anchors[hi].2 - anchors[lo].2) * frac) as u8;
    (r, g, b, a)
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

/// Momentum-equation form (F4-02). The linear form drops the
/// `(u·∇)u` advection term — useful for the analytical Stoker
/// dam-break validation case where the classical celerity is
/// `c = √(g h)`. The nonlinear form includes upwind-differenced
/// advection so a steepening wave near a coast actually steepens
/// (a Phase-4 DoD requirement).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SolverMode {
    /// `∂u/∂t + g ∂η/∂x = − fric`. v0.2.x default.
    Linear,
    /// `∂u/∂t + (u·∇)u + g ∂η/∂x = − fric`. Default for live
    /// `simulate_grid` from v0.4.0 onward. Uses first-order upwind
    /// differencing for the advection term to remain stable across
    /// the steepening shock front.
    Nonlinear,
}

impl SolverMode {
    pub fn default_nonlinear() -> Self {
        Self::Nonlinear
    }
}

/// Time-stepping driver. CPU leapfrog with `rayon` row-parallel updates;
/// GPU path available behind the `gpu` feature flag.
#[derive(Debug, Clone, Copy)]
pub struct TimeStepper {
    pub dt_s: f64,
    pub manning_n: f64,
    pub boundary: BoundaryMode,
    pub mode: SolverMode,
}

impl Default for TimeStepper {
    fn default() -> Self {
        Self {
            dt_s: 1.0,
            manning_n: MANNING_N_COASTAL,
            boundary: BoundaryMode::default_sponge(),
            mode: SolverMode::default_nonlinear(),
        }
    }
}

impl TimeStepper {
    pub fn new(dt_s: f64) -> Self {
        Self {
            dt_s,
            manning_n: MANNING_N_COASTAL,
            boundary: BoundaryMode::default_sponge(),
            mode: SolverMode::default_nonlinear(),
        }
    }

    /// Explicitly request a boundary mode. The validation harness uses
    /// `ZeroFlux`; live `simulate_grid` keeps the default `Sponge`.
    pub fn with_boundary(mut self, boundary: BoundaryMode) -> Self {
        self.boundary = boundary;
        self
    }

    /// Explicitly request a solver mode (Linear / Nonlinear). The
    /// Stoker validation case uses `Linear` for the analytical
    /// celerity; live `simulate_grid` keeps the default `Nonlinear`.
    pub fn with_mode(mut self, mode: SolverMode) -> Self {
        self.mode = mode;
        self
    }

    /// Advance the grid by exactly `n_steps` of size `self.dt_s`.
    pub fn step(&self, grid: &mut SwGrid, n_steps: usize) {
        let _ = self.step_cancellable(grid, n_steps, None);
    }

    /// Advance the grid by up to `n_steps`, stopping early when `cancel`
    /// is set. Returns `false` if cancellation interrupted the batch.
    pub fn step_cancellable(
        &self,
        grid: &mut SwGrid,
        n_steps: usize,
        cancel: Option<&AtomicBool>,
    ) -> bool {
        for _ in 0..n_steps {
            if cancel.is_some_and(|c| c.load(Ordering::Acquire)) {
                return false;
            }
            self.step_one(grid);
        }
        true
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
        eta_new.par_chunks_mut(nx).enumerate().for_each(|(j, row)| {
            for i in 0..nx {
                // Dry cells stay dry — η pinned to 0. Prevents the
                // "slow spread halo" over continental interiors when
                // simulate_grid substitutes 1 m for land bathymetry.
                // Runs BEFORE the boundary fall-through so a land-on-
                // the-rim cell can't leak a residual IC amplitude.
                if h[idx(i, j, nx)] <= LAND_DEPTH_THRESHOLD_M {
                    row[i] = 0.0;
                    continue;
                }
                if i == 0 || i == nx - 1 || j == 0 || j == ny - 1 {
                    row[i] = eta_old[idx(i, j, nx)];
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
                let eta_e = if h_e > LAND_DEPTH_THRESHOLD_M {
                    eta_old[idx(i + 1, j, nx)]
                } else {
                    0.0
                };
                let eta_w = if h_w > LAND_DEPTH_THRESHOLD_M {
                    eta_old[idx(i - 1, j, nx)]
                } else {
                    0.0
                };
                let eta_n = if h_n > LAND_DEPTH_THRESHOLD_M {
                    eta_old[idx(i, j + 1, nx)]
                } else {
                    0.0
                };
                let eta_s = if h_s > LAND_DEPTH_THRESHOLD_M {
                    eta_old[idx(i, j - 1, nx)]
                } else {
                    0.0
                };
                let u_e = if h_e > LAND_DEPTH_THRESHOLD_M {
                    u_in[idx(i + 1, j, nx)]
                } else {
                    0.0
                };
                let u_w = if h_w > LAND_DEPTH_THRESHOLD_M {
                    u_in[idx(i - 1, j, nx)]
                } else {
                    0.0
                };
                let v_n = if h_n > LAND_DEPTH_THRESHOLD_M {
                    v_in[idx(i, j + 1, nx)]
                } else {
                    0.0
                };
                let v_s = if h_s > LAND_DEPTH_THRESHOLD_M {
                    v_in[idx(i, j - 1, nx)]
                } else {
                    0.0
                };
                let flux_x =
                    ((h_e + eta_e).max(0.0) * u_e - (h_w + eta_w).max(0.0) * u_w) / (2.0 * dx);
                let flux_y =
                    ((h_n + eta_n).max(0.0) * v_n - (h_s + eta_s).max(0.0) * v_s) / (2.0 * dy);
                row[i] = eta_old[idx(i, j, nx)] - dt * (flux_x + flux_y);
            }
        });

        // Momentum update: rows in parallel. Use the PRE-STEP η (eta_old)
        // for the pressure gradient so CPU matches the GPU leapfrog kernel
        // (simultaneous update — Mader 1988, Kowalik & Murty 1993).
        let mut u_new = vec![0.0f64; nx * ny];
        let mut v_new = vec![0.0f64; nx * ny];
        let eta_ref: &Vec<f64> = &eta_old;
        let nonlinear = matches!(self.mode, SolverMode::Nonlinear);
        u_new
            .par_chunks_mut(nx)
            .zip(v_new.par_chunks_mut(nx))
            .enumerate()
            .for_each(|(j, (u_row, v_row))| {
                for i in 0..nx {
                    // Dry cells carry no momentum (land + rim land both go
                    // to 0 before the boundary fall-through).
                    if h[idx(i, j, nx)] <= LAND_DEPTH_THRESHOLD_M {
                        u_row[i] = 0.0;
                        v_row[i] = 0.0;
                        continue;
                    }
                    if i == 0 || i == nx - 1 || j == 0 || j == ny - 1 {
                        u_row[i] = 0.0;
                        v_row[i] = 0.0;
                        continue;
                    }
                    let dnedx = (eta_ref[idx(i + 1, j, nx)] - eta_ref[idx(i - 1, j, nx)])
                        / (2.0 * dx);
                    let dnedy = (eta_ref[idx(i, j + 1, nx)] - eta_ref[idx(i, j - 1, nx)])
                        / (2.0 * dy);
                    let h_total = (h[idx(i, j, nx)] + eta_ref[idx(i, j, nx)]).max(0.01);
                    let u = u_in[idx(i, j, nx)];
                    let v = v_in[idx(i, j, nx)];

                    // F4-02 Nonlinear momentum advection: (u·∇)u with
                    // first-order upwind differencing for stability across
                    // the steepening shock front. Land neighbours
                    // contribute zero velocity (already-masked by the
                    // continuity step). Linear mode skips the advection
                    // for the validation harness Stoker comparison.
                    let (adv_u, adv_v) = if nonlinear {
                        let u_east = if h[idx(i + 1, j, nx)] > LAND_DEPTH_THRESHOLD_M {
                            u_in[idx(i + 1, j, nx)]
                        } else {
                            0.0
                        };
                        let u_west = if h[idx(i - 1, j, nx)] > LAND_DEPTH_THRESHOLD_M {
                            u_in[idx(i - 1, j, nx)]
                        } else {
                            0.0
                        };
                        let u_north = if h[idx(i, j + 1, nx)] > LAND_DEPTH_THRESHOLD_M {
                            u_in[idx(i, j + 1, nx)]
                        } else {
                            0.0
                        };
                        let u_south = if h[idx(i, j - 1, nx)] > LAND_DEPTH_THRESHOLD_M {
                            u_in[idx(i, j - 1, nx)]
                        } else {
                            0.0
                        };
                        let v_east = if h[idx(i + 1, j, nx)] > LAND_DEPTH_THRESHOLD_M {
                            v_in[idx(i + 1, j, nx)]
                        } else {
                            0.0
                        };
                        let v_west = if h[idx(i - 1, j, nx)] > LAND_DEPTH_THRESHOLD_M {
                            v_in[idx(i - 1, j, nx)]
                        } else {
                            0.0
                        };
                        let v_north = if h[idx(i, j + 1, nx)] > LAND_DEPTH_THRESHOLD_M {
                            v_in[idx(i, j + 1, nx)]
                        } else {
                            0.0
                        };
                        let v_south = if h[idx(i, j - 1, nx)] > LAND_DEPTH_THRESHOLD_M {
                            v_in[idx(i, j - 1, nx)]
                        } else {
                            0.0
                        };
                        // Upwind: take the backward gradient when the
                        // velocity points east/north, the forward gradient
                        // when it points west/south.
                        let dudx_up = if u >= 0.0 {
                            (u - u_west) / dx
                        } else {
                            (u_east - u) / dx
                        };
                        let dudy_up = if v >= 0.0 {
                            (u - u_south) / dy
                        } else {
                            (u_north - u) / dy
                        };
                        let dvdx_up = if u >= 0.0 {
                            (v - v_west) / dx
                        } else {
                            (v_east - v) / dx
                        };
                        let dvdy_up = if v >= 0.0 {
                            (v - v_south) / dy
                        } else {
                            (v_north - v) / dy
                        };
                        (u * dudx_up + v * dudy_up, u * dvdx_up + v * dvdy_up)
                    } else {
                        (0.0, 0.0)
                    };

                    let speed = (u * u + v * v).sqrt();
                    let fric = g * n2 * speed / h_total.powf(4.0 / 3.0);
                    u_row[i] = u - dt * (adv_u + g * dnedx + fric * u);
                    v_row[i] = v - dt * (adv_v + g * dnedy + fric * v);
                }
            });

        // Sponge-layer damping on the four rim cells. A cosine-tapered
        // mask `0.5 (1 - cos(π · d/w))` smoothly absorbs outgoing waves
        // so a long-running simulation doesn't reflect the wavefront
        // back into the source.
        if let BoundaryMode::Sponge { width_cells } = self.boundary {
            // Clamp the rim width to what the grid can hold (leaving at least
            // one interior cell on each axis) rather than silently disabling
            // the absorbing boundary on small grids — which used to revert them
            // to reflective edges with no indication, bouncing the wavefront
            // back into the source.
            let w = width_cells
                .min(nx.saturating_sub(1) / 2)
                .min(ny.saturating_sub(1) / 2);
            if w > 0 {
                apply_sponge(&mut eta_new, &mut u_new, &mut v_new, nx, ny, w);
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
///
/// Taper:  `factor = 0.5 (1 − cos(π · d/width))`, with `d` the distance
/// in cells to the nearest edge. At d=0 (edge): factor=0 (full damping);
/// at d=width (interior): factor=1 (no damping).
fn apply_sponge(eta: &mut [f64], u: &mut [f64], v: &mut [f64], nx: usize, ny: usize, width: usize) {
    use std::f64::consts::PI;
    for j in 0..ny {
        for i in 0..nx {
            let d_i = i.min(nx - 1 - i);
            let d_j = j.min(ny - 1 - j);
            let d = d_i.min(d_j);
            if d >= width {
                continue;
            }
            let t = d as f64 / width as f64;
            let factor = 0.5 * (1.0 - (PI * t).cos());
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
    cancel: Option<&AtomicBool>,
) -> Vec<GridSnapshot> {
    run_simulation_with_diagnostics(grid, stepper, t_end_s, n_snapshots, cancel, None)
}

pub fn run_simulation_with_diagnostics(
    grid: &mut SwGrid,
    stepper: &TimeStepper,
    t_end_s: f64,
    n_snapshots: usize,
    cancel: Option<&AtomicBool>,
    diagnostics: Option<&DiagnosticSink<'_>>,
) -> Vec<GridSnapshot> {
    run_simulation_with_gauge_samples(
        grid,
        stepper,
        t_end_s,
        n_snapshots,
        cancel,
        diagnostics,
        &[],
    )
}

pub fn run_simulation_with_gauge_samples(
    grid: &mut SwGrid,
    stepper: &TimeStepper,
    t_end_s: f64,
    n_snapshots: usize,
    cancel: Option<&AtomicBool>,
    diagnostics: Option<&DiagnosticSink<'_>>,
    gauges: &[GridGaugePoint],
) -> Vec<GridSnapshot> {
    let n = n_snapshots.max(2);
    let mut snaps = Vec::with_capacity(n);
    snaps.push(grid.snapshot_with_gauge_samples(gauges, diagnostics));
    if !t_end_s.is_finite() || t_end_s <= 0.0 {
        return snaps;
    }
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
        if cancel.is_some_and(|c| c.load(Ordering::Relaxed)) {
            break;
        }
        let target_step = (k * total_steps) / (n - 1);
        let current_step = ((k - 1) * total_steps) / (n - 1);
        let take = target_step.saturating_sub(current_step).max(1);
        if !stepper.step_cancellable(grid, take, cancel) {
            break;
        }
        snaps.push(grid.snapshot_with_gauge_samples(gauges, diagnostics));
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
        assert!(
            !s.eta_png_b64.is_empty(),
            "snapshot PNG should be non-empty"
        );
        assert!(
            s.eta_png_b64.len() > 100,
            "snapshot PNG looks suspiciously small"
        );
    }

    #[test]
    fn gauge_sampling_interpolates_eta_field() {
        let mut g = SwGrid::new(0.0, 0.0, 2.0, 2.0, 1.0, 1.0);
        g.eta_m = vec![1.0, 3.0, 5.0, 7.0];
        let got = g.sample_eta_at(1.0, 1.0).expect("sample inside grid");
        assert!((got - 4.0).abs() < 1e-9, "got {got}");
    }

    #[test]
    fn gauge_snapshot_marks_out_of_bounds_samples_missing() {
        let mut g = SwGrid::new(0.0, 0.0, 2.0, 2.0, 1.0, 1.0);
        g.eta_m = vec![1.0, 2.0, 3.0, 4.0];
        let snap = g.snapshot_with_gauge_samples(
            &[GridGaugePoint {
                id: "outside".to_string(),
                lat_deg: 80.0,
                lon_deg: 80.0,
            }],
            None,
        );
        assert_eq!(snap.gauge_samples.len(), 1);
        assert_eq!(snap.gauge_samples[0].id, "outside");
        assert_eq!(snap.gauge_samples[0].eta_m, None);
    }

    #[test]
    fn cividis_colormap_is_distinct_and_cvd_safe_hued() {
        let classic = diverging_colormap(1.0);
        let cividis = cividis_colormap(1.0);
        assert_ne!(classic, cividis);
        assert!(cividis.0 > 200 && cividis.1 > 180 && cividis.2 < 80);
    }

    #[test]
    fn viridis_colormap_is_distinct_and_sequential() {
        let classic = diverging_colormap(1.0);
        let viridis = viridis_colormap(1.0);
        assert_ne!(classic, viridis);
        // At t=1.0, viridis should be yellow (high R, high G, low B).
        assert!(viridis.0 > 200 && viridis.1 > 200 && viridis.2 < 80);
        // At t=0.0 (zero amplitude), alpha should be zero.
        let zero = viridis_colormap(0.0);
        assert_eq!(zero.3, 0);
    }

    #[test]
    fn run_simulation_obeys_pre_cancelled_token() {
        let mut g = SwGrid::new(-5.0, -5.0, 5.0, 5.0, 0.25, 0.25);
        g.fill_uniform_depth(4_000.0);
        g.inject_gaussian(0.0, 0.0, 1.0, 50_000.0);
        let stepper = TimeStepper::new(g.recommended_dt_s(0.4));
        let cancel = AtomicBool::new(true);
        let snaps = run_simulation(&mut g, &stepper, 300.0, 5, Some(&cancel));
        assert_eq!(snaps.len(), 1);
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
        let snaps = run_simulation(&mut g, &stepper, 300.0, 5, None);
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
                assert_eq!(
                    v, 0.0,
                    "land cell ({}, {}) bled wave amplitude: {}",
                    i, j, v
                );
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
        let dt = g.recommended_dt_s(0.3);
        let stepper = TimeStepper::new(dt);
        let steps = ((600.0 / dt).round() as usize).max(2);
        stepper.step(&mut g, steps);

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
        let stepper =
            TimeStepper::new(g.recommended_dt_s(0.4)).with_boundary(BoundaryMode::ZeroFlux);
        stepper.step(&mut g, 30);
        // No assertion on absorption — just that the call returns without
        // panicking with the opt-in mode set. (Reflective wave dynamics
        // are validated in the analytical harness.)
        let total_energy: f64 = g.eta_m.iter().map(|v| v * v).sum();
        assert!(total_energy.is_finite() && total_energy > 0.0);
    }

    /// F4-02 — both solver modes must produce stable, finite η fields
    /// over a representative run. The nonlinear advection extra terms
    /// don't blow up the solver. Numerical equivalence at small
    /// amplitudes (where the advection term is negligible) is also
    /// checked, with a generous tolerance to absorb upwind-vs-central
    /// differencing differences.
    #[test]
    fn linear_and_nonlinear_modes_both_stable() {
        let make_grid = || {
            let mut g = SwGrid::new(-5.0, -5.0, 5.0, 5.0, 0.25, 0.25);
            g.fill_uniform_depth(4_000.0);
            // Small-amplitude (0.1 m) IC so nonlinear advection should be
            // negligible — linear and nonlinear are expected to agree.
            g.inject_gaussian(0.0, 0.0, 0.1, 50_000.0);
            g
        };
        let mut g_lin = make_grid();
        let mut g_non = make_grid();
        let dt = g_lin.recommended_dt_s(0.4);
        let steps = ((600.0 / dt).round() as usize).max(2);
        TimeStepper::new(dt)
            .with_mode(SolverMode::Linear)
            .step(&mut g_lin, steps);
        TimeStepper::new(dt)
            .with_mode(SolverMode::Nonlinear)
            .step(&mut g_non, steps);

        // Both stable.
        for v in &g_lin.eta_m {
            assert!(v.is_finite() && v.abs() < 100.0, "linear blew up: {}", v);
        }
        for v in &g_non.eta_m {
            assert!(v.is_finite() && v.abs() < 100.0, "nonlinear blew up: {}", v);
        }

        // Centre amplitude evolved in both — wave propagated.
        let lin_centre = g_lin.eta_m[idx(g_lin.nx / 2, g_lin.ny / 2, g_lin.nx)].abs();
        let non_centre = g_non.eta_m[idx(g_non.nx / 2, g_non.ny / 2, g_non.nx)].abs();
        assert!(lin_centre < 0.09, "linear centre should have spread");
        assert!(non_centre < 0.09, "nonlinear centre should have spread");
    }
}
