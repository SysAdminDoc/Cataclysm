import type {
  HazelRunupObservation,
  HazelRunupSearchResponse,
} from "./ncei-hazel";
import type { RunupAtPointResult } from "./tauri";

export const HAZEL_MATCH_RADIUS_M = 50_000;
export const HAZEL_MAX_PLOTTED_POINTS = 600;

export type ModeledRunupComparisonPoint = Pick<
  RunupAtPointResult,
  "id" | "name" | "lat" | "lon" | "runup_m" | "has_arrived"
>;

export type HazelObservedRunupPoint = {
  id: string;
  sourceId: number;
  name: string;
  country: string | null;
  lat: number;
  lon: number;
  runupM: number;
  doubtful: string | null;
  measurementTypeId: number | null;
};

export type HazelRunupMatch = {
  observedId: string;
  observedName: string;
  observedRunupM: number;
  modeledId: string;
  modeledName: string;
  modeledRunupM: number;
  distanceM: number;
  residualM: number;
};

export type HazelValidationSummary = {
  sourceItemCount: number;
  fetchedItemCount: number;
  validObservedCount: number;
  plottedCount: number;
  matchedCount: number;
  matchRadiusM: number;
  biasM: number | null;
  rmseM: number | null;
  meanAbsoluteErrorM: number | null;
  observedMaxM: number | null;
  modeledMaxM: number | null;
  sourceTruncated: boolean;
  displaySampled: boolean;
};

export type PreparedHazelValidation = {
  points: HazelObservedRunupPoint[];
  matches: HazelRunupMatch[];
  summary: HazelValidationSummary;
};

function finiteCoordinate(value: number | null | undefined, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function finiteNonnegative(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function observationName(observation: HazelRunupObservation): string {
  const location = observation.locationName?.trim();
  const country = observation.country?.trim();
  return (location || country || "Unnamed HazEL runup location").slice(0, 120);
}

function normalizeObservation(observation: HazelRunupObservation): HazelObservedRunupPoint | null {
  if (!Number.isSafeInteger(observation.id) || observation.id <= 0) return null;
  if (!finiteCoordinate(observation.latitude, -90, 90)) return null;
  if (!finiteCoordinate(observation.longitude, -180, 180)) return null;
  if (!finiteNonnegative(observation.runupHt)) return null;
  return {
    id: `hazel-runup-${observation.id}`,
    sourceId: observation.id,
    name: observationName(observation),
    country: observation.country?.trim() || null,
    lat: observation.latitude,
    lon: observation.longitude,
    runupM: observation.runupHt,
    doubtful: observation.doubtful?.trim() || null,
    measurementTypeId: Number.isSafeInteger(observation.typeMeasurementId)
      ? observation.typeMeasurementId ?? null
      : null,
  };
}

function haversineDistanceM(left: { lat: number; lon: number }, right: { lat: number; lon: number }): number {
  const earthRadiusM = 6_371_000;
  const lat1 = left.lat * Math.PI / 180;
  const lat2 = right.lat * Math.PI / 180;
  const dLat = lat2 - lat1;
  const dLon = (right.lon - left.lon) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return earthRadiusM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function samplePoints(points: readonly HazelObservedRunupPoint[], limit: number): HazelObservedRunupPoint[] {
  if (points.length <= limit) return [...points];
  return Array.from({ length: limit }, (_, index) => points[Math.floor(index * points.length / limit)]);
}

export function prepareHazelValidation(
  response: Pick<HazelRunupSearchResponse, "items" | "totalItems" | "sampledItems" | "truncated">,
  modeled: readonly ModeledRunupComparisonPoint[],
  options: Readonly<{
    matchRadiusM?: number;
    maxPlottedPoints?: number;
  }> = {},
): PreparedHazelValidation {
  const matchRadiusM = Number.isFinite(options.matchRadiusM) && (options.matchRadiusM ?? 0) > 0
    ? options.matchRadiusM as number
    : HAZEL_MATCH_RADIUS_M;
  const maxPlottedPoints = Number.isSafeInteger(options.maxPlottedPoints)
    && (options.maxPlottedPoints ?? 0) > 0
    ? options.maxPlottedPoints as number
    : HAZEL_MAX_PLOTTED_POINTS;
  const byId = new Set<number>();
  const points = response.items
    .map(normalizeObservation)
    .filter((point): point is HazelObservedRunupPoint => point !== null)
    .filter((point) => {
      if (byId.has(point.sourceId)) return false;
      byId.add(point.sourceId);
      return true;
    })
    .sort((left, right) => left.sourceId - right.sourceId);
  const plotted = samplePoints(points, maxPlottedPoints);
  const candidates = modeled
    .filter((point) => point.has_arrived)
    .filter((point) => (
      typeof point.id === "string"
      && point.id.length > 0
      && typeof point.name === "string"
      && finiteCoordinate(point.lat, -90, 90)
      && finiteCoordinate(point.lon, -180, 180)
      && finiteNonnegative(point.runup_m)
    ))
    .sort((left, right) => left.id.localeCompare(right.id));
  const pairCandidates: Array<{ observed: HazelObservedRunupPoint; modeled: ModeledRunupComparisonPoint; distanceM: number }> = [];
  for (const observed of points) {
    for (const modeledPoint of candidates) {
      const distanceM = haversineDistanceM(observed, modeledPoint);
      if (distanceM <= matchRadiusM) pairCandidates.push({ observed, modeled: modeledPoint, distanceM });
    }
  }
  pairCandidates.sort((left, right) => (
    left.distanceM - right.distanceM
    || left.observed.id.localeCompare(right.observed.id)
    || left.modeled.id.localeCompare(right.modeled.id)
  ));
  const matchedObserved = new Set<string>();
  const matchedModeled = new Set<string>();
  const matches: HazelRunupMatch[] = [];
  for (const candidate of pairCandidates) {
    if (matchedObserved.has(candidate.observed.id) || matchedModeled.has(candidate.modeled.id)) continue;
    matchedObserved.add(candidate.observed.id);
    matchedModeled.add(candidate.modeled.id);
    matches.push({
      observedId: candidate.observed.id,
      observedName: candidate.observed.name,
      observedRunupM: candidate.observed.runupM,
      modeledId: candidate.modeled.id,
      modeledName: candidate.modeled.name,
      modeledRunupM: candidate.modeled.runup_m,
      distanceM: candidate.distanceM,
      residualM: candidate.modeled.runup_m - candidate.observed.runupM,
    });
  }
  matches.sort((left, right) => left.observedId.localeCompare(right.observedId));
  const residuals = matches.map((match) => match.residualM);
  const biasM = residuals.length > 0
    ? residuals.reduce((sum, value) => sum + value, 0) / residuals.length
    : null;
  const rmseM = residuals.length > 0
    ? Math.sqrt(residuals.reduce((sum, value) => sum + value ** 2, 0) / residuals.length)
    : null;
  const meanAbsoluteErrorM = residuals.length > 0
    ? residuals.reduce((sum, value) => sum + Math.abs(value), 0) / residuals.length
    : null;
  return {
    points: plotted,
    matches,
    summary: {
      sourceItemCount: response.totalItems,
      fetchedItemCount: response.sampledItems,
      validObservedCount: points.length,
      plottedCount: plotted.length,
      matchedCount: matches.length,
      matchRadiusM,
      biasM,
      rmseM,
      meanAbsoluteErrorM,
      observedMaxM: points.length > 0 ? Math.max(...points.map((point) => point.runupM)) : null,
      modeledMaxM: candidates.length > 0 ? Math.max(...candidates.map((point) => point.runup_m)) : null,
      sourceTruncated: response.truncated,
      displaySampled: points.length > plotted.length,
    },
  };
}
