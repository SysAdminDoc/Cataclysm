import { useEffect, type RefObject } from "react";
import * as Cesium from "cesium";

import { referenceCaptureEnabled } from "../lib/reference-capture";
import type { RunupAtPointResult } from "../lib/tauri";
import type { EffectRing, GeoPoint } from "../hazards/types";
import type { RendererNeutralFrameView } from "../types/render-protocol";
import type { DartBuoy, Gauge, InitialDisplacement, Isochrone, PropagationSnapshot } from "../types/scenario";
import { commitReferenceFrame } from "../render/cesium/reference-frame-commit";
import type { DirectEffectsController } from "../render/cesium/direct-effects";
import type { OutcomeFocusController, OutcomeFocusRequest } from "../render/cesium/outcome-focus";
import type { RunupOverlayController } from "../render/cesium/runup-overlay-controller";
import type { CesiumTerrainEntityGroup } from "../render/cesium/cesium-runup-overlay-host";
import type { StaticHazardController } from "../render/cesium/static-hazards";
import type { TsunamiAnalyticalController } from "../render/cesium/tsunami-analytical";
import type { TsunamiSourceController } from "../render/cesium/tsunami-source";
import type { ViewerLifecycle } from "../render/cesium/viewer-lifecycle";
import { formatLength, quantityText, type UnitSystem } from "../lib/units";

type PreviewCamera = Readonly<{
  targetLat: number;
  targetLon: number;
  rangeM: number;
  headingDeg: number;
  pitchDeg: number;
}>;

type RunupController = RunupOverlayController<
  CesiumTerrainEntityGroup,
  CesiumTerrainEntityGroup,
  CesiumTerrainEntityGroup,
  Cesium.Entity
>;

type ControllerRefs = Readonly<{
  viewerRef: RefObject<Cesium.Viewer | null>;
  viewerLifecycleRef: RefObject<ViewerLifecycle<Cesium.Viewer> | null>;
  tsunamiSourceControllerRef: RefObject<TsunamiSourceController<Cesium.Entity> | null>;
  staticHazardControllerRef: RefObject<StaticHazardController<Cesium.Entity> | null>;
  outcomeFocusControllerRef: RefObject<OutcomeFocusController | null>;
  directEffectsControllerRef: RefObject<DirectEffectsController<Cesium.Entity> | null>;
  tsunamiAnalyticalControllerRef: RefObject<TsunamiAnalyticalController<Cesium.Entity> | null>;
  runupOverlayControllerRef: RefObject<RunupController | null>;
}>;

type ControllerState = Readonly<{
  viewerEpoch: number;
  initial: InitialDisplacement | null;
  hazardRings?: EffectRing[] | null;
  hazardCenter?: GeoPoint | null;
  hazardPolygons?: { label: string; color: string; points: GeoPoint[] }[] | null;
  previewCamera?: PreviewCamera | null;
  outcomeFocus?: OutcomeFocusRequest | null;
  impactKind?: "asteroid" | "nuclear" | null;
  directRenderFrame: RendererNeutralFrameView | null;
  wavefront: PropagationSnapshot | null;
  isochrones?: Isochrone[] | null;
  dartBuoys?: DartBuoy[];
  runupResults?: RunupAtPointResult[];
  gauges?: Gauge[];
  layerOpacity?: Readonly<{
    source: number;
    wavefront: number;
    isochrones: number;
    runup: number;
    dart: number;
    hazardRings: number;
    fallout: number;
  }>;
  showDirectSource?: boolean;
  layerOrder?: Readonly<{
    source: number;
    wavefront: number;
    isochrones: number;
    dart: number;
    hazardRings: number;
    fallout: number;
  }>;
  unitSystem: UnitSystem;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
}>;

export function useGlobeControllerSync(refs: ControllerRefs, state: ControllerState) {
  const {
    viewerRef,
    viewerLifecycleRef,
    tsunamiSourceControllerRef,
    staticHazardControllerRef,
    outcomeFocusControllerRef,
    directEffectsControllerRef,
    tsunamiAnalyticalControllerRef,
    runupOverlayControllerRef,
  } = refs;
  const {
    viewerEpoch,
    initial,
    hazardRings,
    hazardCenter,
    hazardPolygons,
    previewCamera,
    outcomeFocus,
    impactKind,
    directRenderFrame,
    wavefront,
    isochrones,
    dartBuoys,
    runupResults,
    gauges,
    layerOpacity,
    showDirectSource,
    layerOrder,
    unitSystem,
    formatNumber,
  } = state;

  useEffect(() => {
    tsunamiSourceControllerRef.current?.update({
      source: initial ? {
        ...initial,
        display_peak_amplitude: quantityText(formatLength(initial.peak_amplitude_m, formatNumber, unitSystem)),
      } : null,
      reference_capture: referenceCaptureEnabled(),
      reduced_motion:
        typeof window !== "undefined"
        && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
      suppress_camera_focus: outcomeFocus !== null && outcomeFocus !== undefined,
      layer_opacity: layerOpacity?.source,
      layer_order: layerOrder?.source,
    });
  }, [formatNumber, initial, layerOpacity?.source, layerOrder?.source, outcomeFocus, tsunamiSourceControllerRef, unitSystem, viewerEpoch]);

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
      show_source: showDirectSource,
      source_opacity: layerOpacity?.source,
      ring_opacity: layerOpacity?.hazardRings,
      fallout_opacity: layerOpacity?.fallout,
      source_order: layerOrder?.source,
      ring_order: layerOrder?.hazardRings,
      fallout_order: layerOrder?.fallout,
    });

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
          Math.max(outerRadius * 3.2, 20_000),
        ),
      },
    );
  }, [hazardCenter, hazardPolygons, hazardRings, layerOpacity?.fallout, layerOpacity?.hazardRings, layerOpacity?.source, layerOrder?.fallout, layerOrder?.hazardRings, layerOrder?.source, showDirectSource, staticHazardControllerRef, viewerEpoch, viewerRef]);

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
  }, [previewCamera, viewerEpoch, viewerLifecycleRef, viewerRef]);

  useEffect(() => {
    outcomeFocusControllerRef.current?.update(outcomeFocus ?? null, {
      reference_capture: referenceCaptureEnabled(),
      reduced_motion:
        typeof window !== "undefined"
        && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
    });
  }, [outcomeFocus, outcomeFocusControllerRef, viewerEpoch]);

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
  }, [directEffectsControllerRef, directRenderFrame, impactKind, viewerEpoch, viewerRef]);

  useEffect(() => {
    tsunamiAnalyticalControllerRef.current?.update({
      source_center: initial
        ? { lat_deg: initial.center.lat_deg, lon_deg: initial.center.lon_deg }
        : null,
      wavefront,
      isochrones: isochrones ?? [],
      dart_buoys: dartBuoys ?? [],
      wavefront_opacity: layerOpacity?.wavefront,
      isochrone_opacity: layerOpacity?.isochrones,
      dart_opacity: layerOpacity?.dart,
      wavefront_order: layerOrder?.wavefront,
      isochrone_order: layerOrder?.isochrones,
      dart_order: layerOrder?.dart,
    });
  }, [dartBuoys, initial, isochrones, layerOpacity?.dart, layerOpacity?.isochrones, layerOpacity?.wavefront, layerOrder?.dart, layerOrder?.isochrones, layerOrder?.wavefront, tsunamiAnalyticalControllerRef, viewerEpoch, wavefront]);

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
        display_runup: quantityText(formatLength(result.runup_m, formatNumber, unitSystem)),
        display_offshore: quantityText(formatLength(result.offshore_amplitude_m, formatNumber, unitSystem)),
      })),
      (gauges ?? []).map((gauge) => ({
        id: gauge.id,
        name: gauge.name,
        lat: gauge.lat_deg,
        lon: gauge.lon_deg,
      })),
      layerOpacity?.runup,
      layerOpacity?.runup,
    );
  }, [formatNumber, gauges, layerOpacity?.runup, runupOverlayControllerRef, runupResults, unitSystem, viewerEpoch]);
}
