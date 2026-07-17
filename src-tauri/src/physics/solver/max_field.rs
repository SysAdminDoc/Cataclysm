//! Maximum-field products accumulated across a simulation run.
//!
//! GeoClaw calls these `fgmax` products: per-cell peak amplitude, the time
//! that peak occurred, first-arrival time, and a time-integrated η² energy
//! proxy (a qualitative RIFT-style directivity map, not a calibrated PTWC
//! energy product). Fields are sampled after every accepted solver step on
//! both CPU and GPU, independently of the display-snapshot cadence.

use serde::Serialize;

use super::{
    Colormap, DiagnosticSink, SwGrid, cividis_colormap, diverging_colormap, encode_rgba_png, idx,
    report_diagnostic, viridis_colormap,
};

/// One contour line set at a fixed arrival time.
#[derive(Debug, Clone, Serialize)]
pub struct Isochrone {
    pub time_s: f64,
    /// Polylines as `[lon_deg, lat_deg]` vertex lists.
    pub lines: Vec<Vec<[f64; 2]>>,
}

/// Final max-field product, serialised to the frontend alongside the
/// snapshot metadata at the end of a run.
#[derive(Debug, Clone, Serialize)]
pub struct MaxFieldProduct {
    pub bbox: [f64; 4],
    pub nx: u32,
    pub ny: u32,
    /// CRS/datum/unit/error contract for the peak-amplitude height field.
    pub peak_height_field: crate::data::geodesy::HeightFieldMetadata,
    /// Global maximum |η| over the whole run (m).
    pub peak_abs_max_m: f64,
    /// Simulated time of the final observation (s).
    pub t_end_s: f64,
    /// |η| threshold used for first-arrival detection (m).
    pub arrival_threshold_m: f64,
    /// Peak |η| per cell, rendered with the run's colormap (positive ramp).
    /// Empty when `field_tiles` carries a wrapped/polar field.
    pub peak_png_b64: String,
    /// Time of the per-cell peak, viridis-mapped over [0, t_end]. Empty for a
    /// tiled field.
    pub t_of_max_png_b64: String,
    /// Time-integrated η² (qualitative energy/directivity), sqrt-normalised.
    /// Empty for a tiled field.
    pub energy_png_b64: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub field_tiles: Vec<MaxFieldTile>,
    /// First-arrival isochrones at regular intervals.
    pub isochrones: Vec<Isochrone>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MaxFieldTile {
    pub column_offset: u32,
    pub column_count: u32,
    pub bbox: [f64; 4],
    pub peak_png_b64: String,
    pub t_of_max_png_b64: String,
    pub energy_png_b64: String,
}

/// Running accumulator. Feed it the grid at t=0 and after every accepted
/// solver step via [`observe`], then convert with [`into_product`].
///
/// [`observe`]: MaxFieldAccumulator::observe
/// [`into_product`]: MaxFieldAccumulator::into_product
#[derive(Debug)]
pub struct MaxFieldAccumulator {
    peak_m: Vec<f64>,
    t_of_max_s: Vec<f64>,
    arrival_s: Vec<f64>,
    energy_m2s: Vec<f64>,
    last_t_s: f64,
    arrival_threshold_m: f64,
    observed: bool,
}

impl MaxFieldAccumulator {
    /// `arrival_threshold_m` — |η| level that counts as "the wave arrived".
    /// Callers derive it from the source amplitude (1% with a 1 cm floor).
    pub fn new(n_cells: usize, arrival_threshold_m: f64) -> Self {
        Self {
            peak_m: vec![0.0; n_cells],
            t_of_max_s: vec![0.0; n_cells],
            arrival_s: vec![f64::INFINITY; n_cells],
            energy_m2s: vec![0.0; n_cells],
            last_t_s: 0.0,
            arrival_threshold_m: arrival_threshold_m.max(1e-6),
            observed: false,
        }
    }

    /// Threshold helper shared by both simulate commands.
    pub fn threshold_for_amplitude(initial_amplitude_m: f64) -> f64 {
        (0.01 * initial_amplitude_m.abs()).max(0.01)
    }

    /// Record the grid state at its current `t_s`.
    pub fn observe(&mut self, grid: &SwGrid) {
        let n = grid.nx * grid.ny;
        if n != self.peak_m.len() {
            return; // Grid shape changed — never expected; refuse quietly.
        }
        let dt = if self.observed {
            (grid.t_s - self.last_t_s).max(0.0)
        } else {
            0.0
        };
        for (k, &eta) in grid.eta_m.iter().enumerate() {
            if !eta.is_finite() {
                continue;
            }
            let a = eta.abs();
            if a > self.peak_m[k] {
                self.peak_m[k] = a;
                self.t_of_max_s[k] = grid.t_s;
            }
            if a >= self.arrival_threshold_m && self.arrival_s[k].is_infinite() {
                self.arrival_s[k] = grid.t_s;
            }
            // Rectangle-rule ∫ η² dt at solver-step cadence.
            self.energy_m2s[k] += eta * eta * dt;
        }
        self.last_t_s = grid.t_s;
        self.observed = true;
    }

    #[cfg(test)]
    pub(crate) fn quantitative_fields(&self) -> (&[f64], &[f64], &[f64], &[f64]) {
        (
            &self.peak_m,
            &self.t_of_max_s,
            &self.arrival_s,
            &self.energy_m2s,
        )
    }

    /// Render the accumulated fields. `grid` supplies geometry + colormap.
    pub fn into_product(
        self,
        grid: &SwGrid,
        diagnostics: Option<&DiagnosticSink<'_>>,
    ) -> MaxFieldProduct {
        let nx = grid.nx;
        let ny = grid.ny;
        let t_end = self.last_t_s.max(1e-9);
        let peak_max = self.peak_m.iter().cloned().fold(0.0_f64, f64::max);
        let energy_max = self.energy_m2s.iter().cloned().fold(0.0_f64, f64::max);

        let colormap = grid.colormap;
        // Time-of-max only means something where a wave actually peaked;
        // mask cells that never exceeded 5% of the global peak.
        let t_mask = 0.05 * peak_max;
        let t_of_max_rgba: Vec<f64> = self
            .t_of_max_s
            .iter()
            .zip(self.peak_m.iter())
            .map(|(&t, &p)| if p >= t_mask && p > 0.0 { t } else { f64::NAN })
            .collect();
        let tile_layouts = match grid.field_tiles() {
            Ok(layouts) => layouts,
            Err(error) => {
                report_diagnostic(diagnostics, format!("SWE max-field tiling failed: {error}"));
                Vec::new()
            }
        };
        let (peak_png, t_of_max_png, energy_png, field_tiles) = if tile_layouts.len() > 1 {
            let field_tiles = tile_layouts
                .into_iter()
                .map(|tile| MaxFieldTile {
                    peak_png_b64: render_field_columns(
                        nx,
                        ny,
                        tile.column_offset as usize,
                        tile.column_count as usize,
                        &self.peak_m,
                        peak_max.max(1e-9),
                        |t| colormap_positive(colormap, t),
                    ),
                    t_of_max_png_b64: render_field_columns(
                        nx,
                        ny,
                        tile.column_offset as usize,
                        tile.column_count as usize,
                        &t_of_max_rgba,
                        t_end,
                        |t| {
                            let (r, g, b, _) = viridis_colormap(t);
                            (r, g, b, 210)
                        },
                    ),
                    energy_png_b64: render_field_columns(
                        nx,
                        ny,
                        tile.column_offset as usize,
                        tile.column_count as usize,
                        &self.energy_m2s,
                        energy_max.max(1e-12),
                        |t| colormap_positive(colormap, t.sqrt()),
                    ),
                    column_offset: tile.column_offset,
                    column_count: tile.column_count,
                    bbox: tile.bbox,
                })
                .collect();
            (String::new(), String::new(), String::new(), field_tiles)
        } else {
            let peak_png = render_field(nx, ny, &self.peak_m, peak_max.max(1e-9), |t| {
                colormap_positive(colormap, t)
            });
            let t_of_max_png = render_field(nx, ny, &t_of_max_rgba, t_end, |t| {
                let (r, g, b, _) = viridis_colormap(t);
                (r, g, b, 210)
            });
            let energy_png =
                render_field(nx, ny, &self.energy_m2s, energy_max.max(1e-12), |t| {
                    // sqrt-compress so the directivity lobes away from the
                    // source stay visible next to the near-field maximum.
                    colormap_positive(colormap, t.sqrt())
                });
            (peak_png, t_of_max_png, energy_png, Vec::new())
        };

        let isochrones = extract_isochrones(grid, &self.arrival_s, t_end);

        MaxFieldProduct {
            bbox: [
                grid.west_lon,
                grid.south_lat,
                grid.west_lon + grid.dlon_deg * nx as f64,
                grid.south_lat + grid.dlat_deg * ny as f64,
            ],
            nx: nx as u32,
            ny: ny as u32,
            peak_height_field: crate::data::geodesy::sea_surface_height_field(),
            peak_abs_max_m: peak_max,
            t_end_s: t_end,
            arrival_threshold_m: self.arrival_threshold_m,
            peak_png_b64: peak_png,
            t_of_max_png_b64: t_of_max_png,
            energy_png_b64: energy_png,
            field_tiles,
            isochrones,
        }
    }
}

/// Positive-ramp colour for a sequential rendering of a magnitude field,
/// reusing the run's diverging/cividis/viridis palette's positive side.
fn colormap_positive(colormap: Colormap, t: f64) -> (u8, u8, u8, u8) {
    let t = t.clamp(0.0, 1.0);
    match colormap {
        Colormap::Diverging => diverging_colormap(t),
        Colormap::Cividis => cividis_colormap(t),
        Colormap::Viridis => viridis_colormap(t),
    }
}

/// Render a scalar field to a base64 PNG. Values are normalised by `scale`
/// before the colour ramp; NaN renders transparent.
fn render_field<F: Fn(f64) -> (u8, u8, u8, u8)>(
    nx: usize,
    ny: usize,
    values: &[f64],
    scale: f64,
    ramp: F,
) -> String {
    render_field_columns(nx, ny, 0, nx, values, scale, ramp)
}

fn render_field_columns<F: Fn(f64) -> (u8, u8, u8, u8)>(
    nx: usize,
    ny: usize,
    column_offset: usize,
    column_count: usize,
    values: &[f64],
    scale: f64,
    ramp: F,
) -> String {
    let mut rgba = Vec::with_capacity(column_count * ny * 4);
    for j in (0..ny).rev() {
        for i in column_offset..column_offset + column_count {
            let v = values[idx(i, j, nx)];
            let (r, g, b, a) = if v.is_finite() {
                ramp((v / scale).clamp(0.0, 1.0))
            } else {
                (0, 0, 0, 0)
            };
            rgba.extend_from_slice(&[r, g, b, a]);
        }
    }
    encode_rgba_png(column_count as u32, ny as u32, &rgba, None)
}

/// Pick isochrone levels: aim for ~5 contours at a "round" interval.
fn isochrone_levels(t_end_s: f64) -> Vec<f64> {
    if !(t_end_s.is_finite() && t_end_s > 0.0) {
        return Vec::new();
    }
    // Round the raw interval up to a multiple of 5 minutes.
    let raw = t_end_s / 6.0;
    let step = ((raw / 300.0).ceil() * 300.0).max(300.0);
    let mut levels = Vec::new();
    let mut level = step;
    while level < t_end_s && levels.len() < 12 {
        levels.push(level);
        level += step;
    }
    levels
}

/// Marching-squares contour extraction over the first-arrival grid.
/// Cells that never arrived hold `+inf`, which cleanly terminates contours
/// at the wavefront's maximum extent.
fn extract_isochrones(grid: &SwGrid, arrival_s: &[f64], t_end_s: f64) -> Vec<Isochrone> {
    isochrone_levels(t_end_s)
        .into_iter()
        .map(|level| Isochrone {
            time_s: level,
            lines: chain_segments(contour_segments(grid, arrival_s, level)),
        })
        .filter(|iso| !iso.lines.is_empty())
        .collect()
}

type Segment = ([f64; 2], [f64; 2]);

/// Standard marching squares: emit one or two line segments per 2×2 cell
/// block crossing `level`. Coordinates are cell-centre lon/lat degrees.
fn contour_segments(grid: &SwGrid, field: &[f64], level: f64) -> Vec<Segment> {
    let nx = grid.nx;
    let ny = grid.ny;
    let x_of = |i: usize| grid.west_lon + (i as f64 + 0.5) * grid.dlon_deg;
    let y_of = |j: usize| grid.south_lat + (j as f64 + 0.5) * grid.dlat_deg;
    // Interpolate the crossing point on an edge between (va at pa) and (vb at pb).
    let cross = |va: f64, vb: f64, pa: [f64; 2], pb: [f64; 2]| -> [f64; 2] {
        let t = if (vb - va).abs() < 1e-12 {
            0.5
        } else {
            ((level - va) / (vb - va)).clamp(0.0, 1.0)
        };
        [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t]
    };

    let mut segments = Vec::new();
    for j in 0..ny.saturating_sub(1) {
        for i in 0..nx.saturating_sub(1) {
            // Corner values (v0 bottom-left, v1 bottom-right, v2 top-right,
            // v3 top-left) — skip blocks touching never-arrived cells so the
            // contour stops at the wavefront extent instead of interpolating
            // against +inf.
            let v0 = field[idx(i, j, nx)];
            let v1 = field[idx(i + 1, j, nx)];
            let v2 = field[idx(i + 1, j + 1, nx)];
            let v3 = field[idx(i, j + 1, nx)];
            if ![v0, v1, v2, v3].iter().all(|v| v.is_finite()) {
                continue;
            }
            let p0 = [x_of(i), y_of(j)];
            let p1 = [x_of(i + 1), y_of(j)];
            let p2 = [x_of(i + 1), y_of(j + 1)];
            let p3 = [x_of(i), y_of(j + 1)];

            let mut case = 0u8;
            if v0 >= level {
                case |= 1;
            }
            if v1 >= level {
                case |= 2;
            }
            if v2 >= level {
                case |= 4;
            }
            if v3 >= level {
                case |= 8;
            }
            if case == 0 || case == 15 {
                continue;
            }

            let bottom = || cross(v0, v1, p0, p1);
            let right = || cross(v1, v2, p1, p2);
            let top = || cross(v3, v2, p3, p2);
            let left = || cross(v0, v3, p0, p3);

            match case {
                1 | 14 => segments.push((left(), bottom())),
                2 | 13 => segments.push((bottom(), right())),
                3 | 12 => segments.push((left(), right())),
                4 | 11 => segments.push((right(), top())),
                6 | 9 => segments.push((bottom(), top())),
                7 | 8 => segments.push((left(), top())),
                // Saddles: resolve with the mean-value heuristic.
                5 | 10 => {
                    let mean = (v0 + v1 + v2 + v3) / 4.0;
                    let flip = (mean >= level) == (case == 5);
                    if flip {
                        segments.push((left(), bottom()));
                        segments.push((right(), top()));
                    } else {
                        segments.push((left(), top()));
                        segments.push((bottom(), right()));
                    }
                }
                _ => unreachable!(),
            }
        }
    }
    segments
}

/// Greedily chain 2-point segments into polylines by matching endpoints on
/// a quantised grid. O(n) with a hash map; good enough for ≤ a few thousand
/// segments per level.
fn chain_segments(segments: Vec<Segment>) -> Vec<Vec<[f64; 2]>> {
    use std::collections::HashMap;

    fn key(p: [f64; 2]) -> (i64, i64) {
        ((p[0] * 1.0e7).round() as i64, (p[1] * 1.0e7).round() as i64)
    }

    let mut adjacency: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
    for (si, (a, b)) in segments.iter().enumerate() {
        adjacency.entry(key(*a)).or_default().push(si);
        adjacency.entry(key(*b)).or_default().push(si);
    }

    let mut used = vec![false; segments.len()];
    let mut lines = Vec::new();
    for start in 0..segments.len() {
        if used[start] {
            continue;
        }
        used[start] = true;
        let (a, b) = segments[start];
        let mut line = vec![a, b];
        // Extend forward from the tail, then backward from the head.
        for _pass in 0..2 {
            loop {
                let tail = *line.last().expect("line never empty");
                let Some(candidates) = adjacency.get(&key(tail)) else {
                    break;
                };
                let Some(&next) = candidates.iter().find(|&&si| !used[si]) else {
                    break;
                };
                used[next] = true;
                let (na, nb) = segments[next];
                if key(na) == key(tail) {
                    line.push(nb);
                } else {
                    line.push(na);
                }
            }
            line.reverse();
        }
        lines.push(line);
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grid_with(nx: usize, ny: usize) -> SwGrid {
        SwGrid::new(0.0, 0.0, nx as f64 * 0.1, ny as f64 * 0.1, 0.1, 0.1)
    }

    #[test]
    fn accumulator_tracks_peak_and_time() {
        let mut grid = grid_with(4, 4);
        grid.fill_uniform_depth(1000.0);
        let mut acc = MaxFieldAccumulator::new(16, 0.01);

        grid.eta_m[5] = 1.0;
        grid.t_s = 10.0;
        acc.observe(&grid);

        grid.eta_m[5] = -3.0; // |η| grows — negative trough counts.
        grid.t_s = 20.0;
        acc.observe(&grid);

        grid.eta_m[5] = 0.5;
        grid.t_s = 30.0;
        acc.observe(&grid);

        assert!((acc.peak_m[5] - 3.0).abs() < 1e-12);
        assert!((acc.t_of_max_s[5] - 20.0).abs() < 1e-12);
        assert!((acc.arrival_s[5] - 10.0).abs() < 1e-12);
        // Cell 0 never moved: no arrival.
        assert!(acc.arrival_s[0].is_infinite());
    }

    #[test]
    fn energy_integrates_eta_squared() {
        let mut grid = grid_with(2, 2);
        let mut acc = MaxFieldAccumulator::new(4, 0.01);
        grid.eta_m[0] = 2.0;
        grid.t_s = 0.0;
        acc.observe(&grid); // first observation: dt = 0
        grid.t_s = 10.0;
        acc.observe(&grid); // dt = 10, η² = 4 → +40
        assert!((acc.energy_m2s[0] - 40.0).abs() < 1e-9);
    }

    #[test]
    fn product_renders_and_extracts_isochrones() {
        let mut grid = grid_with(20, 20);
        grid.fill_uniform_depth(1000.0);
        let mut acc = MaxFieldAccumulator::new(400, 0.01);
        // Synthesise a radially expanding arrival: cell arrival time
        // proportional to distance from centre.
        for j in 0..20usize {
            for i in 0..20usize {
                let dx = i as f64 - 10.0;
                let dy = j as f64 - 10.0;
                let r = (dx * dx + dy * dy).sqrt();
                acc.arrival_s[idx(i, j, 20)] = r * 300.0;
                acc.peak_m[idx(i, j, 20)] = 1.0 / (1.0 + r);
                acc.t_of_max_s[idx(i, j, 20)] = r * 320.0;
            }
        }
        acc.last_t_s = 3600.0;
        acc.observed = true;
        let product = acc.into_product(&grid, None);
        assert_eq!(product.peak_height_field.horizontal_crs, "EPSG:4326");
        assert_eq!(
            product.peak_height_field.vertical_datum,
            crate::data::geodesy::VerticalDatum::IdealizedMeanSeaLevel,
        );
        assert_eq!(product.nx, 20);
        assert!(!product.peak_png_b64.is_empty());
        assert!(!product.t_of_max_png_b64.is_empty());
        assert!(!product.energy_png_b64.is_empty());
        assert!(
            !product.isochrones.is_empty(),
            "radial arrival must yield contours"
        );
        for iso in &product.isochrones {
            assert!(iso.time_s > 0.0 && iso.time_s < 3600.0);
            assert!(iso.lines.iter().all(|l| l.len() >= 2));
        }
    }

    #[test]
    fn dateline_product_uses_the_same_complete_tile_layout_for_every_png() {
        let mut grid = SwGrid::new(174.53, -2.0, 184.53, 2.0, 0.1, 0.5);
        grid.fill_uniform_depth(1_000.0);
        let mut acc = MaxFieldAccumulator::new(grid.nx * grid.ny, 0.01);
        grid.eta_m.fill(1.0);
        grid.t_s = 10.0;
        acc.observe(&grid);
        let product = acc.into_product(&grid, None);

        assert_eq!(product.field_tiles.len(), 2);
        assert!(product.peak_png_b64.is_empty());
        assert!(product.t_of_max_png_b64.is_empty());
        assert!(product.energy_png_b64.is_empty());
        assert_eq!(
            product
                .field_tiles
                .iter()
                .map(|tile| tile.column_count)
                .sum::<u32>(),
            grid.nx as u32
        );
        assert!(product.field_tiles.iter().all(|tile| {
            !tile.peak_png_b64.is_empty()
                && !tile.t_of_max_png_b64.is_empty()
                && !tile.energy_png_b64.is_empty()
        }));
    }

    #[test]
    fn isochrone_levels_are_round_and_bounded() {
        let levels = isochrone_levels(3600.0);
        assert!(!levels.is_empty());
        assert!(levels.len() <= 12);
        for l in &levels {
            assert_eq!(*l % 300.0, 0.0, "levels must be 5-minute multiples");
            assert!(*l < 3600.0);
        }
    }

    #[test]
    fn chain_segments_joins_collinear_pieces() {
        let segs = vec![
            ([0.0, 0.0], [1.0, 0.0]),
            ([1.0, 0.0], [2.0, 0.0]),
            ([2.0, 0.0], [3.0, 0.0]),
        ];
        let lines = chain_segments(segs);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].len(), 4);
    }
}
