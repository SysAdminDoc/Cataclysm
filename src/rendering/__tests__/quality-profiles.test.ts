import * as Cesium from "cesium";
import { describe, expect, it, vi } from "vitest";

import { CesiumDirectEffectsHost } from "../../render/cesium/cesium-direct-effects-host";
import { CesiumStaticHazardHost } from "../../render/cesium/cesium-static-hazard-host";
import { inspectHdrOutput } from "../quality-profiles";

function viewerHarness(supported: boolean): Cesium.Viewer {
  return {
    entities: new Cesium.EntityCollection(),
    isDestroyed: () => false,
    scene: {
      highDynamicRangeSupported: supported,
      highDynamicRange: supported,
      requestRender: vi.fn(),
    },
  } as unknown as Cesium.Viewer;
}

function materialColor(entity: Cesium.Entity): Cesium.Color {
  return (entity.ellipse?.material?.getValue(Cesium.JulianDate.now()) as { color: Cesium.Color }).color;
}

describe("HDR renderer output", () => {
  it("reports an explicit SDR fallback when the scene cannot support HDR", () => {
    expect(inspectHdrOutput(viewerHarness(false), true)).toEqual({
      requested: true,
      supported: false,
      active: false,
      mode: "sdr-fallback",
    });
    expect(inspectHdrOutput(viewerHarness(false), false)).toEqual({
      requested: false,
      supported: false,
      active: false,
      mode: "sdr",
    });
  });

  it("keeps fireball colors within SDR but emits linear HDR intensity when supported", () => {
    const sdrEntity = new CesiumDirectEffectsHost(viewerHarness(false)).createEllipse("fireball", {
      centerEcefM: [6_378_137, 0, 0],
      semiMajorM: 10_000,
      semiMinorM: 10_000,
    });
    const hdrEntity = new CesiumDirectEffectsHost(viewerHarness(true)).createEllipse("fireball", {
      centerEcefM: [6_378_137, 0, 0],
      semiMajorM: 10_000,
      semiMinorM: 10_000,
    });

    expect(materialColor(sdrEntity).red).toBeLessThanOrEqual(1);
    expect(materialColor(hdrEntity).red).toBeGreaterThan(1);
  });

  it("marks thermal footprint rings as HDR-emissive without changing SDR output", () => {
    const descriptor = {
      kind: "hazard_ring" as const,
      key: "thermal",
      name: "Thermal",
      description: "Thermal footprint",
      position: { lat_deg: 35, lon_deg: 139, height_m: 0 },
      semi_major_axis_m: 20_000,
      semi_minor_axis_m: 20_000,
      fill_css: "#fff3d6",
      fill_alpha: 0.2,
      outline_css: "#fff3d6",
      outline_alpha: 0.9,
      outline_width_px: 2,
      z_order: 0,
      hdr_emissive: true,
    };
    const sdrEntity = new CesiumStaticHazardHost(viewerHarness(false)).createEntity("thermal", descriptor);
    const hdrEntity = new CesiumStaticHazardHost(viewerHarness(true)).createEntity("thermal", descriptor);

    const sdrColor = (sdrEntity.ellipse?.material?.getValue(Cesium.JulianDate.now()) as { color: Cesium.Color }).color;
    const hdrColor = (hdrEntity.ellipse?.material?.getValue(Cesium.JulianDate.now()) as { color: Cesium.Color }).color;
    expect(sdrColor.red).toBeLessThanOrEqual(1);
    expect(hdrColor.red).toBeGreaterThan(1);
  });
});
