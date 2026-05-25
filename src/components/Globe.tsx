import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";
import { configureCesium } from "../lib/cesium";
import { buildImagery, buildTerrain, DEFAULT_STYLE, type GlobeStyleId } from "../lib/globe-styles";
import { settings } from "../lib/settings";
import { api, type RunupAtPointResult } from "../lib/tauri";
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
};

const PICK_CURSOR_STYLE = "crosshair";

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
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const sourceEntityRef = useRef<Cesium.Entity | null>(null);
  const wavefrontEntitiesRef = useRef<Cesium.Entity[]>([]);
  const runupEntitiesRef = useRef<Map<string, Cesium.Entity>>(new Map());
  const inundationEntitiesRef = useRef<Map<string, Cesium.Entity>>(new Map());
  const dartEntitiesRef = useRef<Map<number, Cesium.Entity>>(new Map());
  const sweLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const imageryLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const imageryRequestIdRef = useRef(0);
  const pickHandlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null);
  const inspectHandlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null);
  const inspectEntityRef = useRef<Cesium.Entity | null>(null);
  const [imageryStatus, setImageryStatus] = useState<"loading" | "ready" | "fallback" | "error">("loading");
  const [resolvedStyle, setResolvedStyle] = useState<GlobeStyleId>(styleId ?? DEFAULT_STYLE);

  // One-time viewer mount
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    configureCesium();

    const viewer = new Cesium.Viewer(containerRef.current, {
      terrain: undefined,
      // Don't auto-pick a default base layer — we install our own below
      // (OSM by default) so the globe always renders without a token.
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
      contextOptions: { webgl: { preserveDrawingBuffer: true } },
    });

    viewer.scene.globe.enableLighting = true;
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
    viewer.scene.fog.enabled = true;

    viewerRef.current = viewer;

    return () => {
      pickHandlerRef.current?.destroy();
      pickHandlerRef.current = null;
      inspectHandlerRef.current?.destroy();
      inspectHandlerRef.current = null;
      inspectEntityRef.current = null;
      viewer.destroy();
      viewerRef.current = null;
      sourceEntityRef.current = null;
      wavefrontEntitiesRef.current = [];
      runupEntitiesRef.current = new Map();
      dartEntitiesRef.current = new Map();
      inundationEntitiesRef.current = new Map();
      sweLayerRef.current = null;
    };
  }, []);

  // Resolve which globe style we should be using — prop override, persisted
  // setting, or DEFAULT_STYLE (OSM). Listens for `tsunamisim:settings-saved`
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
        console.warn("[globe] imagery/terrain load failed; falling back to OSM.", err);
        try {
          const fallback = await buildImagery("osm");
          if (isStale()) return;
          if (imageryLayerRef.current) {
            viewer.imageryLayers.remove(imageryLayerRef.current, true);
          }
          const fallbackLayer = viewer.imageryLayers.addImageryProvider(fallback);
          viewer.imageryLayers.lowerToBottom(fallbackLayer);
          imageryLayerRef.current = fallbackLayer;
          // Only surface the toast when the user explicitly chose a
          // token-gated style (i.e. they pasted a token but it 401'd
          // or upstream is down). For style swaps to OSM-default no
          // toast is needed — the fallback path engages routinely on
          // missing-token cases via buildImagery's short-circuit.
          const styleMeta = (await import("../lib/globe-styles")).findStyle(resolvedStyle);
          setImageryStatus(styleMeta.requires_token ? "fallback" : "ready");
        } catch (innerErr) {
          if (isStale()) return;
          console.error("[globe] OSM fallback also failed", innerErr);
          setImageryStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [resolvedStyle]);

  // Pick mode: install a left-click handler that reports cartographic coords.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    if (!pickMode) {
      pickHandlerRef.current?.destroy();
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
      handler.destroy();
      window.removeEventListener("keydown", onKey);
      viewer.canvas.style.cursor = "";
    };
  }, [pickMode, onPick, onPickCancel]);

  // F-V11 — Inspect mode: a left-click queries the backend for the
  // per-point readout and pops a Cesium label at the click position.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    // Clean up entity + handler when mode flips off.
    if (!inspectMode) {
      inspectHandlerRef.current?.destroy();
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

      api
        .inspectAtPoint({
          source: initial.center,
          initial_amplitude_m: initial.peak_amplitude_m,
          cavity_radius_m: initial.cavity_radius_m,
          is_impact: inspectIsImpact === true,
          mean_depth_m: 4000,
          time_s: inspectTimeS ?? 0,
          click_lat: lat,
          click_lon: lon,
          beach_slope_deg: 1.0,
          offshore_depth_m: 50.0,
        })
        .then((res) => {
          if (!viewerRef.current) return;
          const arrivalMin = res.arrival_time_s / 60;
          const arrivalLabel =
            arrivalMin < 60
              ? `T+${arrivalMin.toFixed(0)}m`
              : `T+${Math.floor(arrivalMin / 60)}h${String(Math.round(arrivalMin % 60)).padStart(2, "0")}`;
          const status = res.has_arrived ? "ARRIVED" : "in transit";
          const text = [
            `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`,
            `Range  ${(res.range_m / 1000).toFixed(0)} km   ·   ${status}`,
            `Arrival ${arrivalLabel}`,
            `Offshore ${res.offshore_amplitude_m.toFixed(2)} m   ·   Runup ${res.runup_m.toFixed(1)} m`,
            `Inundation ~${(res.inundation_extent_m / 1000).toFixed(2)} km`,
          ].join("\n");

          if (inspectEntityRef.current) {
            viewer.entities.remove(inspectEntityRef.current);
            inspectEntityRef.current = null;
          }
          inspectEntityRef.current = viewer.entities.add({
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
      handler.destroy();
      window.removeEventListener("keydown", onKey);
      viewer.canvas.style.cursor = "";
    };
  }, [inspectMode, initial, inspectIsImpact, inspectTimeS, onInspectCancel]);

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
  }, [initial]);

  // React to a new wavefront snapshot — update existing entities in place.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !initial || !wavefront) return;

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
  }, [initial, wavefront]);

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
    if (e <= w || n <= s) return;

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
  }, [sweSnapshot]);

  // Runup bars at named coastal points.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const map = runupEntitiesRef.current;
    const seen = new Set<string>();

    for (const r of runupResults ?? []) {
      seen.add(r.id);
      if (!r.has_arrived || !Number.isFinite(r.runup_m) || r.runup_m < 0.1) {
        // Remove or hide the entity until the wave arrives.
        const existing = map.get(r.id);
        if (existing) {
          viewer.entities.remove(existing);
          map.delete(r.id);
        }
        continue;
      }

      // Bar height in metres, clamped for visibility.
      const heightM = Math.min(Math.max(r.runup_m * 500, 5000), 8e5);
      // Colour ramp: green (< 2 m) → yellow (2–10 m) → red (> 10 m).
      const color =
        r.runup_m < 2
          ? Cesium.Color.fromCssColorString("#a6e3a1")
          : r.runup_m < 10
            ? Cesium.Color.fromCssColorString("#f9e2af")
            : Cesium.Color.fromCssColorString("#f38ba8");

      // Format the hover label. Arrival time as "T+HhMM"; runup to 1 dp.
      const arrivalMin = r.arrival_time_s / 60;
      const arrivalLabel =
        arrivalMin < 60
          ? `T+${arrivalMin.toFixed(0)}m`
          : `T+${Math.floor(arrivalMin / 60)}h${String(Math.round(arrivalMin % 60)).padStart(2, "0")}`;
      const hoverText = `${r.name}\n${arrivalLabel}  •  ${r.runup_m.toFixed(1)} m runup\n${r.offshore_amplitude_m.toFixed(2)} m offshore`;

      let entity = map.get(r.id);
      if (!entity) {
        entity = viewer.entities.add({
          name: r.name,
          description: hoverText.replace(/\n/g, "<br/>"),
          position: Cesium.Cartesian3.fromDegrees(r.lon, r.lat, heightM / 2),
          cylinder: {
            length: heightM,
            topRadius: 6000,
            bottomRadius: 9000,
            material: color.withAlpha(0.85),
            outline: false,
          },
          // Distance-display-condition label so labels don't clutter when
          // zoomed out to a global view.
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
        map.set(r.id, entity);
      } else {
        entity.position = new Cesium.ConstantPositionProperty(
          Cesium.Cartesian3.fromDegrees(r.lon, r.lat, heightM / 2),
        );
        if (entity.cylinder) {
          entity.cylinder.length = new Cesium.ConstantProperty(heightM);
          entity.cylinder.material = new Cesium.ColorMaterialProperty(color.withAlpha(0.85));
        }
        if (entity.label) {
          entity.label.text = new Cesium.ConstantProperty(hoverText);
        }
      }
    }

    // Remove entities for points that are no longer in the result set.
    for (const [id, entity] of map) {
      if (!seen.has(id)) {
        viewer.entities.remove(entity);
        map.delete(id);
      }
    }

    // I-V02 — inundation discs alongside the runup bars. A semi-transparent
    // circular polygon at each runup point with radius = inundation_extent_m
    // and colour matching the bar's runup severity. Land-side first-order
    // geometric approximation; refined to real flood polygons in v0.4.0
    // once GEBCO bathymetry + wet/dry cell handling land in production.
    const inMap = inundationEntitiesRef.current;
    const inSeen = new Set<string>();
    for (const r of runupResults ?? []) {
      inSeen.add(r.id);
      if (
        !r.has_arrived ||
        !Number.isFinite(r.inundation_extent_m) ||
        r.inundation_extent_m < 100
      ) {
        const existing = inMap.get(r.id);
        if (existing) {
          viewer.entities.remove(existing);
          inMap.delete(r.id);
        }
        continue;
      }
      const colour =
        r.runup_m < 2
          ? Cesium.Color.fromCssColorString("#a6e3a1")
          : r.runup_m < 10
            ? Cesium.Color.fromCssColorString("#f9e2af")
            : Cesium.Color.fromCssColorString("#f38ba8");
      const radius = Math.min(Math.max(r.inundation_extent_m, 200), 50_000);
      let entity = inMap.get(r.id);
      if (!entity) {
        entity = viewer.entities.add({
          name: `${r.name} inundation`,
          position: Cesium.Cartesian3.fromDegrees(r.lon, r.lat, 0),
          ellipse: {
            semiMajorAxis: radius,
            semiMinorAxis: radius,
            material: colour.withAlpha(0.25),
            outline: true,
            outlineColor: colour.withAlpha(0.7),
            height: 0,
          },
        });
        inMap.set(r.id, entity);
      } else if (entity.ellipse) {
        entity.position = new Cesium.ConstantPositionProperty(
          Cesium.Cartesian3.fromDegrees(r.lon, r.lat, 0),
        );
        entity.ellipse.semiMajorAxis = new Cesium.ConstantProperty(radius);
        entity.ellipse.semiMinorAxis = new Cesium.ConstantProperty(radius);
        entity.ellipse.material = new Cesium.ColorMaterialProperty(colour.withAlpha(0.25));
        entity.ellipse.outlineColor = new Cesium.ConstantProperty(colour.withAlpha(0.7));
      }
    }
    for (const [id, entity] of inMap) {
      if (!inSeen.has(id)) {
        viewer.entities.remove(entity);
        inMap.delete(id);
      }
    }
  }, [runupResults]);

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
  }, [dartBuoys]);

  return (
    <>
      <div className="app__globe-mount" ref={containerRef} />
      {pickMode && (
        <div className="app__globe-pickbanner">
          Click anywhere on the globe to set scenario location. Press
          <kbd> Esc </kbd>
          to cancel.
        </div>
      )}
      {inspectMode && (
        <div className="app__globe-pickbanner">
          Click anywhere on the globe to read amplitude / arrival / runup.
          Press <kbd> Esc </kbd> to exit.
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
          Cesium ion imagery unavailable (invalid token or upstream error) — fell back to OSM.
        </div>
      )}
      {!initial && imageryStatus === "ready" && (
        <div className="app__globe-hint">
          Choose a preset on the left, or build a custom scenario on the right,
          to see the source event animate.
        </div>
      )}
    </>
  );
}
