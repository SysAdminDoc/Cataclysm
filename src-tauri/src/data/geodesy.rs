//! Renderer-neutral coordinate and vertical-datum contract.
//!
//! Cesium and Rust exchange WGS 84 geodetic/ECEF coordinates in metres.
//! Unreal consumes a local east/north/up frame in centimetres. Vertical
//! conversions are deliberately explicit: no global geoid or tide grid is
//! bundled, so conversions that lack the required correction fail closed.

use serde::{Deserialize, Serialize};

pub const WGS84_A_M: f64 = 6_378_137.0;
pub const WGS84_INV_F: f64 = 298.257_223_563;
pub const HORIZONTAL_CRS_GEOGRAPHIC_2D: &str = "EPSG:4326";
pub const HORIZONTAL_CRS_GEOGRAPHIC_3D: &str = "EPSG:4979";
pub const HORIZONTAL_CRS_ECEF: &str = "EPSG:4978";
pub const CONTRACT_VERSION: &str = "1.0.0";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VerticalDatum {
    Wgs84Ellipsoid,
    Navd88Geoid18,
    IdealizedMeanSeaLevel,
    DepthBelowIdealizedMeanSeaLevel,
    LocalEnu,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VerticalAxis {
    PositiveUp,
    PositiveDown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HeightFieldMetadata {
    pub horizontal_crs: String,
    pub vertical_datum: VerticalDatum,
    pub vertical_axis: VerticalAxis,
    pub unit: String,
    pub declared_vertical_error_m: f64,
}

pub fn sea_surface_height_field() -> HeightFieldMetadata {
    HeightFieldMetadata {
        horizontal_crs: HORIZONTAL_CRS_GEOGRAPHIC_2D.to_string(),
        vertical_datum: VerticalDatum::IdealizedMeanSeaLevel,
        vertical_axis: VerticalAxis::PositiveUp,
        unit: "metre".to_string(),
        declared_vertical_error_m: 4_000.0,
    }
}

pub fn bathymetry_depth_field() -> HeightFieldMetadata {
    HeightFieldMetadata {
        horizontal_crs: HORIZONTAL_CRS_GEOGRAPHIC_2D.to_string(),
        vertical_datum: VerticalDatum::DepthBelowIdealizedMeanSeaLevel,
        vertical_axis: VerticalAxis::PositiveDown,
        unit: "metre".to_string(),
        declared_vertical_error_m: 4_000.0,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct GeodeticPosition {
    pub lat_deg: f64,
    pub lon_deg: f64,
    pub ellipsoid_height_m: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct EcefPosition {
    pub x_m: f64,
    pub y_m: f64,
    pub z_m: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct LocalEnu {
    pub east_m: f64,
    pub north_m: f64,
    pub up_m: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct UnrealPositionCm {
    pub x_east_cm: f64,
    pub y_north_cm: f64,
    pub z_up_cm: f64,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct VerticalConversionContext {
    /// Geoid undulation N in h = H + N. Required for WGS84 ellipsoid ↔
    /// NAVD88/GEOID18 fixture conversion.
    pub geoid_undulation_m: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VerticalConversionError {
    MissingGeoidUndulation,
    UnsupportedDatumPair,
    NonFiniteValue,
}

pub fn convert_vertical(
    value_m: f64,
    from: VerticalDatum,
    to: VerticalDatum,
    context: VerticalConversionContext,
) -> Result<f64, VerticalConversionError> {
    if !value_m.is_finite() {
        return Err(VerticalConversionError::NonFiniteValue);
    }
    if from == to {
        return Ok(value_m);
    }
    match (from, to) {
        (VerticalDatum::Wgs84Ellipsoid, VerticalDatum::Navd88Geoid18) => context
            .geoid_undulation_m
            .filter(|value| value.is_finite())
            .map(|undulation| value_m - undulation)
            .ok_or(VerticalConversionError::MissingGeoidUndulation),
        (VerticalDatum::Navd88Geoid18, VerticalDatum::Wgs84Ellipsoid) => context
            .geoid_undulation_m
            .filter(|value| value.is_finite())
            .map(|undulation| value_m + undulation)
            .ok_or(VerticalConversionError::MissingGeoidUndulation),
        (VerticalDatum::IdealizedMeanSeaLevel, VerticalDatum::DepthBelowIdealizedMeanSeaLevel)
        | (VerticalDatum::DepthBelowIdealizedMeanSeaLevel, VerticalDatum::IdealizedMeanSeaLevel) => {
            Ok(-value_m)
        }
        _ => Err(VerticalConversionError::UnsupportedDatumPair),
    }
}

pub fn geodetic_to_ecef(position: GeodeticPosition) -> Option<EcefPosition> {
    if !position.lat_deg.is_finite()
        || !position.lon_deg.is_finite()
        || !position.ellipsoid_height_m.is_finite()
        || !(-90.0..=90.0).contains(&position.lat_deg)
        || !(-180.0..=180.0).contains(&position.lon_deg)
    {
        return None;
    }
    let flattening = 1.0 / WGS84_INV_F;
    let eccentricity_sq = flattening * (2.0 - flattening);
    let lat = position.lat_deg.to_radians();
    let lon = position.lon_deg.to_radians();
    let sin_lat = lat.sin();
    let cos_lat = lat.cos();
    let prime_vertical = WGS84_A_M / (1.0 - eccentricity_sq * sin_lat * sin_lat).sqrt();
    Some(EcefPosition {
        x_m: (prime_vertical + position.ellipsoid_height_m) * cos_lat * lon.cos(),
        y_m: (prime_vertical + position.ellipsoid_height_m) * cos_lat * lon.sin(),
        z_m: (prime_vertical * (1.0 - eccentricity_sq) + position.ellipsoid_height_m) * sin_lat,
    })
}

pub fn ecef_to_local_enu(point: EcefPosition, origin: GeodeticPosition) -> Option<LocalEnu> {
    let origin_ecef = geodetic_to_ecef(origin)?;
    let lat = origin.lat_deg.to_radians();
    let lon = origin.lon_deg.to_radians();
    let dx = point.x_m - origin_ecef.x_m;
    let dy = point.y_m - origin_ecef.y_m;
    let dz = point.z_m - origin_ecef.z_m;
    Some(LocalEnu {
        east_m: -lon.sin() * dx + lon.cos() * dy,
        north_m: -lat.sin() * lon.cos() * dx - lat.sin() * lon.sin() * dy + lat.cos() * dz,
        up_m: lat.cos() * lon.cos() * dx + lat.cos() * lon.sin() * dy + lat.sin() * dz,
    })
}

pub fn enu_to_unreal_cm(position: LocalEnu) -> UnrealPositionCm {
    UnrealPositionCm {
        x_east_cm: position.east_m * 100.0,
        y_north_cm: position.north_m * 100.0,
        z_up_cm: position.up_m * 100.0,
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct GeodesyDiagnostics {
    pub contract_version: &'static str,
    pub geographic_2d_crs: &'static str,
    pub geographic_3d_crs: &'static str,
    pub ecef_crs: &'static str,
    pub cesium_frame: &'static str,
    pub unreal_frame: &'static str,
    pub arbitrary_geoid_conversion: &'static str,
}

pub fn diagnostics() -> GeodesyDiagnostics {
    GeodesyDiagnostics {
        contract_version: CONTRACT_VERSION,
        geographic_2d_crs: HORIZONTAL_CRS_GEOGRAPHIC_2D,
        geographic_3d_crs: HORIZONTAL_CRS_GEOGRAPHIC_3D,
        ecef_crs: HORIZONTAL_CRS_ECEF,
        cesium_frame: "EPSG:4978 ECEF metres",
        unreal_frame: "local ENU centimetres: X east, Y north, Z up",
        arbitrary_geoid_conversion: "fail-closed without a supplied geoid undulation",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct Contract {
        error_budget: ErrorBudget,
        coastal_benchmarks: Vec<Benchmark>,
    }

    #[derive(Deserialize)]
    struct ErrorBudget {
        geodetic_to_ecef_m: f64,
        ecef_to_local_enu_m: f64,
        fixture_vertical_conversion_m: f64,
    }

    #[derive(Deserialize)]
    struct Benchmark {
        lat_deg: f64,
        lon_deg: f64,
        orthometric_height_m: f64,
        geoid_undulation_m: f64,
        ellipsoid_height_m: f64,
        expected_ecef_m: [f64; 3],
        expected_unreal_local_cm: [f64; 3],
    }

    fn contract() -> Contract {
        serde_json::from_str(include_str!("../../../src/data/geodesy-contract.json"))
            .expect("geodesy contract fixture must parse")
    }

    #[test]
    fn coastal_fixture_vertical_conversions_are_explicit_and_reversible() {
        let contract = contract();
        assert_eq!(contract.coastal_benchmarks.len(), 3);
        for fixture in contract.coastal_benchmarks {
            let context = VerticalConversionContext {
                geoid_undulation_m: Some(fixture.geoid_undulation_m),
            };
            let ellipsoid = convert_vertical(
                fixture.orthometric_height_m,
                VerticalDatum::Navd88Geoid18,
                VerticalDatum::Wgs84Ellipsoid,
                context,
            )
            .unwrap();
            assert!(
                (ellipsoid - fixture.ellipsoid_height_m).abs()
                    <= contract.error_budget.fixture_vertical_conversion_m
            );
            let restored = convert_vertical(
                ellipsoid,
                VerticalDatum::Wgs84Ellipsoid,
                VerticalDatum::Navd88Geoid18,
                context,
            )
            .unwrap();
            assert!(
                (restored - fixture.orthometric_height_m).abs()
                    <= contract.error_budget.fixture_vertical_conversion_m
            );
        }
    }

    #[test]
    fn cesium_ecef_and_unreal_local_frames_match_contract_fixtures() {
        let contract = contract();
        for fixture in contract.coastal_benchmarks {
            let position = GeodeticPosition {
                lat_deg: fixture.lat_deg,
                lon_deg: fixture.lon_deg,
                ellipsoid_height_m: fixture.ellipsoid_height_m,
            };
            let ecef = geodetic_to_ecef(position).unwrap();
            for (actual, expected) in [ecef.x_m, ecef.y_m, ecef.z_m]
                .into_iter()
                .zip(fixture.expected_ecef_m)
            {
                assert!((actual - expected).abs() <= contract.error_budget.geodetic_to_ecef_m);
            }
            let origin = GeodeticPosition {
                ellipsoid_height_m: 0.0,
                ..position
            };
            let unreal = enu_to_unreal_cm(ecef_to_local_enu(ecef, origin).unwrap());
            for (actual, expected) in [unreal.x_east_cm, unreal.y_north_cm, unreal.z_up_cm]
                .into_iter()
                .zip(fixture.expected_unreal_local_cm)
            {
                assert!(
                    (actual - expected).abs() <= contract.error_budget.ecef_to_local_enu_m * 100.0
                );
            }
        }
    }

    #[test]
    fn arbitrary_datum_conversion_fails_closed_without_a_model_value() {
        assert_eq!(
            convert_vertical(
                0.0,
                VerticalDatum::Wgs84Ellipsoid,
                VerticalDatum::Navd88Geoid18,
                VerticalConversionContext::default(),
            ),
            Err(VerticalConversionError::MissingGeoidUndulation),
        );
        assert_eq!(
            convert_vertical(
                0.0,
                VerticalDatum::IdealizedMeanSeaLevel,
                VerticalDatum::Wgs84Ellipsoid,
                VerticalConversionContext::default(),
            ),
            Err(VerticalConversionError::UnsupportedDatumPair),
        );
    }
}
