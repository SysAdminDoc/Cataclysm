import { describe, expect, it } from "vitest";
import type { RenderEventV1, RendererNeutralFrameView, TransformStateV1 } from "../../../types/render-protocol";
import {
  DirectEffectsController,
  type DirectCylinderState,
  type DirectEffectsHost,
  type DirectEllipseState,
  type DirectPointState,
  type DirectPolylineState,
} from "../direct-effects";

type Shape = "ellipse" | "point" | "polyline" | "cylinder";
type Handle = { serial: number; id: string; shape: Shape };
type State = DirectEllipseState | DirectPointState | DirectPolylineState | DirectCylinderState;

class FakeHost implements DirectEffectsHost<Handle> {
  nextSerial = 1;
  readonly active = new Map<number, { handle: Handle; state: State }>();
  readonly creations: Handle[] = [];
  readonly updates: Array<{ handle: Handle; state: State }> = [];
  readonly removals: Handle[] = [];

  createEllipse(id: string, state: DirectEllipseState) { return this.create(id, "ellipse", state); }
  updateEllipse(handle: Handle, state: DirectEllipseState) { this.update(handle, state); }
  createPoint(id: string, state: DirectPointState) { return this.create(id, "point", state); }
  updatePoint(handle: Handle, state: DirectPointState) { this.update(handle, state); }
  createPolyline(id: string, state: DirectPolylineState) { return this.create(id, "polyline", state); }
  updatePolyline(handle: Handle, state: DirectPolylineState) { this.update(handle, state); }
  createCylinder(id: string, state: DirectCylinderState) { return this.create(id, "cylinder", state); }
  updateCylinder(handle: Handle, state: DirectCylinderState) { this.update(handle, state); }

  remove(handle: Handle) {
    expect(this.active.delete(handle.serial)).toBe(true);
    this.removals.push(handle);
  }

  state(id: string): State | undefined {
    return [...this.active.values()].find((entry) => entry.handle.id === id)?.state;
  }

  private create(id: string, shape: Shape, state: State): Handle {
    const handle = { serial: this.nextSerial++, id, shape };
    this.active.set(handle.serial, { handle, state });
    this.creations.push(handle);
    return handle;
  }

  private update(handle: Handle, state: State) {
    expect(this.active.has(handle.serial)).toBe(true);
    this.active.set(handle.serial, { handle, state });
    this.updates.push({ handle, state });
  }
}

const ORIGIN: TransformStateV1 = {
  id: "scenario-origin",
  parent_frame: "local_enu",
  translation_enu_m: [0, 0, 0],
  rotation_xyzw: [0, 0, 0, 1],
  scale: [1, 1, 1],
};

const BODY: TransformStateV1 = {
  ...ORIGIN,
  id: "asteroid-body",
  translation_enu_m: [10, 20, 30],
};

function event(
  id: string,
  kind: RenderEventV1["kind"],
  quantities: Record<string, number>,
  phase: RenderEventV1["phase"] = "active",
  transformId = "scenario-origin",
): RenderEventV1 {
  return {
    id,
    kind,
    phase,
    start_tick: 0,
    peak_tick: null,
    end_tick: null,
    transform_id: transformId,
    quantities: Object.entries(quantities).map(([semantic, value]) => ({ semantic, value, unit: "metre" })),
    field_refs: [],
  };
}

function frame(events: readonly RenderEventV1[], transforms: readonly TransformStateV1[] = [ORIGIN, BODY]): RendererNeutralFrameView {
  return {
    sequence: 1n,
    scenario_id: "direct-effects-test",
    scenario_sha256: "a".repeat(64),
    solver_tick: 0,
    simulation_time_s: 0,
    tick_duration_s: 0.1,
    payload_sha256: "b".repeat(64),
    keyframe: true,
    base_sequence: null,
    georeference: {
      contract_version: "1.0.0",
      geographic_crs: "EPSG:4979",
      ecef_crs: "EPSG:4978",
      origin: { lat_deg: 0, lon_deg: 0, ellipsoid_height_m: 0 },
      origin_ecef_m: { x_m: 1000, y_m: 2000, z_m: 3000 },
      local_enu_to_ecef: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        1000, 2000, 3000, 1,
      ],
      ecef_to_local_enu: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        -1000, -2000, -3000, 1,
      ],
      matrix_order: "column_major",
      local_axis_order: ["east_x", "north_y", "up_z"],
      local_unit: "metre",
      unreal_centimetres_per_metre: 100,
    },
    transforms,
    events,
    fields: {},
  };
}

function asteroidEvents(radius = 100): RenderEventV1[] {
  return [
    event("asteroid-entry", "asteroid_entry", { body_radius: 25 }, "active", "asteroid-body"),
    event("asteroid-fireball", "fireball", { flash_current_radius: radius }),
    event("asteroid-blast", "blast_front", { current_radius: radius * 2 }),
    event("asteroid-crater", "crater", { rim_radius: 70 }),
    event("asteroid-ocean-cavity", "ocean_cavity", { radius: 80 }),
    event("asteroid-splash", "ocean_cavity", { current_height: 90 }),
    event("asteroid-tsunami", "tsunami", {
      wave_0_radius: radius * 3,
      wave_1_radius: radius * 2,
      wave_2_radius: radius,
    }),
  ];
}

describe("DirectEffectsController", () => {
  it("creates all asteroid handle kinds once and updates them in place", () => {
    const host = new FakeHost();
    const controller = new DirectEffectsController(host);
    controller.update("asteroid", frame(asteroidEvents(100)));

    expect(controller.diagnostics()).toMatchObject({
      ellipses: 5,
      points: 1,
      polylines: 1,
      cylinders: 1,
      total: 8,
      created: 8,
      updated: 0,
      removed: 0,
    });
    expect(host.state("asteroid-entry:body_radius:point")).toEqual({
      positionEcefM: [1010, 2020, 3030],
      radiusM: 25,
    });
    expect(host.state("asteroid-entry:body_path:polyline")).toEqual({
      positionsEcefM: [[1010, 2020, 3030], [1000, 2000, 3000]],
    });

    const serials = new Map(host.creations.map((handle) => [handle.id, handle.serial]));
    controller.update("asteroid", frame(asteroidEvents(125)));
    expect(host.creations).toHaveLength(8);
    expect(host.updates).toHaveLength(8);
    expect(new Map([...host.active.values()].map(({ handle }) => [handle.id, handle.serial]))).toEqual(serials);
    expect(host.state("asteroid-blast:current_radius:ellipse")).toMatchObject({ semiMajorM: 250, semiMinorM: 250 });
  });

  it("projects reviewed nuclear effects without duplicating dedicated overlays", () => {
    const host = new FakeHost();
    const controller = new DirectEffectsController(host);
    controller.update("nuclear", frame([
      event("nuclear-fireball", "fireball", { maximum_radius: 90 }),
      event("nuclear-blast", "blast_front", { current_radius: 200 }),
      event("nuclear-cloud", "nuclear_cloud", { cloud_top_height: 12_000 }),
      event("nuclear-crater", "crater", { rim_radius: 60 }),
      event("nuclear-fallout", "fallout", {
        heavy_length: 1_000,
        heavy_width: 200,
        light_length: 5_000,
        light_width: 800,
      }),
    ]));

    expect(controller.diagnostics()).toMatchObject({ ellipses: 2, cylinders: 0, total: 2 });
    expect(host.state("nuclear-cloud:cloud_top_height:cylinder")).toBeUndefined();
    expect(host.state("nuclear-fallout:heavy:ellipse")).toBeUndefined();
  });

  it("removes completed, absent, zero-sized, and wrong-domain effects", () => {
    const host = new FakeHost();
    const controller = new DirectEffectsController(host);
    controller.update("asteroid", frame(asteroidEvents()));
    expect(host.active.size).toBe(8);

    controller.update("asteroid", frame([
      event("asteroid-fireball", "fireball", { flash_current_radius: 0 }),
      event("asteroid-blast", "blast_front", { current_radius: 100 }, "complete"),
      event("nuclear-blast", "blast_front", { current_radius: 500 }),
    ]));
    expect(host.active.size).toBe(0);
    expect(controller.diagnostics()).toMatchObject({ total: 0, created: 8, removed: 8 });

    controller.clear();
    controller.clear();
    expect(host.removals).toHaveLength(8);
  });

  it("keeps creation bounded across 100 many-frame replay cycles and ends at zero", () => {
    const host = new FakeHost();
    const controller = new DirectEffectsController(host);
    const framesPerReplay = 30;
    const handlesPerReplay = 8;

    for (let replay = 0; replay < 100; replay += 1) {
      for (let tick = 0; tick < framesPerReplay; tick += 1) {
        controller.update("asteroid", frame(asteroidEvents(100 + tick)));
      }
      controller.update("asteroid", frame(asteroidEvents().map((item) => ({ ...item, phase: "complete" }))));
      expect(controller.diagnostics().total).toBe(0);
      expect(host.active.size).toBe(0);
    }

    expect(host.creations).toHaveLength(100 * handlesPerReplay);
    expect(host.removals).toHaveLength(100 * handlesPerReplay);
    expect(host.updates).toHaveLength(100 * (framesPerReplay - 1) * handlesPerReplay);
    expect(controller.diagnostics()).toMatchObject({
      total: 0,
      created: 800,
      updated: 23_200,
      removed: 800,
      destroyed: false,
    });
  });

  it("clears null frames and makes destroy idempotent", () => {
    const host = new FakeHost();
    const controller = new DirectEffectsController(host);
    controller.update("asteroid", frame(asteroidEvents()));
    controller.update("asteroid", null);
    expect(controller.diagnostics().total).toBe(0);

    controller.destroy();
    controller.destroy();
    controller.clear();
    expect(controller.diagnostics().destroyed).toBe(true);
    expect(() => controller.update("asteroid", frame([]))).toThrow("DirectEffectsController is destroyed.");
  });
});
