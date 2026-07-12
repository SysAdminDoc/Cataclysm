import type { AsteroidInput, NuclearInput } from "../hazards";
import referenceScenes from "../data/reference-scenes.json";

export type DirectScenarioTemplate = {
  id: string;
  domain: "asteroid" | "nuclear";
  name: string;
  date: string;
  blurb: string;
  detail: string;
  reference: string;
  confidence: "Reference fixture" | "Modelled what-if";
  durationS: number;
  expectedHighlights: string[];
  center: { lat: number; lon: number };
  camera: {
    lat: number;
    lon: number;
    altitudeM: number;
    headingDeg: number;
    pitchDeg: number;
  };
  asteroid?: AsteroidInput;
  nuclear?: NuclearInput;
};

type DirectScenarioMetadata = Omit<
  DirectScenarioTemplate,
  "domain" | "reference" | "center" | "camera" | "asteroid" | "nuclear"
> & { sceneId: string };

const DIRECT_SCENARIO_METADATA: readonly DirectScenarioMetadata[] = [
  { id: "direct:asteroid-entry", sceneId: "asteroid-entry", name: "Atmospheric asteroid entry", date: "What-if", blurb: "A shallow atmospheric entry over the central United States.", detail: "19 m body · 19 km/s · 18° entry", confidence: "Reference fixture", durationS: 20, expectedHighlights: ["Atmospheric entry", "Breakup altitude", "Airburst footprint"] },
  { id: "direct:asteroid-tokyo", sceneId: "asteroid-land-impact", name: "Tokyo asteroid impact", date: "What-if", blurb: "A stony asteroid impact used by the deterministic land-impact scene.", detail: "300 m body · 20 km/s · land target", confidence: "Reference fixture", durationS: 90, expectedHighlights: ["Entry and impact", "Crater formation", "Thermal and blast rings"] },
  { id: "direct:asteroid-pacific", sceneId: "asteroid-ocean-impact", name: "Pacific asteroid impact", date: "What-if", blurb: "An ocean impact over a 4 km water column in the central Pacific.", detail: "500 m body · 20 km/s · ocean target", confidence: "Reference fixture", durationS: 180, expectedHighlights: ["Ocean impact", "Transient cavity", "Initial wave estimate"] },
  { id: "direct:nuclear-tokyo", sceneId: "nuclear-airburst", name: "Tokyo 100 kt airburst", date: "What-if", blurb: "An airburst used by the deterministic nuclear-airburst scene.", detail: "100 kt · airburst · urban target", confidence: "Reference fixture", durationS: 30, expectedHighlights: ["Fireball", "Blast and thermal rings", "Effect timeline"] },
  { id: "direct:nuclear-new-york", sceneId: "nuclear-surface-burst", name: "New York 100 kt surface burst", date: "What-if", blurb: "A surface burst used by the deterministic fallout scene.", detail: "100 kt · surface burst · fallout enabled", confidence: "Reference fixture", durationS: 600, expectedHighlights: ["Surface fireball", "Blast rings", "Wind-driven fallout"] },
];

type ReferenceDirectScene = {
  id: string;
  camera: { lat: number; lon: number; altitudeM: number; headingDeg: number; pitchDeg: number };
  workflow:
    | { kind: "direct-asteroid"; request: { center: { lat: number; lon: number }; diameter_m: number; density_kg_m3: number; velocity_km_s: number; angle_deg: number; target_type: AsteroidInput["targetType"]; water_depth_m: number; beach_slope_rad: number } }
    | { kind: "direct-nuclear"; request: { center: { lat: number; lon: number }; yield_kt: number; burst_type: NuclearInput["burstType"]; height_m: number | null; fission_pct: number; population_density: number } };
};

function buildDirectScenario(metadata: DirectScenarioMetadata): DirectScenarioTemplate {
  const { sceneId, ...productMetadata } = metadata;
  const scene = (referenceScenes.scenes as unknown as ReferenceDirectScene[])
    .find((candidate) => candidate.id === sceneId);
  if (!scene || (scene.workflow.kind !== "direct-asteroid" && scene.workflow.kind !== "direct-nuclear")) {
    throw new Error(`Direct scenario ${metadata.id} references an invalid capture scene: ${sceneId}`);
  }
  const base = {
    ...productMetadata,
    domain: scene.workflow.kind === "direct-asteroid" ? "asteroid" as const : "nuclear" as const,
    reference: `Reference scene ${scene.id} · direct-hazard model 1.0.0`,
    center: { ...scene.workflow.request.center },
    camera: { ...scene.camera },
  };
  if (scene.workflow.kind === "direct-asteroid") {
    const request = scene.workflow.request;
    return {
      ...base,
      domain: "asteroid",
      asteroid: {
        diameterM: request.diameter_m,
        densityKgM3: request.density_kg_m3,
        velocityKmS: request.velocity_km_s,
        angleDeg: request.angle_deg,
        targetType: request.target_type,
        waterDepthM: request.water_depth_m,
        beachSlopeRad: request.beach_slope_rad,
      },
    };
  }
  const request = scene.workflow.request;
  return {
    ...base,
    domain: "nuclear",
    nuclear: {
      yieldKt: request.yield_kt,
      burstType: request.burst_type,
      heightM: request.height_m ?? undefined,
      fissionPct: request.fission_pct,
      populationDensity: request.population_density,
    },
  };
}

// Product metadata is overlaid on the exact source inputs and cameras already
// locked by the deterministic reference contract; those values have one owner.
export const DIRECT_SCENARIOS: readonly DirectScenarioTemplate[] = DIRECT_SCENARIO_METADATA.map(buildDirectScenario);

export type ScenarioLibraryPreferences = {
  recentIds: string[];
  favoriteIds: string[];
};

const STORAGE_KEY = "tsunamisim.scenario_library_preferences";
const MAX_RECENT = 8;

function cleanIds(value: unknown, limit = 100): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))].slice(0, limit);
}

export function loadScenarioLibraryPreferences(): ScenarioLibraryPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { recentIds: [], favoriteIds: [] };
    const parsed = JSON.parse(raw) as Partial<ScenarioLibraryPreferences>;
    return {
      recentIds: cleanIds(parsed.recentIds, MAX_RECENT),
      favoriteIds: cleanIds(parsed.favoriteIds),
    };
  } catch {
    return { recentIds: [], favoriteIds: [] };
  }
}

export function saveScenarioLibraryPreferences(preferences: ScenarioLibraryPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      recentIds: cleanIds(preferences.recentIds, MAX_RECENT),
      favoriteIds: cleanIds(preferences.favoriteIds),
    }));
  } catch {
    // The library remains usable when WebView storage is unavailable.
  }
}

export function recordRecentScenario(preferences: ScenarioLibraryPreferences, id: string): ScenarioLibraryPreferences {
  return {
    ...preferences,
    recentIds: [id, ...preferences.recentIds.filter((candidate) => candidate !== id)].slice(0, MAX_RECENT),
  };
}

export function toggleFavoriteScenario(preferences: ScenarioLibraryPreferences, id: string): ScenarioLibraryPreferences {
  const favoriteIds = preferences.favoriteIds.includes(id)
    ? preferences.favoriteIds.filter((candidate) => candidate !== id)
    : [id, ...preferences.favoriteIds];
  return { ...preferences, favoriteIds };
}
