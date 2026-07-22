export type CoordinatePickSchedulerDiagnostics = Readonly<{
  destroyed: boolean;
  pending: boolean;
  scheduledFrameCount: number;
  coalescedRequestCount: number;
  completedPickCount: number;
  emptyPickCount: number;
}>;

type CoordinatePickSchedulerOptions<Position, Result> = Readonly<{
  pick(position: Position): Result | null;
  commit(result: Result): void;
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(frameId: number): void;
}>;

/**
 * Defers analytical coordinate picking to the next animation frame and keeps
 * only the newest request. This prevents pointer handlers from competing with
 * an in-progress Cesium field update while preserving the exact pick function.
 */
export class FrameCoalescedCoordinatePicker<Position, Result> {
  readonly #options: CoordinatePickSchedulerOptions<Position, Result>;
  #pendingPosition: Position | null = null;
  #frameId: number | null = null;
  #destroyed = false;
  #scheduledFrameCount = 0;
  #coalescedRequestCount = 0;
  #completedPickCount = 0;
  #emptyPickCount = 0;

  constructor(options: CoordinatePickSchedulerOptions<Position, Result>) {
    this.#options = options;
  }

  schedule(position: Position): boolean {
    if (this.#destroyed) return false;
    this.#pendingPosition = position;
    if (this.#frameId !== null) {
      this.#coalescedRequestCount += 1;
      return true;
    }
    this.#scheduledFrameCount += 1;
    this.#frameId = this.#options.requestFrame(() => this.#flush());
    return true;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#pendingPosition = null;
    if (this.#frameId !== null) this.#options.cancelFrame(this.#frameId);
    this.#frameId = null;
  }

  diagnostics(): CoordinatePickSchedulerDiagnostics {
    return Object.freeze({
      destroyed: this.#destroyed,
      pending: this.#frameId !== null,
      scheduledFrameCount: this.#scheduledFrameCount,
      coalescedRequestCount: this.#coalescedRequestCount,
      completedPickCount: this.#completedPickCount,
      emptyPickCount: this.#emptyPickCount,
    });
  }

  #flush(): void {
    this.#frameId = null;
    if (this.#destroyed) return;
    const position = this.#pendingPosition;
    this.#pendingPosition = null;
    if (position === null) return;
    const result = this.#options.pick(position);
    if (result === null) {
      this.#emptyPickCount += 1;
      return;
    }
    this.#completedPickCount += 1;
    this.#options.commit(result);
  }
}
