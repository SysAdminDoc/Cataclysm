export type ImageryControllerStatus =
  | "connecting"
  | "ready"
  | "degraded"
  | "fallback"
  | "failed";
export type ImageryAssetHealth = "ready" | "degraded" | "failed";
export type ImageryFallbackReason = "offline" | "missing-token" | "provider-error" | null;
export type ImageryControllerOutcomeStatus =
  | "activated"
  | "fallback"
  | "failed"
  | "aborted"
  | "stale";

export interface ImagerySelection<Style, Provider> {
  provider: Provider;
  requestedStyle: Style;
  resolvedStyle: Style;
  fallbackReason: "offline" | "missing-token" | null;
}

export interface ImagerySessionSnapshot<Style> {
  requestedStyle: Style;
  resolvedStyle: Style;
  fallbackReason: ImageryFallbackReason;
  health: ImageryAssetHealth;
  dynamicAttributions: string[];
}

export interface ImageryBuildOptions {
  online: boolean;
  hasToken?: boolean;
  signal: AbortSignal;
}

export interface CesiumImageryHost<Provider, Terrain, Layer> {
  addBaseLayer: (provider: Provider) => Layer;
  removeBaseLayer: (layer: Layer) => void;
  setTerrain: (terrain: Terrain) => void;
  createEllipsoidTerrain: () => Terrain;
  listenProviderErrors: (provider: Provider, listener: (error: unknown) => void) => () => void;
  disposeProvider?: (provider: Provider) => void;
  disposeTerrain?: (terrain: Terrain) => void;
}

export interface CesiumImageryControllerOptions<Style, Provider, Terrain, Layer> {
  offlineStyle: Style;
  styleLabel: (style: Style) => string;
  buildImagery: (
    style: Style,
    options: ImageryBuildOptions,
  ) => Promise<ImagerySelection<Style, Provider>>;
  buildTerrain: (style: Style, signal: AbortSignal) => Promise<Terrain | undefined>;
  host: CesiumImageryHost<Provider, Terrain, Layer>;
  onStatus: (status: ImageryControllerStatus, message: string) => void;
  onActiveStyle: (style: Style) => void;
  publishSelection: (session: ImagerySessionSnapshot<Style>) => void;
  publishHealth: (health: ImageryAssetHealth) => void;
  warn?: (message: string, error?: unknown) => void;
  error?: (message: string, error?: unknown) => void;
}

export interface ImageryControllerOutcome {
  status: ImageryControllerOutcomeStatus;
  requestId: number;
  viewerGeneration: number;
}

export interface ImageryControllerDiagnostics {
  destroyed: boolean;
  viewerGeneration: number;
  pendingAsyncCount: 0 | 1;
  ownedBaseLayerCount: 0 | 1;
  ownedProviderListenerCount: 0 | 1;
  startedRequestCount: number;
  activatedBaseLayerCount: number;
  removedBaseLayerCount: number;
  attachedProviderListenerCount: number;
  removedProviderListenerCount: number;
  abortedRequestCount: number;
  staleResultCount: number;
  failedRequestCount: number;
  fallbackAttemptCount: number;
  disposedCandidateProviderCount: number;
  staleProviderDisposalCount: number;
  disposedTerrainCount: number;
  retryCount: number;
}

interface DesiredImagery<Style> {
  style: Style;
  online: boolean;
}

interface PendingRequest {
  id: number;
  generation: number;
  controller: AbortController;
  fallbackStarted: boolean;
}

interface Candidate<Style, Provider, Terrain> {
  selection: ImagerySelection<Style, Provider>;
  terrain: Terrain;
}

interface ActiveImagery<Style, Provider, Terrain, Layer> {
  requestId: number;
  generation: number;
  requestedStyle: Style;
  resolvedStyle: Style;
  provider: Provider;
  terrain: Terrain;
  layer: Layer;
  removeErrorListener: () => void;
  localProvider: boolean;
  failures: number;
  fallbackStarted: boolean;
}

const TILE_FAILURES_BEFORE_FALLBACK = 2;

export class CesiumImageryController<Style, Provider, Terrain, Layer> {
  private readonly options: CesiumImageryControllerOptions<Style, Provider, Terrain, Layer>;
  private generation = 0;
  private nextRequestId = 1;
  private pending: PendingRequest | null = null;
  private active: ActiveImagery<Style, Provider, Terrain, Layer> | null = null;
  private desired: DesiredImagery<Style> | null = null;
  private currentTask: Promise<ImageryControllerOutcome> | null = null;
  private destroyed = false;
  private startedRequestCount = 0;
  private activatedBaseLayerCount = 0;
  private removedBaseLayerCount = 0;
  private attachedProviderListenerCount = 0;
  private removedProviderListenerCount = 0;
  private abortedRequestCount = 0;
  private staleResultCount = 0;
  private failedRequestCount = 0;
  private fallbackAttemptCount = 0;
  private disposedCandidateProviderCount = 0;
  private staleProviderDisposalCount = 0;
  private disposedTerrainCount = 0;
  private retryCount = 0;

  constructor(options: CesiumImageryControllerOptions<Style, Provider, Terrain, Layer>) {
    this.options = options;
  }

  beginViewerGeneration(): number {
    if (this.destroyed) return this.generation;
    this.clear();
    this.generation += 1;
    return this.generation;
  }

  update(
    viewerGeneration: number,
    desired: DesiredImagery<Style>,
  ): Promise<ImageryControllerOutcome> {
    const requestId = this.nextRequestId++;
    if (this.destroyed || viewerGeneration !== this.generation) {
      return Promise.resolve({ status: "stale", requestId, viewerGeneration });
    }
    this.desired = { ...desired };
    this.abortPending();
    const request = this.createPending(requestId, viewerGeneration);
    this.emitStatus(
      "connecting",
      `Connecting to ${this.options.styleLabel(desired.style)}…`,
    );
    return this.track(this.runUpdate(request, desired));
  }

  retry(viewerGeneration: number): Promise<ImageryControllerOutcome> {
    this.retryCount += 1;
    if (!this.desired) {
      const requestId = this.nextRequestId++;
      return Promise.resolve({ status: "stale", requestId, viewerGeneration });
    }
    return this.update(viewerGeneration, this.desired);
  }

  clear(): void {
    if (this.destroyed) return;
    this.abortPending();
    if (this.active) {
      this.disposeActive(this.active);
      this.active = null;
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    this.generation += 1;
  }

  async whenIdle(): Promise<void> {
    while (this.currentTask) {
      const task = this.currentTask;
      await task;
      if (this.currentTask === task) return;
    }
  }

  diagnostics(): ImageryControllerDiagnostics {
    return {
      destroyed: this.destroyed,
      viewerGeneration: this.generation,
      pendingAsyncCount: this.pending ? 1 : 0,
      ownedBaseLayerCount: this.active ? 1 : 0,
      ownedProviderListenerCount: this.active ? 1 : 0,
      startedRequestCount: this.startedRequestCount,
      activatedBaseLayerCount: this.activatedBaseLayerCount,
      removedBaseLayerCount: this.removedBaseLayerCount,
      attachedProviderListenerCount: this.attachedProviderListenerCount,
      removedProviderListenerCount: this.removedProviderListenerCount,
      abortedRequestCount: this.abortedRequestCount,
      staleResultCount: this.staleResultCount,
      failedRequestCount: this.failedRequestCount,
      fallbackAttemptCount: this.fallbackAttemptCount,
      disposedCandidateProviderCount: this.disposedCandidateProviderCount,
      staleProviderDisposalCount: this.staleProviderDisposalCount,
      disposedTerrainCount: this.disposedTerrainCount,
      retryCount: this.retryCount,
    };
  }

  private async runUpdate(
    request: PendingRequest,
    desired: DesiredImagery<Style>,
  ): Promise<ImageryControllerOutcome> {
    try {
      const candidate = await this.prepareCandidate(request, desired.style, {
        online: desired.online,
      });
      if (!candidate) return this.staleOutcome(request);
      if (!this.commitCandidate(request, desired.style, candidate)) {
        return this.staleOutcome(request);
      }
      this.publishInitialState(desired.style, candidate.selection);
      return {
        status: candidate.selection.fallbackReason ? "fallback" : "activated",
        requestId: request.id,
        viewerGeneration: request.generation,
      };
    } catch (error) {
      if (!this.isCurrent(request)) return this.abortedOutcome(request);
      this.options.warn?.("[globe] imagery/terrain initialization failed", error);
      return this.startPendingFallback(
        request,
        desired.style,
        `${this.options.styleLabel(desired.style)} failed to initialize.`,
      );
    }
  }

  private async startPendingFallback(
    request: PendingRequest,
    requestedStyle: Style,
    reason: string,
  ): Promise<ImageryControllerOutcome> {
    if (request.fallbackStarted || !this.isCurrent(request)) {
      return this.staleOutcome(request);
    }
    request.fallbackStarted = true;
    this.fallbackAttemptCount += 1;
    return this.runFallback(request, requestedStyle, reason);
  }

  private startActiveFallback(
    active: ActiveImagery<Style, Provider, Terrain, Layer>,
    reason: string,
  ): void {
    if (active.fallbackStarted || this.destroyed || this.active !== active) return;
    active.fallbackStarted = true;
    this.fallbackAttemptCount += 1;
    this.abortPending();
    const request = this.createPending(this.nextRequestId++, active.generation);
    request.fallbackStarted = true;
    void this.track(this.runFallback(request, active.requestedStyle, reason));
  }

  private async runFallback(
    request: PendingRequest,
    requestedStyle: Style,
    reason: string,
  ): Promise<ImageryControllerOutcome> {
    this.emitStatus("degraded", `${reason} Loading bundled Natural Earth II…`);
    try {
      const candidate = await this.prepareCandidate(
        request,
        this.options.offlineStyle,
        { online: true, hasToken: true, forceEllipsoid: true },
      );
      if (!candidate) return this.staleOutcome(request);
      if (!this.commitCandidate(request, requestedStyle, candidate)) {
        return this.staleOutcome(request);
      }
      this.options.onActiveStyle(this.options.offlineStyle);
      this.emitStatus("fallback", `${reason} Using bundled Natural Earth II.`);
      this.options.publishSelection({
        requestedStyle,
        resolvedStyle: this.options.offlineStyle,
        fallbackReason: "provider-error",
        health: "degraded",
        dynamicAttributions: [],
      });
      return {
        status: "fallback",
        requestId: request.id,
        viewerGeneration: request.generation,
      };
    } catch (error) {
      if (!this.isCurrent(request)) return this.abortedOutcome(request);
      this.pending = null;
      this.failedRequestCount += 1;
      this.options.error?.("[globe] bundled Natural Earth fallback failed", error);
      this.emitStatus("failed", "Online imagery and bundled Natural Earth II both failed.");
      this.options.publishSelection({
        requestedStyle,
        resolvedStyle: this.options.offlineStyle,
        fallbackReason: "provider-error",
        health: "failed",
        dynamicAttributions: [],
      });
      return {
        status: "failed",
        requestId: request.id,
        viewerGeneration: request.generation,
      };
    }
  }

  private async prepareCandidate(
    request: PendingRequest,
    style: Style,
    build: { online: boolean; hasToken?: boolean; forceEllipsoid?: boolean },
  ): Promise<Candidate<Style, Provider, Terrain> | null> {
    let selection: ImagerySelection<Style, Provider> | null = null;
    let terrain: Terrain | null = null;
    try {
      selection = await this.options.buildImagery(style, {
        online: build.online,
        hasToken: build.hasToken,
        signal: request.controller.signal,
      });
      if (!this.isCurrent(request)) {
        this.disposeCandidate(selection.provider, null, true);
        return null;
      }
      terrain =
        build.forceEllipsoid || selection.fallbackReason
          ? this.options.host.createEllipsoidTerrain()
          : (await this.options.buildTerrain(
              selection.resolvedStyle,
              request.controller.signal,
            )) ?? this.options.host.createEllipsoidTerrain();
      if (!this.isCurrent(request)) {
        this.disposeCandidate(selection.provider, terrain, true);
        return null;
      }
      return { selection, terrain };
    } catch (error) {
      if (selection) this.disposeCandidate(selection.provider, terrain, false);
      throw error;
    }
  }

  private commitCandidate(
    request: PendingRequest,
    requestedStyle: Style,
    candidate: Candidate<Style, Provider, Terrain>,
  ): boolean {
    if (!this.isCurrent(request)) {
      this.disposeCandidate(candidate.selection.provider, candidate.terrain, true);
      return false;
    }
    let layer: Layer | null = null;
    let removeErrorListener: (() => void) | null = null;
    let record: ActiveImagery<Style, Provider, Terrain, Layer> | null = null;
    try {
      removeErrorListener = this.options.host.listenProviderErrors(
        candidate.selection.provider,
        (error) => {
          if (record) this.handleProviderError(record, error);
        },
      );
      this.attachedProviderListenerCount += 1;
      layer = this.options.host.addBaseLayer(candidate.selection.provider);
      this.options.host.setTerrain(candidate.terrain);
      record = {
        requestId: request.id,
        generation: request.generation,
        requestedStyle,
        resolvedStyle: candidate.selection.resolvedStyle,
        provider: candidate.selection.provider,
        terrain: candidate.terrain,
        layer,
        removeErrorListener,
        localProvider: Object.is(candidate.selection.resolvedStyle, this.options.offlineStyle),
        failures: 0,
        fallbackStarted: false,
      };
    } catch (error) {
      removeErrorListener?.();
      if (removeErrorListener) this.removedProviderListenerCount += 1;
      if (layer) {
        this.options.host.removeBaseLayer(layer);
      } else {
        this.disposeProvider(candidate.selection.provider, false);
      }
      this.disposeTerrain(candidate.terrain);
      throw error;
    }

    const previous = this.active;
    this.active = record;
    this.pending = null;
    this.activatedBaseLayerCount += 1;
    if (previous) this.disposeActive(previous);
    return true;
  }

  private publishInitialState(
    requestedStyle: Style,
    selection: ImagerySelection<Style, Provider>,
  ): void {
    this.options.onActiveStyle(selection.resolvedStyle);
    if (selection.fallbackReason === "offline") {
      this.emitStatus(
        "fallback",
        `Offline — using bundled Natural Earth II instead of ${this.options.styleLabel(requestedStyle)}.`,
      );
      this.options.publishSelection({
        requestedStyle,
        resolvedStyle: selection.resolvedStyle,
        fallbackReason: "offline",
        health: "degraded",
        dynamicAttributions: [],
      });
    } else if (selection.fallbackReason === "missing-token") {
      this.emitStatus(
        "fallback",
        `${this.options.styleLabel(requestedStyle)} needs a Cesium token; using bundled Natural Earth II.`,
      );
      this.options.publishSelection({
        requestedStyle,
        resolvedStyle: selection.resolvedStyle,
        fallbackReason: "missing-token",
        health: "degraded",
        dynamicAttributions: [],
      });
    } else {
      this.emitStatus("ready", `${this.options.styleLabel(requestedStyle)} ready.`);
      this.options.publishSelection({
        requestedStyle,
        resolvedStyle: selection.resolvedStyle,
        fallbackReason: null,
        health: "ready",
        dynamicAttributions: [],
      });
    }
  }

  private handleProviderError(
    active: ActiveImagery<Style, Provider, Terrain, Layer>,
    error: unknown,
  ): void {
    if (this.destroyed || this.active !== active || active.generation !== this.generation) return;
    active.failures += 1;
    this.options.warn?.(`[globe] tile provider error ${active.failures}`, error);
    if (active.localProvider) {
      this.emitStatus("failed", "Bundled Natural Earth imagery could not be read.");
      this.options.publishHealth("failed");
      return;
    }
    const label = this.options.styleLabel(active.requestedStyle);
    if (active.failures < TILE_FAILURES_BEFORE_FALLBACK) {
      this.emitStatus("degraded", `${label} is losing tiles; retrying before fallback.`);
      this.options.publishHealth("degraded");
      return;
    }
    this.startActiveFallback(active, `${label} stopped serving tiles.`);
  }

  private createPending(requestId: number, generation: number): PendingRequest {
    const request: PendingRequest = {
      id: requestId,
      generation,
      controller: new AbortController(),
      fallbackStarted: false,
    };
    this.pending = request;
    this.startedRequestCount += 1;
    return request;
  }

  private isCurrent(request: PendingRequest): boolean {
    return (
      !this.destroyed &&
      this.pending === request &&
      request.generation === this.generation &&
      !request.controller.signal.aborted
    );
  }

  private abortPending(): void {
    const request = this.pending;
    if (!request) return;
    this.pending = null;
    request.controller.abort("imagery_request_invalidated");
    this.abortedRequestCount += 1;
  }

  private disposeActive(active: ActiveImagery<Style, Provider, Terrain, Layer>): void {
    active.removeErrorListener();
    this.removedProviderListenerCount += 1;
    this.options.host.removeBaseLayer(active.layer);
    this.removedBaseLayerCount += 1;
    this.disposeTerrain(active.terrain);
  }

  private disposeCandidate(provider: Provider, terrain: Terrain | null, stale: boolean): void {
    this.disposeProvider(provider, stale);
    if (terrain) this.disposeTerrain(terrain);
  }

  private disposeProvider(provider: Provider, stale: boolean): void {
    if (!this.options.host.disposeProvider) return;
    this.options.host.disposeProvider(provider);
    this.disposedCandidateProviderCount += 1;
    if (stale) this.staleProviderDisposalCount += 1;
  }

  private disposeTerrain(terrain: Terrain): void {
    if (!this.options.host.disposeTerrain) return;
    this.options.host.disposeTerrain(terrain);
    this.disposedTerrainCount += 1;
  }

  private staleOutcome(request: PendingRequest): ImageryControllerOutcome {
    this.staleResultCount += 1;
    return { status: "stale", requestId: request.id, viewerGeneration: request.generation };
  }

  private abortedOutcome(request: PendingRequest): ImageryControllerOutcome {
    return { status: "aborted", requestId: request.id, viewerGeneration: request.generation };
  }

  private emitStatus(status: ImageryControllerStatus, message: string): void {
    this.options.onStatus(status, message);
  }

  private track(task: Promise<ImageryControllerOutcome>): Promise<ImageryControllerOutcome> {
    this.currentTask = task;
    void task.then(
      () => {
        if (this.currentTask === task) this.currentTask = null;
      },
      () => {
        if (this.currentTask === task) this.currentTask = null;
      },
    );
    return task;
  }
}
