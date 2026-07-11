import { useEffect, useRef, useState } from "react";
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
  getActiveEarthSession,
  publishEarthSession,
  type EarthAssetHealth,
  type EarthSessionSnapshot,
} from "../lib/earth-assets";
import {
  REFERENCE_CAPTURE_EVENT,
  referenceCaptureEnabled,
  type ReferenceCaptureView,
} from "../lib/reference-capture";
import { applyRendererQualityProfile } from "../rendering/quality-profiles";
import { demoInspectAtPoint } from "../lib/demo";
import { api, isTauri, type RunupAtPointResult } from "../lib/tauri";
import type {
  DartBuoy,
  GridSnapshot,
  InitialDisplacement,
  PropagationSnapshot,
} from "../types/scenario";
import type { EffectRing, GeoPoint } from "../hazards/types";

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
  /** Bumping this triggers the impact/detonation animation from the hazard
   *  center: a shockwave for nuclear, or a full asteroid entry sequence
   *  (bolide from space → flash → shockwave → ocean tsunami) for asteroid. */
  detonateNonce?: number;
  /** Which animation the nonce should play. */
  impactKind?: "asteroid" | "nuclear" | null;
  /** Asteroid entry angle from horizontal (deg) — steepness of the descent. */
  impactAngleDeg?: number;
  /** Ocean impact → play the water splash + tsunami wave. */
  impactIsWater?: boolean;
  /** Lightweight camera telemetry for the desktop viewport HUD. */
  onCameraTelemetry?: (telemetry: { lat: number; lon: number; altitudeM: number; headingDeg: number }) => void;
};

const EARTH_RADIUS_M = 6_371_000;
const INUNDATION_SEGMENTS = 40;
type ImageryHealth = "connecting" | "ready" | "degraded" | "fallback" | "failed";
const TILE_FAILURES_BEFORE_FALLBACK = 2;

function themeColor(token: string, fallback: string): Cesium.Color {
  if (typeof document === "undefined") return Cesium.Color.fromCssColorString(fallback);
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return Cesium.Color.fromCssColorString(value || fallback);
}

function circlePositions(lonDeg: number, latDeg: number, radiusM: number): Float64Array {
  const out = new Float64Array(INUNDATION_SEGMENTS * 3);
  const lat1 = Cesium.Math.toRadians(latDeg);
  const lon1 = Cesium.Math.toRadians(lonDeg);
  const angular = radiusM / EARTH_RADIUS_M;

  for (let i = 0; i < INUNDATION_SEGMENTS; i += 1) {
    const bearing = (i / INUNDATION_SEGMENTS) * Cesium.Math.TWO_PI;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angular) +
        Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
    );
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
        Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
      );
    const cart = Cesium.Cartesian3.fromRadians(lon2, lat2, 0);
    const offset = i * 3;
    out[offset] = cart.x;
    out[offset + 1] = cart.y;
    out[offset + 2] = cart.z;
  }

  return out;
}

function circleTriangles(): Uint32Array {
  const triangles = new Uint32Array((INUNDATION_SEGMENTS - 2) * 3);
  for (let i = 1; i < INUNDATION_SEGMENTS - 1; i += 1) {
    const offset = (i - 1) * 3;
    triangles[offset] = 0;
    triangles[offset + 1] = i;
    triangles[offset + 2] = i + 1;
  }
  return triangles;
}

function CoordEntryForm({
  onSubmit,
  label,
}: {
  onSubmit: (lat: number, lon: number) => void;
  label: string;
}) {
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const la = Number(lat);
    const lo = Number(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return;
    if (la < -90 || la > 90 || lo < -180 || lo > 180) return;
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
        onChange={(e) => setLon(e.target.value)}
        className="coord-entry__input"
      />
      <button type="submit" className="coord-entry__go">Go</button>
    </form>
  );
}

const PICK_CURSOR_STYLE = "crosshair";

function destroyScreenSpaceHandler(handler: Cesium.ScreenSpaceEventHandler | null) {
  if (!handler || handler.isDestroyed()) return;
  handler.destroy();
}

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
  onInspectCancel,
  onAddGauge,
  primary = true,
  isochrones,
  hazardRings,
  hazardCenter,
  hazardPolygons,
  detonateNonce,
  impactKind,
  impactAngleDeg,
  impactIsWater,
  onCameraTelemetry,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const sourceEntityRef = useRef<Cesium.Entity | null>(null);
  const [lastInspectCoord, setLastInspectCoord] = useState<{ lat: number; lon: number } | null>(null);
  const wavefrontEntitiesRef = useRef<Cesium.Entity[]>([]);
  const runupPrimitiveRef = useRef<Cesium.BufferPolylineCollection | null>(null);
  const inundationPrimitiveRef = useRef<Cesium.BufferPolygonCollection | null>(null);
  const runupLabelsRef = useRef<Map<string, Cesium.Entity>>(new Map());
  const dartEntitiesRef = useRef<Map<number, Cesium.Entity>>(new Map());
  const sweLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const isochroneEntitiesRef = useRef<Cesium.Entity[]>([]);
  const hazardRingEntitiesRef = useRef<Cesium.Entity[]>([]);
  const falloutEntitiesRef = useRef<Cesium.Entity[]>([]);
  const shockEntityRef = useRef<Cesium.Entity | null>(null);
  const shockRafRef = useRef<number | null>(null);
  const impactEntitiesRef = useRef<Cesium.Entity[]>([]);
  const impactRafRef = useRef<number | null>(null);
  const imageryLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const imageryRequestIdRef = useRef(0);
  const earthSessionRef = useRef<{
    requestedStyle: GlobeStyleId;
    resolvedStyle: GlobeStyleId;
    fallbackReason: EarthSessionSnapshot["fallbackReason"];
    health: EarthAssetHealth;
    dynamicAttributions: string[];
  } | null>(null);
  const pickHandlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null);
  const inspectHandlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null);
  const inspectEntityRef = useRef<Cesium.Entity | null>(null);
  const [imageryStatus, setImageryStatus] = useState<ImageryHealth>("connecting");
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

    viewer.scene.globe.enableLighting = true;
    viewer.scene.globe.dynamicAtmosphereLighting = true;
    viewer.scene.globe.dynamicAtmosphereLightingFromSun = true;
    viewer.scene.highDynamicRange = true;
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
    viewer.scene.fog.enabled = true;

    viewerRef.current = viewer;
    // Signal dependent effects that a (new) viewer is live so they re-bind.
    setViewerEpoch((n) => n + 1);

    return () => {
      destroyScreenSpaceHandler(pickHandlerRef.current);
      pickHandlerRef.current = null;
      destroyScreenSpaceHandler(inspectHandlerRef.current);
      inspectHandlerRef.current = null;
      inspectEntityRef.current = null;
      viewer.destroy();
      viewerRef.current = null;
      sourceEntityRef.current = null;
      wavefrontEntitiesRef.current = [];
      runupPrimitiveRef.current = null;
      inundationPrimitiveRef.current = null;
      runupLabelsRef.current = new Map();
      dartEntitiesRef.current = new Map();
      sweLayerRef.current = null;
    };
  }, [primary]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !onCameraTelemetry) return;

    const updateTelemetry = () => {
      const position = viewer.camera.positionCartographic;
      onCameraTelemetry({
        lat: Cesium.Math.toDegrees(position.latitude),
        lon: Cesium.Math.toDegrees(position.longitude),
        altitudeM: Math.max(0, position.height),
        headingDeg: Cesium.Math.toDegrees(Cesium.Math.zeroToTwoPi(viewer.camera.heading)),
      });
    };

    viewer.camera.percentageChanged = 0.01;
    viewer.camera.changed.addEventListener(updateTelemetry);
    updateTelemetry();
    return () => {
      viewer.camera.changed.removeEventListener(updateTelemetry);
    };
  }, [onCameraTelemetry, viewerEpoch]);

  // Deterministic, query-gated bridge for the visual reference suite. It owns
  // only clock/camera state and reports the resolved Earth session; scientific
  // scenario values still enter through the normal application workflow.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewerEpoch === 0 || !primary || !referenceCaptureEnabled()) return;
    const applyReferenceView = (event: Event) => {
      const view = (event as CustomEvent<ReferenceCaptureView>).detail;
      if (!view?.sceneId || !Number.isFinite(view.seed)) return;
      document.documentElement.dataset.referenceEventReceived = view.sceneId;
      const currentTime = Cesium.JulianDate.fromIso8601(view.utc);
      viewer.clock.currentTime = currentTime;
      viewer.clock.shouldAnimate = false;
      viewer.scene.requestRenderMode = true;
      viewer.scene.maximumRenderTimeChange = Number.POSITIVE_INFINITY;
      const quality = applyRendererQualityProfile(viewer, view.qualityTier, view.exposure);
      if (viewer.camera.frustum instanceof Cesium.PerspectiveFrustum) {
        viewer.camera.frustum.fov = Cesium.Math.toRadians(view.camera.verticalFovDeg);
      }
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(
          view.camera.lon,
          view.camera.lat,
          view.camera.altitudeM,
        ),
        orientation: {
          heading: Cesium.Math.toRadians(view.camera.headingDeg),
          pitch: Cesium.Math.toRadians(view.camera.pitchDeg),
          roll: Cesium.Math.toRadians(view.camera.rollDeg),
        },
      });
      viewer.resize();
      viewer.scene.requestRender();
      const position = viewer.camera.positionCartographic;
      const sun = Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(
        currentTime,
        new Cesium.Cartesian3(),
      );
      window.__CATACLYSM_REFERENCE_CAPTURE__ = {
        ...view,
        ready: true,
        renderer: "CesiumJS 1.143.0",
        earthSession: getActiveEarthSession(),
        sunPositionEciM: { x: sun.x, y: sun.y, z: sun.z },
        quality,
        actualCamera: {
          lat: Cesium.Math.toDegrees(position.latitude),
          lon: Cesium.Math.toDegrees(position.longitude),
          altitudeM: position.height,
          headingDeg: Cesium.Math.toDegrees(viewer.camera.heading),
          pitchDeg: Cesium.Math.toDegrees(viewer.camera.pitch),
          rollDeg: Cesium.Math.toDegrees(viewer.camera.roll),
          verticalFovDeg: viewer.camera.frustum instanceof Cesium.PerspectiveFrustum
            ? Cesium.Math.toDegrees(viewer.camera.frustum.fov ?? Cesium.Math.toRadians(view.camera.verticalFovDeg))
            : view.camera.verticalFovDeg,
        },
      };
    };

    document.documentElement.dataset.referenceBridgeReady = "true";
    window.__CATACLYSM_APPLY_REFERENCE_VIEW__ = (view) => {
      applyReferenceView(new CustomEvent(REFERENCE_CAPTURE_EVENT, { detail: view }));
    };
    window.addEventListener(REFERENCE_CAPTURE_EVENT, applyReferenceView);
    return () => {
      window.removeEventListener(REFERENCE_CAPTURE_EVENT, applyReferenceView);
      window.__CATACLYSM_REFERENCE_CAPTURE__ = undefined;
      window.__CATACLYSM_APPLY_REFERENCE_VIEW__ = undefined;
      delete document.documentElement.dataset.referenceBridgeReady;
      delete document.documentElement.dataset.referenceEventReceived;
    };
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
    if (!viewer || !primary) return;
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
    return remove;
  }, [primary, viewerEpoch]);

  // (Re)build the imagery + terrain providers when the style changes.
  // Uses a monotonic request id so rapid style swaps don't race — only the
  // most recent request's result is allowed to commit.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const scene = viewer.scene;

    imageryRequestIdRef.current += 1;
    const requestId = imageryRequestIdRef.current;
    let cancelled = false;
    let removeTileErrorListener: (() => void) | undefined;
    let fallbackStarted = false;
    const isStale = () => cancelled || imageryRequestIdRef.current !== requestId || !viewerRef.current;
    setImageryStatus("connecting");
    setImageryMessage(`Connecting to ${findStyle(resolvedStyle).label}…`);

    const publishSelection = (
      selectedStyle: GlobeStyleId,
      fallbackReason: EarthSessionSnapshot["fallbackReason"],
      health: EarthAssetHealth,
    ) => {
      if (!primary) return;
      earthSessionRef.current = {
        requestedStyle: resolvedStyle,
        resolvedStyle: selectedStyle,
        fallbackReason,
        health,
        dynamicAttributions: [],
      };
      publishEarthSession(earthSessionRef.current);
    };

    const publishHealth = (health: EarthAssetHealth) => {
      if (!primary || !earthSessionRef.current) return;
      earthSessionRef.current = { ...earthSessionRef.current, health };
      publishEarthSession(earthSessionRef.current);
    };

    const replaceBaseLayer = (provider: Cesium.ImageryProvider) => {
      const previousBase = imageryLayerRef.current;
      const newBase = viewer.imageryLayers.addImageryProvider(provider);
      viewer.imageryLayers.lowerToBottom(newBase);
      imageryLayerRef.current = newBase;
      if (previousBase && previousBase !== newBase) {
        viewer.imageryLayers.remove(previousBase, true);
      }
    };

    const stopMonitoring = () => {
      removeTileErrorListener?.();
      removeTileErrorListener = undefined;
    };

    const monitorProvider = (provider: Cesium.ImageryProvider, localProvider: boolean) => {
      stopMonitoring();
      let failures = 0;
      removeTileErrorListener = provider.errorEvent.addEventListener((error) => {
        if (isStale()) return;
        failures += 1;
        console.warn(`[globe] tile provider error ${failures}`, error);
        if (localProvider) {
          setImageryStatus("failed");
          setImageryMessage("Bundled Natural Earth imagery could not be read.");
          publishHealth("failed");
          return;
        }
        if (failures < TILE_FAILURES_BEFORE_FALLBACK) {
          setImageryStatus("degraded");
          setImageryMessage(`${findStyle(resolvedStyle).label} is losing tiles; retrying before fallback.`);
          publishHealth("degraded");
          return;
        }
        void activateFallback(`${findStyle(resolvedStyle).label} stopped serving tiles.`);
      });
    };

    async function activateFallback(reason: string) {
      if (fallbackStarted || isStale()) return;
      fallbackStarted = true;
      setImageryStatus("degraded");
      setImageryMessage(`${reason} Loading bundled Natural Earth II…`);
      try {
        const fallback = await buildImagery(OFFLINE_STYLE, { online: true, hasToken: true });
        if (isStale()) return;
        replaceBaseLayer(fallback.provider);
        scene.terrainProvider = new Cesium.EllipsoidTerrainProvider();
        setActiveImageryStyle(OFFLINE_STYLE);
        monitorProvider(fallback.provider, true);
        setImageryStatus("fallback");
        setImageryMessage(`${reason} Using bundled Natural Earth II.`);
        publishSelection(OFFLINE_STYLE, "provider-error", "degraded");
      } catch (innerError) {
        if (isStale()) return;
        console.error("[globe] bundled Natural Earth fallback failed", innerError);
        setImageryStatus("failed");
        setImageryMessage("Online imagery and bundled Natural Earth II both failed.");
        publishSelection(OFFLINE_STYLE, "provider-error", "failed");
      }
    }

    (async () => {
      try {
        const imagery = await buildImagery(resolvedStyle, { online: networkOnline });
        if (isStale()) return;
        // Only remove the previous BASE layer — leave overlay layers
        // (the SWE snapshot) intact, otherwise a style swap mid-run
        // wipes the propagating-wave rendering. Cesium's
        // `baseLayer: false` Viewer option already suppresses the
        // implicit default base layer, so we don't need a sweep.
        replaceBaseLayer(imagery.provider);
        const terrain = imagery.fallbackReason ? undefined : await buildTerrain(imagery.resolvedStyle);
        if (isStale()) return;
        scene.terrainProvider = terrain ?? new Cesium.EllipsoidTerrainProvider();
        setActiveImageryStyle(imagery.resolvedStyle);
        monitorProvider(imagery.provider, imagery.resolvedStyle === OFFLINE_STYLE);
        if (imagery.fallbackReason === "offline") {
          setImageryStatus("fallback");
          setImageryMessage(`Offline — using bundled Natural Earth II instead of ${findStyle(resolvedStyle).label}.`);
          publishSelection(imagery.resolvedStyle, "offline", "degraded");
        } else if (imagery.fallbackReason === "missing-token") {
          setImageryStatus("fallback");
          setImageryMessage(`${findStyle(resolvedStyle).label} needs a Cesium token; using bundled Natural Earth II.`);
          publishSelection(imagery.resolvedStyle, "missing-token", "degraded");
        } else {
          setImageryStatus("ready");
          setImageryMessage(`${findStyle(resolvedStyle).label} ready.`);
          publishSelection(imagery.resolvedStyle, null, "ready");
        }
      } catch (err) {
        if (isStale()) return;
        console.warn("[globe] imagery/terrain initialization failed", err);
        await activateFallback(`${findStyle(resolvedStyle).label} failed to initialize.`);
      }
    })();

    return () => {
      cancelled = true;
      stopMonitoring();
    };
  }, [resolvedStyle, viewerEpoch, networkOnline, imageryRetryNonce, primary]);

  // Pick mode: install a left-click handler that reports cartographic coords.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    if (!pickMode) {
      destroyScreenSpaceHandler(pickHandlerRef.current);
      pickHandlerRef.current = null;
      viewer.canvas.style.cursor = "";
      return;
    }

    viewer.canvas.style.cursor = PICK_CURSOR_STYLE;
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
    handler.setInputAction((evt: { position: Cesium.Cartesian2 }) => {
      const cartesian = viewer.scene.camera.pickEllipsoid(evt.position, viewer.scene.globe.ellipsoid);
      if (!cartesian) return;
      const carto = Cesium.Cartographic.fromCartesian(cartesian);
      onPick?.(Cesium.Math.toDegrees(carto.latitude), Cesium.Math.toDegrees(carto.longitude));
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // Escape to cancel.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onPickCancel?.();
    };
    window.addEventListener("keydown", onKey);
    pickHandlerRef.current = handler;

    return () => {
      if (pickHandlerRef.current === handler) pickHandlerRef.current = null;
      destroyScreenSpaceHandler(handler);
      window.removeEventListener("keydown", onKey);
      viewer.canvas.style.cursor = "";
    };
  }, [pickMode, onPick, onPickCancel, viewerEpoch]);

  // F-V11 — Inspect mode: a left-click queries the backend for the
  // per-point readout and pops a Cesium label at the click position.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    if (!inspectMode) {
      destroyScreenSpaceHandler(inspectHandlerRef.current);
      inspectHandlerRef.current = null;
      if (inspectEntityRef.current) {
        viewer.entities.remove(inspectEntityRef.current);
        inspectEntityRef.current = null;
      }
      setLastInspectCoord(null);
      return;
    }

    if (!initial) return;
    viewer.canvas.style.cursor = "help";

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
    handler.setInputAction((evt: { position: Cesium.Cartesian2 }) => {
      const cartesian = viewer.scene.camera.pickEllipsoid(
        evt.position,
        viewer.scene.globe.ellipsoid,
      );
      if (!cartesian) return;
      const carto = Cesium.Cartographic.fromCartesian(cartesian);
      const lat = Cesium.Math.toDegrees(carto.latitude);
      const lon = Cesium.Math.toDegrees(carto.longitude);
      setLastInspectCoord({ lat, lon });

      const sourceDepth = initial.center.depth_m ?? 0;
      const req = {
        source: initial.center,
        initial_amplitude_m: initial.peak_amplitude_m,
        cavity_radius_m: initial.cavity_radius_m,
        is_impact: inspectIsImpact === true,
        mean_depth_m: Number.isFinite(sourceDepth) && sourceDepth > 0 ? sourceDepth : 4000,
        time_s: inspectTimeS ?? 0,
        click_lat: lat,
        click_lon: lon,
        beach_slope_deg: 1.0,
        offshore_depth_m: 50.0,
      };

      const inspectPromise = isTauri()
        ? api.inspectAtPoint(req)
        : Promise.resolve(demoInspectAtPoint(req));

      inspectPromise
        .then((res) => {
          // Re-read the viewer from the ref (it may have been recreated) and
          // use that instance for all entity mutations — never the closure.
          const v = viewerRef.current;
          if (!v) return;
          // Coalesce any non-finite physics field to an em dash so a degenerate
          // result (e.g. clicking exactly on the source) never renders
          // "Range NaN km" / "T+Infinityh" into the on-globe label.
          const fmt = (x: number, d: number) => (Number.isFinite(x) ? x.toFixed(d) : "—");
          const arrivalMin = res.arrival_time_s / 60;
          const arrivalLabel = !Number.isFinite(arrivalMin)
            ? "—"
            : arrivalMin < 60
              ? `T+${arrivalMin.toFixed(0)}m`
              : `T+${Math.floor(arrivalMin / 60)}h${String(Math.round(arrivalMin % 60)).padStart(2, "0")}`;
          const status = res.has_arrived ? "ARRIVED" : "in transit";
          const text = [
            `${fmt(lat, 2)}°, ${fmt(lon, 2)}°`,
            `Range  ${fmt(res.range_m / 1000, 0)} km   ·   ${status}`,
            `Arrival ${arrivalLabel}`,
            `Offshore ${fmt(res.offshore_amplitude_m, 2)} m   ·   Runup ${fmt(res.runup_m, 1)} m`,
            `Inundation ~${fmt(res.inundation_extent_m / 1000, 2)} km`,
          ].join("\n");

          if (inspectEntityRef.current) {
            v.entities.remove(inspectEntityRef.current);
            inspectEntityRef.current = null;
          }
          inspectEntityRef.current = v.entities.add({
            position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
            point: {
              pixelSize: 10,
              color: Cesium.Color.fromCssColorString("#89dceb"),
              outlineColor: Cesium.Color.fromCssColorString("#11111b"),
              outlineWidth: 2,
            },
            label: {
              text,
              font: "11px Inter, sans-serif",
              fillColor: Cesium.Color.fromCssColorString("#cdd6f4"),
              outlineColor: Cesium.Color.fromCssColorString("#11111b"),
              outlineWidth: 2,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              pixelOffset: new Cesium.Cartesian2(0, -16),
              showBackground: true,
              backgroundColor: Cesium.Color.fromCssColorString("#1e1e2e").withAlpha(0.92),
              backgroundPadding: new Cesium.Cartesian2(10, 8),
            },
          });
        })
        .catch((err) => console.warn("[globe] inspect_at_point failed", err));
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onInspectCancel?.();
    };
    window.addEventListener("keydown", onKey);
    inspectHandlerRef.current = handler;

    return () => {
      if (inspectHandlerRef.current === handler) inspectHandlerRef.current = null;
      destroyScreenSpaceHandler(handler);
      window.removeEventListener("keydown", onKey);
      viewer.canvas.style.cursor = "";
    };
  }, [inspectMode, initial, inspectIsImpact, inspectTimeS, onInspectCancel, viewerEpoch]);

  // React to a new initial displacement
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (!initial) {
      if (sourceEntityRef.current) {
        viewer.entities.remove(sourceEntityRef.current);
        sourceEntityRef.current = null;
      }
      return;
    }

    if (sourceEntityRef.current) viewer.entities.remove(sourceEntityRef.current);

    const { center, cavity_radius_m, peak_amplitude_m, label } = initial;
    const palette = {
      text: themeColor("--text", "#cdd6f4"),
      crust: themeColor("--crust", "#11111b"),
      yellow: themeColor("--yellow", "#f9e2af"),
      red: themeColor("--red", "#f38ba8"),
      maroon: themeColor("--maroon", "#eba0ac"),
      background: themeColor("--viewport-hud", "#1e1e2e"),
    };
    const position = Cesium.Cartesian3.fromDegrees(center.lon_deg, center.lat_deg, 0);
    // Cavity depth ≈ cavity_diameter / 2.83 (Ward-Asphaug parabolic).
    const cavityDepthM = Math.max(2 * cavity_radius_m / 2.83, 1.0);

    sourceEntityRef.current = viewer.entities.add({
      name: label,
      position,
      point: {
        pixelSize: 12,
        color: palette.yellow,
        outlineColor: palette.crust,
        outlineWidth: 2,
      },
      // Translucent 3D cylinder = the impact cavity.
      cylinder: {
        length: cavityDepthM,
        topRadius: Math.max(cavity_radius_m, 500),
        bottomRadius: Math.max(cavity_radius_m * 0.3, 250),
        material: palette.red.withAlpha(0.3),
        outline: true,
        outlineColor: palette.maroon,
      },
      // Surface ring outlining the cavity rim on the water surface.
      ellipse: {
        semiMajorAxis: Math.max(cavity_radius_m, 1000),
        semiMinorAxis: Math.max(cavity_radius_m, 1000),
        material: palette.red.withAlpha(0.18),
        outline: true,
        outlineColor: palette.maroon,
        height: 0,
      },
      label: {
        text: `${label}\nA₀ = ${peak_amplitude_m.toFixed(1)} m`,
        font: "12px Inter, sans-serif",
        fillColor: palette.text,
        outlineColor: palette.crust,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -16),
        showBackground: true,
        backgroundColor: palette.background.withAlpha(0.9),
        backgroundPadding: new Cesium.Cartesian2(8, 6),
      },
    });

    // Tune the fly-to range so small cavities (Lituya 100 m) don't zoom to the
    // centre of Earth and Chicxulub-class events (~50 km cavity) aren't lost.
    // Per-preset curated views override the auto-clamp (F-V13).
    const view = initial.camera_view;
    const flyRange = view
      ? view.range_m
      : Cesium.Math.clamp(cavity_radius_m * 25, 5e5, 8e6);
    const flyHeading = Cesium.Math.toRadians(view?.heading_deg ?? 0);
    const flyPitch = Cesium.Math.toRadians(view?.pitch_deg ?? -45);
    // Honour OS-level reduced-motion preference (WCAG 2.2 SC 2.3.3).
    // I4-04: at flyTo duration=0 Cesium still renders one frame of camera
    // interpolation which produces a brief visual jitter. Use the
    // instant `camera.setView` path for reduced-motion users instead.
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    if (reducedMotion) {
      viewer.camera.setView({
        destination: position,
        orientation: {
          heading: flyHeading,
          pitch: flyPitch,
          roll: 0,
        },
      });
      viewer.camera.zoomOut(flyRange);
    } else {
      const flyResult = viewer.flyTo(sourceEntityRef.current, {
        duration: 1.8,
        offset: new Cesium.HeadingPitchRange(flyHeading, flyPitch, flyRange),
      });
      // flyTo returns a Promise<boolean>; swallow rejections (terrain not
      // ready, scenario changed mid-flight, viewer unmounted) so they don't
      // surface as unhandled rejections.
      if (flyResult && typeof (flyResult as Promise<unknown>).then === "function") {
        (flyResult as Promise<unknown>).catch((err) => {
          console.debug("[globe] flyTo cancelled or failed", err);
        });
      }
    }
  }, [initial, viewerEpoch]);

  // Non-tsunami hazard effect rings (nuclear/asteroid). Drawn as filled,
  // outlined ground ellipses, largest-first so smaller inner zones stay
  // visible. Rebuilt whenever the rings or center change. Flies to frame the
  // outermost ring the first time a center appears.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    for (const e of hazardRingEntitiesRef.current) viewer.entities.remove(e);
    hazardRingEntitiesRef.current = [];
    if (!hazardRings || hazardRings.length === 0 || !hazardCenter) return;

    const { lat, lon } = hazardCenter;
    // Largest first: base alpha low so overlapping fills stack readably.
    const sorted = [...hazardRings].sort((a, b) => b.radiusM - a.radiusM);
    let outerRadius = 0;
    for (const ring of sorted) {
      const r = Math.max(ring.radiusM, 1);
      outerRadius = Math.max(outerRadius, r);
      const color = Cesium.Color.fromCssColorString(ring.color);
      hazardRingEntitiesRef.current.push(
        viewer.entities.add({
          name: ring.label,
          position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
          description: ring.description ?? ring.label,
          ellipse: {
            semiMajorAxis: r,
            semiMinorAxis: r,
            material: color.withAlpha(0.16),
            outline: true,
            outlineColor: color.withAlpha(0.9),
            outlineWidth: 2,
            height: 0,
          },
        }),
      );
    }
    // Ground-zero marker + label.
    hazardRingEntitiesRef.current.push(
      viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
        point: {
          pixelSize: 9,
          color: Cesium.Color.fromCssColorString("#f38ba8"),
          outlineColor: Cesium.Color.fromCssColorString("#11111b"),
          outlineWidth: 2,
        },
        label: {
          text: sorted[0]?.label ? "Ground zero" : "",
          font: "11px Inter, sans-serif",
          fillColor: Cesium.Color.fromCssColorString("#cdd6f4"),
          outlineColor: Cesium.Color.fromCssColorString("#11111b"),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -14),
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString("#1e1e2e").withAlpha(0.85),
          backgroundPadding: new Cesium.Cartesian2(6, 4),
        },
      }),
    );

    // Frame the outermost ring: pull the camera back to ~3× its radius.
    // HR-00 applies an exact camera after this renderer product is installed.
    // A still-running flyTo would race that pose and make otherwise identical
    // captures land on different frames.
    if (referenceCaptureEnabled()) {
      viewer.scene.requestRender();
      return;
    }
    const flyResult = viewer.flyTo(hazardRingEntitiesRef.current, {
      duration: 1.2,
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-55), Math.max(outerRadius * 3.2, 20000)),
    });
    if (flyResult && typeof (flyResult as Promise<unknown>).then === "function") {
      (flyResult as Promise<unknown>).catch(() => {});
    }
  }, [hazardRings, hazardCenter, viewerEpoch]);

  // Fallout plume polygons (nuclear surface bursts). Drawn as filled ground
  // polygons under the effect rings.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    for (const e of falloutEntitiesRef.current) viewer.entities.remove(e);
    falloutEntitiesRef.current = [];
    if (!hazardPolygons || hazardPolygons.length === 0) return;
    for (const poly of hazardPolygons) {
      const degrees: number[] = [];
      for (const p of poly.points) {
        if (Number.isFinite(p.lat) && Number.isFinite(p.lon)) degrees.push(p.lon, p.lat);
      }
      if (degrees.length < 6) continue;
      const color = Cesium.Color.fromCssColorString(poly.color);
      falloutEntitiesRef.current.push(
        viewer.entities.add({
          name: poly.label,
          description: poly.label,
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(degrees)),
            material: color.withAlpha(0.22),
            outline: true,
            outlineColor: color.withAlpha(0.8),
            height: 0,
          },
        }),
      );
    }
  }, [hazardPolygons, viewerEpoch]);

  // One-shot expanding shockwave animation on nuclear "Detonate". Grows a
  // bright ring from the center out to the outermost hazard ring over ~2.4 s.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !detonateNonce || impactKind === "asteroid" || !hazardCenter || !hazardRings || hazardRings.length === 0) return;
    const maxR = Math.max(...hazardRings.map((r) => r.radiusM), 1);
    const { lat, lon } = hazardCenter;
    const position = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
    const DURATION = 2400;
    const capturePhaseMs = referenceCaptureEnabled()
      ? window.__CATACLYSM_REFERENCE_CAPTURE__?.effectTimeMs
      : undefined;
    let start: number | null = null;
    let radius = 1;
    let alpha = 0.9;

    if (shockEntityRef.current) viewer.entities.remove(shockEntityRef.current);
    shockEntityRef.current = viewer.entities.add({
      position,
      ellipse: {
        semiMajorAxis: new Cesium.CallbackProperty(() => radius, false),
        semiMinorAxis: new Cesium.CallbackProperty(() => radius, false),
        material: new Cesium.ColorMaterialProperty(
          new Cesium.CallbackProperty(() => Cesium.Color.fromCssColorString("#f9e2af").withAlpha(alpha * 0.25), false),
        ),
        outline: true,
        outlineColor: new Cesium.CallbackProperty(() => Cesium.Color.WHITE.withAlpha(alpha), false),
        outlineWidth: 3,
        height: 0,
      },
    });

    const tick = (now: number) => {
      if (start === null) start = now;
      const p = Math.min(1, (now - start) / DURATION);
      const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
      radius = Math.max(eased * maxR, 1);
      alpha = p > 0.6 ? Math.max(0, 0.9 * (1 - (p - 0.6) / 0.4)) : 0.9;
      viewer.scene.requestRender();
      if (p < 1) {
        shockRafRef.current = requestAnimationFrame(tick);
      } else if (shockEntityRef.current) {
        viewer.entities.remove(shockEntityRef.current);
        shockEntityRef.current = null;
      }
    };
    if (capturePhaseMs !== undefined) {
      start = 0;
      tick(capturePhaseMs);
      if (shockRafRef.current !== null) cancelAnimationFrame(shockRafRef.current);
      shockRafRef.current = null;
    } else {
      shockRafRef.current = requestAnimationFrame(tick);
    }

    return () => {
      if (shockRafRef.current !== null) cancelAnimationFrame(shockRafRef.current);
      if (shockEntityRef.current && !viewer.isDestroyed()) {
        viewer.entities.remove(shockEntityRef.current);
        shockEntityRef.current = null;
      }
    };
  }, [detonateNonce, impactKind, hazardCenter, hazardRings, viewerEpoch]);

  // Asteroid entry sequence: a glowing bolide descends from space along the
  // physics entry angle with a fire trail, impacts with a flash + shockwave,
  // and — for ocean strikes — throws up a splash column and radiates a
  // tsunami wavefront outward. One-shot, triggered by detonateNonce.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !detonateNonce || impactKind !== "asteroid" || !hazardCenter || !hazardRings || hazardRings.length === 0) return;
    const { lat, lon } = hazardCenter;
    const maxR = Math.max(...hazardRings.map((r) => r.radiusM), 1);
    const isWater = impactIsWater === true;

    // Scale the whole sequence off the outermost effect radius so the descent,
    // impact, and water all sit in one readable frame (a fixed 420 km entry
    // dwarfed few-km ground effects into invisibility). Come in from the NW
    // along the real entry angle; steeper angle → shorter horizontal run.
    const baseScale = Math.max(maxR, 3000);
    // Start ~1.3× the outer effect radius up; the animation's own oblique camera
    // (below) keeps this within frame so the bolide streaks in from the sky.
    const START_ALT_M = baseScale * 1.3;
    const theta = Cesium.Math.toRadians(Math.min(Math.max(impactAngleDeg ?? 45, 8), 89));
    const bearingDeg = 315;
    // Cap the run-in for shallow angles so the bolide starts within the frame.
    const horizM = Math.min(START_ALT_M / Math.tan(theta), START_ALT_M * 1.3);
    // Forward geodesic from the impact point, back along the incoming bearing.
    const br = Cesium.Math.toRadians(bearingDeg);
    const R = 6_371_000;
    const dR = horizM / R;
    const lat1 = Cesium.Math.toRadians(lat);
    const lon1 = Cesium.Math.toRadians(lon);
    const startLat = Math.asin(Math.sin(lat1) * Math.cos(dR) + Math.cos(lat1) * Math.sin(dR) * Math.cos(br));
    const startLon = lon1 + Math.atan2(Math.sin(br) * Math.sin(dR) * Math.cos(lat1), Math.cos(dR) - Math.sin(lat1) * Math.sin(startLat));
    const startDeg = { lat: Cesium.Math.toDegrees(startLat), lon: Cesium.Math.toDegrees(startLon) };
    const startHigh = Cesium.Cartesian3.fromDegrees(startDeg.lon, startDeg.lat, START_ALT_M);
    const impactPos = Cesium.Cartesian3.fromDegrees(lon, lat, 0);

    const DESCENT_MS = 5000;
    const total = DESCENT_MS + (isWater ? 5200 : 2600);
    const capturePhaseMs = referenceCaptureEnabled()
      ? window.__CATACLYSM_REFERENCE_CAPTURE__?.effectTimeMs
      : undefined;

    // Mutable animation state read by the CallbackProperties below.
    let curPos = startHigh.clone();
    let boloAlpha = 1;
    let boloScale = 0.7;
    let flashR = 1;
    let flashA = 0;
    let shockR = 1;
    let shockA = 0;
    let splashH = 0;
    let splashA = 0;
    const waves = [0, 0, 0].map(() => ({ r: 1, a: 0 }));
    const waterReach = Math.min(Math.max(maxR * 4, 60_000), 700_000);

    // Clear any prior run.
    for (const e of impactEntitiesRef.current) viewer.entities.remove(e);
    impactEntitiesRef.current = [];

    // Generate a soft radial fireball texture for the bolide billboard — far
    // more legible at continental scale than a plain point.
    const fireCanvas = document.createElement("canvas");
    fireCanvas.width = 128;
    fireCanvas.height = 128;
    const fctx = fireCanvas.getContext("2d");
    if (fctx) {
      const grad = fctx.createRadialGradient(64, 64, 3, 64, 64, 64);
      grad.addColorStop(0, "rgba(255,255,245,1)");
      grad.addColorStop(0.25, "rgba(255,214,120,0.98)");
      grad.addColorStop(0.55, "rgba(255,120,45,0.75)");
      grad.addColorStop(1, "rgba(255,80,30,0)");
      fctx.fillStyle = grad;
      fctx.fillRect(0, 0, 128, 128);
    }

    // Bolide fire trail (thick glowing streak from entry point to the bolide).
    const trail = viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => [startHigh, curPos], false),
        width: 10,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.6,
          color: new Cesium.CallbackProperty(() => Cesium.Color.fromCssColorString("#ff8c42").withAlpha(boloAlpha * 0.9), false),
        }),
      },
    });
    // Bolide fireball billboard — grows as it heats up on entry, never occluded.
    const bolide = viewer.entities.add({
      position: new Cesium.CallbackPositionProperty(() => curPos, false),
      billboard: {
        image: fireCanvas,
        scale: new Cesium.CallbackProperty(() => boloScale, false),
        color: new Cesium.CallbackProperty(() => Cesium.Color.WHITE.withAlpha(boloAlpha), false),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    impactEntitiesRef.current.push(trail, bolide);

    // Impact-time entities (created up front, invisible until flash/shock fire).
    const flash = viewer.entities.add({
      position: impactPos,
      ellipse: {
        semiMajorAxis: new Cesium.CallbackProperty(() => flashR, false),
        semiMinorAxis: new Cesium.CallbackProperty(() => flashR, false),
        material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => Cesium.Color.WHITE.withAlpha(flashA), false)),
        height: 0,
      },
    });
    const shock = viewer.entities.add({
      position: impactPos,
      ellipse: {
        semiMajorAxis: new Cesium.CallbackProperty(() => shockR, false),
        semiMinorAxis: new Cesium.CallbackProperty(() => shockR, false),
        material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => Cesium.Color.fromCssColorString("#f9e2af").withAlpha(shockA * 0.22), false)),
        outline: true,
        outlineColor: new Cesium.CallbackProperty(() => Cesium.Color.WHITE.withAlpha(shockA), false),
        outlineWidth: 3,
        height: 0,
      },
    });
    impactEntitiesRef.current.push(flash, shock);

    if (isWater) {
      // Central splash column.
      impactEntitiesRef.current.push(
        viewer.entities.add({
          position: impactPos,
          cylinder: {
            length: new Cesium.CallbackProperty(() => Math.max(splashH, 1), false),
            topRadius: Math.max(baseScale * 0.05, 700),
            bottomRadius: Math.max(baseScale * 0.12, 1400),
            material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => Cesium.Color.fromCssColorString("#e8f6ff").withAlpha(splashA), false)),
          },
        }),
      );
      // Tsunami wavefront rings.
      for (const w of waves) {
        impactEntitiesRef.current.push(
          viewer.entities.add({
            position: impactPos,
            ellipse: {
              semiMajorAxis: new Cesium.CallbackProperty(() => Math.max(w.r, 1), false),
              semiMinorAxis: new Cesium.CallbackProperty(() => Math.max(w.r, 1), false),
              material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => Cesium.Color.fromCssColorString("#3aa0ff").withAlpha(w.a * 0.28), false)),
              outline: true,
              outlineColor: new Cesium.CallbackProperty(() => Cesium.Color.fromCssColorString("#dff1ff").withAlpha(w.a), false),
              outlineWidth: 3,
              height: 0,
            },
          }),
        );
      }
    }

    // Oblique cinematic camera: look AT the impact from the SE at a shallow
    // downward pitch so the SKY above ground zero is in frame — the bolide
    // (coming from the NW at altitude) then streaks down from the top of the
    // view into the impact. lookAt locks the impact reference frame for the
    // duration; released on cleanup / completion. The pick's steep top-down
    // framing pushed anything at altitude far above the viewport, which is why
    // the descending bolide was never on screen.
    viewer.camera.lookAt(
      impactPos,
      new Cesium.HeadingPitchRange(Cesium.Math.toRadians(135), Cesium.Math.toRadians(-24), START_ALT_M * 2.6),
    );

    let startT: number | null = null;
    const tick = (now: number) => {
      if (startT === null) startT = now;
      const t = now - startT;

      // Phase 1 — descent (accelerating).
      if (t < DESCENT_MS) {
        const p = t / DESCENT_MS;
        const ease = p * p; // accelerate into the ground
        curPos = Cesium.Cartesian3.lerp(startHigh, impactPos, ease, new Cesium.Cartesian3());
        boloScale = 0.7 + 2.1 * p; // fireball grows as it heats up on entry
        boloAlpha = 1;
      } else {
        boloAlpha = 0; // bolide consumed at impact
      }

      // Phase 2 — flash (first 500 ms after impact).
      const ti = t - DESCENT_MS;
      if (ti >= 0) {
        const fp = Math.min(1, ti / 500);
        flashR = (0.3 + 1.7 * fp) * Math.max(maxR * 0.25, 1500);
        flashA = fp < 1 ? 0.85 * (1 - fp) : 0;
        // Shockwave out to the outer ring over 2 s.
        const sp = Math.min(1, ti / 2000);
        shockR = Math.max((1 - Math.pow(1 - sp, 3)) * maxR, 1);
        shockA = sp >= 1 ? 0 : sp > 0.6 ? 0.9 * (1 - (sp - 0.6) / 0.4) : 0.9;

        if (isWater) {
          // Splash column rises then falls back (0–1.2 s).
          const wp = Math.min(1, ti / 1200);
          splashH = Math.sin(wp * Math.PI) * Math.max(baseScale * 0.5, 4000);
          splashA = Math.sin(wp * Math.PI) * 0.85;
          // Staggered tsunami rings expanding to waterReach over ~4 s.
          waves.forEach((w, i) => {
            const wt = ti - i * 900;
            if (wt <= 0) return;
            const rp = Math.min(1, wt / 4000);
            w.r = Math.max(rp * waterReach, 1);
            w.a = rp >= 1 ? 0 : 0.9 * (1 - rp);
          });
        }
      }

      viewer.scene.requestRender();
      if (t < total) {
        impactRafRef.current = requestAnimationFrame(tick);
      } else {
        for (const e of impactEntitiesRef.current) viewer.entities.remove(e);
        impactEntitiesRef.current = [];
        // Release the impact reference frame so the user can pan/zoom again.
        viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      }
    };
    if (capturePhaseMs !== undefined) {
      startT = 0;
      tick(capturePhaseMs);
      if (impactRafRef.current !== null) cancelAnimationFrame(impactRafRef.current);
      impactRafRef.current = null;
    } else {
      impactRafRef.current = requestAnimationFrame(tick);
    }

    return () => {
      if (impactRafRef.current !== null) cancelAnimationFrame(impactRafRef.current);
      if (!viewer.isDestroyed()) {
        for (const e of impactEntitiesRef.current) viewer.entities.remove(e);
        viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      }
      impactEntitiesRef.current = [];
    };
  }, [detonateNonce, impactKind, impactIsWater, impactAngleDeg, hazardCenter, hazardRings, viewerEpoch]);

  // React to a new wavefront snapshot — update existing entities in place.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    // When the source or its wavefront clears, tear down the existing rings
    // instead of leaving them stranded on the globe after switching back to
    // the empty state.
    if (!initial || !wavefront) {
      for (const e of wavefrontEntitiesRef.current) viewer.entities.remove(e);
      wavefrontEntitiesRef.current = [];
      return;
    }

    const { lat_deg, lon_deg } = initial.center;
    const position = Cesium.Cartesian3.fromDegrees(lon_deg, lat_deg, 0);
    // Compute max via reduce — Math.max(...arr) overflows the call stack for
    // large arrays in some engines (~10k args).
    const maxA = Math.max(
      1e-9,
      wavefront.amplitudes_m.reduce(
        (m, a) => (Number.isFinite(a) && a > m ? a : m),
        1e-9,
      ),
    );

    const targetCount = Math.ceil(wavefront.ranges_m.length / 2);

    // Grow if needed.
    while (wavefrontEntitiesRef.current.length < targetCount) {
      const e = viewer.entities.add({
        position,
        ellipse: {
          semiMajorAxis: 1.0,
          semiMinorAxis: 1.0,
          material: Cesium.Color.fromCssColorString("#74c7ec").withAlpha(0.0),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString("#74c7ec").withAlpha(0.3),
          height: 0,
        },
      });
      wavefrontEntitiesRef.current.push(e);
    }
    // Shrink if needed.
    while (wavefrontEntitiesRef.current.length > targetCount) {
      const e = wavefrontEntitiesRef.current.pop();
      if (e) viewer.entities.remove(e);
    }

    // Update each ring in place.
    for (let i = 0, j = 0; i < wavefront.ranges_m.length; i += 2, j++) {
      const r = wavefront.ranges_m[i];
      const a = wavefront.amplitudes_m[i];
      const t = Math.min(1, (Number.isFinite(a) ? a : 0) / maxA);
      const entity = wavefrontEntitiesRef.current[j];
      if (!entity?.ellipse) continue;
      entity.position = new Cesium.ConstantPositionProperty(position);
      entity.ellipse.semiMajorAxis = new Cesium.ConstantProperty(Math.max(r, 1));
      entity.ellipse.semiMinorAxis = new Cesium.ConstantProperty(Math.max(r, 1));
      entity.ellipse.outlineColor = new Cesium.ConstantProperty(
        Cesium.Color.fromCssColorString("#74c7ec").withAlpha(0.25 + 0.55 * t),
      );
    }
  }, [initial, wavefront, viewerEpoch]);

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
    if (!viewer) return;

    if (sweLayerRef.current) {
      viewer.imageryLayers.remove(sweLayerRef.current, true);
      sweLayerRef.current = null;
    }

    if (!sweSnapshot || !sweSnapshot.eta_png_b64) return;

    const [west, south, east, north] = sweSnapshot.bbox;
    // Cesium.Rectangle requires longitudes in [-180, 180] and lat in [-90, 90].
    // Clamp defensively so a near-dateline scenario doesn't construct an
    // invalid rectangle and blank-screen the whole scene.
    const w = Math.max(-180, Math.min(180, west));
    const e = Math.max(-180, Math.min(180, east));
    const s = Math.max(-90, Math.min(90, south));
    const n = Math.max(-90, Math.min(90, north));
    // NaN slips through Math.max/min and through `e <= w` (NaN comparisons are
    // always false), and a NaN rectangle makes Cesium throw / blank the scene.
    // Require all four edges finite and properly ordered before constructing it.
    if (![w, e, s, n].every(Number.isFinite) || e <= w || n <= s) return;

    const url = `data:image/png;base64,${sweSnapshot.eta_png_b64}`;
    let cancelled = false;
    Cesium.SingleTileImageryProvider.fromUrl(url, {
      rectangle: Cesium.Rectangle.fromDegrees(w, s, e, n),
    })
      .then((provider) => {
        if (cancelled || !viewerRef.current) return;
        const layer = viewer.imageryLayers.addImageryProvider(provider);
        layer.alpha = 0.9;
        sweLayerRef.current = layer;
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("[globe] SWE snapshot failed to load as imagery layer", err);
      });

    return () => {
      cancelled = true;
    };
  }, [sweSnapshot, viewerEpoch]);

  // First-arrival isochrones from a completed SWE run: one labelled
  // polyline set per contour time. Entity polylines are fine here —
  // ≤ 12 levels with a handful of chained lines each, far below the
  // Buffer*Collection payload sizes the runup overlay needed.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    for (const entity of isochroneEntitiesRef.current) {
      viewer.entities.remove(entity);
    }
    isochroneEntitiesRef.current = [];

    if (!isochrones || isochrones.length === 0) return;

    const added: Cesium.Entity[] = [];
    for (const iso of isochrones) {
      const minutes = Math.round(iso.time_s / 60);
      let labelled = false;
      for (const line of iso.lines) {
        if (line.length < 2) continue;
        const degs: number[] = [];
        for (const [lon, lat] of line) {
          if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
          degs.push(Math.max(-180, Math.min(180, lon)), Math.max(-90, Math.min(90, lat)));
        }
        if (degs.length < 4) continue;
        const entity = viewer.entities.add({
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(degs),
            width: 1.6,
            material: new Cesium.PolylineDashMaterialProperty({
              color: Cesium.Color.fromCssColorString("#f9e2af").withAlpha(0.85),
              dashLength: 12,
            }),
            clampToGround: false,
          },
        });
        added.push(entity);
        // Label the longest-first (lines arrive chained; first is fine) —
        // one label per contour level keeps the globe readable.
        if (!labelled) {
          const mid = line[Math.floor(line.length / 2)];
          const label = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(
              Math.max(-180, Math.min(180, mid[0])),
              Math.max(-90, Math.min(90, mid[1])),
            ),
            label: {
              text: `+${minutes} min`,
              font: "11px 'JetBrains Mono', monospace",
              fillColor: Cesium.Color.fromCssColorString("#f9e2af"),
              outlineColor: Cesium.Color.BLACK.withAlpha(0.7),
              outlineWidth: 2,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              scale: 1.0,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });
          added.push(label);
          labelled = true;
        }
      }
    }
    isochroneEntitiesRef.current = added;

    return () => {
      const v = viewerRef.current;
      if (!v) return;
      for (const entity of isochroneEntitiesRef.current) {
        v.entities.remove(entity);
      }
      isochroneEntitiesRef.current = [];
    };
  }, [isochrones, viewerEpoch]);

  // Runup bars + inundation discs at named coastal points.
  // Uses Cesium Buffer*Collection APIs instead of per-point geometry instances
  // so the overlay payload lives in typed buffers rather than entity objects.
  // Labels remain as entities (Cesium labels are entity-only).
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const prims = viewer.scene.primitives;

    // Tear down previous primitives.
    if (runupPrimitiveRef.current) {
      prims.remove(runupPrimitiveRef.current);
      runupPrimitiveRef.current = null;
    }
    if (inundationPrimitiveRef.current) {
      prims.remove(inundationPrimitiveRef.current);
      inundationPrimitiveRef.current = null;
    }

    const runupColor = (runup_m: number) =>
      runup_m < 2
        ? Cesium.Color.fromCssColorString("#a6e3a1")
        : runup_m < 10
          ? Cesium.Color.fromCssColorString("#f9e2af")
          : Cesium.Color.fromCssColorString("#f38ba8");

    const arrivedRunup = (runupResults ?? []).filter(
      (r) => r.has_arrived && Number.isFinite(r.runup_m) && r.runup_m >= 0.1,
    );
    const arrivedInundation = (runupResults ?? []).filter(
      (r) =>
        r.has_arrived &&
        Number.isFinite(r.inundation_extent_m) &&
        r.inundation_extent_m >= 100,
    );

    // --- Runup vertical bars (single BufferPolylineCollection for all points) ---
    const labelMap = runupLabelsRef.current;
    const labelSeen = new Set<string>();

    if (arrivedRunup.length > 0) {
      const runupCollection = new Cesium.BufferPolylineCollection({
        primitiveCountMax: arrivedRunup.length,
        vertexCountMax: arrivedRunup.length * 2,
        allowPicking: false,
        blendOption: Cesium.BlendOption.TRANSLUCENT,
      });
      const runupLine = new Cesium.BufferPolyline();

      for (const r of arrivedRunup) {
        const heightM = Math.min(Math.max(r.runup_m * 500, 5000), 8e5);
        const color = runupColor(r.runup_m);
        const ground = Cesium.Cartesian3.fromDegrees(r.lon, r.lat, 0);
        const top = Cesium.Cartesian3.fromDegrees(r.lon, r.lat, heightM);
        runupCollection.add(
          {
            positions: new Float64Array([ground.x, ground.y, ground.z, top.x, top.y, top.z]),
            material: new Cesium.BufferPolylineMaterial({
              color: color.withAlpha(0.85),
              outlineColor: Cesium.Color.fromCssColorString("#11111b").withAlpha(0.6),
              outlineWidth: 1,
              width: 8,
            }),
            featureId: 0,
            pickObject: { id: r.id },
          },
          runupLine,
        );

        // Label (entity) - update in place or create.
        labelSeen.add(r.id);
        const arrivalMin = r.arrival_time_s / 60;
        const arrivalLabel = !Number.isFinite(arrivalMin)
          ? "-"
          : arrivalMin < 60
            ? `T+${arrivalMin.toFixed(0)}m`
            : `T+${Math.floor(arrivalMin / 60)}h${String(Math.round(arrivalMin % 60)).padStart(2, "0")}`;
        const offshore = Number.isFinite(r.offshore_amplitude_m) ? r.offshore_amplitude_m.toFixed(2) : "-";
        const hoverText =
          `${r.name}\n${arrivalLabel}  -  ${r.runup_m.toFixed(1)} m runup\n` +
          `${offshore} m offshore`;

        let lbl = labelMap.get(r.id);
        if (!lbl) {
          lbl = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(r.lon, r.lat, heightM),
            label: {
              text: hoverText,
              font: "10px Inter, sans-serif",
              fillColor: Cesium.Color.fromCssColorString("#cdd6f4"),
              outlineColor: Cesium.Color.fromCssColorString("#11111b"),
              outlineWidth: 2,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              pixelOffset: new Cesium.Cartesian2(0, -10),
              showBackground: true,
              backgroundColor: Cesium.Color.fromCssColorString("#1e1e2e").withAlpha(0.9),
              backgroundPadding: new Cesium.Cartesian2(6, 4),
              scale: 0.9,
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3_000_000),
            },
          });
          labelMap.set(r.id, lbl);
        } else {
          lbl.position = new Cesium.ConstantPositionProperty(
            Cesium.Cartesian3.fromDegrees(r.lon, r.lat, heightM),
          );
          if (lbl.label) {
            lbl.label.text = new Cesium.ConstantProperty(hoverText);
          }
        }
      }

      runupPrimitiveRef.current = prims.add(runupCollection);
    }

    // Remove stale labels.
    for (const [id, lbl] of labelMap) {
      if (!labelSeen.has(id)) {
        viewer.entities.remove(lbl);
        labelMap.delete(id);
      }
    }

    // --- Inundation discs (single BufferPolygonCollection with fill + outline) ---
    if (arrivedInundation.length > 0) {
      const triangles = circleTriangles();
      const inundationCollection = new Cesium.BufferPolygonCollection({
        primitiveCountMax: arrivedInundation.length,
        vertexCountMax: arrivedInundation.length * INUNDATION_SEGMENTS,
        triangleCountMax: arrivedInundation.length * (INUNDATION_SEGMENTS - 2),
        allowPicking: false,
        blendOption: Cesium.BlendOption.TRANSLUCENT,
      });
      const polygon = new Cesium.BufferPolygon();

      for (const r of arrivedInundation) {
        const colour = runupColor(r.runup_m);
        const radius = Math.min(Math.max(r.inundation_extent_m, 200), 50_000);
        inundationCollection.add(
          {
            positions: circlePositions(r.lon, r.lat, radius),
            holes: new Uint32Array(),
            triangles,
            material: new Cesium.BufferPolygonMaterial({
              color: colour.withAlpha(0.25),
              outlineColor: colour.withAlpha(0.7),
              outlineWidth: 2,
            }),
            featureId: 0,
            pickObject: { id: `inundation-${r.id}` },
          },
          polygon,
        );
      }

      inundationPrimitiveRef.current = prims.add(inundationCollection);
    }
  }, [runupResults, viewerEpoch]);

  // DART buoy pins.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const map = dartEntitiesRef.current;
    const seen = new Set<number>();
    for (const b of dartBuoys ?? []) {
      seen.add(b.id);
      let entity = map.get(b.id);
      const position = Cesium.Cartesian3.fromDegrees(b.lon, b.lat, 0);
      if (!entity) {
        entity = viewer.entities.add({
          name: `DART ${b.id}`,
          position,
          point: {
            pixelSize: 9,
            color: Cesium.Color.fromCssColorString("#eba0ac"),
            outlineColor: Cesium.Color.fromCssColorString("#11111b"),
            outlineWidth: 2,
          },
          label: {
            text: `DART ${b.id}`,
            font: "10px Inter, sans-serif",
            fillColor: Cesium.Color.fromCssColorString("#eba0ac"),
            outlineColor: Cesium.Color.fromCssColorString("#11111b"),
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.TOP,
            pixelOffset: new Cesium.Cartesian2(0, 10),
            scale: 0.85,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1.5e7),
          },
        });
        map.set(b.id, entity);
      } else {
        entity.position = new Cesium.ConstantPositionProperty(position);
      }
    }
    for (const [id, entity] of map) {
      if (!seen.has(id)) {
        viewer.entities.remove(entity);
        map.delete(id);
      }
    }
  }, [dartBuoys, viewerEpoch]);

  return (
    <>
      <div
        className="app__globe-mount"
        ref={containerRef}
        data-imagery-status={imageryStatus}
        data-imagery-style={activeImageryStyle ?? "none"}
      />
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
            <span>Click anywhere on the globe to read amplitude, arrival, and runup.</span>
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
            onSubmit={(lat, lon) => {
              if (!viewerRef.current || !initial) return;
              setLastInspectCoord({ lat, lon });
              const sourceDepth = initial.center.depth_m ?? 0;
              const req = {
                source: initial.center,
                initial_amplitude_m: initial.peak_amplitude_m,
                cavity_radius_m: initial.cavity_radius_m,
                is_impact: inspectIsImpact === true,
                mean_depth_m:
                  Number.isFinite(sourceDepth) && sourceDepth > 0 ? sourceDepth : 4000,
                time_s: inspectTimeS ?? 0,
                click_lat: lat,
                click_lon: lon,
                beach_slope_deg: 1.0,
                offshore_depth_m: 50.0,
              };
              const inspectPromise = isTauri()
                ? api.inspectAtPoint(req)
                : Promise.resolve(demoInspectAtPoint(req));

              inspectPromise
                .then((res) => {
                  const v = viewerRef.current;
                  if (!v) return;
                  const fmt = (x: number, d: number) =>
                    Number.isFinite(x) ? x.toFixed(d) : "—";
                  const arrivalMin = res.arrival_time_s / 60;
                  const arrivalLabel = !Number.isFinite(arrivalMin)
                    ? "—"
                    : arrivalMin < 60
                      ? `T+${arrivalMin.toFixed(0)}m`
                      : `T+${Math.floor(arrivalMin / 60)}h${String(Math.round(arrivalMin % 60)).padStart(2, "0")}`;
                  const status = res.has_arrived ? "ARRIVED" : "in transit";
                  const text = [
                    `${fmt(lat, 2)}°, ${fmt(lon, 2)}°`,
                    `Range  ${fmt(res.range_m / 1000, 0)} km   ·   ${status}`,
                    `Arrival ${arrivalLabel}`,
                    `Offshore ${fmt(res.offshore_amplitude_m, 2)} m   ·   Runup ${fmt(res.runup_m, 1)} m`,
                    `Inundation ~${fmt(res.inundation_extent_m / 1000, 2)} km`,
                  ].join("\n");

                  if (inspectEntityRef.current) {
                    v.entities.remove(inspectEntityRef.current);
                    inspectEntityRef.current = null;
                  }
                  inspectEntityRef.current = v.entities.add({
                    position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
                    point: {
                      pixelSize: 10,
                      color: Cesium.Color.fromCssColorString("#89dceb"),
                      outlineColor: Cesium.Color.fromCssColorString("#11111b"),
                      outlineWidth: 2,
                    },
                    label: {
                      text,
                      font: "11px Inter, sans-serif",
                      fillColor: Cesium.Color.fromCssColorString("#cdd6f4"),
                      outlineColor: Cesium.Color.fromCssColorString("#11111b"),
                      outlineWidth: 2,
                      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                      pixelOffset: new Cesium.Cartesian2(0, -16),
                      showBackground: true,
                      backgroundColor: Cesium.Color.fromCssColorString("#1e1e2e").withAlpha(0.92),
                      backgroundPadding: new Cesium.Cartesian2(10, 8),
                    },
                  });
                })
                .catch((err) => console.warn("[globe] keyboard inspect failed", err));
            }}
            label="Enter coordinates"
          />
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
      {!initial && !hazardCenter && ["ready", "degraded", "fallback"].includes(imageryStatus) && (
        <div className="app__globe-hint" role="status" aria-live="polite">
          <span className="app__globe-hint-kicker">{domain === "tsunami" ? "Ready for a source" : "Ready for a target"}</span>
          <strong>{domain === "tsunami" ? "Select a preset or simulate a custom source." : "Choose an effects origin."}</strong>
          <span>
            {domain === "tsunami"
              ? "Wavefronts, runup bars, exports, and inspection unlock after a scenario is active."
              : `Pick a location to calculate ${domain === "nuclear" ? "blast, thermal, radiation, and fallout" : "entry, crater, blast, and thermal"} effects.`}
          </span>
        </div>
      )}
    </>
  );
}
