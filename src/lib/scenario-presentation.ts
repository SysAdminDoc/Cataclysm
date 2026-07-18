import thumbnailManifestJson from "../data/scenario-thumbnail-manifest.json";
import type { Preset } from "../types/scenario";
import type { DirectScenarioTemplate } from "./scenario-library";

export type ScenarioPackId =
  | "start-here"
  | "asteroid-scale"
  | "nuclear-scale"
  | "ocean-disasters"
  | "fact-check"
  | "near-earth"
  | "scenario-duels";

export type ScenarioThumbnailId = "earth-global" | "earth-ocean" | "earth-limb";

export type ScenarioPresentation = {
  hazard: string;
  scale: string;
  runtime: string;
  confidence: string;
  promise: string;
  thumbnail: {
    id: ScenarioThumbnailId;
    src: string;
    limitation: string;
  };
};

export type ScenarioCatalogEntry =
  | {
    kind: "preset";
    id: string;
    preset: Preset;
    presentation: ScenarioPresentation;
  }
  | {
    kind: "direct";
    id: string;
    scenario: DirectScenarioTemplate;
    presentation: ScenarioPresentation;
  };

export const SCENARIO_PACKS: ReadonlyArray<{
  id: ScenarioPackId;
  thumbnail: ScenarioThumbnailId;
}> = [
  { id: "start-here", thumbnail: "earth-global" },
  { id: "asteroid-scale", thumbnail: "earth-limb" },
  { id: "nuclear-scale", thumbnail: "earth-global" },
  { id: "ocean-disasters", thumbnail: "earth-ocean" },
  { id: "fact-check", thumbnail: "earth-ocean" },
  { id: "near-earth", thumbnail: "earth-limb" },
  { id: "scenario-duels", thumbnail: "earth-ocean" },
];

const thumbnailManifest = thumbnailManifestJson as {
  source: { limitation: string };
  thumbnails: Array<{ id: ScenarioThumbnailId; file: string }>;
};

const thumbnailUrls = new Map(
  thumbnailManifest.thumbnails.map((thumbnail) => [
    thumbnail.id,
    `/scenario-thumbnails/${thumbnail.file}`,
  ]),
);

const START_HERE_IDS = new Set([
  "preset:tohoku_2011",
  "preset:lituya_bay_1958",
  "preset:chicxulub",
  "historical:asteroid:chelyabinsk",
  "historical:nuclear:hiroshima",
]);

const FACT_CHECK_IDS = new Set([
  "preset:poseidon_realistic",
  "preset:poseidon_propaganda",
  "preset:cumbre_vieja_scenario",
  "preset:yr4_2032_whatif",
]);

const DUEL_IDS = new Set([
  "preset:tohoku_2011",
  "preset:indian_ocean_2004",
  "preset:chicxulub",
  "preset:eltanin",
  "preset:poseidon_realistic",
  "preset:poseidon_propaganda",
]);

function compact(value: number, divisor: number, suffix: string): string {
  const scaled = value / divisor;
  return `${scaled.toLocaleString(undefined, { maximumFractionDigits: scaled >= 10 ? 0 : 1 })} ${suffix}`;
}

function presetScale(preset: Preset): string {
  switch (preset.source.kind) {
    case "Asteroid":
      return preset.source.source.diameter_m >= 1_000
        ? compact(preset.source.source.diameter_m, 1_000, "km body")
        : compact(preset.source.source.diameter_m, 1, "m body");
    case "Earthquake":
      return `M_w ${preset.source.source.mw.toFixed(1)}`;
    case "Nuclear":
      return preset.source.source.yield_kt >= 1_000
        ? compact(preset.source.source.yield_kt, 1_000, "Mt yield")
        : compact(preset.source.source.yield_kt, 1, "kt yield");
    case "Landslide":
      return compact(preset.source.source.volume_m3, 1_000_000, "Mm³ slide");
    case "Meteotsunami":
      return `${preset.source.source.peak_pressure_pa.toLocaleString()} Pa forcing`;
  }
}

function presetRuntime(preset: Preset): string {
  switch (preset.source.kind) {
    case "Asteroid": return "6 hr";
    case "Earthquake": return "60 min";
    case "Nuclear": return "60 min";
    case "Landslide": return "30 min";
    case "Meteotsunami": return "2 hr";
  }
}

function presetPromise(preset: Preset): string {
  switch (preset.source.kind) {
    case "Asteroid": return "Follow impact energy to the first coastal arrival.";
    case "Earthquake": return "Watch seafloor uplift become a basin-scale wave.";
    case "Nuclear": return "Test underwater blast energy against rapid attenuation.";
    case "Landslide": return "Follow confined displacement into extreme local runup.";
    case "Meteotsunami": return "Watch moving pressure couple with coastal water.";
  }
}

function thumbnail(id: ScenarioThumbnailId): ScenarioPresentation["thumbnail"] {
  const src = thumbnailUrls.get(id);
  if (!src) throw new Error(`Scenario thumbnail ${id} is not in the governed manifest.`);
  return { id, src, limitation: thumbnailManifest.source.limitation };
}

export function presetLibraryId(presetId: string): string {
  return `preset:${presetId}`;
}

export function presentationForPreset(preset: Preset): ScenarioPresentation {
  const thumbnailId: ScenarioThumbnailId = preset.source.kind === "Asteroid"
    ? "earth-limb"
    : preset.source.kind === "Earthquake" || preset.source.kind === "Landslide" || preset.source.kind === "Meteotsunami"
      ? "earth-ocean"
      : "earth-global";
  return {
    hazard: preset.source.kind === "Earthquake" || preset.source.kind === "Landslide" || preset.source.kind === "Meteotsunami"
      ? "Tsunami"
      : preset.source.kind,
    scale: presetScale(preset),
    runtime: presetRuntime(preset),
    confidence: preset.is_speculative ? "Modelled what-if" : "Cited reference",
    promise: presetPromise(preset),
    thumbnail: thumbnail(thumbnailId),
  };
}

export function presentationForDirectScenario(scenario: DirectScenarioTemplate): ScenarioPresentation {
  return {
    hazard: scenario.domain === "asteroid" ? "Asteroid" : "Nuclear",
    scale: scenario.detail.split(" · ")[0] ?? scenario.detail,
    runtime: scenario.durationS < 60 ? `${scenario.durationS} sec` : `${Math.round(scenario.durationS / 60)} min`,
    confidence: scenario.confidence,
    promise: scenario.expectedHighlights.join(" → "),
    thumbnail: thumbnail(scenario.domain === "asteroid" ? "earth-limb" : "earth-global"),
  };
}

export function buildScenarioCatalog(
  presets: readonly Preset[],
  directScenarios: readonly DirectScenarioTemplate[],
): ScenarioCatalogEntry[] {
  return [
    ...presets.map((preset): ScenarioCatalogEntry => ({
      kind: "preset",
      id: presetLibraryId(preset.id),
      preset,
      presentation: presentationForPreset(preset),
    })),
    ...directScenarios.map((scenario): ScenarioCatalogEntry => ({
      kind: "direct",
      id: scenario.id,
      scenario,
      presentation: presentationForDirectScenario(scenario),
    })),
  ];
}

export function scenarioMatchesPack(entry: ScenarioCatalogEntry, packId: ScenarioPackId): boolean {
  if (packId === "start-here") return START_HERE_IDS.has(entry.id);
  if (packId === "fact-check") return FACT_CHECK_IDS.has(entry.id);
  if (packId === "scenario-duels") return DUEL_IDS.has(entry.id);
  const hazard = entry.presentation.hazard;
  if (packId === "asteroid-scale") return hazard === "Asteroid";
  if (packId === "nuclear-scale") return hazard === "Nuclear";
  if (packId === "near-earth") return hazard === "Asteroid";
  if (packId === "ocean-disasters") {
    return entry.kind === "preset" || entry.id === "direct:asteroid-pacific";
  }
  return false;
}

function hasHttpCitation(entry: ScenarioCatalogEntry): boolean {
  const citation = entry.kind === "preset" ? entry.preset.reference_url : entry.scenario.referenceUrl;
  return typeof citation === "string" && /^https?:\/\//i.test(citation);
}

export function isCompleteCitedScenario(entry: ScenarioCatalogEntry): boolean {
  const source = entry.kind === "preset" ? entry.preset.reference : entry.scenario.reference;
  const { hazard, scale, runtime, confidence, promise, thumbnail: image } = entry.presentation;
  return Boolean(
    source.trim()
    && hasHttpCitation(entry)
    && hazard.trim()
    && scale.trim()
    && runtime.trim()
    && confidence.trim()
    && promise.trim()
    && image.src
    && image.limitation,
  );
}

export function deterministicSurprise(
  entries: readonly ScenarioCatalogEntry[],
  cursor: number,
): ScenarioCatalogEntry | null {
  const eligible = entries
    .filter(isCompleteCitedScenario)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (eligible.length === 0) return null;
  return eligible[Math.abs(Math.trunc(cursor)) % eligible.length] ?? null;
}
