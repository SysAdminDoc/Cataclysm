//! Educational coastal-mitigation geometry for the shallow-water solver.
//!
//! This is a bounded engineering-design teaching model, not a coastal-defense
//! design tool. A barrier is represented on the solver grid as a rotated,
//! rectangular bathymetry modification: requested wall height reduces the
//! still-water depth in covered cells, and cells reduced to zero become dry
//! reflective cells under the solver's existing wet/dry treatment. The model
//! does not resolve a vertical wall, overtopping, scour, sediment transport,
//! structural failure, or flow around a sub-cell barrier.
//!
//! The interaction is inspired by TeachEngineering's levee/seawall design
//! activities and is labelled against NGSS MS-ETS1-2/MS-ETS1-3 in the UI:
//! <https://www.teachengineering.org/activities/view/cub_weather_lesson05_activity1>
//! <https://www.nextgenscience.org/msets1-engineering-design>

use serde::{Deserialize, Serialize};

pub const MIN_BARRIER_LENGTH_M: f64 = 100.0;
pub const MAX_BARRIER_LENGTH_M: f64 = 200_000.0;
pub const MIN_BARRIER_WIDTH_M: f64 = 50.0;
pub const MAX_BARRIER_WIDTH_M: f64 = 20_000.0;
pub const MIN_BARRIER_HEIGHT_M: f64 = 0.1;
pub const MAX_BARRIER_HEIGHT_M: f64 = 500.0;

/// A user-placed, idealized coastal barrier in WGS84 degrees and metres.
/// `orientation_deg` is clockwise from north; length follows the barrier and
/// width is its across-barrier footprint on the solver grid.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq)]
pub struct MitigationBarrier {
    pub lat_deg: f64,
    pub lon_deg: f64,
    pub length_m: f64,
    pub width_m: f64,
    pub height_m: f64,
    pub orientation_deg: f64,
}

impl MitigationBarrier {
    pub fn validate(&self) -> Result<(), String> {
        if !self.lat_deg.is_finite() || self.lat_deg.abs() > 90.0 {
            return Err("mitigation barrier latitude must be finite and in [-90, 90]".into());
        }
        if !self.lon_deg.is_finite() || self.lon_deg.abs() > 180.0 {
            return Err("mitigation barrier longitude must be finite and in [-180, 180]".into());
        }
        if !self.length_m.is_finite()
            || !(MIN_BARRIER_LENGTH_M..=MAX_BARRIER_LENGTH_M).contains(&self.length_m)
        {
            return Err(format!(
                "mitigation barrier length must be in [{MIN_BARRIER_LENGTH_M}, {MAX_BARRIER_LENGTH_M}] m"
            ));
        }
        if !self.width_m.is_finite()
            || !(MIN_BARRIER_WIDTH_M..=MAX_BARRIER_WIDTH_M).contains(&self.width_m)
        {
            return Err(format!(
                "mitigation barrier width must be in [{MIN_BARRIER_WIDTH_M}, {MAX_BARRIER_WIDTH_M}] m"
            ));
        }
        if !self.height_m.is_finite()
            || !(MIN_BARRIER_HEIGHT_M..=MAX_BARRIER_HEIGHT_M).contains(&self.height_m)
        {
            return Err(format!(
                "mitigation barrier height must be in [{MIN_BARRIER_HEIGHT_M}, {MAX_BARRIER_HEIGHT_M}] m"
            ));
        }
        if !self.orientation_deg.is_finite()
            || !(0.0..360.0).contains(&self.orientation_deg)
        {
            return Err("mitigation barrier orientation must be finite and in [0, 360) degrees".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid() -> MitigationBarrier {
        MitigationBarrier {
            lat_deg: 0.0,
            lon_deg: 0.0,
            length_m: 10_000.0,
            width_m: 500.0,
            height_m: 20.0,
            orientation_deg: 90.0,
        }
    }

    #[test]
    fn validates_bounded_teaching_geometry() {
        assert!(valid().validate().is_ok());
        let mut invalid = valid();
        invalid.height_m = MAX_BARRIER_HEIGHT_M + 1.0;
        assert!(invalid.validate().is_err());
    }
}
