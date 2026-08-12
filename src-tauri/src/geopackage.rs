//! Bounded OGC GeoPackage writer for GIS handoff.
//!
//! The frontend supplies already-computed, presentation-ready vector products
//! and provenance. This module owns the file format, CRS contract, geometry
//! validation, and publication boundary so a malformed or unexpectedly large
//! export cannot become a partial GIS artifact.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const GEOPACKAGE_SCHEMA_VERSION: u32 = 1;
pub const MAX_REQUEST_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_OUTPUT_BYTES: u64 = 128 * 1024 * 1024;
pub const MAX_LAYERS: usize = 8;
pub const MAX_FEATURES_PER_LAYER: usize = 2_000;
pub const MAX_TOTAL_FEATURES: usize = 6_000;
pub const MAX_VERTICES_PER_FEATURE: usize = 10_000;
pub const MAX_TOTAL_VERTICES: usize = 1_000_000;
pub const MAX_PROPERTY_BYTES: usize = 64 * 1024;
pub const MAX_METADATA_BYTES: usize = 512 * 1024;

const WGS84_SRS_ID: i32 = 4326;
const WGS84_DEFINITION: &str = r#"GEOGCRS["WGS 84",DATUM["World Geodetic System 1984",ELLIPSOID["WGS 84",6378137,298.257223563,LENGTHUNIT["metre",1]]],PRIMEM["Greenwich",0,ANGLEUNIT["degree",0.0174532925199433]],CS[ellipsoidal,2],AXIS["geodetic latitude (Lat)",north,ORDER[1],ANGLEUNIT["degree",0.0174532925199433]],AXIS["geodetic longitude (Lon)",east,ORDER[2],ANGLEUNIT["degree",0.0174532925199433]],USAGE[SCOPE["Horizontal component of 3D system."],AREA["World."],BBOX[-90,-180,90,180]],ID["EPSG",4326]]"#;

const ALLOWED_TABLES: &[&str] = &[
    "source_geometry",
    "source_footprints",
    "fault_geometry",
    "gauges",
    "runup",
    "arrival_isochrones",
    "direct_effect_polygons",
];

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeoPackageExportRequest {
    pub schema_version: u32,
    pub title: String,
    pub metadata: GeoPackageMetadata,
    pub layers: Vec<GeoPackageLayer>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeoPackageMetadata {
    pub scenario: String,
    pub scenario_type: String,
    pub generated_at: String,
    pub horizontal_crs: String,
    pub horizontal_datum: String,
    pub vertical_datum: String,
    pub horizontal_units: String,
    pub vertical_units: String,
    pub display_unit_system: String,
    pub quality_status: String,
    pub quality: Value,
    pub solver_mode: String,
    pub limitation: String,
    pub citation_reference: String,
    pub citation_url: Option<String>,
    pub citations: Vec<String>,
    pub evidence_ids: Vec<String>,
    pub app_version: String,
    pub asset_registry_version: String,
    pub bathymetry_asset_id: String,
    pub bathymetry_source: String,
    pub source_digest: String,
    pub data_digest: String,
    pub provenance: Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeoPackageLayer {
    pub table_name: String,
    pub description: String,
    pub features: Vec<GeoPackageFeature>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeoPackageFeature {
    pub id: String,
    pub name: String,
    pub geometry: GeoPackageGeometry,
    pub properties: Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", content = "coordinates")]
pub enum GeoPackageGeometry {
    #[serde(rename = "Point")]
    Point([f64; 2]),
    #[serde(rename = "LineString")]
    LineString(Vec<[f64; 2]>),
    #[serde(rename = "Polygon")]
    Polygon(Vec<Vec<[f64; 2]>>),
    #[serde(rename = "MultiLineString")]
    MultiLineString(Vec<Vec<[f64; 2]>>),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeoPackageSummary {
    pub bytes: u64,
    pub layers: usize,
    pub features: usize,
    pub vertices: usize,
    pub source_digest: String,
    pub data_digest: String,
}

#[derive(Debug, Clone, Copy)]
struct GeometryInfo {
    type_name: &'static str,
    vertices: usize,
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
}

#[derive(Debug, Clone, Copy)]
struct ValidationSummary {
    layers: usize,
    features: usize,
    vertices: usize,
}

fn checked_add(total: &mut usize, value: usize, label: &str) -> Result<(), String> {
    *total = total
        .checked_add(value)
        .ok_or_else(|| format!("GeoPackage {label} size overflow"))?;
    Ok(())
}

fn validate_text(label: &str, value: &str, maximum: usize, allow_empty: bool) -> Result<(), String> {
    if (!allow_empty && value.is_empty()) || value.len() > maximum || value.contains('\0') {
        return Err(format!("GeoPackage {label} is empty, contains NUL, or exceeds {maximum} bytes"));
    }
    Ok(())
}

fn validate_digest(label: &str, value: &str) -> Result<(), String> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(format!("GeoPackage {label} must be a 64-character SHA-256 digest"));
    }
    Ok(())
}

fn validate_coordinate(coordinate: [f64; 2]) -> Result<(), String> {
    let [lon, lat] = coordinate;
    if !lon.is_finite() || !lat.is_finite() || !(-180.0..=180.0).contains(&lon) || !(-90.0..=90.0).contains(&lat) {
        return Err(format!("GeoPackage coordinate [{lon}, {lat}] is outside WGS84 bounds or is not finite"));
    }
    Ok(())
}

fn update_bbox(
    coordinate: [f64; 2],
    min_x: &mut f64,
    min_y: &mut f64,
    max_x: &mut f64,
    max_y: &mut f64,
) {
    *min_x = (*min_x).min(coordinate[0]);
    *min_y = (*min_y).min(coordinate[1]);
    *max_x = (*max_x).max(coordinate[0]);
    *max_y = (*max_y).max(coordinate[1]);
}

fn geometry_info(geometry: &GeoPackageGeometry) -> Result<GeometryInfo, String> {
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    let mut vertices = 0_usize;
    let mut add_coordinate = |coordinate: [f64; 2]| -> Result<(), String> {
        validate_coordinate(coordinate)?;
        checked_add(&mut vertices, 1, "vertex")?;
        update_bbox(coordinate, &mut min_x, &mut min_y, &mut max_x, &mut max_y);
        Ok(())
    };

    let type_name = match geometry {
        GeoPackageGeometry::Point(coordinate) => {
            add_coordinate(*coordinate)?;
            "POINT"
        }
        GeoPackageGeometry::LineString(coordinates) => {
            if coordinates.len() < 2 {
                return Err("GeoPackage LineString must contain at least two vertices".into());
            }
            for coordinate in coordinates {
                add_coordinate(*coordinate)?;
            }
            "LINESTRING"
        }
        GeoPackageGeometry::Polygon(rings) => {
            if rings.is_empty() {
                return Err("GeoPackage Polygon must contain at least one ring".into());
            }
            for ring in rings {
                if ring.len() < 4 || ring.first() != ring.last() {
                    return Err("GeoPackage Polygon rings must contain at least four closed vertices".into());
                }
                for coordinate in ring {
                    add_coordinate(*coordinate)?;
                }
            }
            "POLYGON"
        }
        GeoPackageGeometry::MultiLineString(lines) => {
            if lines.is_empty() {
                return Err("GeoPackage MultiLineString must contain at least one line".into());
            }
            for line in lines {
                if line.len() < 2 {
                    return Err("GeoPackage MultiLineString members must contain at least two vertices".into());
                }
                for coordinate in line {
                    add_coordinate(*coordinate)?;
                }
            }
            "MULTILINESTRING"
        }
    };

    if vertices > MAX_VERTICES_PER_FEATURE {
        return Err(format!(
            "GeoPackage feature has {vertices} vertices; the limit is {MAX_VERTICES_PER_FEATURE}"
        ));
    }
    Ok(GeometryInfo { type_name, vertices, min_x, min_y, max_x, max_y })
}

fn validate_request(request: &GeoPackageExportRequest) -> Result<ValidationSummary, String> {
    if request.schema_version != GEOPACKAGE_SCHEMA_VERSION {
        return Err(format!(
            "GeoPackage request schema {} is unsupported; expected {GEOPACKAGE_SCHEMA_VERSION}",
            request.schema_version
        ));
    }
    validate_text("title", &request.title, 256, false)?;
    let metadata = &request.metadata;
    for (label, value, maximum, allow_empty) in [
        ("scenario", metadata.scenario.as_str(), 256, false),
        ("scenario type", metadata.scenario_type.as_str(), 128, false),
        ("generated_at", metadata.generated_at.as_str(), 64, false),
        ("horizontal CRS", metadata.horizontal_crs.as_str(), 64, false),
        ("horizontal datum", metadata.horizontal_datum.as_str(), 128, false),
        ("vertical datum", metadata.vertical_datum.as_str(), 128, false),
        ("horizontal units", metadata.horizontal_units.as_str(), 64, false),
        ("vertical units", metadata.vertical_units.as_str(), 64, false),
        ("display unit system", metadata.display_unit_system.as_str(), 32, false),
        ("quality status", metadata.quality_status.as_str(), 64, false),
        ("solver mode", metadata.solver_mode.as_str(), 512, false),
        ("limitation", metadata.limitation.as_str(), 2_048, false),
        ("citation reference", metadata.citation_reference.as_str(), 1_024, false),
        ("app version", metadata.app_version.as_str(), 64, false),
        ("asset registry version", metadata.asset_registry_version.as_str(), 128, false),
        ("bathymetry asset id", metadata.bathymetry_asset_id.as_str(), 256, false),
        ("bathymetry source", metadata.bathymetry_source.as_str(), 2_048, false),
    ] {
        validate_text(label, value, maximum, allow_empty)?;
    }
    if metadata.horizontal_crs != "EPSG:4326" {
        return Err("GeoPackage writer currently accepts only EPSG:4326 coordinates".into());
    }
    if let Some(url) = &metadata.citation_url {
        validate_text("citation URL", url, 2_048, false)?;
    }
    validate_digest("sourceDigest", &metadata.source_digest)?;
    validate_digest("dataDigest", &metadata.data_digest)?;
    if metadata.citations.len() > 64 || metadata.evidence_ids.len() > 512 {
        return Err("GeoPackage citation or evidence list exceeds its limit".into());
    }
    for citation in &metadata.citations {
        validate_text("citation", citation, 2_048, false)?;
    }
    for evidence_id in &metadata.evidence_ids {
        validate_text("evidence id", evidence_id, 256, false)?;
    }
    let quality_bytes = serde_json::to_vec(&metadata.quality)
        .map_err(|error| format!("GeoPackage quality metadata is not serializable: {error}"))?;
    let provenance_bytes = serde_json::to_vec(&metadata.provenance)
        .map_err(|error| format!("GeoPackage provenance metadata is not serializable: {error}"))?;
    if quality_bytes.len() > MAX_METADATA_BYTES || provenance_bytes.len() > MAX_METADATA_BYTES {
        return Err("GeoPackage quality or provenance metadata exceeds its size limit".into());
    }

    if request.layers.is_empty() || request.layers.len() > MAX_LAYERS {
        return Err(format!("GeoPackage must contain 1-{MAX_LAYERS} non-empty layers"));
    }
    let mut table_names = HashSet::new();
    let mut total_features = 0_usize;
    let mut total_vertices = 0_usize;
    let mut estimated_bytes = request.title.len()
        .saturating_add(metadata.scenario.len())
        .saturating_add(metadata.citation_reference.len())
        .saturating_add(quality_bytes.len())
        .saturating_add(provenance_bytes.len());
    for layer in &request.layers {
        if !ALLOWED_TABLES.contains(&layer.table_name.as_str()) {
            return Err(format!("GeoPackage layer '{}' is not allowed", layer.table_name));
        }
        if !table_names.insert(layer.table_name.clone()) {
            return Err(format!("GeoPackage layer '{}' is repeated", layer.table_name));
        }
        validate_text("layer description", &layer.description, 1_024, false)?;
        if layer.features.is_empty() || layer.features.len() > MAX_FEATURES_PER_LAYER {
            return Err(format!(
                "GeoPackage layer '{}' must contain 1-{MAX_FEATURES_PER_LAYER} features",
                layer.table_name
            ));
        }
        let mut layer_type = None;
        for feature in &layer.features {
            validate_text("feature id", &feature.id, 128, false)?;
            validate_text("feature name", &feature.name, 256, false)?;
            let geometry = geometry_info(&feature.geometry)?;
            if let Some(expected) = layer_type {
                if expected != geometry.type_name {
                    return Err(format!(
                        "GeoPackage layer '{}' mixes geometry types",
                        layer.table_name
                    ));
                }
            } else {
                layer_type = Some(geometry.type_name);
            }
            let properties = serde_json::to_vec(&feature.properties)
                .map_err(|error| format!("GeoPackage feature properties are not serializable: {error}"))?;
            if properties.len() > MAX_PROPERTY_BYTES {
                return Err(format!(
                    "GeoPackage feature '{}' properties exceed {MAX_PROPERTY_BYTES} bytes",
                    feature.id
                ));
            }
            checked_add(&mut total_features, 1, "feature")?;
            checked_add(&mut total_vertices, geometry.vertices, "vertex")?;
            checked_add(&mut estimated_bytes, feature.id.len(), "request")?;
            checked_add(&mut estimated_bytes, feature.name.len(), "request")?;
            checked_add(&mut estimated_bytes, properties.len(), "request")?;
            checked_add(&mut estimated_bytes, geometry.vertices.saturating_mul(16), "request")?;
        }
    }
    if total_features > MAX_TOTAL_FEATURES {
        return Err(format!(
            "GeoPackage contains {total_features} features; the limit is {MAX_TOTAL_FEATURES}"
        ));
    }
    if total_vertices > MAX_TOTAL_VERTICES {
        return Err(format!(
            "GeoPackage contains {total_vertices} vertices; the limit is {MAX_TOTAL_VERTICES}"
        ));
    }
    if estimated_bytes > MAX_REQUEST_BYTES {
        return Err(format!(
            "GeoPackage request exceeds the {MAX_REQUEST_BYTES}-byte budget"
        ));
    }
    Ok(ValidationSummary { layers: request.layers.len(), features: total_features, vertices: total_vertices })
}

fn push_u32(bytes: &mut Vec<u8>, value: u32) {
    bytes.extend_from_slice(&value.to_le_bytes());
}

fn push_f64(bytes: &mut Vec<u8>, value: f64) {
    bytes.extend_from_slice(&value.to_le_bytes());
}

fn push_wkb_coordinate(bytes: &mut Vec<u8>, coordinate: [f64; 2]) {
    push_f64(bytes, coordinate[0]);
    push_f64(bytes, coordinate[1]);
}

fn geometry_wkb(geometry: &GeoPackageGeometry) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.push(1); // WKB little-endian byte order.
    match geometry {
        GeoPackageGeometry::Point(coordinate) => {
            push_u32(&mut bytes, 1);
            push_wkb_coordinate(&mut bytes, *coordinate);
        }
        GeoPackageGeometry::LineString(coordinates) => {
            push_u32(&mut bytes, 2);
            push_u32(&mut bytes, coordinates.len() as u32);
            for coordinate in coordinates {
                push_wkb_coordinate(&mut bytes, *coordinate);
            }
        }
        GeoPackageGeometry::Polygon(rings) => {
            push_u32(&mut bytes, 3);
            push_u32(&mut bytes, rings.len() as u32);
            for ring in rings {
                push_u32(&mut bytes, ring.len() as u32);
                for coordinate in ring {
                    push_wkb_coordinate(&mut bytes, *coordinate);
                }
            }
        }
        GeoPackageGeometry::MultiLineString(lines) => {
            push_u32(&mut bytes, 5);
            push_u32(&mut bytes, lines.len() as u32);
            for line in lines {
                bytes.push(1);
                push_u32(&mut bytes, 2);
                push_u32(&mut bytes, line.len() as u32);
                for coordinate in line {
                    push_wkb_coordinate(&mut bytes, *coordinate);
                }
            }
        }
    }
    bytes
}

fn geometry_blob(geometry: &GeoPackageGeometry, info: GeometryInfo) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(48);
    bytes.extend_from_slice(b"GP");
    bytes.push(0); // GeoPackageBinary version 0.
    bytes.push(0b0000_0011); // little endian + XY envelope.
    bytes.extend_from_slice(&WGS84_SRS_ID.to_le_bytes());
    push_f64(&mut bytes, info.min_x);
    push_f64(&mut bytes, info.max_x);
    push_f64(&mut bytes, info.min_y);
    push_f64(&mut bytes, info.max_y);
    bytes.extend_from_slice(&geometry_wkb(geometry));
    bytes
}

fn create_core_schema(transaction: &Transaction<'_>) -> Result<(), String> {
    transaction
        .execute_batch(
            r#"
            CREATE TABLE gpkg_spatial_ref_sys (
                srs_name TEXT NOT NULL,
                srs_id INTEGER PRIMARY KEY NOT NULL,
                organization TEXT NOT NULL,
                organization_coordsys_id INTEGER NOT NULL,
                definition TEXT NOT NULL,
                description TEXT
            );
            CREATE TABLE gpkg_contents (
                table_name TEXT PRIMARY KEY NOT NULL,
                data_type TEXT NOT NULL,
                identifier TEXT UNIQUE NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                last_change DATETIME NOT NULL,
                min_x DOUBLE,
                min_y DOUBLE,
                max_x DOUBLE,
                max_y DOUBLE,
                srs_id INTEGER
            );
            CREATE TABLE gpkg_geometry_columns (
                table_name TEXT NOT NULL,
                column_name TEXT NOT NULL,
                geometry_type_name TEXT NOT NULL,
                srs_id INTEGER NOT NULL,
                z TINYINT NOT NULL,
                m TINYINT NOT NULL,
                CONSTRAINT pk_gpkg_geometry_columns PRIMARY KEY (table_name, column_name)
            );
            CREATE TABLE cataclysm_metadata (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL
            );
            "#,
        )
        .map_err(|error| format!("failed to create GeoPackage core tables: {error}"))?;
    transaction
        .execute(
            "INSERT INTO gpkg_spatial_ref_sys (srs_name, srs_id, organization, organization_coordsys_id, definition, description) VALUES ('WGS 84', 4326, 'EPSG', 4326, ?1, 'WGS84 geographic coordinates; longitude/latitude in degrees')",
            params![WGS84_DEFINITION],
        )
        .map_err(|error| format!("failed to register WGS84 CRS: {error}"))?;
    transaction
        .execute(
            "INSERT INTO gpkg_spatial_ref_sys (srs_name, srs_id, organization, organization_coordsys_id, definition, description) VALUES ('Undefined Cartesian', -1, 'NONE', -1, 'undefined', 'undefined Cartesian coordinate reference system')",
            [],
        )
        .map_err(|error| format!("failed to register undefined Cartesian CRS: {error}"))?;
    transaction
        .execute(
            "INSERT INTO gpkg_spatial_ref_sys (srs_name, srs_id, organization, organization_coordsys_id, definition, description) VALUES ('Undefined geographic', 0, 'NONE', 0, 'undefined', 'undefined geographic coordinate reference system')",
            [],
        )
        .map_err(|error| format!("failed to register undefined geographic CRS: {error}"))?;
    Ok(())
}

fn metadata_entries(
    request: &GeoPackageExportRequest,
    summary: ValidationSummary,
) -> Result<Vec<(String, String)>, String> {
    let metadata = &request.metadata;
    let quality = serde_json::to_string(&metadata.quality)
        .map_err(|error| format!("failed to serialize GeoPackage quality metadata: {error}"))?;
    let provenance = serde_json::to_string(&metadata.provenance)
        .map_err(|error| format!("failed to serialize GeoPackage provenance metadata: {error}"))?;
    let citations = serde_json::to_string(&metadata.citations)
        .map_err(|error| format!("failed to serialize GeoPackage citations: {error}"))?;
    let evidence_ids = serde_json::to_string(&metadata.evidence_ids)
        .map_err(|error| format!("failed to serialize GeoPackage evidence IDs: {error}"))?;
    let feature_counts = request
        .layers
        .iter()
        .map(|layer| (layer.table_name.clone(), layer.features.len()))
        .collect::<std::collections::BTreeMap<_, _>>();
    let counts = serde_json::to_string(&feature_counts)
        .map_err(|error| format!("failed to serialize GeoPackage feature counts: {error}"))?;
    Ok(vec![
        ("gpkg_version".into(), "1.4.0".into()),
        ("title".into(), request.title.clone()),
        ("scenario".into(), metadata.scenario.clone()),
        ("scenario_type".into(), metadata.scenario_type.clone()),
        ("generated_at".into(), metadata.generated_at.clone()),
        ("horizontal_crs".into(), metadata.horizontal_crs.clone()),
        ("horizontal_datum".into(), metadata.horizontal_datum.clone()),
        ("vertical_datum".into(), metadata.vertical_datum.clone()),
        ("horizontal_units".into(), metadata.horizontal_units.clone()),
        ("vertical_units".into(), metadata.vertical_units.clone()),
        ("display_unit_system".into(), metadata.display_unit_system.clone()),
        ("quality_status".into(), metadata.quality_status.clone()),
        ("quality_json".into(), quality),
        ("solver_mode".into(), metadata.solver_mode.clone()),
        ("limitation".into(), metadata.limitation.clone()),
        ("citation_reference".into(), metadata.citation_reference.clone()),
        ("citation_url".into(), metadata.citation_url.clone().unwrap_or_default()),
        ("citations_json".into(), citations),
        ("evidence_ids_json".into(), evidence_ids),
        ("app_version".into(), metadata.app_version.clone()),
        ("asset_registry_version".into(), metadata.asset_registry_version.clone()),
        ("bathymetry_asset_id".into(), metadata.bathymetry_asset_id.clone()),
        ("bathymetry_source".into(), metadata.bathymetry_source.clone()),
        ("source_sha256".into(), metadata.source_digest.clone()),
        ("data_sha256".into(), metadata.data_digest.clone()),
        ("feature_counts_json".into(), counts),
        ("layer_count".into(), summary.layers.to_string()),
        ("feature_count".into(), summary.features.to_string()),
        ("vertex_count".into(), summary.vertices.to_string()),
        ("provenance_json".into(), provenance),
    ])
}

fn create_layer(
    transaction: &Transaction<'_>,
    layer: &GeoPackageLayer,
) -> Result<(), String> {
    let first = layer
        .features
        .first()
        .ok_or_else(|| format!("GeoPackage layer '{}' is empty", layer.table_name))?;
    let first_info = geometry_info(&first.geometry)?;
    let table = &layer.table_name;
    let create_sql = format!(
        r#"CREATE TABLE "{table}" (
            fid INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
            feature_id TEXT NOT NULL,
            name TEXT NOT NULL,
            geom BLOB NOT NULL,
            properties_json TEXT NOT NULL
        )"#
    );
    transaction
        .execute(&create_sql, [])
        .map_err(|error| format!("failed to create GeoPackage layer '{table}': {error}"))?;

    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    let insert_sql = format!(
        "INSERT INTO \"{table}\" (feature_id, name, geom, properties_json) VALUES (?1, ?2, ?3, ?4)"
    );
    for feature in &layer.features {
        let info = geometry_info(&feature.geometry)?;
        update_bbox([info.min_x, info.min_y], &mut min_x, &mut min_y, &mut max_x, &mut max_y);
        update_bbox([info.max_x, info.max_y], &mut min_x, &mut min_y, &mut max_x, &mut max_y);
        let properties = serde_json::to_string(&feature.properties)
            .map_err(|error| format!("failed to serialize feature '{}': {error}", feature.id))?;
        transaction
            .execute(
                &insert_sql,
                params![feature.id, feature.name, geometry_blob(&feature.geometry, info), properties],
            )
            .map_err(|error| format!("failed to write feature '{}' in '{table}': {error}", feature.id))?;
    }
    transaction
        .execute(
            "INSERT INTO gpkg_contents (table_name, data_type, identifier, description, last_change, min_x, min_y, max_x, max_y, srs_id) VALUES (?1, 'features', ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?4, ?5, ?6, ?7, ?8)",
            params![table, table, layer.description, min_x, min_y, max_x, max_y, WGS84_SRS_ID],
        )
        .map_err(|error| format!("failed to register GeoPackage contents for '{table}': {error}"))?;
    transaction
        .execute(
            "INSERT INTO gpkg_geometry_columns (table_name, column_name, geometry_type_name, srs_id, z, m) VALUES (?1, 'geom', ?2, ?3, 0, 0)",
            params![table, first_info.type_name, WGS84_SRS_ID],
        )
        .map_err(|error| format!("failed to register GeoPackage geometry columns for '{table}': {error}"))?;
    Ok(())
}

fn write_inner(request: &GeoPackageExportRequest, temporary: &Path, summary: ValidationSummary) -> Result<(), String> {
    let mut connection = Connection::open(temporary)
        .map_err(|error| format!("failed to create GeoPackage SQLite file: {error}"))?;
    connection
        .execute_batch(
            "PRAGMA auto_vacuum = INCREMENTAL; PRAGMA page_size = 4096; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA application_id = 0x47504b47; PRAGMA user_version = 10400;",
        )
        .map_err(|error| format!("failed to configure GeoPackage SQLite file: {error}"))?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("failed to begin GeoPackage transaction: {error}"))?;
    create_core_schema(&transaction)?;
    for (key, value) in metadata_entries(request, summary)? {
        transaction
            .execute(
                "INSERT INTO cataclysm_metadata (key, value) VALUES (?1, ?2)",
                params![key, value],
            )
            .map_err(|error| format!("failed to write GeoPackage metadata: {error}"))?;
    }
    for layer in &request.layers {
        create_layer(&transaction, layer)?;
    }
    transaction
        .commit()
        .map_err(|error| format!("failed to commit GeoPackage transaction: {error}"))?;
    connection
        .execute_batch("PRAGMA optimize;")
        .map_err(|error| format!("failed to finalize GeoPackage SQLite file: {error}"))?;
    Ok(())
}

fn temporary_path(destination: &Path) -> Result<PathBuf, String> {
    let parent = destination.parent().filter(|path| !path.as_os_str().is_empty()).unwrap_or_else(|| Path::new("."));
    if !parent.is_dir() {
        return Err("GeoPackage destination parent directory does not exist".into());
    }
    let name = destination
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "GeoPackage destination must have a UTF-8 file name".to_string())?;
    if name.is_empty() || name.contains('\0') {
        return Err("GeoPackage destination file name is invalid".into());
    }
    if destination
        .extension()
        .and_then(|value| value.to_str())
        .is_none_or(|extension| !extension.eq_ignore_ascii_case("gpkg"))
    {
        return Err("GeoPackage destination must use the .gpkg extension".into());
    }
    let temporary = parent.join(format!(".{name}.cataclysm-gpkg.tmp"));
    if temporary.exists() {
        return Err("a previous GeoPackage export is still being finalized; choose another destination".into());
    }
    Ok(temporary)
}

/// Validate and atomically publish a bounded GeoPackage.
pub fn write_geopackage(
    request: &GeoPackageExportRequest,
    destination: &Path,
) -> Result<GeoPackageSummary, String> {
    let validation = validate_request(request)?;
    let temporary = temporary_path(destination)?;
    let write_result = write_inner(request, &temporary, validation);
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    let bytes = fs::metadata(&temporary)
        .map_err(|error| format!("failed to inspect temporary GeoPackage: {error}"))?
        .len();
    if bytes == 0 || bytes > MAX_OUTPUT_BYTES {
        let _ = fs::remove_file(&temporary);
        return Err(format!("GeoPackage output is empty or exceeds the {MAX_OUTPUT_BYTES}-byte limit"));
    }

    let backup = destination.with_file_name(format!(
        ".{}.cataclysm-gpkg-backup",
        destination.file_name().and_then(|value| value.to_str()).unwrap_or("output")
    ));
    if backup.exists() {
        let _ = fs::remove_file(&temporary);
        return Err("a previous GeoPackage backup is still present; choose another destination".into());
    }
    let had_existing = destination.exists();
    if had_existing {
        if !destination.is_file() {
            let _ = fs::remove_file(&temporary);
            return Err("GeoPackage destination is not a regular file".into());
        }
        fs::rename(destination, &backup)
            .map_err(|error| {
                let _ = fs::remove_file(&temporary);
                format!("failed to stage the previous GeoPackage destination: {error}")
            })?;
    }
    if let Err(error) = fs::rename(&temporary, destination) {
        if had_existing {
            let _ = fs::rename(&backup, destination);
        }
        let _ = fs::remove_file(&temporary);
        return Err(format!("failed to publish GeoPackage: {error}"));
    }
    if had_existing {
        let _ = fs::remove_file(&backup);
    }
    Ok(GeoPackageSummary {
        bytes,
        layers: validation.layers,
        features: validation.features,
        vertices: validation.vertices,
        source_digest: request.metadata.source_digest.clone(),
        data_digest: request.metadata.data_digest.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use serde_json::json;
    use tempfile::tempdir;

    fn request() -> GeoPackageExportRequest {
        GeoPackageExportRequest {
            schema_version: GEOPACKAGE_SCHEMA_VERSION,
            title: "round trip".into(),
            metadata: GeoPackageMetadata {
                scenario: "Fixture scenario".into(),
                scenario_type: "Earthquake".into(),
                generated_at: "2026-08-12T00:00:00.000Z".into(),
                horizontal_crs: "EPSG:4326".into(),
                horizontal_datum: "WGS 84".into(),
                vertical_datum: "idealized_mean_sea_level".into(),
                horizontal_units: "degrees".into(),
                vertical_units: "metre".into(),
                display_unit_system: "metric".into(),
                quality_status: "pass".into(),
                quality: json!({"status":"pass","finite_fields":true}),
                solver_mode: "fixture".into(),
                limitation: "Educational only".into(),
                citation_reference: "Fixture citation".into(),
                citation_url: Some("https://example.test/citation".into()),
                citations: vec!["Fixture citation".into()],
                evidence_ids: vec!["fixture-source".into()],
                app_version: "0.14.0".into(),
                asset_registry_version: "fixture".into(),
                bathymetry_asset_id: "fixture-bathy".into(),
                bathymetry_source: "fixture".into(),
                source_digest: "a".repeat(64),
                data_digest: "b".repeat(64),
                provenance: json!({"scenario":"Fixture scenario"}),
            },
            layers: vec![
                GeoPackageLayer {
                    table_name: "source_geometry".into(),
                    description: "Source location".into(),
                    features: vec![GeoPackageFeature {
                        id: "source".into(),
                        name: "Source".into(),
                        geometry: GeoPackageGeometry::Point([10.0, 20.0]),
                        properties: json!({"datum":"WGS 84","unit":"metre"}),
                    }],
                },
                GeoPackageLayer {
                    table_name: "source_footprints".into(),
                    description: "Source footprint".into(),
                    features: vec![GeoPackageFeature {
                        id: "footprint".into(),
                        name: "Footprint".into(),
                        geometry: GeoPackageGeometry::Polygon(vec![vec![
                            [9.0, 19.0], [11.0, 19.0], [11.0, 21.0], [9.0, 19.0],
                        ]]),
                        properties: json!({"quality":"screening_estimate"}),
                    }],
                },
                GeoPackageLayer {
                    table_name: "arrival_isochrones".into(),
                    description: "Arrival contours".into(),
                    features: vec![GeoPackageFeature {
                        id: "arrival-60".into(),
                        name: "T+60 s".into(),
                        geometry: GeoPackageGeometry::MultiLineString(vec![vec![
                            [9.0, 20.0], [10.0, 20.5], [11.0, 20.0],
                        ]]),
                        properties: json!({"arrival_time_s":60}),
                    }],
                },
            ],
        }
    }

    #[test]
    fn writes_round_trip_core_tables_geometry_and_metadata() {
        let directory = tempdir().unwrap();
        let destination = directory.path().join("fixture.gpkg");
        let summary = write_geopackage(&request(), &destination).unwrap();
        assert!(summary.bytes > 0);
        assert_eq!(summary.layers, 3);
        assert_eq!(summary.features, 3);
        let connection = Connection::open(&destination).unwrap();
        assert_eq!(connection.query_row("PRAGMA application_id", [], |row| row.get::<_, i64>(0)).unwrap(), 0x47504b47);
        assert_eq!(connection.query_row("SELECT definition FROM gpkg_spatial_ref_sys WHERE srs_id = 4326", [], |row| row.get::<_, String>(0)).unwrap(), WGS84_DEFINITION);
        assert_eq!(connection.query_row("SELECT value FROM cataclysm_metadata WHERE key = 'source_sha256'", [], |row| row.get::<_, String>(0)).unwrap(), "a".repeat(64));
        assert_eq!(connection.query_row("SELECT COUNT(*) FROM gpkg_contents", [], |row| row.get::<_, i64>(0)).unwrap(), 3);
        let blob: Vec<u8> = connection.query_row("SELECT geom FROM source_footprints", [], |row| row.get(0)).unwrap();
        assert_eq!(&blob[0..2], b"GP");
        assert_eq!(blob[2], 0);
        assert_eq!(blob[3], 0b11);
        assert_eq!(i32::from_le_bytes(blob[4..8].try_into().unwrap()), 4326);
        assert_eq!(blob[40], 1);
        assert_eq!(u32::from_le_bytes(blob[41..45].try_into().unwrap()), 3);
    }

    #[test]
    fn rejects_nonfinite_geometry_before_publishing_any_file() {
        let directory = tempdir().unwrap();
        let destination = directory.path().join("invalid.gpkg");
        let mut invalid = request();
        invalid.layers[0].features[0].geometry = GeoPackageGeometry::Point([f64::NAN, 20.0]);
        let error = write_geopackage(&invalid, &destination).unwrap_err();
        assert!(error.contains("outside WGS84 bounds") || error.contains("not finite"));
        assert!(!destination.exists());
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 0);
    }

    #[test]
    fn rejects_mixed_geometry_and_oversized_properties() {
        let mut mixed = request();
        mixed.layers[0].features.push(GeoPackageFeature {
            id: "line".into(),
            name: "Line".into(),
            geometry: GeoPackageGeometry::LineString(vec![[10.0, 20.0], [11.0, 21.0]]),
            properties: json!({}),
        });
        assert!(validate_request(&mixed).unwrap_err().contains("mixes geometry types"));

        let mut oversized = request();
        oversized.layers[0].features[0].properties = json!({"payload":"x".repeat(MAX_PROPERTY_BYTES)});
        assert!(validate_request(&oversized).unwrap_err().contains("properties exceed"));
    }
}
