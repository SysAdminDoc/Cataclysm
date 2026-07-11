import * as Cesium from "cesium";
import type {
  SourceCameraTarget,
  SourceGeoPosition,
  ThemeColorReference,
  TsunamiSourceEntityDescriptor,
  TsunamiSourceHost,
} from "./tsunami-source-host";

function position(value: SourceGeoPosition): Cesium.Cartesian3 {
  return Cesium.Cartesian3.fromDegrees(value.lon_deg, value.lat_deg, value.height_m);
}

function themeColor(reference: ThemeColorReference): Cesium.Color {
  const resolved = typeof document === "undefined"
    ? ""
    : getComputedStyle(document.documentElement).getPropertyValue(reference.token).trim();
  return Cesium.Color.fromCssColorString(resolved || reference.fallback_css).withAlpha(reference.alpha);
}

/** Concrete Cesium adapter for the lifecycle-owned tsunami source controller. */
export class CesiumTsunamiSourceHost implements TsunamiSourceHost<Cesium.Entity> {
  readonly #viewer: Cesium.Viewer;
  readonly #owned = new WeakSet<Cesium.Entity>();

  constructor(viewer: Cesium.Viewer) {
    this.#viewer = viewer;
  }

  createSourceEntity(descriptor: TsunamiSourceEntityDescriptor): Cesium.Entity {
    this.#requireViewer();
    const entity = this.#viewer.entities.add({
      name: descriptor.name,
      position: position(descriptor.position),
      point: {
        pixelSize: descriptor.point.pixel_size,
        color: themeColor(descriptor.point.fill),
        outlineColor: themeColor(descriptor.point.outline),
        outlineWidth: descriptor.point.outline_width_px,
      },
      cylinder: {
        length: descriptor.cavity.length_m,
        topRadius: descriptor.cavity.top_radius_m,
        bottomRadius: descriptor.cavity.bottom_radius_m,
        material: themeColor(descriptor.cavity.fill),
        outline: true,
        outlineColor: themeColor(descriptor.cavity.outline),
      },
      ellipse: {
        semiMajorAxis: descriptor.rim.semi_major_axis_m,
        semiMinorAxis: descriptor.rim.semi_minor_axis_m,
        material: themeColor(descriptor.rim.fill),
        outline: true,
        outlineColor: themeColor(descriptor.rim.outline),
        height: descriptor.rim.height_m,
      },
      label: {
        text: descriptor.label.text,
        font: descriptor.label.font,
        fillColor: themeColor(descriptor.label.fill),
        outlineColor: themeColor(descriptor.label.outline),
        outlineWidth: descriptor.label.outline_width_px,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(...descriptor.label.pixel_offset),
        showBackground: descriptor.label.show_background,
        backgroundColor: themeColor(descriptor.label.background),
        backgroundPadding: new Cesium.Cartesian2(...descriptor.label.background_padding),
      },
    });
    this.#owned.add(entity);
    return entity;
  }

  updateSourceEntity(entity: Cesium.Entity, descriptor: TsunamiSourceEntityDescriptor): void {
    this.#requireOwned(entity);
    if (!entity.point || !entity.cylinder || !entity.ellipse || !entity.label) {
      throw new Error("Cesium tsunami source entity is missing required graphics.");
    }
    entity.name = descriptor.name;
    entity.position = new Cesium.ConstantPositionProperty(position(descriptor.position));

    entity.point.pixelSize = new Cesium.ConstantProperty(descriptor.point.pixel_size);
    entity.point.color = new Cesium.ConstantProperty(themeColor(descriptor.point.fill));
    entity.point.outlineColor = new Cesium.ConstantProperty(themeColor(descriptor.point.outline));
    entity.point.outlineWidth = new Cesium.ConstantProperty(descriptor.point.outline_width_px);

    entity.cylinder.length = new Cesium.ConstantProperty(descriptor.cavity.length_m);
    entity.cylinder.topRadius = new Cesium.ConstantProperty(descriptor.cavity.top_radius_m);
    entity.cylinder.bottomRadius = new Cesium.ConstantProperty(descriptor.cavity.bottom_radius_m);
    entity.cylinder.material = new Cesium.ColorMaterialProperty(themeColor(descriptor.cavity.fill));
    entity.cylinder.outline = new Cesium.ConstantProperty(true);
    entity.cylinder.outlineColor = new Cesium.ConstantProperty(themeColor(descriptor.cavity.outline));

    entity.ellipse.semiMajorAxis = new Cesium.ConstantProperty(descriptor.rim.semi_major_axis_m);
    entity.ellipse.semiMinorAxis = new Cesium.ConstantProperty(descriptor.rim.semi_minor_axis_m);
    entity.ellipse.material = new Cesium.ColorMaterialProperty(themeColor(descriptor.rim.fill));
    entity.ellipse.outline = new Cesium.ConstantProperty(true);
    entity.ellipse.outlineColor = new Cesium.ConstantProperty(themeColor(descriptor.rim.outline));
    entity.ellipse.height = new Cesium.ConstantProperty(descriptor.rim.height_m);

    entity.label.text = new Cesium.ConstantProperty(descriptor.label.text);
    entity.label.font = new Cesium.ConstantProperty(descriptor.label.font);
    entity.label.fillColor = new Cesium.ConstantProperty(themeColor(descriptor.label.fill));
    entity.label.outlineColor = new Cesium.ConstantProperty(themeColor(descriptor.label.outline));
    entity.label.outlineWidth = new Cesium.ConstantProperty(descriptor.label.outline_width_px);
    entity.label.style = new Cesium.ConstantProperty(Cesium.LabelStyle.FILL_AND_OUTLINE);
    entity.label.verticalOrigin = new Cesium.ConstantProperty(Cesium.VerticalOrigin.BOTTOM);
    entity.label.pixelOffset = new Cesium.ConstantProperty(new Cesium.Cartesian2(...descriptor.label.pixel_offset));
    entity.label.showBackground = new Cesium.ConstantProperty(descriptor.label.show_background);
    entity.label.backgroundColor = new Cesium.ConstantProperty(themeColor(descriptor.label.background));
    entity.label.backgroundPadding = new Cesium.ConstantProperty(
      new Cesium.Cartesian2(...descriptor.label.background_padding),
    );
  }

  removeSourceEntity(entity: Cesium.Entity): void {
    if (this.#viewer.isDestroyed()) return;
    if (this.#viewer.entities.contains(entity)) this.#viewer.entities.remove(entity);
    this.#owned.delete(entity);
  }

  cancelCameraFlight(): void {
    if (!this.#viewer.isDestroyed()) this.#viewer.camera.cancelFlight();
  }

  flyToSource(entity: Cesium.Entity, target: SourceCameraTarget, signal: AbortSignal): Promise<boolean> {
    this.#requireOwned(entity);
    if (signal.aborted) return Promise.resolve(false);
    const cancel = () => this.cancelCameraFlight();
    signal.addEventListener("abort", cancel, { once: true });
    let flight: Promise<boolean>;
    try {
      flight = this.#viewer.flyTo(entity, {
        duration: target.duration_s,
        offset: new Cesium.HeadingPitchRange(target.heading_rad, target.pitch_rad, target.range_m),
      });
    } catch (error) {
      signal.removeEventListener("abort", cancel);
      throw error;
    }
    return flight.finally(() => signal.removeEventListener("abort", cancel));
  }

  setCameraView(target: SourceCameraTarget): void {
    if (this.#viewer.isDestroyed()) return;
    this.#viewer.camera.setView({
      destination: position(target.destination),
      orientation: {
        heading: target.heading_rad,
        pitch: target.pitch_rad,
        roll: target.roll_rad,
      },
    });
    this.#viewer.camera.zoomOut(target.range_m);
  }

  requestRender(): void {
    if (!this.#viewer.isDestroyed()) this.#viewer.scene.requestRender();
  }

  #requireViewer(): void {
    if (this.#viewer.isDestroyed()) throw new Error("Cannot mutate a destroyed Cesium viewer.");
  }

  #requireOwned(entity: Cesium.Entity): void {
    this.#requireViewer();
    if (!this.#owned.has(entity) || !this.#viewer.entities.contains(entity)) {
      throw new Error("Cesium tsunami source entity is not owned by this host.");
    }
  }
}
