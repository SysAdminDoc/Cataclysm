use crate::data::geodesy::{GeodeticPosition, VerticalAxis, VerticalDatum};
use crate::physics::solver::{RawGridFields, SwGrid};

use super::codec::{capabilities, encode_packet};
use super::hash::sha256_hex;
use super::types::*;

const EMPTY_SHA256: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

pub fn scenario_packet(
    scenario_id: &str,
    canonical_scenario: &[u8],
    origin: GeodeticPosition,
    tick_duration_s: f64,
    provenance: PhysicsProvenanceV1,
) -> Result<Vec<u8>, String> {
    let transform = origin_transform();
    let header = ScenarioHeaderV1 {
        protocol: ProtocolVersion::default(),
        minimum_reader_minor: 0,
        required_features: capabilities().features,
        scenario_id: scenario_id.to_string(),
        scenario_sha256: sha256_hex(canonical_scenario),
        georeference: GeoreferenceV1::from_origin(origin)?,
        tick_duration_s,
        transforms: vec![transform],
        events: vec![RenderEventV1 {
            id: "water-propagation".into(),
            kind: EventKindV1::Tsunami,
            phase: EventPhaseV1::Scheduled,
            start_tick: 0,
            peak_tick: None,
            end_tick: None,
            transform_id: Some("scenario-origin".into()),
            quantities: Vec::new(),
            field_refs: Vec::new(),
        }],
        provenance,
        payload_sha256: EMPTY_SHA256.into(),
    };
    encode_packet(PacketHeaderV1::Scenario(Box::new(header)), &[], 0)
}

pub fn frame_packet_from_grid(
    scenario_id: &str,
    scenario_sha256: &str,
    grid: &SwGrid,
    tick_duration_s: f64,
    sequence: u64,
) -> Result<Vec<u8>, String> {
    let raw = grid.raw_render_fields();
    let (fields, payload) = encode_grid_fields(raw, grid.wet_mask_bits())?;
    let header = FrameHeaderV1 {
        protocol: ProtocolVersion::default(),
        minimum_reader_minor: 0,
        required_features: capabilities().features,
        scenario_id: scenario_id.to_string(),
        scenario_sha256: scenario_sha256.to_string(),
        solver_tick: grid.step_index,
        simulation_time_s: grid.t_s,
        tick_duration_s,
        keyframe: true,
        base_sequence: None,
        transforms: vec![origin_transform()],
        events: vec![RenderEventV1 {
            id: "water-propagation".into(),
            kind: EventKindV1::Tsunami,
            phase: if grid.step_index == 0 {
                EventPhaseV1::Scheduled
            } else {
                EventPhaseV1::Active
            },
            start_tick: 0,
            peak_tick: None,
            end_tick: None,
            transform_id: Some("scenario-origin".into()),
            quantities: vec![ScalarQuantityV1 {
                semantic: "simulation_time".into(),
                value: grid.t_s,
                unit: "second".into(),
            }],
            field_refs: vec![
                "eta".into(),
                "velocity_east".into(),
                "velocity_north".into(),
                "bathymetry".into(),
                "wet_mask".into(),
            ],
        }],
        fields,
        payload_sha256: EMPTY_SHA256.into(),
    };
    encode_packet(PacketHeaderV1::Frame(header), &payload, sequence)
}

pub fn end_packet(
    scenario_id: &str,
    scenario_sha256: &str,
    final_tick: u64,
    frame_count: u64,
    sequence: u64,
) -> Result<Vec<u8>, String> {
    encode_packet(
        PacketHeaderV1::End(EndHeaderV1 {
            protocol: ProtocolVersion::default(),
            minimum_reader_minor: 0,
            required_features: capabilities().features,
            scenario_id: scenario_id.to_string(),
            scenario_sha256: scenario_sha256.to_string(),
            final_tick,
            frame_count,
            payload_sha256: EMPTY_SHA256.into(),
        }),
        &[],
        sequence,
    )
}

fn origin_transform() -> TransformStateV1 {
    TransformStateV1 {
        id: "scenario-origin".into(),
        parent_frame: "local_enu".into(),
        translation_enu_m: [0.0, 0.0, 0.0],
        rotation_xyzw: [0.0, 0.0, 0.0, 1.0],
        scale: [1.0, 1.0, 1.0],
    }
}

fn encode_grid_fields(
    raw: RawGridFields<'_>,
    wet_mask: Vec<u8>,
) -> Result<(Vec<FieldDescriptorV1>, Vec<u8>), String> {
    let expected = raw
        .nx
        .checked_mul(raw.ny)
        .ok_or_else(|| "grid shape overflow".to_string())?;
    for (name, values) in [
        ("bathymetry", raw.bathymetry_depth_m),
        ("eta", raw.eta_m),
        ("velocity_east", raw.velocity_east_m_s),
        ("velocity_north", raw.velocity_north_m_s),
    ] {
        if values.len() != expected {
            return Err(format!("{name} field length does not match grid shape"));
        }
    }
    if wet_mask.len() != expected.div_ceil(8) {
        return Err("wet mask length does not match grid shape".into());
    }

    let west_cell_center_lon_deg =
        (raw.west_lon_deg + 0.5 * raw.dlon_deg + 180.0).rem_euclid(360.0) - 180.0;
    let geometry = GridGeometryV1 {
        nx: raw.nx as u32,
        ny: raw.ny as u32,
        west_cell_center_lon_deg,
        south_cell_center_lat_deg: raw.south_lat_deg + 0.5 * raw.dlat_deg,
        dlon_deg: raw.dlon_deg,
        dlat_deg: raw.dlat_deg,
        row_order: "south_to_north_west_to_east".into(),
        cell_registration: "cell_center".into(),
        longitude_wrap: "normalized_minus180_180".into(),
        tiles: crate::data::geodesy::geographic_field_tiles(
            raw.west_lon_deg,
            raw.south_lat_deg,
            raw.nx,
            raw.ny,
            raw.dlon_deg,
            raw.dlat_deg,
        )?,
    };
    let mut payload = Vec::new();
    let mut fields = Vec::new();
    append_f32_field(
        &mut fields,
        &mut payload,
        "eta",
        FieldSemanticV1::WaterSurfaceEtaM,
        "metre",
        Some(VerticalDatum::IdealizedMeanSeaLevel),
        Some(VerticalAxis::PositiveUp),
        geometry.clone(),
        raw.eta_m,
    )?;
    append_f32_field(
        &mut fields,
        &mut payload,
        "velocity_east",
        FieldSemanticV1::WaterVelocityEastMS,
        "metre_per_second",
        None,
        None,
        geometry.clone(),
        raw.velocity_east_m_s,
    )?;
    append_f32_field(
        &mut fields,
        &mut payload,
        "velocity_north",
        FieldSemanticV1::WaterVelocityNorthMS,
        "metre_per_second",
        None,
        None,
        geometry.clone(),
        raw.velocity_north_m_s,
    )?;
    append_f32_field(
        &mut fields,
        &mut payload,
        "bathymetry",
        FieldSemanticV1::BathymetryDepthM,
        "metre",
        Some(VerticalDatum::DepthBelowIdealizedMeanSeaLevel),
        Some(VerticalAxis::PositiveDown),
        geometry.clone(),
        raw.bathymetry_depth_m,
    )?;
    append_bitset_field(&mut fields, &mut payload, geometry, wet_mask);
    Ok((fields, payload))
}

#[allow(clippy::too_many_arguments)]
fn append_f32_field(
    descriptors: &mut Vec<FieldDescriptorV1>,
    payload: &mut Vec<u8>,
    id: &str,
    semantic: FieldSemanticV1,
    unit: &str,
    vertical_datum: Option<VerticalDatum>,
    vertical_axis: Option<VerticalAxis>,
    grid: GridGeometryV1,
    source: &[f64],
) -> Result<(), String> {
    let offset = payload.len();
    let mut minimum = f64::INFINITY;
    let mut maximum = f64::NEG_INFINITY;
    let mut conversion_error = 0.0_f64;
    for value in source {
        if !value.is_finite() {
            return Err(format!("field {id} contains a non-finite value"));
        }
        let encoded = *value as f32;
        if !encoded.is_finite() {
            return Err(format!("field {id} exceeds finite f32 range"));
        }
        minimum = minimum.min(*value);
        maximum = maximum.max(*value);
        conversion_error = conversion_error.max((*value - encoded as f64).abs());
        payload.extend_from_slice(&encoded.to_le_bytes());
    }
    let chunk = &payload[offset..];
    // JSON parsers are allowed to normalize negative zero. Canonicalize scalar
    // metadata here so decode/re-encode remains byte-stable.
    if minimum == 0.0 {
        minimum = 0.0;
    }
    if maximum == 0.0 {
        maximum = 0.0;
    }
    descriptors.push(FieldDescriptorV1 {
        id: id.into(),
        semantic,
        data_type: FieldDataTypeV1::F32Le,
        codec: FieldCodecV1::None,
        unit: unit.into(),
        vertical_datum,
        vertical_axis,
        grid,
        byte_offset: offset as u32,
        byte_length: chunk.len() as u32,
        element_count: source.len() as u32,
        minimum: Some(minimum),
        maximum: Some(maximum),
        maximum_abs_conversion_error: Some(conversion_error),
        sha256: sha256_hex(chunk),
    });
    Ok(())
}

fn append_bitset_field(
    descriptors: &mut Vec<FieldDescriptorV1>,
    payload: &mut Vec<u8>,
    grid: GridGeometryV1,
    wet_mask: Vec<u8>,
) {
    let offset = payload.len();
    payload.extend_from_slice(&wet_mask);
    descriptors.push(FieldDescriptorV1 {
        id: "wet_mask".into(),
        semantic: FieldSemanticV1::WetMask,
        data_type: FieldDataTypeV1::BitsetU1,
        codec: FieldCodecV1::None,
        unit: "boolean".into(),
        vertical_datum: None,
        vertical_axis: None,
        grid: grid.clone(),
        byte_offset: offset as u32,
        byte_length: wet_mask.len() as u32,
        element_count: grid.nx * grid.ny,
        minimum: Some(0.0),
        maximum: Some(1.0),
        maximum_abs_conversion_error: Some(0.0),
        sha256: sha256_hex(&wet_mask),
    });
}

pub fn golden_recording_packets() -> Result<Vec<Vec<u8>>, String> {
    const SCENARIO: &[u8] = br#"{"id":"golden-4x3","source":"deterministic_fixture","version":1}"#;
    let scenario_id = "golden-4x3";
    let scenario_sha = sha256_hex(SCENARIO);
    let provenance = PhysicsProvenanceV1 {
        authority: "rust".into(),
        model_versions: vec![ModelVersionV1 {
            component: "golden_fixture".into(),
            version: "1.0.0".into(),
        }],
        geodesy_contract_version: crate::data::geodesy::CONTRACT_VERSION.into(),
        surface_mask_version: Some("fixture-1".into()),
        bathymetry_asset_id: Some("golden-4x3-depth".into()),
        solver_backend: "deterministic_fixture".into(),
    };
    let mut packets = vec![scenario_packet(
        scenario_id,
        SCENARIO,
        GeodeticPosition {
            lat_deg: 0.0,
            lon_deg: 0.0,
            ellipsoid_height_m: 0.0,
        },
        0.5,
        provenance,
    )?];

    for tick in 0..3_u64 {
        let mut grid = SwGrid::new(-2.0, -1.5, 2.0, 1.5, 1.0, 1.0);
        for index in 0..12 {
            grid.h_m[index] = if index == 0 {
                1.0
            } else {
                100.0 + index as f64 * 25.0
            };
            grid.eta_m[index] = tick as f64 * 0.25 + (index as f64 - 5.5) * 0.01;
            grid.u_ms[index] = tick as f64 * 0.1 + index as f64 * 0.001;
            grid.v_ms[index] = -(tick as f64 * 0.05) - index as f64 * 0.002;
        }
        grid.step_index = tick;
        grid.t_s = tick as f64 * 0.5;
        packets.push(frame_packet_from_grid(
            scenario_id,
            &scenario_sha,
            &grid,
            0.5,
            tick + 1,
        )?);
    }
    packets.push(end_packet(scenario_id, &scenario_sha, 2, 3, 4)?);
    Ok(packets)
}

/// Deterministic length-prefixed bytes suitable for committing as a golden
/// fixture once the parent integration adds the public module wiring.
pub fn golden_recording_bytes() -> Result<Vec<u8>, String> {
    let packets = golden_recording_packets()?;
    let mut bytes = Vec::new();
    for packet in packets {
        bytes.extend_from_slice(&(packet.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&packet);
    }
    Ok(bytes)
}
