import exchangeData from "../data/nukemap/ww3-exchange.json";
import cityData from "../data/nukemap/cities.json";

export type Ww3Side = "us" | "ru" | "nato" | "cn" | "uk" | "fr";
export type Ww3Targeting = "all" | "counterforce" | "countervalue";
export type Ww3TargetType = "icbm" | "sub" | "bomber" | "c2" | "nuclear" | "military" | "infra" | "city";
type Ww3PhaseFilter = "counterforce" | "countervalue" | "noncity" | "city" | "all";

export type Ww3Target = Readonly<{
  id: string;
  name: string;
  lat: number;
  lon: number;
  type: Ww3TargetType;
  warheads: number;
  yieldKt: number;
  description: string;
}>;

export type Ww3Launcher = Readonly<{
  id: string;
  name: string;
  lat: number;
  lon: number;
}>;

export type Ww3Scenario = Readonly<{
  id: string;
  name: string;
  description: string;
  phases: readonly Readonly<{
    name: string;
    delayMs: number;
    durationMs: number;
    targetFilter: Ww3PhaseFilter;
  }>[];
  targetSides: readonly ("us" | "ru" | "nato" | "cn")[];
  launchSets: Readonly<Partial<Record<Ww3Side, readonly string[]>>>;
  camera: Readonly<{ lat: number; lon: number; legacyZoom: number }>;
}>;

export type Ww3ArcPoint = Readonly<{ lat: number; lon: number; altitudeM: number }>;

export type Ww3Strike = Readonly<{
  id: string;
  phaseIndex: number;
  phaseName: string;
  attacker: Ww3Side;
  launcher: Ww3Launcher;
  target: Ww3Target;
  yieldKt: number;
  arc: readonly Ww3ArcPoint[];
  estimatedDeaths: number;
  estimatedInjuries: number;
  populationDensity: number;
}>;

export type Ww3ExchangePlan = Readonly<{
  id: string;
  scenario: Ww3Scenario;
  targeting: Ww3Targeting;
  strikes: readonly Ww3Strike[];
  phaseStrikeCounts: readonly number[];
  targetRecordCount: number;
  targetCount: number;
  totalYieldKt: number;
  estimatedDeaths: number;
  estimatedInjuries: number;
  limitations: readonly string[];
}>;

type ExchangePayload = {
  targets: Record<"us" | "ru" | "nato" | "cn", Ww3Target[]>;
  launchers: Record<string, Ww3Launcher[]>;
  scenarios: Ww3Scenario[];
};

const payload = exchangeData.items as ExchangePayload;
const cities = cityData.items;

export const WW3_SCENARIOS: readonly Ww3Scenario[] = payload.scenarios;
export const WW3_TARGET_COUNT = Object.values(payload.targets).reduce((sum, targets) => sum + targets.length, 0);
export const WW3_GLOBAL_WARHEAD_COUNT = Object.values(payload.targets)
  .flat()
  .reduce((sum, target) => sum + target.warheads, 0);
export const WW3_SIDE_COLORS: Readonly<Record<Ww3Side, string>> = {
  us: "#89b4fa",
  ru: "#f38ba8",
  cn: "#f9e2af",
  uk: "#a6e3a1",
  fr: "#cba6f7",
  nato: "#74c7ec",
};

export const WW3_SIDE_LABELS: Readonly<Record<Ww3Side, string>> = {
  us: "United States",
  ru: "Russia",
  cn: "China",
  uk: "United Kingdom",
  fr: "France",
  nato: "NATO Europe",
};

function hashText(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function haversineKm(latA: number, lonA: number, latB: number, lonB: number): number {
  const radians = Math.PI / 180;
  const dLat = (latB - latA) * radians;
  const dLon = (lonB - lonA) * radians;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(latA * radians) * Math.cos(latB * radians) * Math.sin(dLon / 2) ** 2;
  return 6_371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function greatCircleArc(
  start: Readonly<{ lat: number; lon: number }>,
  end: Readonly<{ lat: number; lon: number }>,
  steps = 36,
): Ww3ArcPoint[] {
  const radians = Math.PI / 180;
  const degrees = 180 / Math.PI;
  const latA = start.lat * radians;
  const lonA = start.lon * radians;
  const latB = end.lat * radians;
  const lonB = end.lon * radians;
  const angularDistance = 2 * Math.asin(Math.sqrt(
    Math.sin((latB - latA) / 2) ** 2
      + Math.cos(latA) * Math.cos(latB) * Math.sin((lonB - lonA) / 2) ** 2,
  ));
  if (angularDistance < 0.0001) {
    return [
      { lat: start.lat, lon: start.lon, altitudeM: 0 },
      { lat: end.lat, lon: end.lon, altitudeM: 0 },
    ];
  }
  const maxAltitudeM = Math.max(120_000, Math.min(1_200_000, haversineKm(start.lat, start.lon, end.lat, end.lon) * 90));
  const points: Ww3ArcPoint[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const fraction = index / steps;
    const a = Math.sin((1 - fraction) * angularDistance) / Math.sin(angularDistance);
    const b = Math.sin(fraction * angularDistance) / Math.sin(angularDistance);
    const x = a * Math.cos(latA) * Math.cos(lonA) + b * Math.cos(latB) * Math.cos(lonB);
    const y = a * Math.cos(latA) * Math.sin(lonA) + b * Math.cos(latB) * Math.sin(lonB);
    const z = a * Math.sin(latA) + b * Math.sin(latB);
    points.push({
      lat: Math.atan2(z, Math.sqrt(x * x + y * y)) * degrees,
      lon: Math.atan2(y, x) * degrees,
      altitudeM: Math.sin(fraction * Math.PI) * maxAltitudeM,
    });
  }
  return points;
}

function densityAt(lat: number, lon: number): number {
  let nearestKm = Number.POSITIVE_INFINITY;
  let population = 0;
  for (const city of cities) {
    const distance = haversineKm(lat, lon, city.lat, city.lon);
    if (distance < nearestKm) {
      nearestKm = distance;
      population = city.population;
    }
  }
  if (nearestKm < 3 && population > 1_000_000) return 15_000;
  if (nearestKm < 5 && population > 500_000) return 10_000;
  if (nearestKm < 10 && population > 500_000) return 5_000;
  if (nearestKm < 15 && population > 100_000) return 3_000;
  if (nearestKm < 25 && population > 100_000) return 1_500;
  if (nearestKm < 40 && population > 50_000) return 500;
  if (nearestKm < 60 && population > 10_000) return 200;
  if (nearestKm < 100) return 80;
  return 40;
}

type MortalityZone = Readonly<{
  radiusKm: number;
  blastDeath: number;
  thermalDeath: number;
  radiationDeath: number;
  blastInjury: number;
  thermalInjury: number;
}>;

function casualtyEstimate(yieldKt: number, density: number): { deaths: number; injuries: number } {
  const cube = yieldKt ** (1 / 3);
  const attenuation = yieldKt > 1_000 ? Math.max(0.7, 1 - (Math.log10(yieldKt) - 3) * 0.15) : 1;
  const zones: MortalityZone[] = [
    { radiusKm: 0.066 * yieldKt ** 0.4, blastDeath: 1, thermalDeath: 1, radiationDeath: 1, blastInjury: 0, thermalInjury: 0 },
    { radiusKm: 0.13 * cube, blastDeath: 0.98, thermalDeath: 0.9, radiationDeath: 0.8, blastInjury: 0.02, thermalInjury: 0.05 },
    { radiusKm: 0.28 * cube, blastDeath: 0.85, thermalDeath: 0.6, radiationDeath: 0.3, blastInjury: 0.12, thermalInjury: 0.15 },
    { radiusKm: 0.71 * cube, blastDeath: 0.4, thermalDeath: 0.3, radiationDeath: 0.05, blastInjury: 0.45, thermalInjury: 0.2 },
    { radiusKm: Math.max(0.67 * yieldKt ** 0.41 * attenuation, 0.95 * cube), blastDeath: 0.15, thermalDeath: 0.25, radiationDeath: 0.02, blastInjury: 0.35, thermalInjury: 0.3 },
    { radiusKm: 2.2 * cube, blastDeath: 0.02, thermalDeath: 0.05, radiationDeath: 0, blastInjury: 0.2, thermalInjury: 0.15 },
    { radiusKm: 1.2 * yieldKt ** 0.38 * attenuation, blastDeath: 0, thermalDeath: 0.01, radiationDeath: 0, blastInjury: 0.05, thermalInjury: 0.1 },
  ];
  const shielding = density > 5_000 ? 0.65 : density > 1_000 ? 0.75 : density > 200 ? 0.85 : 1;
  let deaths = 0;
  let injuries = 0;
  let previousAreaKm2 = 0;
  for (const zone of zones) {
    const areaKm2 = Math.PI * zone.radiusKm ** 2;
    const ringPopulation = Math.max(0, areaKm2 - previousAreaKm2) * density;
    const outdoorPopulation = ringPopulation * 0.2;
    const indoorPopulation = ringPopulation * 0.8;
    const outdoorDeath = 1 - (1 - zone.blastDeath) * (1 - zone.thermalDeath) * (1 - zone.radiationDeath);
    const outdoorInjury = Math.min(1 - outdoorDeath, zone.blastInjury + zone.thermalInjury);
    const indoorDeath = 1 - (1 - zone.blastDeath) * (1 - zone.thermalDeath * 0.4) * (1 - zone.radiationDeath * 0.4);
    const indoorInjury = Math.min(1 - indoorDeath, zone.blastInjury + zone.thermalInjury * 0.4);
    deaths += Math.round((outdoorPopulation * outdoorDeath + indoorPopulation * indoorDeath) * shielding);
    injuries += Math.round((outdoorPopulation * outdoorInjury + indoorPopulation * indoorInjury) * shielding);
    previousAreaKm2 = areaKm2;
  }
  return { deaths, injuries };
}

export function estimateWw3Casualties(
  lat: number,
  lon: number,
  yieldKt: number,
): { deaths: number; injuries: number; density: number } {
  const density = densityAt(lat, lon);
  return { ...casualtyEstimate(yieldKt, density), density };
}

function targetMatches(filter: Ww3PhaseFilter | Ww3Targeting, target: Ww3Target): boolean {
  if (filter === "all") return true;
  if (filter === "counterforce") return target.type !== "city" && target.type !== "infra";
  if (filter === "countervalue") return target.type === "city" || target.type === "infra";
  if (filter === "noncity") return target.type !== "city";
  return target.type === "city";
}

function attackersForTarget(targetSide: string, scenario: Ww3Scenario): Ww3Side[] {
  const candidates: Ww3Side[] = targetSide === "us"
    ? ["ru", "cn"]
    : targetSide === "ru"
      ? ["us", "uk", "fr"]
      : targetSide === "nato"
        ? ["ru"]
        : targetSide === "cn"
          ? ["us"]
          : Object.keys(scenario.launchSets) as Ww3Side[];
  return candidates.filter((side) => (scenario.launchSets[side]?.length ?? 0) > 0);
}

export function buildWw3ExchangePlan(scenarioId: string, targeting: Ww3Targeting = "all"): Ww3ExchangePlan {
  const scenario = WW3_SCENARIOS.find((candidate) => candidate.id === scenarioId);
  if (!scenario) throw new Error(`Unknown WW3 scenario: ${scenarioId}`);
  const strikes: Ww3Strike[] = [];
  const selectedTargetIds = new Set<string>();
  const phaseStrikeCounts: number[] = [];
  scenario.phases.forEach((phase, phaseIndex) => {
    const phaseStart = strikes.length;
    for (const targetSide of scenario.targetSides) {
      const attackers = attackersForTarget(targetSide, scenario);
      if (attackers.length === 0) continue;
      for (const target of payload.targets[targetSide]) {
        if (!targetMatches(phase.targetFilter, target) || !targetMatches(targeting, target)) continue;
        selectedTargetIds.add(target.id);
        for (let warheadIndex = 0; warheadIndex < target.warheads; warheadIndex += 1) {
          const seed = `${scenario.id}:${phaseIndex}:${target.id}:${warheadIndex}`;
          const attacker = attackers[hashText(`${seed}:attacker`) % attackers.length];
          const launcherSetIds = scenario.launchSets[attacker] ?? [];
          const launcherSetId = launcherSetIds[hashText(`${seed}:set`) % launcherSetIds.length];
          const launchers = payload.launchers[launcherSetId];
          if (!launchers?.length) throw new Error(`Missing launcher set ${launcherSetId}`);
          const launcher = launchers[hashText(`${seed}:launcher`) % launchers.length];
          const casualties = estimateWw3Casualties(target.lat, target.lon, target.yieldKt);
          strikes.push({
            id: `${scenario.id}:${phaseIndex}:${target.id}:${warheadIndex + 1}`,
            phaseIndex,
            phaseName: phase.name,
            attacker,
            launcher,
            target,
            yieldKt: target.yieldKt,
            arc: greatCircleArc(launcher, target),
            estimatedDeaths: casualties.deaths,
            estimatedInjuries: casualties.injuries,
            populationDensity: casualties.density,
          });
        }
      }
    }
    phaseStrikeCounts.push(strikes.length - phaseStart);
  });
  return {
    id: `${scenario.id}:${targeting}`,
    scenario,
    targeting,
    strikes,
    phaseStrikeCounts,
    targetRecordCount: selectedTargetIds.size,
    targetCount: new Set(strikes.map((strike) => strike.target.id)).size,
    totalYieldKt: strikes.reduce((sum, strike) => sum + strike.yieldKt, 0),
    estimatedDeaths: strikes.reduce((sum, strike) => sum + strike.estimatedDeaths, 0),
    estimatedInjuries: strikes.reduce((sum, strike) => sum + strike.estimatedInjuries, 0),
    limitations: [
      "This is a deterministic educational reconstruction of the preserved NukeMap scenario, not a prediction, operational plan, or current force assessment.",
      "Immediate casualty totals reuse the legacy screening equations and packaged US-city density heuristic; they do not include live population grids, sheltering, weather, infrastructure failure, fallout, or overlap deduplication.",
      "Missile routes are illustrative great-circle arcs. Launcher and attacker assignment is deterministic for repeatability, not an assertion about real launch doctrine.",
    ],
  };
}

export function formatWw3Number(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return Math.round(value).toLocaleString();
}
