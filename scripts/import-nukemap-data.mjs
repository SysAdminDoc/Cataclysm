import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

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
  for (const relativePath of ["js/data.js", "js/zipcodes.js"]) {
    vm.runInContext(fs.readFileSync(path.join(legacyRoot, relativePath), "utf8"), context, {
      filename: relativePath,
      timeout: 5_000,
    });
  }
  return context.NM;
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

console.log(
  `${checkOnly ? "Verified" : "Imported"} ${weapons.length} weapons, ${cities.length} cities, ` +
    `${Object.keys(zipCodes).length} ZIP codes, and ${normalizedTargets.length} targets.`,
);
