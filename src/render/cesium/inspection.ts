import type { InspectAtPointResult } from "../../lib/tauri";
import type { DirectHazardProbeResult } from "../../hazards";
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

export type PointProbeMetric = Readonly<{
  label: string;
  value: string;
  arrivalTimeS?: number | null;
}>;

export type PointProbeReport = Readonly<{
  domain: "tsunami" | "asteroid" | "nuclear";
  lat: number;
  lon: number;
  rangeM: number;
  status: string;
  metrics: PointProbeMetric[];
  governingModel: string;
  citations: string[];
  assumptions: string[];
  confidence: string;
  unknowns: string[];
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

function thresholdLabel(result: DirectHazardProbeResult): string {
  const thresholds = result.effects
    .filter((effect) => effect.threshold_value != null && effect.threshold_unit)
    .map((effect) => `${effect.threshold_value} ${effect.threshold_unit}`);
  return thresholds.length > 0 ? thresholds.join(" · ") : "No numeric displayed threshold";
}

/** Compact explainability label for a registered direct-hazard point probe. */
export function formatDirectHazardProbeLabel(result: DirectHazardProbeResult): string {
  return formatPointProbeReport(directHazardProbeReport(result));
}

export function directHazardProbeReport(result: DirectHazardProbeResult): PointProbeReport {
  const arrivals = result.effects
    .map((effect) => effect.arrival_time_s)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const firstArrival = arrivals.length > 0 ? Math.min(...arrivals) : null;
  const status = result.status === "threshold_exceeded"
    ? `${result.effects.length} displayed threshold${result.effects.length === 1 ? "" : "s"} reached`
    : "No displayed threshold reached — not a safety finding";
  return {
    domain: result.kind,
    lat: result.click_lat,
    lon: result.click_lon,
    rangeM: result.range_m,
    status,
    metrics: [
      { label: "Threshold lower bounds", value: thresholdLabel(result) },
      {
        label: "Earliest modeled arrival",
        value: firstArrival == null ? "unknown" : arrivalLabel(firstArrival),
        arrivalTimeS: firstArrival,
      },
    ],
    governingModel: result.governing_model,
    citations: result.citations,
    assumptions: result.assumptions,
    confidence: result.confidence.replace("_", " "),
    unknowns: result.unknowns,
  };
}

export function tsunamiProbeReport(
  lat: number,
  lon: number,
  result: InspectAtPointResult,
): PointProbeReport {
  return {
    domain: "tsunami",
    lat,
    lon,
    rangeM: result.range_m,
    status: result.has_arrived ? "Wave arrived by scenario time" : "Wave in transit",
    metrics: [
      { label: "Arrival", value: arrivalLabel(result.arrival_time_s), arrivalTimeS: result.arrival_time_s },
      { label: "Offshore amplitude", value: `${finite(result.offshore_amplitude_m, 2)} m` },
      { label: "Runup", value: `${finite(result.runup_m, 1)} m` },
      { label: "Inundation", value: `~${finite(result.inundation_extent_m / 1_000, 2)} km` },
    ],
    governingModel: result.governing_model ?? "analytical far-field model",
    citations: result.citations ?? [],
    assumptions: result.assumptions ?? ["Nominal 1° slope / 50 m depth"],
    confidence: result.confidence ?? "illustrative",
    unknowns: result.unknowns ?? ["Local bathymetry and shoreline effects are unresolved"],
  };
}

export function formatPointProbeReport(report: PointProbeReport): string {
  return [
    `${finite(report.lat, 2)}°, ${finite(report.lon, 2)}°`,
    `Range ${finite(report.rangeM / 1_000, 1)} km · ${report.status}`,
    ...report.metrics.map((metric) => `${metric.label}: ${metric.value}`),
    `Model ${report.governingModel} · ${report.confidence}`,
    `Basis: ${report.citations[0] ?? "No citation supplied"}`,
    `Assumption: ${report.assumptions[1] ?? report.assumptions[0] ?? "Not supplied"}`,
    `Unknown: ${report.unknowns[0] ?? "Not supplied"}`,
  ].join("\n");
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
    `${result.confidence ?? "illustrative"} confidence · ${result.governing_model ?? "analytical far-field model"}`,
    `Basis: ${result.citations?.[0] ?? "model citation unavailable"}`,
    `Assumption: ${result.assumptions?.[1] ?? "nominal 1° slope / 50 m depth"}`,
    `Unknown: ${result.unknowns?.[0] ?? "local bathymetry and shoreline effects are unresolved"}`,
  ].join("\n");
}
