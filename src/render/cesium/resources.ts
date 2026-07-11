import {
  RESOURCE_CATEGORIES,
  type FrameRequest,
  type FrameScheduler,
  type GuardAsyncOptions,
  type ResourceCategory,
  type ResourceCleanup,
  type ResourceCounts,
  type ResourceLease,
} from "./types";

type Entry = {
  id: number;
  category: ResourceCategory;
  cleanup: ResourceCleanup;
  active: boolean;
};

const ZERO_COUNTS: ResourceCounts = Object.freeze({
  entities: 0,
  primitives: 0,
  imagery: 0,
  textures: 0,
  handlers: 0,
  listeners: 0,
  rafs: 0,
  pendingAsync: 0,
});

const browserFrameScheduler: FrameScheduler = Object.freeze({
  request(callback) {
    return globalThis.requestAnimationFrame(callback);
  },
  cancel(handle) {
    globalThis.cancelAnimationFrame(handle);
  },
});

/**
 * Generation-bound ownership for everything a Cesium renderer module creates.
 * The class is intentionally Cesium-agnostic: callers provide cleanup closures.
 */
export class ResourceScope {
  readonly generation: number;
  readonly #frameScheduler: FrameScheduler;
  #abortController = new AbortController();
  #entries = new Map<number, Entry>();
  #counts: Record<ResourceCategory, number> = { ...ZERO_COUNTS };
  #nextId = 1;
  #epoch = 0;
  #destroyed = false;
  #resetting = false;

  constructor(generation: number, frameScheduler: FrameScheduler = browserFrameScheduler) {
    if (!Number.isSafeInteger(generation) || generation < 0) {
      throw new RangeError("ResourceScope generation must be a nonnegative safe integer.");
    }
    this.generation = generation;
    this.#frameScheduler = frameScheduler;
  }

  get destroyed(): boolean {
    return this.#destroyed;
  }

  get signal(): AbortSignal {
    return this.#abortController.signal;
  }

  isCurrent(generation: number): boolean {
    return !this.#destroyed && !this.#resetting && generation === this.generation;
  }

  snapshotCounts(): ResourceCounts {
    return Object.freeze({ ...this.#counts });
  }

  own(category: ResourceCategory, cleanup: ResourceCleanup): ResourceLease {
    if (!RESOURCE_CATEGORIES.includes(category) || typeof cleanup !== "function") {
      throw new TypeError("Resource ownership requires a known category and cleanup callback.");
    }
    if (this.#destroyed || this.#resetting) {
      cleanup();
      return this.#inactiveLease();
    }
    const entry: Entry = {
      id: this.#nextId++,
      category,
      cleanup,
      active: true,
    };
    this.#entries.set(entry.id, entry);
    this.#counts[category] += 1;
    return this.#leaseFor(entry);
  }

  ownEntity(cleanup: ResourceCleanup): ResourceLease { return this.own("entities", cleanup); }
  ownPrimitive(cleanup: ResourceCleanup): ResourceLease { return this.own("primitives", cleanup); }
  ownImagery(cleanup: ResourceCleanup): ResourceLease { return this.own("imagery", cleanup); }
  ownTexture(cleanup: ResourceCleanup): ResourceLease { return this.own("textures", cleanup); }
  ownHandler(cleanup: ResourceCleanup): ResourceLease { return this.own("handlers", cleanup); }
  ownListener(cleanup: ResourceCleanup): ResourceLease { return this.own("listeners", cleanup); }
  ownPendingAsync(cleanup: ResourceCleanup = () => {}): ResourceLease { return this.own("pendingAsync", cleanup); }

  requestFrame(callback: FrameRequestCallback): FrameRequest | null {
    if (this.#destroyed || this.#resetting) return null;
    const epoch = this.#epoch;
    let entry: Entry | null = null;
    const id = this.#frameScheduler.request((time) => {
      if (!entry || !entry.active) return;
      this.#complete(entry);
      if (!this.#destroyed && epoch === this.#epoch) callback(time);
    });
    entry = this.#register("rafs", () => this.#frameScheduler.cancel(id));
    const request: FrameRequest = {
      id,
      get active() {
        return entry?.active === true;
      },
      cancel: () => {
        if (entry) this.#release(entry, true);
      },
    };
    return Object.freeze(request);
  }

  cancel(request: FrameRequest | null | undefined): void {
    request?.cancel();
  }

  async guardAsync<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    options: GuardAsyncOptions<T>,
  ): Promise<T | undefined> {
    if (typeof operation !== "function" || typeof options?.disposeStale !== "function") {
      throw new TypeError("guardAsync requires an operation and stale-value disposer.");
    }
    if (this.#destroyed || this.#resetting) return undefined;
    const epoch = this.#epoch;
    const generation = this.generation;
    const signal = this.#abortController.signal;
    const pending = this.ownPendingAsync();
    let promise: Promise<T>;
    try {
      promise = operation(signal);
    } catch (error) {
      pending.release();
      throw error;
    }
    try {
      const value = await promise;
      pending.release();
      if (!this.isCurrent(generation) || epoch !== this.#epoch || signal.aborted) {
        options.disposeStale(value);
        return undefined;
      }
      return value;
    } catch (error) {
      pending.release();
      if (!this.isCurrent(generation) || epoch !== this.#epoch || signal.aborted) return undefined;
      throw error;
    }
  }

  reset(): void {
    if (this.#destroyed) return;
    this.#abortController.abort();
    this.#epoch += 1;
    this.#resetting = true;
    const errors = this.#disposeEntries();
    this.#abortController = new AbortController();
    this.#resetting = false;
    this.#throwCleanupErrors(errors, "ResourceScope reset cleanup failed.");
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#abortController.abort();
    this.#epoch += 1;
    const errors = this.#disposeEntries();
    this.#throwCleanupErrors(errors, "ResourceScope destroy cleanup failed.");
  }

  #register(category: ResourceCategory, cleanup: ResourceCleanup): Entry {
    const entry: Entry = { id: this.#nextId++, category, cleanup, active: true };
    this.#entries.set(entry.id, entry);
    this.#counts[category] += 1;
    return entry;
  }

  #leaseFor(entry: Entry): ResourceLease {
    const lease: ResourceLease = {
      get active() {
        return entry.active;
      },
      release: () => this.#release(entry, true),
    };
    return Object.freeze(lease);
  }

  #inactiveLease(): ResourceLease {
    return Object.freeze({ active: false, release() {} });
  }

  #release(entry: Entry, runCleanup: boolean): void {
    if (!entry.active) return;
    this.#complete(entry);
    if (runCleanup) entry.cleanup();
  }

  #complete(entry: Entry): void {
    if (!entry.active) return;
    entry.active = false;
    this.#entries.delete(entry.id);
    this.#counts[entry.category] -= 1;
  }

  #disposeEntries(): unknown[] {
    const entries = [...this.#entries.values()].reverse();
    this.#entries.clear();
    this.#counts = { ...ZERO_COUNTS };
    const errors: unknown[] = [];
    for (const entry of entries) {
      if (!entry.active) continue;
      entry.active = false;
      try {
        entry.cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    return errors;
  }

  #throwCleanupErrors(errors: readonly unknown[], message: string): void {
    if (errors.length > 0) throw new AggregateError(errors, message);
  }
}
