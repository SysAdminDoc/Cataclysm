import { describe, expect, it } from "vitest";
import * as Cesium from "cesium";

import { CesiumRunupOverlayHostAdapter } from "../cesium-runup-overlay-host";
import type { GaugePrimitivePresentation } from "../runup-overlay-controller";

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
  it("builds and releases one styled GeoJsonPrimitive gauge collection", () => {
    const primitives = new Cesium.PrimitiveCollection();
    const viewer = {
      isDestroyed: () => false,
      scene: { primitives },
    } as unknown as Cesium.Viewer;
    const host = new CesiumRunupOverlayHostAdapter(viewer);

    const primitive = host.createGaugePrimitive([
      gauge("a", 10, 20),
      gauge("b", -30, 140),
    ]);

    expect(primitives.length).toBe(1);
    expect(primitive.featureCount).toBe(2);
    expect(primitive.ids).toEqual(["a", "b"]);
    expect(primitive.properties).toEqual([{ name: "Gauge a" }, { name: "Gauge b" }]);
    expect(primitive.points?.primitiveCount).toBe(2);
    const point = primitive.points?.get(0, new Cesium.BufferPoint());
    expect(point?.toJSON().material).toMatchObject({
      color: "#89b4faf3",
      outlineColor: "#11111be6",
      outlineWidth: 2,
      size: 10,
    });

    host.removeGaugePrimitive(primitive);
    expect(primitives.length).toBe(0);
  });
});
