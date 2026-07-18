import { FALLBACK_FIREBALLS } from "../data/fallback-fireballs";
import { findFallbackNeo } from "../data/fallback-neos";
import { FALLBACK_CLOSE_APPROACHES } from "../data/fallback-close-approaches";
import type {
  FireballEvent,
  HypotheticalImpactDraft,
  NeoApproachFeed,
  NeoCloseApproach,
  NeoLookupResult,
  SentryRisk,
} from "../types/jpl";
import { api, isTauri } from "./tauri";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseFloat(stringValue(value) ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

function fieldNumber(row: unknown[], fields: string[], name: string): number | null {
  const index = fields.indexOf(name);
  return index < 0 ? null : numberValue(row[index]);
}

function fieldString(row: unknown[], fields: string[], name: string): string | null {
  const index = fields.indexOf(name);
  return index < 0 ? null : stringValue(row[index]);
}

function signedCoordinate(value: number | null, direction: unknown): number | null {
  if (value === null) return null;
  return direction === "S" || direction === "W" ? -value : value;
}

export function parseFireballs(payload: unknown): FireballEvent[] {
  const root = record(payload);
  const fields = Array.isArray(root?.fields) ? root.fields.filter((field): field is string => typeof field === "string") : [];
  const rows = Array.isArray(root?.data) ? root.data : [];
  const dateIndex = fields.indexOf("date");
  const latDirectionIndex = fields.indexOf("lat-dir");
  const lonDirectionIndex = fields.indexOf("lon-dir");
  return rows.flatMap((value, index) => {
    if (!Array.isArray(value)) return [];
    const lat = signedCoordinate(fieldNumber(value, fields, "lat"), value[latDirectionIndex]);
    const lon = signedCoordinate(fieldNumber(value, fields, "lon"), value[lonDirectionIndex]);
    const date = dateIndex >= 0 ? stringValue(value[dateIndex]) : null;
    if (lat === null || lon === null || !date || Math.abs(lat) > 90 || Math.abs(lon) > 180) return [];
    return [{
      id: `${date}-${index}`,
      date,
      lat,
      lon,
      radiatedEnergy10J: fieldNumber(value, fields, "energy") ?? 0,
      impactEnergyKt: fieldNumber(value, fields, "impact-e") ?? 0,
      altitudeKm: fieldNumber(value, fields, "alt"),
      velocityKmS: fieldNumber(value, fields, "vel"),
      source: "NASA/JPL CNEOS" as const,
    }];
  });
}

export async function loadFireballs(): Promise<{ events: FireballEvent[]; notice: string | null }> {
  if (!isTauri()) {
    return { events: FALLBACK_FIREBALLS, notice: "Live CNEOS feed is desktop-only; showing built-in notable events." };
  }
  try {
    const payload = await api.jplApiRequest("fireball", { "req-loc": "true", limit: "80", sort: "-date" });
    const events = parseFireballs(payload);
    return events.length
      ? { events, notice: null }
      : { events: FALLBACK_FIREBALLS, notice: "Live CNEOS feed had no located events; showing built-in notable events." };
  } catch {
    return { events: FALLBACK_FIREBALLS, notice: "Live CNEOS feed unavailable; showing built-in notable events." };
  }
}

const APPROACH_CACHE_KEY = "cataclysm.neo.close-approaches.v1";
const CAD_DOCUMENTATION_FETCHED_AT = "2023-03-01T00:00:00.000Z";
const MONTHS: Readonly<Record<string, string>> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function cadDateToIso(value: string): string | null {
  const match = value.trim().match(/^(\d{4})-([A-Z][a-z]{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!match || !MONTHS[match[2]]) return null;
  const iso = `${match[1]}-${MONTHS[match[2]]}-${match[3]}T${match[4]}:${match[5]}:00.000Z`;
  return Number.isFinite(Date.parse(iso)) ? iso : null;
}

function diameterRange(
  diameterKm: number | null,
  sigmaKm: number | null,
  absoluteMagnitude: number | null,
): Pick<NeoCloseApproach, "diameterMinM" | "diameterMaxM" | "diameterBasis"> {
  if (diameterKm !== null && diameterKm > 0) {
    const sigma = sigmaKm !== null && sigmaKm > 0 ? sigmaKm : 0;
    const meters = (valueKm: number) => Math.round(valueKm * 1_000_000) / 1_000;
    return {
      diameterMinM: meters(Math.max(0, diameterKm - sigma)),
      diameterMaxM: meters(diameterKm + sigma),
      diameterBasis: "measured",
    };
  }
  if (absoluteMagnitude !== null) {
    const estimateM = (albedo: number) => (1_329 / Math.sqrt(albedo)) * 10 ** (-0.2 * absoluteMagnitude) * 1_000;
    return {
      diameterMinM: estimateM(0.25),
      diameterMaxM: estimateM(0.05),
      diameterBasis: "estimated_from_h",
    };
  }
  return { diameterMinM: 0, diameterMaxM: 0, diameterBasis: "unknown" };
}

/** Parses only the bounded Earth-approach fields requested from CAD API v1.5. */
export function parseCloseApproaches(payload: unknown): NeoCloseApproach[] {
  const root = record(payload);
  const fields = Array.isArray(root?.fields) ? root.fields.filter((field): field is string => typeof field === "string") : [];
  const rows = Array.isArray(root?.data) ? root.data : [];
  return rows.flatMap((value, index) => {
    if (!Array.isArray(value)) return [];
    const designation = fieldString(value, fields, "des")?.trim() ?? "";
    const fullname = fieldString(value, fields, "fullname")?.trim() || designation;
    const approachAtIso = cadDateToIso(fieldString(value, fields, "cd") ?? "");
    const nominalDistanceAu = fieldNumber(value, fields, "dist");
    const minimumDistanceAu = fieldNumber(value, fields, "dist_min");
    const maximumDistanceAu = fieldNumber(value, fields, "dist_max");
    const relativeVelocityKmS = fieldNumber(value, fields, "v_rel");
    const infinityVelocityKmS = fieldNumber(value, fields, "v_inf");
    const absoluteMagnitude = fieldNumber(value, fields, "h");
    if (
      !designation || !approachAtIso
      || nominalDistanceAu === null || nominalDistanceAu <= 0
      || minimumDistanceAu === null || minimumDistanceAu <= 0
      || maximumDistanceAu === null || maximumDistanceAu < minimumDistanceAu
      || relativeVelocityKmS === null || relativeVelocityKmS <= 0
      || infinityVelocityKmS === null || infinityVelocityKmS <= 0
    ) return [];
    return [{
      id: `cad-${designation}-${approachAtIso}-${index}`,
      designation,
      fullname,
      approachAtIso,
      nominalDistanceAu,
      minimumDistanceAu,
      maximumDistanceAu,
      relativeVelocityKmS,
      infinityVelocityKmS,
      timeUncertainty: fieldString(value, fields, "t_sigma_f")?.trim() || "",
      absoluteMagnitude,
      ...diameterRange(
        fieldNumber(value, fields, "diameter"),
        fieldNumber(value, fields, "diameter_sigma"),
        absoluteMagnitude,
      ),
      source: "NASA/JPL SBDB Close Approach Data API" as const,
    }];
  }).slice(0, 12);
}

function isCloseApproach(value: unknown): value is NeoCloseApproach {
  const entry = record(value);
  const finite = (candidate: unknown): candidate is number => typeof candidate === "number" && Number.isFinite(candidate);
  return typeof entry?.id === "string" && entry.id.length <= 160
    && typeof entry.designation === "string"
    && entry.designation.length <= 80
    && typeof entry.fullname === "string" && entry.fullname.length <= 160
    && typeof entry.approachAtIso === "string"
    && Number.isFinite(Date.parse(entry.approachAtIso))
    && finite(entry.nominalDistanceAu) && entry.nominalDistanceAu > 0 && entry.nominalDistanceAu <= 0.05
    && finite(entry.minimumDistanceAu) && entry.minimumDistanceAu > 0
    && finite(entry.maximumDistanceAu) && entry.maximumDistanceAu >= entry.minimumDistanceAu
    && finite(entry.relativeVelocityKmS) && entry.relativeVelocityKmS > 0
    && finite(entry.infinityVelocityKmS) && entry.infinityVelocityKmS > 0
    && finite(entry.diameterMinM) && entry.diameterMinM >= 0
    && finite(entry.diameterMaxM) && entry.diameterMaxM >= entry.diameterMinM
    && typeof entry.timeUncertainty === "string" && entry.timeUncertainty.length <= 80
    && (entry.absoluteMagnitude === null || finite(entry.absoluteMagnitude))
    && ["measured", "estimated_from_h", "unknown"].includes(String(entry.diameterBasis))
    && ["NASA/JPL SBDB Close Approach Data API", "Built-in reference"].includes(String(entry.source));
}

function readApproachCache(): { approaches: NeoCloseApproach[]; fetchedAtIso: string } | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const cached = record(JSON.parse(localStorage.getItem(APPROACH_CACHE_KEY) ?? "null"));
    const approaches = Array.isArray(cached?.approaches) ? cached.approaches.filter(isCloseApproach).slice(0, 12) : [];
    const fetchedAtIso = stringValue(cached?.fetchedAtIso);
    if (!approaches.length || !fetchedAtIso || !Number.isFinite(Date.parse(fetchedAtIso))) return null;
    return { approaches, fetchedAtIso };
  } catch {
    return null;
  }
}

function writeApproachCache(approaches: NeoCloseApproach[], fetchedAtIso: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(APPROACH_CACHE_KEY, JSON.stringify({ schemaVersion: 1, approaches, fetchedAtIso }));
  } catch {
    // Browsing live data still works when storage is unavailable.
  }
}

export async function loadCloseApproaches(): Promise<NeoApproachFeed> {
  if (!isTauri()) {
    return {
      approaches: [...FALLBACK_CLOSE_APPROACHES],
      fetchedAtIso: CAD_DOCUMENTATION_FETCHED_AT,
      status: "reference",
      stale: false,
      notice: "Live close approaches are available in the desktop app; showing JPL API documentation examples.",
    };
  }
  try {
    const payload = await api.jplApiRequest("cad", {
      "date-min": "now",
      "date-max": "+60",
      "dist-max": "0.05",
      sort: "date",
      limit: "12",
      diameter: "true",
      fullname: "true",
    });
    const approaches = parseCloseApproaches(payload);
    if (!approaches.length) throw new Error("NASA/JPL returned no bounded close approaches.");
    const fetchedAtIso = new Date().toISOString();
    writeApproachCache(approaches, fetchedAtIso);
    return { approaches, fetchedAtIso, status: "live", stale: false, notice: null };
  } catch {
    const cached = readApproachCache();
    if (cached) {
      return {
        ...cached,
        status: "cached",
        stale: true,
        notice: "NASA/JPL is unavailable; showing the last successful on-device cache.",
      };
    }
    return {
      approaches: [...FALLBACK_CLOSE_APPROACHES],
      fetchedAtIso: CAD_DOCUMENTATION_FETCHED_AT,
      status: "reference",
      stale: true,
      notice: "NASA/JPL and the on-device cache are unavailable; showing documentation examples, not today's feed.",
    };
  }
}

/** Converts observed approach facts into an explicitly hypothetical impact draft. */
export function hypotheticalImpactFromApproach(approach: NeoCloseApproach): HypotheticalImpactDraft {
  const hasSize = approach.diameterMaxM > 0;
  const diameterM = hasSize ? (approach.diameterMinM + approach.diameterMaxM) / 2 : 100;
  const velocityMps = Math.sqrt(approach.infinityVelocityKmS ** 2 + 11.186 ** 2) * 1_000;
  return {
    object: approach,
    diameterM,
    velocityMps,
    densityKgM3: 2_600,
    assumptions: [
      hasSize
        ? "Diameter uses the midpoint of the displayed JPL measured/estimated range."
        : "Diameter defaults to 100 m because the close-approach feed has no size estimate.",
      "Density uses a generic 2,600 kg/m³ asteroid assumption; CAD does not supply composition.",
      "Impact speed combines JPL V-infinity with Earth escape speed. This is a what-if input, not a predicted trajectory or impact corridor.",
    ],
  };
}

function valueOf(items: unknown, name: string): string | null {
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    const entry = record(item);
    if (entry?.name === name) return stringValue(entry.value);
  }
  return null;
}

function estimateDensity(spectralType: string): number {
  const kind = spectralType.toUpperCase();
  if (kind.startsWith("M") || kind.startsWith("X")) return 5_000;
  if (["S", "Q", "V"].some((prefix) => kind.startsWith(prefix))) return 3_300;
  if (["C", "B", "D", "P"].some((prefix) => kind.startsWith(prefix))) return 1_800;
  return 2_600;
}

function estimateDiameterM(hMagnitude: number, albedo: number): number {
  return (1_329 / Math.sqrt(albedo)) * 10 ** (-0.2 * hMagnitude) * 1_000;
}

function estimateImpactVelocityMps(orbitElements: unknown): number {
  const semimajorAxis = numberValue(valueOf(orbitElements, "a"));
  const eccentricity = numberValue(valueOf(orbitElements, "e"));
  if (semimajorAxis === null || eccentricity === null || semimajorAxis <= 0) return 20_000;
  const heliocentricTerm = 29_780 ** 2 * (
    3 - 1 / semimajorAxis - 2 * Math.sqrt(Math.max(0, semimajorAxis * (1 - eccentricity ** 2)))
  );
  return Math.sqrt(Math.max(0, heliocentricTerm) + 11_186 ** 2);
}

function sentryYearRange(data: unknown): string {
  if (!Array.isArray(data)) return "active";
  const years = data
    .map((value) => Number.parseInt(stringValue(record(value)?.date)?.slice(0, 4) ?? "", 10))
    .filter(Number.isFinite);
  if (!years.length) return "active";
  const minimum = Math.min(...years);
  const maximum = Math.max(...years);
  return minimum === maximum ? String(minimum) : `${minimum}–${maximum}`;
}

async function lookupSentryRisk(designation: string | null): Promise<SentryRisk | undefined> {
  if (!designation) return undefined;
  const payload = record(await api.jplApiRequest("sentry", { des: designation }));
  const summary = record(payload?.summary);
  if (!summary) return undefined;
  const impactProbability = numberValue(summary.ip) ?? 0;
  if (impactProbability <= 0) return undefined;
  return {
    impactProbability,
    palermoScale: stringValue(summary.ps_cum) ?? stringValue(summary.ps_max) ?? "n/a",
    torinoScale: stringValue(summary.ts_max) ?? "0",
    impactCount: numberValue(summary.n_imp) ?? (Array.isArray(payload?.data) ? payload.data.length : 0),
    yearRange: sentryYearRange(payload?.data),
  };
}

export async function searchNeo(query: string): Promise<NeoLookupResult> {
  const trimmed = query.trim();
  if (trimmed.length < 2) throw new Error("Enter at least two characters.");
  if (!isTauri()) {
    const fallback = findFallbackNeo(trimmed);
    if (fallback) return fallback;
    throw new Error("Live NASA/JPL lookup is available in the desktop app.");
  }
  try {
    const payload = record(await api.jplApiRequest("sbdb", { sstr: trimmed, "phys-par": "1" }));
    if (!payload) throw new Error("NASA/JPL returned an invalid response.");
    if (numberValue(payload.code) === 300) throw new Error("Multiple objects matched; enter a more specific designation.");
    const object = record(payload.object);
    if (!object) throw new Error(stringValue(payload.message) ?? "No matching object found.");
    const physical = payload.phys_par;
    const orbit = record(payload.orbit);
    const albedo = numberValue(valueOf(physical, "albedo")) ?? 0.15;
    const measuredDiameterKm = numberValue(valueOf(physical, "diameter"));
    const hMagnitude = numberValue(valueOf(physical, "H"));
    const diameterM = measuredDiameterKm && measuredDiameterKm > 0
      ? measuredDiameterKm * 1_000
      : hMagnitude !== null
        ? estimateDiameterM(hMagnitude, albedo)
        : 100;
    const spectralType = valueOf(physical, "spec_T") ?? valueOf(physical, "spec_B") ?? "";
    const designation = stringValue(object.des) ?? stringValue(object.pdes);
    const assumptions = [
      measuredDiameterKm ? "Diameter is the SBDB physical-parameter value." : "Diameter is estimated from absolute magnitude and albedo.",
      spectralType ? `Density is estimated from spectral class ${spectralType}.` : "Density uses a generic 2,600 kg/m³ asteroid assumption.",
      "Impact speed is a scenario input estimated from osculating a/e plus Earth escape speed, not a predicted impact corridor.",
    ];
    let risk: SentryRisk | undefined;
    try {
      risk = await lookupSentryRisk(designation);
    } catch {
      risk = undefined;
    }
    return {
      fullname: stringValue(object.fullname) ?? designation ?? trimmed,
      designation,
      diameterM,
      velocityMps: estimateImpactVelocityMps(orbit?.elements),
      densityKgM3: estimateDensity(spectralType),
      risk,
      source: "NASA/JPL SBDB",
      assumptions,
    };
  } catch (error) {
    const fallback = findFallbackNeo(trimmed);
    if (fallback) return fallback;
    throw error;
  }
}
