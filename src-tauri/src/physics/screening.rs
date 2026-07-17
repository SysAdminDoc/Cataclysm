//! Browser- and desktop-portable closed-form screening calculations.
//!
//! Keeping these small query functions in the physics crate ensures the
//! Tauri IPC commands and browser WASM preview use the same compiled Rust
//! implementation for attenuation, arrival, runup, and point inspection.

use serde::{Deserialize, Serialize};

use super::{
    GeoPoint,
    asteroid::far_field_amplitude_m as impact_far_field,
    constants::{G_EARTH, R_EARTH_M},
    nuclear::far_field_amplitude_m as nuclear_far_field,
    shallow_water::synolakis_runup_m,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AttenuationSample {
    pub range_m: f64,
    pub amplitude_m: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ScreeningPoint {
    pub lat: f64,
    pub lon: f64,
    pub beach_slope_deg: f64,
    pub offshore_depth_m: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ScreeningResult {
    pub range_m: f64,
    pub offshore_amplitude_m: f64,
    pub runup_m: f64,
    pub arrival_time_s: f64,
    pub has_arrived: bool,
    pub inundation_extent_m: f64,
}

pub fn attenuation_curve(
    initial_amplitude_m: f64,
    cavity_radius_m: f64,
    decay_alpha: f64,
    max_range_m: f64,
    n_samples: usize,
) -> Vec<AttenuationSample> {
    let start_range_m = cavity_radius_m.max(1_000.0);
    let mut samples = Vec::with_capacity(n_samples);
    for i in 0..n_samples {
        let frac = i as f64 / (n_samples - 1) as f64;
        let range_m = start_range_m + frac * (max_range_m - start_range_m);
        let amplitude_m = if range_m <= cavity_radius_m {
            initial_amplitude_m
        } else {
            initial_amplitude_m * (cavity_radius_m / range_m).powf(decay_alpha)
        };
        samples.push(AttenuationSample {
            range_m,
            amplitude_m,
        });
    }
    samples
}

/// Great-circle distance, meters, between two WGS84 points (Haversine).
pub fn haversine_m(a_lat: f64, a_lon: f64, b_lat: f64, b_lon: f64) -> f64 {
    if !(a_lat.is_finite() && a_lon.is_finite() && b_lat.is_finite() && b_lon.is_finite()) {
        return 0.0;
    }
    let phi1 = a_lat.to_radians();
    let phi2 = b_lat.to_radians();
    let dphi = (b_lat - a_lat).to_radians();
    let dlmb = (b_lon - a_lon).to_radians();
    let s = ((dphi * 0.5).sin().powi(2) + phi1.cos() * phi2.cos() * (dlmb * 0.5).sin().powi(2))
        .clamp(0.0, 1.0);
    2.0 * R_EARTH_M * s.sqrt().atan2((1.0 - s).sqrt())
}

pub fn screen_point(
    source: GeoPoint,
    initial_amplitude_m: f64,
    cavity_radius_m: f64,
    is_impact: bool,
    mean_depth_m: f64,
    time_s: f64,
    point: ScreeningPoint,
) -> ScreeningResult {
    let range_m = haversine_m(source.lat_deg, source.lon_deg, point.lat, point.lon);
    let offshore_amplitude_m = if is_impact {
        impact_far_field(initial_amplitude_m, cavity_radius_m, range_m)
    } else {
        nuclear_far_field(initial_amplitude_m, cavity_radius_m, range_m)
    };
    let runup_m = synolakis_runup_m(
        offshore_amplitude_m,
        point.offshore_depth_m,
        point.beach_slope_deg,
    );
    let wave_speed_m_s = (G_EARTH * mean_depth_m.max(1.0)).sqrt();
    let arrival_time_s = range_m / wave_speed_m_s;
    let slope_rad = point.beach_slope_deg.to_radians();
    let inundation_extent_m = if slope_rad > 0.0 {
        (runup_m / slope_rad.tan()).clamp(0.0, 50_000.0)
    } else {
        0.0
    };
    ScreeningResult {
        range_m,
        offshore_amplitude_m,
        runup_m,
        arrival_time_s,
        has_arrived: time_s >= arrival_time_s,
        inundation_extent_m,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attenuation_endpoints_are_deterministic() {
        let samples = attenuation_curve(10.0, 2_000.0, 5.0 / 6.0, 100_000.0, 3);
        assert_eq!(samples[0].range_m, 2_000.0);
        assert_eq!(samples[0].amplitude_m, 10.0);
        assert_eq!(samples[2].range_m, 100_000.0);
    }

    #[test]
    fn point_screen_is_finite_at_source() {
        let result = screen_point(
            GeoPoint {
                lat_deg: 0.0,
                lon_deg: 0.0,
                depth_m: 4_000.0,
            },
            2.0,
            1_000.0,
            true,
            4_000.0,
            0.0,
            ScreeningPoint {
                lat: 0.0,
                lon: 0.0,
                beach_slope_deg: 1.0,
                offshore_depth_m: 50.0,
            },
        );
        assert!(result.runup_m.is_finite());
        assert_eq!(result.arrival_time_s, 0.0);
        assert!(result.has_arrived);
    }
}
