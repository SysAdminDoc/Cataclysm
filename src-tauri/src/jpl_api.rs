//! Narrow NASA/JPL SSD API bridge for the desktop app.
//!
//! JPL's fair-use policy disallows browser embedding and requires clients to
//! serialize requests and verify response versions. The WebView therefore has
//! no JPL CSP authority: this module permits only the fixed query shapes used by
//! the fireball feed, SBDB lookup, and Sentry detail lookup.

use std::collections::BTreeMap;
use std::sync::LazyLock;
use std::time::Duration;

use reqwest::redirect::Policy;
use serde::Deserialize;

const MAX_RESPONSE_BYTES: u64 = 1_048_576;
static REQUEST_LOCK: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));
static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .user_agent(concat!("Cataclysm/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(12))
        .redirect(Policy::none())
        .build()
        .expect("static JPL HTTP client configuration")
});

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JplEndpoint {
    Fireball,
    Sbdb,
    Sentry,
}

impl JplEndpoint {
    fn url(self) -> &'static str {
        match self {
            Self::Fireball => "https://ssd-api.jpl.nasa.gov/fireball.api",
            Self::Sbdb => "https://ssd-api.jpl.nasa.gov/sbdb.api",
            Self::Sentry => "https://ssd-api.jpl.nasa.gov/sentry.api",
        }
    }

    fn expected_version(self) -> &'static str {
        match self {
            Self::Fireball => "1.2",
            Self::Sbdb => "1.3",
            Self::Sentry => "2.0",
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct JplApiRequest {
    pub endpoint: JplEndpoint,
    pub params: BTreeMap<String, String>,
}

pub async fn request(input: JplApiRequest) -> Result<serde_json::Value, String> {
    validate_request(&input)?;
    let _request_guard = REQUEST_LOCK.lock().await;
    let response = CLIENT
        .get(input.endpoint.url())
        .query(&input.params)
        .send()
        .await
        .map_err(|error| format!("NASA/JPL request failed: {error}"))?;
    let status = response.status();
    let is_sbdb_multiple_choice =
        matches!(input.endpoint, JplEndpoint::Sbdb) && status.as_u16() == 300;
    if !status.is_success() && !is_sbdb_multiple_choice {
        return Err(format!("NASA/JPL request returned HTTP {status}"));
    }
    if response.content_length().is_some_and(|length| length > MAX_RESPONSE_BYTES) {
        return Err("NASA/JPL response exceeded the 1 MiB limit".to_string());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("NASA/JPL response read failed: {error}"))?;
    if bytes.len() as u64 > MAX_RESPONSE_BYTES {
        return Err("NASA/JPL response exceeded the 1 MiB limit".to_string());
    }
    let value: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("NASA/JPL response was not valid JSON: {error}"))?;
    validate_signature(input.endpoint, &value)?;
    Ok(value)
}

fn validate_request(input: &JplApiRequest) -> Result<(), String> {
    if input.params.len() > 3 {
        return Err("NASA/JPL request has too many parameters".to_string());
    }
    if input
        .params
        .values()
        .any(|value| value.len() > 80 || value.chars().any(char::is_control))
    {
        return Err("NASA/JPL request contains an invalid parameter value".to_string());
    }
    match input.endpoint {
        JplEndpoint::Fireball => {
            require_exact(&input.params, "req-loc", "true")?;
            require_exact(&input.params, "sort", "-date")?;
            input
                .params
                .get("limit")
                .and_then(|value| value.parse::<u8>().ok())
                .filter(|value| (1..=80).contains(value))
                .ok_or_else(|| "fireball limit must be between 1 and 80".to_string())?;
            reject_unknown(&input.params, &["req-loc", "sort", "limit"])
        }
        JplEndpoint::Sbdb => {
            require_exact(&input.params, "phys-par", "1")?;
            let query = input.params.get("sstr").map(String::as_str).unwrap_or_default();
            if query.trim().len() < 2 {
                return Err("SBDB search requires at least two characters".to_string());
            }
            reject_unknown(&input.params, &["sstr", "phys-par"])
        }
        JplEndpoint::Sentry => {
            if input.params.get("des").is_none_or(|value| value.trim().is_empty()) {
                return Err("Sentry lookup requires a designation".to_string());
            }
            reject_unknown(&input.params, &["des"])
        }
    }
}

fn require_exact(params: &BTreeMap<String, String>, key: &str, expected: &str) -> Result<(), String> {
    if params.get(key).is_none_or(|value| value != expected) {
        return Err(format!("NASA/JPL parameter {key} must be {expected}"));
    }
    Ok(())
}

fn reject_unknown(params: &BTreeMap<String, String>, allowed: &[&str]) -> Result<(), String> {
    if let Some(key) = params.keys().find(|key| !allowed.contains(&key.as_str())) {
        return Err(format!("NASA/JPL parameter {key} is not allowed"));
    }
    Ok(())
}

fn validate_signature(endpoint: JplEndpoint, value: &serde_json::Value) -> Result<(), String> {
    let actual = value
        .pointer("/signature/version")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("missing");
    let expected = endpoint.expected_version();
    if actual != expected {
        return Err(format!(
            "NASA/JPL API version changed: expected {expected}, received {actual}"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(endpoint: JplEndpoint, params: &[(&str, &str)]) -> JplApiRequest {
        JplApiRequest {
            endpoint,
            params: params
                .iter()
                .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
                .collect(),
        }
    }

    #[test]
    fn only_fixed_bounded_query_shapes_are_accepted() {
        assert!(validate_request(&fixture(
            JplEndpoint::Fireball,
            &[("req-loc", "true"), ("limit", "80"), ("sort", "-date")],
        ))
        .is_ok());
        assert!(validate_request(&fixture(
            JplEndpoint::Sbdb,
            &[("sstr", "Apophis"), ("phys-par", "1")],
        ))
        .is_ok());
        assert!(validate_request(&fixture(
            JplEndpoint::Sentry,
            &[("des", "99942")],
        ))
        .is_ok());
        assert!(validate_request(&fixture(
            JplEndpoint::Fireball,
            &[("req-loc", "true"), ("limit", "500"), ("sort", "-date")],
        ))
        .is_err());
        assert!(validate_request(&fixture(
            JplEndpoint::Sbdb,
            &[("sstr", "Apophis"), ("phys-par", "1"), ("url", "https://example.com")],
        ))
        .is_err());
    }

    #[test]
    fn response_signature_versions_fail_closed() {
        assert!(validate_signature(
            JplEndpoint::Fireball,
            &serde_json::json!({ "signature": { "version": "1.2" } }),
        )
        .is_ok());
        assert!(validate_signature(
            JplEndpoint::Fireball,
            &serde_json::json!({ "signature": { "version": "1.3" } }),
        )
        .is_err());
    }
}
