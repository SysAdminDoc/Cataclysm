export const RESOURCE_CATEGORIES = [
  "entities",
  "primitives",
  "imagery",
  "textures",
  "handlers",
  "listeners",
  "rafs",
  "pendingAsync",
] as const;

export type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number];
export type ResourceCleanup = () => void;

export type ResourceCounts = Readonly<Record<ResourceCategory, number>>;

export type ResourceLease = Readonly<{
  readonly active: boolean;
  release(): void;
}>;

export type FrameScheduler = Readonly<{
  request(callback: FrameRequestCallback): number;
  cancel(handle: number): void;
}>;

export type FrameRequest = Readonly<{
  readonly id: number;
  readonly active: boolean;
  cancel(): void;
}>;

export type GuardAsyncOptions<T> = Readonly<{
  /** Disposes a resource that resolves after reset/destroy made its request stale. */
  disposeStale(value: T): void;
}>;
