import { ResourceScope } from "./resources";
import type { ResourceCategory, ResourceCleanup, ResourceCounts, ResourceLease } from "./types";

export type ViewerLifecycleDiagnostics = Readonly<{
  generation: number;
  destroyed: boolean;
  viewer_destroyed: boolean;
  resources: ResourceCounts;
}>;

/**
 * Orders every child-system cleanup before Viewer destruction. Effects may
 * release their leases earlier; root teardown remains idempotent.
 */
export class ViewerLifecycle<Viewer extends object> {
  readonly #viewer: Viewer;
  readonly #destroyViewer: (viewer: Viewer) => void;
  readonly #scope: ResourceScope;
  #destroyed = false;
  #viewerDestroyed = false;

  constructor(viewer: Viewer, generation: number, destroyViewer: (viewer: Viewer) => void) {
    this.#viewer = viewer;
    this.#scope = new ResourceScope(generation);
    this.#destroyViewer = destroyViewer;
  }

  own(category: ResourceCategory, cleanup: ResourceCleanup): ResourceLease {
    return this.#scope.own(category, cleanup);
  }

  ownSystem(cleanup: ResourceCleanup): ResourceLease {
    return this.#scope.ownHandler(cleanup);
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#scope.destroy();
    this.#destroyViewer(this.#viewer);
    this.#viewerDestroyed = true;
  }

  diagnostics(): ViewerLifecycleDiagnostics {
    return Object.freeze({
      generation: this.#scope.generation,
      destroyed: this.#destroyed,
      viewer_destroyed: this.#viewerDestroyed,
      resources: this.#scope.snapshotCounts(),
    });
  }
}
