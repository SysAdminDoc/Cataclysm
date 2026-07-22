import { describe, expect, it, vi } from "vitest";
import { FrameCoalescedCoordinatePicker } from "../coordinate-pick-scheduler";

function animationFrameHarness() {
  let nextId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  return {
    requestFrame(callback: FrameRequestCallback) {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, callback);
      return id;
    },
    cancelFrame(id: number) {
      callbacks.delete(id);
    },
    flush() {
      const queued = [...callbacks.values()];
      callbacks.clear();
      queued.forEach((callback) => callback(16));
    },
    pendingCount: () => callbacks.size,
  };
}

describe("FrameCoalescedCoordinatePicker", () => {
  it("keeps analytical picking out of the pointer event and preserves its result", () => {
    const frames = animationFrameHarness();
    const pick = vi.fn((position: { x: number; y: number }) => ({
      lat: position.y / 10,
      lon: position.x / 10,
    }));
    const commit = vi.fn();
    const scheduler = new FrameCoalescedCoordinatePicker({
      pick,
      commit,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });

    expect(scheduler.schedule({ x: -825, y: 351.5 })).toBe(true);
    expect(pick).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();

    frames.flush();
    expect(pick).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith({ lat: 35.15, lon: -82.5 });
    expect(scheduler.diagnostics()).toMatchObject({
      pending: false,
      scheduledFrameCount: 1,
      completedPickCount: 1,
    });
  });

  it("coalesces a playback-frame burst to the newest coordinate", () => {
    const frames = animationFrameHarness();
    const committed: number[] = [];
    const scheduler = new FrameCoalescedCoordinatePicker({
      pick: (position: number) => position,
      commit: (position) => committed.push(position),
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });

    for (let position = 0; position < 60; position += 1) scheduler.schedule(position);
    expect(frames.pendingCount()).toBe(1);
    frames.flush();
    expect(committed).toEqual([59]);
    expect(scheduler.diagnostics()).toMatchObject({
      scheduledFrameCount: 1,
      coalescedRequestCount: 59,
      completedPickCount: 1,
    });
  });

  it("cancels pending work when interaction ownership is released", () => {
    const frames = animationFrameHarness();
    const commit = vi.fn();
    const scheduler = new FrameCoalescedCoordinatePicker({
      pick: (position: number) => position,
      commit,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });

    scheduler.schedule(42);
    scheduler.destroy();
    scheduler.destroy();
    frames.flush();

    expect(commit).not.toHaveBeenCalled();
    expect(scheduler.schedule(7)).toBe(false);
    expect(scheduler.diagnostics()).toMatchObject({ destroyed: true, pending: false });
  });
});
