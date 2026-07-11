import * as Cesium from "cesium";

import type {
  StaticHazardEntityDescriptor,
  StaticHazardEntityHost,
} from "./static-hazard-host";

function color(css: string, alpha = 1): Cesium.Color {
  return Cesium.Color.fromCssColorString(css).withAlpha(alpha);
}

function position(latDeg: number, lonDeg: number): Cesium.Cartesian3 {
  return Cesium.Cartesian3.fromDegrees(lonDeg, latDeg, 0);
}

function applyDescriptor(entity: Cesium.Entity, descriptor: StaticHazardEntityDescriptor): void {
  entity.name = descriptor.kind === "ground_zero" ? "Ground zero" : descriptor.name;
  entity.description = new Cesium.ConstantProperty(
    descriptor.kind === "ground_zero" ? descriptor.label : descriptor.description,
  );
  entity.ellipse = undefined;
  entity.point = undefined;
  entity.label = undefined;
  entity.polygon = undefined;

  if (descriptor.kind === "hazard_ring") {
    entity.position = new Cesium.ConstantPositionProperty(
      position(descriptor.position.lat_deg, descriptor.position.lon_deg),
    );
    entity.ellipse = new Cesium.EllipseGraphics({
      semiMajorAxis: descriptor.semi_major_axis_m,
      semiMinorAxis: descriptor.semi_minor_axis_m,
      material: color(descriptor.fill_css, descriptor.fill_alpha),
      outline: true,
      outlineColor: color(descriptor.outline_css, descriptor.outline_alpha),
      outlineWidth: descriptor.outline_width_px,
      height: 0,
    });
    return;
  }

  if (descriptor.kind === "ground_zero") {
    entity.position = new Cesium.ConstantPositionProperty(
      position(descriptor.position.lat_deg, descriptor.position.lon_deg),
    );
    entity.point = new Cesium.PointGraphics({
      pixelSize: descriptor.pixel_size,
      color: color(descriptor.fill_css),
      outlineColor: color(descriptor.outline_css),
      outlineWidth: descriptor.outline_width_px,
    });
    entity.label = new Cesium.LabelGraphics({
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
    });
    return;
  }

  entity.position = undefined;
  entity.polygon = new Cesium.PolygonGraphics({
    hierarchy: new Cesium.PolygonHierarchy(
      descriptor.points.map((point) => position(point.lat_deg, point.lon_deg)),
    ),
    material: color(descriptor.fill_css, descriptor.fill_alpha),
    outline: true,
    outlineColor: color(descriptor.outline_css, descriptor.outline_alpha),
    height: 0,
  });
}

export class CesiumStaticHazardHost implements StaticHazardEntityHost<Cesium.Entity> {
  readonly #viewer: Cesium.Viewer;

  constructor(viewer: Cesium.Viewer) {
    this.#viewer = viewer;
  }

  createEntity(key: string, descriptor: StaticHazardEntityDescriptor): Cesium.Entity {
    const entity = this.#viewer.entities.add({ id: `static-hazard:${key}` });
    applyDescriptor(entity, descriptor);
    return entity;
  }

  updateEntity(entity: Cesium.Entity, descriptor: StaticHazardEntityDescriptor): void {
    applyDescriptor(entity, descriptor);
  }

  removeEntity(entity: Cesium.Entity): void {
    if (!this.#viewer.isDestroyed()) this.#viewer.entities.remove(entity);
  }

  requestRender(): void {
    if (!this.#viewer.isDestroyed()) this.#viewer.scene.requestRender();
  }
}
