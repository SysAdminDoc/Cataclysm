use super::*;

#[derive(Debug, Deserialize)]
pub struct SurfaceProbeRequest {
    pub lat_deg: f64,
    pub lon_deg: f64,
}

#[tauri::command]
pub fn surface_probe(
    req: SurfaceProbeRequest,
) -> Result<crate::data::surface::SurfaceProbe, String> {
    check_lat_lon_values("surface probe", req.lat_deg, req.lon_deg)?;
    crate::data::surface::probe(req.lat_deg, req.lon_deg)
        .ok_or_else(|| "surface probe coordinates are not finite or normalized".to_string())
}

#[tauri::command]
pub fn simulate_asteroid_hazard(
    req: crate::physics::direct_hazard::AsteroidHazardRequest,
) -> Result<crate::physics::direct_hazard::HazardResult, String> {
    let canonical = serde_json::to_vec(&req)
        .map_err(|error| format!("failed to identify asteroid result: {error}"))?;
    crate::physics::direct_hazard::simulate_asteroid_hazard(req)
        .map(|result| crate::physics::direct_hazard_probe::register_result(result, &canonical))
}

#[tauri::command]
pub fn simulate_nuclear_hazard(
    req: crate::physics::direct_hazard::NuclearHazardRequest,
) -> Result<crate::physics::direct_hazard::HazardResult, String> {
    let canonical = serde_json::to_vec(&req)
        .map_err(|error| format!("failed to identify nuclear result: {error}"))?;
    crate::physics::direct_hazard::simulate_nuclear_hazard(req)
        .map(|result| crate::physics::direct_hazard_probe::register_result(result, &canonical))
}

#[tauri::command]
pub fn probe_direct_hazard(
    req: crate::physics::direct_hazard_probe::DirectHazardProbeRequest,
) -> Result<crate::physics::direct_hazard_probe::DirectHazardProbeResult, String> {
    crate::physics::direct_hazard_probe::probe(req)
}

#[tauri::command]
pub fn nuclear_shelter_advisor(
    result_id: String,
) -> Result<crate::physics::direct_hazard::NuclearShelterReport, String> {
    crate::physics::direct_hazard_probe::shelter_report(result_id)
}

#[tauri::command]
pub fn fallout_dose_probe(
    req: crate::physics::fallout::FalloutDoseInput,
) -> Result<crate::physics::fallout::FalloutDoseReport, String> {
    crate::physics::fallout::dose_report(req).ok_or_else(|| {
        "early-fallout screening requires finite, positive yield, fission fraction, and wind speed"
            .to_string()
    })
}

#[tauri::command]
pub fn asteroid_result_visuals(
    result_id: String,
) -> Result<crate::physics::direct_hazard_probe::AsteroidVisualReport, String> {
    crate::physics::direct_hazard_probe::asteroid_visual_report(result_id)
}

#[tauri::command]
pub async fn jpl_api_request(
    req: crate::jpl_api::JplApiRequest,
) -> Result<serde_json::Value, String> {
    crate::jpl_api::request(req).await
}

#[tauri::command]
pub async fn ncei_hazel_search(
    req: crate::ncei_hazel::HazelEventSearchRequest,
) -> Result<crate::ncei_hazel::HazelEventSearchResponse, String> {
    crate::ncei_hazel::search(req).await
}

#[tauri::command]
pub async fn usgs_recent_earthquakes()
-> Result<crate::usgs_earthquakes::UsgsRecentEarthquakesResponse, String> {
    crate::usgs_earthquakes::recent().await
}

#[tauri::command]
pub async fn usgs_earthquake_detail(
    req: crate::usgs_earthquakes::UsgsEarthquakeDetailRequest,
) -> Result<crate::usgs_earthquakes::UsgsEarthquakeDetail, String> {
    crate::usgs_earthquakes::detail(req).await
}

fn render_recording_response(packets: Vec<Vec<u8>>) -> Result<Response, String> {
    let total = packets.iter().try_fold(0_usize, |total, packet| {
        total
            .checked_add(4)
            .and_then(|value| value.checked_add(packet.len()))
            .ok_or_else(|| "render recording length overflow".to_string())
    })?;
    let mut recording = Vec::with_capacity(total);
    for packet in packets {
        let length = u32::try_from(packet.len())
            .map_err(|_| "render packet exceeds the u32 recording limit".to_string())?;
        recording.extend_from_slice(&length.to_le_bytes());
        recording.extend_from_slice(&packet);
    }
    Ok(Response::new(recording))
}

#[tauri::command]
pub fn simulate_asteroid_hazard_render(
    req: crate::physics::direct_hazard::AsteroidHazardRequest,
) -> Result<Response, String> {
    let (_, packets) = crate::render_protocol::asteroid_render_recording(&req)?;
    render_recording_response(packets)
}

#[tauri::command]
pub fn simulate_nuclear_hazard_render(
    req: crate::physics::direct_hazard::NuclearHazardRequest,
) -> Result<Response, String> {
    let (_, packets) = crate::render_protocol::nuclear_render_recording(&req)?;
    render_recording_response(packets)
}

#[tauri::command]
pub fn asteroid_initial_conditions(input: AsteroidImpact) -> Result<InitialDisplacement, String> {
    let validate = |field, value| {
        crate::data::source_input_contract::validate_number("Asteroid", field, value)
    };
    validate("diameter_m", input.diameter_m)?;
    validate("density_kg_m3", input.density_kg_m3)?;
    validate("velocity_m_s", input.velocity_m_s)?;
    validate("angle_deg", input.angle_deg)?;
    validate("water_depth_m", input.water_depth_m)?;
    validate("lat_deg", input.location.lat_deg)?;
    validate("lon_deg", input.location.lon_deg)?;
    Ok(input.initial_displacement())
}

#[tauri::command]
pub fn nuclear_initial_conditions(input: NuclearBurst) -> Result<InitialDisplacement, String> {
    let validate =
        |field, value| crate::data::source_input_contract::validate_number("Nuclear", field, value);
    crate::data::source_input_contract::validate_serialized_enum(
        "Nuclear",
        "burst_mode",
        input.burst_mode,
    )?;
    validate("yield_kt", input.yield_kt)?;
    validate("burst_depth_m", input.burst_depth_m)?;
    validate("water_depth_m", input.water_depth_m)?;
    validate("lat_deg", input.location.lat_deg)?;
    validate("lon_deg", input.location.lon_deg)?;
    Ok(input.initial_displacement())
}

#[tauri::command]
pub fn landslide_initial_conditions(input: LandslideSource) -> Result<InitialDisplacement, String> {
    let validate = |field, value| {
        crate::data::source_input_contract::validate_number("Landslide", field, value)
    };
    crate::data::source_input_contract::validate_serialized_enum("Landslide", "kind", input.kind)?;
    validate("volume_m3", input.volume_m3)?;
    validate("density_kg_m3", input.density_kg_m3)?;
    validate("drop_height_m", input.drop_height_m)?;
    validate("slope_deg", input.slope_deg)?;
    validate("water_depth_m", input.water_depth_m)?;
    validate("water_body_width_m", input.water_body_width_m)?;
    validate("lat_deg", input.location.lat_deg)?;
    validate("lon_deg", input.location.lon_deg)?;
    Ok(input.initial_displacement())
}

#[tauri::command]
pub fn earthquake_initial_conditions(
    input: EarthquakeSource,
) -> Result<InitialDisplacement, String> {
    let validate = |field, value| {
        crate::data::source_input_contract::validate_number("Earthquake", field, value)
    };
    validate("mw", input.mw)?;
    validate("depth_m", input.depth_m)?;
    validate("strike_deg", input.strike_deg)?;
    validate("dip_deg", input.dip_deg)?;
    validate("rake_deg", input.rake_deg)?;
    validate("slip_m", input.slip_m)?;
    validate("fault_length_m", input.fault_length_m)?;
    validate("fault_width_m", input.fault_width_m)?;
    validate("water_depth_m", input.water_depth_m)?;
    validate("lat_deg", input.location.lat_deg)?;
    validate("lon_deg", input.location.lon_deg)?;
    Ok(input.initial_displacement())
}

#[tauri::command]
pub fn meteotsunami_initial_conditions(
    input: MeteotsunamiSource,
) -> Result<InitialDisplacement, String> {
    let validate = |field, value| {
        crate::data::source_input_contract::validate_number("Meteotsunami", field, value)
    };
    validate("peak_pressure_pa", input.peak_pressure_pa)?;
    validate("speed_m_s", input.speed_m_s)?;
    validate("heading_deg", input.heading_deg)?;
    validate("along_track_sigma_m", input.along_track_sigma_m)?;
    validate("cross_track_sigma_m", input.cross_track_sigma_m)?;
    validate("track_length_m", input.track_length_m)?;
    validate("water_depth_m", input.water_depth_m)?;
    validate("lat_deg", input.location.lat_deg)?;
    validate("lon_deg", input.location.lon_deg)?;
    Ok(input.initial_displacement())
}
