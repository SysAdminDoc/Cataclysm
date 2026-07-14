use std::collections::HashSet;

use crate::data::geodesy;

use super::hash::{is_sha256_hex, sha256_hex};
use super::types::*;

pub const MAGIC: [u8; 8] = *b"CATRFRM\0";
pub const PRELUDE_BYTES: usize = 32;
pub const MAX_HEADER_BYTES: usize = 1_048_576;
pub const MAX_PAYLOAD_BYTES: usize = 256 * 1024 * 1024;
pub const MAX_FIELDS: usize = 32;
pub const MAX_CELLS: usize = 4_000_000;
pub const MAX_EVENTS: usize = 4096;
pub const MAX_TRANSFORMS: usize = 4096;
pub const FLAG_KEYFRAME: u8 = 0x01;
const SUPPORTED_FLAGS: u8 = FLAG_KEYFRAME;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PacketPrelude {
    pub major: u16,
    pub minor: u16,
    pub kind: u8,
    pub flags: u8,
    pub header_len: u32,
    pub payload_len: u32,
    pub sequence: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DecodedPacketV1 {
    pub prelude: PacketPrelude,
    pub header: PacketHeaderV1,
    pub payload: Vec<u8>,
}

pub fn capabilities() -> ProtocolCapabilitiesV1 {
    ProtocolCapabilitiesV1 {
        protocol: ProtocolVersion::default(),
        minimum_reader_minor: 0,
        features: supported_features()
            .into_iter()
            .map(str::to_string)
            .collect(),
        codecs: vec![FieldCodecV1::None],
        maximum_header_bytes: MAX_HEADER_BYTES as u32,
        maximum_payload_bytes: MAX_PAYLOAD_BYTES as u32,
        maximum_fields: MAX_FIELDS as u16,
        maximum_cells: MAX_CELLS as u32,
    }
}

fn supported_features() -> [&'static str; 7] {
    [
        "json_header",
        "raw_f32_fields",
        "bitset_wet_mask",
        "sha256",
        "local_enu",
        "authoritative_tick",
        "codec_none",
    ]
}

pub fn encode_packet(
    mut header: PacketHeaderV1,
    payload: &[u8],
    sequence: u64,
) -> Result<Vec<u8>, String> {
    if payload.len() > MAX_PAYLOAD_BYTES {
        return Err("protocol payload exceeds maximum size".into());
    }
    set_payload_sha256(&mut header, sha256_hex(payload));
    validate_header(&header, payload, sequence)?;
    let json =
        serde_json::to_vec(&header).map_err(|error| format!("serialize frame header: {error}"))?;
    if json.len() > MAX_HEADER_BYTES {
        return Err("protocol JSON header exceeds maximum size".into());
    }
    let flags = match &header {
        PacketHeaderV1::Frame(frame) if frame.keyframe => FLAG_KEYFRAME,
        _ => 0,
    };
    let mut bytes = Vec::with_capacity(PRELUDE_BYTES + json.len() + payload.len());
    bytes.extend_from_slice(&MAGIC);
    bytes.extend_from_slice(&PROTOCOL_MAJOR.to_le_bytes());
    bytes.extend_from_slice(&PROTOCOL_MINOR.to_le_bytes());
    bytes.push(header.kind_code());
    bytes.push(flags);
    bytes.extend_from_slice(&0_u16.to_le_bytes());
    bytes.extend_from_slice(&(json.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&sequence.to_le_bytes());
    debug_assert_eq!(bytes.len(), PRELUDE_BYTES);
    bytes.extend_from_slice(&json);
    bytes.extend_from_slice(payload);
    Ok(bytes)
}

pub fn decode_packet(bytes: &[u8]) -> Result<DecodedPacketV1, String> {
    if bytes.len() < PRELUDE_BYTES {
        return Err("protocol packet is shorter than the 32-byte prelude".into());
    }
    if bytes[..8] != MAGIC {
        return Err("protocol packet magic is invalid".into());
    }
    let read_u16 = |offset| u16::from_le_bytes(bytes[offset..offset + 2].try_into().unwrap());
    let read_u32 = |offset| u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap());
    let read_u64 = |offset| u64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap());
    let prelude = PacketPrelude {
        major: read_u16(8),
        minor: read_u16(10),
        kind: bytes[12],
        flags: bytes[13],
        header_len: read_u32(16),
        payload_len: read_u32(20),
        sequence: read_u64(24),
    };
    if read_u16(14) != 0 {
        return Err("protocol reserved prelude bits must be zero".into());
    }
    if prelude.major != PROTOCOL_MAJOR {
        return Err(format!(
            "unsupported breaking protocol major {} (reader supports {})",
            prelude.major, PROTOCOL_MAJOR
        ));
    }
    if prelude.flags & !SUPPORTED_FLAGS != 0 {
        return Err("protocol packet uses unknown required flag bits".into());
    }
    let header_len = prelude.header_len as usize;
    let payload_len = prelude.payload_len as usize;
    if header_len > MAX_HEADER_BYTES || payload_len > MAX_PAYLOAD_BYTES {
        return Err("protocol packet declares an oversized header or payload".into());
    }
    let expected_len = PRELUDE_BYTES
        .checked_add(header_len)
        .and_then(|length| length.checked_add(payload_len))
        .ok_or_else(|| "protocol packet length overflow".to_string())?;
    if bytes.len() != expected_len {
        return Err("protocol packet length does not match its prelude".into());
    }
    let header_end = PRELUDE_BYTES + header_len;
    let header: PacketHeaderV1 = serde_json::from_slice(&bytes[PRELUDE_BYTES..header_end])
        .map_err(|error| format!("invalid protocol JSON header: {error}"))?;
    let payload = bytes[header_end..].to_vec();
    if prelude.kind != header.kind_code() {
        return Err("protocol prelude kind disagrees with JSON header".into());
    }
    if prelude.major != header.protocol().major || prelude.minor != header.protocol().minor {
        return Err("protocol prelude version disagrees with JSON header".into());
    }
    let keyframe_flag = prelude.flags & FLAG_KEYFRAME != 0;
    if keyframe_flag != matches!(&header, PacketHeaderV1::Frame(frame) if frame.keyframe) {
        return Err("protocol keyframe flag disagrees with JSON header".into());
    }
    validate_header(&header, &payload, prelude.sequence)?;
    Ok(DecodedPacketV1 {
        prelude,
        header,
        payload,
    })
}

fn set_payload_sha256(header: &mut PacketHeaderV1, digest: String) {
    match header {
        PacketHeaderV1::Scenario(value) => value.payload_sha256 = digest,
        PacketHeaderV1::Frame(value) => value.payload_sha256 = digest,
        PacketHeaderV1::End(value) => value.payload_sha256 = digest,
    }
}

fn validate_header(header: &PacketHeaderV1, payload: &[u8], sequence: u64) -> Result<(), String> {
    validate_compatibility(header)?;
    if !is_sha256_hex(header.payload_sha256()) || header.payload_sha256() != sha256_hex(payload) {
        return Err("protocol payload SHA-256 mismatch".into());
    }
    match header {
        PacketHeaderV1::Scenario(value) => validate_scenario(value, payload, sequence),
        PacketHeaderV1::Frame(value) => validate_frame(value, payload, sequence),
        PacketHeaderV1::End(value) => validate_end(value, payload, sequence),
    }
}

fn validate_compatibility(header: &PacketHeaderV1) -> Result<(), String> {
    let protocol = header.protocol();
    if protocol.major != PROTOCOL_MAJOR {
        return Err(format!(
            "unsupported breaking protocol major {}",
            protocol.major
        ));
    }
    if header.minimum_reader_minor() > PROTOCOL_MINOR {
        return Err(format!(
            "packet requires protocol reader minor {}, reader supports {}",
            header.minimum_reader_minor(),
            PROTOCOL_MINOR
        ));
    }
    let supported = supported_features();
    for feature in header.required_features() {
        if !supported.contains(&feature.as_str()) {
            return Err(format!("unsupported required protocol feature {feature}"));
        }
    }
    Ok(())
}

fn validate_scenario(
    value: &ScenarioHeaderV1,
    payload: &[u8],
    sequence: u64,
) -> Result<(), String> {
    validate_identity(&value.scenario_id, &value.scenario_sha256)?;
    validate_time(value.tick_duration_s)?;
    validate_georeference(&value.georeference)?;
    validate_transforms_and_events(&value.transforms, &value.events, None)?;
    if value.provenance.authority != "rust" {
        return Err("scenario physics authority must be rust".into());
    }
    if value.provenance.geodesy_contract_version != geodesy::CONTRACT_VERSION {
        return Err("scenario geodesy contract version is unsupported".into());
    }
    if sequence != 0 {
        return Err("scenario packet must have sequence zero".into());
    }
    if !payload.is_empty() {
        return Err("v1 scenario packet payload must be empty".into());
    }
    Ok(())
}

fn validate_frame(value: &FrameHeaderV1, payload: &[u8], sequence: u64) -> Result<(), String> {
    validate_identity(&value.scenario_id, &value.scenario_sha256)?;
    validate_time(value.tick_duration_s)?;
    finite("simulation_time_s", value.simulation_time_s)?;
    if value.simulation_time_s < 0.0 {
        return Err("simulation_time_s must be non-negative".into());
    }
    let expected_time = value.solver_tick as f64 * value.tick_duration_s;
    if !expected_time.is_finite()
        || (value.simulation_time_s - expected_time).abs() > value.tick_duration_s + 1e-12
    {
        return Err("simulation time differs from authoritative tick by more than one tick".into());
    }
    if value.keyframe != value.base_sequence.is_none() {
        return Err("keyframe/base_sequence relationship is invalid".into());
    }
    if value.base_sequence.is_some_and(|base| base >= sequence) {
        return Err("base_sequence must precede the current packet".into());
    }
    validate_fields(&value.fields, payload)?;
    let field_ids: HashSet<&str> = value.fields.iter().map(|field| field.id.as_str()).collect();
    validate_transforms_and_events(&value.transforms, &value.events, Some(&field_ids))?;
    Ok(())
}

fn validate_end(value: &EndHeaderV1, payload: &[u8], sequence: u64) -> Result<(), String> {
    validate_identity(&value.scenario_id, &value.scenario_sha256)?;
    if !payload.is_empty() {
        return Err("v1 end packet payload must be empty".into());
    }
    if value.frame_count > sequence {
        return Err("end frame_count exceeds packet sequence".into());
    }
    Ok(())
}

fn validate_identity(scenario_id: &str, scenario_sha256: &str) -> Result<(), String> {
    if scenario_id.is_empty() || scenario_id.len() > 128 {
        return Err("scenario_id must contain 1..128 bytes".into());
    }
    if !is_sha256_hex(scenario_sha256) {
        return Err("scenario_sha256 must be lowercase SHA-256 hex".into());
    }
    Ok(())
}

fn validate_time(tick_duration_s: f64) -> Result<(), String> {
    finite("tick_duration_s", tick_duration_s)?;
    if tick_duration_s <= 0.0 {
        return Err("tick_duration_s must be positive".into());
    }
    Ok(())
}

fn validate_georeference(value: &GeoreferenceV1) -> Result<(), String> {
    if value.contract_version != geodesy::CONTRACT_VERSION
        || value.geographic_crs != geodesy::HORIZONTAL_CRS_GEOGRAPHIC_3D
        || value.ecef_crs != geodesy::HORIZONTAL_CRS_ECEF
        || value.matrix_order != "column_major"
        || value.local_unit != "metre"
        || value.unreal_centimetres_per_metre != 100
    {
        return Err("georeference contract metadata is unsupported".into());
    }
    for component in value
        .local_enu_to_ecef
        .iter()
        .chain(value.ecef_to_local_enu.iter())
    {
        finite("georeference matrix", *component)?;
    }
    let expected = geodesy::geodetic_to_ecef(value.origin)
        .ok_or_else(|| "georeference origin is invalid".to_string())?;
    let error = ((expected.x_m - value.origin_ecef_m.x_m).powi(2)
        + (expected.y_m - value.origin_ecef_m.y_m).powi(2)
        + (expected.z_m - value.origin_ecef_m.z_m).powi(2))
    .sqrt();
    if !error.is_finite() || error > 1.0 {
        return Err("georeference origin ECEF differs by more than 1 metre".into());
    }
    let matrix_origin = value.local_to_ecef([0.0, 0.0, 0.0]);
    let matrix_error = ((matrix_origin[0] - expected.x_m).powi(2)
        + (matrix_origin[1] - expected.y_m).powi(2)
        + (matrix_origin[2] - expected.z_m).powi(2))
    .sqrt();
    if matrix_error > 1.0 {
        return Err("local ENU transform origin differs by more than 1 metre".into());
    }
    Ok(())
}

fn validate_transforms_and_events(
    transforms: &[TransformStateV1],
    events: &[RenderEventV1],
    field_ids: Option<&HashSet<&str>>,
) -> Result<(), String> {
    if transforms.len() > MAX_TRANSFORMS || events.len() > MAX_EVENTS {
        return Err("protocol transform/event count exceeds safety cap".into());
    }
    let mut transform_ids = HashSet::new();
    for transform in transforms {
        if transform.id.is_empty() || !transform_ids.insert(transform.id.as_str()) {
            return Err("transform IDs must be non-empty and unique".into());
        }
        for value in transform.translation_enu_m {
            finite("transform translation", value)?;
        }
        for value in transform.rotation_xyzw {
            finite("transform rotation", value)?;
        }
        for value in transform.scale {
            finite("transform scale", value as f64)?;
            if value <= 0.0 {
                return Err("transform scale must be positive".into());
            }
        }
        let norm_sq: f64 = transform
            .rotation_xyzw
            .iter()
            .map(|value| value * value)
            .sum();
        if (norm_sq - 1.0).abs() > 1e-6 {
            return Err("transform quaternion must be normalized".into());
        }
    }
    let mut event_ids = HashSet::new();
    for event in events {
        if event.id.is_empty() || !event_ids.insert(event.id.as_str()) {
            return Err("event IDs must be non-empty and unique".into());
        }
        if event.peak_tick.is_some_and(|tick| tick < event.start_tick)
            || event.end_tick.is_some_and(|tick| tick < event.start_tick)
            || matches!((event.peak_tick, event.end_tick), (Some(peak), Some(end)) if peak > end)
        {
            return Err("event tick interval is invalid".into());
        }
        if event
            .transform_id
            .as_deref()
            .is_some_and(|id| !transform_ids.contains(id))
        {
            return Err("event references an unknown transform".into());
        }
        for quantity in &event.quantities {
            if quantity.semantic.is_empty() || quantity.unit.is_empty() {
                return Err("event quantities require semantic and unit".into());
            }
            finite("event quantity", quantity.value)?;
        }
        if let Some(field_ids) = field_ids
            && event
                .field_refs
                .iter()
                .any(|id| !field_ids.contains(id.as_str()))
        {
            return Err("event references an unknown field".into());
        }
    }
    Ok(())
}

fn validate_fields(fields: &[FieldDescriptorV1], payload: &[u8]) -> Result<(), String> {
    if fields.len() > MAX_FIELDS {
        return Err("protocol field count exceeds safety cap".into());
    }
    let mut ids = HashSet::new();
    let mut ranges = Vec::with_capacity(fields.len());
    for field in fields {
        if field.id.is_empty() || !ids.insert(field.id.as_str()) {
            return Err("field IDs must be non-empty and unique".into());
        }
        if field.codec != FieldCodecV1::None {
            return Err("v1 initial protocol supports only codec none".into());
        }
        validate_grid(&field.grid)?;
        let cells = (field.grid.nx as usize)
            .checked_mul(field.grid.ny as usize)
            .ok_or_else(|| "field shape overflow".to_string())?;
        if cells == 0 || cells > MAX_CELLS || field.element_count as usize != cells {
            return Err("field shape/element_count is invalid".into());
        }
        let expected_bytes = match field.data_type {
            FieldDataTypeV1::F32Le => cells.checked_mul(4),
            FieldDataTypeV1::BitsetU1 => Some(cells.div_ceil(8)),
        }
        .ok_or_else(|| "field byte length overflow".to_string())?;
        if field.byte_length as usize != expected_bytes {
            return Err("field byte length does not match shape and dtype".into());
        }
        let start = field.byte_offset as usize;
        let end = start
            .checked_add(field.byte_length as usize)
            .ok_or_else(|| "field payload range overflow".to_string())?;
        if end > payload.len() {
            return Err("field payload range exceeds packet payload".into());
        }
        ranges.push((start, end));
        let chunk = &payload[start..end];
        if !is_sha256_hex(&field.sha256) || field.sha256 != sha256_hex(chunk) {
            return Err(format!("field {} SHA-256 mismatch", field.id));
        }
        if field.unit.is_empty() {
            return Err("field unit must be explicit".into());
        }
        if let Some(minimum) = field.minimum {
            finite("field minimum", minimum)?;
        }
        if let Some(maximum) = field.maximum {
            finite("field maximum", maximum)?;
        }
        if matches!((field.minimum, field.maximum), (Some(minimum), Some(maximum)) if minimum > maximum)
        {
            return Err("field minimum exceeds maximum".into());
        }
        if let Some(error) = field.maximum_abs_conversion_error {
            finite("field conversion error", error)?;
            if error < 0.0 {
                return Err("field conversion error must be non-negative".into());
            }
        }
        if field.data_type == FieldDataTypeV1::F32Le {
            for encoded in chunk.chunks_exact(4) {
                let value = f32::from_le_bytes(encoded.try_into().unwrap());
                if !value.is_finite() {
                    return Err(format!("field {} contains non-finite f32", field.id));
                }
            }
        } else {
            if field.semantic != FieldSemanticV1::WetMask {
                return Err("bitset_u1 is only valid for the wet_mask semantic".into());
            }
            let used_bits = cells % 8;
            if used_bits != 0 {
                let unused_mask = !((1_u8 << used_bits) - 1);
                if chunk.last().is_some_and(|last| last & unused_mask != 0) {
                    return Err("wet mask has non-zero unused high bits".into());
                }
            }
        }
    }
    ranges.sort_unstable();
    let mut previous_end = 0;
    for (start, end) in ranges {
        if start != previous_end {
            return Err("field payload ranges must be contiguous and non-overlapping".into());
        }
        previous_end = end;
    }
    if previous_end != payload.len() {
        return Err("packet payload contains unreferenced bytes".into());
    }
    Ok(())
}

fn validate_grid(grid: &GridGeometryV1) -> Result<(), String> {
    finite("west cell center", grid.west_cell_center_lon_deg)?;
    finite("south cell center", grid.south_cell_center_lat_deg)?;
    finite("dlon_deg", grid.dlon_deg)?;
    finite("dlat_deg", grid.dlat_deg)?;
    if !(-180.0..=180.0).contains(&grid.west_cell_center_lon_deg)
        || !(-90.0..=90.0).contains(&grid.south_cell_center_lat_deg)
        || grid.dlon_deg <= 0.0
        || grid.dlat_deg <= 0.0
        || grid.row_order != "south_to_north_west_to_east"
        || grid.cell_registration != "cell_center"
        || grid.longitude_wrap != "normalized_minus180_180"
    {
        return Err("field grid metadata is invalid or unsupported".into());
    }
    let north = grid.south_cell_center_lat_deg + grid.dlat_deg * (grid.ny.saturating_sub(1)) as f64;
    if north > 90.0 + 1e-9 {
        return Err("field grid extends north of 90 degrees".into());
    }
    if !grid.tiles.is_empty() {
        let expected = geodesy::geographic_field_tiles(
            grid.west_cell_center_lon_deg - 0.5 * grid.dlon_deg,
            grid.south_cell_center_lat_deg - 0.5 * grid.dlat_deg,
            grid.nx as usize,
            grid.ny as usize,
            grid.dlon_deg,
            grid.dlat_deg,
        )?;
        if grid.tiles.len() != expected.len()
            || grid
                .tiles
                .iter()
                .zip(expected.iter())
                .any(|(actual, expected)| {
                    actual.column_offset != expected.column_offset
                        || actual.column_count != expected.column_count
                        || actual
                            .bbox
                            .iter()
                            .zip(expected.bbox.iter())
                            .any(|(left, right)| (left - right).abs() > 1.0e-9)
                })
        {
            return Err("field grid tile layout is invalid or incomplete".into());
        }
    }
    Ok(())
}

fn finite(name: &str, value: f64) -> Result<(), String> {
    if value.is_finite() {
        Ok(())
    } else {
        Err(format!("{name} must be finite"))
    }
}
