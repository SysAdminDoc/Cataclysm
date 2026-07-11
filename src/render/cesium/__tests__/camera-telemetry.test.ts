import { describe, expect, it, vi } from "vitest";

import {
  CameraTelemetryController,
  type CameraTelemetry,
  type CameraTelemetryHost,
} from "../camera-telemetry";

class FakeHost implements CameraTelemetryHost {
  listeners = new Set<() => void>();
  value: CameraTelemetry = { lat: 1, lon: 2, altitudeM: 3, headingDeg: 4 };

  read(): CameraTelemetry { return this.value; }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(): void { for (const listener of this.listeners) listener(); }
}

describe("CameraTelemetryController", () => {
  it("owns exactly one listener and tears it down idempotently", () => {
    const host = new FakeHost();
    const sink = vi.fn();
    const controller = new CameraTelemetryController(host, sink);

    controller.start();
    controller.start();
    expect(host.listeners.size).toBe(1);
    expect(sink).toHaveBeenCalledWith(host.value);
    host.emit();
    expect(controller.diagnostics()).toMatchObject({ listeners: 1, emissions: 2 });

    controller.destroy();
    controller.destroy();
    expect(host.listeners.size).toBe(0);
    expect(controller.diagnostics()).toMatchObject({ listeners: 0, destroyed: true });
  });

  it("leaks no listeners across 100 viewer cycles", () => {
    const host = new FakeHost();
    for (let cycle = 0; cycle < 100; cycle += 1) {
      const controller = new CameraTelemetryController(host, () => {});
      controller.start();
      host.emit();
      controller.destroy();
      expect(host.listeners.size).toBe(0);
    }
  });
});
