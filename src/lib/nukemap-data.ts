import citiesJson from "../data/nukemap/cities.json";
import targetsJson from "../data/nukemap/targets.json";
import type {
  NukemapCity,
  NukemapDataFile,
  NukemapLocationResult,
  NukemapTarget,
  NukemapZipRecord,
  PopulationDensityEstimate,
} from "../types/nukemap-data";

const citiesFile = citiesJson as NukemapDataFile<NukemapCity[]>;
const targetsFile = targetsJson as NukemapDataFile<NukemapTarget[]>;

function assertArrayFile<T>(file: NukemapDataFile<T[]>, expectedCount: number, label: string): readonly T[] {
  if (file.schemaVersion !== 1 || file.count !== expectedCount || file.items.length !== expectedCount) {
    throw new Error(`Bundled NukeMap ${label} data failed its count or schema check.`);
  }
  return file.items;
}

export const NUKEMAP_CITIES = assertArrayFile(citiesFile, 246, "city");
export const NUKEMAP_TARGETS = assertArrayFile(targetsFile, 459, "target");

let zipPromise: Promise<Readonly<Record<string, NukemapZipRecord>>> | null = null;

async function loadZipCodes(): Promise<Readonly<Record<string, NukemapZipRecord>>> {
  zipPromise ??= import("../data/nukemap/zipcodes.json").then(({ default: raw }) => {
    const file = raw as unknown as NukemapDataFile<Record<string, NukemapZipRecord>>;
    if (file.schemaVersion !== 1 || file.count !== 41_958 || Object.keys(file.items).length !== 41_958) {
      throw new Error("Bundled NukeMap ZIP data failed its count or schema check.");
    }
    return file.items;
  });
  return zipPromise;
}

function distanceKm(latA: number, lonA: number, latB: number, lonB: number): number {
  const radians = Math.PI / 180;
  const dLat = (latB - latA) * radians;
  const dLon = (lonB - lonA) * radians;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(latA * radians) * Math.cos(latB * radians) * Math.sin(dLon / 2) ** 2;
  return 6_371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Preserves NukeMap's population/distance bands over the normalized real-city table. */
export function estimatePopulationDensity(lat: number, lon: number): PopulationDensityEstimate {
  let nearest: NukemapCity | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const city of NUKEMAP_CITIES) {
    const distance = distanceKm(lat, lon, city.lat, city.lon);
    if (distance < nearestDistance) {
      nearest = city;
      nearestDistance = distance;
    }
  }

  let peoplePerKm2 = 40;
  const population = nearest?.population ?? 0;
  if (nearest) {
    if (nearestDistance < 3 && population > 1_000_000) peoplePerKm2 = 15_000;
    else if (nearestDistance < 5 && population > 500_000) peoplePerKm2 = 10_000;
    else if (nearestDistance < 10 && population > 500_000) peoplePerKm2 = 5_000;
    else if (nearestDistance < 15 && population > 100_000) peoplePerKm2 = 3_000;
    else if (nearestDistance < 25 && population > 100_000) peoplePerKm2 = 1_500;
    else if (nearestDistance < 40 && population > 50_000) peoplePerKm2 = 500;
    else if (nearestDistance < 60 && population > 10_000) peoplePerKm2 = 200;
    else if (nearestDistance < 100) peoplePerKm2 = 80;
  }
  return {
    peoplePerKm2,
    nearestCity: nearest ? `${nearest.name}, ${nearest.state}` : null,
    distanceKm: nearest ? nearestDistance : null,
    population: nearest?.population ?? null,
  };
}

function coordinateResult(query: string): NukemapLocationResult | null {
  const match = query.trim().match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return {
    id: `coordinate-${lat}-${lon}`,
    kind: "coordinate",
    name: `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`,
    context: "Pasted coordinates",
    lat,
    lon,
    density: estimatePopulationDensity(lat, lon),
  };
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function textScore(query: string, name: string, suffix = ""): number {
  const label = normalized(`${name} ${suffix}`);
  const nameOnly = normalized(name);
  if (label === query) return 130;
  if (nameOnly === query) return 125;
  if (label.startsWith(query)) return 105;
  if (nameOnly.startsWith(query)) return 100;
  if (query.split(" ").every((token) => label.includes(token))) return 75;
  if (label.includes(query)) return 60;
  return 0;
}

type ScoredResult = NukemapLocationResult & { score: number };

/** Searches only packaged data. Queries never leave the device. */
export async function searchNukemapLocations(query: string, limit = 8): Promise<NukemapLocationResult[]> {
  const coordinate = coordinateResult(query);
  if (coordinate) return [coordinate];
  const search = normalized(query);
  if (search.length < 2) return [];
  const results: ScoredResult[] = [];

  for (const city of NUKEMAP_CITIES) {
    const score = textScore(search, city.name, city.state);
    if (!score) continue;
    results.push({
      id: `city-${city.id}`,
      kind: "city",
      name: `${city.name}, ${city.state}`,
      context: `${city.population.toLocaleString()} population · city table`,
      lat: city.lat,
      lon: city.lon,
      density: estimatePopulationDensity(city.lat, city.lon),
      score,
    });
  }

  for (const target of NUKEMAP_TARGETS) {
    const score = textScore(search, target.name, `${target.category} ${target.country ?? ""}`);
    if (!score) continue;
    results.push({
      id: `target-${target.id}`,
      kind: "target",
      name: target.name,
      context: `${target.category} · ${target.region.replaceAll("_", " ")}`,
      lat: target.lat,
      lon: target.lon,
      density: estimatePopulationDensity(target.lat, target.lon),
      score: score - 5,
    });
  }

  if (/^\d{2,5}$/.test(search)) {
    const zipCodes = await loadZipCodes();
    for (const [zip, [lat, lon, city, state]] of Object.entries(zipCodes)) {
      if (!zip.startsWith(search)) continue;
      results.push({
        id: `zip-${zip}`,
        kind: "zip",
        name: `${zip} · ${city}, ${state}`,
        context: "US ZIP centroid",
        lat,
        lon,
        density: estimatePopulationDensity(lat, lon),
        score: zip === search ? 150 : 90,
      });
      if (results.filter((result) => result.kind === "zip").length >= limit) break;
    }
  }

  const seen = new Set<string>();
  return results
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .filter((result) => {
      const key = `${result.kind}:${result.name}:${result.lat.toFixed(4)}:${result.lon.toFixed(4)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.max(1, Math.min(limit, 20)))
    .map(({ score: _score, ...result }) => result);
}
