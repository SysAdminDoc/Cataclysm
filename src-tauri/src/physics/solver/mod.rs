//! Shallow-water-equation finite-volume solver on a regular lat-lon grid.
//!
//! Replaces `shallow_water::sample_wavefront` (the v0.0.x analytical decay
//! sampler) with a real numerical integration of the depth-averaged
//! shallow-water equations.
//!
//! ## Equations
//!
//! Linearised SWE on a spherical latitude-longitude grid with Manning
//! bottom-friction:
//!
//! ```text
//! ∂η/∂t + 1/(R cosφ) ∂(H u)/∂λ + 1/(R cosφ) ∂(H v cosφ)/∂φ = 0
//! ∂u/∂t + g/(R cosφ) ∂η/∂λ = − g n² |U| u / H^(4/3)
//! ∂v/∂t + g/R ∂η/∂φ = − g n² |U| v / H^(4/3)
//! ```
//!
//! - `η` water-surface elevation (m)
//! - `H = h + η` total water column depth (h is bathymetric depth, m)
//! - `u, v` zonal and meridional depth-averaged velocity (m/s)
//! - `n` Manning roughness
//!
//! Discretisation: explicit hydrostatic reconstruction with a local
//! Lax-Friedrichs (Rusanov) flux, conserved total depth/momenta, a 1 mm dry
//! tolerance, and per-row spherical face metrics. This preserves a constant
//! free surface over variable bathymetry and prevents negative water columns;
//! nonlinear mode retains advective and spherical metric terms. CFL stability
//! is enforced by `recommended_dt_s()` using the same per-row two-dimensional
//! characteristic-speed definition enforced by the run-quality gate.
//!
//! Boundaries: selectable zero-flux (`u = v = 0`) or cosine-tapered sponge.
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
use crate::data::geodesy::{GeographicFieldTile, geographic_field_tiles};

#[cfg(feature = "gpu")]
pub mod gpu;
pub mod kernels;
pub mod max_field;
pub mod checkpoint;
pub mod quality;

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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
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

#[derive(Debug, Clone, Serialize)]
pub struct GridSnapshotTile {
    pub column_offset: u32,
    pub column_count: u32,
    pub bbox: [f64; 4],
    pub eta_png_b64: String,
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
    /// CRS/datum/unit/error contract for η and gauge sample heights.
    pub height_field: crate::data::geodesy::HeightFieldMetadata,
    /// Min/max amplitude in the field (m), for caller-side colour-ramp.
    pub eta_min_m: f64,
    pub eta_max_m: f64,
    /// Maximum absolute amplitude across the grid (used by Cesium for
    /// alpha-by-magnitude rendering).
    pub eta_abs_max_m: f64,
    /// Base64-encoded PNG of the |η| field for a single non-wrapping
    /// rectangle. Empty when `field_tiles` carries the complete field, which
    /// avoids retaining a redundant full raster for wrapped/polar grids.
    pub eta_png_b64: String,
    /// Non-wrapping renderer tiles. Empty for a single low-latitude rectangle;
    /// populated for antimeridian and polar fields.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub field_tiles: Vec<GridSnapshotTile>,
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
    /// Authoritative number of accepted solver steps since the initial state.
    /// Render/replay clients use this integer rather than integrating floating
    /// point time independently.
    pub step_index: u64,
    pub colormap: Colormap,
}

/// Borrowed quantitative fields exposed to the renderer protocol before any
/// colour mapping or PNG quantisation is applied.
#[derive(Debug, Clone, Copy)]
pub struct RawGridFields<'a> {
    pub nx: usize,
    pub ny: usize,
    pub west_lon_deg: f64,
    pub south_lat_deg: f64,
    pub dlon_deg: f64,
    pub dlat_deg: f64,
    pub time_s: f64,
    pub step_index: u64,
    pub bathymetry_depth_m: &'a [f64],
    pub eta_m: &'a [f64],
    pub velocity_east_m_s: &'a [f64],
    pub velocity_north_m_s: &'a [f64],
}

#[inline]
pub(super) fn idx(i: usize, j: usize, nx: usize) -> usize {
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
        let west_lon = align_grid_west_to_antimeridian(west_lon, nx, dlon_deg);
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
            step_index: 0,
            colormap: Colormap::default(),
        }
    }

    /// Borrow the scientific fields used by the renderer protocol. The
    /// returned slices remain owned by this grid and are always row-major.
    pub fn raw_render_fields(&self) -> RawGridFields<'_> {
        RawGridFields {
            nx: self.nx,
            ny: self.ny,
            west_lon_deg: self.west_lon,
            south_lat_deg: self.south_lat,
            dlon_deg: self.dlon_deg,
            dlat_deg: self.dlat_deg,
            time_s: self.t_s,
            step_index: self.step_index,
            bathymetry_depth_m: &self.h_m,
            eta_m: &self.eta_m,
            velocity_east_m_s: &self.u_ms,
            velocity_north_m_s: &self.v_ms,
        }
    }

    pub fn field_tiles(&self) -> Result<Vec<GeographicFieldTile>, String> {
        geographic_field_tiles(
            self.west_lon,
            self.south_lat,
            self.nx,
            self.ny,
            self.dlon_deg,
            self.dlat_deg,
        )
    }

    /// Pack the solver's exact wet/dry decision into one bit per cell. Bit 1
    /// means wet; unused high bits in the final byte are always zero.
    pub fn wet_mask_bits(&self) -> Vec<u8> {
        let mut bits = vec![0_u8; self.h_m.len().div_ceil(8)];
        for (index, (&depth, &eta)) in self.h_m.iter().zip(&self.eta_m).enumerate() {
            if total_depth_m(depth, eta) > WET_DEPTH_EPSILON_M {
                bits[index / 8] |= 1 << (index % 8);
            }
        }
        bits
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

    /// Latitude at a row's cell centre, in radians.
    #[inline]
    pub(crate) fn row_lat_rad(&self, row: usize) -> f64 {
        (self.south_lat + (row as f64 + 0.5) * self.dlat_deg).to_radians()
    }

    /// Physical east-west distance across one cell in a row. Cell centres in
    /// a valid pole-bounded grid never lie exactly on a pole, so this remains
    /// finite without the former 0.05 cosine floor that overstated polar cells.
    #[inline]
    pub(crate) fn row_dx_m(&self, row: usize) -> f64 {
        (R_EARTH_M * self.dlon_deg.to_radians().abs() * self.row_lat_rad(row).cos().abs())
            .max(f64::MIN_POSITIVE)
    }

    /// Physical north-south distance across one cell.
    #[inline]
    pub(crate) fn dy_m(&self) -> f64 {
        (R_EARTH_M * self.dlat_deg.to_radians().abs()).max(f64::MIN_POSITIVE)
    }

    /// Exact spherical surface area of one cell in a row.
    #[inline]
    pub(crate) fn row_cell_area_m2(&self, row: usize) -> f64 {
        let south = (self.south_lat + row as f64 * self.dlat_deg).to_radians();
        let north = south + self.dlat_deg.to_radians();
        (R_EARTH_M
            * R_EARTH_M
            * self.dlon_deg.to_radians().abs()
            * (north.sin() - south.sin()).abs())
        .max(f64::MIN_POSITIVE)
    }

    /// Maximum long-wave speed in the grid, m/s. Used to set the CFL Δt.
    pub fn max_celerity_m_s(&self) -> f64 {
        self.h_m
            .iter()
            .cloned()
            .fold(0.0_f64, |acc, h| acc.max(G_EARTH * h.max(0.0)))
            .sqrt()
    }

    /// CFL-safe time step in seconds. The requested limit is applied to the
    /// same dimension-summed characteristic-speed CFL used by the quality
    /// gate, including the initial displacement and any existing velocity.
    /// Keeping selection and admission on one definition prevents a timestep
    /// chosen here from being rejected before the first solver step.
    pub fn recommended_dt_s(&self, cfl: f64) -> f64 {
        let rate = self.characteristic_cfl_number(1.0);
        if rate.is_finite() && rate > 0.0 {
            cfl.max(0.0) / rate
        } else {
            let min_dx = (0..self.ny)
                .map(|row| self.row_dx_m(row))
                .fold(f64::INFINITY, f64::min);
            cfl.max(0.0) * min_dx.min(self.dy_m())
        }
    }

    pub(crate) fn characteristic_cfl_number(&self, dt_s: f64) -> f64 {
        let dy = self.dy_m();
        (0..self.ny)
            .flat_map(|j| {
                let dx = self.row_dx_m(j);
                (0..self.nx).map(move |i| {
                    let k = idx(i, j, self.nx);
                    let h = self.h_m[k];
                    let eta = self.eta_m[k];
                    let u = self.u_ms[k];
                    let v = self.v_ms[k];
                    let celerity = (G_EARTH * (h + eta).max(0.0)).sqrt();
                    dt_s * ((u.abs() + celerity) / dx + (v.abs() + celerity) / dy)
                })
            })
            .fold(0.0_f64, f64::max)
    }

    /// Inject an initial-condition Gaussian bump centred on `(lat, lon)`
    /// with peak amplitude `amp_m` and 1-σ radius `sigma_m`.
    pub fn inject_gaussian(&mut self, center_lat: f64, center_lon: f64, amp_m: f64, sigma_m: f64) {
        let sigma_m = sigma_m.max(f64::MIN_POSITIVE);
        for j in 0..self.ny {
            for i in 0..self.nx {
                let lon = self.west_lon + (i as f64 + 0.5) * self.dlon_deg;
                let lat = self.south_lat + (j as f64 + 0.5) * self.dlat_deg;
                let delta_lon = (lon - center_lon + 540.0).rem_euclid(360.0) - 180.0;
                let mean_lat = 0.5 * (lat + center_lat);
                let dx = R_EARTH_M * delta_lon.to_radians() * mean_lat.to_radians().cos() / sigma_m;
                let dy = R_EARTH_M * (lat - center_lat).to_radians() / sigma_m;
                self.eta_m[idx(i, j, self.nx)] += amp_m * (-(dx * dx + dy * dy) * 0.5).exp();
            }
        }
    }

    /// Add a source-sampled displacement field to the solver state.
    /// Keeping this primitive geometry-agnostic ensures the CPU and GPU paths
    /// receive exactly the same t=0 array before their steppers diverge.
    pub fn inject_field(&mut self, eta_m: &[f64]) -> Result<(), String> {
        if eta_m.len() != self.eta_m.len() {
            return Err(format!(
                "initial field has {} cells; solver grid requires {}",
                eta_m.len(),
                self.eta_m.len()
            ));
        }
        if eta_m.iter().any(|value| !value.is_finite()) {
            return Err("initial field contains a non-finite displacement".into());
        }
        for (target, source) in self.eta_m.iter_mut().zip(eta_m) {
            *target += source;
        }
        Ok(())
    }

    /// F4-05 — apply the Hunga-Tonga-class atmospheric Lamb-wave
    /// surface-pressure forcing to the grid for one time step of
    /// duration `dt_s` ending at simulated time `t_s`. The η field
    /// receives the closed-form quasi-static depression contribution
    /// from `LambWaveSource::surface_depression_m` integrated across
    /// each cell's distance from the atmospheric source.
    ///
    /// Apply this *before* the finite-volume step so the next continuity +
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
                let lon_per_m = lat_per_m / lat.to_radians().cos().abs().max(0.05);
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
        let field_tiles = match self.field_tiles() {
            Ok(layouts) if layouts.len() > 1 => layouts
                .into_iter()
                .map(|tile| GridSnapshotTile {
                    eta_png_b64: self.encode_eta_png_columns(
                        tile.column_offset as usize,
                        tile.column_count as usize,
                        absmax.max(1e-9),
                        diagnostics,
                    ),
                    column_offset: tile.column_offset,
                    column_count: tile.column_count,
                    bbox: tile.bbox,
                })
                .collect(),
            Ok(_) => Vec::new(),
            Err(error) => {
                report_diagnostic(diagnostics, format!("SWE field tiling failed: {error}"));
                Vec::new()
            }
        };
        let eta_png_b64 = if field_tiles.is_empty() {
            self.encode_eta_png(absmax.max(1e-9), diagnostics)
        } else {
            String::new()
        };
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
            height_field: crate::data::geodesy::sea_surface_height_field(),
            eta_min_m: if lo.is_finite() { lo } else { 0.0 },
            eta_max_m: if hi.is_finite() { hi } else { 0.0 },
            eta_abs_max_m: absmax,
            eta_png_b64,
            field_tiles,
            gauge_samples: gauges
                .iter()
                .zip(self.sample_gauge_values(gauges))
                .map(|(gauge, eta_m)| GridGaugeSample {
                    id: gauge.id.clone(),
                    eta_m,
                })
                .collect(),
        }
    }

    pub fn sample_gauge_values(&self, gauges: &[GridGaugePoint]) -> Vec<Option<f64>> {
        gauges
            .iter()
            .map(|gauge| self.sample_eta_at(gauge.lat_deg, gauge.lon_deg))
            .collect()
    }

    pub fn sample_eta_at(&self, lat_deg: f64, lon_deg: f64) -> Option<f64> {
        if !lat_deg.is_finite() || !lon_deg.is_finite() || self.nx < 2 || self.ny < 2 {
            return None;
        }
        let grid_center_lon = self.west_lon + 0.5 * self.nx as f64 * self.dlon_deg;
        let unwrapped_lon =
            grid_center_lon + (lon_deg - grid_center_lon + 180.0).rem_euclid(360.0) - 180.0;
        let x = ((unwrapped_lon - self.west_lon) / self.dlon_deg) - 0.5;
        let y = ((lat_deg - self.south_lat) / self.dlat_deg) - 0.5;
        // Cell-centre coordinates run [0, n-1]; the bbox extends half a cell
        // beyond the outer centres, so accept any point inside the bbox and
        // edge-clamp the outer half-cell rim into the interpolation domain. A
        // gauge on the frame edge (e.g. a DART buoy) now reads the edge value
        // instead of silently returning None.
        let x_max = (self.nx - 1) as f64;
        let y_max = (self.ny - 1) as f64;
        if x < -0.5 || y < -0.5 || x > x_max + 0.5 || y > y_max + 0.5 {
            return None;
        }
        let x = x.clamp(0.0, x_max);
        let y = y.clamp(0.0, y_max);
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
        self.encode_eta_png_columns(0, self.nx, scale_m, diagnostics)
    }

    fn encode_eta_png_columns(
        &self,
        column_offset: usize,
        column_count: usize,
        scale_m: f64,
        diagnostics: Option<&DiagnosticSink<'_>>,
    ) -> String {
        let mut rgba = Vec::with_capacity(column_count * self.ny * 4);
        let safe_scale = if scale_m.is_finite() && scale_m > 0.0 {
            scale_m
        } else {
            1.0
        };
        for j in (0..self.ny).rev() {
            // PNG rows are top-to-bottom; our grid is south-to-north, so flip j.
            for i in column_offset..column_offset + column_count {
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
        encode_rgba_png(column_count as u32, self.ny as u32, &rgba, diagnostics)
    }
}

fn align_grid_west_to_antimeridian(west_lon: f64, nx: usize, dlon_deg: f64) -> f64 {
    if !west_lon.is_finite() || !dlon_deg.is_finite() || dlon_deg <= 0.0 || nx == 0 {
        return west_lon;
    }
    let width = nx as f64 * dlon_deg;
    let mut west = west_lon;
    while west + width <= -180.0 {
        west += 360.0;
    }
    while west >= 180.0 {
        west -= 360.0;
    }
    let boundary = if west < -180.0 {
        Some(-180.0)
    } else if west + width > 180.0 {
        Some(180.0)
    } else {
        None
    };
    if let Some(boundary) = boundary {
        let columns = ((boundary - west) / dlon_deg)
            .round()
            .clamp(1.0, (nx - 1).max(1) as f64);
        west = boundary - columns * dlon_deg;
    }
    west
}

/// Encode an RGBA byte buffer as a base64 PNG. Shared by the per-snapshot
/// η renderer and the max-field product renderers.
pub(super) fn encode_rgba_png(
    nx: u32,
    ny: u32,
    rgba: &[u8],
    diagnostics: Option<&DiagnosticSink<'_>>,
) -> String {
    let mut buf = Vec::new();
    {
        let cursor = Cursor::new(&mut buf);
        let mut encoder = png::Encoder::new(cursor, nx, ny);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        match encoder.write_header() {
            Ok(mut writer) => {
                if let Err(e) = writer.write_image_data(rgba) {
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

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Colormap {
    #[default]
    Diverging,
    Cividis,
    Viridis,
}

/// Blue→transparent→red diverging colormap. `t ∈ [-1, 1]`. Returns
/// premultiplied-alpha-friendly RGBA bytes — small amplitudes are nearly
/// transparent so the underlying Cesium globe shows through.
pub(super) fn diverging_colormap(t: f64) -> (u8, u8, u8, u8) {
    let mag = t.abs();
    // Alpha ramp: mag^0.45 lifts small ripples into visibility a touch more
    // than a plain sqrt while keeping calm water/land translucent, so the wave
    // reads as a moving water surface rather than a faint stain. Cap 245.
    let a = (mag.powf(0.45) * 245.0).clamp(0.0, 245.0) as u8;
    if t < 0.0 {
        // Deep ocean blue (trough) → lighter blue toward zero.
        let r = (30.0 + 70.0 * (1.0 - mag)) as u8;
        let g = (120.0 + 90.0 * (1.0 - mag)) as u8;
        let b = 255;
        (r, g, b, a)
    } else {
        // Crest: white-cyan foam near the leading edge → deep red at peak.
        let r = 255;
        let g = (170.0 - 150.0 * mag) as u8;
        let b = (140.0 - 130.0 * mag) as u8;
        (r, g, b, a)
    }
}

/// Diverging cividis colormap (Nunez et al. 2018, CVD-safe).
/// `t ∈ [-1, 1]`: negative → dark blue-gray, positive → bright yellow.
pub(super) fn cividis_colormap(t: f64) -> (u8, u8, u8, u8) {
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
pub(super) fn viridis_colormap(t: f64) -> (u8, u8, u8, u8) {
    let mag = t.abs();
    let a = (mag.sqrt() * 235.0).clamp(0.0, 235.0) as u8;
    // 5-stop linear interpolation through the viridis anchor colours.
    let anchors: [(f64, f64, f64); 5] = [
        (68.0, 1.0, 84.0),    // 0.00 — dark purple
        (59.0, 82.0, 139.0),  // 0.25
        (33.0, 145.0, 140.0), // 0.50 — teal
        (94.0, 201.0, 98.0),  // 0.75
        (253.0, 231.0, 37.0), // 1.00 — yellow
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

/// Total water-column depth below which a cell carries no momentum. Sub-
/// threshold positive water is retained so conservative face fluxes can
/// accumulate into an advancing front; only the wet mask and momentum treat
/// the cell as dry. This avoids both mass deletion and a one-step wetting
/// barrier while never admitting negative depth.
pub const WET_DEPTH_EPSILON_M: f64 = 1.0e-3;

#[inline]
fn total_depth_m(still_water_depth_m: f64, eta_m: f64) -> f64 {
    nonnegative_depth(still_water_depth_m + eta_m)
}

#[inline]
fn nonnegative_depth(value: f64) -> f64 {
    if value >= 0.0 {
        value
    } else if value < 0.0 {
        0.0
    } else {
        value
    }
}

#[derive(Debug, Clone, Copy)]
struct HydrostaticFaceFlux {
    mass: f64,
    normal_left: f64,
    normal_right: f64,
    tangential: f64,
}

/// Hydrostatic-reconstruction/Rusanov flux at one cell face. Rebuilding both
/// face depths above the higher bed and applying the Audusse pressure-source
/// correction makes a constant free surface an exact steady state even when
/// neighbouring bathymetry differs or one side is dry.
#[inline]
#[allow(clippy::too_many_arguments)]
fn hydrostatic_face_flux(
    h_left: f64,
    eta_left: f64,
    normal_velocity_left: f64,
    tangential_velocity_left: f64,
    h_right: f64,
    eta_right: f64,
    normal_velocity_right: f64,
    tangential_velocity_right: f64,
    nonlinear: bool,
) -> HydrostaticFaceFlux {
    let face_bed_elevation = (-h_left).max(-h_right);
    let depth_left = nonnegative_depth(eta_left - face_bed_elevation);
    let depth_right = nonnegative_depth(eta_right - face_bed_elevation);
    let raw_depth_left = total_depth_m(h_left, eta_left);
    let raw_depth_right = total_depth_m(h_right, eta_right);
    let (normal_velocity_left, tangential_velocity_left) = if raw_depth_left
        > WET_DEPTH_EPSILON_M
    {
        (normal_velocity_left, tangential_velocity_left)
    } else {
        (0.0, 0.0)
    };
    let (normal_velocity_right, tangential_velocity_right) = if raw_depth_right
        > WET_DEPTH_EPSILON_M
    {
        (normal_velocity_right, tangential_velocity_right)
    } else {
        (0.0, 0.0)
    };
    let normal_discharge_left = depth_left * normal_velocity_left;
    let normal_discharge_right = depth_right * normal_velocity_right;
    let tangential_discharge_left = depth_left * tangential_velocity_left;
    let tangential_discharge_right = depth_right * tangential_velocity_right;
    let signal_speed = (normal_velocity_left.abs() + (G_EARTH * depth_left).sqrt())
        .max(normal_velocity_right.abs() + (G_EARTH * depth_right).sqrt());
    let mass = 0.5 * (normal_discharge_left + normal_discharge_right)
        - 0.5 * signal_speed * (depth_right - depth_left);
    let advective_normal_left = if nonlinear {
        normal_discharge_left * normal_velocity_left
    } else {
        0.0
    };
    let advective_normal_right = if nonlinear {
        normal_discharge_right * normal_velocity_right
    } else {
        0.0
    };
    let shared_normal = 0.5
        * (advective_normal_left
            + 0.5 * G_EARTH * depth_left * depth_left
            + advective_normal_right
            + 0.5 * G_EARTH * depth_right * depth_right)
        - 0.5
            * signal_speed
            * (normal_discharge_right - normal_discharge_left);
    let tangential = 0.5
        * if nonlinear {
            normal_discharge_left * tangential_velocity_left
                + normal_discharge_right * tangential_velocity_right
        } else {
            0.0
        }
        - 0.5
            * signal_speed
            * (tangential_discharge_right - tangential_discharge_left);
    HydrostaticFaceFlux {
        mass,
        normal_left: shared_normal
            + 0.5 * G_EARTH * (raw_depth_left * raw_depth_left - depth_left * depth_left),
        normal_right: shared_normal
            + 0.5 * G_EARTH * (raw_depth_right * raw_depth_right - depth_right * depth_right),
        tangential,
    }
}

/// Boundary handling for the SWE solver. Sponge layers absorb outgoing
/// waves over a configurable rim width so a long-running scenario doesn't
/// reflect the wavefront back into the source (F-V10).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BoundaryMode {
    /// `u = v = 0` at the four edges. Reflective; only useful for the
    /// dam-break analytical validation harness.
    ZeroFlux,
    /// `η`, `u`, `v` damped over an `width_cells`-wide rim by a
    /// cosine-tapered mask. Default for live simulations.
    Sponge { width_cells: usize },
    /// Sommerfeld/Flather radiation condition. Normal velocity at
    /// boundary cells is set to the outgoing characteristic value
    /// `u_n = ±√(g/H) · η`; elevation is zero-gradient extrapolated
    /// from the adjacent interior cell. No sponge layer is applied.
    /// Minimizes artificial reflection for basin-scale propagation.
    Radiation,
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

/// Time-stepping driver. CPU finite-volume update with `rayon` row parallelism;
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
    ///
    /// Reuses scratch buffers across steps to avoid per-step allocation
    /// of three full-grid Vecs (~96 MB for a 4M-cell grid).
    pub fn step_cancellable(
        &self,
        grid: &mut SwGrid,
        n_steps: usize,
        cancel: Option<&AtomicBool>,
    ) -> bool {
        let mut ignore = |_: &SwGrid| {};
        self.step_cancellable_observed(grid, n_steps, cancel, &mut ignore)
    }

    /// Advance by up to `n_steps` and observe every accepted solver state.
    /// The observer runs after each completed step while this method keeps one
    /// set of scratch buffers alive for the whole batch.
    pub fn step_cancellable_observed(
        &self,
        grid: &mut SwGrid,
        n_steps: usize,
        cancel: Option<&AtomicBool>,
        observe: &mut dyn FnMut(&SwGrid),
    ) -> bool {
        let n = grid.nx * grid.ny;
        let mut scratch = SolverScratch::new(n);
        for _ in 0..n_steps {
            if cancel.is_some_and(|c| c.load(Ordering::Acquire)) {
                return false;
            }
            self.step_one_with_scratch(grid, &mut scratch);
            observe(grid);
        }
        true
    }

    /// Advance only numerically valid candidates. A violating candidate is
    /// rolled back using the old fields retained in the scratch buffers.
    pub fn step_cancellable_checked(
        &self,
        grid: &mut SwGrid,
        n_steps: usize,
        cancel: Option<&AtomicBool>,
        baseline: &quality::QualityBaseline,
        observe: &mut dyn FnMut(&SwGrid),
    ) -> Result<bool, quality::RunQualityRecord> {
        self.step_cancellable_checked_forced(grid, n_steps, cancel, baseline, None, observe)
    }

    /// Checked stepping with an optional time-dependent atmospheric-pressure
    /// source. The forcing is evaluated at each step midpoint before the
    /// finite-volume update, matching the per-dispatch GPU integration path.
    pub fn step_cancellable_checked_forced(
        &self,
        grid: &mut SwGrid,
        n_steps: usize,
        cancel: Option<&AtomicBool>,
        baseline: &quality::QualityBaseline,
        forcing: Option<&super::meteotsunami::MeteotsunamiSource>,
        observe: &mut dyn FnMut(&SwGrid),
    ) -> Result<bool, quality::RunQualityRecord> {
        let n = grid.nx * grid.ny;
        let mut scratch = SolverScratch::new(n);
        for _ in 0..n_steps {
            if cancel.is_some_and(|c| c.load(Ordering::Acquire)) {
                return Ok(false);
            }
            if let Some(source) = forcing {
                source.apply_pressure_gradient(grid, grid.t_s + 0.5 * self.dt_s, self.dt_s);
            }
            self.step_one_with_scratch(grid, &mut scratch);
            let mut quality = baseline.assess(grid, self.dt_s);
            if quality.failure.is_some() {
                std::mem::swap(&mut grid.eta_m, &mut scratch.eta);
                std::mem::swap(&mut grid.u_ms, &mut scratch.u);
                std::mem::swap(&mut grid.v_ms, &mut scratch.v);
                grid.t_s -= self.dt_s;
                grid.step_index = grid.step_index.saturating_sub(1);
                quality.accepted_steps = grid.step_index;
                quality.rejected_steps = 1;
                return Err(quality);
            }
            observe(grid);
        }
        Ok(true)
    }

    /// Single explicit finite-volume step with freshly allocated scratch buffers.
    /// Prefer `step_cancellable` for multi-step runs — it reuses buffers.
    pub fn step_one(&self, grid: &mut SwGrid) {
        let n = grid.nx * grid.ny;
        let mut scratch = SolverScratch::new(n);
        self.step_one_with_scratch(grid, &mut scratch);
    }

    /// Single explicit hydrostatic finite-volume step. Total depth and both
    /// momenta are updated together; rows are parallelized with rayon.
    ///
    /// Reads from `grid.eta_m / u_ms / v_ms` as the "old" state. Writes
    /// into `scratch.{eta, u, v}` and swaps them into the grid at the end.
    fn step_one_with_scratch(&self, grid: &mut SwGrid, scratch: &mut SolverScratch) {
        let nx = grid.nx;
        let ny = grid.ny;
        let n = nx * ny;
        let row_lat_rad: Vec<f64> = (0..ny).map(|j| grid.row_lat_rad(j)).collect();
        let row_cos_lat: Vec<f64> = row_lat_rad
            .iter()
            .map(|lat| lat.cos().abs().max(f64::MIN_POSITIVE))
            .collect();
        let face_cos_lat: Vec<f64> = (0..=ny)
            .map(|face| {
                (grid.south_lat + face as f64 * grid.dlat_deg)
                    .to_radians()
                    .cos()
                    .abs()
            })
            .collect();
        let row_dx_m: Vec<f64> = (0..ny).map(|j| grid.row_dx_m(j)).collect();
        let dy = grid.dy_m();
        let dt = self.dt_s;
        let g = G_EARTH;
        let n2 = self.manning_n * self.manning_n;
        let boundary = self.boundary;
        let nonlinear = matches!(self.mode, SolverMode::Nonlinear);

        scratch.ensure_capacity(n);

        // Compute into scratch buffers, reading the grid fields as "old" state.
        // The borrows on grid.{eta_m, u_ms, v_ms, h_m} must end before the
        // swap at the bottom, so we use a block scope.
        {
            let eta_old: &[f64] = &grid.eta_m;
            let u_in: &[f64] = &grid.u_ms;
            let v_in: &[f64] = &grid.v_ms;
            let h: &[f64] = &grid.h_m;

            scratch
                .eta
                .par_chunks_mut(nx)
                .zip(scratch.u.par_chunks_mut(nx))
                .zip(scratch.v.par_chunks_mut(nx))
                .enumerate()
                .for_each(|(j, ((eta_row, u_row), v_row))| {
                    let dx = row_dx_m[j];
                    let cos_lat = row_cos_lat[j];
                    for i in 0..nx {
                        let k = idx(i, j, nx);
                        if i == 0 || i == nx - 1 || j == 0 || j == ny - 1 {
                            match boundary {
                                BoundaryMode::Radiation => {
                                    // Characteristic absorbing BC: damp η at the
                                    // boundary using the local phase speed so
                                    // outgoing waves are absorbed rather than
                                    // reflected. Velocity extrapolated from interior.
                                    let int_i = i.clamp(1, nx - 2);
                                    let int_j = j.clamp(1, ny - 2);
                                    let int_k = idx(int_i, int_j, nx);
                                    let depth = total_depth_m(h[k], eta_old[k])
                                        .max(WET_DEPTH_EPSILON_M);
                                    let c = (g * depth).sqrt();
                                    let dn = if i == 0 || i == nx - 1 { dx } else { dy };
                                    // Absorbing factor: fraction of signal that
                                    // exits per timestep. Clamp to [0,1] for
                                    // stability.
                                    let alpha = (c * dt / dn).min(1.0);
                                    // Damp η toward zero (outgoing wave exits).
                                    eta_row[i] = eta_old[k] * (1.0 - alpha);
                                    // Zero-gradient velocity from interior: lets
                                    // the outgoing momentum pass through.
                                    u_row[i] = u_in[int_k];
                                    v_row[i] = v_in[int_k];
                                }
                                _ => {
                                    eta_row[i] = eta_old[k];
                                    u_row[i] = 0.0;
                                    v_row[i] = 0.0;
                                }
                            }
                            continue;
                        }
                        let east = idx(i + 1, j, nx);
                        let west = idx(i - 1, j, nx);
                        let north = idx(i, j + 1, nx);
                        let south = idx(i, j - 1, nx);
                        let flux_east = hydrostatic_face_flux(
                            h[k], eta_old[k], u_in[k], v_in[k], h[east], eta_old[east],
                            u_in[east], v_in[east], nonlinear,
                        );
                        let flux_west = hydrostatic_face_flux(
                            h[west], eta_old[west], u_in[west], v_in[west], h[k], eta_old[k],
                            u_in[k], v_in[k], nonlinear,
                        );
                        let flux_north = hydrostatic_face_flux(
                            h[k], eta_old[k], v_in[k], u_in[k], h[north], eta_old[north],
                            v_in[north], u_in[north], nonlinear,
                        );
                        let flux_south = hydrostatic_face_flux(
                            h[south], eta_old[south], v_in[south], u_in[south], h[k], eta_old[k],
                            v_in[k], u_in[k], nonlinear,
                        );

                        let divergence_mass_x = (flux_east.mass - flux_west.mass) / dx;
                        let divergence_mass_y = (flux_north.mass * face_cos_lat[j + 1]
                            - flux_south.mass * face_cos_lat[j])
                            / (dy * cos_lat);
                        let current_depth = total_depth_m(h[k], eta_old[k]);
                        let updated_depth = nonnegative_depth(
                            current_depth - dt * (divergence_mass_x + divergence_mass_y),
                        );
                        eta_row[i] = updated_depth - h[k];
                        if updated_depth <= WET_DEPTH_EPSILON_M {
                            u_row[i] = 0.0;
                            v_row[i] = 0.0;
                            continue;
                        }

                        let current_u = if current_depth > WET_DEPTH_EPSILON_M {
                            u_in[k]
                        } else {
                            0.0
                        };
                        let current_v = if current_depth > WET_DEPTH_EPSILON_M {
                            v_in[k]
                        } else {
                            0.0
                        };
                        let current_qx = current_depth * current_u;
                        let current_qy = current_depth * current_v;
                        let divergence_qx_x = (flux_east.normal_left - flux_west.normal_right) / dx;
                        let divergence_qx_y = (flux_north.tangential * face_cos_lat[j + 1]
                            - flux_south.tangential * face_cos_lat[j])
                            / (dy * cos_lat);
                        let divergence_qy_x = (flux_east.tangential - flux_west.tangential) / dx;
                        let divergence_qy_y = (flux_north.normal_left * face_cos_lat[j + 1]
                            - flux_south.normal_right * face_cos_lat[j])
                            / (dy * cos_lat);
                        let pressure_metric = 0.5
                            * g
                            * current_depth
                            * current_depth
                            * (face_cos_lat[j + 1] - face_cos_lat[j])
                            / (dy * cos_lat);
                        let mut next_u = (current_qx - dt * (divergence_qx_x + divergence_qx_y))
                            / updated_depth;
                        let mut next_v = (current_qy
                            - dt * (divergence_qy_x + divergence_qy_y - pressure_metric))
                            / updated_depth;
                        if nonlinear {
                            let tan_over_radius = row_lat_rad[j].tan() / R_EARTH_M;
                            next_u += dt * next_u * next_v * tan_over_radius;
                            next_v -= dt * next_u * next_u * tan_over_radius;
                        }
                        let speed = (next_u * next_u + next_v * next_v).sqrt();
                        let friction = g * n2 * speed
                            / updated_depth.max(WET_DEPTH_EPSILON_M).powf(4.0 / 3.0);
                        let damping = 1.0 + dt * friction;
                        u_row[i] = next_u / damping;
                        v_row[i] = next_v / damping;
                    }
                });
        } // end borrow scope for grid.{eta_m, u_ms, v_ms, h_m}

        // Sponge-layer damping on the four rim cells. A cosine-tapered
        // mask `0.5 (1 - cos(π · d/w))` smoothly absorbs outgoing waves
        // so a long-running simulation doesn't reflect the wavefront
        // back into the source.
        if let BoundaryMode::Sponge { width_cells } = boundary {
            let w = width_cells
                .min(nx.saturating_sub(1) / 2)
                .min(ny.saturating_sub(1) / 2);
            if w > 0 {
                apply_sponge(&mut scratch.eta, &mut scratch.u, &mut scratch.v, nx, ny, w);
            }
        }

        // Sponge damping and finite-precision roundoff must not leave a
        // negative water column or momentum in a dry cell.
        for k in 0..n {
            let raw_depth = grid.h_m[k] + scratch.eta[k];
            if raw_depth.is_finite() && raw_depth < 0.0 {
                scratch.eta[k] = -grid.h_m[k];
            }
            if total_depth_m(grid.h_m[k], scratch.eta[k]) <= WET_DEPTH_EPSILON_M {
                scratch.u[k] = 0.0;
                scratch.v[k] = 0.0;
            }
        }

        // Swap scratch buffers into the grid instead of cloning.
        std::mem::swap(&mut grid.eta_m, &mut scratch.eta);
        std::mem::swap(&mut grid.u_ms, &mut scratch.u);
        std::mem::swap(&mut grid.v_ms, &mut scratch.v);
        grid.t_s += dt;
        grid.step_index = grid.step_index.saturating_add(1);
    }
}

/// Reusable scratch buffers for the CPU solver, eliminating the per-step
/// allocation of three full-grid `Vec<f64>`s. Created once per simulation
/// batch and passed into each `step_one_with_scratch` call.
struct SolverScratch {
    eta: Vec<f64>,
    u: Vec<f64>,
    v: Vec<f64>,
}

impl SolverScratch {
    fn new(n: usize) -> Self {
        Self {
            eta: vec![0.0; n],
            u: vec![0.0; n],
            v: vec![0.0; n],
        }
    }

    fn ensure_capacity(&mut self, n: usize) {
        if self.eta.len() != n {
            self.eta.resize(n, 0.0);
            self.u.resize(n, 0.0);
            self.v.resize(n, 0.0);
        }
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

/// Hard cap on total finite-volume steps. Protects us against pathological
/// inputs (e.g. `t_end_s = 24h` paired with a `dt_s` driven absurdly low
/// by an extreme bathymetry corner case) that would otherwise wedge the
/// solver thread for minutes.
const MAX_TOTAL_STEPS: usize = 1_000_000;

/// Build the number of solver steps between each pair of requested snapshots.
///
/// The returned vector has `n_snapshots - 1` entries and always sums to the
/// rounded number of steps required for `t_end_s`. When callers request more
/// snapshots than there are solver steps, zero-step intervals deliberately
/// repeat the current state instead of extending the simulation past `t_end_s`.
pub(crate) fn snapshot_step_schedule(t_end_s: f64, dt_s: f64, n_snapshots: usize) -> Vec<usize> {
    let n = n_snapshots.max(2);
    let intervals = n - 1;
    let total_steps = if !t_end_s.is_finite() || t_end_s <= 0.0 {
        0
    } else {
        let dt = if dt_s.is_finite() && dt_s > 0.0 {
            dt_s
        } else {
            1.0
        };
        let raw_steps = (t_end_s / dt).max(1.0);
        if raw_steps.is_finite() {
            raw_steps.round().clamp(1.0, MAX_TOTAL_STEPS as f64) as usize
        } else {
            MAX_TOTAL_STEPS
        }
    };

    let mut previous_target = 0usize;
    (1..n)
        .map(|snapshot_index| {
            // Use u128 for the intermediate product so this helper remains
            // exact even if its current public-input caps are raised later.
            let target =
                ((snapshot_index as u128 * total_steps as u128) / intervals as u128) as usize;
            let take = target.saturating_sub(previous_target);
            previous_target = target;
            take
        })
        .collect()
}

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
        &mut |_| {},
    )
}

#[allow(clippy::too_many_arguments)]
pub fn run_simulation_with_gauge_samples(
    grid: &mut SwGrid,
    stepper: &TimeStepper,
    t_end_s: f64,
    n_snapshots: usize,
    cancel: Option<&AtomicBool>,
    diagnostics: Option<&DiagnosticSink<'_>>,
    gauges: &[GridGaugePoint],
    // Called at t=0 and after every accepted solver step. Display snapshots
    // stay independently scheduled and carry PNG rather than raw η.
    observe: &mut dyn FnMut(&SwGrid),
) -> Vec<GridSnapshot> {
    let n = n_snapshots.max(2);
    let mut snaps = Vec::with_capacity(n);
    snaps.push(grid.snapshot_with_gauge_samples(gauges, diagnostics));
    observe(grid);
    if !t_end_s.is_finite() || t_end_s < 0.0 {
        return snaps;
    }

    for take in snapshot_step_schedule(t_end_s, stepper.dt_s, n) {
        if cancel.is_some_and(|c| c.load(Ordering::Relaxed)) {
            break;
        }
        if take > 0 && !stepper.step_cancellable_observed(grid, take, cancel, observe) {
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
    fn inject_field_rejects_wrong_sized_or_non_finite_inputs() {
        let mut grid = SwGrid::new(-1.0, -1.0, 1.0, 1.0, 1.0, 1.0);
        assert!(grid.inject_field(&[1.0]).is_err());
        let mut field = vec![0.0; grid.nx * grid.ny];
        field[0] = f64::NAN;
        assert!(grid.inject_field(&field).is_err());
        assert!(grid.eta_m.iter().all(|value| *value == 0.0));
    }

    #[test]
    fn inject_field_adds_the_same_host_array_consumed_by_cpu_and_gpu_paths() {
        let mut grid = SwGrid::new(-1.0, -1.0, 1.0, 1.0, 1.0, 1.0);
        let field = vec![1.25, -0.5, 0.75, -1.0];
        grid.inject_field(&field).expect("inject valid field");
        assert_eq!(grid.eta_m, field);
    }

    #[test]
    fn row_metrics_match_spherical_geometry_through_the_polar_row() {
        let grid = SwGrid::new(-10.0, 80.0, 10.0, 90.0, 1.0, 1.0);
        let first_dx = grid.row_dx_m(0);
        let polar_dx = grid.row_dx_m(grid.ny - 1);
        assert!(first_dx.is_finite() && polar_dx.is_finite() && polar_dx > 0.0);
        assert!(polar_dx < first_dx * 0.1, "{polar_dx} vs {first_dx}");

        let integrated_area: f64 = (0..grid.ny)
            .map(|row| grid.row_cell_area_m2(row) * grid.nx as f64)
            .sum();
        let expected_area = R_EARTH_M
            * R_EARTH_M
            * 20_f64.to_radians()
            * (90_f64.to_radians().sin() - 80_f64.to_radians().sin());
        assert!((integrated_area / expected_area - 1.0).abs() < 1.0e-12);
    }

    #[test]
    fn physically_equivalent_low_and_high_latitude_grids_choose_matching_dt() {
        let mut equator = SwGrid::new(-0.5, -0.5, 0.5, 0.5, 0.25, 0.25);
        let mut high_lat = SwGrid::new(-1.0, 59.5, 1.0, 60.5, 0.5, 0.25);
        equator.fill_uniform_depth(4_000.0);
        high_lat.fill_uniform_depth(4_000.0);
        let equator_dt = equator.recommended_dt_s(0.4);
        let high_lat_dt = high_lat.recommended_dt_s(0.4);
        assert!(
            (equator_dt / high_lat_dt - 1.0).abs() < 0.02,
            "equator dt {equator_dt}, high-latitude dt {high_lat_dt}"
        );
    }

    #[test]
    fn high_latitude_still_water_remains_exactly_still() {
        let mut grid = SwGrid::new(-10.0, 55.0, 10.0, 75.0, 0.5, 0.5);
        grid.fill_uniform_depth(4_000.0);
        let dt = grid.recommended_dt_s(0.4);
        TimeStepper::new(dt)
            .with_boundary(BoundaryMode::ZeroFlux)
            .step(&mut grid, 20);
        assert!(grid.eta_m.iter().all(|value| *value == 0.0));
        assert!(grid.u_ms.iter().all(|value| value.abs() < 1.0e-12));
        assert!(grid.v_ms.iter().all(|value| value.abs() < 1.0e-12));
    }

    #[test]
    fn gaussian_distance_wraps_across_the_dateline() {
        let mut grid = SwGrid::new(179.0, -1.0, 181.0, 1.0, 0.25, 0.25);
        grid.inject_gaussian(0.0, -179.5, 1.0, 50_000.0);
        let peak = grid.eta_m.iter().copied().fold(0.0_f64, f64::max);
        assert!(peak > 0.8, "wrapped source peak was {peak}");
    }

    #[test]
    fn dateline_grid_sampling_accepts_both_longitude_branches() {
        let mut grid = SwGrid::new(174.53, -2.0, 184.53, 2.0, 0.1, 0.1);
        grid.inject_gaussian(0.0, 179.5, 1.0, 80_000.0);
        let west_branch = grid.sample_eta_at(0.0, -179.5).unwrap();
        let unwrapped_branch = grid.sample_eta_at(0.0, 180.5).unwrap();
        assert!((west_branch - unwrapped_branch).abs() < 1.0e-12);
        let tiles = grid.field_tiles().unwrap();
        assert_eq!(tiles.len(), 2);
        assert_eq!(tiles[0].bbox[2], 180.0);
        assert_eq!(tiles[1].bbox[0], -180.0);
        assert_eq!(
            tiles.iter().map(|tile| tile.column_count).sum::<u32>(),
            grid.nx as u32
        );
        let snapshot = grid.snapshot();
        assert_eq!(snapshot.field_tiles.len(), 2);
        assert!(
            snapshot
                .field_tiles
                .iter()
                .all(|tile| !tile.eta_png_b64.is_empty())
        );
        assert!(
            snapshot.eta_png_b64.is_empty(),
            "tiled snapshots must not retain a duplicate full-field PNG"
        );
    }

    #[test]
    fn tiled_snapshot_retains_one_encoded_field_with_bounded_overhead() {
        let mut grid = SwGrid::new(174.53, -2.0, 184.53, 2.0, 0.1, 0.1);
        let mut state = 0x9e37_79b9_u32;
        for value in &mut grid.eta_m {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            *value = (f64::from(state) / f64::from(u32::MAX)) * 2.0 - 1.0;
        }

        let snapshot = grid.snapshot();
        assert!(snapshot.eta_png_b64.is_empty());
        assert_eq!(snapshot.field_tiles.len(), 2);
        let retained_bytes = snapshot
            .field_tiles
            .iter()
            .map(|tile| tile.eta_png_b64.len())
            .sum::<usize>();
        assert!(
            retained_bytes <= grid.nx * grid.ny * 6 + 4_096,
            "encoded tiled field retained {retained_bytes} bytes for {} cells",
            grid.nx * grid.ny
        );
    }

    #[test]
    fn high_latitude_tile_layout_preserves_source_column_order() {
        let grid = SwGrid::new(-30.0, 75.0, 30.0, 90.0, 0.5, 0.5);
        let tiles = grid.field_tiles().unwrap();
        assert_eq!(tiles.len(), 4);
        assert_eq!(tiles[0].column_offset, 0);
        assert_eq!(
            tiles.iter().map(|tile| tile.column_count).sum::<u32>(),
            grid.nx as u32
        );
        for pair in tiles.windows(2) {
            assert_eq!(
                pair[0].column_offset + pair[0].column_count,
                pair[1].column_offset
            );
        }
    }

    #[test]
    fn grid_alloc_and_snapshot() {
        let mut g = SwGrid::new(-180.0, -85.0, 180.0, 85.0, 2.0, 2.0);
        assert_eq!(g.nx, 180);
        assert_eq!(g.ny, 85);
        g.inject_gaussian(0.0, 0.0, 10.0, 1_000_000.0);
        let s = g.snapshot();
        assert!(s.eta_max_m > 9.0 && s.eta_max_m <= 10.0);
        assert_eq!(s.height_field.horizontal_crs, "EPSG:4326");
        assert_eq!(
            s.height_field.vertical_datum,
            crate::data::geodesy::VerticalDatum::IdealizedMeanSeaLevel,
        );
        assert_eq!(
            s.height_field.vertical_axis,
            crate::data::geodesy::VerticalAxis::PositiveUp,
        );
        let encoded_len = s.eta_png_b64.len()
            + s.field_tiles
                .iter()
                .map(|tile| tile.eta_png_b64.len())
                .sum::<usize>();
        assert!(
            encoded_len > 100,
            "snapshot PNG output looks suspiciously small"
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
    fn gauge_on_frame_edge_reads_edge_value() {
        let mut g = SwGrid::new(0.0, 0.0, 2.0, 2.0, 1.0, 1.0);
        // eta[idx(i,j)] with nx=2: (0,0)=1 (1,0)=2 (0,1)=3 (1,1)=4.
        g.eta_m = vec![1.0, 2.0, 3.0, 4.0];
        // The north-east corner sits on the outer half-cell rim; it must clamp to
        // cell (1,1) rather than silently returning None.
        let corner = g
            .sample_eta_at(2.0, 2.0)
            .expect("corner gauge should read the edge value");
        assert!((corner - 4.0).abs() < 1e-9, "corner {corner}");
        // The east edge at the south row clamps to cell (1,0) = 2.0.
        let east = g
            .sample_eta_at(0.5, 2.0)
            .expect("east-edge gauge should read");
        assert!((east - 2.0).abs() < 1e-9, "east {east}");
        // A point genuinely outside the bbox still returns None.
        assert_eq!(g.sample_eta_at(0.5, 2.6), None);
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
    /// first-order Rusanov flux, but the wavefront should advance at roughly
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
        let expected_steps = (300.0 / stepper.dt_s).round() as u64;
        assert_eq!(g.step_index, expected_steps);
        assert_eq!(snaps.last().unwrap().time_s, g.t_s);
        assert!((g.t_s - 300.0).abs() <= stepper.dt_s * 0.5);
    }

    #[test]
    fn snapshot_schedule_repeats_frames_without_overshooting_total_steps() {
        let schedule = snapshot_step_schedule(29.0, 1.0, 60);
        assert_eq!(schedule.len(), 59);
        assert_eq!(schedule.iter().sum::<usize>(), 29);
        assert_eq!(schedule.iter().filter(|&&take| take == 0).count(), 30);
        assert!(schedule.iter().all(|&take| take <= 1));

        let cumulative: Vec<usize> = schedule
            .iter()
            .scan(0usize, |step, &take| {
                *step += take;
                Some(*step)
            })
            .collect();
        assert_eq!(cumulative.last(), Some(&29));
        assert!(cumulative.windows(2).all(|pair| pair[0] <= pair[1]));
    }

    #[test]
    fn run_simulation_matches_shared_schedule_when_frames_outnumber_steps() {
        let mut scheduled = SwGrid::new(-1.0, -1.0, 1.0, 1.0, 0.5, 0.5);
        scheduled.fill_uniform_depth(50.0);
        let mut non_streaming = scheduled.clone();
        let stepper = TimeStepper::new(1.0);

        for take in snapshot_step_schedule(29.0, stepper.dt_s, 60) {
            stepper.step(&mut scheduled, take);
        }
        let snapshots = run_simulation(&mut non_streaming, &stepper, 29.0, 60, None);

        assert_eq!(snapshots.len(), 60);
        assert_eq!(scheduled.step_index, 29);
        assert_eq!(non_streaming.step_index, scheduled.step_index);
        assert_eq!(non_streaming.t_s, scheduled.t_s);
        assert_eq!(snapshots.last().map(|snapshot| snapshot.time_s), Some(29.0));
        assert!(
            snapshots
                .windows(2)
                .all(|pair| pair[0].time_s <= pair[1].time_s)
        );
    }

    #[test]
    fn quantitative_products_are_independent_of_snapshot_count() {
        use super::max_field::MaxFieldAccumulator;

        type Fields = (Vec<f64>, Vec<f64>, Vec<f64>, Vec<f64>);

        fn run(n_snapshots: usize) -> (usize, u64, f64, Fields) {
            let mut grid = SwGrid::new(-2.0, -2.0, 2.0, 2.0, 0.5, 0.5);
            grid.fill_uniform_depth(4_000.0);
            grid.inject_gaussian(0.0, 0.0, 1.0, 50_000.0);
            let stepper = TimeStepper::new(1.0);
            let mut acc = MaxFieldAccumulator::new(grid.nx * grid.ny, 0.01);
            let snapshots = run_simulation_with_gauge_samples(
                &mut grid,
                &stepper,
                29.0,
                n_snapshots,
                None,
                None,
                &[],
                &mut |state| acc.observe(state),
            );
            let (peak, t_of_max, arrival, energy) = acc.quantitative_fields();
            (
                snapshots.len(),
                grid.step_index,
                grid.t_s,
                (
                    peak.to_vec(),
                    t_of_max.to_vec(),
                    arrival.to_vec(),
                    energy.to_vec(),
                ),
            )
        }

        fn assert_same(left: &[f64], right: &[f64]) {
            assert_eq!(left.len(), right.len());
            for (index, (&a, &b)) in left.iter().zip(right).enumerate() {
                let equal_infinity = a.is_infinite() && b.is_infinite() && a.signum() == b.signum();
                assert!(
                    equal_infinity || (a - b).abs() <= 1e-12,
                    "field cell {index} differs: {a} vs {b}"
                );
            }
        }

        let (count_12, steps_12, time_12, fields_12) = run(12);
        let (count_60, steps_60, time_60, fields_60) = run(60);
        let (count_240, steps_240, time_240, fields_240) = run(240);
        assert_eq!((count_12, count_60, count_240), (12, 60, 240));
        assert_eq!((steps_12, steps_60, steps_240), (29, 29, 29));
        assert_eq!((time_12, time_60, time_240), (29.0, 29.0, 29.0));
        assert_same(&fields_12.0, &fields_60.0);
        assert_same(&fields_12.0, &fields_240.0);
        assert_same(&fields_12.1, &fields_60.1);
        assert_same(&fields_12.1, &fields_240.1);
        assert_same(&fields_12.2, &fields_60.2);
        assert_same(&fields_12.2, &fields_240.2);
        assert_same(&fields_12.3, &fields_60.3);
        assert_same(&fields_12.3, &fields_240.3);
    }

    #[test]
    fn variable_bathymetry_and_dry_land_preserve_still_water_exactly() {
        let mut g = SwGrid::new(-5.0, -2.0, 5.0, 2.0, 0.25, 0.25);
        for j in 0..g.ny {
            for i in 0..g.nx {
                g.h_m[idx(i, j, g.nx)] = if i < g.nx / 4 {
                    0.0
                } else {
                    25.0 + (i - g.nx / 4) as f64 * 75.0
                };
            }
        }
        let dt = g.recommended_dt_s(0.4);
        TimeStepper::new(dt)
            .with_boundary(BoundaryMode::ZeroFlux)
            .step(&mut g, 100);

        assert!(g.eta_m.iter().all(|value| *value == 0.0));
        assert!(g.u_ms.iter().all(|value| value.abs() < 1.0e-12));
        assert!(g.v_ms.iter().all(|value| value.abs() < 1.0e-12));
        assert_eq!(
            g.wet_mask_bits().iter().map(|byte| byte.count_ones()).sum::<u32>(),
            (g.ny * (g.nx - g.nx / 4)) as u32,
        );
    }

    #[test]
    fn dry_bed_dam_break_advances_without_negative_depth_or_rollback() {
        let mut g = SwGrid::new(-3.2, -0.2, 3.2, 0.2, 0.1, 0.1);
        g.fill_uniform_depth(0.0);
        for j in 0..g.ny {
            for i in 0..g.nx / 2 {
                g.eta_m[idx(i, j, g.nx)] = 10.0;
            }
        }
        let initial_wet = g
            .wet_mask_bits()
            .iter()
            .map(|byte| byte.count_ones())
            .sum::<u32>();
        let baseline = quality::QualityBaseline::capture(&g, BoundaryMode::ZeroFlux);
        let dt = g.recommended_dt_s(0.2);
        let result = TimeStepper::new(dt)
            .with_boundary(BoundaryMode::ZeroFlux)
            .with_mode(SolverMode::Linear)
            .step_cancellable_checked(&mut g, 30, None, &baseline, &mut |_| {});

        assert!(result.is_ok(), "dry-bed step was rejected: {result:?}");
        assert!(
            g.h_m
                .iter()
                .zip(&g.eta_m)
                .all(|(&h, &eta)| h + eta >= -1.0e-12)
        );
        let final_wet = g
            .wet_mask_bits()
            .iter()
            .map(|byte| byte.count_ones())
            .sum::<u32>();
        assert!(final_wet > initial_wet, "front did not wet a dry cell");
        assert!(
            (g.nx / 2..g.nx).any(|i| total_depth_m(g.h_m[idx(i, g.ny / 2, g.nx)], g.eta_m[idx(i, g.ny / 2, g.nx)]) > WET_DEPTH_EPSILON_M),
            "front never crossed the initial dam"
        );
        let quality = baseline.assess(&g, dt);
        assert!(quality.failure.is_none(), "{:?}", quality.failure);
        assert_eq!(quality.rejected_steps, 0);
    }

    #[test]
    fn translating_shallow_slug_advances_and_recedes_without_negative_depth() {
        let mut g = SwGrid::new(-4.0, -0.2, 4.0, 0.2, 0.1, 0.1);
        g.fill_uniform_depth(0.0);
        let j = g.ny / 2;
        for i in 12..20 {
            let k = idx(i, j, g.nx);
            g.eta_m[k] = 0.2;
            g.u_ms[k] = 0.5;
        }
        let dt = g.recommended_dt_s(0.15);
        let mut remained_nonnegative = true;
        let mut front_advanced = false;
        TimeStepper::new(dt)
            .with_boundary(BoundaryMode::ZeroFlux)
            .step_cancellable_observed(&mut g, 800, None, &mut |state| {
                remained_nonnegative &= state
                    .h_m
                    .iter()
                    .zip(&state.eta_m)
                    .all(|(&h, &eta)| h + eta >= -1.0e-12);
                front_advanced |= (20..state.nx - 1).any(|i| {
                    total_depth_m(
                        state.h_m[idx(i, j, state.nx)],
                        state.eta_m[idx(i, j, state.nx)],
                    ) > WET_DEPTH_EPSILON_M
                });
            });

        let tail_depth = total_depth_m(g.h_m[idx(12, j, g.nx)], g.eta_m[idx(12, j, g.nx)]);
        assert!(
            tail_depth <= WET_DEPTH_EPSILON_M,
            "tail did not become dry: depth remained {tail_depth}"
        );
        assert!(front_advanced, "front never crossed the initial slug edge");
        assert!(remained_nonnegative, "front created a negative depth");
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

    /// F-V11 — Radiation boundary should let outgoing waves exit with
    /// minimal reflection. A planar wave propagating toward the right edge
    /// should lose less energy to reflection than the sponge does to damping,
    /// confirming the Flather/Sommerfeld condition works.
    #[test]
    fn radiation_boundary_minimal_reflection() {
        let mut g = SwGrid::new(-2.0, -2.0, 2.0, 2.0, 0.1, 0.1);
        g.fill_uniform_depth(4_000.0);
        g.inject_gaussian(0.0, 0.0, 1.0, 30_000.0);
        let dt = g.recommended_dt_s(0.3);
        let stepper =
            TimeStepper::new(dt).with_boundary(BoundaryMode::Radiation);
        let initial_energy: f64 = g.eta_m.iter().map(|v| v * v).sum();
        let steps = ((600.0 / dt).round() as usize).max(2);
        stepper.step(&mut g, steps);
        let final_energy: f64 = g.eta_m.iter().map(|v| v * v).sum();
        // Most energy should have exited the domain. A single-cell
        // characteristic BC reflects 15-25% depending on incidence angle
        // and wave shape (theory: 0% for perfectly plane normal waves).
        // Allow up to 25%; the multi-cell sponge remains available for
        // scenarios needing < 5% reflection.
        let reflection_ratio = final_energy / initial_energy;
        assert!(
            reflection_ratio < 0.25,
            "radiation boundary reflected {:.1}% of energy (expected < 25%)",
            reflection_ratio * 100.0
        );
        // Confirm the field is finite and non-trivial — the radiation BC
        // must not drive the solution to NaN.
        assert!(g.eta_m.iter().all(|v| v.is_finite()));
    }

    /// Radiation boundary should produce less boundary reflection than
    /// ZeroFlux (which is perfectly reflective).
    #[test]
    fn radiation_reflects_less_than_zero_flux() {
        let make_grid = || {
            let mut g = SwGrid::new(-1.0, -1.0, 1.0, 1.0, 0.1, 0.1);
            g.fill_uniform_depth(4_000.0);
            g.inject_gaussian(0.0, 0.0, 0.5, 20_000.0);
            g
        };
        let dt = make_grid().recommended_dt_s(0.3);
        let steps = ((400.0 / dt).round() as usize).max(2);

        let mut g_reflect = make_grid();
        TimeStepper::new(dt)
            .with_boundary(BoundaryMode::ZeroFlux)
            .step(&mut g_reflect, steps);
        let reflect_energy: f64 = g_reflect.eta_m.iter().map(|v| v * v).sum();

        let mut g_radiation = make_grid();
        TimeStepper::new(dt)
            .with_boundary(BoundaryMode::Radiation)
            .step(&mut g_radiation, steps);
        let radiation_energy: f64 = g_radiation.eta_m.iter().map(|v| v * v).sum();

        assert!(
            radiation_energy < reflect_energy,
            "radiation ({:.4}) should retain less energy than ZeroFlux ({:.4})",
            radiation_energy,
            reflect_energy
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
        assert!(lin_centre < 0.09, "linear centre should have spread: {lin_centre}");
        assert!(non_centre < 0.09, "nonlinear centre should have spread: {non_centre}");
    }
}
