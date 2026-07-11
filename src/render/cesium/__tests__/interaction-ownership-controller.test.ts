import { describe, expect, it } from "vitest";
import {
  InteractionOwnershipController,
  type InteractionOwnershipHost,
} from "../interaction-ownership-controller";

type Mode = "pick" | "inspect";

interface Token {
  id: number;
}

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function harness() {
  let nextId = 1;
  const handlers = new Set<Token>();
  const listeners = new Set<Token>();
  const entities = new Set<Token>();
  const host: InteractionOwnershipHost<Mode, Token, Token, Token> = {
    attachHandler: () => {
      const token = { id: nextId++ };
      handlers.add(token);
      return token;
    },
    detachHandler: (handler) => handlers.delete(handler),
    attachListener: () => {
      const token = { id: nextId++ };
      listeners.add(token);
      return token;
    },
    detachListener: (listener) => listeners.delete(listener),
    removeEntity: (entity) => entities.delete(entity),
  };
  const createEntity = (): Token => {
    const entity = { id: nextId++ };
    entities.add(entity);
    return entity;
  };
  const controller = new InteractionOwnershipController(host);
  return { controller, handlers, listeners, entities, createEntity };
}

describe("InteractionOwnershipController", () => {
  it("keeps pick and inspect ownership mutually exclusive and idempotent", () => {
    const { controller, handlers, listeners } = harness();
    const pick = controller.enable("pick");
    expect(pick).not.toBeNull();
    expect(controller.enable("pick")).toEqual(pick);
    expect(handlers.size).toBe(1);
    expect(listeners.size).toBe(1);

    const inspect = controller.enable("inspect");
    expect(inspect?.generation).toBe((pick?.generation ?? 0) + 1);
    expect(handlers.size).toBe(1);
    expect(listeners.size).toBe(1);
    expect(controller.diagnostics()).toMatchObject({
      mode: "inspect",
      ownedHandlerCount: 1,
      ownedListenerCount: 1,
      enableCount: 2,
      disableCount: 1,
    });

    controller.disable();
    controller.disable();
    expect(handlers.size).toBe(0);
    expect(listeners.size).toBe(0);
    expect(controller.diagnostics()).toMatchObject({
      enabled: false,
      ownedHandlerCount: 0,
      ownedListenerCount: 0,
      disableCount: 2,
    });
  });

  it("invalidates stale generations and disposes rejected entities", () => {
    const { controller, entities, createEntity } = harness();
    const lease = controller.enable("inspect");
    if (!lease) throw new Error("expected an inspect lease");
    controller.invalidateGeneration();
    const staleEntity = createEntity();
    expect(controller.ownEntity(lease.generation, staleEntity)).toBe(false);
    expect(entities.size).toBe(0);
    expect(controller.diagnostics()).toMatchObject({
      enabled: false,
      ownedEntityCount: 0,
      invalidationCount: 1,
      removedEntityCount: 1,
    });
  });

  it("commits only the newest async inspect result", async () => {
    const { controller, entities, createEntity } = harness();
    const lease = controller.enable("inspect");
    if (!lease) throw new Error("expected an inspect lease");
    const first = deferred<string>();
    const second = deferred<string>();
    const firstOutcome = controller.runLatest(lease.generation, () => first.promise, createEntity);
    const secondOutcome = controller.runLatest(lease.generation, () => second.promise, createEntity);

    second.resolve("newest");
    await expect(secondOutcome).resolves.toMatchObject({ status: "committed" });
    first.resolve("stale");
    await expect(firstOutcome).resolves.toMatchObject({ status: "stale" });
    expect(entities.size).toBe(1);
    expect(controller.diagnostics()).toMatchObject({
      pendingAsyncCount: 0,
      ownedEntityCount: 1,
      startedAsyncCount: 2,
      completedAsyncCount: 1,
      abortedAsyncCount: 1,
      staleAsyncCount: 1,
    });
    controller.disable();
    expect(entities.size).toBe(0);
  });

  it("destroy is idempotent and prevents later ownership", () => {
    const { controller, handlers, listeners, entities, createEntity } = harness();
    const lease = controller.enable("inspect");
    if (!lease) throw new Error("expected an inspect lease");
    controller.ownEntity(lease.generation, createEntity());
    controller.destroy();
    controller.destroy();
    expect(controller.enable("pick")).toBeNull();
    expect(handlers.size).toBe(0);
    expect(listeners.size).toBe(0);
    expect(entities.size).toBe(0);
    expect(controller.diagnostics()).toMatchObject({
      destroyed: true,
      enabled: false,
      ownedHandlerCount: 0,
      ownedListenerCount: 0,
      ownedEntityCount: 0,
      pendingAsyncCount: 0,
    });
  });

  it("leaves zero resources and pending work after 100 pick/inspect cycles", async () => {
    const { controller, handlers, listeners, entities, createEntity } = harness();

    for (let cycle = 0; cycle < 100; cycle += 1) {
      controller.enable("pick");
      controller.disable();

      const inspect = controller.enable("inspect");
      if (!inspect) throw new Error("expected an inspect lease");
      await controller.runLatest(
        inspect.generation,
        async () => `result-${cycle}`,
        createEntity,
      );
      const late = deferred<string>();
      const lateOutcome = controller.runLatest(
        inspect.generation,
        () => late.promise,
        createEntity,
      );
      controller.disable();
      late.resolve(`late-${cycle}`);
      await expect(lateOutcome).resolves.toMatchObject({ status: "stale" });

      expect(handlers.size).toBe(0);
      expect(listeners.size).toBe(0);
      expect(entities.size).toBe(0);
      expect(controller.diagnostics()).toMatchObject({
        ownedHandlerCount: 0,
        ownedListenerCount: 0,
        ownedEntityCount: 0,
        pendingAsyncCount: 0,
      });
    }

    controller.destroy();
    expect(controller.diagnostics()).toMatchObject({
      destroyed: true,
      enableCount: 200,
      disableCount: 200,
      attachedHandlerCount: 200,
      detachedHandlerCount: 200,
      attachedListenerCount: 200,
      detachedListenerCount: 200,
      committedEntityCount: 100,
      removedEntityCount: 100,
      startedAsyncCount: 200,
      completedAsyncCount: 100,
      abortedAsyncCount: 100,
      staleAsyncCount: 100,
      ownedHandlerCount: 0,
      ownedListenerCount: 0,
      ownedEntityCount: 0,
      pendingAsyncCount: 0,
    });
  });
});
