import * as Cesium from "cesium";

import type {
  StaticHazardEntityDescriptor,
  StaticHazardEntityHost,
} from "./static-hazard-host";
import { terrainEllipsePositions } from "./terrain-overlay-geometry";

function color(css: string, alpha = 1): Cesium.Color {
  return Cesium.Color.fromCssColorString(css).withAlpha(alpha);
}

function position(latDeg: number, lonDeg: number, heightM = 0): Cesium.Cartesian3 {
  return Cesium.Cartesian3.fromDegrees(lonDeg, latDeg, heightM);
}

function applyDescriptor(
  entity: Cesium.Entity,
  descriptor: StaticHazardEntityDescriptor,
  deterministicCapture: boolean,
): void {
  entity.name = descriptor.kind === "ground_zero" ? "Ground zero" : descriptor.name;
  entity.description = new Cesium.ConstantProperty(
    descriptor.kind === "ground_zero" ? descriptor.label : descriptor.description,
  );
  entity.ellipse = undefined;
  entity.point = undefined;
  entity.label = undefined;
  entity.polygon = undefined;
  entity.polyline = undefined;

  if (descriptor.kind === "hazard_ring") {
    entity.position = new Cesium.ConstantPositionProperty(
      position(descriptor.position.lat_deg, descriptor.position.lon_deg, descriptor.position.height_m),
    );
    entity.ellipse = new Cesium.EllipseGraphics({
      semiMajorAxis: descriptor.semi_major_axis_m,
      semiMinorAxis: descriptor.semi_minor_axis_m,
      material: color(descriptor.fill_css, descriptor.fill_alpha),
      outline: false,
      outlineColor: color(descriptor.outline_css, descriptor.outline_alpha),
      outlineWidth: descriptor.outline_width_px,
      classificationType: Cesium.ClassificationType.TERRAIN,
    });
    entity.polyline = new Cesium.PolylineGraphics({
      positions: terrainEllipsePositions(
        descriptor.position.lat_deg,
        descriptor.position.lon_deg,
        descriptor.semi_major_axis_m,
        descriptor.semi_minor_axis_m,
      ),
      width: descriptor.outline_width_px,
      material: color(descriptor.outline_css, descriptor.outline_alpha),
      clampToGround: true,
      classificationType: Cesium.ClassificationType.TERRAIN,
    });
    return;
  }

  if (descriptor.kind === "ground_zero") {
    entity.position = new Cesium.ConstantPositionProperty(
      position(descriptor.position.lat_deg, descriptor.position.lon_deg, descriptor.position.height_m),
    );
    entity.point = new Cesium.PointGraphics({
      pixelSize: descriptor.pixel_size,
      color: color(descriptor.fill_css, descriptor.fill_alpha),
      outlineColor: color(descriptor.outline_css, descriptor.outline_alpha),
      outlineWidth: descriptor.outline_width_px,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: deterministicCapture ? Number.POSITIVE_INFINITY : 0,
    });
    // Cesium rasterizes label glyphs into a GPU atlas. Font hinting differs
    // across otherwise equivalent Windows runners, so the locked reference
    // frame uses the semantic entity name plus a depth-independent point and
    // excludes only this decorative text atlas.
    entity.label = deterministicCapture ? undefined : new Cesium.LabelGraphics({
      text: descriptor.label,
      font: "11px Inter, sans-serif",
      fillColor: color("#cdd6f4"),
      outlineColor: color("#11111b"),
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -14),
      showBackground: true,
      backgroundColor: color("#1e1e2e", 0.85),
      backgroundPadding: new Cesium.Cartesian2(6, 4),
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: deterministicCapture ? Number.POSITIVE_INFINITY : 0,
    });
    return;
  }

  entity.position = undefined;
  entity.polygon = new Cesium.PolygonGraphics({
    hierarchy: new Cesium.PolygonHierarchy(
      descriptor.points.map((point) => position(point.lat_deg, point.lon_deg, point.height_m)),
    ),
    material: color(descriptor.fill_css, descriptor.fill_alpha),
    outline: false,
    outlineColor: color(descriptor.outline_css, descriptor.outline_alpha),
    classificationType: Cesium.ClassificationType.TERRAIN,
    perPositionHeight: false,
  });
  entity.polyline = new Cesium.PolylineGraphics({
    positions: [
      ...descriptor.points.map((point) => position(point.lat_deg, point.lon_deg)),
      ...(descriptor.points[0] ? [position(descriptor.points[0].lat_deg, descriptor.points[0].lon_deg)] : []),
    ],
    width: 2,
    material: color(descriptor.outline_css, descriptor.outline_alpha),
    clampToGround: true,
    classificationType: Cesium.ClassificationType.TERRAIN,
  });
}

export class CesiumStaticHazardHost implements StaticHazardEntityHost<Cesium.Entity> {
  readonly #viewer: Cesium.Viewer;
  readonly #deterministicCapture: boolean;

  constructor(viewer: Cesium.Viewer, deterministicCapture = false) {
    this.#viewer = viewer;
    this.#deterministicCapture = deterministicCapture;
  }

  createEntity(key: string, descriptor: StaticHazardEntityDescriptor): Cesium.Entity {
    const entity = this.#viewer.entities.add({ id: `static-hazard:${key}` });
    applyDescriptor(entity, descriptor, this.#deterministicCapture);
    return entity;
  }

  updateEntity(entity: Cesium.Entity, descriptor: StaticHazardEntityDescriptor): void {
    applyDescriptor(entity, descriptor, this.#deterministicCapture);
  }

  removeEntity(entity: Cesium.Entity): void {
    if (!this.#viewer.isDestroyed()) this.#viewer.entities.remove(entity);
  }

  requestRender(): void {
    if (!this.#viewer.isDestroyed()) this.#viewer.scene.requestRender();
  }
}
