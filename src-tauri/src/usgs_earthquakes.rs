//! Bounded USGS ComCat bridge for recent earthquakes and official products.
//!
//! The WebView has no direct USGS network authority. This module owns one
//! fixed recent-event feed, constructs detail URLs from validated event IDs,
//! rejects redirects, caps every response, and emits only the fields used by
//! Cataclysm's source builder and official-product comparison layer.

use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::Duration;

use reqwest::redirect::Policy;
use serde::{Deserialize, Serialize};

const RECENT_FEED_URL: &str =
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson";
const DETAIL_PREFIX: &str = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/detail/";
const SHAKEMAP_CONTENT_PREFIX: &str = "https://earthquake.usgs.gov/pdl/products/";
const SHAKEMAP_CONTENT_SUFFIX: &str = "/contents/download/cont_mmi.json";
const MAX_FEED_BYTES: u64 = 2_097_152;
const MAX_DETAIL_BYTES: u64 = 4_194_304;
const MAX_CONTOUR_BYTES: u64 = 2_097_152;
const MAX_EVENTS: usize = 32;
const MAX_CONTOURS: usize = 512;
const MAX_CONTOUR_POINTS: usize = 24_000;
const SHEAR_MODULUS_PA: f64 = 32.0e9;

static REQUEST_LOCK: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));
static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .user_agent(concat!(
            "Cataclysm/",
            env!("CARGO_PKG_VERSION"),
            " (USGS ComCat client)"
        ))
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15))
        .redirect(Policy::none())
        .build()
        .expect("static USGS ComCat HTTP client configuration")
});

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsgsEarthquakeEvent {
    pub id: String,
    pub title: String,
    pub place: String,
    pub magnitude: f64,
    pub magnitude_type: Option<String>,
    pub time_ms: i64,
    pub updated_ms: i64,
    pub latitude: f64,
    pub longitude: f64,
    pub depth_km: f64,
    pub status: String,
    pub significance: u32,
    pub tsunami_flag: bool,
    pub alert_level: Option<String>,
    pub max_mmi: Option<f64>,
    pub has_shakemap: bool,
    pub has_pager: bool,
    pub has_finite_fault: bool,
    pub has_moment_tensor: bool,
    pub event_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsgsRecentEarthquakesResponse {
    pub generated_at_ms: i64,
    pub source_url: &'static str,
    pub events: Vec<UsgsEarthquakeEvent>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UsgsSourceBasis {
    FiniteFault,
    MomentTensor,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsgsOkadaSource {
    pub basis: UsgsSourceBasis,
    pub strike_deg: f64,
    pub dip_deg: f64,
    pub rake_deg: f64,
    pub average_slip_m: f64,
    pub fault_length_m: f64,
    pub fault_width_m: f64,
    pub scalar_moment_nm: f64,
    pub review_status: String,
    pub assumptions: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsgsMmiContour {
    pub mmi: f64,
    pub color: String,
    pub points: Vec<[f64; 2]>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsgsShakeMap {
    pub max_mmi: f64,
    pub map_status: String,
    pub review_status: String,
    pub process_timestamp: Option<String>,
    pub bounds: [f64; 4],
    pub contours: Vec<UsgsMmiContour>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsgsPager {
    pub alert_level: String,
    pub max_mmi: Option<f64>,
    pub review_status: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsgsEarthquakeDetail {
    pub event: UsgsEarthquakeEvent,
    pub okada_source: Option<UsgsOkadaSource>,
    pub shakemap: Option<UsgsShakeMap>,
    pub pager: Option<UsgsPager>,
    pub fetched_at_ms: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsgsEarthquakeDetailRequest {
    pub event_id: String,
}

#[derive(Debug, Deserialize)]
struct FeedCollection {
    metadata: FeedMetadata,
    features: Vec<FeedFeature>,
}

#[derive(Debug, Deserialize)]
struct FeedMetadata {
    generated: i64,
}

#[derive(Debug, Deserialize)]
struct FeedFeature {
    id: String,
    properties: FeedProperties,
    geometry: PointGeometry,
}

#[derive(Debug, Deserialize)]
struct FeedProperties {
    mag: Option<f64>,
    place: Option<String>,
    time: Option<i64>,
    updated: Option<i64>,
    status: Option<String>,
    sig: Option<u32>,
    tsunami: Option<u8>,
    alert: Option<String>,
    mmi: Option<f64>,
    #[serde(rename = "magType")]
    mag_type: Option<String>,
    #[serde(rename = "type")]
    event_type: Option<String>,
    types: Option<String>,
    title: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PointGeometry {
    #[serde(rename = "type")]
    geometry_type: String,
    coordinates: Vec<f64>,
}

#[derive(Debug, Deserialize)]
struct DetailFeature {
    id: String,
    properties: DetailProperties,
    geometry: PointGeometry,
}

#[derive(Debug, Deserialize)]
struct DetailProperties {
    mag: Option<f64>,
    place: Option<String>,
    time: Option<i64>,
    updated: Option<i64>,
    status: Option<String>,
    sig: Option<u32>,
    tsunami: Option<u8>,
    alert: Option<String>,
    mmi: Option<f64>,
    #[serde(rename = "magType")]
    mag_type: Option<String>,
    #[serde(rename = "type")]
    event_type: Option<String>,
    types: Option<String>,
    title: Option<String>,
    #[serde(default)]
    products: HashMap<String, Vec<UsgsProduct>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsgsProduct {
    update_time: i64,
    status: String,
    #[serde(default)]
    preferred_weight: i64,
    #[serde(default)]
    properties: HashMap<String, String>,
    #[serde(default)]
    contents: HashMap<String, UsgsProductContent>,
}

#[derive(Debug, Deserialize)]
struct UsgsProductContent {
    url: String,
}

#[derive(Debug, Deserialize)]
struct ContourCollection {
    features: Vec<ContourFeature>,
}

#[derive(Debug, Deserialize)]
struct ContourFeature {
    properties: ContourProperties,
    geometry: ContourGeometry,
}

#[derive(Debug, Deserialize)]
struct ContourProperties {
    value: f64,
    color: String,
    units: String,
}

#[derive(Debug, Deserialize)]
struct ContourGeometry {
    #[serde(rename = "type")]
    geometry_type: String,
    coordinates: serde_json::Value,
}

pub async fn recent() -> Result<UsgsRecentEarthquakesResponse, String> {
    let _request_guard = REQUEST_LOCK.lock().await;
    let value = fetch_json(RECENT_FEED_URL, MAX_FEED_BYTES, "recent-event feed").await?;
    parse_recent(value)
}

pub async fn detail(input: UsgsEarthquakeDetailRequest) -> Result<UsgsEarthquakeDetail, String> {
    validate_event_id(&input.event_id)?;
    let _request_guard = REQUEST_LOCK.lock().await;
    let detail_url = format!("{DETAIL_PREFIX}{}.geojson", input.event_id);
    let value = fetch_json(&detail_url, MAX_DETAIL_BYTES, "event detail").await?;
    let contour_url = preferred_product_url(&value, "shakemap", "download/cont_mmi.json")?;
    let contours = match contour_url {
        Some(url) => {
            validate_shakemap_url(&url)?;
            Some(fetch_json(&url, MAX_CONTOUR_BYTES, "ShakeMap contours").await?)
        }
        None => None,
    };
    parse_detail(&input.event_id, value, contours.as_ref())
}

async fn fetch_json(
    url: &str,
    maximum_bytes: u64,
    label: &str,
) -> Result<serde_json::Value, String> {
    let response = CLIENT
        .get(url)
        .send()
        .await
        .map_err(|error| format!("USGS {label} request failed: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("USGS {label} returned HTTP {status}"));
    }
    if response
        .content_length()
        .is_some_and(|length| length > maximum_bytes)
    {
        return Err(format!("USGS {label} exceeded its response-size limit"));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("USGS {label} response read failed: {error}"))?;
    if bytes.len() as u64 > maximum_bytes {
        return Err(format!("USGS {label} exceeded its response-size limit"));
    }
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("USGS {label} response contract changed: {error}"))
}

fn parse_recent(value: serde_json::Value) -> Result<UsgsRecentEarthquakesResponse, String> {
    let feed: FeedCollection = serde_json::from_value(value)
        .map_err(|error| format!("USGS recent-event feed contract changed: {error}"))?;
    let events = feed
        .features
        .into_iter()
        .filter_map(event_from_feed)
        .take(MAX_EVENTS)
        .collect();
    Ok(UsgsRecentEarthquakesResponse {
        generated_at_ms: feed.metadata.generated,
        source_url: RECENT_FEED_URL,
        events,
    })
}

fn event_from_feed(feature: FeedFeature) -> Option<UsgsEarthquakeEvent> {
    let properties = feature.properties;
    if properties.event_type.as_deref() != Some("earthquake")
        || feature.geometry.geometry_type != "Point"
        || feature.geometry.coordinates.len() < 3
    {
        return None;
    }
    let magnitude = properties.mag?;
    let longitude = feature.geometry.coordinates[0];
    let latitude = feature.geometry.coordinates[1];
    let depth_km = feature.geometry.coordinates[2];
    if !(5.0..=10.0).contains(&magnitude)
        || !(-180.0..=180.0).contains(&longitude)
        || !(-90.0..=90.0).contains(&latitude)
        || !(0.0..=1_000.0).contains(&depth_km)
        || validate_event_id(&feature.id).is_err()
    {
        return None;
    }
    let types = properties.types.unwrap_or_default();
    let place = bounded_text(properties.place, "Unnamed location", 180);
    let title = bounded_text(
        properties.title,
        &format!("M {magnitude:.1} - {place}"),
        220,
    );
    Some(UsgsEarthquakeEvent {
        id: feature.id.clone(),
        title,
        place,
        magnitude,
        magnitude_type: bounded_optional_text(properties.mag_type, 24),
        time_ms: properties.time?,
        updated_ms: properties.updated?,
        latitude,
        longitude,
        depth_km,
        status: bounded_text(properties.status, "unknown", 32),
        significance: properties.sig.unwrap_or(0),
        tsunami_flag: properties.tsunami == Some(1),
        alert_level: bounded_optional_text(properties.alert, 16),
        max_mmi: properties
            .mmi
            .filter(|value| value.is_finite() && (0.0..=10.0).contains(value)),
        has_shakemap: product_list_contains(&types, "shakemap"),
        has_pager: product_list_contains(&types, "losspager"),
        has_finite_fault: product_list_contains(&types, "finite-fault"),
        has_moment_tensor: product_list_contains(&types, "moment-tensor"),
        event_url: format!(
            "https://earthquake.usgs.gov/earthquakes/eventpage/{}",
            feature.id
        ),
    })
}

fn parse_detail(
    expected_event_id: &str,
    value: serde_json::Value,
    contours_value: Option<&serde_json::Value>,
) -> Result<UsgsEarthquakeDetail, String> {
    let detail: DetailFeature = serde_json::from_value(value)
        .map_err(|error| format!("USGS event-detail contract changed: {error}"))?;
    if detail.id != expected_event_id {
        return Err("USGS event detail returned a different event ID".to_string());
    }
    let DetailFeature {
        id,
        properties,
        geometry,
    } = detail;
    let product_types = properties.types.clone().unwrap_or_default();
    let feed_event = FeedFeature {
        id,
        geometry,
        properties: FeedProperties {
            mag: properties.mag,
            place: properties.place.clone(),
            time: properties.time,
            updated: properties.updated,
            status: properties.status.clone(),
            sig: properties.sig,
            tsunami: properties.tsunami,
            alert: properties.alert.clone(),
            mmi: properties.mmi,
            mag_type: properties.mag_type.clone(),
            event_type: properties.event_type.clone(),
            types: Some(product_types),
            title: properties.title.clone(),
        },
    };
    let event = event_from_feed(feed_event).ok_or_else(|| {
        "USGS event detail is outside Cataclysm's supported earthquake bounds".to_string()
    })?;
    let okada_source = parse_okada_source(&event, &properties.products)?;
    let pager = parse_pager(&properties.products);
    let shakemap = parse_shakemap(&properties.products, contours_value)?;
    Ok(UsgsEarthquakeDetail {
        event,
        okada_source,
        shakemap,
        pager,
        fetched_at_ms: unix_time_ms(),
    })
}

fn parse_okada_source(
    event: &UsgsEarthquakeEvent,
    products: &HashMap<String, Vec<UsgsProduct>>,
) -> Result<Option<UsgsOkadaSource>, String> {
    if let Some(product) = preferred_product(products.get("finite-fault")) {
        let length_m = product_number(product, "model-length")? * 1_000.0;
        let width_m = product_number(product, "model-width")? * 1_000.0;
        let scalar_moment_nm = product_number(product, "scalar-moment")?;
        return validated_okada_source(UsgsOkadaSource {
            basis: UsgsSourceBasis::FiniteFault,
            strike_deg: product_number(product, "model-strike")?,
            dip_deg: product_number(product, "model-dip")?,
            rake_deg: product_number(product, "model-rake")?,
            average_slip_m: average_slip_m(scalar_moment_nm, length_m, width_m),
            fault_length_m: length_m,
            fault_width_m: width_m,
            scalar_moment_nm,
            review_status: product_text(product, "review-status", "unknown"),
            assumptions: vec![
                "USGS finite-fault strike, dip, rake, length, width, and scalar moment seed the Okada rectangle."
                    .to_string(),
                "Average slip is reconstructed as M0 / (32 GPa × fault area); spatially variable slip is not imported."
                    .to_string(),
            ],
        })
        .map(Some);
    }

    if let Some(product) = preferred_product(products.get("moment-tensor")) {
        let length_m = 10f64.powf(0.5 * event.magnitude - 1.85) * 1_000.0;
        let width_m = 10f64.powf(0.32 * event.magnitude - 1.01) * 1_000.0;
        let scalar_moment_nm = product
            .properties
            .get("scalar-moment")
            .and_then(|value| value.parse::<f64>().ok())
            .filter(|value| value.is_finite() && *value > 0.0)
            .unwrap_or_else(|| 10f64.powf(1.5 * event.magnitude + 9.1));
        return validated_okada_source(UsgsOkadaSource {
            basis: UsgsSourceBasis::MomentTensor,
            strike_deg: product_number(product, "nodal-plane-1-strike")?,
            dip_deg: product_number(product, "nodal-plane-1-dip")?,
            rake_deg: product_number(product, "nodal-plane-1-rake")?,
            average_slip_m: average_slip_m(scalar_moment_nm, length_m, width_m),
            fault_length_m: length_m,
            fault_width_m: width_m,
            scalar_moment_nm,
            review_status: product_text(product, "review-status", "unknown"),
            assumptions: vec![
                "USGS moment-tensor nodal plane 1 supplies strike, dip, and rake; the conjugate plane remains an unresolved ambiguity."
                    .to_string(),
                "Fault dimensions use Cataclysm's Wells–Coppersmith magnitude scaling; average slip is M0 / (32 GPa × fault area)."
                    .to_string(),
            ],
        })
        .map(Some);
    }
    Ok(None)
}

fn validated_okada_source(source: UsgsOkadaSource) -> Result<UsgsOkadaSource, String> {
    let valid = (0.0..=360.0).contains(&source.strike_deg)
        && (0.0..=90.0).contains(&source.dip_deg)
        && (-180.0..=180.0).contains(&source.rake_deg)
        && (0.0..=100.0).contains(&source.average_slip_m)
        && (1.0..=2_000_000.0).contains(&source.fault_length_m)
        && (1.0..=500_000.0).contains(&source.fault_width_m)
        && source.scalar_moment_nm.is_finite()
        && source.scalar_moment_nm > 0.0;
    if valid {
        Ok(source)
    } else {
        Err("USGS source product is outside Cataclysm's supported Okada bounds".to_string())
    }
}

fn parse_pager(products: &HashMap<String, Vec<UsgsProduct>>) -> Option<UsgsPager> {
    let product = preferred_product(products.get("losspager"))?;
    Some(UsgsPager {
        alert_level: product_text(product, "alertlevel", "unknown"),
        max_mmi: product
            .properties
            .get("maxmmi")
            .and_then(|value| value.parse::<f64>().ok())
            .filter(|value| value.is_finite() && (0.0..=10.0).contains(value)),
        review_status: product_text(product, "review-status", "unknown"),
    })
}

fn parse_shakemap(
    products: &HashMap<String, Vec<UsgsProduct>>,
    contours_value: Option<&serde_json::Value>,
) -> Result<Option<UsgsShakeMap>, String> {
    let Some(product) = preferred_product(products.get("shakemap")) else {
        return Ok(None);
    };
    let bounds = [
        product_number(product, "minimum-longitude")?,
        product_number(product, "minimum-latitude")?,
        product_number(product, "maximum-longitude")?,
        product_number(product, "maximum-latitude")?,
    ];
    if bounds[0] < -180.0
        || bounds[2] > 180.0
        || bounds[1] < -90.0
        || bounds[3] > 90.0
        || bounds[0] >= bounds[2]
        || bounds[1] >= bounds[3]
    {
        return Err("USGS ShakeMap bounds are invalid".to_string());
    }
    let contours = contours_value
        .map(parse_contours)
        .transpose()?
        .unwrap_or_default();
    Ok(Some(UsgsShakeMap {
        max_mmi: product_number(product, "maxmmi")?.clamp(0.0, 10.0),
        map_status: product_text(product, "map-status", "unknown"),
        review_status: product_text(product, "review-status", "unknown"),
        process_timestamp: product
            .properties
            .get("process-timestamp")
            .and_then(|value| bounded_optional_text(Some(value.clone()), 80)),
        bounds,
        contours,
    }))
}

fn parse_contours(value: &serde_json::Value) -> Result<Vec<UsgsMmiContour>, String> {
    let collection: ContourCollection = serde_json::from_value(value.clone())
        .map_err(|error| format!("USGS ShakeMap contour contract changed: {error}"))?;
    let mut contours = Vec::new();
    let mut total_points = 0usize;
    for feature in collection.features {
        if feature.properties.units != "mmi"
            || !feature.properties.value.is_finite()
            || !(0.0..=10.0).contains(&feature.properties.value)
            || !valid_css_hex(&feature.properties.color)
        {
            continue;
        }
        let lines = match feature.geometry.geometry_type.as_str() {
            "LineString" => vec![parse_line(&feature.geometry.coordinates)?],
            "MultiLineString" => {
                serde_json::from_value::<Vec<Vec<[f64; 2]>>>(feature.geometry.coordinates)
                    .map_err(|error| format!("USGS ShakeMap line coordinates changed: {error}"))?
            }
            _ => continue,
        };
        for points in lines {
            if points.len() < 2 || !points.iter().all(valid_lon_lat) {
                continue;
            }
            total_points = total_points.saturating_add(points.len());
            if total_points > MAX_CONTOUR_POINTS || contours.len() >= MAX_CONTOURS {
                return Err(
                    "USGS ShakeMap contour geometry exceeded Cataclysm's bounded layer budget"
                        .to_string(),
                );
            }
            contours.push(UsgsMmiContour {
                mmi: feature.properties.value,
                color: feature.properties.color.clone(),
                points,
            });
        }
    }
    Ok(contours)
}

fn parse_line(value: &serde_json::Value) -> Result<Vec<[f64; 2]>, String> {
    serde_json::from_value(value.clone())
        .map_err(|error| format!("USGS ShakeMap line coordinates changed: {error}"))
}

fn valid_lon_lat(point: &[f64; 2]) -> bool {
    point[0].is_finite()
        && point[1].is_finite()
        && (-180.0..=180.0).contains(&point[0])
        && (-90.0..=90.0).contains(&point[1])
}

fn preferred_product(products: Option<&Vec<UsgsProduct>>) -> Option<&UsgsProduct> {
    products?
        .iter()
        .filter(|product| product.status != "DELETE")
        .max_by_key(|product| (product.preferred_weight, product.update_time))
}

fn preferred_product_url(
    value: &serde_json::Value,
    product_type: &str,
    content_name: &str,
) -> Result<Option<String>, String> {
    let detail: DetailFeature = serde_json::from_value(value.clone())
        .map_err(|error| format!("USGS event-detail contract changed: {error}"))?;
    Ok(
        preferred_product(detail.properties.products.get(product_type))
            .and_then(|product| product.contents.get(content_name))
            .map(|content| content.url.clone()),
    )
}

fn product_number(product: &UsgsProduct, key: &str) -> Result<f64, String> {
    product
        .properties
        .get(key)
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| value.is_finite())
        .ok_or_else(|| format!("USGS product is missing finite {key}"))
}

fn product_text(product: &UsgsProduct, key: &str, fallback: &str) -> String {
    bounded_text(product.properties.get(key).cloned(), fallback, 80)
}

fn average_slip_m(scalar_moment_nm: f64, length_m: f64, width_m: f64) -> f64 {
    scalar_moment_nm / (SHEAR_MODULUS_PA * length_m * width_m)
}

fn product_list_contains(types: &str, product: &str) -> bool {
    types.split(',').any(|value| value == product)
}

fn bounded_text(value: Option<String>, fallback: &str, maximum: usize) -> String {
    bounded_optional_text(value, maximum).unwrap_or_else(|| fallback.to_string())
}

fn bounded_optional_text(value: Option<String>, maximum: usize) -> Option<String> {
    value.map(|value| value.trim().to_string()).filter(|value| {
        !value.is_empty() && value.len() <= maximum && !value.chars().any(char::is_control)
    })
}

fn validate_event_id(event_id: &str) -> Result<(), String> {
    if !(2..=32).contains(&event_id.len())
        || !event_id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
    {
        return Err(
            "USGS event ID must contain 2-32 lowercase ASCII letters or digits".to_string(),
        );
    }
    Ok(())
}

fn validate_shakemap_url(url: &str) -> Result<(), String> {
    if !url.starts_with(SHAKEMAP_CONTENT_PREFIX)
        || !url.ends_with(SHAKEMAP_CONTENT_SUFFIX)
        || url.len() > 512
        || url.chars().any(char::is_control)
    {
        return Err("USGS ShakeMap content URL is outside the allowed product path".to_string());
    }
    Ok(())
}

fn valid_css_hex(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn unix_time_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event_properties() -> serde_json::Value {
        serde_json::json!({
            "mag": 7.3,
            "place": "58 km WSW of Puerto Madero, Mexico",
            "time": 1784299719769_i64,
            "updated": 1784473369040_i64,
            "status": "reviewed",
            "sig": 974,
            "tsunami": 0,
            "alert": "yellow",
            "mmi": 7.018,
            "magType": "mww",
            "type": "earthquake",
            "types": ",finite-fault,losspager,moment-tensor,shakemap,",
            "title": "M 7.3 - 58 km WSW of Puerto Madero, Mexico"
        })
    }

    #[test]
    fn significant_feed_is_bounded_and_filters_unsupported_events() {
        let valid = serde_json::json!({
            "id": "us7000t1bu",
            "properties": event_properties(),
            "geometry": { "type": "Point", "coordinates": [-92.9517, 14.6043, 18.584] }
        });
        let small = serde_json::json!({
            "id": "ci12345678",
            "properties": { "mag": 4.3, "type": "earthquake", "time": 1, "updated": 2 },
            "geometry": { "type": "Point", "coordinates": [-117.8, 35.3, 7.5] }
        });
        let response = parse_recent(serde_json::json!({
            "metadata": { "generated": 1784543150000_i64 },
            "features": [valid, small]
        }))
        .expect("bounded feed fixture");
        assert_eq!(response.events.len(), 1);
        assert_eq!(response.events[0].id, "us7000t1bu");
        assert!(response.events[0].has_shakemap);
        assert!(response.events[0].has_finite_fault);
        assert_eq!(
            response.events[0].event_url,
            "https://earthquake.usgs.gov/earthquakes/eventpage/us7000t1bu"
        );
    }

    #[test]
    fn finite_fault_detail_maps_to_a_complete_okada_source_and_official_products() {
        let detail = serde_json::json!({
            "id": "us7000t1bu",
            "properties": {
                "mag": 7.3,
                "place": "58 km WSW of Puerto Madero, Mexico",
                "time": 1784299719769_i64,
                "updated": 1784473369040_i64,
                "status": "reviewed",
                "sig": 974,
                "tsunami": 0,
                "alert": "yellow",
                "mmi": 7.018,
                "magType": "mww",
                "type": "earthquake",
                "types": ",finite-fault,losspager,moment-tensor,shakemap,",
                "title": "M 7.3 - 58 km WSW of Puerto Madero, Mexico",
                "products": {
                    "finite-fault": [{
                        "updateTime": 3,
                        "status": "UPDATE",
                        "preferredWeight": 10,
                        "properties": {
                            "model-length": "125.0", "model-width": "65.0",
                            "model-strike": "286", "model-dip": "27", "model-rake": "75",
                            "scalar-moment": "1.079584183956e20", "review-status": "reviewed"
                        }
                    }],
                    "shakemap": [{
                        "updateTime": 4,
                        "status": "UPDATE",
                        "preferredWeight": 20,
                        "properties": {
                            "minimum-longitude": "-96.833", "minimum-latitude": "10.783",
                            "maximum-longitude": "-88.917", "maximum-latitude": "18.283",
                            "maxmmi": "7.018", "map-status": "automatic",
                            "review-status": "automatic", "process-timestamp": "2026-07-18T14:51:24Z"
                        },
                        "contents": {
                            "download/cont_mmi.json": {
                                "url": "https://earthquake.usgs.gov/pdl/products/example/contents/download/cont_mmi.json"
                            }
                        }
                    }],
                    "losspager": [{
                        "updateTime": 5,
                        "status": "UPDATE",
                        "preferredWeight": 20,
                        "properties": { "alertlevel": "yellow", "maxmmi": "7", "review-status": "automatic" }
                    }]
                }
            },
            "geometry": { "type": "Point", "coordinates": [-92.9517, 14.6043, 18.584] }
        });
        let contours = serde_json::json!({
            "features": [{
                "properties": { "value": 6.0, "units": "mmi", "color": "#ffb347" },
                "geometry": { "type": "MultiLineString", "coordinates": [[[-94.0, 14.0], [-93.0, 15.0]]] }
            }]
        });
        let result = parse_detail("us7000t1bu", detail, Some(&contours)).expect("detail fixture");
        let source = result.okada_source.expect("finite fault");
        assert!(matches!(source.basis, UsgsSourceBasis::FiniteFault));
        assert_eq!(source.fault_length_m, 125_000.0);
        assert_eq!(source.fault_width_m, 65_000.0);
        assert!((source.average_slip_m - 0.415).abs() < 0.01);
        assert_eq!(result.shakemap.expect("ShakeMap").contours.len(), 1);
        assert_eq!(result.pager.expect("PAGER").alert_level, "yellow");
    }

    #[test]
    fn event_and_product_urls_fail_closed() {
        assert!(validate_event_id("us7000t1bu").is_ok());
        assert!(validate_event_id("../../secret").is_err());
        assert!(
            validate_shakemap_url(
                "https://earthquake.usgs.gov/pdl/products/example/contents/download/cont_mmi.json"
            )
            .is_ok()
        );
        assert!(validate_shakemap_url("https://example.com/cont_mmi.json").is_err());
    }

    #[test]
    fn contour_parser_rejects_invalid_coordinates_and_accepts_mmi_lines() {
        let value = serde_json::json!({
            "features": [
                {
                    "properties": { "value": 5.0, "units": "mmi", "color": "#74c7ec" },
                    "geometry": { "type": "LineString", "coordinates": [[-123.0, 40.0], [-122.0, 41.0]] }
                },
                {
                    "properties": { "value": 6.0, "units": "mmi", "color": "#bad" },
                    "geometry": { "type": "LineString", "coordinates": [[-123.0, 40.0], [500.0, 41.0]] }
                }
            ]
        });
        let contours = parse_contours(&value).expect("contour fixture");
        assert_eq!(contours.len(), 1);
        assert_eq!(contours[0].mmi, 5.0);
    }
}
