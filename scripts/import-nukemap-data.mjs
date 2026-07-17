import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const legacyRoot = path.join(root, "legacy", "nukemap");
const outputRoot = path.join(root, "src", "data", "nukemap");
const checkOnly = process.argv.includes("--check");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(legacyRoot, relativePath), "utf8"));
}

function loadLegacyTables() {
  const context = vm.createContext({ Blob, console });
  context.window = context;
  context.NM = {};
  for (const relativePath of ["js/data.js", "js/zipcodes.js", "js/ww3.js"]) {
    vm.runInContext(fs.readFileSync(path.join(legacyRoot, relativePath), "utf8"), context, {
      filename: relativePath,
      timeout: 5_000,
    });
  }
  return context.NM;
}

function loadAsteroidPresets() {
  const filename = path.join(root, "legacy", "asteroid", "src", "presets", "historical.ts");
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports }, { filename, timeout: 5_000 });
  return module.exports.PRESETS;
}

function assertCoordinate(lat, lon, label) {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new Error(`Invalid coordinate for ${label}: ${lat}, ${lon}`);
  }
}

function slug(value) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function uniqueIds(items) {
  const counts = new Map();
  return items.map((item) => {
    const base = slug(item.name) || "entry";
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    return { id: count === 1 ? base : `${base}-${count}`, ...item };
  });
}

const nm = loadLegacyTables();
const legacyWeaponIds = new Map([
  ["Little Boy (Hiroshima)", "hiroshima"],
  ["Fat Man (Nagasaki)", "fatman"],
  ["W76-1 (Trident II)", "w76"],
  ["W88 (Trident II)", "w88"],
  ["B83-1 (retired)", "b83"],
  ["RS-28 Sarmat", "sarmat"],
  ["Ivy Mike", "ivymike"],
  ["Castle Bravo", "castlebravo"],
  ["Tsar Bomba (50 MT)", "tsar"],
]);
const surfaceWeapons = new Set(["Ivy Mike", "Castle Bravo"]);
const weapons = nm.WEAPONS.map((weapon) => ({
  id: legacyWeaponIds.get(weapon.name) ?? slug(weapon.name),
  name: weapon.name,
  yieldKt: weapon.yield_kt,
  country: weapon.country || null,
  year: weapon.year ? Number(weapon.year) : null,
  description: weapon.desc,
  burstType: surfaceWeapons.has(weapon.name) ? "surface" : "airburst",
}));

const cities = nm.CITIES.map(([name, state, lat, lon, population, zipCodes]) => {
  assertCoordinate(lat, lon, name);
  return {
    id: `${slug(name)}-${state.toLowerCase()}`,
    name,
    state,
    lat,
    lon,
    population,
    zipCodes: zipCodes ? zipCodes.split(",").map((zip) => zip.trim()) : [],
  };
});

const zipCodes = {};
for (const [zip, packed] of Object.entries(nm.ZIPDB)) {
  const [latText, lonText, city, state] = packed.split(",");
  const lat = Number(latText);
  const lon = Number(lonText);
  assertCoordinate(lat, lon, zip);
  if (!/^\d{5}$/.test(zip) || !city || !state) throw new Error(`Invalid ZIP record: ${zip}`);
  zipCodes[zip] = [lat, lon, city, state];
}

const targets = [];
const addTarget = (raw, region, category, sourceFile) => {
  const description = raw.description ?? raw.desc ?? "";
  assertCoordinate(raw.lat, raw.lng, raw.name);
  targets.push({
    name: raw.name,
    lat: raw.lat,
    lon: raw.lng,
    category: raw.type ?? raw.category ?? category.replaceAll("_", " "),
    region,
    country: raw.country ?? null,
    population: Number.isFinite(raw.pop_m) ? Math.round(raw.pop_m * 1_000_000) : null,
    description,
    sourceFile,
  });
};

const globalTargets = readJson("data/targets.json");
for (const [region, groups] of Object.entries({ nato_europe: globalTargets.nato_europe, china: globalTargets.china })) {
  for (const [category, entries] of Object.entries(groups)) {
    for (const entry of entries) addTarget(entry, region, category, "targets.json");
  }
}
const usTargets = readJson("data/us_targets.json");
for (const group of usTargets.targets) {
  for (const entry of group.targets) addTarget(entry, "united_states", group.category, "us_targets.json");
}
const russiaTargets = readJson("data/russia_targets.json");
for (const entry of russiaTargets.targets) addTarget(entry, "russia", entry.category, "russia_targets.json");

const normalizedTargets = uniqueIds(targets);
if (weapons.length !== 39 || cities.length !== 246 || Object.keys(zipCodes).length !== 41_958 || normalizedTargets.length !== 459) {
  throw new Error(
    `Unexpected import counts: ${weapons.length} weapons, ${cities.length} cities, ` +
      `${Object.keys(zipCodes).length} ZIPs, ${normalizedTargets.length} targets`,
  );
}

function nearestCityDensity(lat, lon) {
  const radians = Math.PI / 180;
  let nearest = null;
  let nearestKm = Number.POSITIVE_INFINITY;
  for (const city of cities) {
    const dLat = (city.lat - lat) * radians;
    const dLon = (city.lon - lon) * radians;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(lat * radians) * Math.cos(city.lat * radians) * Math.sin(dLon / 2) ** 2;
    const distance = 6_371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    if (distance < nearestKm) {
      nearest = city;
      nearestKm = distance;
    }
  }
  const population = nearest?.population ?? 0;
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

function cameraFor(center, scaleM) {
  return {
    lat: Number(Math.max(-89, Math.min(89, center.lat - 0.4)).toFixed(6)),
    lon: Number((center.lon + 0.6 > 180 ? center.lon - 0.6 : center.lon + 0.6).toFixed(6)),
    altitudeM: Math.max(180_000, Math.min(6_000_000, scaleM)),
    headingDeg: 300,
    pitchDeg: -38,
  };
}

const nuclearScenarios = nm.HISTORICAL.map((event) => {
  const center = { lat: event.lat, lon: event.lng };
  const isHemp = event.name === "Starfish Prime";
  const isSedanProxy = event.name === "Sedan (cratering)";
  const burstType = isHemp ? "hemp" : event.burst;
  return {
    id: `historical:nuclear:${slug(event.name)}`,
    domain: "nuclear",
    classification: "recorded",
    name: event.name,
    date: event.year,
    blurb: event.desc,
    detail: `${event.yield_kt.toLocaleString("en-US")} kt · ${isHemp ? "high-altitude EMP" : `${event.burst} model`}${isSedanProxy ? " proxy" : ""}`,
    reference: event.source,
    confidence: "Historical source inputs",
    durationS: event.burst === "surface" ? 600 : 30,
    expectedHighlights: isHemp
      ? ["High-altitude burst", "EMP footprint", "Historical context"]
      : ["Fireball", "Blast and thermal rings", event.burst === "surface" ? "Fallout screening" : "Effect timeline"],
    center,
    camera: cameraFor(center, isHemp ? 6_000_000 : Math.max(180_000, event.yield_kt ** (1 / 3) * 45_000)),
    nuclear: {
      yieldKt: event.yield_kt,
      burstType,
      heightM: isHemp ? 400_000 : event.height || undefined,
      fissionPct: 50,
      populationDensity: nearestCityDensity(center.lat, center.lon),
    },
    historicalContext: event.context,
    physicsContext: event.physics,
    limitations: [
      "Historical source inputs are reconstructed with Cataclysm's current Rust direct-hazard model; effect rings are not observed measurements.",
      ...(isSedanProxy ? ["The underground Sedan test is represented by NukeMap's legacy surface-burst screening proxy."] : []),
      ...(isHemp ? ["The EMP radius is an educational line-of-sight screening footprint, not a grid-specific vulnerability forecast."] : []),
    ],
  };
});

const asteroidLocations = {
  Chelyabinsk: { lat: 54.8, lon: 61.1, referenceUrl: "https://cneos.jpl.nasa.gov/fireballs/" },
  Tunguska: { lat: 60.886, lon: 101.894, referenceUrl: "https://cneos.jpl.nasa.gov/fireballs/" },
  "Meteor Crater": { lat: 35.033, lon: -111.017, referenceUrl: "https://pubs.usgs.gov/circ/1300/pdf/Cir1300_508.pdf" },
  "Ries Crater": { lat: 48.883, lon: 10.617, referenceUrl: "https://www.lpi.usra.edu/science/kring/epo_web/impact_cratering/World_Craters_web/europecraters/Ries.html" },
  "Chesapeake Bay": { lat: 37.283, lon: -76.017, referenceUrl: "https://www.usgs.gov/centers/virginia-and-west-virginia-water-science-center/chesapeake-bay-impact-crater" },
  Chicxulub: { lat: 21.312, lon: -89.431, referenceUrl: "https://impact.uwo.ca/impact-craters/map/?crater_id=26" },
};
const asteroidScenarios = loadAsteroidPresets().map((preset) => {
  const location = asteroidLocations[preset.name];
  if (!location) throw new Error(`Missing historical center for ${preset.name}`);
  const center = { lat: location.lat, lon: location.lon };
  const expected = [preset.expectedCrater, preset.expectedEnergy].filter(Boolean).join(" · ");
  return {
    id: `historical:asteroid:${slug(preset.name)}`,
    domain: "asteroid",
    classification: "recorded",
    name: preset.name,
    date: preset.year,
    blurb: preset.description,
    detail: `${preset.params.diameter.toLocaleString("en-US")} m body · ${(preset.params.velocity / 1_000).toFixed(1)} km/s${expected ? ` · ${expected}` : ""}`,
    reference: "AsteroidSimulator historical preset",
    referenceUrl: location.referenceUrl,
    confidence: "Historical source inputs",
    durationS: preset.params.diameter < 100 ? 30 : 120,
    expectedHighlights: ["Atmospheric entry", "Impact or airburst", "Blast and thermal rings"],
    center,
    camera: cameraFor(center, Math.max(220_000, preset.params.diameter * 450)),
    asteroid: {
      diameterM: preset.params.diameter,
      densityKgM3: preset.params.density,
      velocityKmS: preset.params.velocity / 1_000,
      angleDeg: preset.params.angle,
      targetType: preset.params.targetType,
      waterDepthM: preset.params.waterDepth,
      beachSlopeRad: preset.params.beachSlope,
    },
    historicalContext: preset.description,
    physicsContext: expected || "Legacy projectile parameters",
    limitations: [
      "Projectile parameters come from the preserved AsteroidSimulator preset; Cataclysm's Rust model reconstructs effects rather than reproducing observed outcomes.",
      "The geographic center is a catalog location added for unified-globe placement because the legacy preset stored no coordinate.",
    ],
  };
});

const historicalScenarios = [...nuclearScenarios, ...asteroidScenarios];
if (historicalScenarios.length !== 16) throw new Error(`Expected 16 historical scenarios, found ${historicalScenarios.length}`);

const ww3TargetSources = {
  us: nm.WW3_TARGETS_US,
  ru: nm.WW3_TARGETS_RU,
  nato: nm.WW3_TARGETS_NATO,
  cn: nm.WW3_TARGETS_CN,
};
const ww3Targets = Object.fromEntries(Object.entries(ww3TargetSources).map(([side, entries]) => [
  side,
  uniqueIds(entries.map((target) => {
    assertCoordinate(target.lat, target.lng, target.name);
    if (!Number.isInteger(target.warheads) || target.warheads < 0 || !Number.isFinite(target.yieldKt)) {
      throw new Error(`Invalid WW3 target payload for ${target.name}`);
    }
    return {
      name: target.name,
      lat: target.lat,
      lon: target.lng,
      type: target.type,
      warheads: target.warheads,
      yieldKt: target.yieldKt,
      description: target.cat,
    };
  })).map(({ id, ...target }) => ({ id: `${side}:${id}`, ...target })),
]));
const ww3Launchers = Object.fromEntries(Object.entries(nm.WW3_LAUNCHERS).map(([id, entries]) => [
  id,
  entries.map((launcher, index) => {
    assertCoordinate(launcher.lat, launcher.lng, launcher.name);
    return { id: `${id}:${index + 1}`, name: launcher.name, lat: launcher.lat, lon: launcher.lng };
  }),
]));

function classifyWw3Phase(filter) {
  const includes = Object.fromEntries(["icbm", "infra", "city"].map((type) => [type, Boolean(filter({ type }))]));
  if (includes.icbm && !includes.infra && !includes.city) return "counterforce";
  if (includes.icbm && includes.infra && !includes.city) return "noncity";
  if (!includes.icbm && includes.infra && includes.city) return "countervalue";
  if (!includes.icbm && !includes.infra && includes.city) return "city";
  if (includes.icbm && includes.infra && includes.city) return "all";
  throw new Error(`Unsupported WW3 phase filter: ${JSON.stringify(includes)}`);
}

const ww3Scenarios = nm.WW3_SCENARIOS.map((scenario) => ({
  id: scenario.id,
  name: scenario.name,
  description: scenario.desc,
  phases: scenario.phases.map((phase) => ({
    name: phase.name,
    delayMs: phase.delay,
    durationMs: phase.duration,
    targetFilter: classifyWw3Phase(phase.filter),
  })),
  targetSides: Object.keys(scenario.targetSets),
  launchSets: scenario.launchSets,
  camera: { lat: scenario.zoom[0], lon: scenario.zoom[1], legacyZoom: scenario.zoom[2] },
}));
const ww3TargetCount = Object.values(ww3Targets).reduce((sum, entries) => sum + entries.length, 0);
const ww3GlobalWarheads = Object.values(ww3Targets)
  .flat()
  .reduce((sum, target) => sum + target.warheads, 0);
if (ww3TargetCount !== 427 || ww3GlobalWarheads !== 712 || ww3Scenarios.length !== 7) {
  throw new Error(
    `Unexpected WW3 import counts: ${ww3TargetCount} targets, ${ww3GlobalWarheads} global warheads, ` +
      `${ww3Scenarios.length} scenarios`,
  );
}
const ww3Exchange = { targets: ww3Targets, launchers: ww3Launchers, scenarios: ww3Scenarios };

fs.mkdirSync(outputRoot, { recursive: true });
const write = (name, source, items, compact = false) => {
  const value = { schemaVersion: 1, source, count: Object.keys(items).length, items };
  const target = path.join(outputRoot, name);
  const content = `${JSON.stringify(value, null, compact ? 0 : 2)}\n`;
  if (checkOnly) {
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== content) {
      throw new Error(`${name} is stale; run npm run generate:nukemap-data.`);
    }
  } else {
    fs.writeFileSync(target, content);
  }
};
write("weapons.json", "legacy/nukemap/js/data.js#NM.WEAPONS", weapons);
write("cities.json", "legacy/nukemap/js/data.js#NM.CITIES", cities);
write("targets.json", "legacy/nukemap/data/*.json", normalizedTargets);
write("zipcodes.json", "legacy/nukemap/js/zipcodes.js#NM.ZIPDB", zipCodes, true);
write(
  "historical-scenarios.json",
  "legacy/nukemap/js/data.js#NM.HISTORICAL + legacy/asteroid/src/presets/historical.ts",
  historicalScenarios,
);
write("ww3-exchange.json", "legacy/nukemap/js/ww3.js", ww3Exchange);

console.log(
  `${checkOnly ? "Verified" : "Imported"} ${weapons.length} weapons, ${cities.length} cities, ` +
    `${Object.keys(zipCodes).length} ZIP codes, ${normalizedTargets.length} targets, and ` +
    `${historicalScenarios.length} historical scenarios; WW3 includes ${ww3TargetCount} targets, ` +
    `${ww3GlobalWarheads} global warheads, and ${ww3Scenarios.length} scenarios.`,
);
