import { describe, expect, it } from "vitest";
import {
  RendererClock,
  type RendererSimulationFrame,
} from "../renderer-clock";

class FakeRaf {
  private nextHandle = 1;
  readonly callbacks = new Map<number, FrameRequestCallback>();
  maximumOwnedCallbacks = 0;

  readonly request = (callback: FrameRequestCallback): number => {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.callbacks.set(handle, callback);
    this.maximumOwnedCallbacks = Math.max(this.maximumOwnedCallbacks, this.callbacks.size);
    return handle;
  };

  readonly cancel = (handle: number): void => {
    this.callbacks.delete(handle);
  };

  fireNext(timestamp = 0): void {
    const entry = this.callbacks.entries().next().value as
      | [number, FrameRequestCallback]
      | undefined;
    if (!entry) throw new Error("no RAF callback is scheduled");
    const [handle, callback] = entry;
    this.callbacks.delete(handle);
    callback(timestamp);
  }
}

describe("RendererClock", () => {
  it("owns at most one RAF callback and has idempotent lifecycle operations", () => {
    const raf = new FakeRaf();
    const delivered: RendererSimulationFrame[] = [];
    const clock = new RendererClock({
      mode: "raf",
      onFrame: (frame) => delivered.push({ ...frame }),
      requestFrame: raf.request,
      cancelFrame: raf.cancel,
    });

    clock.start();
    clock.start();
    expect(raf.callbacks.size).toBe(1);
    expect(clock.diagnostics().ownedCallbackCount).toBe(1);

    clock.present({ solverTick: 17, simulationTimeS: 1.7 });
    raf.fireNext(16.67);
    expect(delivered).toEqual([{ solverTick: 17, simulationTimeS: 1.7 }]);
    expect(raf.callbacks.size).toBe(1);
    expect(raf.maximumOwnedCallbacks).toBe(1);

    clock.stop();
    clock.stop();
    expect(raf.callbacks.size).toBe(0);
    expect(clock.diagnostics()).toMatchObject({
      running: false,
      ownedCallbackCount: 0,
      startCount: 1,
      stopCount: 1,
    });

    clock.reset();
    clock.reset();
    expect(clock.diagnostics()).toMatchObject({
      solverTick: 0,
      simulationTimeS: 0,
      resetCount: 2,
    });

    clock.destroy();
    clock.destroy();
    clock.start();
    expect(clock.present({ solverTick: 18, simulationTimeS: 1.8 })).toBe(false);
    expect(clock.diagnostics()).toMatchObject({
      destroyed: true,
      running: false,
      ownedCallbackCount: 0,
    });
  });

  it("does not reschedule when the frame consumer stops the clock", () => {
    const raf = new FakeRaf();
    const clock = new RendererClock({
      mode: "raf",
      onFrame: () => clock.stop(),
      requestFrame: raf.request,
      cancelFrame: raf.cancel,
    });

    clock.start();
    raf.fireNext();
    expect(raf.callbacks.size).toBe(0);
    expect(clock.diagnostics()).toMatchObject({
      running: false,
      ownedCallbackCount: 0,
      firedCallbackCount: 1,
      deliveredFrameCount: 1,
    });
  });

  it("presents exact authoritative ticks and times in deterministic manual mode", () => {
    const delivered: RendererSimulationFrame[] = [];
    const clock = new RendererClock({
      mode: "manual",
      onFrame: (frame) => delivered.push({ ...frame }),
    });

    expect(clock.present({ solverTick: 4, simulationTimeS: 0.4 })).toBe(false);
    clock.start();
    expect(clock.present({ solverTick: 5, simulationTimeS: 0.5 })).toBe(true);
    expect(clock.present({ solverTick: 50, simulationTimeS: 5 })).toBe(true);
    clock.stop();

    expect(delivered).toEqual([
      { solverTick: 5, simulationTimeS: 0.5 },
      { solverTick: 50, simulationTimeS: 5 },
    ]);
    expect(clock.diagnostics()).toMatchObject({
      mode: "manual",
      ownedCallbackCount: 0,
      requestedCallbackCount: 0,
      cancelledCallbackCount: 0,
      firedCallbackCount: 0,
      deliveredFrameCount: 2,
    });
  });

  it("leaves zero callbacks after 100 complete replay cycles", () => {
    const manualClock = new RendererClock({ mode: "manual", onFrame: () => {} });
    const raf = new FakeRaf();
    const realClock = new RendererClock({
      mode: "raf",
      onFrame: () => {},
      requestFrame: raf.request,
      cancelFrame: raf.cancel,
    });

    for (let replay = 0; replay < 100; replay += 1) {
      manualClock.reset();
      manualClock.start();
      for (let tick = 0; tick <= 102; tick += 1) {
        manualClock.present({ solverTick: tick, simulationTimeS: tick * 0.1 });
      }
      manualClock.stop();

      realClock.reset();
      realClock.start();
      realClock.present({ solverTick: 102, simulationTimeS: 10.2 });
      realClock.stop();
      expect(raf.callbacks.size).toBe(0);
    }

    manualClock.destroy();
    realClock.destroy();
    expect(manualClock.diagnostics()).toMatchObject({
      ownedCallbackCount: 0,
      deliveredFrameCount: 10_300,
      startCount: 100,
      stopCount: 100,
      resetCount: 100,
    });
    expect(realClock.diagnostics()).toMatchObject({
      ownedCallbackCount: 0,
      requestedCallbackCount: 100,
      cancelledCallbackCount: 100,
      firedCallbackCount: 0,
    });
    expect(raf.maximumOwnedCallbacks).toBe(1);
  });

  it("rejects invalid simulation coordinates without integrating them", () => {
    const clock = new RendererClock({ mode: "manual", onFrame: () => {} });
    expect(() => clock.present({ solverTick: -1, simulationTimeS: 0 })).toThrow(RangeError);
    expect(() => clock.present({ solverTick: 1.5, simulationTimeS: 0 })).toThrow(RangeError);
    expect(() => clock.present({ solverTick: 1, simulationTimeS: Number.NaN })).toThrow(RangeError);
    expect(() => clock.reset({ solverTick: 1, simulationTimeS: -0.1 })).toThrow(RangeError);
  });
});
