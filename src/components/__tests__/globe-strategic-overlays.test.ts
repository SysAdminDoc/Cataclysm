import * as Cesium from "cesium";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { installFireballOverlay, installMirvOverlay } from "../globe-strategic-overlays";
import type { FireballEvent } from "../../types/jpl";
import { buildMirvPreview, MIRV_PRESETS } from "../../lib/mirv";

beforeAll(() => {
  vi.stubGlobal("ImageBitmap", class ImageBitmap {});
  vi.stubGlobal("OffscreenCanvas", class OffscreenCanvas {});
});

function makeViewerHarness() {
  const added: unknown[] = [];
  const removed: unknown[] = [];
  const requestRender = vi.fn();
  let destroyed = false;
  const viewer = {
    isDestroyed: () => destroyed,
    scene: {
      primitives: {
        add: <T>(primitive: T) => {
          added.push(primitive);
          return primitive;
        },
        remove: (primitive: unknown) => {
          removed.push(primitive);
          return true;
        },
      },
      requestRender,
    },
  } as unknown as Cesium.Viewer;

  return {
    viewer,
    added,
    removed,
    requestRender,
    markDestroyed: () => { destroyed = true; },
  };
}

function fireball(index: number): FireballEvent {
  return {
    id: `event-${index}`,
    date: "2026-01-01",
    lat: index / 10,
    lon: -index / 10,
    radiatedEnergy10J: 1,
    impactEnergyKt: index,
    altitudeKm: 20,
    velocityKmS: 15,
    source: "NASA/JPL CNEOS",
  };
}

describe("strategic globe overlay lifecycles", () => {
  it("installs a capped fireball collection and removes it on cleanup", () => {
    const harness = makeViewerHarness();
    const cleanup = installFireballOverlay(
      harness.viewer,
      Array.from({ length: 81 }, (_, index) => fireball(index)),
    );

    expect(cleanup).toBeTypeOf("function");
    expect(harness.added).toHaveLength(1);
    expect(harness.added[0]).toBeInstanceOf(Cesium.PointPrimitiveCollection);
    expect((harness.added[0] as Cesium.PointPrimitiveCollection).length).toBe(80);
    expect(harness.requestRender).toHaveBeenCalledTimes(1);

    cleanup?.();

    expect(harness.removed).toEqual(harness.added);
    expect(harness.requestRender).toHaveBeenCalledTimes(2);
  });

  it("installs and tears down MIRV points and boundary in reverse visual order", () => {
    const harness = makeViewerHarness();
    const preview = buildMirvPreview({ lat: 35, lon: -106 }, MIRV_PRESETS[0]);
    const cleanup = installMirvOverlay(harness.viewer, preview);

    expect(cleanup).toBeTypeOf("function");
    expect(harness.added).toHaveLength(2);
    expect(harness.added[0]).toBeInstanceOf(Cesium.PointPrimitiveCollection);
    expect(harness.added[1]).toBeInstanceOf(Cesium.PolylineCollection);
    expect((harness.added[0] as Cesium.PointPrimitiveCollection).length).toBe(preview.points.length);

    cleanup?.();

    expect(harness.removed).toEqual([harness.added[1], harness.added[0]]);
    expect(harness.requestRender).toHaveBeenCalledTimes(2);
  });

  it("does not mutate a viewer that was destroyed before cleanup", () => {
    const harness = makeViewerHarness();
    const cleanup = installFireballOverlay(harness.viewer, [fireball(1)]);
    harness.markDestroyed();

    cleanup?.();

    expect(harness.removed).toHaveLength(0);
    expect(harness.requestRender).toHaveBeenCalledTimes(1);
  });
});
