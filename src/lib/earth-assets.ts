import registryJson from "../data/earth-assets.json";

export const EARTH_STYLE_IDS = [
  "natural-earth-2",
  "osm",
  "esri-world-imagery",
  "cesium-world-imagery",
  "cesium-bathymetry",
] as const;

export type GlobeStyleId = (typeof EARTH_STYLE_IDS)[number];
export type EarthPermissionOperation =
  | "interactive_render"
  | "transient_http_cache"
  | "prefetch"
  | "offline_package"
  | "raw_redistribution"
  | "static_capture"
  | "video_capture"
  | "derived_data"
  | "commercial_use";
export type EarthPermissionDecision = "allowed" | "prohibited" | "unknown";
export type EarthAssetHealth = "idle" | "loading" | "ready" | "degraded" | "failed";

export type EarthPermission = {
  decision: EarthPermissionDecision;
  conditions: string[];
  source_url: string;
  reviewed_at: string;
};

export type EarthProvider = {
  id: string;
  name: string;
  homepage_url: string;
  terms_url: string;
  license_url: string;
  endpoint_origins: string[];
  auth_mode: "none" | "user-token" | "bundled";
  attribution_mode: "static" | "dynamic" | "both";
  policy_checked_at: string;
  policy_review_by: string;
  capabilities: {
    online: boolean;
    offline: boolean;
    dynamic_credits: boolean;
    version_reporting: boolean;
  };
};

export type EarthAsset = {
  id: string;
  provider_id: string;
  kind: string;
  role: string;
  delivery: "bundled" | "network" | "generated";
  source_urls: string[];
  runtime_locator: string;
  version: { upstream: string | null; package: string | null; provider_asset_id: string | null };
  license: {
    identifier: string;
    name: string;
    url: string;
    attribution_text: string;
    notice_paths: string[];
  };
  spatial: { bounds: number[]; horizontal_crs: string; vertical_datum: string };
  temporal: {
    content_timestamp: string | null;
    retrieved_at: string | null;
    observed_at: string | null;
    status: "static" | "mutable" | "generated";
  };
  resolution: {
    kind: string;
    value: number | null;
    min: number | null;
    max: number | null;
    unit: string;
    tile_size_px: number | null;
    notes: string;
  };
  integrity: { algorithm: "sha256" | "sha512-sri" | "provider-asset-id" | "mutable-service"; digest: string; scope: string; target: string | null };
  permission_profile_id: string;
  quality_tiers: Array<"Low" | "Medium" | "High" | "Cinematic">;
  fallback_asset_id: string | null;
  scientific: { confidence: string; transformations: string[]; limitations: string[] };
};

export type EarthStyleBinding = {
  id: GlobeStyleId;
  label: string;
  description: string;
  requires_token: boolean;
  imagery_asset_id: string;
  terrain_asset_id: string;
};

type EarthAssetRegistry = {
  schema_version: number;
  registry_version: string;
  generated_at: string;
  providers: EarthProvider[];
  permission_profiles: Array<{
    id: string;
    permissions: Record<EarthPermissionOperation, EarthPermission>;
  }>;
  assets: EarthAsset[];
  style_bindings: EarthStyleBinding[];
  category_inventory: Record<"terrain" | "imagery" | "buildings" | "ocean" | "clouds" | "vfx", string[]>;
};

const registry = registryJson as unknown as EarthAssetRegistry;

export const EARTH_ASSET_REGISTRY_VERSION = registry.registry_version;
export const EARTH_ASSET_SCHEMA_VERSION = registry.schema_version;
export const EARTH_ASSET_GENERATED_AT = registry.generated_at;
export const EARTH_STYLE_BINDINGS = registry.style_bindings as readonly EarthStyleBinding[];

export function isGlobeStyleId(value: unknown): value is GlobeStyleId {
  return typeof value === "string" && (EARTH_STYLE_IDS as readonly string[]).includes(value);
}

export function getEarthAsset(id: string): EarthAsset {
  const asset = registry.assets.find((candidate) => candidate.id === id);
  if (!asset) throw new Error(`Earth asset "${id}" is not registered.`);
  return asset;
}

export function getEarthProvider(id: string): EarthProvider {
  const provider = registry.providers.find((candidate) => candidate.id === id);
  if (!provider) throw new Error(`Earth provider "${id}" is not registered.`);
  return provider;
}

export function getEarthStyleBinding(id: GlobeStyleId | string): EarthStyleBinding {
  const binding = registry.style_bindings.find((candidate) => candidate.id === id);
  if (!binding) throw new Error(`Globe style "${id}" is not registered.`);
  return binding;
}

export function getEarthAssetPermission(
  assetId: string,
  operation: EarthPermissionOperation,
): EarthPermission {
  const asset = getEarthAsset(assetId);
  const profile = registry.permission_profiles.find(
    (candidate) => candidate.id === asset.permission_profile_id,
  );
  const permission = profile?.permissions[operation];
  if (!permission) {
    return {
      decision: "unknown",
      conditions: ["No reviewed permission decision is registered."],
      source_url: getEarthProvider(asset.provider_id).terms_url,
      reviewed_at: "unreviewed",
    };
  }
  return permission;
}

export function assertEarthAssetOperationAllowed(
  assetId: string,
  operation: EarthPermissionOperation,
): EarthPermission {
  const permission = getEarthAssetPermission(assetId, operation);
  if (permission.decision !== "allowed") {
    throw new Error(
      `Earth asset "${assetId}" cannot perform ${operation}: ${permission.decision}. ` +
        permission.conditions.join(" "),
    );
  }
  return permission;
}

export type EarthSessionSnapshot = {
  registryVersion: string;
  requestedStyle: GlobeStyleId;
  resolvedStyle: GlobeStyleId;
  imageryAssetId: string;
  terrainAssetId: string;
  providerIds: string[];
  assetVersions: Record<string, string>;
  attributions: string[];
  dynamicAttributions: string[];
  fallbackReason: "offline" | "missing-token" | "provider-error" | null;
  health: EarthAssetHealth;
  updatedAt: string;
};

function buildSession(
  requestedStyle: GlobeStyleId,
  resolvedStyle: GlobeStyleId,
  fallbackReason: EarthSessionSnapshot["fallbackReason"],
  health: EarthAssetHealth,
  dynamicAttributions: string[] = [],
): EarthSessionSnapshot {
  const binding = getEarthStyleBinding(resolvedStyle);
  const assets = [getEarthAsset(binding.imagery_asset_id), getEarthAsset(binding.terrain_asset_id)];
  return {
    registryVersion: registry.registry_version,
    requestedStyle,
    resolvedStyle,
    imageryAssetId: binding.imagery_asset_id,
    terrainAssetId: binding.terrain_asset_id,
    providerIds: [...new Set(assets.map((asset) => asset.provider_id))],
    assetVersions: Object.fromEntries(
      assets.map((asset) => [
        asset.id,
        asset.version.provider_asset_id ?? asset.version.upstream ?? asset.version.package ?? "mutable",
      ]),
    ),
    attributions: [...new Set(assets.map((asset) => asset.license.attribution_text))],
    dynamicAttributions: [...new Set(dynamicAttributions.map((text) => text.trim()).filter(Boolean))],
    fallbackReason,
    health,
    updatedAt: new Date().toISOString(),
  };
}

let activeSession = buildSession("esri-world-imagery", "natural-earth-2", "offline", "idle");
const listeners = new Set<(snapshot: EarthSessionSnapshot) => void>();

export function publishEarthSession(input: {
  requestedStyle: GlobeStyleId;
  resolvedStyle: GlobeStyleId;
  fallbackReason: EarthSessionSnapshot["fallbackReason"];
  health: EarthAssetHealth;
  dynamicAttributions?: string[];
}): EarthSessionSnapshot {
  activeSession = buildSession(
    input.requestedStyle,
    input.resolvedStyle,
    input.fallbackReason,
    input.health,
    input.dynamicAttributions,
  );
  for (const listener of listeners) listener(getActiveEarthSession());
  return getActiveEarthSession();
}

export function getActiveEarthSession(): EarthSessionSnapshot {
  return structuredClone(activeSession);
}

export function subscribeEarthSession(listener: (snapshot: EarthSessionSnapshot) => void): () => void {
  listeners.add(listener);
  listener(getActiveEarthSession());
  return () => listeners.delete(listener);
}

export type EarthOperationPreflight = {
  allowed: boolean;
  operation: EarthPermissionOperation;
  reasons: string[];
  attributions: string[];
  assetIds: string[];
};

export function preflightEarthOperation(
  operation: EarthPermissionOperation,
  session = activeSession,
): EarthOperationPreflight {
  const assetIds = [session.imageryAssetId, session.terrainAssetId];
  const reasons: string[] = [];
  const attributions = new Set(session.attributions);
  for (const assetId of assetIds) {
    const asset = getEarthAsset(assetId);
    const provider = getEarthProvider(asset.provider_id);
    const permission = getEarthAssetPermission(assetId, operation);
    if (permission.decision !== "allowed") {
      reasons.push(`${asset.id}: ${operation} is ${permission.decision}. ${permission.conditions.join(" ")}`.trim());
    }
    if (
      permission.decision === "allowed" &&
      (operation === "static_capture" || operation === "video_capture") &&
      provider.capabilities.dynamic_credits &&
      session.dynamicAttributions.length === 0
    ) {
      reasons.push(`${provider.name}: live dynamic attribution has not been captured; export fails closed.`);
    }
  }
  for (const credit of session.dynamicAttributions) attributions.add(credit);
  return {
    allowed: reasons.length === 0,
    operation,
    reasons,
    attributions: [...attributions],
    assetIds,
  };
}

export function assertEarthOperationAllowed(operation: EarthPermissionOperation): EarthOperationPreflight {
  const preflight = preflightEarthOperation(operation);
  if (!preflight.allowed) throw new Error(preflight.reasons.join(" "));
  return preflight;
}

export function getEarthDiagnosticsSnapshot() {
  return {
    schemaVersion: registry.schema_version,
    registryVersion: registry.registry_version,
    generatedAt: registry.generated_at,
    active: getActiveEarthSession(),
    providers: registry.providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      authMode: provider.auth_mode,
      attributionMode: provider.attribution_mode,
      policyCheckedAt: provider.policy_checked_at,
      policyReviewBy: provider.policy_review_by,
      termsUrl: provider.terms_url,
      licenseUrl: provider.license_url,
      endpointOrigins: [...provider.endpoint_origins],
      capabilities: { ...provider.capabilities },
    })),
    assets: registry.assets.map((asset) => ({
      id: asset.id,
      providerId: asset.provider_id,
      kind: asset.kind,
      role: asset.role,
      delivery: asset.delivery,
      version: { ...asset.version },
      license: { identifier: asset.license.identifier, url: asset.license.url },
      permissionProfileId: asset.permission_profile_id,
      qualityTiers: [...asset.quality_tiers],
      fallbackAssetId: asset.fallback_asset_id,
    })),
    categoryInventory: structuredClone(registry.category_inventory),
  };
}
