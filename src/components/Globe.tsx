import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";
import { configureCesium } from "../lib/cesium";
import { buildImagery, buildTerrain, DEFAULT_STYLE, type GlobeStyleId } from "../lib/globe-styles";
import { settings } from "../lib/settings";
import { demoInspectAtPoint } from "../lib/demo";
import { api, isTauri, type RunupAtPointResult } from "../lib/tauri";
import type {
  DartBuoy,
  GridSnapshot,
  InitialDisplacement,
  PropagationSnapshot,
} from "../types/scenario";

type Props = {
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
  /** Whether this is the primary (exportable) globe pane. Only the primary
   *  pane keeps the WebGL backbuffer alive for PNG/share/video export — the
   *  Slot B compare pane skips that per-frame cost. */
  primary?: boolean;
};

const EARTH_RADIUS_M = 6_371_000;
const INUNDATION_SEGMENTS = 40;

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
  primary = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const sourceEntityRef = useRef<Cesium.Entity | null>(null);
  const wavefrontEntitiesRef = useRef<Cesium.Entity[]>([]);
  const runupPrimitiveRef = useRef<Cesium.BufferPolylineCollection | null>(null);
  const inundationPrimitiveRef = useRef<Cesium.BufferPolygonCollection | null>(null);
  const runupLabelsRef = useRef<Map<string, Cesium.Entity>>(new Map());
  const dartEntitiesRef = useRef<Map<number, Cesium.Entity>>(new Map());
  const sweLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const imageryLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const imageryRequestIdRef = useRef(0);
  const pickHandlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null);
  const inspectHandlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null);
  const inspectEntityRef = useRef<Cesium.Entity | null>(null);
  const [imageryStatus, setImageryStatus] = useState<"loading" | "ready" | "fallback" | "error" | "offline">("loading");
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
    const onSettingsSaved = () => load();
    window.addEventListener("tsunamisim:settings-saved", onSettingsSaved);
    return () => {
      cancelled = true;
      window.removeEventListener("tsunamisim:settings-saved", onSettingsSaved);
    };
  }, [styleId]);

  useEffect(() => {
    const goOffline = () => {
      if (imageryStatus === "ready" || imageryStatus === "loading") {
        setImageryStatus("offline");
      }
    };
    const goOnline = () => {
      if (imageryStatus === "offline") setImageryStatus("ready");
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, [imageryStatus]);

  // (Re)build the imagery + terrain providers when the style changes.
  // Uses a monotonic request id so rapid style swaps don't race — only the
  // most recent request's result is allowed to commit.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    imageryRequestIdRef.current += 1;
    const requestId = imageryRequestIdRef.current;
    let cancelled = false;
    const isStale = () => cancelled || imageryRequestIdRef.current !== requestId || !viewerRef.current;
    setImageryStatus("loading");

    (async () => {
      try {
        const imagery = await buildImagery(resolvedStyle);
        if (isStale()) return;
        // Only remove the previous BASE layer — leave overlay layers
        // (the SWE snapshot) intact, otherwise a style swap mid-run
        // wipes the propagating-wave rendering. Cesium's
        // `baseLayer: false` Viewer option already suppresses the
        // implicit default base layer, so we don't need a sweep.
        if (imageryLayerRef.current) {
          viewer.imageryLayers.remove(imageryLayerRef.current, true);
          imageryLayerRef.current = null;
        }
        if (isStale()) return;
        const newBase = viewer.imageryLayers.addImageryProvider(imagery);
        // Keep the base layer at the bottom so overlays (SWE PNG, etc.) sit on top.
        viewer.imageryLayers.lowerToBottom(newBase);
        imageryLayerRef.current = newBase;
        const terrain = await buildTerrain(resolvedStyle);
        if (isStale()) return;
        viewer.scene.terrainProvider = terrain ?? new Cesium.EllipsoidTerrainProvider();
        setImageryStatus("ready");
      } catch (err) {
        if (isStale()) return;
        console.warn("[globe] imagery/terrain load failed; falling back to Natural Earth.", err);
        try {
          const fallback = await buildImagery(DEFAULT_STYLE);
          if (isStale()) return;
          if (imageryLayerRef.current) {
            viewer.imageryLayers.remove(imageryLayerRef.current, true);
          }
          const fallbackLayer = viewer.imageryLayers.addImageryProvider(fallback);
          viewer.imageryLayers.lowerToBottom(fallbackLayer);
          imageryLayerRef.current = fallbackLayer;
          // Only surface the toast when the user explicitly chose a
          // token-gated style (i.e. they pasted a token but it 401'd
          // or upstream is down). For free style swaps no toast is needed.
          const styleMeta = (await import("../lib/globe-styles")).findStyle(resolvedStyle);
          setImageryStatus(styleMeta.requires_token ? "fallback" : "ready");
        } catch (innerErr) {
          if (isStale()) return;
          console.error("[globe] Natural Earth fallback also failed", innerErr);
          setImageryStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [resolvedStyle, viewerEpoch]);

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

    // Clean up entity + handler when mode flips off.
    if (!inspectMode) {
      destroyScreenSpaceHandler(inspectHandlerRef.current);
      inspectHandlerRef.current = null;
      if (inspectEntityRef.current) {
        viewer.entities.remove(inspectEntityRef.current);
        inspectEntityRef.current = null;
      }
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

      // Use the source's own water depth as the propagation depth so the
      // inspect readout reconciles with run_preset / the results panel,
      // instead of a hardcoded flat 4000 m that contradicts shelf/lake events.
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
    const position = Cesium.Cartesian3.fromDegrees(center.lon_deg, center.lat_deg, 0);
    // Cavity depth ≈ cavity_diameter / 2.83 (Ward-Asphaug parabolic).
    const cavityDepthM = Math.max(2 * cavity_radius_m / 2.83, 1.0);

    sourceEntityRef.current = viewer.entities.add({
      name: label,
      position,
      point: {
        pixelSize: 12,
        color: Cesium.Color.fromCssColorString("#f9e2af"),
        outlineColor: Cesium.Color.fromCssColorString("#11111b"),
        outlineWidth: 2,
      },
      // Translucent 3D cylinder = the impact cavity.
      cylinder: {
        length: cavityDepthM,
        topRadius: Math.max(cavity_radius_m, 500),
        bottomRadius: Math.max(cavity_radius_m * 0.3, 250),
        material: Cesium.Color.fromCssColorString("#f38ba8").withAlpha(0.3),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString("#eba0ac"),
      },
      // Surface ring outlining the cavity rim on the water surface.
      ellipse: {
        semiMajorAxis: Math.max(cavity_radius_m, 1000),
        semiMinorAxis: Math.max(cavity_radius_m, 1000),
        material: Cesium.Color.fromCssColorString("#f38ba8").withAlpha(0.18),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString("#eba0ac"),
        height: 0,
      },
      label: {
        text: `${label}\nA₀ = ${peak_amplitude_m.toFixed(1)} m`,
        font: "12px Inter, sans-serif",
        fillColor: Cesium.Color.fromCssColorString("#cdd6f4"),
        outlineColor: Cesium.Color.fromCssColorString("#11111b"),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -16),
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("#1e1e2e").withAlpha(0.85),
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
      <div className="app__globe-mount" ref={containerRef} />
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
            <button className="app__globe-banner-cancel" onClick={onInspectCancel} type="button">
              Cancel
            </button>
          </div>
          <CoordEntryForm
            onSubmit={(lat, lon) => {
              if (!viewerRef.current || !initial) return;
              const viewer = viewerRef.current;
              const fakeEvt = {
                position: new Cesium.Cartesian2(
                  viewer.canvas.width / 2,
                  viewer.canvas.height / 2,
                ),
              };
              void fakeEvt;
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
      {imageryStatus === "loading" && (
        <div className="app__globe-status" data-status="loading">
          Loading globe imagery…
        </div>
      )}
      {imageryStatus === "error" && (
        <div className="app__globe-status" data-status="error">
          Imagery failed to load — check your network.
        </div>
      )}
      {imageryStatus === "fallback" && (
        <div className="app__globe-status" data-status="fallback" role="status" aria-live="polite">
          Cesium ion imagery unavailable (invalid token or upstream error) — fell back to Natural Earth.
        </div>
      )}
      {imageryStatus === "offline" && (
        <div className="app__globe-status" data-status="offline" role="status" aria-live="polite">
          Offline — using cached tiles. Select Natural Earth II in Settings for full offline support.
        </div>
      )}
      {!initial && imageryStatus === "ready" && (
        <div className="app__globe-hint" role="status" aria-live="polite">
          <span className="app__globe-hint-kicker">Ready for a source</span>
          <strong>Select a preset or simulate a custom source.</strong>
          <span>Wavefronts, runup bars, exports, and inspection unlock after a scenario is active.</span>
        </div>
      )}
    </>
  );
}
