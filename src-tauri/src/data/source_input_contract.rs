use serde::Deserialize;
use std::{collections::HashMap, sync::OnceLock};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Contract {
    contract_version: u32,
    scenario_schema_version: u32,
    sources: HashMap<String, SourceDefinition>,
}

#[derive(Debug, Deserialize)]
struct SourceDefinition {
    fields: HashMap<String, FieldDefinition>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldDefinition {
    #[serde(rename = "type")]
    field_type: String,
    label: String,
    units: Option<String>,
    minimum: Option<f64>,
    maximum: Option<f64>,
    minimum_inclusive: Option<bool>,
    maximum_inclusive: Option<bool>,
    default: serde_json::Value,
    #[serde(default)]
    values: Vec<String>,
}

fn contract() -> &'static Contract {
    static CONTRACT: OnceLock<Contract> = OnceLock::new();
    CONTRACT.get_or_init(|| {
        let parsed: Contract = serde_json::from_str(include_str!("../../../src/data/source-input-contract.json"))
            .expect("source input contract must parse");
        assert_eq!(parsed.contract_version, 1, "unsupported source input contract version");
        assert_eq!(parsed.scenario_schema_version, 1, "source input contract targets an unsupported scenario schema");
        for (source_name, source) in &parsed.sources {
            for (field_name, field) in &source.fields {
                assert!(!field.label.trim().is_empty(), "{source_name}.{field_name} must have a label");
                assert!(!field.default.is_null(), "{source_name}.{field_name} must have a default");
                if field.field_type == "number" {
                    assert!(field.units.is_some(), "{source_name}.{field_name} must have units");
                }
            }
        }
        parsed
    })
}

pub fn validate_number(source: &str, field: &str, value: f64) -> Result<(), String> {
    let definition = contract()
        .sources
        .get(source)
        .and_then(|source_definition| source_definition.fields.get(field))
        .ok_or_else(|| format!("source input contract has no {source}.{field} field"))?;
    if definition.field_type != "number" {
        return Err(format!("source input contract field {source}.{field} is not numeric"));
    }
    if !value.is_finite() {
        return Err(format!("{field} must be finite (got {value})"));
    }
    if let Some(minimum) = definition.minimum {
        let inclusive = definition.minimum_inclusive.unwrap_or(true);
        if value < minimum || (!inclusive && value == minimum) {
            let relation = if inclusive { "at least" } else { "greater than" };
            return Err(format!("{field} must be {relation} {minimum} (got {value})"));
        }
    }
    if let Some(maximum) = definition.maximum {
        let inclusive = definition.maximum_inclusive.unwrap_or(true);
        if value > maximum || (!inclusive && value == maximum) {
            let relation = if inclusive { "at most" } else { "less than" };
            return Err(format!("{field} must be {relation} {maximum} (got {value})"));
        }
    }
    Ok(())
}

pub fn validate_enum(source: &str, field: &str, value: &str) -> Result<(), String> {
    let definition = contract()
        .sources
        .get(source)
        .and_then(|source_definition| source_definition.fields.get(field))
        .ok_or_else(|| format!("source input contract has no {source}.{field} field"))?;
    if definition.field_type != "enum" || !definition.values.iter().any(|allowed| allowed == value) {
        return Err(format!("{field} must be one of {} (got {value})", definition.values.join(", ")));
    }
    Ok(())
}

pub fn validate_serialized_enum<T: serde::Serialize>(source: &str, field: &str, value: T) -> Result<(), String> {
    let serialized = serde_json::to_value(value).map_err(|error| format!("could not serialize {field}: {error}"))?;
    let text = serialized.as_str().ok_or_else(|| format!("{field} did not serialize as text"))?;
    validate_enum(source, field, text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contract_metadata_and_defaults_are_complete() {
        let contract = contract();
        assert_eq!(contract.contract_version, 1);
        assert_eq!(contract.scenario_schema_version, 1);
        for (source_name, source) in &contract.sources {
            assert!(!source.fields.is_empty(), "{source_name} has no fields");
            for (field_name, field) in &source.fields {
                assert!(!field.label.trim().is_empty(), "{source_name}.{field_name} has no label");
                assert!(!field.default.is_null(), "{source_name}.{field_name} has no default");
                match field.field_type.as_str() {
                    "number" => {
                        assert!(field.units.is_some(), "{source_name}.{field_name} has no units");
                        assert!(field.default.as_f64().is_some(), "{source_name}.{field_name} default is not numeric");
                    }
                    "enum" => {
                        let default = field.default.as_str().expect("enum default must be text");
                        assert!(field.values.iter().any(|value| value == default), "{source_name}.{field_name} default is not allowed");
                        assert!(validate_enum(source_name, field_name, default).is_ok());
                        assert!(validate_enum(source_name, field_name, "__unknown__").is_err());
                    }
                    other => panic!("{source_name}.{field_name} has unsupported type {other}"),
                }
            }
        }
    }

    #[test]
    fn every_numeric_boundary_is_enforced() {
        for (source_name, source) in &contract().sources {
            for (field_name, field) in &source.fields {
                if field.field_type != "number" {
                    continue;
                }
                let minimum = field.minimum.expect("numeric field must have a minimum");
                let maximum = field.maximum.expect("numeric field must have a maximum");
                assert!(validate_number(source_name, field_name, minimum).is_ok());
                assert!(validate_number(source_name, field_name, maximum).is_ok());
                let lower_outside = minimum - (maximum - minimum).abs().max(1.0) * f64::EPSILON * 8.0;
                let upper_outside = maximum + (maximum - minimum).abs().max(1.0) * f64::EPSILON * 8.0;
                assert!(validate_number(source_name, field_name, lower_outside).is_err(), "{source_name}.{field_name} accepted {lower_outside}");
                assert!(validate_number(source_name, field_name, upper_outside).is_err(), "{source_name}.{field_name} accepted {upper_outside}");
                let default = field.default.as_f64().expect("numeric default");
                assert!(validate_number(source_name, field_name, default).is_ok(), "{source_name}.{field_name} rejected its default");
            }
        }
    }
}
