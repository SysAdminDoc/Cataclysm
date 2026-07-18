import * as Cesium from "cesium";
import { describe, expect, it, vi } from "vitest";
import { CesiumStaticHazardHost } from "../cesium-static-hazard-host";

describe("CesiumStaticHazardHost", () => {
  it("keeps the ground-zero annotation above translucent hazard geometry", () => {
    const entities = new Cesium.EntityCollection();
    const host = new CesiumStaticHazardHost({
      entities,
      scene: { requestRender: vi.fn() },
      isDestroyed: () => false,
    } as unknown as Cesium.Viewer);

    const entity = host.createEntity("footprint:ground-zero", {
      kind: "ground_zero",
      key: "footprint:ground-zero",
      position: { lat_deg: -2, lon_deg: -137, height_m: 0 },
      pixel_size: 9,
      fill_css: "#f38ba8",
      fill_alpha: 1,
      outline_css: "#11111b",
      outline_alpha: 1,
      outline_width_px: 2,
      label: "Ground zero",
    });

    expect(entity.label?.showBackground?.getValue()).toBe(true);
    expect(entity.label?.disableDepthTestDistance?.getValue()).toBe(Number.POSITIVE_INFINITY);
  });

  it("uses a semantic entity and depth-independent point without GPU-rasterized text in reference captures", () => {
    const entities = new Cesium.EntityCollection();
    const host = new CesiumStaticHazardHost({
      entities,
      scene: { requestRender: vi.fn() },
      isDestroyed: () => false,
    } as unknown as Cesium.Viewer, true);

    const entity = host.createEntity("footprint:ground-zero", {
      kind: "ground_zero",
      key: "footprint:ground-zero",
      position: { lat_deg: -2, lon_deg: -137, height_m: 0 },
      pixel_size: 9,
      fill_css: "#f38ba8",
      fill_alpha: 1,
      outline_css: "#11111b",
      outline_alpha: 1,
      outline_width_px: 2,
      label: "Ground zero",
    });

    expect(entity.name).toBe("Ground zero");
    expect(entity.description?.getValue()).toBe("Ground zero");
    expect(entity.label).toBeUndefined();
    expect(entity.point?.disableDepthTestDistance?.getValue()).toBe(Number.POSITIVE_INFINITY);
  });
});
