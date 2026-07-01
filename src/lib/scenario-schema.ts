import type {
  AsteroidImpactInput,
  EarthquakeInput,
  GeoPoint,
  LandslideInput,
  NuclearBurstInput,
} from "../types/scenario";

export const SCENARIO_SCHEMA_VERSION = 1;

export type ScenarioInput =
  | { kind: "Asteroid"; source: AsteroidImpactInput }
  | { kind: "Nuclear"; source: NuclearBurstInput }
  | { kind: "Earthquake"; source: EarthquakeInput }
  | { kind: "Landslide"; source: LandslideInput };

export type ScenarioPayload = ScenarioInput & {
  schemaVersion: typeof SCENARIO_SCHEMA_VERSION;
};

export type ScenarioValidationResult =
  | { ok: true; scenario: ScenarioInput; payload: ScenarioPayload; migrated: boolean }
  | { ok: false; reason: string };

export type Bound = { min?: number; max?: number };

export const INITIAL_ASTEROID: AsteroidImpactInput = {
  diameter_m: 500,
  density_kg_m3: 3000,
  velocity_m_s: 18_000,
  angle_deg: 45,
  water_depth_m: 4_000,
  location: { lat_deg: 0, lon_deg: -30, depth_m: 4_000 },
};

export const INITIAL_NUCLEAR: NuclearBurstInput = {
  yield_kt: 1000,
  burst_mode: "DeepOptimal",
  burst_depth_m: 100,
  water_depth_m: 4_000,
  location: { lat_deg: 50, lon_deg: -10, depth_m: 4_000 },
};

export const INITIAL_EARTHQUAKE: EarthquakeInput = {
  mw: 8.5,
  depth_m: 30_000,
  strike_deg: 195,
  dip_deg: 12,
  rake_deg: 85,
  slip_m: 15,
  fault_length_m: 0,
  fault_width_m: 0,
  water_depth_m: 2_000,
  location: { lat_deg: 38.0, lon_deg: 143.0, depth_m: 2_000 },
};

export const INITIAL_LANDSLIDE: LandslideInput = {
  kind: "Submarine",
  volume_m3: 1.0e10,
  density_kg_m3: 2200,
  drop_height_m: 700,
  slope_deg: 25,
  water_depth_m: 1_500,
  water_body_width_m: 10_000,
  location: { lat_deg: -20.55, lon_deg: -175.39, depth_m: 1_500 },
};

export const SCENARIO_BOUNDS: Record<string, Bound> = {
  diameter_m: { min: 1, max: 50_000 },
  density_kg_m3: { min: 500, max: 8_000 },
  velocity_m_s: { min: 1_000, max: 72_000 },
  angle_deg: { min: 1, max: 90 },
  water_depth_m: { min: 0, max: 12_000 },
  yield_kt: { min: 0.001, max: 1_000_000 },
  burst_depth_m: { min: 0, max: 6_000 },
  mw: { min: 5, max: 10 },
  depth_m: { min: 0, max: 100_000 },
  strike_deg: { min: 0, max: 360 },
  dip_deg: { min: 0, max: 90 },
  rake_deg: { min: -180, max: 180 },
  slip_m: { min: 0, max: 100 },
  fault_length_m: { min: 0, max: 2_000_000 },
  fault_width_m: { min: 0, max: 500_000 },
  volume_m3: { min: 1, max: 1.0e14 },
  drop_height_m: { min: 0, max: 10_000 },
  slope_deg: { min: 0, max: 90 },
  water_body_width_m: { min: 1, max: 1_000_000 },
  lat_deg: { min: -90, max: 90 },
  lon_deg: { min: -180, max: 180 },
};

const LABELS: Record<string, string> = {
  diameter_m: "Diameter",
  density_kg_m3: "Density",
  velocity_m_s: "Velocity",
  angle_deg: "Impact angle",
  water_depth_m: "Water depth",
  yield_kt: "Yield",
  burst_depth_m: "Burst depth",
  mw: "Magnitude",
  depth_m: "Hypocentre depth",
  strike_deg: "Strike",
  dip_deg: "Dip",
  rake_deg: "Rake",
  slip_m: "Slip",
  fault_length_m: "Fault length",
  fault_width_m: "Fault width",
  volume_m3: "Volume",
  drop_height_m: "Drop height",
  slope_deg: "Slope",
  water_body_width_m: "Receiving body width",
  lat_deg: "Latitude",
  lon_deg: "Longitude",
};

type RecordValue = Record<string, unknown>;
type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

function fail(reason: string): ScenarioValidationResult {
  return { ok: false, reason };
}

function parseFail<T>(reason: string): ParseResult<T> {
  return { ok: false, reason };
}

function asRecord(value: unknown, label: string): ParseResult<RecordValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return parseFail(`${label} must be an object.`);
  }
  return { ok: true, value: value as RecordValue };
}

function formatBound(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString("en-US") : String(n);
}

function numberInRange(obj: RecordValue, field: string): ParseResult<number> {
  const label = LABELS[field] ?? field;
  const value = obj[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return parseFail(`${label} must be a finite number.`);
  }
  const bound = SCENARIO_BOUNDS[field];
  if (bound?.min !== undefined && value < bound.min) {
    return parseFail(`${label} must be at least ${formatBound(bound.min)}.`);
  }
  if (bound?.max !== undefined && value > bound.max) {
    return parseFail(`${label} must be at most ${formatBound(bound.max)}.`);
  }
  return { ok: true, value };
}

function optionalNumberInRange(obj: RecordValue, field: string, fallback: number): ParseResult<number> {
  if (obj[field] === undefined || obj[field] === null) return { ok: true, value: fallback };
  return numberInRange(obj, field);
}

function enumValue<T extends readonly string[]>(
  obj: RecordValue,
  field: string,
  allowed: T,
  label: string,
): ParseResult<T[number]> {
  const value = obj[field];
  if (typeof value === "string" && allowed.includes(value)) {
    return { ok: true, value };
  }
  return parseFail(`${label} must be one of ${allowed.join(", ")}.`);
}

function parseLocation(value: unknown, waterDepthM: number): ParseResult<GeoPoint> {
  const obj = asRecord(value, "Location");
  if (!obj.ok) return obj;
  const lat = numberInRange(obj.value, "lat_deg");
  if (!lat.ok) return lat;
  const lon = numberInRange(obj.value, "lon_deg");
  if (!lon.ok) return lon;
  if (obj.value.depth_m !== undefined && obj.value.depth_m !== null) {
    const depth = numberInRange({ water_depth_m: obj.value.depth_m }, "water_depth_m");
    if (!depth.ok) return parseFail(`Location depth ${depth.reason.toLowerCase()}`);
  }
  return {
    ok: true,
    value: { lat_deg: lat.value, lon_deg: lon.value, depth_m: waterDepthM },
  };
}

function parseAsteroid(source: unknown): ParseResult<AsteroidImpactInput> {
  const obj = asRecord(source, "Asteroid source");
  if (!obj.ok) return obj;
  const diameter = numberInRange(obj.value, "diameter_m");
  if (!diameter.ok) return diameter;
  const density = numberInRange(obj.value, "density_kg_m3");
  if (!density.ok) return density;
  const velocity = numberInRange(obj.value, "velocity_m_s");
  if (!velocity.ok) return velocity;
  const angle = numberInRange(obj.value, "angle_deg");
  if (!angle.ok) return angle;
  const waterDepth = numberInRange(obj.value, "water_depth_m");
  if (!waterDepth.ok) return waterDepth;
  const location = parseLocation(obj.value.location, waterDepth.value);
  if (!location.ok) return location;
  return {
    ok: true,
    value: {
      diameter_m: diameter.value,
      density_kg_m3: density.value,
      velocity_m_s: velocity.value,
      angle_deg: angle.value,
      water_depth_m: waterDepth.value,
      location: location.value,
    },
  };
}

function parseNuclear(source: unknown): ParseResult<NuclearBurstInput> {
  const obj = asRecord(source, "Nuclear source");
  if (!obj.ok) return obj;
  const yieldKt = numberInRange(obj.value, "yield_kt");
  if (!yieldKt.ok) return yieldKt;
  const burstMode = enumValue(
    obj.value,
    "burst_mode",
    ["Surface", "Shallow", "DeepOptimal", "Abyssal"] as const,
    "Burst geometry",
  );
  if (!burstMode.ok) return burstMode;
  const burstDepth = numberInRange(obj.value, "burst_depth_m");
  if (!burstDepth.ok) return burstDepth;
  const waterDepth = numberInRange(obj.value, "water_depth_m");
  if (!waterDepth.ok) return waterDepth;
  const location = parseLocation(obj.value.location, waterDepth.value);
  if (!location.ok) return location;
  return {
    ok: true,
    value: {
      yield_kt: yieldKt.value,
      burst_mode: burstMode.value,
      burst_depth_m: burstDepth.value,
      water_depth_m: waterDepth.value,
      location: location.value,
    },
  };
}

function parseEarthquake(source: unknown): ParseResult<EarthquakeInput> {
  const obj = asRecord(source, "Earthquake source");
  if (!obj.ok) return obj;
  const mw = numberInRange(obj.value, "mw");
  if (!mw.ok) return mw;
  const depth = numberInRange(obj.value, "depth_m");
  if (!depth.ok) return depth;
  const strike = numberInRange(obj.value, "strike_deg");
  if (!strike.ok) return strike;
  const dip = numberInRange(obj.value, "dip_deg");
  if (!dip.ok) return dip;
  const rake = numberInRange(obj.value, "rake_deg");
  if (!rake.ok) return rake;
  const slip = numberInRange(obj.value, "slip_m");
  if (!slip.ok) return slip;
  const faultLength = optionalNumberInRange(obj.value, "fault_length_m", 0);
  if (!faultLength.ok) return faultLength;
  const faultWidth = optionalNumberInRange(obj.value, "fault_width_m", 0);
  if (!faultWidth.ok) return faultWidth;
  const waterDepth = numberInRange(obj.value, "water_depth_m");
  if (!waterDepth.ok) return waterDepth;
  const location = parseLocation(obj.value.location, waterDepth.value);
  if (!location.ok) return location;
  return {
    ok: true,
    value: {
      mw: mw.value,
      depth_m: depth.value,
      strike_deg: strike.value,
      dip_deg: dip.value,
      rake_deg: rake.value,
      slip_m: slip.value,
      fault_length_m: faultLength.value,
      fault_width_m: faultWidth.value,
      water_depth_m: waterDepth.value,
      location: location.value,
    },
  };
}

function parseLandslide(source: unknown): ParseResult<LandslideInput> {
  const obj = asRecord(source, "Landslide source");
  if (!obj.ok) return obj;
  const kind = enumValue(obj.value, "kind", ["Subaerial", "Submarine"] as const, "Landslide type");
  if (!kind.ok) return kind;
  const volume = numberInRange(obj.value, "volume_m3");
  if (!volume.ok) return volume;
  const density = numberInRange(obj.value, "density_kg_m3");
  if (!density.ok) return density;
  const dropHeight = numberInRange(obj.value, "drop_height_m");
  if (!dropHeight.ok) return dropHeight;
  const slope = numberInRange(obj.value, "slope_deg");
  if (!slope.ok) return slope;
  const waterDepth = numberInRange(obj.value, "water_depth_m");
  if (!waterDepth.ok) return waterDepth;
  const width = numberInRange(obj.value, "water_body_width_m");
  if (!width.ok) return width;
  const location = parseLocation(obj.value.location, waterDepth.value);
  if (!location.ok) return location;
  return {
    ok: true,
    value: {
      kind: kind.value,
      volume_m3: volume.value,
      density_kg_m3: density.value,
      drop_height_m: dropHeight.value,
      slope_deg: slope.value,
      water_depth_m: waterDepth.value,
      water_body_width_m: width.value,
      location: location.value,
    },
  };
}

export function parseScenarioPayload(value: unknown): ScenarioValidationResult {
  const root = asRecord(value, "Scenario");
  if (!root.ok) return fail(root.reason);

  const rawVersion = root.value.schemaVersion ?? root.value.version;
  if (rawVersion !== undefined && rawVersion !== SCENARIO_SCHEMA_VERSION) {
    return fail(`Scenario schema version ${String(rawVersion)} is not supported.`);
  }

  if (typeof root.value.kind !== "string") {
    return fail("Scenario kind is missing.");
  }

  let parsedSource: ParseResult<ScenarioInput["source"]>;
  switch (root.value.kind) {
    case "Asteroid":
      parsedSource = parseAsteroid(root.value.source);
      break;
    case "Nuclear":
      parsedSource = parseNuclear(root.value.source);
      break;
    case "Earthquake":
      parsedSource = parseEarthquake(root.value.source);
      break;
    case "Landslide":
      parsedSource = parseLandslide(root.value.source);
      break;
    default:
      return fail(`Scenario kind "${root.value.kind}" is not supported.`);
  }

  if (!parsedSource.ok) return fail(parsedSource.reason);

  const scenario = {
    kind: root.value.kind,
    source: parsedSource.value,
  } as ScenarioInput;

  return {
    ok: true,
    scenario,
    payload: {
      schemaVersion: SCENARIO_SCHEMA_VERSION,
      ...scenario,
    },
    migrated: root.value.schemaVersion !== SCENARIO_SCHEMA_VERSION,
  };
}

export function createScenarioPayload(input: ScenarioInput): ScenarioValidationResult {
  return parseScenarioPayload({
    schemaVersion: SCENARIO_SCHEMA_VERSION,
    kind: input.kind,
    source: input.source,
  });
}

export function scenarioToUrlParams(presetId: string | null, scenario: ScenarioInput | null): string {
  if (presetId) return `?preset=${encodeURIComponent(presetId)}`;
  if (!scenario) return "";
  try {
    const payload = { schemaVersion: SCENARIO_SCHEMA_VERSION, ...scenario };
    const json = JSON.stringify(payload);
    return `?scenario=${encodeURIComponent(btoa(json))}`;
  } catch {
    return "";
  }
}

export type UrlScenarioResult =
  | { type: "preset"; presetId: string }
  | { type: "scenario"; scenario: ScenarioInput }
  | { type: "none" };

const MAX_SCENARIO_URL_LENGTH = 10_000;

export function scenarioFromUrl(search: string): UrlScenarioResult {
  const params = new URLSearchParams(search);
  const presetId = params.get("preset");
  if (presetId) return { type: "preset", presetId };
  const encoded = params.get("scenario");
  if (!encoded || encoded.length > MAX_SCENARIO_URL_LENGTH) return { type: "none" };
  try {
    const json = atob(decodeURIComponent(encoded));
    const parsed = parseScenarioPayload(JSON.parse(json));
    if (parsed.ok) return { type: "scenario", scenario: parsed.scenario };
  } catch { /* invalid URL param — ignore silently */ }
  return { type: "none" };
}
