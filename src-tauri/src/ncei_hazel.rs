//! Narrow NOAA/NCEI HazEL bridge for historical tsunami events.
//!
//! The WebView deliberately has no NCEI CSP authority. This module owns the
//! single fixed HazEL query shape used by the event browser, rejects redirects,
//! caps response size, and deserializes only the fields Cataclysm displays.

use std::collections::BTreeMap;
use std::sync::LazyLock;
use std::time::Duration;

use reqwest::redirect::Policy;
use serde::{Deserialize, Serialize};

const EVENTS_URL: &str = "https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/tsunamis/events";
const MAX_RESPONSE_BYTES: u64 = 524_288;
const MAX_ITEMS: u8 = 40;

static REQUEST_LOCK: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));
static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .user_agent(concat!(
            "Cataclysm/",
            env!("CARGO_PKG_VERSION"),
            " (NCEI HazEL client)"
        ))
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(12))
        .redirect(Policy::none())
        .build()
        .expect("static NCEI HazEL HTTP client configuration")
});

#[derive(Debug, Deserialize)]
pub struct HazelEventSearchRequest {
    pub year: Option<i16>,
    pub location: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HazelTsunamiEvent {
    pub id: i64,
    pub year: i32,
    pub month: Option<u8>,
    pub day: Option<u8>,
    pub event_validity: Option<i16>,
    pub cause_code: Option<i16>,
    pub eq_magnitude: Option<f64>,
    pub country: Option<String>,
    pub location_name: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub max_water_height: Option<f64>,
    pub num_runups: Option<u32>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HazelEventSearchResponse {
    pub items: Vec<HazelTsunamiEvent>,
    pub page: u32,
    pub total_pages: u32,
    pub items_per_page: u32,
    pub total_items: u32,
}

pub async fn search(input: HazelEventSearchRequest) -> Result<HazelEventSearchResponse, String> {
    let params = validated_params(&input)?;
    let _request_guard = REQUEST_LOCK.lock().await;
    let response = CLIENT
        .get(EVENTS_URL)
        .query(&params)
        .send()
        .await
        .map_err(|error| format!("NOAA/NCEI HazEL request failed: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("NOAA/NCEI HazEL returned HTTP {status}"));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES)
    {
        return Err("NOAA/NCEI HazEL response exceeded the 512 KiB limit".to_string());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("NOAA/NCEI HazEL response read failed: {error}"))?;
    if bytes.len() as u64 > MAX_RESPONSE_BYTES {
        return Err("NOAA/NCEI HazEL response exceeded the 512 KiB limit".to_string());
    }
    let result: HazelEventSearchResponse = serde_json::from_slice(&bytes)
        .map_err(|error| format!("NOAA/NCEI HazEL response contract changed: {error}"))?;
    if result.items.len() > usize::from(MAX_ITEMS) {
        return Err("NOAA/NCEI HazEL returned more events than requested".to_string());
    }
    Ok(result)
}

fn validated_params(
    input: &HazelEventSearchRequest,
) -> Result<BTreeMap<&'static str, String>, String> {
    let location = input
        .location
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if input.year.is_none() && location.is_none() {
        return Err("Historical event search requires a year or location".to_string());
    }
    if input.year.is_some_and(|year| !(1..=2100).contains(&year)) {
        return Err("Historical event search year must be between 1 and 2100".to_string());
    }
    if location.is_some_and(|value| {
        value.len() < 2 || value.len() > 60 || value.chars().any(char::is_control)
    }) {
        return Err(
            "Historical event search location must be 2 to 60 printable characters".to_string(),
        );
    }

    let mut params = BTreeMap::from([
        ("page", "1".to_string()),
        ("itemsPerPage", MAX_ITEMS.to_string()),
        ("minEventValidity", "1".to_string()),
    ]);
    if let Some(year) = input.year {
        params.insert("year", year.to_string());
    }
    if let Some(location) = location {
        params.insert("locInclude", location.to_string());
    }
    Ok(params)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_search_shape_accepts_1960_chile_and_rejects_unbounded_input() {
        let params = validated_params(&HazelEventSearchRequest {
            year: Some(1960),
            location: Some("Chile".to_string()),
        })
        .expect("valid search");
        assert_eq!(params.get("year").map(String::as_str), Some("1960"));
        assert_eq!(params.get("locInclude").map(String::as_str), Some("Chile"));
        assert_eq!(params.get("itemsPerPage").map(String::as_str), Some("40"));
        assert_eq!(
            params.get("minEventValidity").map(String::as_str),
            Some("1")
        );

        assert!(
            validated_params(&HazelEventSearchRequest {
                year: None,
                location: None
            })
            .is_err()
        );
        assert!(
            validated_params(&HazelEventSearchRequest {
                year: Some(1960),
                location: Some("x".repeat(61)),
            })
            .is_err()
        );
        assert!(
            validated_params(&HazelEventSearchRequest {
                year: Some(2200),
                location: None,
            })
            .is_err()
        );
    }

    #[test]
    fn official_response_shape_deserializes_the_chile_event() {
        let response: HazelEventSearchResponse = serde_json::from_value(serde_json::json!({
            "items": [{
                "id": 1902,
                "year": 1960,
                "month": 5,
                "day": 22,
                "eventValidity": 4,
                "causeCode": 1,
                "eqMagnitude": 9.5,
                "country": "CHILE",
                "locationName": "SOUTHERN CHILE",
                "latitude": -38.143,
                "longitude": -73.407,
                "maxWaterHeight": 25.0,
                "numRunups": 1279,
                "publish": true
            }],
            "page": 1,
            "totalPages": 1,
            "itemsPerPage": 40,
            "totalItems": 1
        }))
        .expect("HazEL fixture");
        assert_eq!(response.items[0].id, 1902);
        assert_eq!(response.items[0].eq_magnitude, Some(9.5));
        assert_eq!(response.items[0].longitude, Some(-73.407));
    }
}
