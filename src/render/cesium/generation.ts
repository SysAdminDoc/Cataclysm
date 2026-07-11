export type AsyncGenerationContext<Viewer extends object> = Readonly<{
  viewer: Viewer;
  mode: unknown;
  request: unknown;
}>;

export type AsyncGenerationToken<Viewer extends object> = Readonly<
  AsyncGenerationContext<Viewer> & {
    generation: number;
  }
>;

export type AsyncGenerationResult = "committed" | "stale";

export type AsyncGenerationDiagnostics = Readonly<{
  generation: number;
  pending: number;
  active: boolean;
  destroyed: boolean;
}>;

/**
 * Owns the validity of asynchronous Cesium work for one render system.
 *
 * Call `setContext` whenever the viewer, mode, or request identity changes.
 * Results captured under an older context cannot commit into the current
 * viewer. If stale work created a disposable provider/resource, `guard` can
 * destroy it through `disposeStale` instead.
 */
export class AsyncGenerationOwner<Viewer extends object> {
  #generation = 0;
  #pending = 0;
  #destroyed = false;
  #context: AsyncGenerationContext<Viewer> | null = null;
  readonly #issuedTokens = new WeakSet<object>();

  get pendingCount(): number {
    return this.#pending;
  }

  get generation(): number {
    return this.#generation;
  }

  /**
   * Activates a context and returns a token for work started in it. The
   * generation advances only when viewer, mode, or request identity changes.
   */
  setContext(
    viewer: Viewer,
    mode: unknown,
    request: unknown,
  ): AsyncGenerationToken<Viewer> {
    if (this.#destroyed) {
      throw new Error("AsyncGenerationOwner is destroyed.");
    }

    const previous = this.#context;
    if (
      !previous ||
      previous.viewer !== viewer ||
      !Object.is(previous.mode, mode) ||
      !Object.is(previous.request, request)
    ) {
      this.#generation += 1;
      this.#context = { viewer, mode, request };
    }

    const token = Object.freeze({
      viewer,
      mode,
      request,
      generation: this.#generation,
    });
    this.#issuedTokens.add(token);
    return token;
  }

  /** Invalidates every issued token without destroying the owner. */
  invalidate(): void {
    if (this.#destroyed) return;
    this.#generation += 1;
    this.#context = null;
  }

  isCurrent(token: AsyncGenerationToken<Viewer>): boolean {
    const context = this.#context;
    return (
      !this.#destroyed &&
      this.#issuedTokens.has(token) &&
      context !== null &&
      token.generation === this.#generation &&
      token.viewer === context.viewer &&
      Object.is(token.mode, context.mode) &&
      Object.is(token.request, context.request)
    );
  }

  /**
   * Commits a resolved value only if its token still owns the active context.
   * Pending diagnostics include both current and stale work until it settles.
   */
  async guard<Value>(
    token: AsyncGenerationToken<Viewer>,
    work: PromiseLike<Value>,
    commit: (value: Value) => void,
    disposeStale?: (value: Value) => void,
  ): Promise<AsyncGenerationResult> {
    this.#pending += 1;
    try {
      const value = await work;
      if (this.isCurrent(token)) {
        commit(value);
        return "committed";
      }
      disposeStale?.(value);
      return "stale";
    } finally {
      this.#pending -= 1;
    }
  }

  diagnostics(): AsyncGenerationDiagnostics {
    return Object.freeze({
      generation: this.#generation,
      pending: this.#pending,
      active: this.#context !== null && !this.#destroyed,
      destroyed: this.#destroyed,
    });
  }

  /** Permanently invalidates all work. Safe to call more than once. */
  destroy(): void {
    if (this.#destroyed) return;
    this.#generation += 1;
    this.#context = null;
    this.#destroyed = true;
  }
}
