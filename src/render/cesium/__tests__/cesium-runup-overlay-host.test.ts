import { describe, expect, it, vi } from "vitest";
import * as Cesium from "cesium";

import { CesiumRunupOverlayHostAdapter } from "../cesium-runup-overlay-host";
import type {
  GaugePrimitivePresentation,
  InundationPrimitivePresentation,
  RunupPrimitivePresentation,
} from "../runup-overlay-controller";

function viewerHarness(includePrimitives = false) {
  const entities = new Cesium.EntityCollection();
  const requestRender = vi.fn();
  const primitiveValues: unknown[] = [];
  const primitives = {
    add: vi.fn((primitive: unknown) => {
      primitiveValues.push(primitive);
      return primitive;
    }),
    contains: vi.fn((primitive: unknown) => primitiveValues.includes(primitive)),
    remove: vi.fn((primitive: unknown) => {
      const index = primitiveValues.indexOf(primitive);
      if (index < 0) return false;
      primitiveValues.splice(index, 1);
      return true;
    }),
  };
  return {
    entities,
    requestRender,
    primitives,
    viewer: {
      entities,
      scene: includePrimitives ? { requestRender, primitives } : { requestRender },
      isDestroyed: () => false,
    } as unknown as Cesium.Viewer,
  };
}

function gauge(id: string, lat: number, lon: number): GaugePrimitivePresentation {
  return {
    id,
    name: `Gauge ${id}`,
    lat,
    lon,
    colorCss: "#89b4fa",
    colorAlpha: 0.95,
    outlineColorCss: "#11111b",
    outlineAlpha: 0.9,
    outlineWidth: 2,
    pixelSize: 10,
  };
}

describe("CesiumRunupOverlayHostAdapter", () => {
  it("keeps ocean gauges at sea level and releases the owned group", () => {
    const harness = viewerHarness();
    const host = new CesiumRunupOverlayHostAdapter(harness.viewer);
    const group = host.createGaugePrimitive([
      gauge("a", 10, 20),
      gauge("b", -30, 140),
    ]);

    expect(group).toHaveLength(2);
    expect(harness.entities.values).toHaveLength(2);
    expect(group[0].name).toBe("Gauge a");
    expect(group[0].point?.heightReference).toBeUndefined();
    expect(group[0].point?.disableDepthTestDistance?.getValue()).toBe(Number.POSITIVE_INFINITY);

    host.removeGaugePrimitive(group);
    expect(harness.entities.values).toHaveLength(0);
    expect(harness.requestRender).toHaveBeenCalledTimes(1);
  });

  it("anchors runup bars relative to terrain and drapes inundation discs", () => {
    const harness = viewerHarness();
    const host = new CesiumRunupOverlayHostAdapter(harness.viewer);
    const runup: RunupPrimitivePresentation = {
      id: "coast-a",
      lat: 35,
      lon: 139,
      heightM: 5_000,
      colorCss: "#f9e2af",
      colorAlpha: 0.85,
      outlineColorCss: "#11111b",
      outlineAlpha: 0.6,
      outlineWidth: 1,
      width: 8,
    };
    const inundation: InundationPrimitivePresentation = {
      id: "inundation-coast-a",
      lat: 35,
      lon: 139,
      radiusM: 2_000,
      segments: 40,
      colorCss: "#f9e2af",
      colorAlpha: 0.25,
      outlineAlpha: 0.7,
      outlineWidth: 2,
    };

    const bars = host.createRunupPrimitive([runup]);
    const discs = host.createInundationPrimitive([inundation]);
    expect(bars[0].cylinder?.heightReference?.getValue()).toBe(Cesium.HeightReference.RELATIVE_TO_GROUND);
    expect(discs[0].ellipse?.heightReference).toBeUndefined();
    expect(discs[0].ellipse?.classificationType?.getValue()).toBe(Cesium.ClassificationType.TERRAIN);
    expect(discs[0].ellipse?.outline?.getValue()).toBe(false);
    expect(discs[0].polyline?.clampToGround?.getValue()).toBe(true);

    host.removeRunupPrimitive(bars);
    host.removeInundationPrimitive(discs);
    expect(harness.entities.values).toHaveLength(0);
  });

  it("generation-scopes ids so atomic replacement can overlap safely", () => {
    const harness = viewerHarness();
    const host = new CesiumRunupOverlayHostAdapter(harness.viewer);
    const presentation: RunupPrimitivePresentation = {
      id: "coast-a",
      lat: 35,
      lon: 139,
      heightM: 5_000,
      colorCss: "#f9e2af",
      colorAlpha: 0.85,
      outlineColorCss: "#11111b",
      outlineAlpha: 0.6,
      outlineWidth: 1,
      width: 8,
    };

    const first = host.createRunupPrimitive([presentation]);
    const replacement = host.createRunupPrimitive([presentation]);
    expect(first[0].id).not.toBe(replacement[0].id);
    expect(harness.entities.values).toHaveLength(2);

    host.removeRunupPrimitive(first);
    host.removeRunupPrimitive(replacement);
    expect(harness.entities.values).toHaveLength(0);
  });

  it("uses one experimental point buffer for a large gauge batch when available", () => {
    const harness = viewerHarness(true);
    const host = new CesiumRunupOverlayHostAdapter(harness.viewer);
    const gauges = Array.from({ length: 500 }, (_, index) => gauge(
      `gauge-${index}`,
      -60 + (index % 120),
      -170 + (index % 340),
    ));

    const group = host.createGaugePrimitive(gauges);
    if (typeof Cesium.BufferPointCollection === "function") {
      expect(group.buffer).toBeInstanceOf(Cesium.BufferPointCollection);
      expect(group).toHaveLength(0);
      expect(harness.primitives.add).toHaveBeenCalledTimes(1);
    }
    host.removeGaugePrimitive(group);
    expect(harness.primitives.remove).toHaveBeenCalledTimes(
      typeof Cesium.BufferPointCollection === "function" ? 1 : 0,
    );
  });
});
