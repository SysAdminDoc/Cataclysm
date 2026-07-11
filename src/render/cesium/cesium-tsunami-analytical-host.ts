import * as Cesium from "cesium";
import type {
  AnalyticalGeoPosition,
  DartBuoyDescriptor,
  IsochroneLabelDescriptor,
  IsochronePolylineDescriptor,
  TsunamiAnalyticalEntityDescriptor,
  TsunamiAnalyticalEntityHost,
  WavefrontRingDescriptor,
} from "./tsunami-analytical-host";

function cartesian(position: AnalyticalGeoPosition): Cesium.Cartesian3 {
  return Cesium.Cartesian3.fromDegrees(position.lon_deg, position.lat_deg, position.height_m);
}

function polylinePositions(positions: readonly AnalyticalGeoPosition[]): Cesium.Cartesian3[] {
  const degrees: number[] = [];
  for (const position of positions) degrees.push(position.lon_deg, position.lat_deg, position.height_m);
  return Cesium.Cartesian3.fromDegreesArrayHeights(degrees);
}

function color(css: string, alpha = 1): Cesium.Color {
  return Cesium.Color.fromCssColorString(css).withAlpha(alpha);
}

/** Concrete adapter from analytical descriptors to stable Cesium Entity handles. */
export class CesiumTsunamiAnalyticalHost implements TsunamiAnalyticalEntityHost<Cesium.Entity> {
  readonly #viewer: Cesium.Viewer;
  readonly #kinds = new WeakMap<Cesium.Entity, TsunamiAnalyticalEntityDescriptor["kind"]>();

  constructor(viewer: Cesium.Viewer) {
    this.#viewer = viewer;
  }

  createEntity(_key: string, descriptor: TsunamiAnalyticalEntityDescriptor): Cesium.Entity {
    this.#requireViewer();
    const entity = descriptor.kind === "wavefront_ring"
      ? this.#createWavefront(descriptor)
      : descriptor.kind === "isochrone_polyline"
        ? this.#createIsochronePolyline(descriptor)
        : descriptor.kind === "isochrone_label"
          ? this.#createIsochroneLabel(descriptor)
          : this.#createDartBuoy(descriptor);
    this.#kinds.set(entity, descriptor.kind);
    return entity;
  }

  updateEntity(entity: Cesium.Entity, descriptor: TsunamiAnalyticalEntityDescriptor): void {
    this.#requireViewer();
    const kind = this.#kinds.get(entity);
    if (kind !== descriptor.kind) {
      throw new Error(`Cannot update Cesium analytical entity kind ${String(kind)} as ${descriptor.kind}.`);
    }
    if (!this.#viewer.entities.contains(entity)) {
      throw new Error("Cannot update a Cesium analytical entity that is no longer owned by the viewer.");
    }
    if (descriptor.kind === "wavefront_ring") this.#updateWavefront(entity, descriptor);
    else if (descriptor.kind === "isochrone_polyline") this.#updateIsochronePolyline(entity, descriptor);
    else if (descriptor.kind === "isochrone_label") this.#updateIsochroneLabel(entity, descriptor);
    else this.#updateDartBuoy(entity, descriptor);
  }

  removeEntity(entity: Cesium.Entity): void {
    if (this.#viewer.isDestroyed()) return;
    if (this.#viewer.entities.contains(entity)) this.#viewer.entities.remove(entity);
    this.#kinds.delete(entity);
  }

  requestRender(): void {
    if (!this.#viewer.isDestroyed()) this.#viewer.scene.requestRender();
  }

  #requireViewer(): void {
    if (this.#viewer.isDestroyed()) throw new Error("Cannot mutate a destroyed Cesium viewer.");
  }

  #createWavefront(descriptor: WavefrontRingDescriptor): Cesium.Entity {
    return this.#viewer.entities.add({
      position: cartesian(descriptor.position),
      ellipse: {
        semiMajorAxis: descriptor.semi_major_axis_m,
        semiMinorAxis: descriptor.semi_minor_axis_m,
        material: color(descriptor.fill_css, descriptor.fill_alpha),
        outline: true,
        outlineColor: color(descriptor.outline_css, descriptor.outline_alpha),
        height: descriptor.position.height_m,
      },
    });
  }

  #updateWavefront(entity: Cesium.Entity, descriptor: WavefrontRingDescriptor): void {
    if (!entity.ellipse) throw new Error("Wavefront entity has no ellipse graphics.");
    entity.position = new Cesium.ConstantPositionProperty(cartesian(descriptor.position));
    entity.ellipse.semiMajorAxis = new Cesium.ConstantProperty(descriptor.semi_major_axis_m);
    entity.ellipse.semiMinorAxis = new Cesium.ConstantProperty(descriptor.semi_minor_axis_m);
    entity.ellipse.material = new Cesium.ColorMaterialProperty(color(descriptor.fill_css, descriptor.fill_alpha));
    entity.ellipse.outline = new Cesium.ConstantProperty(true);
    entity.ellipse.outlineColor = new Cesium.ConstantProperty(color(descriptor.outline_css, descriptor.outline_alpha));
    entity.ellipse.height = new Cesium.ConstantProperty(descriptor.position.height_m);
  }

  #createIsochronePolyline(descriptor: IsochronePolylineDescriptor): Cesium.Entity {
    return this.#viewer.entities.add({
      polyline: {
        positions: polylinePositions(descriptor.positions),
        width: descriptor.width_px,
        material: new Cesium.PolylineDashMaterialProperty({
          color: color(descriptor.color_css, descriptor.alpha),
          dashLength: descriptor.dash_length_px,
        }),
        clampToGround: descriptor.clamp_to_ground,
      },
    });
  }

  #updateIsochronePolyline(entity: Cesium.Entity, descriptor: IsochronePolylineDescriptor): void {
    if (!entity.polyline) throw new Error("Isochrone entity has no polyline graphics.");
    entity.polyline.positions = new Cesium.ConstantProperty(polylinePositions(descriptor.positions));
    entity.polyline.width = new Cesium.ConstantProperty(descriptor.width_px);
    entity.polyline.material = new Cesium.PolylineDashMaterialProperty({
      color: color(descriptor.color_css, descriptor.alpha),
      dashLength: descriptor.dash_length_px,
    });
    entity.polyline.clampToGround = new Cesium.ConstantProperty(descriptor.clamp_to_ground);
  }

  #createIsochroneLabel(descriptor: IsochroneLabelDescriptor): Cesium.Entity {
    return this.#viewer.entities.add({
      position: cartesian(descriptor.position),
      label: {
        text: descriptor.text,
        font: descriptor.font,
        fillColor: color(descriptor.fill_css),
        outlineColor: color(descriptor.outline_css, descriptor.outline_alpha),
        outlineWidth: descriptor.outline_width_px,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        scale: descriptor.scale,
        disableDepthTestDistance: descriptor.disable_depth_test_distance_m,
      },
    });
  }

  #updateIsochroneLabel(entity: Cesium.Entity, descriptor: IsochroneLabelDescriptor): void {
    if (!entity.label) throw new Error("Isochrone label entity has no label graphics.");
    entity.position = new Cesium.ConstantPositionProperty(cartesian(descriptor.position));
    entity.label.text = new Cesium.ConstantProperty(descriptor.text);
    entity.label.font = new Cesium.ConstantProperty(descriptor.font);
    entity.label.fillColor = new Cesium.ConstantProperty(color(descriptor.fill_css));
    entity.label.outlineColor = new Cesium.ConstantProperty(color(descriptor.outline_css, descriptor.outline_alpha));
    entity.label.outlineWidth = new Cesium.ConstantProperty(descriptor.outline_width_px);
    entity.label.style = new Cesium.ConstantProperty(Cesium.LabelStyle.FILL_AND_OUTLINE);
    entity.label.scale = new Cesium.ConstantProperty(descriptor.scale);
    entity.label.disableDepthTestDistance = new Cesium.ConstantProperty(descriptor.disable_depth_test_distance_m);
  }

  #createDartBuoy(descriptor: DartBuoyDescriptor): Cesium.Entity {
    return this.#viewer.entities.add({
      name: descriptor.name,
      position: cartesian(descriptor.position),
      point: {
        pixelSize: descriptor.pixel_size,
        color: color(descriptor.fill_css),
        outlineColor: color(descriptor.outline_css),
        outlineWidth: descriptor.outline_width_px,
      },
      label: {
        text: descriptor.label,
        font: descriptor.label_font,
        fillColor: color(descriptor.fill_css),
        outlineColor: color(descriptor.outline_css),
        outlineWidth: descriptor.outline_width_px,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.TOP,
        pixelOffset: new Cesium.Cartesian2(...descriptor.label_pixel_offset),
        scale: descriptor.label_scale,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(
          descriptor.distance_display_min_m,
          descriptor.distance_display_max_m,
        ),
      },
    });
  }

  #updateDartBuoy(entity: Cesium.Entity, descriptor: DartBuoyDescriptor): void {
    if (!entity.point || !entity.label) throw new Error("DART entity is missing point or label graphics.");
    entity.name = descriptor.name;
    entity.position = new Cesium.ConstantPositionProperty(cartesian(descriptor.position));
    entity.point.pixelSize = new Cesium.ConstantProperty(descriptor.pixel_size);
    entity.point.color = new Cesium.ConstantProperty(color(descriptor.fill_css));
    entity.point.outlineColor = new Cesium.ConstantProperty(color(descriptor.outline_css));
    entity.point.outlineWidth = new Cesium.ConstantProperty(descriptor.outline_width_px);
    entity.label.text = new Cesium.ConstantProperty(descriptor.label);
    entity.label.font = new Cesium.ConstantProperty(descriptor.label_font);
    entity.label.fillColor = new Cesium.ConstantProperty(color(descriptor.fill_css));
    entity.label.outlineColor = new Cesium.ConstantProperty(color(descriptor.outline_css));
    entity.label.outlineWidth = new Cesium.ConstantProperty(descriptor.outline_width_px);
    entity.label.style = new Cesium.ConstantProperty(Cesium.LabelStyle.FILL_AND_OUTLINE);
    entity.label.verticalOrigin = new Cesium.ConstantProperty(Cesium.VerticalOrigin.TOP);
    entity.label.pixelOffset = new Cesium.ConstantProperty(new Cesium.Cartesian2(...descriptor.label_pixel_offset));
    entity.label.scale = new Cesium.ConstantProperty(descriptor.label_scale);
    entity.label.distanceDisplayCondition = new Cesium.ConstantProperty(
      new Cesium.DistanceDisplayCondition(descriptor.distance_display_min_m, descriptor.distance_display_max_m),
    );
  }
}
