import { geodeticToEcef } from "../../lib/geodesy";
import {
  RENDER_PROTOCOL_FEATURES,
  RENDER_PROTOCOL_FLAG_KEYFRAME,
  RENDER_PROTOCOL_MAGIC,
  RENDER_PROTOCOL_MAJOR,
  RENDER_PROTOCOL_MINOR,
  RENDER_PROTOCOL_PRELUDE_BYTES,
  type BitsetU1FieldView,
  type DecodedEndPacket,
  type DecodedFramePacket,
  type DecodedRenderPacket,
  type DecodedScenarioPacket,
  type EcefPositionV1,
  type EndHeaderV1,
  type EventKindV1,
  type EventPhaseV1,
  type F32LeFieldView,
  type FieldDataTypeV1,
  type FieldDescriptorV1,
  type FieldSemanticV1,
  type FrameHeaderV1,
  type GeodeticPositionV1,
  type GeographicFieldTileV1,
  type GeoreferenceV1,
  type GridGeometryV1,
  type PhysicsProvenanceV1,
  type ProtocolVersion,
  type RenderEventV1,
  type RenderFieldView,
  type RenderPacketPrelude,
  type RenderProtocolFeature,
  type RenderProtocolPacketKind,
  type ScalarQuantityV1,
  type ScenarioHeaderV1,
  type TransformStateV1,
  type VerticalAxisV1,
  type VerticalDatumV1,
} from "../../types/render-protocol";

export type RenderProtocolLimits = Readonly<{
  max_packet_bytes: number;
  max_header_bytes: number;
  max_payload_bytes: number;
  max_fields: number;
  max_cells: number;
  max_events: number;
  max_transforms: number;
  max_required_features: number;
}>;

export const DEFAULT_RENDER_PROTOCOL_LIMITS: RenderProtocolLimits = Object.freeze({
  max_packet_bytes: 257 * 1024 * 1024 + RENDER_PROTOCOL_PRELUDE_BYTES,
  max_header_bytes: 1_048_576,
  max_payload_bytes: 256 * 1024 * 1024,
  max_fields: 32,
  max_cells: 4_000_000,
  max_events: 4096,
  max_transforms: 4096,
  max_required_features: 64,
});

export type RenderProtocolDecoderOptions = Readonly<{
  limits?: Partial<RenderProtocolLimits>;
  supported_features?: readonly string[];
  supported_minor?: number;
}>;

export class RenderProtocolDecodeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RenderProtocolDecodeError";
    this.code = code;
  }
}

type JsonRecord = Record<string, unknown>;
type ParsedCompatibility = Readonly<{
  protocol: ProtocolVersion;
  minimum_reader_minor: number;
  required_features: readonly RenderProtocolFeature[];
}>;

const MAGIC_BYTES = new TextEncoder().encode(RENDER_PROTOCOL_MAGIC);
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const SUPPORTED_FLAGS = RENDER_PROTOCOL_FLAG_KEYFRAME;

const EVENT_KINDS = new Set<EventKindV1>([
  "asteroid_entry", "airburst", "impact", "fireball", "blast_front", "crater", "ejecta",
  "ocean_cavity", "tsunami", "nuclear_cloud", "fallout", "earthquake", "landslide",
]);
const EVENT_PHASES = new Set<EventPhaseV1>(["scheduled", "active", "peak", "decaying", "complete"]);
const FIELD_SEMANTICS = new Set<FieldSemanticV1>([
  "water_surface_eta_m", "water_velocity_east_m_s", "water_velocity_north_m_s", "bathymetry_depth_m",
  "wet_mask", "temperature_k", "overpressure_pa", "fallout_deposition_kg_m2", "fallout_dose_rate_sv_h",
]);
const FIELD_TYPES = new Set<FieldDataTypeV1>(["f32_le", "bitset_u1"]);
const VERTICAL_DATUMS = new Set<VerticalDatumV1>([
  "wgs84_ellipsoid", "navd88_geoid18", "idealized_mean_sea_level",
  "depth_below_idealized_mean_sea_level", "local_enu",
]);
const VERTICAL_AXES = new Set<VerticalAxisV1>(["positive_up", "positive_down"]);

const SEMANTIC_UNITS: Readonly<Record<FieldSemanticV1, string>> = Object.freeze({
  water_surface_eta_m: "metre",
  water_velocity_east_m_s: "metre_per_second",
  water_velocity_north_m_s: "metre_per_second",
  bathymetry_depth_m: "metre",
  wet_mask: "boolean",
  temperature_k: "kelvin",
  overpressure_pa: "pascal",
  fallout_deposition_kg_m2: "kilogram_per_square_metre",
  fallout_dose_rate_sv_h: "sievert_per_hour",
});

function fail(code: string, message: string): never {
  throw new RenderProtocolDecodeError(code, message);
}

function checkedLimits(overrides: Partial<RenderProtocolLimits> | undefined): RenderProtocolLimits {
  const limits = { ...DEFAULT_RENDER_PROTOCOL_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) fail("invalid_limits", `${name} must be a positive safe integer.`);
  }
  return Object.freeze(limits);
}

function packetBytes(input: unknown, maximumPacketBytes: number): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  // Tauri 2.11/WebView2 channel responses currently arrive as JSON byte
  // arrays even when Rust sends an ipc::Response with a raw body. Validate
  // the transport representation before allocating so the protocol's packet
  // cap remains effective at the IPC boundary.
  if (Array.isArray(input)) {
    if (input.length > maximumPacketBytes) {
      fail("packet_too_large", "Packet exceeds its configured byte cap.");
    }
    const bytes = new Uint8Array(input.length);
    for (let index = 0; index < input.length; index += 1) {
      const value = input[index];
      if (!Number.isInteger(value) || value < 0 || value > 255) {
        fail("invalid_input", "Render packet byte arrays may contain only integers from 0 through 255.");
      }
      bytes[index] = value;
    }
    return bytes;
  }
  fail("invalid_input", "Render packet must be an ArrayBuffer, Uint8Array, or byte array.");
}

function assertRecord(value: unknown, path: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("invalid_header", `${path} must be an object.`);
  return value as JsonRecord;
}

function assertSafeObjectGraph(value: unknown, path = "header", depth = 0): void {
  if (depth > 32) fail("invalid_header", `${path} exceeds the maximum nesting depth.`);
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) assertSafeObjectGraph(value[index], `${path}[${index}]`, depth + 1);
    return;
  }
  for (const [key, child] of Object.entries(value as JsonRecord)) {
    if (UNSAFE_KEYS.has(key)) fail("unsafe_header", `${path} contains unsafe key ${JSON.stringify(key)}.`);
    assertSafeObjectGraph(child, `${path}.${key}`, depth + 1);
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function stringValue(record: JsonRecord, key: string, maximum = 4096): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) fail("invalid_header", `${key} is invalid.`);
  return value;
}

function nullableString(record: JsonRecord, key: string): string | null {
  if (record[key] === null) return null;
  return stringValue(record, key);
}

function finiteNumber(record: JsonRecord, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) fail("invalid_header", `${key} must be finite.`);
  return value;
}

function nullableFinite(record: JsonRecord, key: string): number | null {
  if (record[key] === null) return null;
  return finiteNumber(record, key);
}

function safeInteger(record: JsonRecord, key: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail("invalid_header", `${key} must be a safe integer in range.`);
  }
  return value as number;
}

function nullableSafeInteger(record: JsonRecord, key: string): number | null {
  if (record[key] === null) return null;
  return safeInteger(record, key);
}

function booleanValue(record: JsonRecord, key: string): boolean {
  if (typeof record[key] !== "boolean") fail("invalid_header", `${key} must be boolean.`);
  return record[key] as boolean;
}

function hashValue(record: JsonRecord, key: string): string {
  const value = stringValue(record, key, 64);
  if (!HASH_PATTERN.test(value)) fail("invalid_checksum", `${key} must be lowercase SHA-256 hex.`);
  return value;
}

function identity(record: JsonRecord): { scenario_id: string; scenario_sha256: string } {
  return {
    scenario_id: stringValue(record, "scenario_id", 128),
    scenario_sha256: hashValue(record, "scenario_sha256"),
  };
}

function tuple(record: JsonRecord, key: string, length: number): number[] {
  const value = record[key];
  if (!Array.isArray(value) || value.length !== length) fail("invalid_header", `${key} must contain ${length} finite numbers.`);
  return value.map((entry) => {
    if (typeof entry !== "number" || !Number.isFinite(entry)) fail("invalid_header", `${key} contains a non-finite value.`);
    return entry;
  });
}

function compatibility(
  record: JsonRecord,
  prelude: RenderPacketPrelude,
  limits: RenderProtocolLimits,
  options: RenderProtocolDecoderOptions,
): ParsedCompatibility {
  const protocolRecord = assertRecord(record.protocol, "protocol");
  const protocol = Object.freeze({
    major: safeInteger(protocolRecord, "major", 0, 0xffff),
    minor: safeInteger(protocolRecord, "minor", 0, 0xffff),
  });
  if (protocol.major !== prelude.major || protocol.minor !== prelude.minor) {
    fail("version_mismatch", "Prelude and JSON protocol versions disagree.");
  }
  const supportedMinor = options.supported_minor ?? RENDER_PROTOCOL_MINOR;
  const minimumReaderMinor = safeInteger(record, "minimum_reader_minor", 0, 0xffff);
  if (minimumReaderMinor > supportedMinor) fail("unsupported_minor", `Packet requires reader minor ${minimumReaderMinor}.`);
  const rawFeatures = record.required_features;
  if (!Array.isArray(rawFeatures) || rawFeatures.length > limits.max_required_features) {
    fail("invalid_header", "required_features exceeds its cap.");
  }
  const supported = new Set(options.supported_features ?? RENDER_PROTOCOL_FEATURES);
  const unique = new Set<string>();
  for (const feature of rawFeatures) {
    if (typeof feature !== "string" || feature.length === 0 || unique.has(feature)) fail("invalid_header", "required_features is invalid.");
    if (!supported.has(feature)) fail("unsupported_feature", `Required feature ${feature} is unsupported.`);
    unique.add(feature);
  }
  return deepFreeze({ protocol, minimum_reader_minor: minimumReaderMinor, required_features: [...unique] as RenderProtocolFeature[] });
}

function georeference(value: unknown): GeoreferenceV1 {
  const record = assertRecord(value, "georeference");
  if (
    record.contract_version !== "1.0.0" || record.geographic_crs !== "EPSG:4979" || record.ecef_crs !== "EPSG:4978" ||
    record.matrix_order !== "column_major" || record.local_unit !== "metre" || record.unreal_centimetres_per_metre !== 100
  ) fail("unsupported_georeference", "Georeference metadata is unsupported.");
  if (!Array.isArray(record.local_axis_order) || record.local_axis_order.join("|") !== "east_x|north_y|up_z") {
    fail("unsupported_georeference", "Local ENU axis order is unsupported.");
  }
  const originRecord = assertRecord(record.origin, "georeference.origin");
  const origin: GeodeticPositionV1 = deepFreeze({
    lat_deg: finiteNumber(originRecord, "lat_deg"),
    lon_deg: finiteNumber(originRecord, "lon_deg"),
    ellipsoid_height_m: finiteNumber(originRecord, "ellipsoid_height_m"),
  });
  if (Math.abs(origin.lat_deg) > 90 || origin.lon_deg < -180 || origin.lon_deg > 180) fail("invalid_georeference", "Georeference origin is not normalized WGS84.");
  const ecefRecord = assertRecord(record.origin_ecef_m, "georeference.origin_ecef_m");
  const originEcef: EcefPositionV1 = deepFreeze({
    x_m: finiteNumber(ecefRecord, "x_m"),
    y_m: finiteNumber(ecefRecord, "y_m"),
    z_m: finiteNumber(ecefRecord, "z_m"),
  });
  const localToEcef = tuple(record, "local_enu_to_ecef", 16);
  const ecefToLocal = tuple(record, "ecef_to_local_enu", 16);
  const expected = geodeticToEcef({ latDeg: origin.lat_deg, lonDeg: origin.lon_deg, ellipsoidHeightM: origin.ellipsoid_height_m });
  if (Math.hypot(expected.xM - originEcef.x_m, expected.yM - originEcef.y_m, expected.zM - originEcef.z_m) > 1) {
    fail("invalid_georeference", "Origin ECEF differs from WGS84 by more than one metre.");
  }
  if (Math.hypot(localToEcef[12] - expected.xM, localToEcef[13] - expected.yM, localToEcef[14] - expected.zM) > 1) {
    fail("invalid_georeference", "Local ENU matrix origin differs by more than one metre.");
  }
  return deepFreeze({
    contract_version: "1.0.0", geographic_crs: "EPSG:4979", ecef_crs: "EPSG:4978", origin,
    origin_ecef_m: originEcef, local_enu_to_ecef: localToEcef, ecef_to_local_enu: ecefToLocal,
    matrix_order: "column_major", local_axis_order: ["east_x", "north_y", "up_z"], local_unit: "metre",
    unreal_centimetres_per_metre: 100,
  });
}

function transforms(value: unknown, limits: RenderProtocolLimits): TransformStateV1[] {
  if (!Array.isArray(value) || value.length > limits.max_transforms) fail("invalid_transform", "transforms exceeds its cap.");
  const ids = new Set<string>();
  return value.map((entry, index) => {
    const record = assertRecord(entry, `transforms[${index}]`);
    const id = stringValue(record, "id");
    if (ids.has(id)) fail("invalid_transform", "Transform IDs must be unique.");
    ids.add(id);
    const translation = tuple(record, "translation_enu_m", 3) as [number, number, number];
    const rotation = tuple(record, "rotation_xyzw", 4) as [number, number, number, number];
    const scale = tuple(record, "scale", 3) as [number, number, number];
    if (scale.some((component) => component <= 0)) fail("invalid_transform", "Transform scale must be positive.");
    const normSq = rotation.reduce((sum, component) => sum + component * component, 0);
    if (Math.abs(normSq - 1) > 1e-6) fail("invalid_transform", "Transform quaternion must be normalized.");
    return deepFreeze({ id, parent_frame: stringValue(record, "parent_frame"), translation_enu_m: translation, rotation_xyzw: rotation, scale });
  });
}

function events(
  value: unknown,
  transformsValue: readonly TransformStateV1[],
  fieldIds: ReadonlySet<string> | null,
  limits: RenderProtocolLimits,
): RenderEventV1[] {
  if (!Array.isArray(value) || value.length > limits.max_events) fail("invalid_event", "events exceeds its cap.");
  const transformIds = new Set(transformsValue.map((transform) => transform.id));
  const ids = new Set<string>();
  return value.map((entry, index) => {
    const record = assertRecord(entry, `events[${index}]`);
    const id = stringValue(record, "id");
    if (ids.has(id)) fail("invalid_event", "Event IDs must be unique.");
    ids.add(id);
    const kind = record.kind;
    const phase = record.phase;
    if (typeof kind !== "string" || !EVENT_KINDS.has(kind as EventKindV1)) fail("unknown_event_kind", "Event kind is unsupported.");
    if (typeof phase !== "string" || !EVENT_PHASES.has(phase as EventPhaseV1)) fail("unknown_event_phase", "Event phase is unsupported.");
    const startTick = safeInteger(record, "start_tick");
    const peakTick = nullableSafeInteger(record, "peak_tick");
    const endTick = nullableSafeInteger(record, "end_tick");
    if ((peakTick !== null && peakTick < startTick) || (endTick !== null && endTick < startTick) || (peakTick !== null && endTick !== null && peakTick > endTick)) {
      fail("invalid_event", "Event tick interval is invalid.");
    }
    const transformId = nullableString(record, "transform_id");
    if (transformId !== null && !transformIds.has(transformId)) fail("invalid_event", "Event references an unknown transform.");
    if (!Array.isArray(record.quantities)) fail("invalid_event", "Event quantities must be an array.");
    const quantities = record.quantities.map((quantity, quantityIndex): ScalarQuantityV1 => {
      const quantityRecord = assertRecord(quantity, `events[${index}].quantities[${quantityIndex}]`);
      return deepFreeze({ semantic: stringValue(quantityRecord, "semantic"), value: finiteNumber(quantityRecord, "value"), unit: stringValue(quantityRecord, "unit") });
    });
    if (!Array.isArray(record.field_refs)) fail("invalid_event", "Event field_refs must be an array.");
    const fieldRefs = record.field_refs.map((field) => {
      if (typeof field !== "string" || field.length === 0 || (fieldIds && !fieldIds.has(field))) fail("invalid_event", "Event references an unknown field.");
      return field;
    });
    return deepFreeze({ id, kind: kind as EventKindV1, phase: phase as EventPhaseV1, start_tick: startTick, peak_tick: peakTick, end_tick: endTick, transform_id: transformId, quantities, field_refs: fieldRefs });
  });
}

function grid(value: unknown, limits: RenderProtocolLimits): { grid: GridGeometryV1; cells: number } {
  const record = assertRecord(value, "field.grid");
  const nx = safeInteger(record, "nx", 1, 0xffff_ffff);
  const ny = safeInteger(record, "ny", 1, 0xffff_ffff);
  const cells = nx * ny;
  if (!Number.isSafeInteger(cells) || cells > limits.max_cells) fail("field_too_large", "Field grid exceeds the cell cap.");
  const west = finiteNumber(record, "west_cell_center_lon_deg");
  const south = finiteNumber(record, "south_cell_center_lat_deg");
  const dlon = finiteNumber(record, "dlon_deg");
  const dlat = finiteNumber(record, "dlat_deg");
  if (
    west < -180 || west > 180 || south < -90 || south > 90 || dlon <= 0 || dlat <= 0 ||
    record.row_order !== "south_to_north_west_to_east" || record.cell_registration !== "cell_center" ||
    record.longitude_wrap !== "normalized_minus180_180" || south + dlat * (ny - 1) > 90 + 1e-9
  ) fail("invalid_grid", "Field grid metadata is invalid or unsupported.");
  const tiles = geographicFieldTiles(record.tiles, nx, ny, west, south, dlon, dlat);
  return {
    cells,
    grid: deepFreeze({ nx, ny, west_cell_center_lon_deg: west, south_cell_center_lat_deg: south, dlon_deg: dlon, dlat_deg: dlat, row_order: "south_to_north_west_to_east", cell_registration: "cell_center", longitude_wrap: "normalized_minus180_180", tiles }),
  };
}

function geographicFieldTiles(
  value: unknown,
  nx: number,
  ny: number,
  westCenter: number,
  southCenter: number,
  dlon: number,
  dlat: number,
): GeographicFieldTileV1[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) {
    fail("invalid_grid", "Field grid tiles must be a bounded non-empty array.");
  }
  const southEdge = southCenter - 0.5 * dlat;
  const northEdge = southCenter + (ny - 0.5) * dlat;
  const westEdge = westCenter - 0.5 * dlon;
  let expectedOffset = 0;
  return value.map((entry, index) => {
    const record = assertRecord(entry, `field.grid.tiles[${index}]`);
    const columnOffset = safeInteger(record, "column_offset", 0, nx - 1);
    const columnCount = safeInteger(record, "column_count", 1, nx);
    if (columnOffset !== expectedOffset || columnOffset + columnCount > nx) {
      fail("invalid_grid", "Field grid tiles must cover source columns once in order.");
    }
    if (!Array.isArray(record.bbox) || record.bbox.length !== 4) {
      fail("invalid_grid", "Field grid tile bbox must contain four edges.");
    }
    const bbox = record.bbox.map((edge) => {
      if (typeof edge !== "number" || !Number.isFinite(edge)) {
        fail("invalid_grid", "Field grid tile bbox must be finite.");
      }
      return edge;
    }) as [number, number, number, number];
    const expectedWest = normalizeLongitudeEdge(westEdge + columnOffset * dlon, false);
    const expectedEast = normalizeLongitudeEdge(westEdge + (columnOffset + columnCount) * dlon, true);
    const tolerance = 1e-9;
    if (
      bbox[0] < -180 || bbox[2] > 180 || bbox[1] < -90 || bbox[3] > 90 ||
      bbox[2] <= bbox[0] || bbox[3] <= bbox[1] ||
      Math.abs(bbox[0] - expectedWest) > tolerance || Math.abs(bbox[2] - expectedEast) > tolerance ||
      Math.abs(bbox[1] - southEdge) > tolerance || Math.abs(bbox[3] - northEdge) > tolerance
    ) fail("invalid_grid", "Field grid tile bounds do not match their source columns.");
    expectedOffset += columnCount;
    if (index === value.length - 1 && expectedOffset !== nx) {
      fail("invalid_grid", "Field grid tiles do not cover every source column.");
    }
    return deepFreeze({ column_offset: columnOffset, column_count: columnCount, bbox });
  });
}

function normalizeLongitudeEdge(longitude: number, eastEdge: boolean): number {
  const wrapped = ((longitude + 180) % 360 + 360) % 360 - 180;
  return eastEdge && Math.abs(wrapped + 180) <= 1e-9 ? 180 : wrapped;
}

function nullableEnum<T extends string>(record: JsonRecord, key: string, allowed: ReadonlySet<T>): T | null {
  if (record[key] === null) return null;
  const value = record[key];
  if (typeof value !== "string" || !allowed.has(value as T)) fail("invalid_field", `${key} is unsupported.`);
  return value as T;
}

function fieldDescriptors(value: unknown, payloadLength: number, limits: RenderProtocolLimits): FieldDescriptorV1[] {
  if (!Array.isArray(value) || value.length > limits.max_fields) fail("invalid_field", "fields exceeds its cap.");
  const ids = new Set<string>();
  const ranges: Array<{ start: number; end: number }> = [];
  const descriptors = value.map((entry, index) => {
    const record = assertRecord(entry, `fields[${index}]`);
    const id = stringValue(record, "id");
    if (ids.has(id)) fail("invalid_field", "Field IDs must be unique.");
    ids.add(id);
    if (typeof record.semantic !== "string" || !FIELD_SEMANTICS.has(record.semantic as FieldSemanticV1)) fail("unknown_field_semantic", "Field semantic is unsupported.");
    if (typeof record.data_type !== "string" || !FIELD_TYPES.has(record.data_type as FieldDataTypeV1)) fail("unknown_field_dtype", "Field data_type is unsupported.");
    if (record.codec !== "none") fail("unsupported_codec", "V1 supports only codec none.");
    const semantic = record.semantic as FieldSemanticV1;
    const dataType = record.data_type as FieldDataTypeV1;
    const unit = stringValue(record, "unit");
    if (unit !== SEMANTIC_UNITS[semantic]) fail("invalid_field", `Field ${semantic} has the wrong canonical unit.`);
    if ((semantic === "wet_mask") !== (dataType === "bitset_u1")) fail("invalid_field", "bitset_u1 is reserved for wet_mask and wet_mask requires it.");
    const { grid: geometry, cells } = grid(record.grid, limits);
    const elementCount = safeInteger(record, "element_count", 1, 0xffff_ffff);
    if (elementCount !== cells) fail("invalid_shape", "Field element_count does not match grid dimensions.");
    const byteOffset = safeInteger(record, "byte_offset", 0, 0xffff_ffff);
    const byteLength = safeInteger(record, "byte_length", 0, 0xffff_ffff);
    const expectedBytes = dataType === "f32_le" ? cells * 4 : Math.ceil(cells / 8);
    if (byteLength !== expectedBytes) fail("invalid_field_length", "Field byte_length does not match shape and data_type.");
    const end = byteOffset + byteLength;
    if (!Number.isSafeInteger(end) || end > payloadLength) fail("field_out_of_bounds", "Field range exceeds payload bounds.");
    ranges.push({ start: byteOffset, end });
    const minimum = nullableFinite(record, "minimum");
    const maximum = nullableFinite(record, "maximum");
    if (minimum !== null && maximum !== null && minimum > maximum) fail("invalid_field", "Field minimum exceeds maximum.");
    const conversionError = nullableFinite(record, "maximum_abs_conversion_error");
    if (conversionError !== null && conversionError < 0) fail("invalid_field", "Field conversion error must be nonnegative.");
    return deepFreeze({
      id, semantic, data_type: dataType, codec: "none" as const, unit,
      vertical_datum: nullableEnum(record, "vertical_datum", VERTICAL_DATUMS),
      vertical_axis: nullableEnum(record, "vertical_axis", VERTICAL_AXES),
      grid: geometry, byte_offset: byteOffset, byte_length: byteLength, element_count: elementCount,
      minimum, maximum, maximum_abs_conversion_error: conversionError, sha256: hashValue(record, "sha256"),
    });
  });
  ranges.sort((left, right) => left.start - right.start);
  let previousEnd = 0;
  for (const range of ranges) {
    if (range.start !== previousEnd) fail("noncontiguous_fields", "Field ranges must be contiguous and non-overlapping.");
    previousEnd = range.end;
  }
  if (previousEnd !== payloadLength) fail("unreferenced_payload", "Payload contains unreferenced bytes.");
  return descriptors;
}

function provenance(value: unknown): PhysicsProvenanceV1 {
  const record = assertRecord(value, "provenance");
  if (record.authority !== "rust" || record.geodesy_contract_version !== "1.0.0") fail("invalid_provenance", "Scenario physics authority/geodesy provenance is unsupported.");
  if (!Array.isArray(record.model_versions)) fail("invalid_provenance", "model_versions must be an array.");
  const models = record.model_versions.map((entry) => {
    const model = assertRecord(entry, "model_versions[]");
    return deepFreeze({ component: stringValue(model, "component"), version: stringValue(model, "version") });
  });
  return deepFreeze({
    authority: "rust", model_versions: models, geodesy_contract_version: "1.0.0",
    surface_mask_version: nullableString(record, "surface_mask_version"),
    bathymetry_asset_id: nullableString(record, "bathymetry_asset_id"),
    solver_backend: stringValue(record, "solver_backend"),
  });
}

function scenarioHeader(record: JsonRecord, prelude: RenderPacketPrelude, limits: RenderProtocolLimits, options: RenderProtocolDecoderOptions): ScenarioHeaderV1 {
  const compat = compatibility(record, prelude, limits, options);
  const ids = identity(record);
  const transformStates = transforms(record.transforms, limits);
  const tickDuration = finiteNumber(record, "tick_duration_s");
  if (tickDuration <= 0) fail("invalid_time", "tick_duration_s must be positive.");
  return deepFreeze({
    packet_kind: "scenario", ...compat, ...ids, georeference: georeference(record.georeference), tick_duration_s: tickDuration,
    transforms: transformStates, events: events(record.events, transformStates, null, limits), provenance: provenance(record.provenance),
    payload_sha256: hashValue(record, "payload_sha256"),
  });
}

function frameHeader(record: JsonRecord, prelude: RenderPacketPrelude, limits: RenderProtocolLimits, options: RenderProtocolDecoderOptions): FrameHeaderV1 {
  const compat = compatibility(record, prelude, limits, options);
  const ids = identity(record);
  const solverTick = safeInteger(record, "solver_tick");
  const simulationTime = finiteNumber(record, "simulation_time_s");
  const tickDuration = finiteNumber(record, "tick_duration_s");
  if (simulationTime < 0 || tickDuration <= 0) fail("invalid_time", "Frame time must be nonnegative with a positive tick duration.");
  if (Math.abs(simulationTime - solverTick * tickDuration) > tickDuration + 1e-12) fail("invalid_time", "Simulation time differs from authoritative tick by more than one tick.");
  const keyframe = booleanValue(record, "keyframe");
  const baseSequence = nullableSafeInteger(record, "base_sequence");
  if (keyframe !== (baseSequence === null) || (baseSequence !== null && BigInt(baseSequence) >= prelude.sequence)) {
    fail("invalid_keyframe", "keyframe/base_sequence relationship is invalid.");
  }
  const descriptors = fieldDescriptors(record.fields, prelude.payload_len, limits);
  const transformStates = transforms(record.transforms, limits);
  return deepFreeze({
    packet_kind: "frame", ...compat, ...ids, solver_tick: solverTick, simulation_time_s: simulationTime,
    tick_duration_s: tickDuration, keyframe, base_sequence: baseSequence, transforms: transformStates,
    events: events(record.events, transformStates, new Set(descriptors.map((field) => field.id)), limits),
    fields: descriptors, payload_sha256: hashValue(record, "payload_sha256"),
  });
}

function endHeader(record: JsonRecord, prelude: RenderPacketPrelude, limits: RenderProtocolLimits, options: RenderProtocolDecoderOptions): EndHeaderV1 {
  const compat = compatibility(record, prelude, limits, options);
  return deepFreeze({
    packet_kind: "end", ...compat, ...identity(record), final_tick: safeInteger(record, "final_tick"),
    frame_count: safeInteger(record, "frame_count"), payload_sha256: hashValue(record, "payload_sha256"),
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) fail("crypto_unavailable", "Web Crypto SHA-256 is unavailable.");
  const copy = Uint8Array.from(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function f32View(payload: Uint8Array, descriptor: FieldDescriptorV1): F32LeFieldView {
  const data = new DataView(payload.buffer, payload.byteOffset + descriptor.byte_offset, descriptor.byte_length);
  return Object.freeze({
    data_type: "f32_le" as const,
    length: descriptor.element_count,
    at(index: number): number {
      if (!Number.isSafeInteger(index) || index < 0 || index >= descriptor.element_count) throw new RangeError("Field index is out of bounds.");
      return data.getFloat32(index * 4, true);
    },
    toFloat32Array(): Float32Array {
      const values = new Float32Array(descriptor.element_count);
      for (let index = 0; index < values.length; index += 1) values[index] = data.getFloat32(index * 4, true);
      return values;
    },
  });
}

function bitsetView(payload: Uint8Array, descriptor: FieldDescriptorV1): BitsetU1FieldView {
  const packed = payload.subarray(descriptor.byte_offset, descriptor.byte_offset + descriptor.byte_length);
  return Object.freeze({
    data_type: "bitset_u1" as const,
    length: descriptor.element_count,
    at(index: number): 0 | 1 {
      if (!Number.isSafeInteger(index) || index < 0 || index >= descriptor.element_count) throw new RangeError("Field index is out of bounds.");
      return ((packed[index >> 3] >> (index & 7)) & 1) as 0 | 1;
    },
    toUint8Array(): Uint8Array {
      const values = new Uint8Array(descriptor.element_count);
      for (let index = 0; index < values.length; index += 1) values[index] = (packed[index >> 3] >> (index & 7)) & 1;
      return values;
    },
    toPackedBytes(): Uint8Array {
      return Uint8Array.from(packed);
    },
  });
}

async function validatedFieldViews(payload: Uint8Array, descriptors: readonly FieldDescriptorV1[]): Promise<Readonly<Record<string, RenderFieldView>>> {
  const entries = await Promise.all(descriptors.map(async (descriptor): Promise<readonly [string, RenderFieldView]> => {
    const bytes = payload.subarray(descriptor.byte_offset, descriptor.byte_offset + descriptor.byte_length);
    if ((await sha256Hex(bytes)) !== descriptor.sha256) fail("field_checksum_mismatch", `Field ${descriptor.id} checksum does not match.`);
    if (descriptor.data_type === "f32_le") {
      const view = f32View(payload, descriptor);
      for (let index = 0; index < view.length; index += 1) {
        if (!Number.isFinite(view.at(index))) fail("nonfinite_field", `Field ${descriptor.id} contains non-finite f32.`);
      }
      return [descriptor.id, view] as const;
    }
    const view = bitsetView(payload, descriptor);
    const usedBits = descriptor.element_count % 8;
    const packed = view.toPackedBytes();
    if (usedBits !== 0 && (packed.at(-1) as number) & (~((1 << usedBits) - 1) & 0xff)) {
      fail("invalid_bitset", "Wet mask has non-zero unused high bits.");
    }
    return [descriptor.id, view] as const;
  }));
  return Object.freeze(Object.fromEntries(entries) as Record<string, RenderFieldView>);
}

function parsePrelude(bytes: Uint8Array, limits: RenderProtocolLimits): RenderPacketPrelude {
  if (bytes.byteLength < RENDER_PROTOCOL_PRELUDE_BYTES) fail("truncated_prelude", "Packet is shorter than the 32-byte prelude.");
  if (bytes.byteLength > limits.max_packet_bytes) fail("packet_too_large", "Packet exceeds its byte cap.");
  for (let index = 0; index < MAGIC_BYTES.length; index += 1) if (bytes[index] !== MAGIC_BYTES[index]) fail("bad_magic", "Packet magic is invalid.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, RENDER_PROTOCOL_PRELUDE_BYTES);
  const major = view.getUint16(8, true);
  const minor = view.getUint16(10, true);
  if (major !== RENDER_PROTOCOL_MAJOR) fail("unsupported_major", `Protocol major ${major} is unsupported.`);
  const kind = view.getUint8(12);
  if (kind !== 1 && kind !== 2 && kind !== 3) fail("unknown_packet_kind", `Packet kind ${kind} is unsupported.`);
  const flags = view.getUint8(13);
  if ((flags & ~SUPPORTED_FLAGS) !== 0) fail("unsupported_flags", "Packet uses unknown required flag bits.");
  if (view.getUint16(14, true) !== 0) fail("reserved_nonzero", "Reserved prelude bits must be zero.");
  const headerLen = view.getUint32(16, true);
  const payloadLen = view.getUint32(20, true);
  if (headerLen === 0 || headerLen > limits.max_header_bytes) fail("header_too_large", "Header length is invalid or exceeds its cap.");
  if (payloadLen > limits.max_payload_bytes) fail("payload_too_large", "Payload exceeds its cap.");
  if (RENDER_PROTOCOL_PRELUDE_BYTES + headerLen + payloadLen !== bytes.byteLength) fail("length_mismatch", "Prelude lengths do not match packet length.");
  return Object.freeze({ major, minor, kind: kind as RenderProtocolPacketKind, flags, header_len: headerLen, payload_len: payloadLen, sequence: view.getBigUint64(24, true) });
}

function parseHeaderBytes(bytes: Uint8Array): JsonRecord {
  let json: string;
  try { json = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { fail("invalid_utf8", "Header is not valid UTF-8."); }
  let value: unknown;
  try { value = JSON.parse(json); } catch { fail("invalid_json", "Header is not valid JSON."); }
  assertSafeObjectGraph(value);
  return assertRecord(value, "header");
}

export async function decodeRenderPacket(input: unknown, options: RenderProtocolDecoderOptions = {}): Promise<DecodedRenderPacket> {
  const limits = checkedLimits(options.limits);
  const bytes = packetBytes(input, limits.max_packet_bytes);
  const prelude = parsePrelude(bytes, limits);
  const headerEnd = RENDER_PROTOCOL_PRELUDE_BYTES + prelude.header_len;
  const record = parseHeaderBytes(bytes.subarray(RENDER_PROTOCOL_PRELUDE_BYTES, headerEnd));
  const payloadSource = bytes.subarray(headerEnd);
  const packetKind = record.packet_kind;
  const expectedKind = packetKind === "scenario" ? 1 : packetKind === "frame" ? 2 : packetKind === "end" ? 3 : 0;
  if (expectedKind === 0) fail("unknown_packet_kind", "JSON packet_kind is unsupported.");
  if (prelude.kind !== expectedKind) fail("packet_kind_mismatch", "Prelude kind disagrees with JSON packet_kind.");
  const header = packetKind === "scenario"
    ? scenarioHeader(record, prelude, limits, options)
    : packetKind === "frame"
      ? frameHeader(record, prelude, limits, options)
      : endHeader(record, prelude, limits, options);
  const keyframeFlag = (prelude.flags & RENDER_PROTOCOL_FLAG_KEYFRAME) !== 0;
  if (keyframeFlag !== (header.packet_kind === "frame" && header.keyframe)) fail("keyframe_flag_mismatch", "Prelude keyframe flag disagrees with JSON header.");
  if ((await sha256Hex(payloadSource)) !== header.payload_sha256) fail("payload_checksum_mismatch", "Payload checksum does not match.");

  if (header.packet_kind === "scenario") {
    if (prelude.sequence !== 0n) fail("scenario_sequence", "Scenario packet sequence must be zero.");
    if (prelude.payload_len !== 0 || header.payload_sha256 !== EMPTY_SHA256) fail("unexpected_payload", "V1 scenario payload must be empty.");
    return Object.freeze({ kind: "scenario", prelude, header } satisfies DecodedScenarioPacket);
  }
  if (header.packet_kind === "end") {
    if (prelude.payload_len !== 0 || header.payload_sha256 !== EMPTY_SHA256) fail("unexpected_payload", "V1 end payload must be empty.");
    if (BigInt(header.frame_count) > prelude.sequence) fail("invalid_end", "End frame_count exceeds packet sequence.");
    return Object.freeze({ kind: "end", prelude, header } satisfies DecodedEndPacket);
  }
  const payload = Uint8Array.from(payloadSource);
  return Object.freeze({ kind: "frame", prelude, header, fields: await validatedFieldViews(payload, header.fields) } satisfies DecodedFramePacket);
}
