import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = path.join(repoRoot, "src", "data", "earth-assets.json");
const schemaPath = path.join(repoRoot, "assets", "earth", "manifest.schema.json");
const geodesySchemaPath = path.join(repoRoot, "assets", "earth", "geodesy-contract.schema.json");
const geodesyPath = path.join(repoRoot, "src", "data", "geodesy-contract.json");
const surfaceMaskPath = path.join(repoRoot, "src", "data", "surface-mask.json");
const surfaceMaskSchemaPath = path.join(repoRoot, "assets", "earth", "surface-mask.schema.json");
const permissionOperations = [
  "interactive_render",
  "transient_http_cache",
  "prefetch",
  "offline_package",
  "raw_redistribution",
  "static_capture",
  "video_capture",
  "derived_data",
  "commercial_use",
];
const expectedStyles = [
  "natural-earth-2",
  "osm",
  "esri-world-imagery",
  "cesium-world-imagery",
  "cesium-bathymetry",
];
const expectedCategories = ["terrain", "imagery", "buildings", "ocean", "clouds", "vfx"];

function fail(message) {
  throw new Error(message);
}

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim() === "") fail(`${field} must be a non-empty string`);
}

function httpsUrl(value, field) {
  requiredString(value, field);
  if (!value.startsWith("https://")) fail(`${field} must use HTTPS`);
}

function uniqueById(items, field) {
  if (!Array.isArray(items)) fail(`${field} must be an array`);
  const ids = new Set();
  for (const [index, item] of items.entries()) {
    requiredString(item?.id, `${field}[${index}].id`);
    if (ids.has(item.id)) fail(`${field} has duplicate id "${item.id}"`);
    ids.add(item.id);
  }
  return ids;
}

function cspAllowsOrigin(origin, csp) {
  const { hostname } = new URL(origin);
  if (csp.includes(origin)) return true;
  const labels = hostname.split(".");
  for (let index = 1; index < labels.length - 1; index += 1) {
    if (csp.includes(`https://*.${labels.slice(index).join(".")}`)) return true;
  }
  return false;
}

function validatePermissionProfiles(registry) {
  const profileIds = uniqueById(registry.permission_profiles, "permission_profiles");
  for (const profile of registry.permission_profiles) {
    const permissions = profile.permissions;
    if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) {
      fail(`permission profile "${profile.id}" has no permissions object`);
    }
    for (const operation of permissionOperations) {
      const permission = permissions[operation];
      if (!permission) fail(`permission profile "${profile.id}" is missing ${operation}`);
      if (!["allowed", "prohibited", "unknown"].includes(permission.decision)) {
        fail(`permission profile "${profile.id}" has invalid ${operation} decision`);
      }
      if (!Array.isArray(permission.conditions)) {
        fail(`permission profile "${profile.id}" ${operation} conditions must be an array`);
      }
      httpsUrl(permission.source_url, `permission profile "${profile.id}" ${operation}.source_url`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(permission.reviewed_at ?? "")) {
        fail(`permission profile "${profile.id}" ${operation}.reviewed_at must be YYYY-MM-DD`);
      }
    }
    for (const operation of Object.keys(permissions)) {
      if (!permissionOperations.includes(operation)) {
        fail(`permission profile "${profile.id}" contains unknown operation "${operation}"`);
      }
    }
  }
  return profileIds;
}

function validateIntegrity(asset, packageLock, checkFiles) {
  const integrity = asset.integrity;
  if (!integrity || !["sha256", "sha512-sri", "provider-asset-id", "mutable-service"].includes(integrity.algorithm)) {
    fail(`asset "${asset.id}" has invalid integrity metadata`);
  }
  requiredString(integrity.digest, `asset "${asset.id}" integrity.digest`);
  if (!checkFiles) return;

  if (integrity.algorithm === "sha256") {
    if (!integrity.target) fail(`asset "${asset.id}" SHA-256 integrity target is missing`);
    const target = path.join(repoRoot, integrity.target);
    if (!existsSync(target)) fail(`asset "${asset.id}" integrity target is missing: ${integrity.target}`);
    const digest = createHash("sha256").update(readFileSync(target)).digest("hex");
    if (digest !== integrity.digest) fail(`asset "${asset.id}" SHA-256 mismatch for ${integrity.target}`);
  } else if (integrity.algorithm === "sha512-sri") {
    if (!integrity.target) fail(`asset "${asset.id}" package integrity target is missing`);
    const locked = packageLock.packages?.[integrity.target]?.integrity;
    if (!locked) fail(`asset "${asset.id}" package-lock entry is missing for ${integrity.target}`);
    if (locked !== integrity.digest) fail(`asset "${asset.id}" package-lock integrity mismatch`);
  } else if (integrity.algorithm === "provider-asset-id") {
    if (asset.version.provider_asset_id !== integrity.digest) {
      fail(`asset "${asset.id}" provider asset integrity does not match its version identifier`);
    }
  } else if (integrity.algorithm === "mutable-service" && integrity.target !== null) {
    fail(`asset "${asset.id}" mutable service must not claim a local integrity target`);
  }
}

function validateFallbacks(registry, assetIds) {
  for (const asset of registry.assets) {
    if (asset.fallback_asset_id !== null && !assetIds.has(asset.fallback_asset_id)) {
      fail(`asset "${asset.id}" references missing fallback "${asset.fallback_asset_id}"`);
    }
    const visited = new Set([asset.id]);
    let cursor = asset;
    while (cursor.fallback_asset_id !== null) {
      if (visited.has(cursor.fallback_asset_id)) fail(`fallback cycle starts at asset "${asset.id}"`);
      visited.add(cursor.fallback_asset_id);
      cursor = registry.assets.find((candidate) => candidate.id === cursor.fallback_asset_id);
      if (!cursor) break;
    }
  }
}

function geodeticToEcef(latDeg, lonDeg, heightM) {
  const a = 6_378_137;
  const flattening = 1 / 298.257_223_563;
  const eccentricitySq = flattening * (2 - flattening);
  const lat = latDeg * Math.PI / 180;
  const lon = lonDeg * Math.PI / 180;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const primeVertical = a / Math.sqrt(1 - eccentricitySq * sinLat * sinLat);
  return [
    (primeVertical + heightM) * cosLat * Math.cos(lon),
    (primeVertical + heightM) * cosLat * Math.sin(lon),
    (primeVertical * (1 - eccentricitySq) + heightM) * sinLat,
  ];
}

function validateGeodesyAndSurfaceContracts(assetIds) {
  JSON.parse(readFileSync(geodesySchemaPath, "utf8"));
  const geodesy = JSON.parse(readFileSync(geodesyPath, "utf8"));
  if (geodesy.schema_version !== 1 || !/^\d+\.\d+\.\d+$/.test(geodesy.contract_version ?? "")) {
    fail("geodesy contract schema/version is invalid");
  }
  if (geodesy.horizontal_crs?.geographic_2d !== "EPSG:4326" || geodesy.horizontal_crs?.ecef !== "EPSG:4978") {
    fail("geodesy contract must declare WGS84 geographic and ECEF CRS identifiers");
  }
  if (!Array.isArray(geodesy.coastal_benchmarks) || geodesy.coastal_benchmarks.length < 3) {
    fail("geodesy contract needs at least three coastal benchmarks");
  }
  const benchmarkIds = new Set();
  for (const benchmark of geodesy.coastal_benchmarks) {
    requiredString(benchmark.id, "geodesy benchmark id");
    if (benchmarkIds.has(benchmark.id)) fail(`duplicate geodesy benchmark "${benchmark.id}"`);
    benchmarkIds.add(benchmark.id);
    httpsUrl(benchmark.source_url, `geodesy benchmark "${benchmark.id}" source URL`);
    if (!new URL(benchmark.source_url).hostname.endsWith("noaa.gov")) {
      fail(`geodesy benchmark "${benchmark.id}" must cite the official NOAA endpoint`);
    }
    for (const field of ["lat_deg", "lon_deg", "orthometric_height_m", "geoid_undulation_m", "geoid_model_error_m", "ellipsoid_height_m"]) {
      if (!Number.isFinite(benchmark[field])) fail(`geodesy benchmark "${benchmark.id}" ${field} must be finite`);
    }
    if (Math.abs(benchmark.ellipsoid_height_m - (benchmark.orthometric_height_m + benchmark.geoid_undulation_m)) > geodesy.error_budget.fixture_vertical_conversion_m) {
      fail(`geodesy benchmark "${benchmark.id}" violates h = H + N`);
    }
    if (!Array.isArray(benchmark.expected_ecef_m) || benchmark.expected_ecef_m.length !== 3) {
      fail(`geodesy benchmark "${benchmark.id}" needs an ECEF triplet`);
    }
    const calculated = geodeticToEcef(benchmark.lat_deg, benchmark.lon_deg, benchmark.ellipsoid_height_m);
    calculated.forEach((value, index) => {
      if (Math.abs(value - benchmark.expected_ecef_m[index]) > geodesy.error_budget.geodetic_to_ecef_m) {
        fail(`geodesy benchmark "${benchmark.id}" ECEF fixture exceeds its error budget`);
      }
    });
  }

  JSON.parse(readFileSync(surfaceMaskSchemaPath, "utf8"));
  const surface = JSON.parse(readFileSync(surfaceMaskPath, "utf8"));
  if (surface.schema_version !== 1 || !/^\d+\.\d+\.\d+$/.test(surface.mask_version ?? "")) {
    fail("surface mask schema/version is invalid");
  }
  if (!assetIds.has(surface.source_asset_id)) fail(`surface mask source asset is missing: ${surface.source_asset_id}`);
  if (surface.horizontal_crs !== "EPSG:4326" || surface.vertical_datum !== "CATACLYSM:IDEALIZED_MSL") {
    fail("surface mask CRS/datum contract is invalid");
  }
  if (!Number.isFinite(surface.declared_horizontal_error_m) || surface.declared_horizontal_error_m <= 0) {
    fail("surface mask must declare a positive horizontal error budget");
  }
  if (JSON.stringify([...(surface.wet_classes ?? [])].sort()) !== JSON.stringify(["inland_water", "ocean"])) {
    fail("surface mask wet classes must be exactly inland_water and ocean");
  }
  const regionIds = new Set();
  const classes = new Set(["land", "ocean", "inland_water", "ice", "coast"]);
  for (const region of surface.regions ?? []) {
    requiredString(region.id, "surface region id");
    if (regionIds.has(region.id)) fail(`duplicate surface region "${region.id}"`);
    regionIds.add(region.id);
    if (!classes.has(region.surface_class)) fail(`surface region "${region.id}" has invalid class`);
    if (!Array.isArray(region.bounds) || region.bounds.length !== 4 || !region.bounds.every(Number.isFinite)) {
      fail(`surface region "${region.id}" must have finite west/south/east/north bounds`);
    }
    const [west, south, east, north] = region.bounds;
    if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) {
      fail(`surface region "${region.id}" bounds are outside EPSG:4326 or inverted`);
    }
  }
}

export function validateRegistry(registry, { checkFiles = false } = {}) {
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) fail("registry must be an object");
  if (registry.schema_version !== 1) fail("registry schema_version must be 1");
  if (!/^\d+\.\d+\.\d+$/.test(registry.registry_version ?? "")) {
    fail("registry_version must be semantic version text");
  }
  if (!Number.isFinite(Date.parse(registry.generated_at))) fail("generated_at must be an ISO timestamp");

  const providerIds = uniqueById(registry.providers, "providers");
  const profileIds = validatePermissionProfiles(registry);
  const assetIds = uniqueById(registry.assets, "assets");
  const styleIds = uniqueById(registry.style_bindings, "style_bindings");
  const packageLock = JSON.parse(readFileSync(path.join(repoRoot, "package-lock.json"), "utf8"));
  const csp = JSON.parse(readFileSync(path.join(repoRoot, "src-tauri", "tauri.conf.json"), "utf8"))
    ?.app?.security?.csp ?? "";
  const today = new Date().toISOString().slice(0, 10);

  for (const provider of registry.providers) {
    for (const field of ["homepage_url", "terms_url", "license_url"]) {
      httpsUrl(provider[field], `provider "${provider.id}".${field}`);
    }
    if (!Array.isArray(provider.endpoint_origins)) fail(`provider "${provider.id}" endpoint_origins must be an array`);
    for (const origin of provider.endpoint_origins) {
      httpsUrl(origin, `provider "${provider.id}" endpoint origin`);
      const parsed = new URL(origin);
      if (parsed.pathname !== "/") fail(`provider "${provider.id}" endpoint must be an origin without a path: ${origin}`);
      if (!cspAllowsOrigin(origin, csp)) fail(`provider "${provider.id}" origin is not allowed by desktop CSP: ${origin}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(provider.policy_checked_at ?? "")) {
      fail(`provider "${provider.id}" policy_checked_at must be YYYY-MM-DD`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(provider.policy_review_by ?? "")) {
      fail(`provider "${provider.id}" policy_review_by must be YYYY-MM-DD`);
    }
    if (provider.policy_review_by < today) fail(`provider "${provider.id}" policy review is expired`);
    if (!provider.capabilities || typeof provider.capabilities !== "object") {
      fail(`provider "${provider.id}" capabilities are missing`);
    }
  }

  for (const asset of registry.assets) {
    if (!providerIds.has(asset.provider_id)) fail(`asset "${asset.id}" references missing provider "${asset.provider_id}"`);
    if (!profileIds.has(asset.permission_profile_id)) {
      fail(`asset "${asset.id}" references missing permission profile "${asset.permission_profile_id}"`);
    }
    if (!Array.isArray(asset.source_urls) || asset.source_urls.length === 0) {
      fail(`asset "${asset.id}" must have source URLs`);
    }
    for (const sourceUrl of asset.source_urls) httpsUrl(sourceUrl, `asset "${asset.id}" source URL`);
    if (!Array.isArray(asset.spatial?.bounds) || asset.spatial.bounds.length !== 4) {
      fail(`asset "${asset.id}" must have west/south/east/north bounds`);
    }
    if (!Array.isArray(asset.quality_tiers) || asset.quality_tiers.length === 0) {
      fail(`asset "${asset.id}" must declare at least one quality tier`);
    }
    if (!asset.license || !Array.isArray(asset.license.notice_paths)) {
      fail(`asset "${asset.id}" license metadata is incomplete`);
    }
    httpsUrl(asset.license.url, `asset "${asset.id}" license URL`);
    validateIntegrity(asset, packageLock, checkFiles);
  }

  const actualStyles = [...styleIds].sort();
  const requiredStyles = [...expectedStyles].sort();
  if (JSON.stringify(actualStyles) !== JSON.stringify(requiredStyles)) {
    fail(`style bindings must contain exactly: ${expectedStyles.join(", ")}`);
  }
  for (const binding of registry.style_bindings) {
    if (!assetIds.has(binding.imagery_asset_id)) fail(`style "${binding.id}" imagery asset is missing`);
    if (!assetIds.has(binding.terrain_asset_id)) fail(`style "${binding.id}" terrain asset is missing`);
    const imagery = registry.assets.find((asset) => asset.id === binding.imagery_asset_id);
    const terrain = registry.assets.find((asset) => asset.id === binding.terrain_asset_id);
    if (imagery.kind !== "imagery") fail(`style "${binding.id}" imagery binding is not imagery`);
    if (terrain.kind !== "terrain") fail(`style "${binding.id}" terrain binding is not terrain`);
  }

  const categories = Object.keys(registry.category_inventory ?? {}).sort();
  if (JSON.stringify(categories) !== JSON.stringify([...expectedCategories].sort())) {
    fail(`category_inventory must contain exactly: ${expectedCategories.join(", ")}`);
  }
  for (const [category, ids] of Object.entries(registry.category_inventory)) {
    if (!Array.isArray(ids) || new Set(ids).size !== ids.length) fail(`category "${category}" must have unique asset IDs`);
    for (const id of ids) {
      const asset = registry.assets.find((candidate) => candidate.id === id);
      if (!asset) fail(`category "${category}" references missing asset "${id}"`);
      if (asset.kind !== category) fail(`asset "${id}" is ${asset.kind}, not category ${category}`);
    }
  }
  validateFallbacks(registry, assetIds);
  validateGeodesyAndSurfaceContracts(assetIds);
  return { providerCount: providerIds.size, assetCount: assetIds.size, styleCount: styleIds.size };
}

function selfTest(registry) {
  const brokenProvider = structuredClone(registry);
  brokenProvider.assets[0].provider_id = "missing-provider";
  let rejected = false;
  try { validateRegistry(brokenProvider); } catch { rejected = true; }
  if (!rejected) fail("self-test: missing provider was accepted");

  const brokenPermission = structuredClone(registry);
  delete brokenPermission.permission_profiles[0].permissions.static_capture;
  rejected = false;
  try { validateRegistry(brokenPermission); } catch { rejected = true; }
  if (!rejected) fail("self-test: missing permission decision was accepted");

  const brokenFallback = structuredClone(registry);
  brokenFallback.assets[0].fallback_asset_id = brokenFallback.assets[0].id;
  rejected = false;
  try { validateRegistry(brokenFallback); } catch { rejected = true; }
  if (!rejected) fail("self-test: fallback cycle was accepted");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    JSON.parse(readFileSync(schemaPath, "utf8"));
    const registry = JSON.parse(readFileSync(registryPath, "utf8"));
    const result = validateRegistry(registry, { checkFiles: true });
    selfTest(registry);
    console.log(
      `Earth asset registry ${registry.registry_version}: ${result.providerCount} providers, ` +
        `${result.assetCount} assets, ${result.styleCount} globe styles; provenance and rights gate passed.`,
    );
  } catch (error) {
    console.error(`Earth asset registry validation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
