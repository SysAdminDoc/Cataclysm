import { useEffect, type RefObject } from "react";
import * as Cesium from "cesium";
import type { FireballEvent } from "../types/jpl";
import { WW3_SIDE_COLORS, type Ww3ExchangePlan, type Ww3TargetType } from "../lib/ww3";
import { mirvSpreadCircle, type MirvPreview } from "../lib/mirv";
import type { HumanitarianFacility, HumanitarianFacilityCategory } from "../lib/osm-facilities";

function removePrimitives(viewer: Cesium.Viewer, collections: readonly Cesium.PrimitiveCollection[]) {
  if (viewer.isDestroyed()) return;
  for (const collection of collections) viewer.scene.primitives.remove(collection);
  viewer.scene.requestRender();
}

export function installFireballOverlay(viewer: Cesium.Viewer, fireballs: readonly FireballEvent[]) {
  if (viewer.isDestroyed() || fireballs.length === 0) return undefined;
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
  return () => removePrimitives(viewer, [points]);
}

export function installExchangeOverlay(viewer: Cesium.Viewer, plan: Ww3ExchangePlan | null | undefined) {
  if (viewer.isDestroyed() || !plan) return undefined;
  const targetColors: Record<Ww3TargetType, string> = {
    icbm: "#f38ba8",
    sub: "#89b4fa",
    bomber: "#cba6f7",
    c2: "#f9e2af",
    nuclear: "#fab387",
    military: "#94e2d5",
    infra: "#74c7ec",
    city: "#f5c2e7",
  };
  const targets = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
  const arcs = viewer.scene.primitives.add(new Cesium.PolylineCollection());
  const seenTargets = new Set<string>();
  for (const strike of plan.strikes) {
    arcs.add({
      id: `ww3-arc:${strike.id}`,
      positions: strike.arc.map((point) => Cesium.Cartesian3.fromDegrees(point.lon, point.lat, point.altitudeM)),
      width: 1.25,
      material: Cesium.Material.fromType("Color", {
        color: Cesium.Color.fromCssColorString(WW3_SIDE_COLORS[strike.attacker]).withAlpha(0.38),
      }),
    });
    if (seenTargets.has(strike.target.id)) continue;
    seenTargets.add(strike.target.id);
    targets.add({
      id: `ww3-target:${strike.target.id}`,
      position: Cesium.Cartesian3.fromDegrees(strike.target.lon, strike.target.lat, 1_000),
      pixelSize: strike.target.type === "city" ? 6 : 4,
      color: Cesium.Color.fromCssColorString(targetColors[strike.target.type]).withAlpha(0.82),
      outlineColor: Cesium.Color.fromCssColorString("#11111b"),
      outlineWidth: 1,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
  }
  viewer.scene.requestRender();
  return () => removePrimitives(viewer, [arcs, targets]);
}

export function installMirvOverlay(viewer: Cesium.Viewer, preview: MirvPreview | null | undefined) {
  if (viewer.isDestroyed() || !preview) return undefined;
  const points = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
  for (const point of preview.points) {
    points.add({
      id: `mirv:${point.id}`,
      position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat, 750),
      pixelSize: 10,
      color: Cesium.Color.fromCssColorString("#f38ba8").withAlpha(0.52),
      outlineColor: Cesium.Color.fromCssColorString("#f5e0dc"),
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
  }
  const boundary = viewer.scene.primitives.add(new Cesium.PolylineCollection());
  boundary.add({
    id: `mirv-spread:${preview.id}`,
    positions: mirvSpreadCircle(preview).map((point) => Cesium.Cartesian3.fromDegrees(point.lon, point.lat, 500)),
    width: 1.5,
    material: Cesium.Material.fromType("PolylineDash", {
      color: Cesium.Color.fromCssColorString("#f38ba8").withAlpha(0.7),
      dashLength: 14,
    }),
  });
  viewer.scene.requestRender();
  return () => removePrimitives(viewer, [boundary, points]);
}

export function installHumanitarianFacilityOverlay(
  viewer: Cesium.Viewer,
  facilities: readonly HumanitarianFacility[],
  opacity = 1,
  order = 12,
) {
  if (viewer.isDestroyed() || facilities.length === 0) return undefined;
  const colors: Record<HumanitarianFacilityCategory, string> = {
    school: "#89b4fa",
    health: "#a6e3a1",
    emergency: "#fab387",
  };
  const points = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
  for (const facility of facilities) {
    points.add({
      id: `osm-facility:${facility.id}`,
      position: Cesium.Cartesian3.fromDegrees(facility.lon, facility.lat, 90 + Math.max(0, 12 - order) * 20),
      pixelSize: facility.category === "health" ? 9 : 8,
      color: Cesium.Color.fromCssColorString(colors[facility.category]).withAlpha(0.92 * opacity),
      outlineColor: Cesium.Color.fromCssColorString("#11111b").withAlpha(opacity),
      outlineWidth: 1.5,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      scaleByDistance: new Cesium.NearFarScalar(25_000, 1.25, 8_000_000, 0.55),
    });
  }
  viewer.scene.requestRender();
  return () => removePrimitives(viewer, [points]);
}

export function useStrategicGlobeOverlays({
  viewerRef,
  viewerEpoch,
  fireballs,
  ww3Plan,
  mirvPreview,
  humanitarianFacilities,
  humanitarianOpacity = 1,
  humanitarianOrder = 0,
}: {
  viewerRef: RefObject<Cesium.Viewer | null>;
  viewerEpoch: number;
  fireballs: readonly FireballEvent[];
  ww3Plan?: Ww3ExchangePlan | null;
  mirvPreview?: MirvPreview | null;
  humanitarianFacilities?: readonly HumanitarianFacility[];
  humanitarianOpacity?: number;
  humanitarianOrder?: number;
}) {
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    return installFireballOverlay(viewer, fireballs);
  }, [fireballs, viewerEpoch, viewerRef]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    return installExchangeOverlay(viewer, ww3Plan);
  }, [viewerEpoch, viewerRef, ww3Plan]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    return installMirvOverlay(viewer, mirvPreview);
  }, [mirvPreview, viewerEpoch, viewerRef]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    return installHumanitarianFacilityOverlay(viewer, humanitarianFacilities ?? [], humanitarianOpacity, humanitarianOrder);
  }, [humanitarianFacilities, humanitarianOpacity, humanitarianOrder, viewerEpoch, viewerRef]);
}
