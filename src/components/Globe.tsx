import { useCallback, useEffect, useId, useRef, useState } from "react";
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
  Gauge,
  GridSnapshot,
  InitialDisplacement,
  PropagationSnapshot,
} from "../types/scenario";
import type { EffectRing, GeoPoint } from "../hazards/types";
import type { RendererNeutralFrameView } from "../types/render-protocol";
import type { FireballEvent } from "../types/jpl";
import type { Ww3ExchangePlan } from "../lib/ww3";
import type { MirvPreview } from "../lib/mirv";
import { AsyncGenerationOwner } from "../render/cesium/generation";
import { DirectEffectsController } from "../render/cesium/direct-effects";
import { CesiumDirectEffectsHost } from "../render/cesium/cesium-direct-effects-host";
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
  type ImageryStatusMessage,
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
import { useStrategicGlobeOverlays } from "./globe-strategic-overlays";
import {
  localizedGlobeStyleLabel,
  useGlobeAccessibilitySummary,
} from "./globe-accessibility";
import { useGlobeControllerSync } from "./globe-controller-sync";
import { OSM_ATTRIBUTION_URL, type HumanitarianFacility } from "../lib/osm-facilities";
import { useI18n } from "../lib/i18n";
import type { MessageKey } from "../lib/i18n-core";
import { defaultLayerState, type LayerState } from "../lib/layer-controller";
import { useUnits } from "../hooks/useUnits";
import { formatEmbeddedLengthValues, formatLength, formatReadoutValue, quantityText, type UnitSystem } from "../lib/units";

type Props = {
  domain?: "tsunami" | "asteroid" | "nuclear";
  initial: InitialDisplacement | null;
  wavefront: PropagationSnapshot | null;
  /** Live SWE solver snapshot (PNG + bbox) to paint on the globe. */
  sweSnapshot?: GridSnapshot | null;
  /** Coastal runup samples to render as 3D bars at coastline points. */
  runupResults?: RunupAtPointResult[];
  /** User-created SWE gauges rendered as a single primitive-backed point layer. */
  gauges?: Gauge[];
  /** DART buoy pins for the active historical preset. */
  dartBuoys?: DartBuoy[];
  /** Explicitly opted-in OpenStreetMap facilities inside modeled runup discs. */
  humanitarianFacilities?: readonly HumanitarianFacility[];
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
  /** Deterministic WW3 exchange plan rendered as Cesium-native target points and 3D missile arcs. */
  ww3Plan?: Ww3ExchangePlan | null;
  /** Preserved NukeMap MIRV dispersal pattern rendered as aim points and a spread boundary. */
  mirvPreview?: MirvPreview | null;
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
  /** Scenario-scoped user layer settings. Omitted compare panes use domain defaults. */
  layerState?: LayerState;
};

type SweImageryResource = {
  providers: Cesium.SingleTileImageryProvider[];
  layers: Cesium.ImageryLayer[];
};

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;
type FormatNumber = (value: number, options?: Intl.NumberFormatOptions) => string;

function localizedCanonicalStyleLabel(label: string, t: Translate): string {
  const style = [
    "natural-earth-2",
    "osm",
    "esri-world-imagery",
    "cesium-world-imagery",
    "cesium-bathymetry",
  ].find((id) => findStyle(id).label === label) as GlobeStyleId | undefined;
  return style ? localizedGlobeStyleLabel(style, t) : label;
}

function localizedImageryMessage(
  fallback: string,
  detail: ImageryStatusMessage,
  t: Translate,
): string {
  const style = detail.styleLabel
    ? localizedCanonicalStyleLabel(detail.styleLabel, t)
    : "";
  switch (detail.kind) {
    case "connecting": return style
      ? t("globe.imagery.connecting", { style })
      : t("globe.imagery.connectingGeneric");
    case "fallback-loading": return t("globe.imagery.fallbackLoading", { style });
    case "fallback-active": return t("globe.imagery.fallbackActive", { style });
    case "all-failed": return t("globe.imagery.allFailed");
    case "offline-fallback": return t("globe.imagery.offlineFallback", { style });
    case "missing-token": return t("globe.imagery.missingToken", { style });
    case "ready": return t("globe.imagery.ready", { style });
    case "bundled-failed": return t("globe.imagery.bundledFailed");
    case "tiles-degraded": return t("globe.imagery.tilesDegraded", { style });
    default: return fallback;
  }
}

function localizedProbeText(value: string, t: Translate): string {
  switch (value) {
    case "Wave arrived by scenario time": return t("globe.probe.waveArrived");
    case "Wave in transit": return t("globe.probe.waveTransit");
    case "No displayed threshold reached — not a safety finding": return t("globe.probe.noThreshold");
    case "No numeric displayed threshold": return t("globe.probe.noNumericThreshold");
    case "analytical far-field model": return t("globe.probe.defaultModel");
    case "Nominal 1° slope / 50 m depth": return t("globe.probe.defaultAssumption");
    case "Local bathymetry and shoreline effects are unresolved": return t("globe.probe.defaultUnknown");
    case "illustrative": return t("globe.probe.illustrative");
    case "unknown": return t("globe.probe.unknownValue");
    default: {
      const thresholdMatch = /^(\d+) displayed thresholds? reached$/.exec(value);
      if (!thresholdMatch) return value;
      const count = Number(thresholdMatch[1]);
      return count === 1
        ? t("globe.probe.thresholdsOne")
        : t("globe.probe.thresholdsMany", { count });
    }
  }
}

function localizedMetricLabel(label: string, t: Translate): string {
  const key = ({
    "Threshold lower bounds": "globe.probe.metric.thresholds",
    "Earliest modeled arrival": "globe.probe.metric.earliest",
    Arrival: "globe.probe.metric.arrival",
    "Offshore amplitude": "globe.probe.metric.offshore",
    Runup: "globe.probe.metric.runup",
    Inundation: "globe.probe.metric.inundation",
  } as const)[label as keyof {
    "Threshold lower bounds": string;
    "Earliest modeled arrival": string;
    Arrival: string;
    "Offshore amplitude": string;
    Runup: string;
    Inundation: string;
  }];
  return key ? t(key as MessageKey) : label;
}

function formatLocalizedPointProbeReport(
  report: PointProbeReport,
  t: Translate,
  formatNumber: FormatNumber,
  unitSystem: UnitSystem,
): string {
  const fixed = (value: number, digits: number) => Number.isFinite(value)
    ? formatNumber(value, { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : "—";
  return [
    `${fixed(report.lat, 2)}°, ${fixed(report.lon, 2)}°`,
    t("globe.probe.rangeStatus", {
      range: quantityText(formatLength(report.rangeM, formatNumber, unitSystem)),
      status: localizedProbeText(report.status, t),
    }),
    ...report.metrics.map((metric) =>
      `${localizedMetricLabel(metric.label, t)}: ${formatReadoutValue(localizedProbeText(metric.value, t), formatNumber, unitSystem)}`),
    t("globe.probe.model", {
      model: localizedProbeText(report.governingModel, t),
      confidence: localizedProbeText(report.confidence, t),
    }),
    t("globe.probe.basis", { value: report.citations[0] ?? t("globe.probe.noCitation") }),
    t("globe.probe.assumption", {
      value: formatEmbeddedLengthValues(localizedProbeText(report.assumptions[1] ?? report.assumptions[0] ?? t("globe.probe.notSupplied"), t), formatNumber, unitSystem),
    }),
    t("globe.probe.unknown", {
      value: localizedProbeText(report.unknowns[0] ?? t("globe.probe.notSupplied"), t),
    }),
  ].join("\n");
}

function CoordEntryForm({
  onSubmit,
  label,
}: {
  onSubmit: (lat: number, lon: number) => void;
  label: string;
}) {
  const { t } = useI18n();
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const validationId = useId();
  const hasBoth = lat.trim().length > 0 && lon.trim().length > 0;
  const la = hasBoth ? Number(lat) : Number.NaN;
  const lo = hasBoth ? Number(lon) : Number.NaN;
  const coordinatesValid =
    Number.isFinite(la) && Number.isFinite(lo) && la >= -90 && la <= 90 && lo >= -180 && lo <= 180;
  const validationMessage = !hasBoth
    ? t("globe.coord.enterBoth")
    : coordinatesValid
      ? null
      : t("globe.coord.bounds");

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
        placeholder={t("globe.coord.latPlaceholder")}
        aria-label={t("globe.coord.latitude")}
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
        placeholder={t("globe.coord.lonPlaceholder")}
        aria-label={t("globe.coord.longitude")}
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
      <button type="submit" className="coord-entry__go" disabled={!coordinatesValid}>{t("globe.coord.go")}</button>
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
  gauges,
  dartBuoys,
  humanitarianFacilities = [],
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
  ww3Plan,
  mirvPreview,
  impactKind,
  directRenderFrame,
  previewCamera,
  previewLabel,
  outcomeFocus,
  onOutcomeFocusTime,
  onCameraTelemetry,
  accessibleSceneLabel,
  simulationTimeS = 0,
  accessibleCameraTelemetry,
  layerState,
}: Props) {
  const { t, formatNumber } = useI18n();
  const unitSystem = useUnits();
  const sceneLabel = accessibleSceneLabel ?? t("globe.unconfiguredScene");
  const sceneSummaryId = useId();
  const layers = layerState ?? defaultLayerState(domain);
  const sourceLayer = layers.source;
  const wavefrontLayer = layers.wavefront;
  const sweLayer = layers["swe-field"];
  const isochroneLayer = layers["arrival-isochrones"];
  const runupLayer = layers["coastal-runup"];
  const dartLayer = layers["dart-observations"];
  const humanitarianLayer = layers["humanitarian-facilities"];
  const hazardRingLayer = layers["hazard-rings"];
  const falloutLayer = layers["fallout-plume"];
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
      Cesium.GeoJsonPrimitive,
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
  const [imageryMessageState, setImageryMessageState] = useState<{
    fallback: string;
    detail: ImageryStatusMessage;
  }>({
    fallback: "Connecting to globe imagery…",
    detail: { kind: "connecting" },
  });
  const imageryMessage = localizedImageryMessage(
    imageryMessageState.fallback,
    imageryMessageState.detail,
    t,
  );
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
  const rendererErrorMessage = rendererError === "Graphics context was lost. Simulation state is safe; reset the renderer to continue."
    ? t("globe.renderer.contextLost")
    : rendererError?.startsWith("Graphics context restored, but renderer reset failed: ")
      ? t("globe.renderer.resetFailed", {
          error: rendererError.slice("Graphics context restored, but renderer reset failed: ".length),
        })
      : rendererError;
  const {
    summary: accessibilitySummary,
    announcedSummary: announcedAccessibilitySummary,
  } = useGlobeAccessibilitySummary({
    resolvedStyle,
    hasInitial: sourceLayer.visible && Boolean(initial),
    hasWavefront: wavefrontLayer.visible && Boolean(wavefront),
    hasSweSnapshot: sweLayer.visible && Boolean(sweSnapshot),
    isochroneCount: isochroneLayer.visible ? isochrones?.length ?? 0 : 0,
    runupResultCount: runupLayer.visible ? runupResults?.length ?? 0 : 0,
    gaugeCount: gauges?.length ?? 0,
    dartBuoyCount: dartLayer.visible ? dartBuoys?.length ?? 0 : 0,
    hasHazardCenter: sourceLayer.visible && Boolean(hazardCenter),
    hazardRingCount: hazardRingLayer.visible ? hazardRings?.length ?? 0 : 0,
    hazardPolygonCount: falloutLayer.visible ? hazardPolygons?.length ?? 0 : 0,
    hasDirectRenderFrame: Boolean(directRenderFrame),
    hasWw3Plan: Boolean(ww3Plan),
    mirvPointCount: mirvPreview?.points.length ?? 0,
    camera: accessibleCameraTelemetry,
    sceneLabel,
    simulationTimeS,
    rendererError: rendererErrorMessage,
    imageryStatus,
    imageryMessage,
    lastInspectionSummary,
    inspectMode: Boolean(inspectMode),
    pickMode: Boolean(pickMode),
  });

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
      onStatus: (status, message, detail) => {
        setImageryStatus(status);
        setImageryMessageState({ fallback: message, detail });
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
    const formattedLat = formatNumber(lat, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formattedLon = formatNumber(lon, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    setLastInspectionSummary(t("globe.inspection.inProgress", {
      lat: formattedLat,
      lon: formattedLon,
    }));
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
          : demoInspectAtPoint(request as ReturnType<typeof buildInspectionRequest>))
        .then((result) => tsunamiProbeReport(lat, lon, result));
    const token = inspectGeneration.setContext(viewer, "inspect", request);

    void inspectGeneration
      .guard(token, inspectPromise, (result) => {
        if (
          interactionControllerRef.current !== interactionController ||
          inspectionPresenterRef.current !== inspectionPresenter
        ) return;
        const text = formatLocalizedPointProbeReport(result, t, formatNumber, unitSystem);
        onInspectionReport?.(result);
        inspectionPresenter.present({
          lat,
          lon,
          text,
        });
        setInspectionResult({ status: "ready", value: { lat, lon, text } });
        setLastInspectionSummary(t("globe.inspection.complete", { report: text }));
      })
      .catch((error) => {
        setInspectionResult((current) => rejectAsyncResult(current, error));
        setLastInspectionSummary(t("globe.inspection.failedAt", {
          lat: formattedLat,
          lon: formattedLon,
        }));
        console.warn("[globe] inspect_at_point failed", error);
      });
  }, [directHazardResultId, formatNumber, initial, inspectIsImpact, inspectTimeS, onInspectionCoordinate, onInspectionReport, t, unitSystem]);

  useEffect(() => {
    // A familiar-place probe must rerun when its governing source/result
    // changes, even though the geographic coordinate itself is unchanged.
    setLastInspectCoord(null);
  }, [directHazardResultId, initial]);

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

  useGlobeControllerSync(
    {
      viewerRef,
      viewerLifecycleRef,
      tsunamiSourceControllerRef,
      staticHazardControllerRef,
      outcomeFocusControllerRef,
      directEffectsControllerRef,
      tsunamiAnalyticalControllerRef,
      runupOverlayControllerRef,
    },
    {
      viewerEpoch,
      initial: sourceLayer.visible ? initial : null,
      hazardRings: hazardRingLayer.visible ? hazardRings : null,
      hazardCenter,
      hazardPolygons: falloutLayer.visible ? hazardPolygons : null,
      previewCamera,
      outcomeFocus,
      impactKind,
      directRenderFrame,
      wavefront: wavefrontLayer.visible ? wavefront : null,
      isochrones: isochroneLayer.visible ? isochrones : null,
      dartBuoys: dartLayer.visible ? dartBuoys : [],
      runupResults: runupLayer.visible ? runupResults : [],
      gauges,
      showDirectSource: domain !== "tsunami" && sourceLayer.visible,
      layerOpacity: {
        source: sourceLayer.opacity,
        wavefront: wavefrontLayer.opacity,
        isochrones: isochroneLayer.opacity,
        runup: runupLayer.opacity,
        dart: dartLayer.opacity,
        hazardRings: hazardRingLayer.opacity,
        fallout: falloutLayer.opacity,
      },
      layerOrder: {
        source: sourceLayer.order,
        wavefront: wavefrontLayer.order,
        isochrones: isochroneLayer.order,
        dart: dartLayer.order,
        hazardRings: hazardRingLayer.order,
        fallout: falloutLayer.order,
      },
      unitSystem,
      formatNumber,
    },
  );

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

    if (!sweLayer.visible || !sweSnapshot || (!sweSnapshot.eta_png_b64 && !sweSnapshot.field_tiles?.length)) {
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
            layer.alpha = sweLayer.opacity;
            resource.layers.push(layer);
          }
        },
      )
      .catch((err) => {
        if (ownership.coordinator.diagnostics().pendingResourceCount === 0 && viewerRef.current !== viewer) return;
        console.warn("[globe] SWE snapshot failed to load as imagery layer", err);
      });

    return () => ownership.coordinator.abortPending("snapshot_changed");
  }, [sweLayer.opacity, sweLayer.visible, sweSnapshot, viewerEpoch]);

  useStrategicGlobeOverlays({
    viewerRef,
    viewerEpoch,
    fireballs,
    ww3Plan,
    mirvPreview,
    humanitarianFacilities: humanitarianLayer.visible ? humanitarianFacilities : [],
    humanitarianOpacity: humanitarianLayer.opacity,
    humanitarianOrder: humanitarianLayer.order,
  });

  return (
    <>
      <div
        className="app__globe-mount"
        ref={containerRef}
        role="region"
        aria-label={t("globe.analyticalGlobe", { scene: sceneLabel })}
        aria-describedby={sceneSummaryId}
        data-imagery-status={imageryStatus}
        data-imagery-style={activeImageryStyle ?? "none"}
        data-swe-field-tiles={sweLayer.visible && sweSnapshot ? resolveSweImageryTiles(sweSnapshot).length : 0}
        data-ww3-plan={ww3Plan?.id ?? "none"}
        data-ww3-strikes={ww3Plan?.strikes.length ?? 0}
        data-mirv-preview={mirvPreview?.id ?? "none"}
        data-mirv-warheads={mirvPreview?.points.length ?? 0}
        data-humanitarian-facilities={humanitarianLayer.visible ? humanitarianFacilities.length : 0}
      />
      {humanitarianLayer.visible && humanitarianFacilities.length > 0 && (
        <a
          className="app__globe-osm-attribution"
          href={OSM_ATTRIBUTION_URL}
          target="_blank"
          rel="noreferrer"
        >
          {t("globe.facilityAttribution")}
        </a>
      )}
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
            <span>{t("globe.pickInstruction")}</span>
            <button className="app__globe-banner-cancel" onClick={onPickCancel} type="button">
              {t("globe.cancel")}
            </button>
          </div>
          <CoordEntryForm
            onSubmit={(lat, lon) => onPick?.(lat, lon)}
            label={t("globe.enterCoordinates")}
          />
        </div>
      )}
      {inspectMode && (
        <div className="app__globe-pickbanner">
          <div className="app__globe-pickbanner-row">
            <span>{domain === "tsunami"
              ? t("globe.inspectTsunami")
              : t("globe.inspectDirect")}</span>
            {lastInspectCoord && onAddGauge && (
              <button
                className="app__globe-banner-action"
                onClick={() => {
                  onAddGauge(lastInspectCoord.lat, lastInspectCoord.lon);
                }}
                type="button"
              >
                {t("globe.addGauge", {
                  lat: formatNumber(lastInspectCoord.lat, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                  lon: formatNumber(lastInspectCoord.lon, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                })}
              </button>
            )}
            <button className="app__globe-banner-cancel" onClick={onInspectCancel} type="button">
              {t("globe.cancel")}
            </button>
          </div>
          <CoordEntryForm
            onSubmit={runInspection}
            label={t("globe.enterCoordinates")}
          />
          {inspectionResult.status === "loading" && (
            <div className="app__globe-status" data-status="connecting" role="status" aria-live="polite">
              {inspectionResult.previous ? t("globe.inspection.refreshing") : t("globe.inspection.inspecting")}
            </div>
          )}
          {(inspectionResult.status === "error" || inspectionResult.status === "stale") && (
            <div className="app__globe-status" data-status="degraded" role="alert">
              <span>{inspectionResult.status === "stale" ? t("globe.inspection.showingLast") : t("globe.inspection.failed")}{inspectionResult.error}</span>
              {lastInspectCoord && <button type="button" onClick={() => runInspection(lastInspectCoord.lat, lastInspectCoord.lon)}>{t("globe.inspection.retry")}</button>}
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
            <button type="button" onClick={() => setImageryRetryNonce((nonce) => nonce + 1)}>{t("globe.retryProvider")}</button>
          )}
        </div>
      )}
      {imageryStatus === "fallback" && (
        <div className="app__globe-status" data-status="fallback" role="status" aria-live="polite">
          <span>{imageryMessage}</span>
          {networkOnline && resolvedStyle !== OFFLINE_STYLE && (
            <button type="button" onClick={() => setImageryRetryNonce((nonce) => nonce + 1)}>{t("globe.retryStyle", { style: localizedGlobeStyleLabel(resolvedStyle, t) })}</button>
          )}
        </div>
      )}
      {imageryStatus === "failed" && (
        <div className="app__globe-status" data-status="failed" role="alert">
          <span>{imageryMessage}</span>
          <button type="button" onClick={() => setImageryRetryNonce((nonce) => nonce + 1)}>{t("globe.retryImagery")}</button>
        </div>
      )}
      {rendererError && (
        <div className="app__globe-status" data-status="failed" role="alert">
          <span>{rendererErrorMessage}</span>
          <button
            type="button"
            onClick={() => {
              setRendererError(null);
              setRendererResetNonce((nonce) => nonce + 1);
            }}
          >
            {t("globe.renderer.reset")}
          </button>
        </div>
      )}
      {!rendererError && qualityDiagnostics && qualityDiagnostics.activeTier !== qualityDiagnostics.requestedTier && (
        <div className="app__globe-status" data-status="degraded" role="status" aria-live="polite">
          {t("globe.renderer.qualityProtected", {
            tier: t(`globe.quality.${qualityDiagnostics.activeTier}` as MessageKey),
            fps: formatNumber(qualityDiagnostics.targetFps),
          })}
        </div>
      )}
      {!initial && !hazardCenter && ["ready", "degraded", "fallback"].includes(imageryStatus) && (
        <div className="app__globe-hint" role="status" aria-live="polite">
          <span className="app__globe-hint-kicker">{previewLabel ? t("globe.hint.preview") : domain === "tsunami" ? t("globe.hint.source") : t("globe.hint.target")}</span>
          <strong>{previewLabel ?? (domain === "tsunami" ? t("globe.hint.selectSource") : t("globe.hint.chooseOrigin"))}</strong>
          <span>
            {previewLabel
              ? t("globe.hint.previewBody")
              : domain === "tsunami"
              ? t("globe.hint.tsunamiBody")
              : t(domain === "nuclear" ? "globe.hint.nuclearBody" : "globe.hint.asteroidBody")}
          </span>
        </div>
      )}
    </>
  );
}
