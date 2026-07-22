import { describe, expect, it } from "vitest";
import {
  OutcomeFocusController,
  type OutcomeFocusHost,
  type OutcomeFocusRequest,
  type OutcomeFocusTarget,
} from "../outcome-focus";

type Flight = { target: OutcomeFocusTarget; signal: AbortSignal; resolve(value: boolean): void };

class FakeHost implements OutcomeFocusHost {
  cancellations = 0;
  flights: Flight[] = [];
  instantTargets: OutcomeFocusTarget[] = [];
  focusedTimes: number[] = [];
  renders = 0;
  shownTargets: OutcomeFocusTarget[] = [];
  clears = 0;

  cancelCameraFlight(): void {
    this.cancellations += 1;
    for (const flight of this.flights) flight.resolve(false);
  }

  flyTo(target: OutcomeFocusTarget, signal: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => this.flights.push({ target, signal, resolve }));
  }

  setCameraView(target: OutcomeFocusTarget): void { this.instantTargets.push(target); }
  focusSimulationTime(time_s: number): void { this.focusedTimes.push(time_s); }
  requestRender(): void { this.renders += 1; }
  showFocus(target: OutcomeFocusTarget): void { this.shownTargets.push(target); }
  clearFocus(): void { this.clears += 1; }
}

function request(overrides: Partial<OutcomeFocusRequest> = {}): OutcomeFocusRequest {
  return {
    request_id: "coast:miyako:900",
    place: { label: "Miyako, Japan", lat_deg: 39.64, lon_deg: 141.96, range_m: 180_000 },
    simulation_time_s: 900,
    ...overrides,
  };
}

describe("OutcomeFocusController", () => {
  it("applies place and modeled time once per stable request", () => {
    const host = new FakeHost();
    const controller = new OutcomeFocusController(host, 4);
    const first = controller.update(request(), { reduced_motion: false, reference_capture: false });
    controller.update(request(), { reduced_motion: false, reference_capture: false });

    expect(host.focusedTimes).toEqual([900]);
    expect(host.cancellations).toBe(1);
    expect(host.flights).toHaveLength(1);
    expect(host.shownTargets).toHaveLength(1);
    expect(host.shownTargets[0].label).toBe("Miyako, Japan");
    expect(host.flights[0].target).toMatchObject({
      lat_deg: 39.64,
      lon_deg: 141.96,
      range_m: 180_000,
      heading_rad: 0,
      pitch_rad: -55 * Math.PI / 180,
      duration_s: 0.9,
    });
    expect(first).toMatchObject({
      generation: 4,
      mode: "flight",
      active_request_id: "coast:miyako:900",
      pending_flights: 1,
      requests_applied: 1,
    });
  });

  it("cancels a stale flight before applying the next place and time", async () => {
    const host = new FakeHost();
    const controller = new OutcomeFocusController(host, 5);
    controller.update(request(), { reduced_motion: false, reference_capture: false });
    controller.update(request({
      request_id: "coast:sendai:1200",
      place: { lat_deg: 38.27, lon_deg: 140.87 },
      simulation_time_s: 1200,
    }), { reduced_motion: false, reference_capture: false });
    await Promise.resolve();

    expect(host.cancellations).toBe(2);
    expect(host.flights[0].signal.aborted).toBe(true);
    expect(host.flights).toHaveLength(2);
    expect(host.focusedTimes).toEqual([900, 1200]);
    expect(host.clears).toBe(0);
    expect(controller.diagnostics).toMatchObject({
      active_request_id: "coast:sendai:1200",
      pending_flights: 1,
      flights_cancelled: 1,
    });
  });

  it("uses an instant view for reduced motion or explicit state restoration and does not mutate capture poses", () => {
    const host = new FakeHost();
    const controller = new OutcomeFocusController(host, 6);
    controller.update(request(), { reduced_motion: false, reference_capture: true });
    expect(host.focusedTimes).toEqual([]);
    expect(host.flights).toEqual([]);
    expect(controller.diagnostics.mode).toBe("reference_capture");

    controller.update(request(), { reduced_motion: true, reference_capture: false });
    expect(host.focusedTimes).toEqual([900]);
    expect(host.instantTargets).toHaveLength(1);
    expect(host.instantTargets[0].duration_s).toBe(0);
    expect(host.renders).toBe(1);
    expect(host.cancellations).toBe(1);
    expect(controller.diagnostics.mode).toBe("instant");

    controller.update(request({ request_id: "portable-package", instant: true }), {
      reduced_motion: false,
      reference_capture: false,
    });
    expect(host.instantTargets).toHaveLength(2);
    expect(host.instantTargets[1].duration_s).toBe(0);
    expect(host.flights).toEqual([]);
    expect(host.renders).toBe(2);
  });

  it("rejects invalid place/time and destroys with no pending flight", () => {
    const host = new FakeHost();
    const controller = new OutcomeFocusController(host, 7);
    controller.update(request({ simulation_time_s: -1 }), {
      reduced_motion: false,
      reference_capture: false,
    });
    expect(controller.diagnostics).toMatchObject({
      mode: "none",
      active_request_id: null,
      invalid_requests: 1,
      pending_flights: 0,
    });
    expect(host.clears).toBe(1);

    controller.update(request(), { reduced_motion: false, reference_capture: false });
    const destroyed = controller.destroy();
    expect(host.cancellations).toBe(2);
    expect(host.flights[0].signal.aborted).toBe(true);
    expect(host.clears).toBe(2);
    expect(destroyed).toMatchObject({ destroyed: true, mode: "none", pending_flights: 0 });
    expect(() => controller.update(request(), {
      reduced_motion: false,
      reference_capture: false,
    })).toThrow(/destroyed/i);
  });
});
