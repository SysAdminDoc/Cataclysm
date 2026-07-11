//! Low-confidence coarse basin/shelf bathymetry approximation.
//!
//! This is **not** a substitute for GEBCO_2026, SRTM15+, or ETOPO
//! raster data. It returns an approximate ocean depth for any
//! lat/lon by classifying the point into an ocean basin and applying that
//! basin's published mean depth, with adjustments for major continental
//! shelves and trenches. Treat it as low-confidence context for educational
//! wave propagation, not as a surveyed bathymetry product.
//!
//! Sources for basin means:
//! - Charette & Smith (2010), "The volume of Earth's ocean," *Oceanography* 23:112.
//!
//! A future GEBCO_2026 raster sampler should load the matching Type Identifier
//! (TID) grid and carry cell-source confidence through the UI and exports once
//! data distribution, storage, and first-run download decisions are resolved.

/// Approximate ocean depth at the given latitude/longitude (deg WGS84),
/// in meters. Returns 0.0 for land. Coarse — accuracy is order-of-magnitude
/// rather than per-tile.
pub fn sample(lat_deg: f64, lon_deg: f64) -> f64 {
    let lon = ((lon_deg + 180.0).rem_euclid(360.0)) - 180.0;
    let lat = lat_deg.clamp(-90.0, 90.0);

    // The shared mask is the single wet/dry authority for the solver,
    // renderer probes, collision, and hazard target classification.
    match super::surface::classify(lat, lon) {
        super::surface::SurfaceClass::Ocean => basin_depth(lat, lon),
        // The coarse contract identifies large inland-water rectangles but
        // does not bundle lake bathymetry. Keep them wet at a declared
        // low-confidence nominal depth until a real hydro DEM lands.
        super::surface::SurfaceClass::InlandWater => 50.0,
        super::surface::SurfaceClass::Land
        | super::surface::SurfaceClass::Ice
        | super::surface::SurfaceClass::Coast
        | super::surface::SurfaceClass::Unknown => 0.0,
    }
}

/// Mean depth of the ocean basin that contains this point. Continental-
/// shelf adjustment: within ~5° of major land, depth tapers linearly to
/// 200 m at the coast.
fn basin_depth(lat: f64, lon: f64) -> f64 {
    let base = match classify_basin(lat, lon) {
        Basin::Pacific => 4280.0,
        Basin::Atlantic => 3646.0,
        Basin::Indian => 3741.0,
        Basin::Southern => 3270.0,
        Basin::Arctic => 1205.0,
        Basin::Mediterranean => 1500.0,
        Basin::Caribbean => 2400.0,
    };
    // Approximate "distance to nearest continental box". Cheap proxy:
    // smallest north/south + east/west gap to any LAND box edge.
    let shelf_factor = shelf_factor(lat, lon);
    base * shelf_factor + 200.0 * (1.0 - shelf_factor)
}

#[derive(Debug, Clone, Copy)]
enum Basin {
    Pacific,
    Atlantic,
    Indian,
    Southern,
    Arctic,
    Mediterranean,
    Caribbean,
}

fn classify_basin(lat: f64, lon: f64) -> Basin {
    if lat < -60.0 {
        return Basin::Southern;
    }
    if lat > 66.0 {
        return Basin::Arctic;
    }
    // Mediterranean rough box.
    if lat > 30.0 && lat < 46.0 && lon > -6.0 && lon < 37.0 {
        return Basin::Mediterranean;
    }
    // Caribbean rough box.
    if lat > 8.0 && lat < 28.0 && lon > -90.0 && lon < -60.0 {
        return Basin::Caribbean;
    }
    // Indian Ocean: south of Asia, east of Africa, west of Indonesia/Australia.
    if lat < 30.0 && lon > 20.0 && lon < 110.0 {
        return Basin::Indian;
    }
    // Atlantic: longitudes roughly -70 to 20.
    if lon > -75.0 && lon < 20.0 {
        return Basin::Atlantic;
    }
    Basin::Pacific
}

/// Smooth shelf factor in [0, 1]. 1.0 = full basin depth; ramps down to 0
/// within 5° of the nearest land bounding-box edge.
fn shelf_factor(lat: f64, lon: f64) -> f64 {
    let d = super::surface::distance_to_dry_deg(lat, lon).unwrap_or(0.0);
    (d / 5.0).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_pacific_is_deep() {
        // Middle of the Pacific.
        let d = sample(0.0, -150.0);
        assert!((3500.0..5500.0).contains(&d), "Pacific deep got {}", d);
    }

    #[test]
    fn open_atlantic_is_deep() {
        let d = sample(20.0, -40.0);
        assert!((3000.0..5000.0).contains(&d), "Atlantic deep got {}", d);
    }

    #[test]
    fn middle_of_continent_is_land() {
        // Middle of Africa.
        let d = sample(0.0, 20.0);
        assert_eq!(d, 0.0);
    }

    #[test]
    fn coastal_shelf_shallower_than_basin() {
        // Open ocean: middle of Pacific at -15 lat.
        let deep = sample(-15.0, -140.0);
        // ~3° off the South America land box (box west edge is -82.0).
        // Must be west of -82 to be in the ocean, but close enough that
        // the shelf taper kicks in.
        let coast = sample(-15.0, -85.0);
        assert!(coast > 0.0, "coast should still be ocean, got {}", coast);
        assert!(
            coast < deep,
            "coast {} should be shallower than open ocean {}",
            coast,
            deep
        );
    }
}
