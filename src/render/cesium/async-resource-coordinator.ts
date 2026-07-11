export type AsyncResourceOutcomeStatus = "activated" | "aborted" | "stale";

export interface AsyncResourceOutcome {
  status: AsyncResourceOutcomeStatus;
  requestId: number;
  viewerGeneration: number;
}

export interface AsyncResourceLoadContext {
  signal: AbortSignal;
  requestId: number;
  viewerGeneration: number;
}

export interface AsyncResourceDisposalContext {
  reason: string;
  ownership: "active" | "candidate";
  requestId: number;
  viewerGeneration: number;
}

export interface AsyncResourceCoordinatorOptions<Resource> {
  dispose: (resource: Resource, context: AsyncResourceDisposalContext) => void;
}

export interface AsyncResourceDiagnostics {
  destroyed: boolean;
  viewerGeneration: number;
  pendingResourceCount: 0 | 1;
  activeResourceCount: 0 | 1;
  startedRequestCount: number;
  activatedResourceCount: number;
  abortedRequestCount: number;
  staleResultCount: number;
  disposedCandidateCount: number;
  disposedActiveCount: number;
  failedLoadCount: number;
  failedActivationCount: number;
  rejectedGenerationCount: number;
  invalidationCount: number;
}

interface PendingRequest {
  id: number;
  generation: number;
  controller: AbortController;
  staleReason: string | null;
}

interface ActiveResource<Resource> {
  value: Resource;
  requestId: number;
  generation: number;
}

/**
 * Owns asynchronous renderer resources across Cesium Viewer generations.
 * Resource creation may be asynchronous; activation and disposal are kept
 * synchronous so ownership changes are atomic from the renderer's perspective.
 */
export class AsyncResourceCoordinator<Resource> {
  private readonly disposeResource: AsyncResourceCoordinatorOptions<Resource>["dispose"];
  private generation = 0;
  private nextRequestId = 1;
  private pending: PendingRequest | null = null;
  private active: ActiveResource<Resource> | null = null;
  private destroyed = false;
  private startedRequestCount = 0;
  private activatedResourceCount = 0;
  private abortedRequestCount = 0;
  private staleResultCount = 0;
  private disposedCandidateCount = 0;
  private disposedActiveCount = 0;
  private failedLoadCount = 0;
  private failedActivationCount = 0;
  private rejectedGenerationCount = 0;
  private invalidationCount = 0;

  constructor(options: AsyncResourceCoordinatorOptions<Resource>) {
    this.disposeResource = options.dispose;
  }

  /** Invalidates all prior viewer work and returns a token for the new viewer. */
  beginViewerGeneration(): number {
    if (this.destroyed) return this.generation;
    this.invalidate("viewer_generation_changed");
    this.generation += 1;
    return this.generation;
  }

  /** Aborts only the pending load. The currently active resource remains live. */
  abortPending(reason = "aborted"): void {
    const request = this.pending;
    if (!request) return;
    this.pending = null;
    request.staleReason = reason;
    request.controller.abort(reason);
    this.abortedRequestCount += 1;
  }

  /** Aborts pending work and disposes the active resource. */
  invalidate(reason = "invalidated"): void {
    if (this.destroyed) return;
    this.invalidationCount += 1;
    this.abortPending(reason);
    this.disposeActive(reason);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.invalidate("destroyed");
    this.destroyed = true;
  }

  async replace(
    viewerGeneration: number,
    load: (context: AsyncResourceLoadContext) => Promise<Resource>,
    activate: (resource: Resource, context: AsyncResourceLoadContext) => void,
  ): Promise<AsyncResourceOutcome> {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    if (this.destroyed || viewerGeneration !== this.generation) {
      this.rejectedGenerationCount += 1;
      return { status: "stale", requestId, viewerGeneration };
    }

    this.abortPending("superseded");
    const request: PendingRequest = {
      id: requestId,
      generation: viewerGeneration,
      controller: new AbortController(),
      staleReason: null,
    };
    this.pending = request;
    this.startedRequestCount += 1;
    const context: AsyncResourceLoadContext = {
      signal: request.controller.signal,
      requestId,
      viewerGeneration,
    };

    let resource: Resource;
    try {
      resource = await load(context);
    } catch (error) {
      if (!this.isCurrent(request) || request.controller.signal.aborted) {
        return { status: "aborted", requestId, viewerGeneration };
      }
      this.pending = null;
      this.failedLoadCount += 1;
      throw error;
    }

    if (!this.isCurrent(request)) {
      this.staleResultCount += 1;
      this.disposeCandidate(resource, request, request.staleReason ?? "stale_result");
      return { status: "stale", requestId, viewerGeneration };
    }

    try {
      activate(resource, context);
    } catch (error) {
      if (this.isCurrent(request)) this.pending = null;
      this.failedActivationCount += 1;
      this.disposeCandidate(resource, request, "activation_failed");
      throw error;
    }

    if (!this.isCurrent(request)) {
      this.staleResultCount += 1;
      this.disposeCandidate(resource, request, request.staleReason ?? "stale_activation");
      return { status: "stale", requestId, viewerGeneration };
    }

    this.pending = null;
    const previous = this.active;
    this.active = {
      value: resource,
      requestId,
      generation: viewerGeneration,
    };
    this.activatedResourceCount += 1;
    if (previous) this.disposeOwned(previous, "replaced");
    return { status: "activated", requestId, viewerGeneration };
  }

  diagnostics(): AsyncResourceDiagnostics {
    return {
      destroyed: this.destroyed,
      viewerGeneration: this.generation,
      pendingResourceCount: this.pending ? 1 : 0,
      activeResourceCount: this.active ? 1 : 0,
      startedRequestCount: this.startedRequestCount,
      activatedResourceCount: this.activatedResourceCount,
      abortedRequestCount: this.abortedRequestCount,
      staleResultCount: this.staleResultCount,
      disposedCandidateCount: this.disposedCandidateCount,
      disposedActiveCount: this.disposedActiveCount,
      failedLoadCount: this.failedLoadCount,
      failedActivationCount: this.failedActivationCount,
      rejectedGenerationCount: this.rejectedGenerationCount,
      invalidationCount: this.invalidationCount,
    };
  }

  private isCurrent(request: PendingRequest): boolean {
    return (
      !this.destroyed &&
      this.pending === request &&
      request.generation === this.generation &&
      !request.controller.signal.aborted
    );
  }

  private disposeCandidate(resource: Resource, request: PendingRequest, reason: string): void {
    this.disposedCandidateCount += 1;
    this.disposeResource(resource, {
      reason,
      ownership: "candidate",
      requestId: request.id,
      viewerGeneration: request.generation,
    });
  }

  private disposeActive(reason: string): void {
    const resource = this.active;
    if (!resource) return;
    this.active = null;
    this.disposeOwned(resource, reason);
  }

  private disposeOwned(resource: ActiveResource<Resource>, reason: string): void {
    this.disposedActiveCount += 1;
    this.disposeResource(resource.value, {
      reason,
      ownership: "active",
      requestId: resource.requestId,
      viewerGeneration: resource.generation,
    });
  }
}
