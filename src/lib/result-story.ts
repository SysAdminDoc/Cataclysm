import type { RunupAtPointResult } from "./tauri";

export type CoastalOutcomePlace = Pick<
  RunupAtPointResult,
  "id" | "name" | "lat" | "lon" | "range_m" | "runup_m" | "arrival_time_s"
>;

export type CoastalOutcomeStory = {
  maximum: CoastalOutcomePlace | null;
  firstAffected: CoastalOutcomePlace | null;
  nearest: CoastalOutcomePlace | null;
  reachM: number | null;
  arrivedCount: number;
  affectedCount: number;
  sampledCount: number;
  confidence: "low" | "medium" | "high" | "unavailable";
  limitation: string;
};

const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 } as const;

function validPlace(result: RunupAtPointResult): boolean {
  return result.id.trim().length > 0
    && result.name.trim().length > 0
    && Number.isFinite(result.lat)
    && Number.isFinite(result.lon)
    && Number.isFinite(result.range_m)
    && result.range_m >= 0
    && Number.isFinite(result.arrival_time_s)
    && result.arrival_time_s >= 0
    && Number.isFinite(result.runup_m)
    && result.runup_m >= 0;
}

export function buildCoastalOutcomeStory(
  runupResults: RunupAtPointResult[],
  timeS: number,
): CoastalOutcomeStory {
  const places = runupResults.filter(validPlace);
  if (places.length === 0) {
    return {
      maximum: null,
      firstAffected: null,
      nearest: null,
      reachM: null,
      arrivedCount: 0,
      affectedCount: 0,
      sampledCount: 0,
      confidence: "unavailable",
      limitation: "Run coastal screening to add place, arrival, and geographic-reach estimates.",
    };
  }

  const maximum = [...places].sort((a, b) => (
    b.runup_m - a.runup_m || a.arrival_time_s - b.arrival_time_s || a.id.localeCompare(b.id)
  ))[0];
  const affected = places.filter((place) => place.runup_m >= 0.1);
  const firstAffected = [...affected].sort((a, b) => (
    a.arrival_time_s - b.arrival_time_s || a.range_m - b.range_m || a.id.localeCompare(b.id)
  ))[0] ?? null;
  const nearest = [...affected].sort((a, b) => (
    a.range_m - b.range_m || a.arrival_time_s - b.arrival_time_s || a.id.localeCompare(b.id)
  ))[0] ?? null;
  const reachM = affected.length > 0 ? Math.max(...affected.map((place) => place.range_m)) : null;
  const safeTimeS = Number.isFinite(timeS) ? Math.max(0, timeS) : 0;
  const arrivedCount = affected.filter((place) => place.arrival_time_s <= safeTimeS).length;
  const narratedPlaces = affected.length > 0 ? affected : places;
  const confidence = narratedPlaces.reduce<"low" | "medium" | "high">(
    (lowest, place) => (
      CONFIDENCE_RANK[place.quantitative_confidence] < CONFIDENCE_RANK[lowest]
        ? place.quantitative_confidence
        : lowest
    ),
    "high",
  );
  const limitation = affected.length === 0
    ? "No sampled coastal point reaches the 0.1 m affected threshold in this screening result."
    : confidence === "high"
      ? "Screening estimates still use analytical runup rather than resolved coastal wetting and drying."
    : confidence === "medium"
      ? "At least one coastal input is medium confidence; treat values as screening estimates."
      : "Coastal slope/depth inputs include low-confidence placeholders; values are illustrative, not site predictions.";

  return {
    maximum,
    firstAffected,
    nearest,
    reachM,
    arrivedCount,
    affectedCount: affected.length,
    sampledCount: places.length,
    confidence,
    limitation,
  };
}

export function formatOutcomeTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "time unavailable";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `T+${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining === 0 ? `T+${hours} h` : `T+${hours} h ${remaining} min`;
}
