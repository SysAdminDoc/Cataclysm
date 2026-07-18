import { describe, expect, it } from "vitest";
import type { StaticHazardEntityDescriptor, StaticHazardEntityHost } from "../static-hazard-host";
import {
  StaticHazardController,
  type StaticHazardInput,
} from "../static-hazards";

type FakeHandle = Readonly<{ serial: number; key: string }>;

class FakeHost implements StaticHazardEntityHost<FakeHandle> {
  nextSerial = 1;
  entities = new Map<number, { handle: FakeHandle; descriptor: StaticHazardEntityDescriptor }>();
  creates: string[] = [];
  updates: string[] = [];
  removals: string[] = [];
  renderRequests = 0;

  createEntity(key: string, descriptor: StaticHazardEntityDescriptor): FakeHandle {
    const handle = Object.freeze({ serial: this.nextSerial++, key });
    this.entities.set(handle.serial, { handle, descriptor });
    this.creates.push(key);
    return handle;
  }

  updateEntity(handle: FakeHandle, descriptor: StaticHazardEntityDescriptor): void {
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
}

function input(overrides: Partial<StaticHazardInput> = {}): StaticHazardInput {
  return {
    center: { lat_deg: 35, lon_deg: 140 },
    rings: [
      { id: "outer", label: "Outer effect", description: "Outer zone", radius_m: 50_000, color_css: "#89b4fa" },
      { id: "inner", label: "Inner effect", radius_m: 10_000, color_css: "#f38ba8" },
    ],
    fallout_polygons: [
      {
        id: "heavy",
        label: "Heavy fallout",
        color_css: "#a6e3a1",
        points: [
          { lat_deg: 35, lon_deg: 140 },
          { lat_deg: 35.5, lon_deg: 141 },
          { lat_deg: 34.5, lon_deg: 141 },
        ],
      },
    ],
    ...overrides,
  };
}

describe("StaticHazardController", () => {
  it("renders direct source independently and applies per-layer opacity", () => {
    const host = new FakeHost();
    const controller = new StaticHazardController(host, 1);
    controller.update(input({
      rings: [],
      show_source: true,
      source_opacity: 0.45,
      fallout_opacity: 0.5,
    }));
    const source = [...host.entities.values()].find((entry) => entry.handle.key === "footprint:ground-zero")?.descriptor;
    const fallout = [...host.entities.values()].find((entry) => entry.handle.key === "fallout:heavy:0")?.descriptor;
    expect(source?.kind === "ground_zero" ? source.fill_alpha : null).toBe(0.45);
    expect(fallout?.kind === "fallout_polygon" ? fallout.fill_alpha : null).toBeCloseTo(0.11);
  });

  it("creates exact footprint/fallout descriptors and diagnostics", () => {
    const host = new FakeHost();
    const controller = new StaticHazardController(host, 12);
    const diagnostics = controller.update(input());

    expect(host.creates).toEqual([
      "footprint:ring:outer:0",
      "footprint:ring:inner:0",
      "footprint:ground-zero",
      "fallout:heavy:0",
    ]);
    expect(host.entities.size).toBe(4);
    expect(host.renderRequests).toBe(1);
    expect(diagnostics).toMatchObject({
      generation: 12,
      revision: 1,
      destroyed: false,
      active: {
        hazard_rings: 2,
        ground_zero_markers: 1,
        fallout_polygons: 1,
        total_entities: 4,
        outer_radius_m: 50_000,
      },
      last_update: { created: 4, updated: 0, removed: 0, unchanged: 0, invalid_inputs: 0 },
      resources: { entities: 4, primitives: 0, imagery: 0, textures: 0, handlers: 0, listeners: 0, rafs: 0, pendingAsync: 0 },
    });
    expect(Object.isFrozen(diagnostics)).toBe(true);
    expect(Object.isFrozen(diagnostics.resources)).toBe(true);

    const outer = [...host.entities.values()].find((entry) => entry.handle.key === "footprint:ring:outer:0")?.descriptor;
    expect(outer).toEqual({
      kind: "hazard_ring",
      key: "footprint:ring:outer:0",
      name: "Outer effect",
      description: "Outer zone",
      position: { lat_deg: 35, lon_deg: 140, height_m: 0 },
      semi_major_axis_m: 50_000,
      semi_minor_axis_m: 50_000,
      fill_css: "#89b4fa",
      fill_alpha: 0.16,
      outline_css: "#89b4fa",
      outline_alpha: 0.9,
      outline_width_px: 2,
      z_order: 0,
    });
  });

  it("keeps handles stable, skips identical host mutations, and updates changed descriptors in place", () => {
    const host = new FakeHost();
    const controller = new StaticHazardController(host, 1);
    controller.update(input());
    const serials = new Map(host.creates.map((key) => [key, host.serialFor(key)]));

    const unchanged = controller.update(input());
    expect(unchanged.last_update).toEqual({ created: 0, updated: 0, removed: 0, unchanged: 4, invalid_inputs: 0 });
    expect(host.renderRequests).toBe(1);
    expect(host.updates).toEqual([]);

    const changed = input({
      center: { lat_deg: 36, lon_deg: 141 },
      rings: [
        { id: "outer", label: "Outer effect", description: "Outer zone", radius_m: 60_000, color_css: "#89b4fa" },
        { id: "inner", label: "Inner effect", radius_m: 10_000, color_css: "#f38ba8" },
      ],
      fallout_polygons: [
        {
          id: "heavy",
          label: "Heavy fallout",
          color_css: "#a6e3a1",
          points: [
            { lat_deg: 36, lon_deg: 141 },
            { lat_deg: 36.5, lon_deg: 142 },
            { lat_deg: 35.5, lon_deg: 142 },
          ],
        },
      ],
    });
    const diagnostics = controller.update(changed);
    expect(diagnostics.last_update).toEqual({ created: 0, updated: 4, removed: 0, unchanged: 0, invalid_inputs: 0 });
    expect(host.renderRequests).toBe(2);
    for (const [key, serial] of serials) expect(host.serialFor(key)).toBe(serial);
    expect(diagnostics.active.outer_radius_m).toBe(60_000);
  });

  it("removes obsolete handles once and clears remaining entities in reverse ownership order", () => {
    const host = new FakeHost();
    const controller = new StaticHazardController(host, 2);
    controller.update(input());
    const reduced = controller.update(input({
      rings: [{ id: "outer", label: "Outer effect", description: "Outer zone", radius_m: 50_000, color_css: "#89b4fa" }],
      fallout_polygons: [],
    }));
    expect(reduced.last_update).toEqual({ created: 0, updated: 0, removed: 2, unchanged: 2, invalid_inputs: 0 });
    expect(host.removals).toEqual(["footprint:ring:inner:0", "fallout:heavy:0"]);

    const cleared = controller.clear();
    expect(host.removals).toEqual([
      "footprint:ring:inner:0",
      "fallout:heavy:0",
      "footprint:ground-zero",
      "footprint:ring:outer:0",
    ]);
    expect(cleared.active.total_entities).toBe(0);
    expect(cleared.resources.entities).toBe(0);
    expect(host.entities.size).toBe(0);
    expect(host.renderRequests).toBe(3);
    controller.clear();
    expect(host.removals).toHaveLength(4);
    expect(host.renderRequests).toBe(3);
  });

  it("filters malformed coordinates and reports every rejected input", () => {
    const host = new FakeHost();
    const controller = new StaticHazardController(host, 3);
    const diagnostics = controller.update({
      center: { lat_deg: 200, lon_deg: 0 },
      rings: [{ label: "Ring", radius_m: 10, color_css: "#fff" }],
      fallout_polygons: [
        {
          label: "Partial",
          color_css: "#fff",
          points: [
            { lat_deg: 0, lon_deg: 0 },
            { lat_deg: Number.NaN, lon_deg: 1 },
            { lat_deg: 2, lon_deg: 2 },
          ],
        },
      ],
    });
    expect(diagnostics.active.total_entities).toBe(0);
    expect(diagnostics.last_update.invalid_inputs).toBe(4);
    expect(host.renderRequests).toBe(0);
  });

  it("destroys idempotently and rejects later updates", () => {
    const host = new FakeHost();
    const controller = new StaticHazardController(host, 4);
    controller.update(input());
    const destroyed = controller.destroy();
    expect(destroyed.destroyed).toBe(true);
    expect(destroyed.active.total_entities).toBe(0);
    expect(destroyed.resources.entities).toBe(0);
    expect(host.entities.size).toBe(0);
    expect(host.removals).toHaveLength(4);
    controller.destroy();
    controller.clear();
    expect(host.removals).toHaveLength(4);
    expect(() => controller.update(input())).toThrow(/destroyed/i);
  });

  it("completes 100 update/clear cycles with stable exact zero-resource snapshots", () => {
    const host = new FakeHost();
    const controller = new StaticHazardController(host, 100);
    for (let cycle = 0; cycle < 100; cycle += 1) {
      const updated = controller.update(input({
        fallout_polygons: [
          ...input().fallout_polygons,
          {
            id: "light",
            label: "Light fallout",
            color_css: "#f9e2af",
            points: [
              { lat_deg: 35, lon_deg: 140 },
              { lat_deg: 36, lon_deg: 142 },
              { lat_deg: 34, lon_deg: 142 },
            ],
          },
        ],
      }));
      expect(updated.active.total_entities).toBe(5);
      expect(updated.resources.entities).toBe(5);
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
    expect(host.creates).toHaveLength(500);
    expect(host.removals).toHaveLength(500);
    expect(host.updates).toHaveLength(0);
    expect(host.renderRequests).toBe(200);
    expect(controller.diagnostics.cumulative).toEqual({
      created: 500,
      updated: 0,
      removed: 500,
      unchanged: 0,
      invalid_inputs: 0,
    });
  });
});
