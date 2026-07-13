import type { InspectAtPointResult } from "../../lib/tauri";
import type { InitialDisplacement } from "../../types/scenario";

export type InspectionRequest = Readonly<{
  source: InitialDisplacement["center"];
  initial_amplitude_m: number;
  cavity_radius_m: number;
  is_impact: boolean;
  mean_depth_m: number;
  time_s: number;
  click_lat: number;
  click_lon: number;
  beach_slope_deg: number;
  offshore_depth_m: number;
}>;

export type InspectionRequestOptions = Readonly<{
  isImpact?: boolean;
  timeS?: number;
}>;

const DEFAULT_MEAN_DEPTH_M = 4_000;
const DEFAULT_BEACH_SLOPE_DEG = 1;
const DEFAULT_OFFSHORE_DEPTH_M = 50;

/** Builds the single canonical inspect-at-point request used by every input path. */
export function buildInspectionRequest(
  initial: InitialDisplacement,
  lat: number,
  lon: number,
  options: InspectionRequestOptions = {},
): InspectionRequest {
  const sourceDepth = initial.center.depth_m ?? 0;
  return Object.freeze({
    source: initial.center,
    initial_amplitude_m: initial.peak_amplitude_m,
    cavity_radius_m: initial.cavity_radius_m,
    is_impact: options.isImpact === true,
    mean_depth_m: Number.isFinite(sourceDepth) && sourceDepth > 0
      ? sourceDepth
      : DEFAULT_MEAN_DEPTH_M,
    time_s: options.timeS ?? 0,
    click_lat: lat,
    click_lon: lon,
    beach_slope_deg: DEFAULT_BEACH_SLOPE_DEG,
    offshore_depth_m: DEFAULT_OFFSHORE_DEPTH_M,
  });
}

function finite(value: number, digits: number): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function arrivalLabel(arrivalTimeS: number): string {
  const arrivalMinutes = arrivalTimeS / 60;
  if (!Number.isFinite(arrivalMinutes)) return "—";
  if (arrivalMinutes < 60) return `T+${arrivalMinutes.toFixed(0)}m`;
  return `T+${Math.floor(arrivalMinutes / 60)}h${String(Math.round(arrivalMinutes % 60)).padStart(2, "0")}`;
}

/** Deterministic, non-finite-safe label text for Cesium inspection entities. */
export function formatInspectionLabel(
  lat: number,
  lon: number,
  result: InspectAtPointResult,
): string {
  const status = result.has_arrived ? "ARRIVED" : "in transit";
  return [
    `${finite(lat, 2)}°, ${finite(lon, 2)}°`,
    `Range  ${finite(result.range_m / 1_000, 0)} km   ·   ${status}`,
    `Arrival ${arrivalLabel(result.arrival_time_s)}`,
    `Offshore ${finite(result.offshore_amplitude_m, 2)} m   ·   Runup ${finite(result.runup_m, 1)} m`,
    `Inundation ~${finite(result.inundation_extent_m / 1_000, 2)} km`,
    "Illustrative · low confidence · nominal 1° slope / 50 m depth",
  ].join("\n");
}
