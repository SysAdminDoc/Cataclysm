import { describe, expect, it, vi } from "vitest";
import { AsyncGenerationOwner } from "../generation";

type Deferred<Value> = {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
  reject: (reason: unknown) => void;
};

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("AsyncGenerationOwner", () => {
  it("disposes every stale result across 100 replay cycles without growing pending work", async () => {
    const owner = new AsyncGenerationOwner<object>();
    const viewer = {};
    const commits: number[] = [];
    const disposed: number[] = [];

    for (let cycle = 0; cycle < 100; cycle += 1) {
      const token = owner.setContext(viewer, "replay", cycle);
      const guarded = owner.guard(
        token,
        Promise.resolve(cycle),
        (value) => commits.push(value),
        (value) => disposed.push(value),
      );
      expect(owner.pendingCount).toBe(1);
      owner.invalidate();
      await expect(guarded).resolves.toBe("stale");
      expect(owner.pendingCount).toBe(0);
    }

    expect(commits).toEqual([]);
    expect(disposed).toEqual(Array.from({ length: 100 }, (_, index) => index));
    expect(owner.diagnostics()).toEqual({
      generation: 200,
      pending: 0,
      active: false,
      destroyed: false,
    });
  });

  it("commits only the newest request when promises resolve out of order", async () => {
    const owner = new AsyncGenerationOwner<object>();
    const viewer = {};
    const older = deferred<string>();
    const newer = deferred<string>();
    const committed: string[] = [];
    const disposed: string[] = [];

    const olderToken = owner.setContext(viewer, "imagery", "request-a");
    const olderResult = owner.guard(olderToken, older.promise, (value) => committed.push(value), (value) => disposed.push(value));
    const newerToken = owner.setContext(viewer, "imagery", "request-b");
    const newerResult = owner.guard(newerToken, newer.promise, (value) => committed.push(value), (value) => disposed.push(value));
    expect(owner.pendingCount).toBe(2);

    newer.resolve("newer");
    await expect(newerResult).resolves.toBe("committed");
    older.resolve("older");
    await expect(olderResult).resolves.toBe("stale");

    expect(committed).toEqual(["newer"]);
    expect(disposed).toEqual(["older"]);
    expect(owner.pendingCount).toBe(0);
  });

  it("invalidates independently on viewer, mode, and request identity changes", () => {
    const owner = new AsyncGenerationOwner<object>();
    const firstViewer = {};
    const secondViewer = {};
    const first = owner.setContext(firstViewer, "inspect", 1);

    const same = owner.setContext(firstViewer, "inspect", 1);
    expect(same.generation).toBe(first.generation);
    expect(owner.isCurrent(first)).toBe(true);

    const modeChanged = owner.setContext(firstViewer, "pick", 1);
    expect(owner.isCurrent(first)).toBe(false);
    expect(owner.isCurrent(modeChanged)).toBe(true);

    const requestChanged = owner.setContext(firstViewer, "pick", 2);
    expect(owner.isCurrent(modeChanged)).toBe(false);
    expect(owner.isCurrent(requestChanged)).toBe(true);

    const viewerChanged = owner.setContext(secondViewer, "pick", 2);
    expect(owner.isCurrent(requestChanged)).toBe(false);
    expect(owner.isCurrent(viewerChanged)).toBe(true);
    expect(owner.generation).toBe(4);
  });

  it("decrements pending diagnostics when work rejects", async () => {
    const owner = new AsyncGenerationOwner<object>();
    const token = owner.setContext({}, "terrain", 1);
    const commit = vi.fn();
    const dispose = vi.fn();
    const work = deferred<string>();
    const guarded = owner.guard(token, work.promise, commit, dispose);

    expect(owner.pendingCount).toBe(1);
    work.reject(new Error("provider failed"));
    await expect(guarded).rejects.toThrow("provider failed");
    expect(owner.pendingCount).toBe(0);
    expect(commit).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
  });

  it("consumes a stale rejection so it cannot replace the current result", async () => {
    const owner = new AsyncGenerationOwner<object>();
    const viewer = {};
    const older = deferred<string>();
    const newer = deferred<string>();
    const committed: string[] = [];

    const olderToken = owner.setContext(viewer, "inspect", "older");
    const olderResult = owner.guard(olderToken, older.promise, (value) => committed.push(value));
    const newerToken = owner.setContext(viewer, "inspect", "newer");
    const newerResult = owner.guard(newerToken, newer.promise, (value) => committed.push(value));

    newer.resolve("newer result");
    await expect(newerResult).resolves.toBe("committed");
    older.reject(new Error("late failure"));
    await expect(olderResult).resolves.toBe("stale");
    expect(committed).toEqual(["newer result"]);
  });

  it("makes destruction idempotent and prevents late commits or reuse", async () => {
    const owner = new AsyncGenerationOwner<object>();
    const viewer = {};
    const work = deferred<{ destroy: () => void }>();
    const token = owner.setContext(viewer, "swe", 1);
    const commit = vi.fn();
    const destroy = vi.fn();
    const guarded = owner.guard(token, work.promise, commit, (value) => value.destroy());

    owner.destroy();
    owner.destroy();
    work.resolve({ destroy });

    await expect(guarded).resolves.toBe("stale");
    expect(commit).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledOnce();
    expect(owner.diagnostics()).toEqual({
      generation: 2,
      pending: 0,
      active: false,
      destroyed: true,
    });
    expect(() => owner.setContext(viewer, "swe", 2)).toThrow("AsyncGenerationOwner is destroyed.");
  });
});
