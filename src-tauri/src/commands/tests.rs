use super::*;
use crate::physics::landslide::LandslideKind;

fn good_loc() -> GeoPoint {
    GeoPoint {
        lat_deg: 0.0,
        lon_deg: 0.0,
        depth_m: 4_000.0,
    }
}

fn source_grid_request(source_geometry: Option<InitialSourceGeometry>) -> SimulateGridRequest {
    SimulateGridRequest {
        source: good_loc(),
        initial_amplitude_m: 4.0,
        source_sigma_m: 50_000.0,
        source_geometry,
        mean_depth_m: 4_000.0,
        use_real_bathymetry: false,
        bathymetry_asset_id: None,
        box_half_size_deg: 2.0,
        cells_per_deg: 10.0,
        resolution_mode: None,
        t_end_s: 60.0,
        n_snapshots: 2,
        include_lamb_wave: false,
        lamb_wave_peak_pressure_pa: None,
        lamb_wave_source_radius_m: None,
        meteotsunami_forcing: None,
        colormap: "diverging".into(),
        gauge_points: vec![],
        boundary_mode: None,
    }
}

#[path = "tests_observations.rs"]
mod observations;
#[path = "tests_sensitivity_ensemble.rs"]
mod sensitivity_ensemble;
#[path = "tests_simulation.rs"]
mod simulation;
#[path = "tests_solver.rs"]
mod solver;
#[path = "tests_waves.rs"]
mod waves;
