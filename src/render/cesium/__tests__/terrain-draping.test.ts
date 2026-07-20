import * as Cesium from "cesium";
import { describe, expect, it, vi } from "vitest";

import { CesiumDirectEffectsHost } from "../cesium-direct-effects-host";
import { CesiumStaticHazardHost } from "../cesium-static-hazard-host";
import { configurePlanet } from "../planet";

function viewerHarness(): Cesium.Viewer {
  return {
    entities: new Cesium.EntityCollection(),
    isDestroyed: () => false,
    scene: { requestRender: vi.fn() },
  } as unknown as Cesium.Viewer;
}

describe("terrain-aware analytical overlays", () => {
  it("enables terrain depth testing for mountain occlusion", () => {
    const globe = {
      enableLighting: false,
      dynamicAtmosphereLighting: false,
      dynamicAtmosphereLightingFromSun: false,
      depthTestAgainstTerrain: false,
    };
    const scene = {
      globe,
      highDynamicRange: false,
      skyAtmosphere: { show: false },
      fog: { enabled: false },
    };
    configurePlanet({ scene } as unknown as Cesium.Viewer);
    expect(globe.depthTestAgainstTerrain).toBe(true);
  });

  it("drapes direct-effect and static hazard footprints on terrain", () => {
    const viewer = viewerHarness();
    const direct = new CesiumDirectEffectsHost(viewer).createEllipse("blast", {
      centerEcefM: [6_378_137, 0, 0],
      semiMajorM: 10_000,
      semiMinorM: 10_000,
    });
    const staticRing = new CesiumStaticHazardHost(viewer).createEntity("ring", {
      kind: "hazard_ring",
      key: "ring",
      name: "Blast",
      description: "Screening footprint",
      position: { lat_deg: 35, lon_deg: 139, height_m: 0 },
      semi_major_axis_m: 20_000,
      semi_minor_axis_m: 20_000,
      fill_css: "#f38ba8",
      fill_alpha: 0.2,
      outline_css: "#f38ba8",
      outline_alpha: 0.9,
      outline_width_px: 2,
      z_order: 0,
    });

    for (const entity of [direct, staticRing]) {
      expect(entity.ellipse?.heightReference).toBeUndefined();
      expect(entity.ellipse?.classificationType?.getValue()).toBe(Cesium.ClassificationType.TERRAIN);
      expect(entity.ellipse?.height).toBeUndefined();
      expect(entity.ellipse?.outline?.getValue()).toBe(false);
      expect(entity.polyline?.clampToGround?.getValue()).toBe(true);
    }
    const oceanWave = new CesiumDirectEffectsHost(viewer).createEllipse("wave_0_radius", {
      centerEcefM: [6_378_137, 0, 0],
      semiMajorM: 100_000,
      semiMinorM: 100_000,
    });
    expect(oceanWave.ellipse?.height?.getValue()).toBe(0);
    expect(oceanWave.ellipse?.heightReference).toBeUndefined();
  });
});
