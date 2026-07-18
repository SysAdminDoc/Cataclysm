import { describe, expect, it } from "vitest";
import type {
  TsunamiAnalyticalEntityDescriptor,
  TsunamiAnalyticalEntityHost,
} from "../tsunami-analytical-host";
import {
  TsunamiAnalyticalController,
  type TsunamiAnalyticalInput,
} from "../tsunami-analytical";

type FakeHandle = Readonly<{ serial: number; key: string }>;

class FakeHost implements TsunamiAnalyticalEntityHost<FakeHandle> {
  nextSerial = 1;
  entities = new Map<number, { handle: FakeHandle; descriptor: TsunamiAnalyticalEntityDescriptor }>();
  creates: string[] = [];
  updates: string[] = [];
  removals: string[] = [];
  renderRequests = 0;

  createEntity(key: string, descriptor: TsunamiAnalyticalEntityDescriptor): FakeHandle {
    const handle = Object.freeze({ serial: this.nextSerial++, key });
    this.entities.set(handle.serial, { handle, descriptor });
    this.creates.push(key);
    return handle;
  }

  updateEntity(handle: FakeHandle, descriptor: TsunamiAnalyticalEntityDescriptor): void {
    if (!this.entities.has(handle.serial)) throw new Error("updated missing entity");
    this.entities.set(handle.serial, { handle, descriptor });
    this.updates.push(handle.key);
  }

  removeEntity(handle: FakeHandle): void {
    if (!this.entities.delete(handle.serial)) throw new Error("removed missing entity");
    this.removals.push(handle.key);
  }

  requestRender(): void {
    this.renderRequests += 1;
  }

  serialFor(key: string): number | undefined {
    return [...this.entities.values()].find((entry) => entry.handle.key === key)?.handle.serial;
  }

  descriptorFor(key: string): TsunamiAnalyticalEntityDescriptor | undefined {
    return [...this.entities.values()].find((entry) => entry.handle.key === key)?.descriptor;
  }
}

function input(overrides: Partial<TsunamiAnalyticalInput> = {}): TsunamiAnalyticalInput {
  return {
    source_center: { lat_deg: 38.3, lon_deg: 142.4 },
    wavefront: {
      time_s: 900,
      ranges_m: [1_000, 2_000, 3_000, 4_000, 5_000],
      amplitudes_m: [1, 2, 0.5, 4, 0],
    },
    isochrones: [
      {
        time_s: 600,
        lines: [
          [[140, 35], [141, 36]],
          [[142, 37], [143, 38], [144, 39]],
        ],
      },
    ],
    dart_buoys: [
      { id: 21418, lat: 38.7, lon: 148.7 },
      { id: 21413, lat: 30.5, lon: 152.1 },
    ],
    ...overrides,
  };
}

describe("TsunamiAnalyticalController", () => {
  it("applies independent opacity to wavefront, arrivals, and DART channels", () => {
    const host = new FakeHost();
    const controller = new TsunamiAnalyticalController(host, 1);
    controller.update(input({ wavefront_opacity: 0.5, isochrone_opacity: 0.4, dart_opacity: 0.3 }));
    const wavefront = host.descriptorFor("wavefront:ring:0");
    const arrival = host.descriptorFor("isochrone:600:0:line:0");
    const dart = host.descriptorFor("dart:21418");
    expect(wavefront?.kind === "wavefront_ring" ? wavefront.outline_alpha : null).toBeCloseTo(0.19375);
    expect(arrival?.kind === "isochrone_polyline" ? arrival.alpha : null).toBeCloseTo(0.34);
    expect(dart?.kind === "dart_buoy" ? dart.fill_alpha : null).toBe(0.3);
  });

  it("preserves Globe wavefront, isochrone, label, and DART presentation semantics", () => {
    const host = new FakeHost();
    const controller = new TsunamiAnalyticalController(host, 20);
    const diagnostics = controller.update(input());

    expect(host.creates).toEqual([
      "wavefront:ring:0",
      "wavefront:ring:2",
      "wavefront:ring:4",
      "isochrone:600:0:line:0",
      "isochrone:600:0:label",
      "isochrone:600:0:line:1",
      "dart:21418",
      "dart:21413",
    ]);
    expect(diagnostics).toMatchObject({
      generation: 20,
      revision: 1,
      wavefront_time_s: 900,
      isochrone_levels: 1,
      active: {
        wavefront_rings: 3,
        isochrone_polylines: 2,
        isochrone_labels: 1,
        dart_buoys: 2,
        total_entities: 8,
      },
      last_update: { created: 8, updated: 0, removed: 0, unchanged: 0, invalid_inputs: 0 },
      resources: { entities: 8, primitives: 0, imagery: 0, textures: 0, handlers: 0, listeners: 0, rafs: 0, pendingAsync: 0 },
    });
    expect(Object.isFrozen(diagnostics)).toBe(true);

    expect(host.descriptorFor("wavefront:ring:0")).toEqual({
      kind: "wavefront_ring",
      key: "wavefront:ring:0",
      position: { lat_deg: 38.3, lon_deg: 142.4, height_m: 0 },
      semi_major_axis_m: 1_000,
      semi_minor_axis_m: 1_000,
      fill_css: "#74c7ec",
      fill_alpha: 0,
      outline_css: "#74c7ec",
      outline_alpha: 0.3875,
    });
    expect(host.descriptorFor("isochrone:600:0:line:0")).toMatchObject({
      kind: "isochrone_polyline",
      positions: [
        { lat_deg: 35, lon_deg: 140, height_m: 0 },
        { lat_deg: 36, lon_deg: 141, height_m: 0 },
      ],
      width_px: 1.6,
      color_css: "#f9e2af",
      alpha: 0.85,
      dash_length_px: 12,
      clamp_to_ground: false,
    });
    expect(host.descriptorFor("isochrone:600:0:label")).toMatchObject({
      kind: "isochrone_label",
      position: { lat_deg: 36, lon_deg: 141, height_m: 0 },
      text: "+10 min",
      font: "11px 'JetBrains Mono', monospace",
      disable_depth_test_distance_m: Number.POSITIVE_INFINITY,
    });
    expect(host.descriptorFor("dart:21418")).toEqual({
      kind: "dart_buoy",
      key: "dart:21418",
      name: "DART 21418",
      position: { lat_deg: 38.7, lon_deg: 148.7, height_m: 0 },
      pixel_size: 9,
      fill_css: "#eba0ac",
      fill_alpha: 1,
      outline_css: "#11111b",
      outline_alpha: 1,
      outline_width_px: 2,
      label: "DART 21418",
      label_font: "10px Inter, sans-serif",
      label_pixel_offset: [0, 10],
      label_scale: 0.85,
      distance_display_min_m: 0,
      distance_display_max_m: 15_000_000,
    });
  });

  it("keeps stable handles, performs no identical mutations, and updates changed entities in place", () => {
    const host = new FakeHost();
    const controller = new TsunamiAnalyticalController(host, 1);
    controller.update(input());
    const serials = new Map(host.creates.map((key) => [key, host.serialFor(key)]));
    const unchanged = controller.update(input());
    expect(unchanged.last_update).toEqual({ created: 0, updated: 0, removed: 0, unchanged: 8, invalid_inputs: 0 });
    expect(host.renderRequests).toBe(1);

    const changed = input({
      source_center: { lat_deg: 39, lon_deg: 143 },
      wavefront: {
        time_s: 1_000,
        ranges_m: [1_500, 2_000, 3_500, 4_000, 5_500],
        amplitudes_m: [2, 2, 1, 4, 0],
      },
      isochrones: [{ time_s: 600, lines: [[[140, 35], [141.5, 36.5]], [[142, 37], [143, 38], [144, 39]]] }],
      dart_buoys: [{ id: 21418, lat: 39, lon: 149 }, { id: 21413, lat: 30.5, lon: 152.1 }],
    });
    const diagnostics = controller.update(changed);
    expect(diagnostics.last_update).toEqual({ created: 0, updated: 6, removed: 0, unchanged: 2, invalid_inputs: 0 });
    expect(host.renderRequests).toBe(2);
    for (const [key, serial] of serials) expect(host.serialFor(key)).toBe(serial);
    expect(host.updates).toEqual([
      "wavefront:ring:0",
      "wavefront:ring:2",
      "wavefront:ring:4",
      "isochrone:600:0:line:0",
      "isochrone:600:0:label",
      "dart:21418",
    ]);
    expect(diagnostics.wavefront_time_s).toBe(1_000);
  });

  it("removes obsolete keyed entities exactly and clears survivors in reverse ownership order", () => {
    const host = new FakeHost();
    const controller = new TsunamiAnalyticalController(host, 2);
    controller.update(input());
    const reduced = controller.update(input({
      wavefront: { time_s: 900, ranges_m: [1_000], amplitudes_m: [1] },
      isochrones: [],
      dart_buoys: [{ id: 21418, lat: 38.7, lon: 148.7 }],
    }));
    expect(reduced.active).toEqual({
      wavefront_rings: 1,
      isochrone_polylines: 0,
      isochrone_labels: 0,
      dart_buoys: 1,
      total_entities: 2,
    });
    expect(reduced.last_update).toEqual({ created: 0, updated: 1, removed: 6, unchanged: 1, invalid_inputs: 0 });

    host.removals = [];
    controller.clear();
    expect(host.removals).toEqual(["dart:21418", "wavefront:ring:0"]);
    expect(host.entities.size).toBe(0);
    expect(controller.diagnostics.resources.entities).toBe(0);
    const requests = host.renderRequests;
    controller.clear();
    expect(host.renderRequests).toBe(requests);
  });

  it("filters malformed values, clamps finite isochrone coordinates, and reports invalid inputs", () => {
    const host = new FakeHost();
    const controller = new TsunamiAnalyticalController(host, 3);
    const diagnostics = controller.update({
      source_center: { lat_deg: Number.NaN, lon_deg: 0 },
      wavefront: { time_s: 1, ranges_m: [1], amplitudes_m: [] },
      isochrones: [
        { time_s: 60, lines: [[[200, 100], [0, 0], [Number.NaN, 1]]] },
        { time_s: Number.NaN, lines: [] },
        { time_s: 120, lines: [] },
      ],
      dart_buoys: [
        { id: 1, lat: 0, lon: 0 },
        { id: 1, lat: 1, lon: 1 },
        { id: -1, lat: 0, lon: 0 },
      ],
    });
    expect(diagnostics.last_update.invalid_inputs).toBe(6);
    expect(diagnostics.active).toEqual({
      wavefront_rings: 0,
      isochrone_polylines: 1,
      isochrone_labels: 1,
      dart_buoys: 1,
      total_entities: 3,
    });
    const line = host.descriptorFor("isochrone:60:0:line:0");
    expect(line?.kind).toBe("isochrone_polyline");
    if (line?.kind === "isochrone_polyline") {
      expect(line.positions).toEqual([
        { lat_deg: 90, lon_deg: 180, height_m: 0 },
        { lat_deg: 0, lon_deg: 0, height_m: 0 },
      ]);
    }
    expect(host.descriptorFor("dart:1")).toMatchObject({ position: { lat_deg: 1, lon_deg: 1 } });
  });

  it("destroys idempotently and rejects updates after destruction", () => {
    const host = new FakeHost();
    const controller = new TsunamiAnalyticalController(host, 4);
    controller.update(input());
    const destroyed = controller.destroy();
    expect(destroyed.destroyed).toBe(true);
    expect(destroyed.active.total_entities).toBe(0);
    expect(destroyed.resources.entities).toBe(0);
    expect(host.removals).toHaveLength(8);
    controller.destroy();
    controller.clear();
    expect(host.removals).toHaveLength(8);
    expect(() => controller.update(input())).toThrow(/destroyed/i);
  });

  it("completes 100 update/clear cycles with zero analytical resources", () => {
    const host = new FakeHost();
    const controller = new TsunamiAnalyticalController(host, 100);
    for (let cycle = 0; cycle < 100; cycle += 1) {
      const updated = controller.update(input());
      expect(updated.active.total_entities).toBe(8);
      expect(updated.resources.entities).toBe(8);
      const cleared = controller.clear();
      expect(cleared.active.total_entities).toBe(0);
      expect(cleared.resources).toEqual({
        entities: 0,
        primitives: 0,
        imagery: 0,
        textures: 0,
        handlers: 0,
        listeners: 0,
        rafs: 0,
        pendingAsync: 0,
      });
      expect(host.entities.size).toBe(0);
    }
    expect(host.creates).toHaveLength(800);
    expect(host.removals).toHaveLength(800);
    expect(host.updates).toHaveLength(0);
    expect(host.renderRequests).toBe(200);
    expect(controller.diagnostics.cumulative).toEqual({
      created: 800,
      updated: 0,
      removed: 800,
      unchanged: 0,
      invalid_inputs: 0,
    });
  });
});
