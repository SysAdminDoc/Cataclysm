import { describe, expect, it } from "vitest";
import manifestJson from "../../data/network-trust.json";
import { networkTrustManifest, parseNetworkTrustManifest } from "../network-trust";

describe("network trust manifest", () => {
  it("exposes an offline, local-first disclosure contract", () => {
    expect(networkTrustManifest.privacy).toMatchObject({
      telemetry_enabled: false,
      device_location_collected: false,
      device_location_transmitted: false,
      user_initiated_spatial_requests: true,
      desktop_credential_storage: "os-keychain",
    });
    expect(networkTrustManifest.destinations.map((entry) => entry.id)).toEqual([
      "cesium-ion",
      "openstreetmap-tiles",
      "openstreetmap-facilities",
      "esri-world-imagery",
      "usgs-comcat",
      "nasa-jpl",
      "noaa-ncei",
    ]);
  });

  it("refuses a manifest that weakens the no-telemetry promise", () => {
    const changed = structuredClone(manifestJson) as unknown as { privacy: { telemetry_enabled: boolean } };
    changed.privacy.telemetry_enabled = true;
    expect(() => parseNetworkTrustManifest(changed)).toThrow(/local-first/i);
  });
});
