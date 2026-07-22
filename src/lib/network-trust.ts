import manifestJson from "../data/network-trust.json";

export const NETWORK_AUTHORITIES = ["webview-csp", "native-https-bridge"] as const;
export type NetworkAuthority = typeof NETWORK_AUTHORITIES[number];

export const NETWORK_PURPOSES = [
  "streamed-earth-context",
  "humanitarian-facilities",
  "official-earthquake-data",
  "near-earth-object-data",
  "historical-tsunami-data",
] as const;
export type NetworkPurpose = typeof NETWORK_PURPOSES[number];

export const NETWORK_DATA_KINDS = [
  "visible-tile-coordinates",
  "optional-cesium-token",
  "selected-hazard-bounds",
  "public-event-identifier",
  "object-search-terms",
  "historical-search-terms",
] as const;
export type NetworkDataKind = typeof NETWORK_DATA_KINDS[number];

export const NETWORK_ACTIVATIONS = [
  "selected-online-map",
  "enabled-facility-layer",
  "opened-data-browser",
  "submitted-search",
] as const;
export type NetworkActivation = typeof NETWORK_ACTIVATIONS[number];

export type NetworkDestination = {
  id: string;
  label: string;
  authority: NetworkAuthority;
  origins: readonly string[];
  earth_provider_ids: readonly string[];
  purpose: NetworkPurpose;
  sends: readonly NetworkDataKind[];
  activation: NetworkActivation;
};

export type NetworkTrustManifest = {
  schema_version: 1;
  reviewed_at: string;
  privacy: {
    telemetry_enabled: false;
    device_location_collected: false;
    device_location_transmitted: false;
    user_initiated_spatial_requests: true;
    desktop_credential_storage: "os-keychain";
    browser_credential_storage: "local-browser-storage";
    external_links_open_in_system_browser: true;
  };
  destinations: readonly NetworkDestination[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isMember<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function isHttpsOriginPattern(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("https://")) return false;
  try {
    const parsed = new URL(value.replace("://*.", "://wildcard."));
    return parsed.protocol === "https:"
      && parsed.pathname === "/"
      && !parsed.username
      && !parsed.password
      && !parsed.search
      && !parsed.hash;
  } catch {
    return false;
  }
}

export function parseNetworkTrustManifest(value: unknown): NetworkTrustManifest {
  if (!isRecord(value) || value.schema_version !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(String(value.reviewed_at))) {
    throw new Error("Network trust manifest schema or review date is invalid.");
  }
  const privacy = value.privacy;
  if (!isRecord(privacy)
    || privacy.telemetry_enabled !== false
    || privacy.device_location_collected !== false
    || privacy.device_location_transmitted !== false
    || privacy.user_initiated_spatial_requests !== true
    || privacy.desktop_credential_storage !== "os-keychain"
    || privacy.browser_credential_storage !== "local-browser-storage"
    || privacy.external_links_open_in_system_browser !== true) {
    throw new Error("Network trust privacy contract is invalid or no longer local-first.");
  }
  if (!Array.isArray(value.destinations) || value.destinations.length === 0) {
    throw new Error("Network trust manifest must declare at least one destination.");
  }

  const ids = new Set<string>();
  const destinations = value.destinations.map((candidate): NetworkDestination => {
    if (!isRecord(candidate)
      || typeof candidate.id !== "string"
      || !/^[a-z0-9-]+$/.test(candidate.id)
      || ids.has(candidate.id)
      || typeof candidate.label !== "string"
      || !candidate.label.trim()
      || !isMember(candidate.authority, NETWORK_AUTHORITIES)
      || !isMember(candidate.purpose, NETWORK_PURPOSES)
      || !isMember(candidate.activation, NETWORK_ACTIVATIONS)
      || !Array.isArray(candidate.origins)
      || candidate.origins.length === 0
      || !candidate.origins.every(isHttpsOriginPattern)
      || new Set(candidate.origins).size !== candidate.origins.length
      || !Array.isArray(candidate.earth_provider_ids)
      || !candidate.earth_provider_ids.every((entry) => typeof entry === "string" && /^[a-z0-9-]+$/.test(entry))
      || !Array.isArray(candidate.sends)
      || candidate.sends.length === 0
      || !candidate.sends.every((entry) => isMember(entry, NETWORK_DATA_KINDS))) {
      throw new Error(`Network trust destination is invalid: ${String(candidate.id ?? "unknown")}`);
    }
    ids.add(candidate.id);
    return {
      id: candidate.id,
      label: candidate.label,
      authority: candidate.authority,
      origins: candidate.origins,
      earth_provider_ids: candidate.earth_provider_ids,
      purpose: candidate.purpose,
      sends: candidate.sends,
      activation: candidate.activation,
    };
  });

  return {
    schema_version: 1,
    reviewed_at: String(value.reviewed_at),
    privacy: privacy as NetworkTrustManifest["privacy"],
    destinations,
  };
}

export const networkTrustManifest = parseNetworkTrustManifest(manifestJson);
