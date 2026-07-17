import type {
  AsteroidImpactInput,
  EarthquakeInput,
  GeoPoint,
  LandslideInput,
  MeteotsunamiInput,
  NuclearBurstInput,
} from "../types/scenario";
import sourceInputContract from "../data/source-input-contract.json";

export const SCENARIO_SCHEMA_VERSION = 1;

export type ScenarioInput =
  | { kind: "Asteroid"; source: AsteroidImpactInput }
  | { kind: "Nuclear"; source: NuclearBurstInput }
  | { kind: "Earthquake"; source: EarthquakeInput }
  | { kind: "Landslide"; source: LandslideInput }
  | { kind: "Meteotsunami"; source: MeteotsunamiInput };

export type ScenarioPayload = ScenarioInput & {
  schemaVersion: typeof SCENARIO_SCHEMA_VERSION;
};

export type ScenarioMigration = Readonly<
  | {
      code: "schema-version-added";
      description: `added schemaVersion ${typeof SCENARIO_SCHEMA_VERSION}`;
    }
  | {
      code: "version-alias-canonicalized";
      description: "canonicalized version to schemaVersion";
    }
>;

export type ScenarioValidationResult =
  | {
      ok: true;
      scenario: ScenarioInput;
      payload: ScenarioPayload;
      migrated: boolean;
      migrations: readonly ScenarioMigration[];
    }
  | { ok: false; reason: string };

export type Bound = { min?: number; max?: number; minInclusive?: boolean; maxInclusive?: boolean };
export type ScenarioSourceKind = "Asteroid" | "Nuclear" | "Earthquake" | "Landslide" | "Meteotsunami";
export type ScientificSourceKind = ScenarioSourceKind | "DirectAsteroid" | "DirectNuclear";
type ContractField = {
  type: "number" | "enum";
  label: string;
  units: string | null;
  default: number | string;
  minimum?: number;
  maximum?: number;
  minimumInclusive?: boolean;
  maximumInclusive?: boolean;
  values?: string[];
  uiValues?: string[];
};
type SourceContract = { fields: Record<string, ContractField> };
const allSources = sourceInputContract.sources as unknown as Record<ScientificSourceKind, SourceContract>;
const scenarioSourceKinds: ScenarioSourceKind[] = ["Asteroid", "Nuclear", "Earthquake", "Landslide", "Meteotsunami"];
const scenarioSources = scenarioSourceKinds.map((source) => allSources[source]);

if (sourceInputContract.scenarioSchemaVersion !== SCENARIO_SCHEMA_VERSION) {
  throw new Error("Source input contract and scenario schema versions do not match.");
}

export function sourceField(source: ScientificSourceKind, field: string): ContractField | undefined {
  return allSources[source].fields[field];
}

export function sourceBound(source: ScientificSourceKind, field: string): Required<Pick<Bound, "min" | "max">> {
  const definition = sourceField(source, field);
  if (!definition || definition.type !== "number" || definition.minimum === undefined || definition.maximum === undefined) {
    throw new Error(`Source input contract has no numeric bounds for ${source}.${field}.`);
  }
  return { min: definition.minimum, max: definition.maximum };
}

export function validateSourceNumber(source: ScientificSourceKind, field: string, value: unknown): string | null {
  const definition = sourceField(source, field);
  if (!definition || definition.type !== "number") return `Source input contract has no numeric field ${source}.${field}.`;
  if (typeof value !== "number" || !Number.isFinite(value)) return `${definition.label} must be a finite number.`;
  if (definition.minimum !== undefined && (value < definition.minimum || (definition.minimumInclusive === false && value === definition.minimum))) {
    return `${definition.label} is below its allowed minimum.`;
  }
  if (definition.maximum !== undefined && (value > definition.maximum || (definition.maximumInclusive === false && value === definition.maximum))) {
    return `${definition.label} is above its allowed maximum.`;
  }
  return null;
}

export function sourceNumericDefault(source: ScientificSourceKind, field: string): number {
  const definition = sourceField(source, field);
  if (!definition || definition.type !== "number" || typeof definition.default !== "number") {
    throw new Error(`Source input contract has no numeric default for ${source}.${field}.`);
  }
  return definition.default;
}

export function sourceTextDefault(source: ScientificSourceKind, field: string): string {
  const definition = sourceField(source, field);
  if (!definition || definition.type !== "enum" || typeof definition.default !== "string") {
    throw new Error(`Source input contract has no enum default for ${source}.${field}.`);
  }
  return definition.default;
}

export function sourceEnumValues(source: ScientificSourceKind, field: string, uiOnly = false): string[] {
  const definition = sourceField(source, field);
  if (!definition || definition.type !== "enum" || !definition.values) {
    throw new Error(`Source input contract has no enum values for ${source}.${field}.`);
  }
  return uiOnly && definition.uiValues ? definition.uiValues : definition.values;
}

export const INITIAL_ASTEROID: AsteroidImpactInput = {
  diameter_m: sourceNumericDefault("Asteroid", "diameter_m"),
  density_kg_m3: sourceNumericDefault("Asteroid", "density_kg_m3"),
  velocity_m_s: sourceNumericDefault("Asteroid", "velocity_m_s"),
  angle_deg: sourceNumericDefault("Asteroid", "angle_deg"),
  water_depth_m: sourceNumericDefault("Asteroid", "water_depth_m"),
  location: { lat_deg: sourceNumericDefault("Asteroid", "lat_deg"), lon_deg: sourceNumericDefault("Asteroid", "lon_deg"), depth_m: sourceNumericDefault("Asteroid", "water_depth_m") },
};

export const INITIAL_NUCLEAR: NuclearBurstInput = {
  yield_kt: sourceNumericDefault("Nuclear", "yield_kt"),
  burst_mode: sourceTextDefault("Nuclear", "burst_mode") as NuclearBurstInput["burst_mode"],
  burst_depth_m: sourceNumericDefault("Nuclear", "burst_depth_m"),
  water_depth_m: sourceNumericDefault("Nuclear", "water_depth_m"),
  location: { lat_deg: sourceNumericDefault("Nuclear", "lat_deg"), lon_deg: sourceNumericDefault("Nuclear", "lon_deg"), depth_m: sourceNumericDefault("Nuclear", "water_depth_m") },
};

export const INITIAL_EARTHQUAKE: EarthquakeInput = {
  mw: sourceNumericDefault("Earthquake", "mw"),
  depth_m: sourceNumericDefault("Earthquake", "depth_m"),
  strike_deg: sourceNumericDefault("Earthquake", "strike_deg"),
  dip_deg: sourceNumericDefault("Earthquake", "dip_deg"),
  rake_deg: sourceNumericDefault("Earthquake", "rake_deg"),
  slip_m: sourceNumericDefault("Earthquake", "slip_m"),
  fault_length_m: sourceNumericDefault("Earthquake", "fault_length_m"),
  fault_width_m: sourceNumericDefault("Earthquake", "fault_width_m"),
  water_depth_m: sourceNumericDefault("Earthquake", "water_depth_m"),
  location: { lat_deg: sourceNumericDefault("Earthquake", "lat_deg"), lon_deg: sourceNumericDefault("Earthquake", "lon_deg"), depth_m: sourceNumericDefault("Earthquake", "water_depth_m") },
};

export const INITIAL_LANDSLIDE: LandslideInput = {
  kind: sourceTextDefault("Landslide", "kind") as LandslideInput["kind"],
  volume_m3: sourceNumericDefault("Landslide", "volume_m3"),
  density_kg_m3: sourceNumericDefault("Landslide", "density_kg_m3"),
  drop_height_m: sourceNumericDefault("Landslide", "drop_height_m"),
  slope_deg: sourceNumericDefault("Landslide", "slope_deg"),
  water_depth_m: sourceNumericDefault("Landslide", "water_depth_m"),
  water_body_width_m: sourceNumericDefault("Landslide", "water_body_width_m"),
  location: { lat_deg: sourceNumericDefault("Landslide", "lat_deg"), lon_deg: sourceNumericDefault("Landslide", "lon_deg"), depth_m: sourceNumericDefault("Landslide", "water_depth_m") },
};

export const INITIAL_METEOTSUNAMI: MeteotsunamiInput = {
  peak_pressure_pa: sourceNumericDefault("Meteotsunami", "peak_pressure_pa"),
  speed_m_s: sourceNumericDefault("Meteotsunami", "speed_m_s"),
  heading_deg: sourceNumericDefault("Meteotsunami", "heading_deg"),
  along_track_sigma_m: sourceNumericDefault("Meteotsunami", "along_track_sigma_m"),
  cross_track_sigma_m: sourceNumericDefault("Meteotsunami", "cross_track_sigma_m"),
  track_length_m: sourceNumericDefault("Meteotsunami", "track_length_m"),
  water_depth_m: sourceNumericDefault("Meteotsunami", "water_depth_m"),
  location: {
    lat_deg: sourceNumericDefault("Meteotsunami", "lat_deg"),
    lon_deg: sourceNumericDefault("Meteotsunami", "lon_deg"),
    depth_m: sourceNumericDefault("Meteotsunami", "water_depth_m"),
  },
};

export const SCENARIO_BOUNDS: Record<string, Bound> = scenarioSources
  .flatMap((source) => Object.entries(source.fields))
  .reduce<Record<string, Bound>>((bounds, [field, definition]) => {
    if (definition.type === "number") {
      if (definition.minimum === undefined || definition.maximum === undefined) {
        throw new Error(`Source input contract numeric field ${field} is missing bounds.`);
      }
      const previous = bounds[field];
      const next = {
        min: definition.minimum,
        max: definition.maximum,
        minInclusive: definition.minimumInclusive,
        maxInclusive: definition.maximumInclusive,
      };
      bounds[field] = previous
        ? { min: Math.min(previous.min ?? next.min, next.min), max: Math.max(previous.max ?? next.max, next.max), minInclusive: true, maxInclusive: true }
        : next;
    }
    return bounds;
  }, {});

const LABELS: Record<string, string> = scenarioSources
  .flatMap((source) => Object.entries(source.fields))
  .reduce<Record<string, string>>((labels, [field, definition]) => {
    if (labels[field] && labels[field] !== definition.label) {
      throw new Error(`Source input contract defines conflicting labels for ${field}.`);
    }
    labels[field] = definition.label;
    return labels;
  }, {});

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

function numberInSourceRange(obj: RecordValue, source: ScenarioSourceKind, field: string): ParseResult<number> {
  const value = obj[field];
  const failure = validateSourceNumber(source, field, value);
  if (failure) return parseFail(failure);
  return { ok: true, value: value as number };
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
    if (depth.value !== waterDepthM) {
      return parseFail(
        `Source water_depth_m (${waterDepthM}) conflicts with location.depth_m (${depth.value}).`,
      );
    }
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
  const waterDepth = numberInSourceRange(obj.value, "Landslide", "water_depth_m");
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

function parseMeteotsunami(source: unknown): ParseResult<MeteotsunamiInput> {
  const obj = asRecord(source, "Meteotsunami source");
  if (!obj.ok) return obj;
  const fields = [
    "peak_pressure_pa",
    "speed_m_s",
    "heading_deg",
    "along_track_sigma_m",
    "cross_track_sigma_m",
    "track_length_m",
  ] as const;
  const values = {} as Record<(typeof fields)[number], number>;
  for (const field of fields) {
    const parsed = numberInSourceRange(obj.value, "Meteotsunami", field);
    if (!parsed.ok) return parsed;
    values[field] = parsed.value;
  }
  const waterDepth = numberInSourceRange(obj.value, "Meteotsunami", "water_depth_m");
  if (!waterDepth.ok) return waterDepth;
  const location = parseLocation(obj.value.location, waterDepth.value);
  if (!location.ok) return location;
  return {
    ok: true,
    value: {
      ...values,
      water_depth_m: waterDepth.value,
      location: location.value,
    },
  };
}

export function parseScenarioPayload(value: unknown): ScenarioValidationResult {
  const root = asRecord(value, "Scenario");
  if (!root.ok) return fail(root.reason);

  const schemaVersion = root.value.schemaVersion;
  const versionAlias = root.value.version;
  if (
    schemaVersion !== undefined
    && versionAlias !== undefined
    && schemaVersion !== versionAlias
  ) {
    return fail(
      `Scenario fields schemaVersion (${String(schemaVersion)}) and version (${String(versionAlias)}) conflict.`,
    );
  }
  const rawVersion = schemaVersion ?? versionAlias;
  if (rawVersion !== undefined && rawVersion !== SCENARIO_SCHEMA_VERSION) {
    return fail(`Scenario schema version ${String(rawVersion)} is not supported.`);
  }

  const migrations: ScenarioMigration[] = [];
  if (schemaVersion === undefined) {
    if (versionAlias === SCENARIO_SCHEMA_VERSION) {
      migrations.push({
        code: "version-alias-canonicalized",
        description: "canonicalized version to schemaVersion",
      });
    } else {
      migrations.push({
        code: "schema-version-added",
        description: `added schemaVersion ${SCENARIO_SCHEMA_VERSION}`,
      });
    }
  } else if (versionAlias !== undefined) {
    migrations.push({
      code: "version-alias-canonicalized",
      description: "canonicalized version to schemaVersion",
    });
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
    case "Meteotsunami":
      parsedSource = parseMeteotsunami(root.value.source);
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
    migrated: migrations.length > 0,
    migrations,
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
  | { type: "invalid"; reason: string }
  | { type: "none" };

const MAX_SCENARIO_URL_LENGTH = 10_000;

export function scenarioFromUrl(search: string): UrlScenarioResult {
  const params = new URLSearchParams(search);
  const presetId = params.get("preset");
  if (presetId) return { type: "preset", presetId };
  const encoded = params.get("scenario");
  if (!encoded) return { type: "none" };
  if (encoded.length > MAX_SCENARIO_URL_LENGTH) {
    return { type: "invalid", reason: "The shared scenario is larger than the supported URL limit." };
  }
  try {
    const json = atob(encoded);
    const parsed = parseScenarioPayload(JSON.parse(json));
    if (parsed.ok) return { type: "scenario", scenario: parsed.scenario };
    return { type: "invalid", reason: parsed.reason };
  } catch {
    return { type: "invalid", reason: "The shared scenario link is malformed or corrupted." };
  }
}
