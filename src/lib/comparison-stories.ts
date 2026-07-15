import type { InitialDisplacement } from "../types/scenario";

export type ComparisonStory = Readonly<{
  id: string;
  title: string;
  promise: string;
  question: string;
  leftPresetId: string;
  rightPresetId: string;
  focusTimeS: number;
  cameraRangeM: number;
}>;

export const COMPARISON_STORIES: readonly ComparisonStory[] = Object.freeze([
  {
    id: "megathrust-oceans",
    title: "Two ocean-basin megathrusts",
    promise: "Tōhoku 2011 beside the 2004 Indian Ocean tsunami",
    question: "How do source geometry and energy change the first hours of basin propagation?",
    leftPresetId: "tohoku_2011",
    rightPresetId: "indian_ocean_2004",
    focusTimeS: 3_600,
    cameraRangeM: 4_000_000,
  },
  {
    id: "asteroid-scale-ladder",
    title: "Asteroid ocean-impact scale",
    promise: "Chicxulub beside the smaller Eltanin impact",
    question: "Which source-scale differences survive after both disturbances spread across an ocean?",
    leftPresetId: "chicxulub",
    rightPresetId: "eltanin",
    focusTimeS: 900,
    cameraRangeM: 3_000_000,
  },
  {
    id: "poseidon-claim-check",
    title: "Poseidon claim check",
    promise: "Physics-limited coupling beside the propaganda assumption",
    question: "How much does the disputed energy-coupling assumption change the modeled source?",
    leftPresetId: "poseidon_realistic",
    rightPresetId: "poseidon_propaganda",
    focusTimeS: 900,
    cameraRangeM: 2_500_000,
  },
]);

export function comparisonStoryForPreset(presetId: string | null): ComparisonStory {
  return COMPARISON_STORIES.find(
    (story) => story.leftPresetId === presetId || story.rightPresetId === presetId,
  ) ?? COMPARISON_STORIES[0];
}

export function comparisonStoryForPair(
  leftPresetId: string | null,
  rightPresetId: string | null,
): ComparisonStory | null {
  return COMPARISON_STORIES.find((story) =>
    (story.leftPresetId === leftPresetId && story.rightPresetId === rightPresetId)
    || (story.leftPresetId === rightPresetId && story.rightPresetId === leftPresetId)
  ) ?? null;
}

function compact(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits,
  }).format(value);
}

function meters(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000) return `${compact(absolute / 1_000)} km`;
  if (absolute >= 10) return `${absolute.toFixed(0)} m`;
  return `${absolute.toFixed(1)} m`;
}

function joules(value: number): string {
  const absolute = Math.abs(value);
  const scales: Array<[number, string]> = [
    [1e18, "EJ"],
    [1e15, "PJ"],
    [1e12, "TJ"],
    [1e9, "GJ"],
  ];
  const [scale, unit] = scales.find(([candidate]) => absolute >= candidate) ?? [1, "J"];
  const scaled = absolute / scale;
  return `${scaled.toFixed(scaled >= 10 ? 0 : 1).replace(/\.0$/, "")} ${unit}`;
}

function ratio(left: number, right: number): string {
  const smaller = Math.min(Math.abs(left), Math.abs(right));
  const larger = Math.max(Math.abs(left), Math.abs(right));
  if (smaller <= 0 || !Number.isFinite(larger / smaller)) return "not ratio-comparable";
  const multiple = larger / smaller;
  if (multiple < 1.05) return "within 5%";
  return `${multiple >= 100 ? compact(multiple, 0) : multiple.toFixed(multiple >= 10 ? 0 : 1)}× larger in ${Math.abs(left) >= Math.abs(right) ? "Slot A" : "Slot B"}`;
}

export type ComparisonMetric = Readonly<{
  label: string;
  slotA: string;
  slotB: string;
  difference: string;
}>;

export function buildComparisonMetrics(
  left: InitialDisplacement | null,
  right: InitialDisplacement | null,
): ComparisonMetric[] {
  if (!left || !right) return [];
  const metrics: ComparisonMetric[] = [
    {
      label: "Peak source amplitude",
      slotA: meters(left.peak_amplitude_m),
      slotB: meters(right.peak_amplitude_m),
      difference: ratio(left.peak_amplitude_m, right.peak_amplitude_m),
    },
    {
      label: "Source energy",
      slotA: joules(left.source_energy_j),
      slotB: joules(right.source_energy_j),
      difference: ratio(left.source_energy_j, right.source_energy_j),
    },
  ];
  if (left.cavity_radius_m > 0 || right.cavity_radius_m > 0) {
    metrics.push({
      label: "Source radius",
      slotA: meters(left.cavity_radius_m),
      slotB: meters(right.cavity_radius_m),
      difference: ratio(left.cavity_radius_m, right.cavity_radius_m),
    });
  }
  return metrics;
}

export function comparisonMetricLines(metrics: readonly ComparisonMetric[]): string[] {
  return metrics.map((metric) =>
    `${metric.label}: A ${metric.slotA}; B ${metric.slotB}; ${metric.difference}`
  );
}
