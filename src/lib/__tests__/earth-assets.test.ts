import { beforeEach, describe, expect, it } from "vitest";
import {
  EARTH_ASSET_REGISTRY_VERSION,
  EARTH_STYLE_IDS,
  getActiveEarthSession,
  getEarthAsset,
  getEarthAssetPermission,
  getEarthDiagnosticsSnapshot,
  getEarthStyleBinding,
  preflightEarthOperation,
  publishEarthSession,
} from "../earth-assets";

describe("Earth asset registry", () => {
  beforeEach(() => {
    publishEarthSession({
      requestedStyle: "natural-earth-2",
      resolvedStyle: "natural-earth-2",
      fallbackReason: null,
      health: "ready",
      dynamicAttributions: [],
    });
  });

  it("binds every supported globe style to registered imagery and terrain", () => {
    expect(EARTH_STYLE_IDS).toEqual([
      "natural-earth-2",
      "osm",
      "esri-world-imagery",
      "cesium-world-imagery",
      "cesium-bathymetry",
    ]);
    for (const styleId of EARTH_STYLE_IDS) {
      const binding = getEarthStyleBinding(styleId);
      expect(getEarthAsset(binding.imagery_asset_id).kind).toBe("imagery");
      expect(getEarthAsset(binding.terrain_asset_id).kind).toBe("terrain");
    }
  });

  it("exposes explicit provider restrictions instead of treating online tiles as downloadable", () => {
    expect(getEarthAssetPermission("osm-standard-raster", "interactive_render").decision).toBe("allowed");
    expect(getEarthAssetPermission("osm-standard-raster", "prefetch").decision).toBe("prohibited");
    expect(getEarthAssetPermission("esri-world-imagery", "offline_package").decision).toBe("prohibited");
    expect(getEarthAssetPermission("cesium-ion-world-imagery-2", "raw_redistribution").decision).toBe("prohibited");
  });

  it("fails media export closed until a dynamic provider has live credits", () => {
    publishEarthSession({
      requestedStyle: "esri-world-imagery",
      resolvedStyle: "esri-world-imagery",
      fallbackReason: null,
      health: "ready",
      dynamicAttributions: [],
    });
    expect(preflightEarthOperation("static_capture")).toMatchObject({ allowed: false });

    publishEarthSession({
      requestedStyle: "esri-world-imagery",
      resolvedStyle: "esri-world-imagery",
      fallbackReason: null,
      health: "ready",
      dynamicAttributions: ["Esri, Maxar, Earthstar Geographics"],
    });
    expect(preflightEarthOperation("static_capture")).toMatchObject({ allowed: true });
  });

  it("records resolved fallback identity, versions, and health", () => {
    publishEarthSession({
      requestedStyle: "cesium-world-imagery",
      resolvedStyle: "natural-earth-2",
      fallbackReason: "missing-token",
      health: "degraded",
    });
    expect(getActiveEarthSession()).toMatchObject({
      registryVersion: EARTH_ASSET_REGISTRY_VERSION,
      requestedStyle: "cesium-world-imagery",
      resolvedStyle: "natural-earth-2",
      imageryAssetId: "natural-earth-ii-cesium-1.143.0",
      terrainAssetId: "cesium-wgs84-ellipsoid-26.1.0",
      fallbackReason: "missing-token",
      health: "degraded",
    });
  });

  it("produces a token-free diagnostics inventory for every active provider and asset", () => {
    const diagnostics = getEarthDiagnosticsSnapshot();
    expect(diagnostics.providers).toHaveLength(7);
    expect(diagnostics.assets).toHaveLength(13);
    expect(diagnostics.categoryInventory.buildings).toEqual([]);
    expect(diagnostics.categoryInventory.clouds).toEqual([]);
    expect(diagnostics.categoryInventory.vfx).toEqual([]);
    const serialized = JSON.stringify(diagnostics).toLowerCase();
    expect(serialized).not.toContain("cesium_token");
    expect(serialized).not.toContain("access_token");
  });
});
