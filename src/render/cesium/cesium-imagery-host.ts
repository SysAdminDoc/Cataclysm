import * as Cesium from "cesium";
import type { CesiumImageryHost as ImageryHostContract } from "./imagery-controller";

type Destroyable = {
  isDestroyed: () => boolean;
  destroy: () => unknown;
};

function destroyConcreteResource(resource: unknown): void {
  if (typeof resource !== "object" || resource === null) return;
  const candidate = resource as Partial<Destroyable>;
  if (
    typeof candidate.isDestroyed !== "function" ||
    typeof candidate.destroy !== "function"
  ) {
    return;
  }
  if (!candidate.isDestroyed.call(resource)) candidate.destroy.call(resource);
}

/** Concrete Cesium base-imagery host. Overlay layers are never enumerated. */
export class CesiumImageryHost
  implements
    ImageryHostContract<
      Cesium.ImageryProvider,
      Cesium.TerrainProvider,
      Cesium.ImageryLayer
    >
{
  constructor(private readonly viewer: Cesium.Viewer) {}

  addBaseLayer(provider: Cesium.ImageryProvider): Cesium.ImageryLayer {
    this.assertViewerAlive();
    const layer = this.viewer.imageryLayers.addImageryProvider(provider);
    try {
      this.viewer.imageryLayers.lowerToBottom(layer);
      return layer;
    } catch (error) {
      this.releaseLayer(layer);
      throw error;
    }
  }

  removeBaseLayer(layer: Cesium.ImageryLayer): void {
    this.releaseLayer(layer);
  }

  setTerrain(terrain: Cesium.TerrainProvider): void {
    this.assertViewerAlive();
    this.viewer.scene.terrainProvider = terrain;
  }

  createEllipsoidTerrain(): Cesium.TerrainProvider {
    return new Cesium.EllipsoidTerrainProvider();
  }

  listenProviderErrors(
    provider: Cesium.ImageryProvider,
    listener: (error: unknown) => void,
  ): () => void {
    this.assertViewerAlive();
    const remove = provider.errorEvent.addEventListener(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      remove();
    };
  }

  disposeProvider(provider: Cesium.ImageryProvider): void {
    destroyConcreteResource(provider);
  }

  disposeTerrain(terrain: Cesium.TerrainProvider): void {
    destroyConcreteResource(terrain);
  }

  private assertViewerAlive(): void {
    if (this.viewer.isDestroyed()) {
      throw new Error("cannot mutate imagery on a destroyed Cesium Viewer");
    }
  }

  private releaseLayer(layer: Cesium.ImageryLayer): void {
    if (!this.viewer.isDestroyed()) {
      try {
        if (this.viewer.imageryLayers.remove(layer, true)) return;
      } catch {
        // Fall through to direct destruction while the Viewer is tearing down.
      }
    }
    if (!layer.isDestroyed()) layer.destroy();
  }
}
