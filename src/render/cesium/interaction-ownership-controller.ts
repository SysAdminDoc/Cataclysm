export interface InteractionOwnershipHost<Mode, Handler, Listener, Entity> {
  attachHandler: (mode: Mode, generation: number) => Handler;
  detachHandler: (handler: Handler) => void;
  attachListener: (mode: Mode, generation: number) => Listener;
  detachListener: (listener: Listener) => void;
  removeEntity: (entity: Entity) => void;
}

export interface InteractionLease<Mode> {
  mode: Mode;
  generation: number;
}

export interface InteractionAsyncContext<Mode> extends InteractionLease<Mode> {
  requestId: number;
  signal: AbortSignal;
}

export type InteractionAsyncStatus = "committed" | "aborted" | "stale";

export interface InteractionAsyncOutcome {
  status: InteractionAsyncStatus;
  requestId: number;
  generation: number;
}

export interface InteractionOwnershipDiagnostics<Mode> {
  destroyed: boolean;
  enabled: boolean;
  mode: Mode | null;
  generation: number;
  ownedHandlerCount: 0 | 1;
  ownedListenerCount: 0 | 1;
  ownedEntityCount: 0 | 1;
  pendingAsyncCount: 0 | 1;
  enableCount: number;
  disableCount: number;
  invalidationCount: number;
  attachedHandlerCount: number;
  detachedHandlerCount: number;
  attachedListenerCount: number;
  detachedListenerCount: number;
  committedEntityCount: number;
  removedEntityCount: number;
  startedAsyncCount: number;
  completedAsyncCount: number;
  abortedAsyncCount: number;
  staleAsyncCount: number;
  failedAsyncCount: number;
}

interface ActiveInteraction<Mode, Handler, Listener, Entity> {
  mode: Mode;
  generation: number;
  handler: Handler;
  listener: Listener;
  entity: Entity | null;
}

interface PendingInteractionRequest {
  id: number;
  generation: number;
  controller: AbortController;
}

/** Cesium-agnostic ownership for mutually exclusive pick/inspect interaction modes. */
export class InteractionOwnershipController<Mode, Handler, Listener, Entity> {
  private readonly host: InteractionOwnershipHost<Mode, Handler, Listener, Entity>;
  private active: ActiveInteraction<Mode, Handler, Listener, Entity> | null = null;
  private pending: PendingInteractionRequest | null = null;
  private generation = 0;
  private nextRequestId = 1;
  private destroyed = false;
  private enableCount = 0;
  private disableCount = 0;
  private invalidationCount = 0;
  private attachedHandlerCount = 0;
  private detachedHandlerCount = 0;
  private attachedListenerCount = 0;
  private detachedListenerCount = 0;
  private committedEntityCount = 0;
  private removedEntityCount = 0;
  private startedAsyncCount = 0;
  private completedAsyncCount = 0;
  private abortedAsyncCount = 0;
  private staleAsyncCount = 0;
  private failedAsyncCount = 0;

  constructor(host: InteractionOwnershipHost<Mode, Handler, Listener, Entity>) {
    this.host = host;
  }

  enable(mode: Mode): InteractionLease<Mode> | null {
    if (this.destroyed) return null;
    if (this.active && Object.is(this.active.mode, mode)) {
      return { mode: this.active.mode, generation: this.active.generation };
    }
    if (this.active) this.releaseActive();
    this.generation += 1;

    const handler = this.host.attachHandler(mode, this.generation);
    this.attachedHandlerCount += 1;
    let listener: Listener;
    try {
      listener = this.host.attachListener(mode, this.generation);
      this.attachedListenerCount += 1;
    } catch (error) {
      this.host.detachHandler(handler);
      this.detachedHandlerCount += 1;
      throw error;
    }

    this.active = {
      mode,
      generation: this.generation,
      handler,
      listener,
      entity: null,
    };
    this.enableCount += 1;
    return { mode, generation: this.generation };
  }

  disable(): void {
    if (this.destroyed || !this.active) return;
    this.releaseActive();
  }

  /** Invalidates captured generation tokens, including while already disabled. */
  invalidateGeneration(): void {
    if (this.destroyed) return;
    if (this.active) this.releaseActive();
    this.generation += 1;
    this.invalidationCount += 1;
  }

  destroy(): void {
    if (this.destroyed) return;
    if (this.active) this.releaseActive();
    this.generation += 1;
    this.destroyed = true;
  }

  ownEntity(generation: number, entity: Entity): boolean {
    const active = this.active;
    if (this.destroyed || !active || active.generation !== generation) {
      this.host.removeEntity(entity);
      this.removedEntityCount += 1;
      return false;
    }
    if (active.entity !== null) this.removeOwnedEntity(active);
    active.entity = entity;
    this.committedEntityCount += 1;
    return true;
  }

  async runLatest<Result>(
    generation: number,
    load: (context: InteractionAsyncContext<Mode>) => Promise<Result>,
    createEntity: (result: Result, context: InteractionAsyncContext<Mode>) => Entity,
  ): Promise<InteractionAsyncOutcome> {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    const active = this.active;
    if (this.destroyed || !active || active.generation !== generation) {
      this.staleAsyncCount += 1;
      return { status: "stale", requestId, generation };
    }

    this.abortPending();
    const request: PendingInteractionRequest = {
      id: requestId,
      generation,
      controller: new AbortController(),
    };
    this.pending = request;
    this.startedAsyncCount += 1;
    const context: InteractionAsyncContext<Mode> = {
      mode: active.mode,
      generation,
      requestId,
      signal: request.controller.signal,
    };

    let result: Result;
    try {
      result = await load(context);
    } catch (error) {
      if (!this.isCurrent(request) || request.controller.signal.aborted) {
        return { status: "aborted", requestId, generation };
      }
      this.pending = null;
      this.failedAsyncCount += 1;
      throw error;
    }

    if (!this.isCurrent(request)) {
      this.staleAsyncCount += 1;
      return { status: "stale", requestId, generation };
    }

    let entity: Entity;
    try {
      entity = createEntity(result, context);
    } catch (error) {
      if (this.isCurrent(request)) this.pending = null;
      this.failedAsyncCount += 1;
      throw error;
    }

    if (!this.isCurrent(request)) {
      this.host.removeEntity(entity);
      this.removedEntityCount += 1;
      this.staleAsyncCount += 1;
      return { status: "stale", requestId, generation };
    }

    this.pending = null;
    this.ownEntity(generation, entity);
    this.completedAsyncCount += 1;
    return { status: "committed", requestId, generation };
  }

  diagnostics(): InteractionOwnershipDiagnostics<Mode> {
    return {
      destroyed: this.destroyed,
      enabled: this.active !== null,
      mode: this.active?.mode ?? null,
      generation: this.generation,
      ownedHandlerCount: this.active ? 1 : 0,
      ownedListenerCount: this.active ? 1 : 0,
      ownedEntityCount: this.active?.entity === null || !this.active ? 0 : 1,
      pendingAsyncCount: this.pending ? 1 : 0,
      enableCount: this.enableCount,
      disableCount: this.disableCount,
      invalidationCount: this.invalidationCount,
      attachedHandlerCount: this.attachedHandlerCount,
      detachedHandlerCount: this.detachedHandlerCount,
      attachedListenerCount: this.attachedListenerCount,
      detachedListenerCount: this.detachedListenerCount,
      committedEntityCount: this.committedEntityCount,
      removedEntityCount: this.removedEntityCount,
      startedAsyncCount: this.startedAsyncCount,
      completedAsyncCount: this.completedAsyncCount,
      abortedAsyncCount: this.abortedAsyncCount,
      staleAsyncCount: this.staleAsyncCount,
      failedAsyncCount: this.failedAsyncCount,
    };
  }

  private isCurrent(request: PendingInteractionRequest): boolean {
    return (
      !this.destroyed &&
      this.pending === request &&
      this.active?.generation === request.generation &&
      !request.controller.signal.aborted
    );
  }

  private abortPending(): void {
    const request = this.pending;
    if (!request) return;
    this.pending = null;
    request.controller.abort("interaction_invalidated");
    this.abortedAsyncCount += 1;
  }

  private releaseActive(): void {
    const active = this.active;
    if (!active) return;
    this.abortPending();
    if (active.entity !== null) this.removeOwnedEntity(active);
    this.host.detachListener(active.listener);
    this.detachedListenerCount += 1;
    this.host.detachHandler(active.handler);
    this.detachedHandlerCount += 1;
    this.active = null;
    this.disableCount += 1;
  }

  private removeOwnedEntity(active: ActiveInteraction<Mode, Handler, Listener, Entity>): void {
    const entity = active.entity;
    if (entity === null) return;
    active.entity = null;
    this.host.removeEntity(entity);
    this.removedEntityCount += 1;
  }
}
