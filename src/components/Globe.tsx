import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import * as Cesium from "cesium";
import { configureCesium } from "../lib/cesium";
import {
  buildImagery,
  buildTerrain,
  DEFAULT_STYLE,
  findStyle,
  OFFLINE_STYLE,
  type GlobeStyleId,
} from "../lib/globe-styles";
import { settings } from "../lib/settings";
import {
  publishEarthSession,
  type EarthAssetHealth,
  type EarthSessionSnapshot,
} from "../lib/earth-assets";
import { referenceCaptureEnabled } from "../lib/reference-capture";
import { demoInspectAtPoint } from "../lib/demo";
import { api, isTauri, type RunupAtPointResult } from "../lib/tauri";
import type {
  DartBuoy,
  GridSnapshot,
  InitialDisplacement,
  PropagationSnapshot,
} from "../types/scenario";
import type { EffectRing, GeoPoint } from "../hazards/types";
import type { RendererNeutralFrameView } from "../types/render-protocol";
import type { FireballEvent } from "../types/jpl";
import { AsyncGenerationOwner } from "../render/cesium/generation";
import { DirectEffectsController } from "../render/cesium/direct-effects";
import { CesiumDirectEffectsHost } from "../render/cesium/cesium-direct-effects-host";
import { commitReferenceFrame } from "../render/cesium/reference-frame-commit";
import { resolveSweImageryTiles } from "../render/cesium/swe-field-tiles";
import { CameraTelemetryController } from "../render/cesium/camera-telemetry";
import { CesiumCameraTelemetryHost } from "../render/cesium/cesium-camera-telemetry-host";
import {
  OutcomeFocusController,
  type OutcomeFocusRequest,
} from "../render/cesium/outcome-focus";
import { CesiumOutcomeFocusHost } from "../render/cesium/cesium-outcome-focus-host";
import { configurePlanet } from "../render/cesium/planet";
import { AsyncResourceCoordinator } from "../render/cesium/async-resource-coordinator";
import { StaticHazardController } from "../render/cesium/static-hazards";
import { CesiumStaticHazardHost } from "../render/cesium/cesium-static-hazard-host";
import { ReferenceCaptureBridgeController } from "../render/cesium/reference-capture-bridge";
import { CesiumReferenceCaptureHost } from "../render/cesium/cesium-reference-capture-host";
import { ViewerLifecycle } from "../render/cesium/viewer-lifecycle";
import { TsunamiAnalyticalController } from "../render/cesium/tsunami-analytical";
import { CesiumTsunamiAnalyticalHost } from "../render/cesium/cesium-tsunami-analytical-host";
import {
  buildInspectionRequest,
  directHazardProbeReport,
  formatPointProbeReport,
  tsunamiProbeReport,
  type PointProbeReport,
} from "../render/cesium/inspection";
import {
  InteractionOwnershipController,
  type InteractionLease,
} from "../render/cesium/interaction-ownership-controller";
import {
  CesiumInteractionOwnershipHost,
  type CesiumEscapeListener,
  type CesiumInteractionMode,
} from "../render/cesium/cesium-interaction-host";
import { TsunamiSourceController } from "../render/cesium/tsunami-source";
import { CesiumTsunamiSourceHost } from "../render/cesium/cesium-tsunami-source-host";
import { RunupOverlayController } from "../render/cesium/runup-overlay-controller";
import { createCesiumRunupOverlayHost } from "../render/cesium/cesium-runup-overlay-host";
import { CesiumInspectionPresenter } from "../render/cesium/cesium-inspection-presenter";
import {
  CesiumImageryController,
  type ImageryControllerStatus,
} from "../render/cesium/imagery-controller";
import { CesiumImageryHost } from "../render/cesium/cesium-imagery-host";
import {
  CesiumQualityRuntime,
  type CesiumQualityDiagnostics,
} from "../render/quality/cesium-quality-runtime";
import type { RendererQualityTier } from "../render/quality/quality-controller";
import {
  rejectAsyncResult,
  startAsyncResult,
  type AsyncResult,
} from "../lib/async-result";

type Props = {
  domain?: "tsunami" | "asteroid" | "nuclear";
  initial: InitialDisplacement | null;
  wavefront: PropagationSnapshot | null;
  /** Live SWE solver snapshot (PNG + bbox) to paint on the globe. */
  sweSnapshot?: GridSnapshot | null;
  /** Coastal runup samples to render as 3D bars at coastline points. */
  runupResults?: RunupAtPointResult[];
  /** DART buoy pins for the active historical preset. */
  dartBuoys?: DartBuoy[];
  /** Override style; if absent, the persisted Settings style is used. */
  styleId?: GlobeStyleId;
  /**
   * When set, the globe is in "pick" mode: the next click is consumed,
   * cartographic coords are reported, and the mode toggles off automatically.
   */
  pickMode?: boolean;
  onPick?: (lat: number, lon: number) => void;
  onPickCancel?: () => void;
  /** F-V11 — Inspect mode: clicking the globe pops a tooltip showing
   *  range / amplitude / arrival / runup at that point. */
  inspectMode?: boolean;
  inspectIsImpact?: boolean;
  inspectTimeS?: number;
  /** Stable handle for a completed Rust-authoritative asteroid/nuclear result. */
  directHazardResultId?: string | null;
  /** Compare mode drives every pane from the same exact probe coordinate. */
  inspectionCoordinate?: GeoPoint | null;
  onInspectionCoordinate?: (coordinate: GeoPoint) => void;
  onInspectionReport?: (report: PointProbeReport) => void;
  onInspectCancel?: () => void;
  onAddGauge?: (lat: number, lon: number) => void;
  /** Whether this is the primary (exportable) globe pane. Only the primary
   *  pane keeps the WebGL backbuffer alive for PNG/share/video export — the
   *  Slot B compare pane skips that per-frame cost. */
  primary?: boolean;
  /** First-arrival time contours from a completed SWE run; rendered as
   *  labelled polylines when the playback panel's Arrivals toggle is on. */
  isochrones?: import("../types/scenario").Isochrone[] | null;
  /** Non-tsunami hazard effect rings (nuclear/asteroid), drawn as concentric
   *  ground ellipses at hazardCenter. Radii are in meters, largest-first. */
  hazardRings?: EffectRing[] | null;
  hazardCenter?: GeoPoint | null;
  /** Fallout plume polygons (nuclear surface bursts): closed lon/lat rings. */
  hazardPolygons?: { label: string; color: string; points: GeoPoint[] }[] | null;
  /** Located CNEOS atmospheric events, rendered as bounded point primitives. */
  fireballs?: FireballEvent[];
  /** Which authoritative direct-hazard frame family should render. */
  impactKind?: "asteroid" | "nuclear" | null;
  directRenderFrame: RendererNeutralFrameView | null;
  /** Camera-only scenario preview. It never creates physics or effect state. */
  previewCamera?: {
    targetLat: number;
    targetLon: number;
    rangeM: number;
    headingDeg: number;
    pitchDeg: number;
  } | null;
  previewLabel?: string | null;
  /** Result-driven place/time focus. The request id makes repeated renders idempotent. */
  outcomeFocus?: OutcomeFocusRequest | null;
  onOutcomeFocusTime?: (simulationTimeS: number) => void;
  /** Lightweight camera telemetry for the desktop viewport HUD. */
  onCameraTelemetry?: (telemetry: { lat: number; lon: number; altitudeM: number; headingDeg: number }) => void;
  /** Application-owned text equivalent for the otherwise canvas-only scene. */
  accessibleSceneLabel?: string;
  simulationTimeS?: number;
  accessibleCameraTelemetry?: { lat: number; lon: number; altitudeM: number; headingDeg: number };
};

type SweImageryResource = {
  providers: Cesium.SingleTileImageryProvider[];
  layers: Cesium.ImageryLayer[];
};
function CoordEntryForm({
  onSubmit,
  label,
}: {
  onSubmit: (lat: number, lon: number) => void;
  label: string;
}) {
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const validationId = useId();
  const hasBoth = lat.trim().length > 0 && lon.trim().length > 0;
  const la = hasBoth ? Number(lat) : Number.NaN;
  const lo = hasBoth ? Number(lon) : Number.NaN;
  const coordinatesValid =
    Number.isFinite(la) && Number.isFinite(lo) && la >= -90 && la <= 90 && lo >= -180 && lo <= 180;
  const validationMessage = !hasBoth
    ? "Enter both latitude and longitude."
    : coordinatesValid
      ? null
      : "Latitude must be -90 to 90 and longitude -180 to 180.";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!coordinatesValid) return;
    onSubmit(la, lo);
  }

  return (
    <form className="coord-entry" onSubmit={handleSubmit} aria-label={label}>
      <span className="coord-entry__label">{label}</span>
      <input
        type="number"
        placeholder="Lat (°)"
        aria-label="Latitude"
        step="any"
        min={-90}
        max={90}
        value={lat}
        required
        aria-invalid={lat.length > 0 && (!Number.isFinite(la) || la < -90 || la > 90)}
        aria-describedby={validationId}
        onChange={(e) => setLat(e.target.value)}
        className="coord-entry__input"
      />
      <input
        type="number"
        placeholder="Lon (°)"
        aria-label="Longitude"
        step="any"
        min={-180}
        max={180}
        value={lon}
        required
        aria-invalid={lon.length > 0 && (!Number.isFinite(lo) || lo < -180 || lo > 180)}
        aria-describedby={validationId}
        onChange={(e) => setLon(e.target.value)}
        className="coord-entry__input"
      />
      <button type="submit" className="coord-entry__go" disabled={!coordinatesValid}>Go</button>
      <span id={validationId} className="coord-entry__validation" role="status">
        {validationMessage}
      </span>
    </form>
  );
}

type GlobeInteractionController = InteractionOwnershipController<
  CesiumInteractionMode,
  Cesium.ScreenSpaceEventHandler,
  CesiumEscapeListener,
  Cesium.Entity
>;

/**
 * Cesium globe with optional GEBCO bathymetry. Renders:
 *  - the source location as a 3D cavity cylinder (height = cavity depth, colored
 *    by amplitude)
 *  - the wavefront sample ring(s) as concentric polylines, updated in-place to
 *    avoid entity thrash on time-slider drag.
 *  - empty state when no source is selected
 *  - loading badge while bathymetry tileset streams
 *  - click-to-pick mode for scenario-builder location selection
 *
 * All physics state comes from props. The Viewer is created once and reused.
 */
export function Globe({
  domain = "tsunami",
  initial,
  wavefront,
  sweSnapshot,
  runupResults,
  dartBuoys,
  styleId,
  pickMode,
  onPick,
  onPickCancel,
  inspectMode,
  inspectIsImpact,
  inspectTimeS,
  directHazardResultId,
  inspectionCoordinate,
  onInspectionCoordinate,
  onInspectionReport,
  onInspectCancel,
  onAddGauge,
  primary = true,
  isochrones,
  hazardRings,
  hazardCenter,
  hazardPolygons,
  fireballs = [],
  impactKind,
  directRenderFrame,
  previewCamera,
  previewLabel,
  outcomeFocus,
  onOutcomeFocusTime,
  onCameraTelemetry,
  accessibleSceneLabel = "Unconfigured planetary hazard scene",
  simulationTimeS = 0,
  accessibleCameraTelemetry,
}: Props) {
  const sceneSummaryId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const viewerLifecycleRef = useRef<ViewerLifecycle<Cesium.Viewer> | null>(null);
  const viewerGenerationRef = useRef(0);
  const inspectGenerationRef = useRef<AsyncGenerationOwner<Cesium.Viewer> | null>(null);
  const inspectionPresenterRef = useRef<CesiumInspectionPresenter | null>(null);
  const interactionControllerRef = useRef<GlobeInteractionController | null>(null);
  const interactionLeaseRef = useRef<InteractionLease<CesiumInteractionMode> | null>(null);
  const directEffectsControllerRef = useRef<DirectEffectsController<Cesium.Entity> | null>(null);
  const staticHazardControllerRef = useRef<StaticHazardController<Cesium.Entity> | null>(null);
  const tsunamiAnalyticalControllerRef = useRef<TsunamiAnalyticalController<Cesium.Entity> | null>(null);
  const tsunamiSourceControllerRef = useRef<TsunamiSourceController<Cesium.Entity> | null>(null);
  const outcomeFocusControllerRef = useRef<OutcomeFocusController | null>(null);
  const outcomeFocusTimeSinkRef = useRef(onOutcomeFocusTime);
  outcomeFocusTimeSinkRef.current = onOutcomeFocusTime;
  const runupOverlayControllerRef = useRef<
    RunupOverlayController<
      Cesium.BufferPolylineCollection,
      Cesium.BufferPolygonCollection,
      Cesium.Entity
    > | null
  >(null);
  const [lastInspectCoord, setLastInspectCoord] = useState<{ lat: number; lon: number } | null>(null);
  const [lastInspectionSummary, setLastInspectionSummary] = useState<string | null>(null);
  const [inspectionResult, setInspectionResult] = useState<AsyncResult<{ lat: number; lon: number; text: string }>>({ status: "idle" });
  const sweCoordinatorRef = useRef<{
    coordinator: AsyncResourceCoordinator<SweImageryResource>;
    generation: number;
  } | null>(null);
  const imageryControllerRef = useRef<{
    controller: CesiumImageryController<
      GlobeStyleId,
      Cesium.ImageryProvider,
      Cesium.TerrainProvider,
      Cesium.ImageryLayer
    >;
    generation: number;
  } | null>(null);
  const earthSessionRef = useRef<{
    requestedStyle: GlobeStyleId;
    resolvedStyle: GlobeStyleId;
    fallbackReason: EarthSessionSnapshot["fallbackReason"];
    health: EarthAssetHealth;
    dynamicAttributions: string[];
  } | null>(null);
  const [imageryStatus, setImageryStatus] = useState<ImageryControllerStatus>("connecting");
  const [imageryMessage, setImageryMessage] = useState("Connecting to globe imagery…");
  const [activeImageryStyle, setActiveImageryStyle] = useState<GlobeStyleId | null>(null);
  const [networkOnline, setNetworkOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  const [imageryRetryNonce, setImageryRetryNonce] = useState(0);
  const [resolvedStyle, setResolvedStyle] = useState<GlobeStyleId>(styleId ?? DEFAULT_STYLE);
  // Bumped each time the Viewer is (re)created. React 19 StrictMode mounts →
  // unmounts → remounts in dev, which destroys the first Viewer; including this
  // in every data effect's deps re-binds entities/imagery to the fresh Viewer
  // instead of leaving the dev globe blank until the next prop change.
  const [viewerEpoch, setViewerEpoch] = useState(0);
  const [rendererResetNonce, setRendererResetNonce] = useState(0);
  const [rendererError, setRendererError] = useState<string | null>(null);
  const [qualityConfig, setQualityConfig] = useState<{
    tier: RendererQualityTier;
    automatic: boolean;
  }>({ tier: "High", automatic: true });
  const [qualityDiagnostics, setQualityDiagnostics] = useState<CesiumQualityDiagnostics | null>(null);
  const activeLayerLabels = useMemo(() => {
    const labels = [`${findStyle(resolvedStyle).label} base imagery`];
    if (initial) labels.push("source geometry");
    if (wavefront) labels.push("analytical wavefront");
    if (sweSnapshot) labels.push("SWE water field");
    if ((isochrones?.length ?? 0) > 0) labels.push("arrival isochrones");
    if ((runupResults?.length ?? 0) > 0) labels.push("coastal runup samples");
    if ((dartBuoys?.length ?? 0) > 0) labels.push("DART observations");
    if (hazardCenter) labels.push("effects origin");
    if ((hazardRings?.length ?? 0) > 0) labels.push("hazard effect rings");
    if ((hazardPolygons?.length ?? 0) > 0) labels.push("fallout plume");
    if (directRenderFrame) labels.push("authoritative direct-effects frame");
    return labels;
  }, [
    dartBuoys,
    directRenderFrame,
    hazardCenter,
    hazardPolygons,
    hazardRings,
    initial,
    isochrones,
    resolvedStyle,
    runupResults,
    sweSnapshot,
    wavefront,
  ]);
  const accessibilitySummary = useMemo(() => {
    const camera = accessibleCameraTelemetry;
    const cameraSummary = camera
      ? `Camera centered at ${Math.abs(camera.lat).toFixed(2)} degrees ${camera.lat >= 0 ? "north" : "south"}, ${Math.abs(camera.lon).toFixed(2)} degrees ${camera.lon >= 0 ? "east" : "west"}, at ${camera.altitudeM >= 1_000_000 ? `${(camera.altitudeM / 1_000_000).toFixed(1)} megametres` : `${(camera.altitudeM / 1_000).toFixed(0)} kilometres`} altitude.`
      : "Camera position is not available for this comparison pane.";
    const rendererSummary = rendererError
      ? `Renderer failed: ${rendererError}`
      : imageryStatus === "ready"
        ? "Renderer and base imagery are ready."
        : `Renderer imagery is ${imageryStatus}: ${imageryMessage}`;
    const interactionSummary = lastInspectionSummary
      ?? (inspectMode
        ? "Inspect mode is active; choose the globe or enter latitude and longitude."
        : pickMode
          ? "Location picking is active; choose the globe or enter latitude and longitude."
          : "Latitude and longitude entry is available when location picking or inspection is active.");
    return `${accessibleSceneLabel}. ${cameraSummary} Scenario time T plus ${Math.round(simulationTimeS / 60)} minutes. Visible analytical layers: ${activeLayerLabels.join(", ")}. ${rendererSummary} ${interactionSummary}`;
  }, [
    accessibleCameraTelemetry,
    accessibleSceneLabel,
    activeLayerLabels,
    imageryMessage,
    imageryStatus,
    inspectMode,
    lastInspectionSummary,
    pickMode,
    rendererError,
    simulationTimeS,
  ]);
  const [announcedAccessibilitySummary, setAnnouncedAccessibilitySummary] = useState("");
  const announcedAccessibilitySummaryRef = useRef("");
  useEffect(() => {
    const delayMs = announcedAccessibilitySummaryRef.current ? 1_200 : 0;
    const timer = window.setTimeout(() => {
      announcedAccessibilitySummaryRef.current = accessibilitySummary;
      setAnnouncedAccessibilitySummary(accessibilitySummary);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [accessibilitySummary]);

  // One-time viewer mount
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    configureCesium();

    const viewer = new Cesium.Viewer(containerRef.current, {
      terrain: undefined,
      // Don't auto-pick a default base layer — we install our own below
      // (Natural Earth by default) so first launch does not depend on
      // network tiles or a token.
      baseLayer: false as unknown as Cesium.ImageryLayer,
      baseLayerPicker: false,
      geocoder: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      homeButton: false,
      timeline: false,
      animation: false,
      fullscreenButton: false,
      selectionIndicator: false,
      infoBox: false,
      // Only the primary (exportable) pane pays the preserveDrawingBuffer
      // compositing cost; canvas.toDataURL/captureStream target Slot A only.
      contextOptions: { webgl: { preserveDrawingBuffer: primary } },
    });

    configurePlanet(viewer);

    viewerRef.current = viewer;
    viewerGenerationRef.current += 1;
    const lifecycle = new ViewerLifecycle(
      viewer,
      viewerGenerationRef.current,
      (ownedViewer) => {
        if (ownedViewer.isDestroyed()) return;
        // Stop Cesium's tick/render loop before destroying the widget. Child
        // systems have already released every app-owned resource through the
        // lifecycle; clearing Cesium's collections here races the
        // DataSourceDisplay visualizers that are still unwinding a tick.
        ownedViewer.useDefaultRenderLoop = false;
        ownedViewer.clock.shouldAnimate = false;
        ownedViewer.camera.cancelFlight();
        ownedViewer.destroy();
      },
    );
    viewerLifecycleRef.current = lifecycle;
    directEffectsControllerRef.current = new DirectEffectsController(
      new CesiumDirectEffectsHost(viewer),
    );
    lifecycle.ownSystem(() => directEffectsControllerRef.current?.destroy());
    staticHazardControllerRef.current = new StaticHazardController(
      new CesiumStaticHazardHost(viewer, referenceCaptureEnabled()),
      viewerGenerationRef.current,
    );
    lifecycle.ownSystem(() => staticHazardControllerRef.current?.destroy());
    tsunamiAnalyticalControllerRef.current = new TsunamiAnalyticalController(
      new CesiumTsunamiAnalyticalHost(viewer),
      viewerGenerationRef.current,
    );
    lifecycle.ownSystem(() => tsunamiAnalyticalControllerRef.current?.destroy());
    tsunamiSourceControllerRef.current = new TsunamiSourceController(
      new CesiumTsunamiSourceHost(viewer),
      viewerGenerationRef.current,
    );
    lifecycle.ownSystem(() => tsunamiSourceControllerRef.current?.destroy());
    outcomeFocusControllerRef.current = new OutcomeFocusController(
      new CesiumOutcomeFocusHost(
        viewer,
        (timeS) => outcomeFocusTimeSinkRef.current?.(timeS),
      ),
      viewerGenerationRef.current,
    );
    lifecycle.ownSystem(() => outcomeFocusControllerRef.current?.destroy());
    const runupOverlayController = new RunupOverlayController(
      createCesiumRunupOverlayHost(viewer),
    );
    runupOverlayControllerRef.current = runupOverlayController;
    lifecycle.ownSystem(() => runupOverlayController.destroy());
    const imageryController = new CesiumImageryController({
      offlineStyle: OFFLINE_STYLE,
      styleLabel: (style: GlobeStyleId) => findStyle(style).label,
      buildImagery: (style, options) =>
        buildImagery(style, {
          online: options.online,
          hasToken: options.hasToken,
        }),
      buildTerrain: (style) => buildTerrain(style),
      host: new CesiumImageryHost(viewer),
      onStatus: (status, message) => {
        setImageryStatus(status);
        setImageryMessage(message);
      },
      onActiveStyle: setActiveImageryStyle,
      publishSelection: (session) => {
        if (!primary) return;
        earthSessionRef.current = session;
        publishEarthSession(session);
      },
      publishHealth: (health) => {
        if (!primary || !earthSessionRef.current) return;
        earthSessionRef.current = { ...earthSessionRef.current, health };
        publishEarthSession(earthSessionRef.current);
      },
      warn: (message, error) => console.warn(message, error),
      error: (message, error) => console.error(message, error),
    });
    imageryControllerRef.current = {
      controller: imageryController,
      generation: imageryController.beginViewerGeneration(),
    };
    lifecycle.ownSystem(() => imageryController.destroy());
    const sweCoordinator = new AsyncResourceCoordinator<SweImageryResource>({
      dispose: (resource) => {
        if (!viewer.isDestroyed()) {
          for (const layer of resource.layers) {
            viewer.imageryLayers.remove(layer, true);
          }
        }
        resource.layers.length = 0;
      },
    });
    sweCoordinatorRef.current = {
      coordinator: sweCoordinator,
      generation: sweCoordinator.beginViewerGeneration(),
    };
    lifecycle.ownSystem(() => sweCoordinator.destroy());
    const inspectGeneration = new AsyncGenerationOwner<Cesium.Viewer>();
    inspectGenerationRef.current = inspectGeneration;
    lifecycle.ownSystem(() => inspectGeneration.destroy());
    const inspectionPresenter = new CesiumInspectionPresenter(
      viewer,
      viewerGenerationRef.current,
    );
    inspectionPresenterRef.current = inspectionPresenter;
    lifecycle.ownSystem(() => inspectionPresenter.destroy());
    const interactionController = new InteractionOwnershipController(
      new CesiumInteractionOwnershipHost(viewer),
    );
    interactionControllerRef.current = interactionController;
    lifecycle.ownSystem(() => interactionController.destroy());
    // Signal dependent effects that a (new) viewer is live so they re-bind.
    setViewerEpoch((n) => n + 1);

    return () => {
      lifecycle.destroy();
      if (viewerLifecycleRef.current === lifecycle) viewerLifecycleRef.current = null;
      if (inspectGenerationRef.current === inspectGeneration) inspectGenerationRef.current = null;
      if (inspectionPresenterRef.current === inspectionPresenter) inspectionPresenterRef.current = null;
      if (interactionControllerRef.current === interactionController) interactionControllerRef.current = null;
      interactionLeaseRef.current = null;
      directEffectsControllerRef.current = null;
      staticHazardControllerRef.current = null;
      tsunamiAnalyticalControllerRef.current = null;
      tsunamiSourceControllerRef.current = null;
      outcomeFocusControllerRef.current = null;
      if (runupOverlayControllerRef.current === runupOverlayController) {
        runupOverlayControllerRef.current = null;
      }
      if (imageryControllerRef.current?.controller === imageryController) {
        imageryControllerRef.current = null;
      }
      sweCoordinatorRef.current = null;
      viewerRef.current = null;
    };
  }, [primary, rendererResetNonce]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const current = await settings.loadAll();
      if (!cancelled) {
        setQualityConfig({
          tier: current.renderer_quality,
          automatic: current.renderer_auto_quality,
        });
      }
    };
    void load();
    const onSettingsSaved = () => void load();
    window.addEventListener("tsunamisim:settings-saved", onSettingsSaved);
    return () => {
      cancelled = true;
      window.removeEventListener("tsunamisim:settings-saved", onSettingsSaved);
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    const lifecycle = viewerLifecycleRef.current;
    if (!viewer || !lifecycle) return;
    const runtime = new CesiumQualityRuntime(viewer, {
      requestedTier: qualityConfig.tier,
      automatic: referenceCaptureEnabled() ? false : qualityConfig.automatic,
      publishGlobal: primary,
      onDiagnostics: setQualityDiagnostics,
      onRecoverableError: setRendererError,
    });
    setRendererError(null);
    const lease = lifecycle.ownSystem(() => runtime.destroy());
    return () => lease.release();
  }, [primary, qualityConfig, viewerEpoch]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const lifecycle = viewerLifecycleRef.current;
    if (!viewer || !lifecycle || !onCameraTelemetry) return;
    const controller = new CameraTelemetryController(
      new CesiumCameraTelemetryHost(viewer),
      onCameraTelemetry,
    );
    controller.start();
    const lease = lifecycle.ownSystem(() => controller.destroy());
    return () => lease.release();
  }, [onCameraTelemetry, viewerEpoch]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const lifecycle = viewerLifecycleRef.current;
    if (!viewer || !lifecycle || viewerEpoch === 0 || !primary || !referenceCaptureEnabled()) return;
    const controller = new ReferenceCaptureBridgeController(
      new CesiumReferenceCaptureHost(viewer),
    );
    controller.enable();
    const lease = lifecycle.ownSystem(() => controller.destroy());
    return () => lease.release();
  }, [primary, viewerEpoch]);

  // Resolve which globe style we should be using — prop override, persisted
  // setting, or DEFAULT_STYLE. Listens for `tsunamisim:settings-saved`
  // so the user sees the change without having to restart.
  useEffect(() => {
    if (styleId) {
      setResolvedStyle(styleId);
      return;
    }
    let cancelled = false;
    const load = () => {
      settings
        .getGlobeStyle()
        .then((s) => {
          if (!cancelled) setResolvedStyle(s);
        })
        .catch(() => {
          if (!cancelled) setResolvedStyle(DEFAULT_STYLE);
        });
    };
    load();
    const onSettingsSaved = () => {
      load();
      setImageryRetryNonce((nonce) => nonce + 1);
    };
    window.addEventListener("tsunamisim:settings-saved", onSettingsSaved);
    return () => {
      cancelled = true;
      window.removeEventListener("tsunamisim:settings-saved", onSettingsSaved);
    };
  }, [styleId]);

  useEffect(() => {
    const goOffline = () => setNetworkOnline(false);
    const goOnline = () => setNetworkOnline(true);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  // Cesium providers can supply location-dependent credits only after tiles
  // render. Mirror those live credits into the active Earth session so media
  // export can fail closed until the required attribution is available.
  useEffect(() => {
    const viewer = viewerRef.current;
    const lifecycle = viewerLifecycleRef.current;
    if (!viewer || !lifecycle || !primary) return;
    let lastCredits = "";
    const syncCredits = () => {
      const session = earthSessionRef.current;
      if (!session) return;
      const root = viewer.cesiumWidget.creditContainer;
      const credits = [...root.querySelectorAll<HTMLElement>("a, .cesium-credit-text, img")]
        .map((element) =>
          element.textContent?.trim() ||
          element.getAttribute("aria-label")?.trim() ||
          element.getAttribute("title")?.trim() ||
          element.getAttribute("alt")?.trim() ||
          "",
        )
        .filter(Boolean);
      if (credits.length === 0 && root.textContent?.trim()) credits.push(root.textContent.trim());
      const uniqueCredits = [...new Set(credits)];
      const key = uniqueCredits.join("\n");
      if (key === lastCredits) return;
      lastCredits = key;
      earthSessionRef.current = { ...session, dynamicAttributions: uniqueCredits };
      publishEarthSession(earthSessionRef.current);
    };
    const remove = viewer.scene.postRender.addEventListener(syncCredits);
    syncCredits();
    const lease = lifecycle.own("listeners", remove);
    return () => lease.release();
  }, [primary, viewerEpoch]);

  useEffect(() => {
    const ownership = imageryControllerRef.current;
    if (!ownership) return;
    void ownership.controller
      .update(ownership.generation, {
        style: resolvedStyle,
        online: networkOnline,
      })
      .catch((error) => console.error("[globe] imagery controller failed", error));
  }, [resolvedStyle, viewerEpoch, networkOnline, imageryRetryNonce]);

  const runInspection = useCallback((lat: number, lon: number) => {
    const viewer = viewerRef.current;
    const inspectGeneration = inspectGenerationRef.current;
    const inspectionPresenter = inspectionPresenterRef.current;
    const interactionController = interactionControllerRef.current;
    const interactionLease = interactionLeaseRef.current;
    if (
      !viewer ||
      !inspectGeneration ||
      !inspectionPresenter ||
      !interactionController ||
      !interactionLease ||
      interactionLease.mode.kind !== "inspect" ||
      (!initial && !directHazardResultId)
    ) return;
    setLastInspectCoord({ lat, lon });
    onInspectionCoordinate?.({ lat, lon });
    setInspectionResult((current) => startAsyncResult(current));
    setLastInspectionSummary(`Inspection at ${lat.toFixed(2)} degrees latitude, ${lon.toFixed(2)} degrees longitude is in progress.`);
    const directRequest = directHazardResultId
      ? { result_id: directHazardResultId, click_lat: lat, click_lon: lon }
      : null;
    const request = directRequest ?? buildInspectionRequest(initial!, lat, lon, {
      isImpact: inspectIsImpact,
      timeS: inspectTimeS,
    });
    const inspectPromise = directRequest
      ? api.probeDirectHazard(directRequest).then(directHazardProbeReport)
      : (isTauri()
          ? api.inspectAtPoint(request as ReturnType<typeof buildInspectionRequest>)
          : Promise.resolve(demoInspectAtPoint(request as ReturnType<typeof buildInspectionRequest>)))
        .then((result) => tsunamiProbeReport(lat, lon, result));
    const token = inspectGeneration.setContext(viewer, "inspect", request);

    void inspectGeneration
      .guard(token, inspectPromise, (result) => {
        if (
          interactionControllerRef.current !== interactionController ||
          inspectionPresenterRef.current !== inspectionPresenter
        ) return;
        const text = formatPointProbeReport(result);
        onInspectionReport?.(result);
        inspectionPresenter.present({
          lat,
          lon,
          text,
        });
        setInspectionResult({ status: "ready", value: { lat, lon, text } });
        setLastInspectionSummary(`Inspected point ${text}`);
      })
      .catch((error) => {
        setInspectionResult((current) => rejectAsyncResult(current, error));
        setLastInspectionSummary(`Inspection failed at ${lat.toFixed(2)} degrees latitude, ${lon.toFixed(2)} degrees longitude.`);
        console.warn("[globe] inspect_at_point failed", error);
      });
  }, [directHazardResultId, initial, inspectIsImpact, inspectTimeS, onInspectionCoordinate, onInspectionReport]);

  useEffect(() => {
    if (!inspectMode || !inspectionCoordinate) return;
    const current = lastInspectCoord;
    if (current?.lat === inspectionCoordinate.lat && current.lon === inspectionCoordinate.lon) return;
    runInspection(inspectionCoordinate.lat, inspectionCoordinate.lon);
  }, [inspectMode, inspectionCoordinate, lastInspectCoord, runInspection]);

  // Pick and inspect are mutually exclusive, generation-owned interactions.
  useEffect(() => {
    const controller = interactionControllerRef.current;
    const inspectGeneration = inspectGenerationRef.current;
    const inspectionPresenter = inspectionPresenterRef.current;
    if (!controller || !inspectGeneration || !inspectionPresenter) return;

    let lease: InteractionLease<CesiumInteractionMode> | null = null;
    if (pickMode) {
      inspectGeneration.invalidate();
      inspectionPresenter.clear();
      setLastInspectCoord(null);
      setLastInspectionSummary(null);
      setInspectionResult({ status: "idle" });
      lease = controller.enable({
        kind: "pick",
        onPosition: (lat, lon) => onPick?.(lat, lon),
        onCancel: () => onPickCancel?.(),
      });
    } else if (inspectMode && (initial || directHazardResultId)) {
      lease = controller.enable({
        kind: "inspect",
        onPosition: runInspection,
        onCancel: () => onInspectCancel?.(),
      });
    } else {
      inspectGeneration.invalidate();
      inspectionPresenter.clear();
      controller.disable();
      setLastInspectCoord(null);
      setLastInspectionSummary(null);
      setInspectionResult({ status: "idle" });
    }
    interactionLeaseRef.current = lease;
    return () => {
      if (interactionLeaseRef.current === lease) interactionLeaseRef.current = null;
      inspectGeneration.invalidate();
      inspectionPresenter.clear();
      controller.disable();
    };
  }, [directHazardResultId, pickMode, inspectMode, initial, onPick, onPickCancel, onInspectCancel, runInspection, viewerEpoch]);

  useEffect(() => {
    const controller = tsunamiSourceControllerRef.current;
    if (!controller) return;
    controller.update({
      source: initial,
      reference_capture: referenceCaptureEnabled(),
      reduced_motion:
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
    });
  }, [initial, viewerEpoch]);

  // Static hazard footprints are stable, generation-owned entities. The host
  // mutates existing handles and the controller releases every removed zone.
  useEffect(() => {
    const viewer = viewerRef.current;
    const controller = staticHazardControllerRef.current;
    if (!viewer || !controller) return;
    viewer.camera.cancelFlight();
    const diagnostics = controller.update({
      center: hazardCenter ? { lat_deg: hazardCenter.lat, lon_deg: hazardCenter.lon } : null,
      rings: (hazardRings ?? []).map((ring) => ({
        id: ring.category,
        label: ring.label,
        description: ring.description,
        radius_m: ring.radiusM,
        color_css: ring.color,
      })),
      fallout_polygons: (hazardPolygons ?? []).map((polygon) => ({
        label: polygon.label,
        color_css: polygon.color,
        points: polygon.points.map((point) => ({ lat_deg: point.lat, lon_deg: point.lon })),
      })),
    });

    // Frame the outermost ring: pull the camera back to ~3× its radius.
    // HR-00 applies an exact camera after this renderer product is installed.
    // A still-running flyTo would race that pose and make otherwise identical
    // captures land on different frames.
    const outerRadius = diagnostics.active.outer_radius_m;
    if (!hazardCenter || outerRadius <= 0 || referenceCaptureEnabled()) return;
    viewer.camera.flyToBoundingSphere(
      new Cesium.BoundingSphere(
        Cesium.Cartesian3.fromDegrees(hazardCenter.lon, hazardCenter.lat, 0),
        outerRadius,
      ),
      {
        duration: 1.2,
        offset: new Cesium.HeadingPitchRange(
          0,
          Cesium.Math.toRadians(-55),
          Math.max(outerRadius * 3.2, 20000),
        ),
      },
    );
  }, [hazardRings, hazardCenter, hazardPolygons, viewerEpoch]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const lifecycle = viewerLifecycleRef.current;
    if (!viewer || !lifecycle || !previewCamera || referenceCaptureEnabled()) return;
    const flight = lifecycle.own("rafs", () => {
      if (!viewer.isDestroyed()) viewer.camera.cancelFlight();
    });
    viewer.camera.cancelFlight();
    viewer.camera.flyToBoundingSphere(
      new Cesium.BoundingSphere(
        Cesium.Cartesian3.fromDegrees(previewCamera.targetLon, previewCamera.targetLat, 0),
        Math.max(1_000, previewCamera.rangeM / 3),
      ),
      {
        duration: 0.8,
        offset: new Cesium.HeadingPitchRange(
          Cesium.Math.toRadians(previewCamera.headingDeg),
          Cesium.Math.toRadians(previewCamera.pitchDeg),
          Math.max(20_000, previewCamera.rangeM),
        ),
      },
    );
    return () => flight.release();
  }, [previewCamera, viewerEpoch]);

  useEffect(() => {
    const controller = outcomeFocusControllerRef.current;
    if (!controller) return;
    controller.update(outcomeFocus ?? null, {
      reference_capture: referenceCaptureEnabled(),
      reduced_motion:
        typeof window !== "undefined"
        && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
    });
  }, [outcomeFocus, viewerEpoch]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const controller = directEffectsControllerRef.current;
    if (!viewer || !controller) return;
    controller.update(impactKind ?? null, directRenderFrame);
    if (referenceCaptureEnabled() && directRenderFrame) {
      const committedFrame = `${directRenderFrame.scenario_id}:${directRenderFrame.solver_tick}:${directRenderFrame.sequence.toString()}`;
      return commitReferenceFrame(viewer, document.documentElement, committedFrame);
    }
    viewer.scene.requestRender();
    return () => {
      if (!directRenderFrame) controller.clear();
    };
  }, [directRenderFrame, impactKind, viewerEpoch]);

  useEffect(() => {
    const controller = tsunamiAnalyticalControllerRef.current;
    if (!controller) return;
    controller.update({
      source_center: initial
        ? { lat_deg: initial.center.lat_deg, lon_deg: initial.center.lon_deg }
        : null,
      wavefront,
      isochrones: isochrones ?? [],
      dart_buoys: dartBuoys ?? [],
    });
  }, [initial, wavefront, isochrones, dartBuoys, viewerEpoch]);

  // SWE snapshot → Cesium imagery layer.
  //
  // Cesium 1.104+ deprecated the synchronous `new SingleTileImageryProvider(...)`
  // constructor in favour of an async `fromUrl(...)` factory: with the
  // synchronous form the provider's `ready` state never flips and Cesium
  // silently drops the layer, producing the v0.2.0 "blank globe after Run
  // simulation" bug. We use the async factory and a cancellation guard so
  // rapid scrubbing doesn't leak half-loaded layers.
  useEffect(() => {
    const viewer = viewerRef.current;
    const ownership = sweCoordinatorRef.current;
    if (!viewer || !ownership) return;

    if (!sweSnapshot || (!sweSnapshot.eta_png_b64 && !sweSnapshot.field_tiles?.length)) {
      ownership.coordinator.invalidate("snapshot_cleared");
      return;
    }

    const tiles = resolveSweImageryTiles(sweSnapshot);
    if (tiles.length === 0) {
      ownership.coordinator.invalidate("invalid_snapshot_tiles");
      console.warn("[globe] SWE snapshot has no complete non-wrapping imagery layout");
      return;
    }
    void ownership.coordinator
      .replace(
        ownership.generation,
        async () => ({
          providers: await Promise.all(tiles.map((tile) => {
            const [west, south, east, north] = tile.bbox;
            return Cesium.SingleTileImageryProvider.fromUrl(
              `data:image/png;base64,${tile.pngBase64}`,
              { rectangle: Cesium.Rectangle.fromDegrees(west, south, east, north) },
            );
          })),
          layers: [],
        }),
        (resource) => {
          if (viewerRef.current !== viewer || viewer.isDestroyed()) {
            throw new Error("SWE imagery viewer generation is stale.");
          }
          for (const provider of resource.providers) {
            const layer = viewer.imageryLayers.addImageryProvider(provider);
            layer.alpha = 0.9;
            resource.layers.push(layer);
          }
        },
      )
      .catch((err) => {
        if (ownership.coordinator.diagnostics().pendingResourceCount === 0 && viewerRef.current !== viewer) return;
        console.warn("[globe] SWE snapshot failed to load as imagery layer", err);
      });

    return () => ownership.coordinator.abortPending("snapshot_changed");
  }, [sweSnapshot, viewerEpoch]);

  useEffect(() => {
    runupOverlayControllerRef.current?.update(
      (runupResults ?? []).map((result) => ({
        id: result.id,
        name: result.name,
        lat: result.lat,
        lon: result.lon,
        range_m: result.range_m,
        offshore_amplitude_m: result.offshore_amplitude_m,
        runup_m: result.runup_m,
        arrival_time_s: result.arrival_time_s,
        has_arrived: result.has_arrived,
        inundation_extent_m: result.inundation_extent_m,
        quantitative_confidence: result.quantitative_confidence,
        quantitative_label: result.quantitative_label,
        slope_record_id: result.slope_provenance.record_id,
        depth_record_id: result.depth_provenance.record_id,
      })),
    );
  }, [runupResults, viewerEpoch]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || fireballs.length === 0) return;
    const points = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
    for (const event of fireballs.slice(0, 80)) {
      points.add({
        id: `cneos-fireball:${event.id}`,
        position: Cesium.Cartesian3.fromDegrees(event.lon, event.lat, (event.altitudeKm ?? 0) * 1_000),
        pixelSize: Math.min(18, 6 + Math.log10(Math.max(event.impactEnergyKt, 0) + 1) * 3),
        color: Cesium.Color.fromCssColorString(event.source === "NASA/JPL CNEOS" ? "#f9e2af" : "#fab387"),
        outlineColor: Cesium.Color.fromCssColorString("#11111b"),
        outlineWidth: 1.5,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
    }
    viewer.scene.requestRender();
    return () => {
      if (!viewer.isDestroyed()) {
        viewer.scene.primitives.remove(points);
        viewer.scene.requestRender();
      }
    };
  }, [fireballs, viewerEpoch]);

  return (
    <>
      <div
        className="app__globe-mount"
        ref={containerRef}
        role="region"
        aria-label={`${accessibleSceneLabel} analytical globe`}
        aria-describedby={sceneSummaryId}
        data-imagery-status={imageryStatus}
        data-imagery-style={activeImageryStyle ?? "none"}
        data-swe-field-tiles={sweSnapshot ? resolveSweImageryTiles(sweSnapshot).length : 0}
      />
      <p id={sceneSummaryId} className="sr-only" data-globe-scene-summary>
        {accessibilitySummary}
      </p>
      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-globe-scene-announcement
      >
        {announcedAccessibilitySummary}
      </p>
      {pickMode && (
        <div className="app__globe-pickbanner">
          <div className="app__globe-pickbanner-row">
            <span>Click anywhere on the globe to set scenario location.</span>
            <button className="app__globe-banner-cancel" onClick={onPickCancel} type="button">
              Cancel
            </button>
          </div>
          <CoordEntryForm
            onSubmit={(lat, lon) => onPick?.(lat, lon)}
            label="Enter coordinates"
          />
        </div>
      )}
      {inspectMode && (
        <div className="app__globe-pickbanner">
          <div className="app__globe-pickbanner-row">
            <span>{domain === "tsunami"
              ? "Click anywhere on the globe to read amplitude, arrival, and runup."
              : "Click anywhere to inspect modeled thresholds, arrival, assumptions, and unknowns."}</span>
            {lastInspectCoord && onAddGauge && (
              <button
                className="app__globe-banner-action"
                onClick={() => {
                  onAddGauge(lastInspectCoord.lat, lastInspectCoord.lon);
                }}
                type="button"
              >
                Add gauge at {lastInspectCoord.lat.toFixed(2)}°, {lastInspectCoord.lon.toFixed(2)}°
              </button>
            )}
            <button className="app__globe-banner-cancel" onClick={onInspectCancel} type="button">
              Cancel
            </button>
          </div>
          <CoordEntryForm
            onSubmit={runInspection}
            label="Enter coordinates"
          />
          {inspectionResult.status === "loading" && (
            <div className="app__globe-status" data-status="connecting" role="status" aria-live="polite">
              {inspectionResult.previous ? "Refreshing inspection; the last point remains visible." : "Inspecting selected point…"}
            </div>
          )}
          {(inspectionResult.status === "error" || inspectionResult.status === "stale") && (
            <div className="app__globe-status" data-status="degraded" role="alert">
              <span>{inspectionResult.status === "stale" ? "Showing the last valid inspection: " : "Inspection failed: "}{inspectionResult.error}</span>
              {lastInspectCoord && <button type="button" onClick={() => runInspection(lastInspectCoord.lat, lastInspectCoord.lon)}>Retry inspection</button>}
            </div>
          )}
        </div>
      )}
      {imageryStatus === "connecting" && (
        <div className="app__globe-status" data-status="connecting" role="status" aria-live="polite">
          {imageryMessage}
        </div>
      )}
      {imageryStatus === "degraded" && (
        <div className="app__globe-status" data-status="degraded" role="status" aria-live="polite">
          <span>{imageryMessage}</span>
          {networkOnline && resolvedStyle !== OFFLINE_STYLE && (
            <button type="button" onClick={() => setImageryRetryNonce((nonce) => nonce + 1)}>Retry provider</button>
          )}
        </div>
      )}
      {imageryStatus === "fallback" && (
        <div className="app__globe-status" data-status="fallback" role="status" aria-live="polite">
          <span>{imageryMessage}</span>
          {networkOnline && resolvedStyle !== OFFLINE_STYLE && (
            <button type="button" onClick={() => setImageryRetryNonce((nonce) => nonce + 1)}>Retry {findStyle(resolvedStyle).label}</button>
          )}
        </div>
      )}
      {imageryStatus === "failed" && (
        <div className="app__globe-status" data-status="failed" role="alert">
          <span>{imageryMessage}</span>
          <button type="button" onClick={() => setImageryRetryNonce((nonce) => nonce + 1)}>Retry imagery</button>
        </div>
      )}
      {rendererError && (
        <div className="app__globe-status" data-status="failed" role="alert">
          <span>{rendererError}</span>
          <button
            type="button"
            onClick={() => {
              setRendererError(null);
              setRendererResetNonce((nonce) => nonce + 1);
            }}
          >
            Reset renderer
          </button>
        </div>
      )}
      {!rendererError && qualityDiagnostics && qualityDiagnostics.activeTier !== qualityDiagnostics.requestedTier && (
        <div className="app__globe-status" data-status="degraded" role="status" aria-live="polite">
          Renderer protected at {qualityDiagnostics.activeTier} · target remains {qualityDiagnostics.targetFps} FPS. Scientific fields unchanged.
        </div>
      )}
      {!initial && !hazardCenter && ["ready", "degraded", "fallback"].includes(imageryStatus) && (
        <div className="app__globe-hint" role="status" aria-live="polite">
          <span className="app__globe-hint-kicker">{previewLabel ? "Scenario preview" : domain === "tsunami" ? "Ready for a source" : "Ready for a target"}</span>
          <strong>{previewLabel ?? (domain === "tsunami" ? "Select a preset or simulate a custom source." : "Choose an effects origin.")}</strong>
          <span>
            {previewLabel
              ? "Review the framing, then choose Run & Watch to start the model."
              : domain === "tsunami"
              ? "Wavefronts, runup bars, exports, and inspection unlock after a scenario is active."
              : `Pick a location to calculate ${domain === "nuclear" ? "blast, thermal, radiation, and fallout" : "entry, crater, blast, and thermal"} effects.`}
          </span>
        </div>
      )}
    </>
  );
}
