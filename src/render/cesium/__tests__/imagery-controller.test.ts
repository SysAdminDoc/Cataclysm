import { describe, expect, it } from "vitest";
import {
  CesiumImageryController,
  type ImagerySelection,
  type ImagerySessionSnapshot,
} from "../imagery-controller";

interface Provider {
  id: string;
  disposed: boolean;
  listeners: Set<(error: unknown) => void>;
}

interface Terrain {
  id: string;
  disposed: boolean;
}

interface Layer {
  id: string;
  provider: Provider;
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

function provider(id: string): Provider {
  return { id, disposed: false, listeners: new Set() };
}

function selection(
  requestedStyle: string,
  resolvedStyle = requestedStyle,
  fallbackReason: "offline" | "missing-token" | null = null,
): ImagerySelection<string, Provider> {
  return {
    provider: provider(`${resolvedStyle}-provider`),
    requestedStyle,
    resolvedStyle,
    fallbackReason,
  };
}

function harness() {
  let layerId = 1;
  let terrainId = 1;
  let imageryBuilder = async (style: string, options: { online: boolean }) =>
    !options.online && style !== "offline"
      ? selection(style, "offline", "offline")
      : selection(style);
  let terrainBuilder = async (style: string) => ({
    id: `${style}-terrain-${terrainId++}`,
    disposed: false,
  });
  const baseLayers = new Set<Layer>();
  const overlays = new Set(["swe"]);
  const statuses: Array<{ status: string; message: string }> = [];
  const activeStyles: string[] = [];
  const sessions: ImagerySessionSnapshot<string>[] = [];
  const health: string[] = [];
  const disposedProviders: Provider[] = [];
  const disposedTerrains: Terrain[] = [];
  const controller = new CesiumImageryController<string, Provider, Terrain, Layer>({
    offlineStyle: "offline",
    styleLabel: (style) => ({ esri: "Esri World Imagery", token: "Cesium World Imagery", offline: "Natural Earth II" })[style] ?? style,
    buildImagery: (style, options) => imageryBuilder(style, options),
    buildTerrain: (style) => terrainBuilder(style),
    host: {
      addBaseLayer: (imageryProvider) => {
        const layer = { id: `layer-${layerId++}`, provider: imageryProvider };
        baseLayers.add(layer);
        return layer;
      },
      removeBaseLayer: (layer) => {
        baseLayers.delete(layer);
        layer.provider.disposed = true;
      },
      setTerrain: () => {},
      createEllipsoidTerrain: () => ({ id: `ellipsoid-${terrainId++}`, disposed: false }),
      listenProviderErrors: (imageryProvider, listener) => {
        imageryProvider.listeners.add(listener);
        return () => imageryProvider.listeners.delete(listener);
      },
      disposeProvider: (imageryProvider) => {
        imageryProvider.disposed = true;
        disposedProviders.push(imageryProvider);
      },
      disposeTerrain: (terrain) => {
        terrain.disposed = true;
        disposedTerrains.push(terrain);
      },
    },
    onStatus: (status, message) => statuses.push({ status, message }),
    onActiveStyle: (style) => activeStyles.push(style),
    publishSelection: (session) => sessions.push(session),
    publishHealth: (value) => health.push(value),
  });
  return {
    controller,
    baseLayers,
    overlays,
    statuses,
    activeStyles,
    sessions,
    health,
    disposedProviders,
    disposedTerrains,
    setImageryBuilder: (
      builder: typeof imageryBuilder,
    ) => {
      imageryBuilder = builder;
    },
    setTerrainBuilder: (
      builder: typeof terrainBuilder,
    ) => {
      terrainBuilder = builder;
    },
    emitError: (imageryProvider: Provider, error: unknown = new Error("tile")) => {
      for (const listener of [...imageryProvider.listeners]) listener(error);
    },
  };
}

describe("CesiumImageryController", () => {
  it("activates and retries a base layer without touching SWE overlays", async () => {
    const { controller, baseLayers, overlays, statuses, sessions, activeStyles } = harness();
    const generation = controller.beginViewerGeneration();
    await expect(controller.update(generation, { style: "esri", online: true })).resolves.toMatchObject({ status: "activated" });
    expect(statuses).toEqual([
      { status: "connecting", message: "Connecting to Esri World Imagery…" },
      { status: "ready", message: "Esri World Imagery ready." },
    ]);
    expect(activeStyles).toEqual(["esri"]);
    expect(sessions[0]).toEqual({
      requestedStyle: "esri",
      resolvedStyle: "esri",
      fallbackReason: null,
      health: "ready",
      dynamicAttributions: [],
    });
    expect(baseLayers.size).toBe(1);
    expect(overlays).toEqual(new Set(["swe"]));

    await controller.retry(generation);
    expect(baseLayers.size).toBe(1);
    expect(overlays).toEqual(new Set(["swe"]));
    expect(controller.diagnostics()).toMatchObject({
      ownedBaseLayerCount: 1,
      ownedProviderListenerCount: 1,
      activatedBaseLayerCount: 2,
      removedBaseLayerCount: 1,
      retryCount: 1,
    });
  });

  it("preserves offline and missing-token status and session semantics", async () => {
    const { controller, statuses, sessions, setImageryBuilder } = harness();
    const generation = controller.beginViewerGeneration();
    await controller.update(generation, { style: "esri", online: false });
    expect(statuses.at(-1)).toEqual({
      status: "fallback",
      message: "Offline — using bundled Natural Earth II instead of Esri World Imagery.",
    });
    expect(sessions.at(-1)).toMatchObject({
      requestedStyle: "esri",
      resolvedStyle: "offline",
      fallbackReason: "offline",
      health: "degraded",
    });

    setImageryBuilder(async (style) => selection(style, "offline", "missing-token"));
    await controller.update(generation, { style: "token", online: true });
    expect(statuses.at(-1)).toEqual({
      status: "fallback",
      message: "Cesium World Imagery needs a Cesium token; using bundled Natural Earth II.",
    });
    expect(sessions.at(-1)).toMatchObject({
      requestedStyle: "token",
      fallbackReason: "missing-token",
      health: "degraded",
    });
  });

  it("degrades on the first tile error and falls back exactly once on the second", async () => {
    const {
      controller,
      baseLayers,
      statuses,
      sessions,
      health,
      setImageryBuilder,
      emitError,
    } = harness();
    let fallbackBuilds = 0;
    setImageryBuilder(async (style) => {
      if (style === "offline") fallbackBuilds += 1;
      return selection(style);
    });
    const generation = controller.beginViewerGeneration();
    await controller.update(generation, { style: "esri", online: true });
    const onlineProvider = [...baseLayers][0].provider;
    emitError(onlineProvider);
    expect(statuses.at(-1)).toEqual({
      status: "degraded",
      message: "Esri World Imagery is losing tiles; retrying before fallback.",
    });
    expect(health).toEqual(["degraded"]);
    emitError(onlineProvider);
    emitError(onlineProvider);
    await controller.whenIdle();

    expect(fallbackBuilds).toBe(1);
    expect(baseLayers.size).toBe(1);
    expect(statuses.at(-1)).toEqual({
      status: "fallback",
      message: "Esri World Imagery stopped serving tiles. Using bundled Natural Earth II.",
    });
    expect(sessions.at(-1)).toMatchObject({
      requestedStyle: "esri",
      resolvedStyle: "offline",
      fallbackReason: "provider-error",
      health: "degraded",
    });
    expect(controller.diagnostics().fallbackAttemptCount).toBe(1);

    const localProvider = [...baseLayers][0].provider;
    emitError(localProvider);
    expect(statuses.at(-1)).toEqual({
      status: "failed",
      message: "Bundled Natural Earth imagery could not be read.",
    });
    expect(health.at(-1)).toBe("failed");
  });

  it("reports failure when initialization and bundled fallback both fail", async () => {
    const { controller, statuses, sessions, setImageryBuilder } = harness();
    setImageryBuilder(async () => {
      throw new Error("provider unavailable");
    });
    const generation = controller.beginViewerGeneration();
    await expect(controller.update(generation, { style: "esri", online: true })).resolves.toMatchObject({ status: "failed" });
    expect(statuses.at(-1)).toEqual({
      status: "failed",
      message: "Online imagery and bundled Natural Earth II both failed.",
    });
    expect(sessions.at(-1)).toMatchObject({
      requestedStyle: "esri",
      resolvedStyle: "offline",
      fallbackReason: "provider-error",
      health: "failed",
    });
    expect(controller.diagnostics()).toMatchObject({
      fallbackAttemptCount: 1,
      failedRequestCount: 1,
      pendingAsyncCount: 0,
    });
  });

  it("generation-invalidates and disposes a late provider", async () => {
    const { controller, disposedProviders, setImageryBuilder } = harness();
    const late = deferred<ImagerySelection<string, Provider>>();
    setImageryBuilder(() => late.promise);
    const firstGeneration = controller.beginViewerGeneration();
    const outcome = controller.update(firstGeneration, { style: "esri", online: true });
    controller.beginViewerGeneration();
    late.resolve(selection("esri"));
    await expect(outcome).resolves.toMatchObject({ status: "stale" });
    expect(disposedProviders).toHaveLength(1);
    expect(controller.diagnostics()).toMatchObject({
      pendingAsyncCount: 0,
      ownedBaseLayerCount: 0,
      ownedProviderListenerCount: 0,
      staleResultCount: 1,
      staleProviderDisposalCount: 1,
    });
  });

  it("keeps only the latest of 100 rapid updates and destroys with zero ownership", async () => {
    const {
      controller,
      baseLayers,
      overlays,
      disposedProviders,
      setImageryBuilder,
    } = harness();
    const loads: Array<Deferred<ImagerySelection<string, Provider>>> = [];
    setImageryBuilder((style) => {
      const load = deferred<ImagerySelection<string, Provider>>();
      loads.push(load);
      return load.promise.then((result) => ({ ...result, requestedStyle: style, resolvedStyle: style }));
    });
    const generation = controller.beginViewerGeneration();
    const outcomes: Array<Promise<unknown>> = [];
    for (let index = 0; index < 100; index += 1) {
      outcomes.push(controller.update(generation, { style: `style-${index}`, online: true }));
    }
    for (let index = 0; index < 100; index += 1) {
      loads[index].resolve(selection(`style-${index}`));
    }
    await Promise.all(outcomes);

    expect(baseLayers.size).toBe(1);
    expect([...baseLayers][0].provider.id).toBe("style-99-provider");
    expect(disposedProviders).toHaveLength(99);
    expect(overlays).toEqual(new Set(["swe"]));
    expect(controller.diagnostics()).toMatchObject({
      pendingAsyncCount: 0,
      ownedBaseLayerCount: 1,
      ownedProviderListenerCount: 1,
      startedRequestCount: 100,
      abortedRequestCount: 99,
      staleResultCount: 99,
      staleProviderDisposalCount: 99,
    });

    controller.destroy();
    controller.destroy();
    expect(baseLayers.size).toBe(0);
    expect(overlays).toEqual(new Set(["swe"]));
    expect(controller.diagnostics()).toMatchObject({
      destroyed: true,
      pendingAsyncCount: 0,
      ownedBaseLayerCount: 0,
      ownedProviderListenerCount: 0,
      attachedProviderListenerCount: 1,
      removedProviderListenerCount: 1,
      activatedBaseLayerCount: 1,
      removedBaseLayerCount: 1,
    });
  });
});
