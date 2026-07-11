import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = path.join(ROOT, "tests", "fixtures", "render-protocol", "v1");
const FIXTURE_PATH = path.join(FIXTURE_DIR, "recording.catframe");
const EXPECTED_PATH = path.join(FIXTURE_DIR, "recording.expected.json");
const GEODESY_PATH = path.join(ROOT, "src", "data", "geodesy-contract.json");
const SCHEMA_PATH = path.join(ROOT, "assets", "render", "render-protocol-v1.schema.json");

const MAGIC = Buffer.from("CATRFRM\0", "ascii");
const PRELUDE_BYTES = 32;
const LENGTH_PREFIX_BYTES = 4;
const PROTOCOL_MAJOR = 1;
const PROTOCOL_MINOR = 0;
const FLAG_KEYFRAME = 0x01;
const SUPPORTED_FLAGS = FLAG_KEYFRAME;
const KIND = Object.freeze({ scenario: 1, frame: 2, end: 3 });
const KIND_NAME = Object.freeze({ 1: "scenario", 2: "frame", 3: "end" });
const MAX_HEADER_BYTES = 1_048_576;
const MAX_PAYLOAD_BYTES = 256 * 1024 * 1024;
const MAX_RECORDING_BYTES = 512 * 1024 * 1024;
const MAX_PACKETS = 10_000;
const MAX_FIELDS = 32;
const MAX_CELLS = 4_000_000;
const MAX_EVENTS = 4096;
const MAX_TRANSFORMS = 4096;
const POSITION_TOLERANCE_M = 1;
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const GOLDEN_SCENARIO_BYTES = Buffer.from(
  '{"id":"golden-4x3","source":"deterministic_fixture","version":1}',
  "utf8",
);
const REQUIRED_FEATURES = Object.freeze([
  "json_header",
  "raw_f32_fields",
  "bitset_wet_mask",
  "sha256",
  "local_enu",
  "authoritative_tick",
  "codec_none",
]);
const EVENT_KINDS = new Set([
  "asteroid_entry", "airburst", "impact", "fireball", "blast_front", "crater", "ejecta",
  "ocean_cavity", "tsunami", "nuclear_cloud", "fallout", "earthquake", "landslide",
]);
const EVENT_PHASES = new Set(["scheduled", "active", "peak", "decaying", "complete"]);
const FIELD_SEMANTICS = new Set([
  "water_surface_eta_m", "water_velocity_east_m_s", "water_velocity_north_m_s",
  "bathymetry_depth_m", "wet_mask", "temperature_k", "overpressure_pa",
  "fallout_deposition_kg_m2", "fallout_dose_rate_sv_h",
]);
const VERTICAL_DATUMS = new Set([
  "wgs84_ellipsoid", "navd88_geoid18", "idealized_mean_sea_level",
  "depth_below_idealized_mean_sea_level", "local_enu",
]);
const VERTICAL_AXES = new Set(["positive_up", "positive_down"]);

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function finite(value, label) {
  assert(typeof value === "number" && Number.isFinite(value), `${label} must be finite`);
  return value;
}

function integer(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  assert(
    Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    `${label} must be an integer in [${minimum}, ${maximum}]`,
  );
  return value;
}

function string(value, label, { allowEmpty = false, maximumBytes } = {}) {
  assert(typeof value === "string" && (allowEmpty || value.length > 0), `${label} must be a string`);
  if (maximumBytes !== undefined) {
    assert(Buffer.byteLength(value, "utf8") <= maximumBytes, `${label} exceeds ${maximumBytes} bytes`);
  }
  return value;
}

function nullable(value, validate) {
  if (value !== null) validate(value);
}

function exactKeys(value, required, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...required].sort();
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} keys differ: ${actual.join(", ")}`);
}

function exactArray(value, expected, label) {
  assert(Array.isArray(value), `${label} must be an array`);
  assert(JSON.stringify(value) === JSON.stringify(expected), `${label} differs from canonical V1`);
}

function fixedNumericArray(value, length, label, validate = finite) {
  assert(Array.isArray(value) && value.length === length, `${label} must contain ${length} values`);
  value.forEach((entry, index) => validate(entry, `${label}[${index}]`));
  return value;
}

function decodePacket(packetBytes, recordingOffset) {
  assert(packetBytes.length >= PRELUDE_BYTES, `packet at byte ${recordingOffset} is shorter than the prelude`);
  assert(packetBytes.subarray(0, 8).equals(MAGIC), `bad packet magic at byte ${recordingOffset}`);
  const major = packetBytes.readUInt16LE(8);
  const minor = packetBytes.readUInt16LE(10);
  const kind = packetBytes.readUInt8(12);
  const flags = packetBytes.readUInt8(13);
  const reserved = packetBytes.readUInt16LE(14);
  const headerLength = packetBytes.readUInt32LE(16);
  const payloadLength = packetBytes.readUInt32LE(20);
  const sequenceBig = packetBytes.readBigUInt64LE(24);
  assert(major === PROTOCOL_MAJOR, `unsupported breaking protocol major ${major}`);
  assert(minor === PROTOCOL_MINOR, `unsupported protocol minor ${minor}`);
  assert(KIND_NAME[kind], `unknown packet kind ${kind}`);
  assert((flags & ~SUPPORTED_FLAGS) === 0, `unknown packet flag bits 0x${flags.toString(16)}`);
  assert(reserved === 0, "reserved packet prelude bits must be zero");
  assert(headerLength > 0 && headerLength <= MAX_HEADER_BYTES, `invalid header length ${headerLength}`);
  assert(payloadLength <= MAX_PAYLOAD_BYTES, `invalid payload length ${payloadLength}`);
  assert(sequenceBig <= BigInt(Number.MAX_SAFE_INTEGER), "packet sequence exceeds JS safe integer range");
  assert(
    packetBytes.length === PRELUDE_BYTES + headerLength + payloadLength,
    `packet ${sequenceBig} length disagrees with its prelude`,
  );
  const headerEnd = PRELUDE_BYTES + headerLength;
  let header;
  try {
    header = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(packetBytes.subarray(PRELUDE_BYTES, headerEnd)));
  } catch (error) {
    fail(`packet ${sequenceBig} header is not strict UTF-8 JSON: ${error.message}`);
  }
  const packet = {
    recordingOffset,
    packetLength: packetBytes.length,
    major,
    minor,
    kind,
    flags,
    sequence: Number(sequenceBig),
    headerLength,
    payloadLength,
    header,
    payload: packetBytes.subarray(headerEnd),
  };
  assert(KIND[header.packet_kind] === kind, `packet ${packet.sequence} prelude/header kind mismatch`);
  assert(header.protocol?.major === major && header.protocol?.minor === minor, `packet ${packet.sequence} version mismatch`);
  assert(
    Boolean(flags & FLAG_KEYFRAME) === (header.packet_kind === "frame" && header.keyframe === true),
    `packet ${packet.sequence} keyframe flag mismatch`,
  );
  return packet;
}

function decodeRecording(bytes) {
  assert(Buffer.isBuffer(bytes), "recording must be a Buffer");
  assert(bytes.length <= MAX_RECORDING_BYTES, `recording exceeds ${MAX_RECORDING_BYTES} byte cap`);
  const packets = [];
  let offset = 0;
  while (offset < bytes.length) {
    assert(packets.length < MAX_PACKETS, `recording exceeds ${MAX_PACKETS} packet cap`);
    assert(bytes.length - offset >= LENGTH_PREFIX_BYTES, `truncated packet length prefix at byte ${offset}`);
    const packetLength = bytes.readUInt32LE(offset);
    assert(packetLength >= PRELUDE_BYTES, `invalid packet length ${packetLength} at byte ${offset}`);
    assert(
      packetLength <= PRELUDE_BYTES + MAX_HEADER_BYTES + MAX_PAYLOAD_BYTES,
      `packet length ${packetLength} exceeds V1 caps`,
    );
    const rawStart = offset + LENGTH_PREFIX_BYTES;
    const rawEnd = rawStart + packetLength;
    assert(rawEnd <= bytes.length, `length-prefixed packet at byte ${offset} overruns recording`);
    packets.push(decodePacket(bytes.subarray(rawStart, rawEnd), rawStart));
    offset = rawEnd;
  }
  assert(offset === bytes.length, "recording has trailing bytes");
  return packets;
}

function validateCommon(packet, label) {
  const header = packet.header;
  exactKeys(header.protocol, ["major", "minor"], `${label}.protocol`);
  assert(header.protocol.major === PROTOCOL_MAJOR && header.protocol.minor === PROTOCOL_MINOR, `${label} protocol mismatch`);
  integer(header.minimum_reader_minor, `${label}.minimum_reader_minor`, 0, 65_535);
  assert(header.minimum_reader_minor <= PROTOCOL_MINOR, `${label} requires an unsupported reader minor`);
  exactArray(header.required_features, REQUIRED_FEATURES, `${label}.required_features`);
  string(header.scenario_id, `${label}.scenario_id`, { maximumBytes: 128 });
  assert(isSha256(header.scenario_sha256), `${label}.scenario_sha256 must be lowercase SHA-256`);
  assert(isSha256(header.payload_sha256), `${label}.payload_sha256 must be lowercase SHA-256`);
  assert(sha256(packet.payload) === header.payload_sha256, `${label} payload SHA-256 mismatch`);
}

function geodeticToEcef(position) {
  const a = 6_378_137;
  const flattening = 1 / 298.257_223_563;
  const eccentricitySquared = flattening * (2 - flattening);
  const lat = finite(position.lat_deg, "latitude") * Math.PI / 180;
  const lon = finite(position.lon_deg, "longitude") * Math.PI / 180;
  const height = finite(position.ellipsoid_height_m, "ellipsoid height");
  assert(position.lat_deg >= -90 && position.lat_deg <= 90, "latitude is outside WGS84 bounds");
  assert(position.lon_deg >= -180 && position.lon_deg <= 180, "longitude is outside normalized WGS84 bounds");
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const n = a / Math.sqrt(1 - eccentricitySquared * sinLat * sinLat);
  return [
    (n + height) * cosLat * Math.cos(lon),
    (n + height) * cosLat * Math.sin(lon),
    (n * (1 - eccentricitySquared) + height) * sinLat,
  ];
}

function distance3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function transformPointColumnMajor(matrix, point) {
  return [
    matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
    matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
    matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
  ];
}

function expectedEnuMatrices(origin, ecef) {
  const lat = origin.lat_deg * Math.PI / 180;
  const lon = origin.lon_deg * Math.PI / 180;
  const east = [-Math.sin(lon), Math.cos(lon), 0];
  const north = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  const up = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const dot = (left, right) => left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
  return {
    forward: [
      east[0], east[1], east[2], 0,
      north[0], north[1], north[2], 0,
      up[0], up[1], up[2], 0,
      ecef[0], ecef[1], ecef[2], 1,
    ],
    inverse: [
      east[0], north[0], up[0], 0,
      east[1], north[1], up[1], 0,
      east[2], north[2], up[2], 0,
      -dot(east, ecef), -dot(north, ecef), -dot(up, ecef), 1,
    ],
  };
}

function validateGeoreference(value, geodesy) {
  exactKeys(value, [
    "contract_version", "geographic_crs", "ecef_crs", "origin", "origin_ecef_m",
    "local_enu_to_ecef", "ecef_to_local_enu", "matrix_order", "local_axis_order",
    "local_unit", "unreal_centimetres_per_metre",
  ], "scenario.georeference");
  assert(value.contract_version === geodesy.contract_version, "georeference contract version mismatch");
  assert(value.geographic_crs === "EPSG:4979" && value.ecef_crs === "EPSG:4978", "georeference CRS mismatch");
  exactKeys(value.origin, ["lat_deg", "lon_deg", "ellipsoid_height_m"], "georeference.origin");
  exactKeys(value.origin_ecef_m, ["x_m", "y_m", "z_m"], "georeference.origin_ecef_m");
  assert(value.matrix_order === "column_major", "georeference matrix order mismatch");
  exactArray(value.local_axis_order, ["east_x", "north_y", "up_z"], "georeference.local_axis_order");
  assert(value.local_unit === "metre" && value.unreal_centimetres_per_metre === 100, "georeference local-unit contract mismatch");
  fixedNumericArray(value.local_enu_to_ecef, 16, "georeference.local_enu_to_ecef");
  fixedNumericArray(value.ecef_to_local_enu, 16, "georeference.ecef_to_local_enu");
  const independent = geodeticToEcef(value.origin);
  const transmitted = [value.origin_ecef_m.x_m, value.origin_ecef_m.y_m, value.origin_ecef_m.z_m];
  transmitted.forEach((entry, index) => finite(entry, `georeference.origin_ecef_m[${index}]`));
  const ecefError = distance3(independent, transmitted);
  assert(ecefError <= POSITION_TOLERANCE_M, `georeference origin ECEF error ${ecefError} m exceeds 1 m`);
  const matrixOriginError = distance3(transformPointColumnMajor(value.local_enu_to_ecef, [0, 0, 0]), independent);
  assert(matrixOriginError <= POSITION_TOLERANCE_M, `ENU-to-ECEF origin error ${matrixOriginError} m exceeds 1 m`);
  const inverseOriginError = distance3(transformPointColumnMajor(value.ecef_to_local_enu, independent), [0, 0, 0]);
  assert(inverseOriginError <= POSITION_TOLERANCE_M, `ECEF-to-ENU origin error ${inverseOriginError} m exceeds 1 m`);
  const expected = expectedEnuMatrices(value.origin, independent);
  const forwardCoefficientError = Math.max(...value.local_enu_to_ecef.map((entry, index) => Math.abs(entry - expected.forward[index])));
  const inverseCoefficientError = Math.max(...value.ecef_to_local_enu.map((entry, index) => Math.abs(entry - expected.inverse[index])));
  assert(forwardCoefficientError <= POSITION_TOLERANCE_M, "ENU-to-ECEF matrix differs from independently derived WGS84 basis");
  assert(inverseCoefficientError <= POSITION_TOLERANCE_M, "ECEF-to-ENU matrix differs from independently derived WGS84 basis");
  const testLocal = [12_345.25, -6_789.5, 123.75];
  const roundTrip = transformPointColumnMajor(
    value.ecef_to_local_enu,
    transformPointColumnMajor(value.local_enu_to_ecef, testLocal),
  );
  const roundTripError = distance3(roundTrip, testLocal);
  assert(roundTripError <= POSITION_TOLERANCE_M, `ENU/ECEF matrix round-trip error ${roundTripError} m exceeds 1 m`);
  return { ecefError, matrixOriginError, inverseOriginError, roundTripError };
}

function validateGeodesyFixtures(geodesy) {
  assert(geodesy.horizontal_crs?.geographic_3d === "EPSG:4979", "geodesy contract geographic CRS mismatch");
  assert(geodesy.horizontal_crs?.ecef === "EPSG:4978", "geodesy contract ECEF CRS mismatch");
  assert(Array.isArray(geodesy.coastal_benchmarks) && geodesy.coastal_benchmarks.length >= 3, "coastal benchmarks are missing");
  let maximumError = 0;
  for (const fixture of geodesy.coastal_benchmarks) {
    const computed = geodeticToEcef(fixture);
    fixedNumericArray(fixture.expected_ecef_m, 3, `${fixture.id}.expected_ecef_m`);
    const error = distance3(computed, fixture.expected_ecef_m);
    maximumError = Math.max(maximumError, error);
    assert(error <= geodesy.error_budget.geodetic_to_ecef_m, `${fixture.id} exceeds the geodesy ECEF error budget`);
  }
  return maximumError;
}

function validateTransform(value, label) {
  exactKeys(value, ["id", "parent_frame", "translation_enu_m", "rotation_xyzw", "scale"], label);
  string(value.id, `${label}.id`);
  string(value.parent_frame, `${label}.parent_frame`, { allowEmpty: true });
  fixedNumericArray(value.translation_enu_m, 3, `${label}.translation_enu_m`);
  fixedNumericArray(value.rotation_xyzw, 4, `${label}.rotation_xyzw`);
  const normSquared = value.rotation_xyzw.reduce((sum, entry) => sum + entry * entry, 0);
  assert(Math.abs(normSquared - 1) <= 1e-6, `${label} quaternion is not normalized`);
  fixedNumericArray(value.scale, 3, `${label}.scale`, (entry, entryLabel) => {
    assert(finite(entry, entryLabel) > 0, `${entryLabel} must be positive`);
  });
}

function validateEvent(value, label, transformIds, fieldIds) {
  exactKeys(value, [
    "id", "kind", "phase", "start_tick", "peak_tick", "end_tick", "transform_id", "quantities", "field_refs",
  ], label);
  string(value.id, `${label}.id`);
  assert(EVENT_KINDS.has(value.kind), `${label}.kind is unsupported`);
  assert(EVENT_PHASES.has(value.phase), `${label}.phase is unsupported`);
  integer(value.start_tick, `${label}.start_tick`);
  nullable(value.peak_tick, (entry) => integer(entry, `${label}.peak_tick`));
  nullable(value.end_tick, (entry) => integer(entry, `${label}.end_tick`));
  assert(value.peak_tick === null || value.peak_tick >= value.start_tick, `${label} peak precedes start`);
  assert(value.end_tick === null || value.end_tick >= value.start_tick, `${label} end precedes start`);
  assert(value.peak_tick === null || value.end_tick === null || value.peak_tick <= value.end_tick, `${label} peak follows end`);
  nullable(value.transform_id, (entry) => {
    string(entry, `${label}.transform_id`);
    assert(transformIds.has(entry), `${label} references unknown transform ${entry}`);
  });
  assert(Array.isArray(value.quantities), `${label}.quantities must be an array`);
  for (const [index, quantity] of value.quantities.entries()) {
    exactKeys(quantity, ["semantic", "value", "unit"], `${label}.quantities[${index}]`);
    string(quantity.semantic, `${label}.quantities[${index}].semantic`);
    finite(quantity.value, `${label}.quantities[${index}].value`);
    string(quantity.unit, `${label}.quantities[${index}].unit`);
  }
  assert(Array.isArray(value.field_refs), `${label}.field_refs must be an array`);
  for (const fieldRef of value.field_refs) {
    string(fieldRef, `${label}.field_ref`, { allowEmpty: true });
    if (fieldIds) assert(fieldIds.has(fieldRef), `${label} references unknown field ${fieldRef}`);
  }
}

function validateTransformsAndEvents(transforms, events, label, fieldIds = null) {
  assert(Array.isArray(transforms) && transforms.length <= MAX_TRANSFORMS, `${label}.transforms exceeds V1 cap`);
  assert(Array.isArray(events) && events.length <= MAX_EVENTS, `${label}.events exceeds V1 cap`);
  const transformIds = new Set();
  transforms.forEach((transform, index) => {
    validateTransform(transform, `${label}.transforms[${index}]`);
    assert(!transformIds.has(transform.id), `${label} has duplicate transform ID ${transform.id}`);
    transformIds.add(transform.id);
  });
  const eventIds = new Set();
  events.forEach((event, index) => {
    validateEvent(event, `${label}.events[${index}]`, transformIds, fieldIds);
    assert(!eventIds.has(event.id), `${label} has duplicate event ID ${event.id}`);
    eventIds.add(event.id);
  });
}

function validateGrid(value, label) {
  exactKeys(value, [
    "nx", "ny", "west_cell_center_lon_deg", "south_cell_center_lat_deg", "dlon_deg", "dlat_deg",
    "row_order", "cell_registration", "longitude_wrap",
  ], label);
  integer(value.nx, `${label}.nx`, 0, 0xffff_ffff);
  integer(value.ny, `${label}.ny`, 0, 0xffff_ffff);
  finite(value.west_cell_center_lon_deg, `${label}.west_cell_center_lon_deg`);
  finite(value.south_cell_center_lat_deg, `${label}.south_cell_center_lat_deg`);
  finite(value.dlon_deg, `${label}.dlon_deg`);
  finite(value.dlat_deg, `${label}.dlat_deg`);
  assert(value.west_cell_center_lon_deg >= -180 && value.west_cell_center_lon_deg <= 180, `${label} west longitude is invalid`);
  assert(value.south_cell_center_lat_deg >= -90 && value.south_cell_center_lat_deg <= 90, `${label} south latitude is invalid`);
  assert(value.dlon_deg > 0 && value.dlat_deg > 0, `${label} spacing must be positive`);
  assert(value.row_order === "south_to_north_west_to_east", `${label} row order mismatch`);
  assert(value.cell_registration === "cell_center", `${label} registration mismatch`);
  assert(value.longitude_wrap === "normalized_minus180_180", `${label} longitude wrap mismatch`);
  const north = value.south_cell_center_lat_deg + value.dlat_deg * Math.max(0, value.ny - 1);
  assert(north <= 90 + 1e-9, `${label} extends north of 90 degrees`);
}

function validateField(value, label, payload) {
  exactKeys(value, [
    "id", "semantic", "data_type", "codec", "unit", "vertical_datum", "vertical_axis", "grid",
    "byte_offset", "byte_length", "element_count", "minimum", "maximum", "maximum_abs_conversion_error", "sha256",
  ], label);
  string(value.id, `${label}.id`);
  assert(FIELD_SEMANTICS.has(value.semantic), `${label}.semantic is unsupported`);
  assert(value.data_type === "f32_le" || value.data_type === "bitset_u1", `${label}.data_type is unsupported`);
  assert(value.codec === "none", `${label}.codec must be none`);
  string(value.unit, `${label}.unit`);
  nullable(value.vertical_datum, (entry) => assert(VERTICAL_DATUMS.has(entry), `${label}.vertical_datum is unsupported`));
  nullable(value.vertical_axis, (entry) => assert(VERTICAL_AXES.has(entry), `${label}.vertical_axis is unsupported`));
  validateGrid(value.grid, `${label}.grid`);
  const cells = value.grid.nx * value.grid.ny;
  assert(Number.isSafeInteger(cells) && cells > 0 && cells <= MAX_CELLS, `${label} cell count is invalid`);
  integer(value.element_count, `${label}.element_count`, 0, 0xffff_ffff);
  assert(value.element_count === cells, `${label} element_count disagrees with grid`);
  integer(value.byte_offset, `${label}.byte_offset`, 0, 0xffff_ffff);
  integer(value.byte_length, `${label}.byte_length`, 0, 0xffff_ffff);
  const expectedBytes = value.data_type === "f32_le" ? cells * 4 : Math.ceil(cells / 8);
  assert(value.byte_length === expectedBytes, `${label} byte length disagrees with dtype/grid`);
  const end = value.byte_offset + value.byte_length;
  assert(Number.isSafeInteger(end) && end <= payload.length, `${label} range exceeds payload`);
  nullable(value.minimum, (entry) => finite(entry, `${label}.minimum`));
  nullable(value.maximum, (entry) => finite(entry, `${label}.maximum`));
  assert(value.minimum === null || value.maximum === null || value.minimum <= value.maximum, `${label} minimum exceeds maximum`);
  nullable(value.maximum_abs_conversion_error, (entry) => {
    assert(finite(entry, `${label}.maximum_abs_conversion_error`) >= 0, `${label} conversion error must be non-negative`);
  });
  assert(isSha256(value.sha256), `${label}.sha256 is invalid`);
  const chunk = payload.subarray(value.byte_offset, end);
  assert(sha256(chunk) === value.sha256, `${label} field SHA-256 mismatch`);
  if (value.data_type === "f32_le") {
    const decoded = [];
    for (let offset = 0; offset < chunk.length; offset += 4) {
      const entry = chunk.readFloatLE(offset);
      assert(Number.isFinite(entry), `${label} contains non-finite f32`);
      decoded.push(entry);
    }
    const actualMinimum = Math.min(...decoded);
    const actualMaximum = Math.max(...decoded);
    const conversionError = value.maximum_abs_conversion_error ?? 0;
    if (value.minimum !== null) {
      assert(Math.abs(value.minimum - actualMinimum) <= conversionError + 1e-12, `${label} declared minimum differs from payload`);
    }
    if (value.maximum !== null) {
      assert(Math.abs(value.maximum - actualMaximum) <= conversionError + 1e-12, `${label} declared maximum differs from payload`);
    }
  } else {
    assert(value.semantic === "wet_mask", `${label} bitset_u1 is only valid for wet_mask`);
    const usedBits = cells % 8;
    if (usedBits !== 0) {
      const unusedMask = 0xff ^ ((1 << usedBits) - 1);
      assert((chunk.at(-1) & unusedMask) === 0, `${label} has non-zero unused high bits`);
    }
  }
  return [value.byte_offset, end, value.id];
}

function validateScenario(packet, geodesy) {
  const h = packet.header;
  exactKeys(h, [
    "packet_kind", "protocol", "minimum_reader_minor", "required_features", "scenario_id", "scenario_sha256",
    "georeference", "tick_duration_s", "transforms", "events", "provenance", "payload_sha256",
  ], "scenario header");
  assert(h.packet_kind === "scenario" && packet.kind === KIND.scenario, "scenario packet kind mismatch");
  validateCommon(packet, "scenario");
  assert(packet.sequence === 0, "scenario packet sequence must be zero");
  assert(packet.payload.length === 0 && h.payload_sha256 === EMPTY_SHA256, "scenario payload must be empty");
  assert(finite(h.tick_duration_s, "scenario.tick_duration_s") > 0, "scenario tick duration must be positive");
  const georeferenceMetrics = validateGeoreference(h.georeference, geodesy);
  validateTransformsAndEvents(h.transforms, h.events, "scenario");
  exactKeys(h.provenance, [
    "authority", "model_versions", "geodesy_contract_version", "surface_mask_version", "bathymetry_asset_id", "solver_backend",
  ], "scenario.provenance");
  assert(h.provenance.authority === "rust", "scenario physics authority must be rust");
  assert(Array.isArray(h.provenance.model_versions), "scenario model_versions must be an array");
  h.provenance.model_versions.forEach((model, index) => {
    exactKeys(model, ["component", "version"], `scenario.provenance.model_versions[${index}]`);
    string(model.component, `scenario.provenance.model_versions[${index}].component`, { allowEmpty: true });
    string(model.version, `scenario.provenance.model_versions[${index}].version`, { allowEmpty: true });
  });
  assert(h.provenance.geodesy_contract_version === geodesy.contract_version, "scenario provenance geodesy version mismatch");
  nullable(h.provenance.surface_mask_version, (entry) => string(entry, "scenario.provenance.surface_mask_version", { allowEmpty: true }));
  nullable(h.provenance.bathymetry_asset_id, (entry) => string(entry, "scenario.provenance.bathymetry_asset_id", { allowEmpty: true }));
  string(h.provenance.solver_backend, "scenario.provenance.solver_backend", { allowEmpty: true });
  return { header: h, georeferenceMetrics };
}

function validateFrame(packet, scenario) {
  const h = packet.header;
  const label = `frame ${packet.sequence}`;
  exactKeys(h, [
    "packet_kind", "protocol", "minimum_reader_minor", "required_features", "scenario_id", "scenario_sha256",
    "solver_tick", "simulation_time_s", "tick_duration_s", "keyframe", "base_sequence", "transforms", "events",
    "fields", "payload_sha256",
  ], `${label} header`);
  assert(h.packet_kind === "frame" && packet.kind === KIND.frame, `${label} packet kind mismatch`);
  validateCommon(packet, label);
  assert(h.scenario_id === scenario.scenario_id && h.scenario_sha256 === scenario.scenario_sha256, `${label} scenario identity mismatch`);
  integer(h.solver_tick, `${label}.solver_tick`);
  assert(finite(h.simulation_time_s, `${label}.simulation_time_s`) >= 0, `${label} simulation time must be non-negative`);
  assert(finite(h.tick_duration_s, `${label}.tick_duration_s`) > 0, `${label} tick duration must be positive`);
  assert(h.tick_duration_s === scenario.tick_duration_s, `${label} tick duration differs from scenario`);
  assert(
    Math.abs(h.simulation_time_s - h.solver_tick * h.tick_duration_s) <= h.tick_duration_s + 1e-12,
    `${label} time differs from authoritative tick by more than one tick`,
  );
  assert(typeof h.keyframe === "boolean", `${label}.keyframe must be boolean`);
  nullable(h.base_sequence, (entry) => integer(entry, `${label}.base_sequence`));
  assert(h.keyframe === (h.base_sequence === null), `${label} keyframe/base_sequence relationship is invalid`);
  assert(h.base_sequence === null || h.base_sequence < packet.sequence, `${label} base_sequence must precede packet`);
  assert(Array.isArray(h.fields) && h.fields.length <= MAX_FIELDS, `${label}.fields exceeds V1 cap`);
  const fieldIds = new Set();
  const ranges = h.fields.map((field, index) => {
    const range = validateField(field, `${label}.fields[${index}]`, packet.payload);
    assert(!fieldIds.has(field.id), `${label} has duplicate field ID ${field.id}`);
    fieldIds.add(field.id);
    return range;
  }).sort((left, right) => left[0] - right[0]);
  let cursor = 0;
  for (const [start, end, id] of ranges) {
    assert(start === cursor, `${label} field ${id} leaves a gap or overlaps another field`);
    cursor = end;
  }
  assert(cursor === packet.payload.length, `${label} payload contains unreferenced bytes`);
  validateTransformsAndEvents(h.transforms, h.events, label, fieldIds);
  return h;
}

function validateEnd(packet, scenario) {
  const h = packet.header;
  exactKeys(h, [
    "packet_kind", "protocol", "minimum_reader_minor", "required_features", "scenario_id", "scenario_sha256",
    "final_tick", "frame_count", "payload_sha256",
  ], "end header");
  assert(h.packet_kind === "end" && packet.kind === KIND.end, "end packet kind mismatch");
  validateCommon(packet, "end");
  assert(h.scenario_id === scenario.scenario_id && h.scenario_sha256 === scenario.scenario_sha256, "end scenario identity mismatch");
  integer(h.final_tick, "end.final_tick");
  integer(h.frame_count, "end.frame_count");
  assert(h.frame_count <= packet.sequence, "end frame_count exceeds packet sequence");
  assert(packet.payload.length === 0 && h.payload_sha256 === EMPTY_SHA256, "end payload must be empty");
  return h;
}

function validateRecording(packets, geodesy, { requireFixtureShape = true } = {}) {
  assert(packets.length >= 3, "recording must contain scenario, frame, and end packets");
  packets.forEach((packet, index) => assert(packet.sequence === index, `packet sequence must be contiguous at ${index}`));
  assert(packets[0].kind === KIND.scenario, "first packet must be scenario");
  assert(packets.at(-1).kind === KIND.end, "last packet must be end");
  const scenarioResult = validateScenario(packets[0], geodesy);
  const scenario = scenarioResult.header;
  const framePackets = packets.slice(1, -1);
  assert(framePackets.every((packet) => packet.kind === KIND.frame), "only frames may appear between scenario and end");
  const frames = framePackets.map((packet) => validateFrame(packet, scenario));
  for (let index = 1; index < frames.length; index += 1) {
    assert(frames[index].solver_tick > frames[index - 1].solver_tick, "solver ticks must strictly increase");
  }
  const end = validateEnd(packets.at(-1), scenario);
  assert(end.frame_count === frames.length, "end frame_count disagrees with recording");
  assert(frames.length > 0 && end.final_tick === frames.at(-1).solver_tick, "end final_tick disagrees with final frame");
  if (requireFixtureShape) {
    assert(scenario.scenario_id === "golden-4x3", "canonical fixture scenario ID drifted");
    assert(scenario.scenario_sha256 === sha256(GOLDEN_SCENARIO_BYTES), "canonical scenario SHA-256 drifted");
    assert(frames.length === 3, "canonical fixture must contain three frames");
    exactArray(frames.map((frame) => frame.solver_tick), [0, 1, 2], "canonical solver ticks");
    exactArray(frames.map((frame) => frame.simulation_time_s), [0, 0.5, 1], "canonical simulation times");
    const expectedFields = [
      ["eta", "water_surface_eta_m", "f32_le"],
      ["velocity_east", "water_velocity_east_m_s", "f32_le"],
      ["velocity_north", "water_velocity_north_m_s", "f32_le"],
      ["bathymetry", "bathymetry_depth_m", "f32_le"],
      ["wet_mask", "wet_mask", "bitset_u1"],
    ];
    for (const frame of frames) {
      exactArray(
        frame.fields.map((field) => [field.id, field.semantic, field.data_type]),
        expectedFields,
        `canonical frame ${frame.solver_tick} fields`,
      );
      assert(frame.keyframe && frame.base_sequence === null, "canonical frames must be keyframes");
      assert(frame.fields.every((field) => field.grid.nx === 4 && field.grid.ny === 3), "canonical grid must be 4x3");
    }
  }
  return { scenario, frames, end, georeferenceMetrics: scenarioResult.georeferenceMetrics };
}

function buildSummary(bytes, packets, validated, coastalMaximumEcefErrorM) {
  return {
    fixture_version: 1,
    protocol: { major: PROTOCOL_MAJOR, minor: PROTOCOL_MINOR },
    fixture_sha256: sha256(bytes),
    bytes: bytes.length,
    packet_count: packets.length,
    packet_lengths: packets.map((packet) => packet.packetLength),
    frame_count: validated.frames.length,
    sequences: packets.map((packet) => packet.sequence),
    ticks: validated.frames.map((frame) => frame.solver_tick),
    times_s: validated.frames.map((frame) => frame.simulation_time_s),
    scenario_id: validated.scenario.scenario_id,
    scenario_sha256: validated.scenario.scenario_sha256,
    payload_sha256s: packets.map((packet) => packet.header.payload_sha256),
    frame_fields: validated.frames.map((frame) => frame.fields.map((field) => ({
      id: field.id,
      semantic: field.semantic,
      data_type: field.data_type,
      sha256: field.sha256,
    }))),
    georeference_max_error_m: Math.max(...Object.values(validated.georeferenceMetrics)),
    coastal_fixture_max_ecef_error_m: coastalMaximumEcefErrorM,
  };
}

function clonePackets(packets) {
  return packets.map((packet) => ({ ...packet, header: structuredClone(packet.header) }));
}

function expectFailure(label, action) {
  try {
    action();
  } catch {
    return;
  }
  fail(`negative conformance case did not fail: ${label}`);
}

function runNegativeTests(canonical, geodesy) {
  const decoded = decodeRecording(canonical);
  const mutate = (fn) => {
    const bytes = Buffer.from(canonical);
    fn(bytes);
    return bytes;
  };
  const firstRaw = decoded[0].recordingOffset;
  const firstFrame = decoded[1];
  expectFailure("outer length prefix", () => decodeRecording(mutate((bytes) => bytes.writeUInt32LE(bytes.readUInt32LE(0) + 1, 0))));
  expectFailure("truncated outer prefix", () => decodeRecording(canonical.subarray(0, canonical.length - 1)));
  expectFailure("magic", () => decodeRecording(mutate((bytes) => { bytes[firstRaw] ^= 0xff; })));
  expectFailure("breaking major", () => decodeRecording(mutate((bytes) => bytes.writeUInt16LE(2, firstRaw + 8))));
  expectFailure("kind mismatch", () => decodeRecording(mutate((bytes) => bytes.writeUInt8(KIND.frame, firstRaw + 12))));
  expectFailure("unknown flags", () => decodeRecording(mutate((bytes) => bytes.writeUInt8(0x80, firstRaw + 13))));
  expectFailure("reserved bits", () => decodeRecording(mutate((bytes) => bytes.writeUInt16LE(1, firstRaw + 14))));
  expectFailure("header cap", () => decodeRecording(mutate((bytes) => bytes.writeUInt32LE(MAX_HEADER_BYTES + 1, firstRaw + 16))));
  expectFailure("payload cap", () => decodeRecording(mutate((bytes) => bytes.writeUInt32LE(MAX_PAYLOAD_BYTES + 1, firstRaw + 20))));
  expectFailure("keyframe flag", () => decodeRecording(mutate((bytes) => bytes.writeUInt8(0, firstFrame.recordingOffset + 13))));
  expectFailure("sequence", () => {
    const bytes = mutate((value) => value.writeBigUInt64LE(7n, firstFrame.recordingOffset + 24));
    validateRecording(decodeRecording(bytes), geodesy);
  });
  expectFailure("payload checksum", () => {
    const bytes = mutate((value) => {
      const payloadStart = firstFrame.recordingOffset + PRELUDE_BYTES + firstFrame.headerLength;
      value[payloadStart] ^= 1;
    });
    validateRecording(decodeRecording(bytes), geodesy);
  });

  const cases = [
    ["authoritative timing", (packets) => { packets[2].header.simulation_time_s += packets[2].header.tick_duration_s * 2; }],
    ["scenario hash", (packets) => { packets[1].header.scenario_sha256 = "0".repeat(64); }],
    ["ECEF tolerance", (packets) => { packets[0].header.georeference.origin_ecef_m.x_m += 2; }],
    ["matrix tolerance", (packets) => { packets[0].header.georeference.local_enu_to_ecef[12] += 2; }],
    ["inverse matrix tolerance", (packets) => { packets[0].header.georeference.ecef_to_local_enu[12] += 2; }],
    ["quaternion normalization", (packets) => { packets[1].header.transforms[0].rotation_xyzw[3] = 2; }],
    ["event tick interval", (packets) => { packets[1].header.events[0].end_tick = 0; packets[1].header.events[0].peak_tick = 1; }],
    ["event transform reference", (packets) => { packets[1].header.events[0].transform_id = "missing"; }],
    ["event field reference", (packets) => { packets[1].header.events[0].field_refs[0] = "missing"; }],
    ["field overlap", (packets) => { packets[1].header.fields[1].byte_offset = packets[1].header.fields[0].byte_offset; }],
    ["bitset semantic", (packets) => { packets[1].header.fields.at(-1).semantic = "temperature_k"; }],
    ["base sequence", (packets) => { packets[1].header.keyframe = false; packets[1].header.base_sequence = packets[1].sequence; }],
  ];
  for (const [label, mutatePackets] of cases) {
    const packets = clonePackets(decoded);
    mutatePackets(packets);
    expectFailure(label, () => validateRecording(packets, geodesy, { requireFixtureShape: false }));
  }
}

function validateSchemaSentinel() {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  assert(schema.$schema === "https://json-schema.org/draft/2020-12/schema", "render schema must use draft 2020-12");
  assert(schema.$defs?.protocol?.properties?.major?.const === PROTOCOL_MAJOR, "schema major drifted");
  assert(schema.$defs?.protocol?.properties?.minor?.const === PROTOCOL_MINOR, "schema minor drifted");
  assert(schema.$defs?.field?.properties?.data_type?.enum?.includes("bitset_u1"), "schema omits bitset_u1");
  assert(schema.$defs?.georeference?.properties?.matrix_order?.const === "column_major", "schema matrix order drifted");
  assert(Array.isArray(schema.oneOf) && schema.oneOf.length === 3, "schema must define scenario/frame/end headers");
  exactArray(schema.oneOf.map((entry) => entry.properties?.packet_kind?.const), ["scenario", "frame", "end"], "schema packet kinds");
}

function runRustFixtureWriter() {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const result = spawnSync("cargo", [
    "run", "--quiet", "--manifest-path", path.join(ROOT, "src-tauri", "Cargo.toml"),
    "--example", "render_protocol_fixture", "--", FIXTURE_PATH,
  ], { cwd: ROOT, stdio: "inherit" });
  assert(result.error === undefined, `failed to launch Rust fixture writer: ${result.error?.message}`);
  assert(result.status === 0, `Rust fixture writer exited with status ${result.status}`);
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function main() {
  const args = new Set(process.argv.slice(2));
  for (const arg of args) {
    assert(arg === "--write-fixture" || arg === "--skip-negative-tests", `unknown argument ${arg}`);
  }
  if (args.has("--write-fixture")) runRustFixtureWriter();
  const geodesy = JSON.parse(readFileSync(GEODESY_PATH, "utf8"));
  validateSchemaSentinel();
  const coastalMaximumEcefErrorM = validateGeodesyFixtures(geodesy);
  const fixtureBytes = readFileSync(FIXTURE_PATH);
  const decoded = decodeRecording(fixtureBytes);
  const validated = validateRecording(decoded, geodesy);
  const summary = buildSummary(fixtureBytes, decoded, validated, coastalMaximumEcefErrorM);
  if (args.has("--write-fixture")) writeFileSync(EXPECTED_PATH, canonicalJson(summary));
  const expected = JSON.parse(readFileSync(EXPECTED_PATH, "utf8"));
  assert(
    JSON.stringify(expected) === JSON.stringify(summary),
    `recording.expected.json does not match the Rust fixture\n${canonicalJson(summary)}`,
  );
  if (!args.has("--skip-negative-tests")) runNegativeTests(fixtureBytes, geodesy);
  console.log(
    `Render protocol ${PROTOCOL_MAJOR}.${PROTOCOL_MINOR}: ${decoded.length} length-prefixed packets, ` +
    `${validated.frames.length} frames, ${fixtureBytes.length} bytes, sha256 ${sha256(fixtureBytes)}; ` +
    "hashes, fields, sequence, timing, georeference, and corruption rejection passed.",
  );
}

try {
  main();
} catch (error) {
  console.error(`Render protocol verification failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
