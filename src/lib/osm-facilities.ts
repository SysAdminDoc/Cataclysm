import type { RunupAtPointResult } from "./tauri";

export const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
export const OSM_ATTRIBUTION_URL = "https://www.openstreetmap.org/copyright";
export const FACILITY_CACHE_KEY = "cataclysm.osm-humanitarian-facilities.v1";
export const FACILITY_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
export const MAX_FACILITY_DISCS = 30;
export const MAX_FACILITIES = 500;
export const MAX_FACILITY_RESPONSE_BYTES = 2 * 1024 * 1024;
export const OVERPASS_MAX_SERVER_MEMORY_BYTES = 64 * 1024 * 1024;
const MAX_DISC_RADIUS_M = 25_000;
const CACHE_ENTRY_LIMIT = 8;
const STALE_CACHE_LIMIT_MS = 30 * 24 * 60 * 60 * 1_000;
const EARTH_RADIUS_M = 6_371_008.8;

export type HumanitarianFacilityCategory = "school" | "health" | "emergency";
export type OsmElementType = "node" | "way" | "relation";

export type InundationDisc = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusM: number;
};

export type FacilityQueryPlan = {
  signature: string;
  query: string;
  discs: InundationDisc[];
  totalEligibleDiscs: number;
  truncatedDiscCount: number;
  clampedDiscCount: number;
};

export type HumanitarianFacility = {
  id: string;
  osmType: OsmElementType;
  osmId: number;
  osmUrl: string;
  name: string;
  category: HumanitarianFacilityCategory;
  kind: string;
  lat: number;
  lon: number;
  runupPointIds: string[];
};

export type FacilityDataset = {
  facilities: HumanitarianFacility[];
  fetchedAt: number;
  osmDataTimestamp: string | null;
  signature: string;
};

type OverpassElement = {
  type?: unknown;
  id?: unknown;
  lat?: unknown;
  lon?: unknown;
  center?: { lat?: unknown; lon?: unknown };
  tags?: Record<string, unknown>;
};

type CacheEnvelope = {
  version: 1;
  entries: FacilityDataset[];
};

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeLongitude(lon: number): number {
  return ((lon + 540) % 360) - 180;
}

function boundingBoxes(disc: InundationDisc): Array<[number, number, number, number]> {
  const latDelta = disc.radiusM / 111_320;
  const lonDelta = disc.radiusM / (111_320 * Math.max(0.05, Math.cos(disc.lat * Math.PI / 180)));
  const south = Math.max(-90, disc.lat - latDelta);
  const north = Math.min(90, disc.lat + latDelta);
  const west = disc.lon - lonDelta;
  const east = disc.lon + lonDelta;
  if (west < -180) {
    return [[south, west + 360, north, 180], [south, -180, north, east]];
  }
  if (east > 180) {
    return [[south, west, north, 180], [south, -180, north, east - 360]];
  }
  return [[south, west, north, east]];
}

function bboxText(box: [number, number, number, number]): string {
  return box.map((value) => value.toFixed(6)).join(",");
}

export function buildFacilityQueryPlan(results: readonly RunupAtPointResult[]): FacilityQueryPlan {
  const eligible = results
    .filter((result) => result.has_arrived
      && finiteNumber(result.lat)
      && finiteNumber(result.lon)
      && finiteNumber(result.inundation_extent_m)
      && result.lat >= -90
      && result.lat <= 90
      && result.lon >= -180
      && result.lon <= 180
      && result.inundation_extent_m > 0)
    .sort((left, right) => right.inundation_extent_m - left.inundation_extent_m || left.id.localeCompare(right.id));
  const selected = eligible.slice(0, MAX_FACILITY_DISCS);
  const discs = selected.map((result) => ({
    id: result.id,
    name: result.name,
    lat: result.lat,
    lon: normalizeLongitude(result.lon),
    radiusM: Math.min(result.inundation_extent_m, MAX_DISC_RADIUS_M),
  }));
  const boxes = discs.flatMap(boundingBoxes);
  const statements = boxes.flatMap((box) => {
    const bbox = bboxText(box);
    return [
      `nwr["amenity"~"^(school|kindergarten|college|university|hospital|clinic|doctors|fire_station|police|ambulance_station)$"](${bbox});`,
      `nwr["healthcare"~"^(hospital|clinic|doctor|doctors)$"](${bbox});`,
      `nwr["emergency"="ambulance_station"](${bbox});`,
    ];
  });
  const signatureInput = discs.map((disc) => [
    disc.id,
    disc.lat.toFixed(5),
    disc.lon.toFixed(5),
    disc.radiusM.toFixed(0),
  ].join(":"));
  return {
    // Keep the canonical geometry in the cache key. A short non-cryptographic
    // hash could collide and surface facilities from a different coastline.
    signature: `v1:${signatureInput.join("|")}`,
    query: discs.length === 0
      ? ""
      : `[out:json][timeout:15][maxsize:${OVERPASS_MAX_SERVER_MEMORY_BYTES}];\n(\n${statements.map((line) => `  ${line}`).join("\n")}\n);\nout center tags qt;`,
    discs,
    totalEligibleDiscs: eligible.length,
    truncatedDiscCount: Math.max(0, eligible.length - discs.length),
    clampedDiscCount: selected.filter((result) => result.inundation_extent_m > MAX_DISC_RADIUS_M).length,
  };
}

function radians(degrees: number): number {
  return degrees * Math.PI / 180;
}

export function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const latDelta = radians(b.lat - a.lat);
  const lonDelta = radians(normalizeLongitude(b.lon - a.lon));
  const sinLat = Math.sin(latDelta / 2);
  const sinLon = Math.sin(lonDelta / 2);
  const haversine = sinLat * sinLat
    + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function stringTag(tags: Record<string, unknown>, key: string): string | null {
  const value = tags[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function classify(tags: Record<string, unknown>): { category: HumanitarianFacilityCategory; kind: string } | null {
  const amenity = stringTag(tags, "amenity");
  if (amenity && ["school", "kindergarten", "college", "university"].includes(amenity)) {
    return { category: "school", kind: amenity };
  }
  const healthcare = stringTag(tags, "healthcare");
  if ((amenity && ["hospital", "clinic", "doctors"].includes(amenity))
    || (healthcare && ["hospital", "clinic", "doctor", "doctors"].includes(healthcare))) {
    return { category: "health", kind: healthcare ?? amenity ?? "healthcare" };
  }
  const emergency = stringTag(tags, "emergency");
  if ((amenity && ["fire_station", "police", "ambulance_station"].includes(amenity))
    || emergency === "ambulance_station") {
    return { category: "emergency", kind: emergency ?? amenity ?? "emergency" };
  }
  return null;
}

function fallbackName(category: HumanitarianFacilityCategory, kind: string): string {
  const readableKind = kind.replaceAll("_", " ");
  if (category === "school") return `Unnamed ${readableKind}`;
  if (category === "health") return `Unnamed ${readableKind}`;
  return `Unnamed ${readableKind}`;
}

export function parseOverpassFacilities(payload: unknown, plan: FacilityQueryPlan): HumanitarianFacility[] {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { elements?: unknown }).elements)) {
    throw new Error("Overpass returned an invalid response.");
  }
  const byId = new Map<string, HumanitarianFacility>();
  for (const rawElement of (payload as { elements: OverpassElement[] }).elements) {
    if (rawElement.type !== "node" && rawElement.type !== "way" && rawElement.type !== "relation") continue;
    const osmId = rawElement.id;
    if (!finiteNumber(osmId) || !Number.isSafeInteger(osmId) || osmId <= 0 || !rawElement.tags || typeof rawElement.tags !== "object") continue;
    const lat = finiteNumber(rawElement.lat) ? rawElement.lat : rawElement.center?.lat;
    const lon = finiteNumber(rawElement.lon) ? rawElement.lon : rawElement.center?.lon;
    if (!finiteNumber(lat) || !finiteNumber(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const classification = classify(rawElement.tags);
    if (!classification) continue;
    const runupPointIds = plan.discs
      .filter((disc) => distanceMeters(disc, { lat, lon }) <= disc.radiusM)
      .map((disc) => disc.id)
      .sort();
    if (runupPointIds.length === 0) continue;
    const id = `${rawElement.type}/${osmId}`;
    const name = stringTag(rawElement.tags, "name")
      ?? stringTag(rawElement.tags, "official_name")
      ?? stringTag(rawElement.tags, "short_name")
      ?? stringTag(rawElement.tags, "operator")
      ?? fallbackName(classification.category, classification.kind);
    byId.set(id, {
      id,
      osmType: rawElement.type,
      osmId,
      osmUrl: `https://www.openstreetmap.org/${rawElement.type}/${osmId}`,
      name: name.slice(0, 160),
      category: classification.category,
      kind: classification.kind,
      lat,
      lon,
      runupPointIds,
    });
  }
  const categoryOrder: Record<HumanitarianFacilityCategory, number> = { health: 0, school: 1, emergency: 2 };
  return [...byId.values()]
    .sort((left, right) => categoryOrder[left.category] - categoryOrder[right.category]
      || left.name.localeCompare(right.name)
      || left.id.localeCompare(right.id))
    .slice(0, MAX_FACILITIES);
}

function parseTimestamp(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const timestamp = (payload as { osm3s?: { timestamp_osm_base?: unknown } }).osm3s?.timestamp_osm_base;
  return typeof timestamp === "string" ? timestamp : null;
}

export async function fetchHumanitarianFacilities(
  plan: FacilityQueryPlan,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<FacilityDataset> {
  if (!plan.query || plan.discs.length === 0) {
    return { facilities: [], fetchedAt: (options.now ?? Date.now)(), osmDataTimestamp: null, signature: plan.signature };
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), 15_000);
  const abortFromCaller = () => timeoutController.abort();
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    const response = await fetchImpl(OVERPASS_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: `data=${encodeURIComponent(plan.query)}`,
      signal: timeoutController.signal,
    });
    if (!response.ok) {
      throw new Error(response.status === 429
        ? "OpenStreetMap data service is rate-limiting requests. Try again later."
        : `OpenStreetMap data service returned HTTP ${response.status}.`);
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_FACILITY_RESPONSE_BYTES) {
      throw new Error("OpenStreetMap facility response exceeded the 2 MB safety limit.");
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_FACILITY_RESPONSE_BYTES) {
      throw new Error("OpenStreetMap facility response exceeded the 2 MB safety limit.");
    }
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(buffer));
    } catch {
      throw new Error("OpenStreetMap data service returned malformed JSON.");
    }
    return {
      facilities: parseOverpassFacilities(payload, plan),
      fetchedAt: (options.now ?? Date.now)(),
      osmDataTimestamp: parseTimestamp(payload),
      signature: plan.signature,
    };
  } catch (error) {
    if (timeoutController.signal.aborted) {
      throw new Error(options.signal?.aborted
        ? "OpenStreetMap facility request was cancelled."
        : "OpenStreetMap facility request timed out after 15 seconds.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

function validFacility(value: unknown): value is HumanitarianFacility {
  if (!value || typeof value !== "object") return false;
  const facility = value as Partial<HumanitarianFacility>;
  return typeof facility.id === "string"
    && (facility.osmType === "node" || facility.osmType === "way" || facility.osmType === "relation")
    && Number.isSafeInteger(facility.osmId)
    && (facility.osmId ?? 0) > 0
    && facility.id === `${facility.osmType}/${facility.osmId}`
    && facility.osmUrl === `https://www.openstreetmap.org/${facility.osmType}/${facility.osmId}`
    && typeof facility.name === "string"
    && facility.name.length > 0
    && facility.name.length <= 160
    && (facility.category === "school" || facility.category === "health" || facility.category === "emergency")
    && typeof facility.kind === "string"
    && finiteNumber(facility.lat)
    && facility.lat >= -90
    && facility.lat <= 90
    && finiteNumber(facility.lon)
    && facility.lon >= -180
    && facility.lon <= 180
    && Array.isArray(facility.runupPointIds)
    && facility.runupPointIds.length <= MAX_FACILITY_DISCS
    && facility.runupPointIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 160);
}

function validDataset(value: unknown): value is FacilityDataset {
  if (!value || typeof value !== "object") return false;
  const dataset = value as Partial<FacilityDataset>;
  return typeof dataset.signature === "string"
    && finiteNumber(dataset.fetchedAt)
    && (dataset.osmDataTimestamp === null || typeof dataset.osmDataTimestamp === "string")
    && Array.isArray(dataset.facilities)
    && dataset.facilities.length <= MAX_FACILITIES
    && dataset.facilities.every(validFacility);
}

function readEnvelope(storage: Storage): CacheEnvelope {
  try {
    const parsed = JSON.parse(storage.getItem(FACILITY_CACHE_KEY) ?? "null") as Partial<CacheEnvelope> | null;
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) return { version: 1, entries: [] };
    return { version: 1, entries: parsed.entries.filter(validDataset).slice(0, CACHE_ENTRY_LIMIT) };
  } catch {
    return { version: 1, entries: [] };
  }
}

export function readFacilityCache(
  signature: string,
  options: { storage?: Storage; now?: number; allowStale?: boolean } = {},
): { dataset: FacilityDataset; stale: boolean } | null {
  const storage = options.storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
  if (!storage) return null;
  const now = options.now ?? Date.now();
  const dataset = readEnvelope(storage).entries.find((entry) => entry.signature === signature);
  if (!dataset) return null;
  const age = Math.max(0, now - dataset.fetchedAt);
  if (age <= FACILITY_CACHE_TTL_MS) return { dataset, stale: false };
  if (options.allowStale && age <= STALE_CACHE_LIMIT_MS) return { dataset, stale: true };
  return null;
}

export function writeFacilityCache(dataset: FacilityDataset, storage?: Storage): void {
  const target = storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
  if (!target || !validDataset(dataset)) return;
  const entries = [dataset, ...readEnvelope(target).entries.filter((entry) => entry.signature !== dataset.signature)]
    .slice(0, CACHE_ENTRY_LIMIT);
  try {
    target.setItem(FACILITY_CACHE_KEY, JSON.stringify({ version: 1, entries } satisfies CacheEnvelope));
  } catch {
    // Cache quota and privacy-mode failures are non-fatal; the live result remains usable.
  }
}

export function removeFacilityCache(signature: string, storage?: Storage): void {
  const target = storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
  if (!target) return;
  const entries = readEnvelope(target).entries.filter((entry) => entry.signature !== signature);
  try {
    if (entries.length === 0) target.removeItem(FACILITY_CACHE_KEY);
    else target.setItem(FACILITY_CACHE_KEY, JSON.stringify({ version: 1, entries } satisfies CacheEnvelope));
  } catch {
    // Cache removal is best-effort.
  }
}
