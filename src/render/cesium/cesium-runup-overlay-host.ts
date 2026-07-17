import * as Cesium from "cesium";
import type {
  GaugePrimitivePresentation,
  InundationPrimitivePresentation,
  RunupLabelPresentation,
  RunupOverlayHost,
  RunupPrimitivePresentation,
} from "./runup-overlay-controller";

const EARTH_RADIUS_M = 6_371_000;

export type CesiumRunupOverlayHost = RunupOverlayHost<
  Cesium.BufferPolylineCollection,
  Cesium.BufferPolygonCollection,
  Cesium.GeoJsonPrimitive,
  Cesium.Entity
>;

function circlePositions(presentation: InundationPrimitivePresentation): Float64Array {
  const output = new Float64Array(presentation.segments * 3);
  const latitude = Cesium.Math.toRadians(presentation.lat);
  const longitude = Cesium.Math.toRadians(presentation.lon);
  const angularDistance = presentation.radiusM / EARTH_RADIUS_M;

  for (let index = 0; index < presentation.segments; index += 1) {
    const bearing = (index / presentation.segments) * Cesium.Math.TWO_PI;
    const targetLatitude = Math.asin(
      Math.sin(latitude) * Math.cos(angularDistance) +
        Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
    );
    const targetLongitude =
      longitude +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
        Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(targetLatitude),
      );
    const cartesian = Cesium.Cartesian3.fromRadians(targetLongitude, targetLatitude, 0);
    const offset = index * 3;
    output[offset] = cartesian.x;
    output[offset + 1] = cartesian.y;
    output[offset + 2] = cartesian.z;
  }
  return output;
}

function circleTriangles(segments: number): Uint32Array {
  const triangles = new Uint32Array((segments - 2) * 3);
  for (let index = 1; index < segments - 1; index += 1) {
    const offset = (index - 1) * 3;
    triangles[offset] = 0;
    triangles[offset + 1] = index;
    triangles[offset + 2] = index + 1;
  }
  return triangles;
}

/** Concrete Cesium ownership adapter for RunupOverlayController. */
export class CesiumRunupOverlayHostAdapter implements CesiumRunupOverlayHost {
  constructor(private readonly viewer: Cesium.Viewer) {}

  createRunupPrimitive(
    presentations: readonly RunupPrimitivePresentation[],
  ): Cesium.BufferPolylineCollection {
    this.assertViewerAlive();
    const collection = new Cesium.BufferPolylineCollection({
      primitiveCountMax: presentations.length,
      vertexCountMax: presentations.length * 2,
      allowPicking: false,
      blendOption: Cesium.BlendOption.TRANSLUCENT,
    });
    try {
      const line = new Cesium.BufferPolyline();
      for (const presentation of presentations) {
        const color = Cesium.Color.fromCssColorString(presentation.colorCss);
        const ground = Cesium.Cartesian3.fromDegrees(
          presentation.lon,
          presentation.lat,
          0,
        );
        const top = Cesium.Cartesian3.fromDegrees(
          presentation.lon,
          presentation.lat,
          presentation.heightM,
        );
        collection.add(
          {
            positions: new Float64Array([
              ground.x,
              ground.y,
              ground.z,
              top.x,
              top.y,
              top.z,
            ]),
            material: new Cesium.BufferPolylineMaterial({
              color: color.withAlpha(presentation.colorAlpha),
              outlineColor: Cesium.Color.fromCssColorString(
                presentation.outlineColorCss,
              ).withAlpha(presentation.outlineAlpha),
              outlineWidth: presentation.outlineWidth,
              width: presentation.width,
            }),
            featureId: 0,
            pickObject: { id: presentation.id },
          },
          line,
        );
      }
      this.assertViewerAlive();
      return this.viewer.scene.primitives.add(collection);
    } catch (error) {
      this.releaseCollection(collection);
      throw error;
    }
  }

  removeRunupPrimitive(primitive: Cesium.BufferPolylineCollection): void {
    this.releaseCollection(primitive);
  }

  createInundationPrimitive(
    presentations: readonly InundationPrimitivePresentation[],
  ): Cesium.BufferPolygonCollection {
    this.assertViewerAlive();
    const segments = presentations[0]?.segments ?? 40;
    const collection = new Cesium.BufferPolygonCollection({
      primitiveCountMax: presentations.length,
      vertexCountMax: presentations.length * segments,
      triangleCountMax: presentations.length * (segments - 2),
      allowPicking: false,
      blendOption: Cesium.BlendOption.TRANSLUCENT,
    });
    try {
      const polygon = new Cesium.BufferPolygon();
      const triangles = circleTriangles(segments);
      for (const presentation of presentations) {
        const color = Cesium.Color.fromCssColorString(presentation.colorCss);
        collection.add(
          {
            positions: circlePositions(presentation),
            holes: new Uint32Array(),
            triangles,
            material: new Cesium.BufferPolygonMaterial({
              color: color.withAlpha(presentation.colorAlpha),
              outlineColor: color.withAlpha(presentation.outlineAlpha),
              outlineWidth: presentation.outlineWidth,
            }),
            featureId: 0,
            pickObject: { id: presentation.id },
          },
          polygon,
        );
      }
      this.assertViewerAlive();
      return this.viewer.scene.primitives.add(collection);
    } catch (error) {
      this.releaseCollection(collection);
      throw error;
    }
  }

  removeInundationPrimitive(primitive: Cesium.BufferPolygonCollection): void {
    this.releaseCollection(primitive);
  }

  createGaugePrimitive(
    presentations: readonly GaugePrimitivePresentation[],
  ): Cesium.GeoJsonPrimitive {
    this.assertViewerAlive();
    const primitive = Cesium.GeoJsonPrimitive.fromGeoJson(
      {
        type: "FeatureCollection",
        features: presentations.map((presentation) => ({
          type: "Feature",
          id: presentation.id,
          properties: { name: presentation.name },
          geometry: {
            type: "Point",
            coordinates: [presentation.lon, presentation.lat, 0],
          },
        })),
      },
      { allowPicking: false },
    );
    try {
      const points = primitive.points;
      if (!points || points.primitiveCount !== presentations.length) {
        throw new Error("Cesium GeoJsonPrimitive did not create the expected gauge points");
      }
      const point = new Cesium.BufferPoint();
      for (let index = 0; index < presentations.length; index += 1) {
        const presentation = presentations[index];
        points.get(index, point);
        point.setMaterial(new Cesium.BufferPointMaterial({
          color: Cesium.Color.fromCssColorString(presentation.colorCss).withAlpha(
            presentation.colorAlpha,
          ),
          outlineColor: Cesium.Color.fromCssColorString(
            presentation.outlineColorCss,
          ).withAlpha(presentation.outlineAlpha),
          outlineWidth: presentation.outlineWidth,
          size: presentation.pixelSize,
        }));
      }
      this.assertViewerAlive();
      return this.viewer.scene.primitives.add(primitive);
    } catch (error) {
      this.releaseGeoJsonPrimitive(primitive);
      throw error;
    }
  }

  removeGaugePrimitive(primitive: Cesium.GeoJsonPrimitive): void {
    this.releaseGeoJsonPrimitive(primitive);
  }

  createLabel(presentation: RunupLabelPresentation): Cesium.Entity {
    this.assertViewerAlive();
    return this.viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(
        presentation.lon,
        presentation.lat,
        presentation.heightM,
      ),
      label: {
        text: presentation.text,
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
  }

  updateLabel(label: Cesium.Entity, presentation: RunupLabelPresentation): void {
    if (this.viewer.isDestroyed()) return;
    label.position = new Cesium.ConstantPositionProperty(
      Cesium.Cartesian3.fromDegrees(
        presentation.lon,
        presentation.lat,
        presentation.heightM,
      ),
    );
    if (label.label) {
      label.label.text = new Cesium.ConstantProperty(presentation.text);
    }
  }

  removeLabel(label: Cesium.Entity): void {
    if (this.viewer.isDestroyed()) return;
    this.viewer.entities.remove(label);
  }

  private assertViewerAlive(): void {
    if (this.viewer.isDestroyed()) {
      throw new Error("cannot create a runup overlay for a destroyed Cesium Viewer");
    }
  }

  private releaseCollection(
    collection: Cesium.BufferPolylineCollection | Cesium.BufferPolygonCollection,
  ): void {
    if (!this.viewer.isDestroyed()) {
      try {
        if (this.viewer.scene.primitives.remove(collection)) return;
      } catch {
        // Fall through to direct destruction when the scene is tearing down.
      }
    }
    if (!collection.isDestroyed()) collection.destroy();
  }

  private releaseGeoJsonPrimitive(primitive: Cesium.GeoJsonPrimitive): void {
    if (!this.viewer.isDestroyed()) {
      try {
        if (this.viewer.scene.primitives.remove(primitive)) return;
      } catch {
        // Fall through to direct destruction when the scene is tearing down.
      }
    }
    // Cesium 1.143 implements the normal primitive destroy contract, but its
    // generated declaration currently omits these two lifecycle methods.
    const destroyable = primitive as unknown as {
      isDestroyed: () => boolean;
      destroy: () => void;
    };
    if (!destroyable.isDestroyed()) destroyable.destroy();
  }
}

export function createCesiumRunupOverlayHost(viewer: Cesium.Viewer): CesiumRunupOverlayHost {
  return new CesiumRunupOverlayHostAdapter(viewer);
}
