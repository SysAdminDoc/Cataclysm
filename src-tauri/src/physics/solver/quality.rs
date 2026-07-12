use serde::Serialize;

use super::{BoundaryMode, SwGrid};
use crate::physics::constants::{G_EARTH, RHO_SEAWATER};

const CFL_HARD_LIMIT: f64 = 1.0;
const NEGATIVE_DEPTH_TOLERANCE_M: f64 = 1.0e-6;
const MASS_DRIFT_WARNING_PCT: f64 = 5.0;
const ENERGY_GAIN_WARNING_PCT: f64 = 5.0;

#[derive(Debug, Clone, Copy)]
pub struct QualityBaseline {
    mass_m3: f64,
    mass_scale_m3: f64,
    energy_j: f64,
    sponge_width_cells: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RunQualityStatus {
    Pass,
    Warning,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
pub struct RunQualityRecord {
    pub status: RunQualityStatus,
    pub finite_fields: bool,
    pub minimum_total_depth_m: f64,
    pub cfl_number: f64,
    pub cfl_margin: f64,
    pub accepted_steps: u64,
    pub rejected_steps: u64,
    pub mass_drift_pct: f64,
    pub energy_drift_pct: f64,
    pub sponge_width_cells: u32,
    pub warnings: Vec<String>,
    pub failure: Option<String>,
}

impl QualityBaseline {
    pub fn capture(grid: &SwGrid, boundary: BoundaryMode) -> Self {
        let sponge_width_cells = match boundary {
            BoundaryMode::ZeroFlux => 0,
            BoundaryMode::Sponge { width_cells } => width_cells,
        };
        let metrics = Metrics::from_grid(grid, sponge_width_cells);
        Self {
            mass_m3: metrics.mass_m3,
            mass_scale_m3: metrics.mass_scale_m3,
            energy_j: metrics.energy_j,
            sponge_width_cells,
        }
    }

    pub fn assess(&self, grid: &SwGrid, dt_s: f64) -> RunQualityRecord {
        let metrics = Metrics::from_grid(grid, self.sponge_width_cells);
        let cfl_number = grid_cfl_number(grid, dt_s);
        let cfl_margin = CFL_HARD_LIMIT - cfl_number;
        let mass_drift_pct = percent_change(metrics.mass_m3, self.mass_m3, self.mass_scale_m3);
        let energy_drift_pct = percent_change(metrics.energy_j, self.energy_j, self.energy_j.abs());
        let mut warnings = Vec::new();
        if mass_drift_pct.abs() > MASS_DRIFT_WARNING_PCT {
            warnings.push(format!(
                "sponge-adjusted mass drift is {mass_drift_pct:.2}%"
            ));
        }
        if energy_drift_pct > ENERGY_GAIN_WARNING_PCT {
            warnings.push(format!(
                "sponge-adjusted energy increased by {energy_drift_pct:.2}%"
            ));
        }
        let failure = if !metrics.finite_fields {
            Some("solver produced a non-finite eta, velocity, depth, or time value".to_string())
        } else if metrics.minimum_total_depth_m < -NEGATIVE_DEPTH_TOLERANCE_M {
            Some(format!(
                "minimum total water depth is {:.6} m",
                metrics.minimum_total_depth_m
            ))
        } else if !cfl_number.is_finite() || cfl_number > CFL_HARD_LIMIT {
            Some(format!(
                "CFL number {cfl_number:.6} exceeds hard limit {CFL_HARD_LIMIT}"
            ))
        } else {
            None
        };
        let status = if failure.is_some() {
            RunQualityStatus::Failed
        } else if warnings.is_empty() {
            RunQualityStatus::Pass
        } else {
            RunQualityStatus::Warning
        };
        RunQualityRecord {
            status,
            finite_fields: metrics.finite_fields,
            minimum_total_depth_m: metrics.minimum_total_depth_m,
            cfl_number,
            cfl_margin,
            accepted_steps: grid.step_index,
            rejected_steps: u64::from(failure.is_some()),
            mass_drift_pct,
            energy_drift_pct,
            sponge_width_cells: self.sponge_width_cells.min(u32::MAX as usize) as u32,
            warnings,
            failure,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct Metrics {
    finite_fields: bool,
    minimum_total_depth_m: f64,
    mass_m3: f64,
    mass_scale_m3: f64,
    energy_j: f64,
}

impl Metrics {
    fn from_grid(grid: &SwGrid, sponge_width_cells: usize) -> Self {
        let (dx_m, dy_m) = grid.metres_per_deg();
        let cell_area_m2 = (dx_m * grid.dlon_deg * dy_m * grid.dlat_deg).abs();
        let mut finite_fields = grid.t_s.is_finite();
        let mut minimum_total_depth_m = f64::INFINITY;
        let mut mass_m3 = 0.0;
        let mut mass_scale_m3 = 0.0;
        let mut energy_j = 0.0;
        for j in 0..grid.ny {
            for i in 0..grid.nx {
                let index = j * grid.nx + i;
                let (h, eta, u, v) = (
                    grid.h_m[index],
                    grid.eta_m[index],
                    grid.u_ms[index],
                    grid.v_ms[index],
                );
                if ![h, eta, u, v].iter().all(|value| value.is_finite()) {
                    finite_fields = false;
                    continue;
                }
                minimum_total_depth_m = minimum_total_depth_m.min(h + eta);
                let in_sponge = sponge_width_cells > 0
                    && (i < sponge_width_cells
                        || j < sponge_width_cells
                        || i + sponge_width_cells >= grid.nx
                        || j + sponge_width_cells >= grid.ny);
                if !in_sponge {
                    let displaced_volume = eta * cell_area_m2;
                    mass_m3 += displaced_volume;
                    mass_scale_m3 += displaced_volume.abs();
                    energy_j += RHO_SEAWATER
                        * (0.5 * G_EARTH * eta * eta + 0.5 * (h + eta).max(0.0) * (u * u + v * v))
                        * cell_area_m2;
                }
            }
        }
        if !minimum_total_depth_m.is_finite() {
            minimum_total_depth_m = f64::NEG_INFINITY;
        }
        Self {
            finite_fields,
            minimum_total_depth_m,
            mass_m3,
            mass_scale_m3,
            energy_j,
        }
    }
}

fn grid_cfl_number(grid: &SwGrid, dt_s: f64) -> f64 {
    let (dx_m, dy_m) = grid.metres_per_deg();
    let dx = (dx_m * grid.dlon_deg).abs().max(f64::MIN_POSITIVE);
    let dy = (dy_m * grid.dlat_deg).abs().max(f64::MIN_POSITIVE);
    grid.h_m
        .iter()
        .zip(&grid.eta_m)
        .zip(&grid.u_ms)
        .zip(&grid.v_ms)
        .map(|(((&h, &eta), &u), &v)| {
            let celerity = (G_EARTH * (h + eta).max(0.0)).sqrt();
            dt_s * ((u.abs() + celerity) / dx + (v.abs() + celerity) / dy)
        })
        .fold(0.0_f64, f64::max)
}

fn percent_change(current: f64, initial: f64, scale: f64) -> f64 {
    100.0 * (current - initial) / scale.abs().max(1.0e-12)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grid() -> SwGrid {
        let mut grid = SwGrid::new(-2.0, -2.0, 2.0, 2.0, 0.5, 0.5);
        grid.fill_uniform_depth(4_000.0);
        grid.inject_gaussian(0.0, 0.0, 1.0, 50_000.0);
        grid
    }

    #[test]
    fn healthy_grid_publishes_finite_quality_metrics() {
        let grid = grid();
        let baseline = QualityBaseline::capture(&grid, BoundaryMode::ZeroFlux);
        let record = baseline.assess(&grid, grid.recommended_dt_s(0.4));
        assert!(record.failure.is_none());
        assert!(record.finite_fields);
        assert!(record.minimum_total_depth_m > 0.0);
        assert!(record.cfl_number > 0.7 && record.cfl_number < 0.9);
        assert_eq!(record.accepted_steps, 0);
        assert_eq!(record.rejected_steps, 0);
    }

    #[test]
    fn nonfinite_and_negative_depth_fields_fail_closed() {
        let mut grid = grid();
        let baseline = QualityBaseline::capture(&grid, BoundaryMode::default_sponge());
        grid.eta_m[0] = f64::NAN;
        let nonfinite = baseline.assess(&grid, grid.recommended_dt_s(0.4));
        assert!(
            nonfinite
                .failure
                .as_deref()
                .is_some_and(|failure| failure.contains("non-finite"))
        );
        grid.eta_m[0] = -5_000.0;
        let negative = baseline.assess(&grid, grid.recommended_dt_s(0.4));
        assert!(
            negative
                .failure
                .as_deref()
                .is_some_and(|failure| failure.contains("minimum total water depth"))
        );
    }

    #[test]
    fn cfl_limit_violation_fails_closed() {
        let grid = grid();
        let baseline = QualityBaseline::capture(&grid, BoundaryMode::ZeroFlux);
        let record = baseline.assess(&grid, grid.recommended_dt_s(0.6));
        assert!(
            record
                .failure
                .as_deref()
                .is_some_and(|failure| failure.contains("CFL"))
        );
    }

    #[test]
    fn checked_cpu_step_rolls_back_a_rejected_candidate() {
        let mut grid = grid();
        let before = grid.clone();
        let baseline = QualityBaseline::capture(&grid, BoundaryMode::ZeroFlux);
        let stepper = super::super::TimeStepper::new(grid.recommended_dt_s(0.6))
            .with_boundary(BoundaryMode::ZeroFlux);
        let result = stepper.step_cancellable_checked(&mut grid, 1, None, &baseline, &mut |_| {});
        assert!(result.is_err());
        assert_eq!(grid.step_index, before.step_index);
        assert_eq!(grid.t_s, before.t_s);
        assert_eq!(grid.eta_m, before.eta_m);
        assert_eq!(grid.u_ms, before.u_ms);
        assert_eq!(grid.v_ms, before.v_ms);
    }
}
