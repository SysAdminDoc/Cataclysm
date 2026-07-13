use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

const COASTAL_POINTS_JSON: &str = include_str!("../../../src/data/coastal_points.json");

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ProvenanceConfidence {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ProvenanceRecord {
    pub record_id: String,
    pub source: String,
    pub source_url: Option<String>,
    pub method: String,
    pub datum: String,
    pub resolution: String,
    pub observed_or_published: String,
    pub confidence: ProvenanceConfidence,
    pub uncertainty_value: Option<f64>,
    pub uncertainty_unit: String,
    pub uncertainty_basis: String,
    pub placeholder: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct MeasurementProvenance {
    pub sample_id: String,
    #[serde(flatten)]
    pub record: ProvenanceRecord,
}

#[derive(Debug, Clone, Deserialize)]
struct BundledPoint {
    id: String,
    name: String,
    role: String,
    lat: f64,
    lon: f64,
    beach_slope_deg: f64,
    offshore_depth_m: f64,
    slope_provenance_id: String,
    depth_provenance_id: String,
}

#[derive(Debug, Deserialize)]
struct Metadata {
    provenance_records: HashMap<String, ProvenanceRecord>,
}

#[derive(Debug, Deserialize)]
struct Database {
    #[serde(rename = "_meta")]
    meta: Metadata,
    points: Vec<BundledPoint>,
}

#[derive(Debug, Clone)]
pub struct CoastalRunupPoint {
    pub id: String,
    pub name: String,
    pub lat: f64,
    pub lon: f64,
    pub beach_slope_deg: f64,
    pub offshore_depth_m: f64,
    pub slope_provenance: MeasurementProvenance,
    pub depth_provenance: MeasurementProvenance,
}

static DATABASE: OnceLock<Result<Database, String>> = OnceLock::new();

fn nonempty(label: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("coastal provenance {label} must not be empty"))
    } else {
        Ok(())
    }
}

fn validate_record(key: &str, record: &ProvenanceRecord) -> Result<(), String> {
    if key != record.record_id {
        return Err(format!(
            "coastal provenance key {key} does not match record_id"
        ));
    }
    nonempty("record_id", &record.record_id)?;
    nonempty("source", &record.source)?;
    nonempty("method", &record.method)?;
    nonempty("datum", &record.datum)?;
    nonempty("resolution", &record.resolution)?;
    nonempty("observed_or_published", &record.observed_or_published)?;
    nonempty("uncertainty_unit", &record.uncertainty_unit)?;
    nonempty("uncertainty_basis", &record.uncertainty_basis)?;
    if let Some(value) = record.uncertainty_value
        && (!value.is_finite() || value < 0.0)
    {
        return Err(format!(
            "coastal provenance {key} has invalid uncertainty"
        ));
    }
    if record.placeholder && record.confidence != ProvenanceConfidence::Low {
        return Err(format!(
            "placeholder coastal provenance {key} must be low confidence"
        ));
    }
    Ok(())
}

fn parse_database() -> Result<Database, String> {
    let database: Database = serde_json::from_str(COASTAL_POINTS_JSON)
        .map_err(|error| format!("invalid bundled coastal point database: {error}"))?;
    if database.points.is_empty() {
        return Err("bundled coastal point database is empty".into());
    }
    for (key, record) in &database.meta.provenance_records {
        validate_record(key, record)?;
    }
    let mut ids = HashSet::new();
    for point in &database.points {
        if !ids.insert(&point.id) {
            return Err(format!("duplicate bundled coastal point id {}", point.id));
        }
        if point.role != "runup" && point.role != "deep_water_reference" {
            return Err(format!("coastal point {} has invalid role", point.id));
        }
        if !point.lat.is_finite()
            || !point.lon.is_finite()
            || !(-90.0..=90.0).contains(&point.lat)
            || !(-180.0..=180.0).contains(&point.lon)
            || !point.offshore_depth_m.is_finite()
            || point.offshore_depth_m <= 0.0
            || point.offshore_depth_m > 12_000.0
        {
            return Err(format!(
                "coastal point {} has invalid coordinates or depth",
                point.id
            ));
        }
        if point.role == "runup"
            && (!point.beach_slope_deg.is_finite()
                || point.beach_slope_deg <= 0.0
                || point.beach_slope_deg > 90.0)
        {
            return Err(format!(
                "coastal runup point {} has invalid slope",
                point.id
            ));
        }
        if point.role == "deep_water_reference" && point.beach_slope_deg != 0.0 {
            return Err(format!(
                "deep-water reference {} must use the zero-slope sentinel",
                point.id
            ));
        }
        for record_id in [&point.slope_provenance_id, &point.depth_provenance_id] {
            if !database.meta.provenance_records.contains_key(record_id) {
                return Err(format!(
                    "coastal point {} references missing provenance {record_id}",
                    point.id
                ));
            }
        }
    }
    Ok(database)
}

fn database() -> Result<&'static Database, String> {
    DATABASE
        .get_or_init(parse_database)
        .as_ref()
        .map_err(Clone::clone)
}

pub fn runup_point_ids() -> Result<Vec<String>, String> {
    Ok(database()?
        .points
        .iter()
        .filter(|point| point.role == "runup")
        .map(|point| point.id.clone())
        .collect())
}

pub fn resolve_runup_points(ids: &[String]) -> Result<Vec<CoastalRunupPoint>, String> {
    let database = database()?;
    let mut seen = HashSet::new();
    ids.iter()
        .map(|id| {
            if !seen.insert(id) {
                return Err(format!("duplicate coastal point id {id}"));
            }
            let point = database
                .points
                .iter()
                .find(|point| &point.id == id)
                .ok_or_else(|| format!("unknown coastal point id {id}"))?;
            if point.role != "runup" {
                return Err(format!("coastal point {id} is not a runup point"));
            }
            let resolve = |record_id: &str, kind: &str| -> Result<MeasurementProvenance, String> {
                let record = database
                    .meta
                    .provenance_records
                    .get(record_id)
                    .ok_or_else(|| format!("missing coastal provenance {record_id}"))?;
                Ok(MeasurementProvenance {
                    sample_id: format!("{}:{kind}", point.id),
                    record: record.clone(),
                })
            };
            Ok(CoastalRunupPoint {
                id: point.id.clone(),
                name: point.name.clone(),
                lat: point.lat,
                lon: point.lon,
                beach_slope_deg: point.beach_slope_deg,
                offshore_depth_m: point.offshore_depth_m,
                slope_provenance: resolve(&point.slope_provenance_id, "slope")?,
                depth_provenance: resolve(&point.depth_provenance_id, "depth")?,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_database_has_79_auditable_runup_points() {
        let ids = runup_point_ids().expect("bundled coastal database must validate");
        assert_eq!(ids.len(), 79);
        let points = resolve_runup_points(&ids).expect("all runup IDs must resolve");
        assert!(points.iter().all(|point| {
            point.slope_provenance.sample_id == format!("{}:slope", point.id)
                && point.depth_provenance.sample_id == format!("{}:depth", point.id)
                && point.slope_provenance.record.confidence == ProvenanceConfidence::Low
                && point.depth_provenance.record.confidence == ProvenanceConfidence::Low
        }));
    }

    #[test]
    fn deep_water_references_cannot_enter_runup() {
        let error = resolve_runup_points(&["tohoku_dart_21413".into()]).unwrap_err();
        assert!(error.contains("not a runup point"));
    }
}
