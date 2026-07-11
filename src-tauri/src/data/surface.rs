//! Shared coarse surface classification contract.
//!
//! The mask is intentionally low confidence, but it is singular: solver
//! wet/dry initialization, target classification, renderer probes, and future
//! collision/water shading all consume `src/data/surface-mask.json`.

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use super::geodesy::{bathymetry_depth_field, HeightFieldMetadata};

const MASK_JSON: &str = include_str!("../../../src/data/surface-mask.json");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SurfaceClass {
    Land,
    Ocean,
    InlandWater,
    Ice,
    Coast,
    Unknown,
}

impl SurfaceClass {
    pub fn is_wet(self) -> bool {
        matches!(self, Self::Ocean | Self::InlandWater)
    }
}

#[derive(Debug, Clone, Deserialize)]
struct Region {
    id: String,
    surface_class: SurfaceClass,
    /// west, south, east, north
    bounds: [f64; 4],
}

#[derive(Debug, Clone, Deserialize)]
struct SurfaceMask {
    schema_version: u32,
    mask_version: String,
    source_asset_id: String,
    horizontal_crs: String,
    vertical_datum: String,
    coastal_band_deg: f64,
    declared_horizontal_error_m: f64,
    confidence: String,
    wet_classes: Vec<String>,
    regions: Vec<Region>,
}

fn mask() -> &'static SurfaceMask {
    static MASK: OnceLock<SurfaceMask> = OnceLock::new();
    MASK.get_or_init(|| {
        let parsed: SurfaceMask =
            serde_json::from_str(MASK_JSON).expect("bundled surface mask must parse");
        assert_eq!(parsed.schema_version, 1, "unsupported surface mask schema");
        assert!(parsed.coastal_band_deg.is_finite() && parsed.coastal_band_deg >= 0.0);
        parsed
    })
}

fn normalize(lat_deg: f64, lon_deg: f64) -> Option<(f64, f64)> {
    if !lat_deg.is_finite() || !lon_deg.is_finite() || !(-90.0..=90.0).contains(&lat_deg) {
        return None;
    }
    let lon = ((lon_deg + 180.0).rem_euclid(360.0)) - 180.0;
    Some((lat_deg, lon))
}

fn contains(region: &Region, lat: f64, lon: f64) -> bool {
    let [west, south, east, north] = region.bounds;
    lat >= south && lat <= north && lon >= west && lon <= east
}

fn distance_to_region_deg(region: &Region, lat: f64, lon: f64) -> f64 {
    let [west, south, east, north] = region.bounds;
    let dlat = if lat < south {
        south - lat
    } else if lat > north {
        lat - north
    } else {
        0.0
    };
    let dlon = if lon < west {
        west - lon
    } else if lon > east {
        lon - east
    } else {
        0.0
    };
    (dlat * dlat + dlon * dlon).sqrt()
}

fn distance_to_region_edge_deg(region: &Region, lat: f64, lon: f64) -> f64 {
    if !contains(region, lat, lon) {
        return distance_to_region_deg(region, lat, lon);
    }
    let [west, south, east, north] = region.bounds;
    (lat - south)
        .min(north - lat)
        .min(lon - west)
        .min(east - lon)
}

pub fn classify(lat_deg: f64, lon_deg: f64) -> SurfaceClass {
    let Some((lat, lon)) = normalize(lat_deg, lon_deg) else {
        return SurfaceClass::Unknown;
    };
    let mask = mask();

    // Specific water/ice regions override continental rectangles.
    if let Some(region) = mask
        .regions
        .iter()
        .find(|region| region.surface_class != SurfaceClass::Land && contains(region, lat, lon))
    {
        return region.surface_class;
    }

    if let Some(region) = mask
        .regions
        .iter()
        .find(|region| region.surface_class == SurfaceClass::Land && contains(region, lat, lon))
    {
        return if distance_to_region_edge_deg(region, lat, lon) <= mask.coastal_band_deg {
            SurfaceClass::Coast
        } else {
            SurfaceClass::Land
        };
    }

    if distance_to_dry_deg_normalized(lat, lon) <= mask.coastal_band_deg {
        SurfaceClass::Coast
    } else {
        SurfaceClass::Ocean
    }
}

fn distance_to_dry_deg_normalized(lat: f64, lon: f64) -> f64 {
    mask()
        .regions
        .iter()
        .filter(|region| matches!(region.surface_class, SurfaceClass::Land | SurfaceClass::Ice))
        .map(|region| distance_to_region_deg(region, lat, lon))
        .fold(180.0, f64::min)
}

pub fn distance_to_dry_deg(lat_deg: f64, lon_deg: f64) -> Option<f64> {
    let (lat, lon) = normalize(lat_deg, lon_deg)?;
    Some(distance_to_dry_deg_normalized(lat, lon))
}

#[derive(Debug, Clone, Serialize)]
pub struct SurfaceProbe {
    pub lat_deg: f64,
    pub lon_deg: f64,
    pub surface_class: SurfaceClass,
    pub is_wet: bool,
    pub water_depth_m: f64,
    pub mask_version: String,
    pub mask_source_asset_id: String,
    pub confidence: String,
    pub declared_horizontal_error_m: f64,
    pub height_field: HeightFieldMetadata,
}

pub fn probe(lat_deg: f64, lon_deg: f64) -> Option<SurfaceProbe> {
    let (lat, lon) = normalize(lat_deg, lon_deg)?;
    let surface_class = classify(lat, lon);
    let water_depth_m = super::bathymetry::sample(lat, lon);
    let mask = mask();
    Some(SurfaceProbe {
        lat_deg: lat,
        lon_deg: lon,
        surface_class,
        is_wet: surface_class.is_wet(),
        water_depth_m,
        mask_version: mask.mask_version.clone(),
        mask_source_asset_id: mask.source_asset_id.clone(),
        confidence: mask.confidence.clone(),
        declared_horizontal_error_m: mask.declared_horizontal_error_m,
        height_field: bathymetry_depth_field(),
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct SurfaceMaskDiagnostics {
    pub schema_version: u32,
    pub mask_version: String,
    pub source_asset_id: String,
    pub horizontal_crs: String,
    pub vertical_datum: String,
    pub coastal_band_deg: f64,
    pub declared_horizontal_error_m: f64,
    pub confidence: String,
    pub wet_classes: Vec<String>,
    pub region_count: usize,
    pub region_ids: Vec<String>,
}

pub fn diagnostics() -> SurfaceMaskDiagnostics {
    let mask = mask();
    SurfaceMaskDiagnostics {
        schema_version: mask.schema_version,
        mask_version: mask.mask_version.clone(),
        source_asset_id: mask.source_asset_id.clone(),
        horizontal_crs: mask.horizontal_crs.clone(),
        vertical_datum: mask.vertical_datum.clone(),
        coastal_band_deg: mask.coastal_band_deg,
        declared_horizontal_error_m: mask.declared_horizontal_error_m,
        confidence: mask.confidence.clone(),
        wet_classes: mask.wet_classes.clone(),
        region_count: mask.regions.len(),
        region_ids: mask
            .regions
            .iter()
            .map(|region| region.id.clone())
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_mask_distinguishes_major_surface_classes() {
        assert_eq!(classify(0.0, -150.0), SurfaceClass::Ocean);
        assert_eq!(classify(0.0, 20.0), SurfaceClass::Land);
        assert_eq!(classify(45.0, -83.0), SurfaceClass::InlandWater);
        assert_eq!(classify(72.0, -40.0), SurfaceClass::Ice);
        assert_eq!(classify(0.0, f64::NAN), SurfaceClass::Unknown);
    }

    #[test]
    fn coast_band_is_conservative_and_not_solver_wet() {
        let coast = classify(-15.0, -82.1);
        assert_eq!(coast, SurfaceClass::Coast);
        assert!(!coast.is_wet());
        assert_eq!(super::super::bathymetry::sample(-15.0, -82.1), 0.0);
    }

    #[test]
    fn probe_carries_crs_datum_version_and_error_budget() {
        let sample = probe(0.0, -150.0).unwrap();
        assert_eq!(sample.surface_class, SurfaceClass::Ocean);
        assert!(sample.is_wet);
        assert!(sample.water_depth_m > 3_000.0);
        assert_eq!(sample.height_field.horizontal_crs, "EPSG:4326");
        assert_eq!(
            sample.height_field.vertical_datum,
            crate::data::geodesy::VerticalDatum::DepthBelowIdealizedMeanSeaLevel,
        );
        assert!(sample.declared_horizontal_error_m >= 100_000.0);
        assert!(!sample.mask_version.is_empty());
    }
}
