import { describe, expect, it } from "vitest";
import type {
  SourceCameraTarget,
  TsunamiSourceEntityDescriptor,
  TsunamiSourceHost,
} from "../tsunami-source-host";
import {
  TsunamiSourceController,
  type SourceControllerInput,
  type TsunamiSourceInput,
} from "../tsunami-source";

type FakeHandle = Readonly<{ serial: number }>;
type Flight = {
  target: SourceCameraTarget;
  signal: AbortSignal;
  settled: boolean;
  resolve(value: boolean): void;
  reject(error: unknown): void;
};

class FakeSourceHost implements TsunamiSourceHost<FakeHandle> {
  nextSerial = 1;
  entity: { handle: FakeHandle; descriptor: TsunamiSourceEntityDescriptor } | null = null;
  creates = 0;
  updates = 0;
  removals = 0;
  renderRequests = 0;
  cancelCalls = 0;
  flights: Flight[] = [];
  instantTargets: SourceCameraTarget[] = [];

  createSourceEntity(descriptor: TsunamiSourceEntityDescriptor): FakeHandle {
    if (this.entity) throw new Error("duplicate source entity");
    const handle = Object.freeze({ serial: this.nextSerial++ });
    this.entity = { handle, descriptor };
    this.creates += 1;
    return handle;
  }

  updateSourceEntity(handle: FakeHandle, descriptor: TsunamiSourceEntityDescriptor): void {
    if (this.entity?.handle !== handle) throw new Error("updated unknown source");
    this.entity = { handle, descriptor };
    this.updates += 1;
  }

  removeSourceEntity(handle: FakeHandle): void {
    if (this.entity?.handle !== handle) throw new Error("removed unknown source");
    this.entity = null;
    this.removals += 1;
  }

  cancelCameraFlight(): void {
    this.cancelCalls += 1;
    for (const flight of this.flights) {
      if (!flight.settled) flight.resolve(false);
    }
  }

  flyToSource(handle: FakeHandle, target: SourceCameraTarget, signal: AbortSignal): Promise<boolean> {
    if (this.entity?.handle !== handle) throw new Error("flew to unknown source");
    return new Promise<boolean>((resolve, reject) => {
      const flight: Flight = {
        target,
        signal,
        settled: false,
        resolve(value) {
          if (flight.settled) return;
          flight.settled = true;
          resolve(value);
        },
        reject(error) {
          if (flight.settled) return;
          flight.settled = true;
          reject(error);
        },
      };
      this.flights.push(flight);
    });
  }

  setCameraView(target: SourceCameraTarget): void {
    this.instantTargets.push(target);
  }

  requestRender(): void {
    this.renderRequests += 1;
  }
}

function source(overrides: Partial<TsunamiSourceInput> = {}): TsunamiSourceInput {
  return {
    center: { lat_deg: 38.3, lon_deg: 142.4 },
    cavity_radius_m: 10_000,
    peak_amplitude_m: 3.2,
    label: "Tōhoku source",
    camera_view: null,
    ...overrides,
  };
}

function input(overrides: Partial<SourceControllerInput> = {}): SourceControllerInput {
  return {
    source: source(),
    reference_capture: false,
    reduced_motion: false,
    ...overrides,
  };
}

describe("TsunamiSourceController", () => {
  it("applies user opacity to every source presentation channel", () => {
    const host = new FakeSourceHost();
    const controller = new TsunamiSourceController(host, 1);
    controller.update(input({ layer_opacity: 0.4, reference_capture: true }));
    expect(host.entity?.descriptor.point.fill.alpha).toBe(0.4);
    expect(host.entity?.descriptor.cavity.fill.alpha).toBeCloseTo(0.12);
    expect(host.entity?.descriptor.rim.fill.alpha).toBeCloseTo(0.072);
    expect(host.entity?.descriptor.label.background.alpha).toBeCloseTo(0.36);
  });

  it("preserves the current source marker and default camera framing semantics", () => {
    const host = new FakeSourceHost();
    const controller = new TsunamiSourceController(host, 11);
    const diagnostics = controller.update(input());

    expect(host.creates).toBe(1);
    expect(host.updates).toBe(0);
    expect(host.flights).toHaveLength(1);
    expect(host.renderRequests).toBe(1);
    expect(host.entity?.descriptor).toMatchObject({
      kind: "tsunami_source",
      key: "tsunami:source",
      name: "Tōhoku source",
      position: { lat_deg: 38.3, lon_deg: 142.4, height_m: 0 },
      point: {
        pixel_size: 12,
        fill: { token: "--yellow", fallback_css: "#f9e2af", alpha: 1 },
        outline: { token: "--crust", fallback_css: "#11111b", alpha: 1 },
        outline_width_px: 2,
      },
      cavity: {
        top_radius_m: 10_000,
        bottom_radius_m: 3_000,
        fill: { token: "--red", fallback_css: "#f38ba8", alpha: 0.3 },
        outline: { token: "--maroon", fallback_css: "#eba0ac", alpha: 1 },
      },
      rim: {
        semi_major_axis_m: 10_000,
        semi_minor_axis_m: 10_000,
        fill: { token: "--red", fallback_css: "#f38ba8", alpha: 0.18 },
      },
      label: {
        text: "Tōhoku source\nA₀ = 3.2 m",
        font: "12px Inter, sans-serif",
        pixel_offset: [0, -16],
        background_padding: [8, 6],
      },
    });
    expect(host.entity?.descriptor.cavity.length_m).toBeCloseTo(20_000 / 2.83, 10);
    expect(host.flights[0].target).toEqual({
      destination: { lat_deg: 38.3, lon_deg: 142.4, height_m: 0 },
      heading_rad: 0,
      pitch_rad: -Math.PI / 4,
      roll_rad: 0,
      range_m: 500_000,
      duration_s: 1.8,
    });
    expect(diagnostics).toMatchObject({
      generation: 11,
      camera_mode: "flight",
      active: { source_entities: 1, camera_flights: 1 },
      last_update: {
        created: 1,
        updated: 0,
        removed: 0,
        unchanged: 0,
        invalid_inputs: 0,
        flights_started: 1,
        flights_cancelled: 0,
      },
      resources: { entities: 1, pendingAsync: 1 },
    });
    expect(Object.isFrozen(diagnostics)).toBe(true);
  });

  it("keeps one stable source handle and cancels the prior flight on a camera-target switch", async () => {
    const host = new FakeSourceHost();
    const controller = new TsunamiSourceController(host, 1);
    controller.update(input());
    const serial = host.entity?.handle.serial;
    const switched = controller.update(input({
      source: source({
        center: { lat_deg: 20, lon_deg: -150 },
        cavity_radius_m: 20_000,
        label: "Pacific source",
        camera_view: { heading_deg: 30, pitch_deg: -50, range_m: 2_000_000 },
      }),
    }));
    await Promise.resolve();

    expect(host.entity?.handle.serial).toBe(serial);
    expect(host.creates).toBe(1);
    expect(host.updates).toBe(1);
    expect(host.cancelCalls).toBe(1);
    expect(host.flights).toHaveLength(2);
    expect(host.flights[0].signal.aborted).toBe(true);
    expect(host.flights[1].target).toMatchObject({
      destination: { lat_deg: 20, lon_deg: -150 },
      heading_rad: Math.PI / 6,
      pitch_rad: -50 * Math.PI / 180,
      range_m: 2_000_000,
    });
    expect(switched.last_update).toMatchObject({
      updated: 1,
      flights_started: 1,
      flights_cancelled: 1,
    });
    expect(controller.diagnostics.active.camera_flights).toBe(1);
  });

  it("does not restart framing for label-only updates", () => {
    const host = new FakeSourceHost();
    const controller = new TsunamiSourceController(host, 2);
    controller.update(input());
    const diagnostics = controller.update(input({ source: source({ peak_amplitude_m: 4.4 }) }));
    expect(host.updates).toBe(1);
    expect(host.flights).toHaveLength(1);
    expect(host.cancelCalls).toBe(0);
    expect(diagnostics.last_update).toMatchObject({ updated: 1, flights_started: 0, flights_cancelled: 0 });
  });

  it("skips capture flights and uses instant framing for reduced motion", () => {
    const host = new FakeSourceHost();
    const controller = new TsunamiSourceController(host, 3);
    const capture = controller.update(input({ reference_capture: true }));
    expect(host.flights).toHaveLength(0);
    expect(host.instantTargets).toHaveLength(0);
    expect(capture.camera_mode).toBe("reference_capture");
    expect(capture.last_update.reference_capture_skips).toBe(1);

    const instant = controller.update(input({ reduced_motion: true }));
    expect(host.flights).toHaveLength(0);
    expect(host.instantTargets).toHaveLength(1);
    expect(instant.camera_mode).toBe("instant");
    expect(instant.last_update.instant_views).toBe(1);
    expect(instant.active.camera_flights).toBe(0);
  });

  it("falls back from an invalid curated camera and clears invalid source state exactly", () => {
    const host = new FakeSourceHost();
    const controller = new TsunamiSourceController(host, 4);
    const fallback = controller.update(input({
      source: source({ camera_view: { heading_deg: Number.NaN, pitch_deg: -45, range_m: -1 } }),
    }));
    expect(fallback.last_update.invalid_inputs).toBe(1);
    expect(host.flights[0].target.range_m).toBe(500_000);

    const cleared = controller.update(input({
      source: source({ center: { lat_deg: 100, lon_deg: 0 } }),
    }));
    expect(cleared.last_update).toMatchObject({ removed: 1, invalid_inputs: 1, flights_cancelled: 1 });
    expect(cleared.active).toEqual({ source_entities: 0, camera_flights: 0 });
    expect(cleared.resources.entities).toBe(0);
    expect(cleared.resources.pendingAsync).toBe(0);
    expect(host.entity).toBeNull();
  });

  it("tracks current flight failures without leaking pending work", async () => {
    const host = new FakeSourceHost();
    const controller = new TsunamiSourceController(host, 5);
    controller.update(input());
    host.flights[0].reject(new Error("terrain unavailable"));
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.diagnostics.active.camera_flights).toBe(0);
    expect(controller.diagnostics.cumulative.flight_failures).toBe(1);
  });

  it("clears and destroys idempotently with no entity or flight resources", () => {
    const host = new FakeSourceHost();
    const controller = new TsunamiSourceController(host, 6);
    controller.update(input());
    const cleared = controller.clear();
    expect(cleared.active).toEqual({ source_entities: 0, camera_flights: 0 });
    expect(cleared.resources.entities).toBe(0);
    expect(cleared.resources.pendingAsync).toBe(0);
    expect(host.removals).toBe(1);
    expect(host.cancelCalls).toBe(1);
    controller.clear();
    expect(host.removals).toBe(1);

    controller.update(input({ reference_capture: true }));
    const destroyed = controller.destroy();
    expect(destroyed.destroyed).toBe(true);
    expect(destroyed.active).toEqual({ source_entities: 0, camera_flights: 0 });
    expect(host.removals).toBe(2);
    controller.destroy();
    controller.clear();
    expect(host.removals).toBe(2);
    expect(() => controller.update(input())).toThrow(/destroyed/i);
  });

  it("completes 100 source-switch/clear cycles with zero entities and flights", async () => {
    const host = new FakeSourceHost();
    const controller = new TsunamiSourceController(host, 100);
    for (let cycle = 0; cycle < 100; cycle += 1) {
      const updated = controller.update(input({
        source: source({
          center: { lat_deg: -40 + cycle * 0.5, lon_deg: -150 + cycle },
          label: `Source ${cycle}`,
        }),
      }));
      expect(updated.active).toEqual({ source_entities: 1, camera_flights: 1 });
      const cleared = controller.clear();
      expect(cleared.active).toEqual({ source_entities: 0, camera_flights: 0 });
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
      expect(host.entity).toBeNull();
    }
    await Promise.resolve();
    expect(host.creates).toBe(100);
    expect(host.removals).toBe(100);
    expect(host.flights).toHaveLength(100);
    expect(host.cancelCalls).toBe(100);
    expect(host.renderRequests).toBe(200);
    expect(controller.diagnostics.cumulative).toMatchObject({
      created: 100,
      removed: 100,
      flights_started: 100,
      flights_cancelled: 100,
    });
  });
});
