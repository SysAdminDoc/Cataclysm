import { describe, expect, it } from "vitest";
import {
  AsyncResourceCoordinator,
  type AsyncResourceDisposalContext,
} from "../async-resource-coordinator";

interface TestResource {
  id: string;
}

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
  reject: (reason?: unknown) => void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function harness() {
  const disposed: Array<{ resource: TestResource; context: AsyncResourceDisposalContext }> = [];
  const activated: TestResource[] = [];
  const coordinator = new AsyncResourceCoordinator<TestResource>({
    dispose: (resource, context) => disposed.push({ resource, context }),
  });
  return { coordinator, disposed, activated };
}

describe("AsyncResourceCoordinator", () => {
  it("disposes late results from an invalidated viewer generation", async () => {
    const { coordinator, disposed, activated } = harness();
    const firstGeneration = coordinator.beginViewerGeneration();
    const load = deferred<TestResource>();
    const outcomePromise = coordinator.replace(
      firstGeneration,
      ({ signal }) => {
        expect(signal.aborted).toBe(false);
        return load.promise;
      },
      (resource) => activated.push(resource),
    );

    const secondGeneration = coordinator.beginViewerGeneration();
    load.resolve({ id: "old-imagery" });
    await expect(outcomePromise).resolves.toMatchObject({ status: "stale" });
    expect(secondGeneration).toBe(firstGeneration + 1);
    expect(activated).toEqual([]);
    expect(disposed).toEqual([
      {
        resource: { id: "old-imagery" },
        context: {
          reason: "viewer_generation_changed",
          ownership: "candidate",
          requestId: 1,
          viewerGeneration: firstGeneration,
        },
      },
    ]);
    expect(coordinator.diagnostics()).toMatchObject({
      pendingResourceCount: 0,
      activeResourceCount: 0,
      abortedRequestCount: 1,
      staleResultCount: 1,
      disposedCandidateCount: 1,
    });
  });

  it("atomically replaces active resources and invalidates ownership", async () => {
    const { coordinator, disposed, activated } = harness();
    const generation = coordinator.beginViewerGeneration();
    await coordinator.replace(
      generation,
      async () => ({ id: "terrain-a" }),
      (resource) => activated.push(resource),
    );
    await coordinator.replace(
      generation,
      async () => ({ id: "terrain-b" }),
      (resource) => activated.push(resource),
    );

    expect(activated.map((resource) => resource.id)).toEqual(["terrain-a", "terrain-b"]);
    expect(disposed).toHaveLength(1);
    expect(disposed[0]).toMatchObject({
      resource: { id: "terrain-a" },
      context: { reason: "replaced", ownership: "active" },
    });
    coordinator.invalidate("viewer_removed");
    coordinator.invalidate("viewer_removed");
    expect(disposed[1]).toMatchObject({
      resource: { id: "terrain-b" },
      context: { reason: "viewer_removed", ownership: "active" },
    });
    expect(coordinator.diagnostics()).toMatchObject({
      pendingResourceCount: 0,
      activeResourceCount: 0,
      activatedResourceCount: 2,
      disposedActiveCount: 2,
    });
  });

  it("aborts superseded work without disposing the active resource", async () => {
    const { coordinator, disposed } = harness();
    const generation = coordinator.beginViewerGeneration();
    await coordinator.replace(generation, async () => ({ id: "base-layer" }), () => {});

    const pending = deferred<TestResource>();
    const outcome = coordinator.replace(generation, ({ signal }) => {
      signal.addEventListener("abort", () => pending.reject(new DOMException("cancelled", "AbortError")));
      return pending.promise;
    }, () => {});
    coordinator.abortPending("style_changed");

    await expect(outcome).resolves.toMatchObject({ status: "aborted" });
    expect(disposed).toEqual([]);
    expect(coordinator.diagnostics()).toMatchObject({
      pendingResourceCount: 0,
      activeResourceCount: 1,
      abortedRequestCount: 1,
    });
  });

  it("disposes a candidate when activation fails and rejects stale generations", async () => {
    const { coordinator, disposed } = harness();
    const generation = coordinator.beginViewerGeneration();
    await expect(
      coordinator.replace(
        generation,
        async () => ({ id: "bad-primitive" }),
        () => {
          throw new Error("viewer was destroyed");
        },
      ),
    ).rejects.toThrow("viewer was destroyed");
    await expect(
      coordinator.replace(generation - 1, async () => ({ id: "never-loaded" }), () => {}),
    ).resolves.toMatchObject({ status: "stale" });
    expect(disposed[0]).toMatchObject({
      resource: { id: "bad-primitive" },
      context: { reason: "activation_failed", ownership: "candidate" },
    });
    expect(coordinator.diagnostics()).toMatchObject({
      pendingResourceCount: 0,
      activeResourceCount: 0,
      failedActivationCount: 1,
      rejectedGenerationCount: 1,
    });
  });

  it("leaves no pending or active resources after 100 viewer/replay cycles", async () => {
    const { coordinator, disposed } = harness();

    for (let cycle = 0; cycle < 100; cycle += 1) {
      const generation = coordinator.beginViewerGeneration();
      await coordinator.replace(
        generation,
        async () => ({ id: `active-${cycle}` }),
        () => {},
      );

      const late = deferred<TestResource>();
      const lateOutcome = coordinator.replace(generation, () => late.promise, () => {});
      coordinator.invalidate(`cycle-${cycle}`);
      late.resolve({ id: `stale-${cycle}` });
      await expect(lateOutcome).resolves.toMatchObject({ status: "stale" });
      expect(coordinator.diagnostics()).toMatchObject({
        pendingResourceCount: 0,
        activeResourceCount: 0,
      });
    }

    coordinator.destroy();
    coordinator.destroy();
    expect(disposed).toHaveLength(200);
    expect(coordinator.diagnostics()).toMatchObject({
      destroyed: true,
      pendingResourceCount: 0,
      activeResourceCount: 0,
      startedRequestCount: 200,
      activatedResourceCount: 100,
      abortedRequestCount: 100,
      staleResultCount: 100,
      disposedCandidateCount: 100,
      disposedActiveCount: 100,
    });
  });
});
