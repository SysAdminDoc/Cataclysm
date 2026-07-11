import { describe, expect, it } from "vitest";
import { ResourceScope } from "../resources";
import type { FrameScheduler, ResourceCounts } from "../types";

const ZERO_COUNTS: ResourceCounts = {
  entities: 0,
  primitives: 0,
  imagery: 0,
  textures: 0,
  handlers: 0,
  listeners: 0,
  rafs: 0,
  pendingAsync: 0,
};

class FakeFrameScheduler implements FrameScheduler {
  nextId = 1;
  callbacks = new Map<number, FrameRequestCallback>();
  cancelled: number[] = [];

  request(callback: FrameRequestCallback): number {
    const id = this.nextId++;
    this.callbacks.set(id, callback);
    return id;
  }

  cancel(handle: number): void {
    this.cancelled.push(handle);
    this.callbacks.delete(handle);
  }

  run(handle: number, time = 16): void {
    const callback = this.callbacks.get(handle);
    this.callbacks.delete(handle);
    callback?.(time);
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ResourceScope counts and ownership", () => {
  it("reports exact frozen category counts and releases each lease once", () => {
    const scope = new ResourceScope(7, new FakeFrameScheduler());
    const cleaned: string[] = [];
    const leases = [
      scope.ownEntity(() => cleaned.push("entity")),
      scope.ownPrimitive(() => cleaned.push("primitive")),
      scope.ownImagery(() => cleaned.push("imagery")),
      scope.ownTexture(() => cleaned.push("texture")),
      scope.ownHandler(() => cleaned.push("handler")),
      scope.ownListener(() => cleaned.push("listener")),
      scope.ownPendingAsync(() => cleaned.push("pending")),
    ];
    const counts = scope.snapshotCounts();
    expect(counts).toEqual({
      entities: 1,
      primitives: 1,
      imagery: 1,
      textures: 1,
      handlers: 1,
      listeners: 1,
      rafs: 0,
      pendingAsync: 1,
    });
    expect(Object.isFrozen(counts)).toBe(true);
    expect(scope.generation).toBe(7);
    expect(scope.isCurrent(7)).toBe(true);
    expect(scope.isCurrent(8)).toBe(false);

    leases.forEach((lease) => {
      expect(lease.active).toBe(true);
      lease.release();
      lease.release();
      expect(lease.active).toBe(false);
    });
    expect(cleaned).toEqual(["entity", "primitive", "imagery", "texture", "handler", "listener", "pending"]);
    expect(scope.snapshotCounts()).toEqual(ZERO_COUNTS);
  });

  it("resets every category in global reverse registration order and renews its abort signal", () => {
    const scope = new ResourceScope(1, new FakeFrameScheduler());
    const order: string[] = [];
    const oldSignal = scope.signal;
    scope.ownEntity(() => order.push("entity"));
    scope.ownImagery(() => order.push("imagery"));
    scope.ownListener(() => order.push("listener"));
    scope.reset();

    expect(order).toEqual(["listener", "imagery", "entity"]);
    expect(oldSignal.aborted).toBe(true);
    expect(scope.signal).not.toBe(oldSignal);
    expect(scope.signal.aborted).toBe(false);
    expect(scope.destroyed).toBe(false);
    expect(scope.snapshotCounts()).toEqual(ZERO_COUNTS);

    scope.ownTexture(() => order.push("texture"));
    scope.reset();
    expect(order.at(-1)).toBe("texture");
  });

  it("destroys permanently and immediately cleans resources offered after destruction", () => {
    const scope = new ResourceScope(2, new FakeFrameScheduler());
    const order: string[] = [];
    scope.ownEntity(() => order.push("entity"));
    scope.ownPrimitive(() => order.push("primitive"));
    const signal = scope.signal;
    scope.destroy();
    scope.destroy();
    scope.reset();
    const late = scope.ownTexture(() => order.push("late"));

    expect(order).toEqual(["primitive", "entity", "late"]);
    expect(signal.aborted).toBe(true);
    expect(scope.destroyed).toBe(true);
    expect(scope.isCurrent(2)).toBe(false);
    expect(late.active).toBe(false);
    expect(scope.snapshotCounts()).toEqual(ZERO_COUNTS);
  });

  it("continues reverse cleanup after failures and leaves the scope reusable", () => {
    const scope = new ResourceScope(3, new FakeFrameScheduler());
    const order: string[] = [];
    scope.ownEntity(() => order.push("first"));
    scope.ownPrimitive(() => {
      order.push("throws");
      throw new Error("cleanup failed");
    });
    scope.ownListener(() => order.push("last"));

    expect(() => scope.reset()).toThrow(AggregateError);
    expect(order).toEqual(["last", "throws", "first"]);
    expect(scope.snapshotCounts()).toEqual(ZERO_COUNTS);
    expect(scope.signal.aborted).toBe(false);
    scope.ownTexture(() => order.push("reused")).release();
    expect(order.at(-1)).toBe("reused");
  });
});

describe("ResourceScope animation frames", () => {
  it("owns, completes, and idempotently cancels scheduled frames", () => {
    const scheduler = new FakeFrameScheduler();
    const scope = new ResourceScope(4, scheduler);
    const times: number[] = [];
    const first = scope.requestFrame((time) => times.push(time));
    expect(first).not.toBeNull();
    expect(scope.snapshotCounts().rafs).toBe(1);
    scheduler.run(first!.id, 42);
    expect(times).toEqual([42]);
    expect(first!.active).toBe(false);
    expect(scope.snapshotCounts().rafs).toBe(0);
    scope.cancel(first);
    expect(scheduler.cancelled).toEqual([]);

    const second = scope.requestFrame((time) => times.push(time));
    scope.cancel(second);
    scope.cancel(second);
    scheduler.run(second!.id, 99);
    expect(times).toEqual([42]);
    expect(scheduler.cancelled).toEqual([second!.id]);
    expect(scope.snapshotCounts().rafs).toBe(0);
  });

  it("cancels pending frames during reset and refuses frames after destroy", () => {
    const scheduler = new FakeFrameScheduler();
    const scope = new ResourceScope(5, scheduler);
    let calls = 0;
    const request = scope.requestFrame(() => calls++);
    scope.reset();
    scheduler.run(request!.id);
    expect(calls).toBe(0);
    expect(scheduler.cancelled).toEqual([request!.id]);
    scope.destroy();
    expect(scope.requestFrame(() => calls++)).toBeNull();
  });
});

describe("ResourceScope guarded async work", () => {
  it("returns current values and tracks pendingAsync exactly", async () => {
    const scope = new ResourceScope(6, new FakeFrameScheduler());
    const work = deferred<{ id: number }>();
    const disposed: number[] = [];
    const result = scope.guardAsync(() => work.promise, {
      disposeStale: (value) => disposed.push(value.id),
    });
    expect(scope.snapshotCounts().pendingAsync).toBe(1);
    work.resolve({ id: 10 });
    await expect(result).resolves.toEqual({ id: 10 });
    expect(disposed).toEqual([]);
    expect(scope.snapshotCounts().pendingAsync).toBe(0);
  });

  it("aborts reset work, disposes late resolutions, and suppresses stale rejection", async () => {
    const scope = new ResourceScope(7, new FakeFrameScheduler());
    const lateValue = deferred<{ id: number }>();
    const lateError = deferred<{ id: number }>();
    const signals: AbortSignal[] = [];
    const disposed: number[] = [];
    const valueResult = scope.guardAsync((signal) => {
      signals.push(signal);
      return lateValue.promise;
    }, { disposeStale: (value) => disposed.push(value.id) });
    const errorResult = scope.guardAsync((signal) => {
      signals.push(signal);
      return lateError.promise;
    }, { disposeStale: (value) => disposed.push(value.id) });
    expect(scope.snapshotCounts().pendingAsync).toBe(2);
    scope.reset();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(scope.snapshotCounts().pendingAsync).toBe(0);
    lateValue.resolve({ id: 11 });
    lateError.reject(new Error("late failure"));
    await expect(valueResult).resolves.toBeUndefined();
    await expect(errorResult).resolves.toBeUndefined();
    expect(disposed).toEqual([11]);
  });

  it("propagates current failures and does not start work after destroy", async () => {
    const scope = new ResourceScope(8, new FakeFrameScheduler());
    await expect(scope.guardAsync(
      async () => { throw new Error("current failure"); },
      { disposeStale() {} },
    )).rejects.toThrow("current failure");
    expect(scope.snapshotCounts().pendingAsync).toBe(0);
    scope.destroy();
    let started = false;
    await expect(scope.guardAsync(
      async () => {
        started = true;
        return 1;
      },
      { disposeStale() {} },
    )).resolves.toBeUndefined();
    expect(started).toBe(false);
  });
});

describe("ResourceScope repeated lifecycle", () => {
  it("survives 100 update/reset cycles without resource, RAF, or async leaks", async () => {
    const scheduler = new FakeFrameScheduler();
    const scope = new ResourceScope(9, scheduler);
    const cleanup: number[] = [];
    const disposed: number[] = [];
    const work: Array<ReturnType<typeof deferred<{ cycle: number }>>> = [];
    const results: Array<Promise<{ cycle: number } | undefined>> = [];

    for (let cycle = 0; cycle < 100; cycle += 1) {
      scope.ownEntity(() => cleanup.push(cycle));
      scope.ownPrimitive(() => cleanup.push(cycle));
      scope.ownImagery(() => cleanup.push(cycle));
      scope.ownTexture(() => cleanup.push(cycle));
      scope.ownHandler(() => cleanup.push(cycle));
      scope.ownListener(() => cleanup.push(cycle));
      scope.requestFrame(() => cleanup.push(-1));
      const pending = deferred<{ cycle: number }>();
      work.push(pending);
      results.push(scope.guardAsync(() => pending.promise, {
        disposeStale: (value) => disposed.push(value.cycle),
      }));
      expect(scope.snapshotCounts()).toEqual({
        entities: 1,
        primitives: 1,
        imagery: 1,
        textures: 1,
        handlers: 1,
        listeners: 1,
        rafs: 1,
        pendingAsync: 1,
      });
      scope.reset();
      expect(scope.snapshotCounts()).toEqual(ZERO_COUNTS);
    }

    work.forEach((pending, cycle) => pending.resolve({ cycle }));
    expect(await Promise.all(results)).toEqual(Array(100).fill(undefined));
    expect(cleanup).toHaveLength(600);
    expect(scheduler.cancelled).toHaveLength(100);
    expect(disposed).toEqual(Array.from({ length: 100 }, (_, index) => index));
    expect(scope.snapshotCounts()).toEqual(ZERO_COUNTS);
    scope.destroy();
    expect(scope.snapshotCounts()).toEqual(ZERO_COUNTS);
  });
});
