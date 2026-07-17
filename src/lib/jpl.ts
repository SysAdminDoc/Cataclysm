import { FALLBACK_FIREBALLS } from "../data/fallback-fireballs";
import { findFallbackNeo } from "../data/fallback-neos";
import type { FireballEvent, NeoLookupResult, SentryRisk } from "../types/jpl";
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
