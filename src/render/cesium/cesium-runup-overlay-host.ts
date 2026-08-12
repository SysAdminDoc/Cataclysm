import * as Cesium from "cesium";
import type {
  GaugePrimitivePresentation,
  InundationPrimitivePresentation,
  RunupLabelPresentation,
  RunupOverlayHost,
  RunupPrimitivePresentation,
} from "./runup-overlay-controller";
import { terrainEllipsePositions } from "./terrain-overlay-geometry";

export type CesiumTerrainEntityGroup = readonly Cesium.Entity[];
export type CesiumRunupPrimitiveGroup = Cesium.Entity[] & {
  rings: Cesium.BufferPolylineCollection | null;
};
export type CesiumInundationPrimitiveGroup = Cesium.Entity[] & {
  buffer: Cesium.BufferPolygonCollection | null;
};
export type CesiumGaugePrimitiveGroup = Cesium.Entity[] & {
  buffer: Cesium.BufferPointCollection | null;
};

export type CesiumRunupOverlayHost = RunupOverlayHost<
  CesiumRunupPrimitiveGroup,
  CesiumInundationPrimitiveGroup,
  CesiumGaugePrimitiveGroup,
  Cesium.Entity
>;

type OptionalBufferConstructors = {
  BufferPointCollection?: typeof Cesium.BufferPointCollection;
  BufferPolygonCollection?: typeof Cesium.BufferPolygonCollection;
  BufferPolylineCollection?: typeof Cesium.BufferPolylineCollection;
};

// Cesium's Buffer* collections are experimental. Keeping the lookup behind a
// runtime feature check lets the same build fall back to Entities on older
// pinned runtimes or a partially upgraded WebView.
const cesiumRuntime = Cesium as typeof Cesium & OptionalBufferConstructors;
const BUFFER_SEGMENTS = 40;

function runupRadius(heightM: number): number {
  return Math.min(10_000, Math.max(500, heightM * 0.008));
}

/**
 * Concrete Cesium ownership adapter for terrain-aware runup graphics.
 * Cylinders and labels are relative to ground, while inundation discs are
 * clamped to ground. Ocean gauges remain at sea level. This keeps elevation purely visual and never samples it
 * back into the analytical runup result.
 */
export class CesiumRunupOverlayHostAdapter implements CesiumRunupOverlayHost {
  private groupSerial = 0;

  constructor(private readonly viewer: Cesium.Viewer) {}

  createRunupPrimitive(
    presentations: readonly RunupPrimitivePresentation[],
  ): CesiumRunupPrimitiveGroup {
    this.assertViewerAlive();
    const entities: Cesium.Entity[] = [];
    const groupId = this.nextGroupId("runup");
    try {
      for (const presentation of presentations) {
        const color = Cesium.Color.fromCssColorString(presentation.colorCss);
        const radius = runupRadius(presentation.heightM);
        entities.push(this.viewer.entities.add({
          id: `${groupId}:${presentation.id}`,
          position: Cesium.Cartesian3.fromDegrees(
            presentation.lon,
            presentation.lat,
            presentation.heightM / 2,
          ),
          cylinder: {
            length: presentation.heightM,
            topRadius: radius,
            bottomRadius: radius,
            material: color.withAlpha(presentation.colorAlpha),
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString(
              presentation.outlineColorCss,
            ).withAlpha(presentation.outlineAlpha),
            outlineWidth: presentation.outlineWidth,
            heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          },
        }));
      }
      return Object.assign(entities, {
        rings: this.createRunupRingBuffer(presentations),
      });
    } catch (error) {
      this.releaseEntities(entities);
      throw error;
    }
  }

  removeRunupPrimitive(group: CesiumRunupPrimitiveGroup): void {
    this.releaseBuffer(group.rings);
    this.releaseEntities(group);
  }

  createInundationPrimitive(
    presentations: readonly InundationPrimitivePresentation[],
  ): CesiumInundationPrimitiveGroup {
    this.assertViewerAlive();
    const buffered = this.createInundationBuffer(presentations);
    if (buffered) return Object.assign([], { buffer: buffered });
    return Object.assign(this.createInundationEntities(presentations), { buffer: null });
  }

  removeInundationPrimitive(group: CesiumInundationPrimitiveGroup): void {
    this.releaseBuffer(group.buffer);
    this.releaseEntities(group);
  }

  createGaugePrimitive(
    presentations: readonly GaugePrimitivePresentation[],
  ): CesiumGaugePrimitiveGroup {
    this.assertViewerAlive();
    const buffered = this.createGaugeBuffer(presentations);
    if (buffered) return Object.assign([], { buffer: buffered });
    return Object.assign(this.createGaugeEntities(presentations), { buffer: null });
  }

  removeGaugePrimitive(group: CesiumGaugePrimitiveGroup): void {
    this.releaseBuffer(group.buffer);
    this.releaseEntities(group);
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
        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
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
      label.label.heightReference = new Cesium.ConstantProperty(
        Cesium.HeightReference.RELATIVE_TO_GROUND,
      );
    }
  }

  removeLabel(label: Cesium.Entity): void {
    if (this.viewer.isDestroyed()) return;
    this.viewer.entities.remove(label);
  }

  private createInundationEntities(
    presentations: readonly InundationPrimitivePresentation[],
  ): Cesium.Entity[] {
    const entities: Cesium.Entity[] = [];
    const groupId = this.nextGroupId("inundation");
    try {
      for (const presentation of presentations) {
        const color = Cesium.Color.fromCssColorString(presentation.colorCss);
        entities.push(this.viewer.entities.add({
          id: `${groupId}:${presentation.id}`,
          position: Cesium.Cartesian3.fromDegrees(presentation.lon, presentation.lat),
          ellipse: {
            semiMajorAxis: presentation.radiusM,
            semiMinorAxis: presentation.radiusM,
            material: color.withAlpha(presentation.colorAlpha),
            outline: false,
            outlineColor: color.withAlpha(presentation.outlineAlpha),
            outlineWidth: presentation.outlineWidth,
            classificationType: Cesium.ClassificationType.TERRAIN,
          },
          polyline: {
            positions: terrainEllipsePositions(
              presentation.lat,
              presentation.lon,
              presentation.radiusM,
              presentation.radiusM,
              presentation.segments,
            ),
            width: presentation.outlineWidth,
            material: color.withAlpha(presentation.outlineAlpha),
            clampToGround: true,
            classificationType: Cesium.ClassificationType.TERRAIN,
          },
        }));
      }
      return entities;
    } catch (error) {
      this.releaseEntities(entities);
      throw error;
    }
  }

  private createGaugeEntities(
    presentations: readonly GaugePrimitivePresentation[],
  ): Cesium.Entity[] {
    this.assertViewerAlive();
    const entities: Cesium.Entity[] = [];
    const groupId = this.nextGroupId("gauge");
    try {
      for (const presentation of presentations) {
        entities.push(this.viewer.entities.add({
          id: `${groupId}:${presentation.id}`,
          name: presentation.name,
          position: Cesium.Cartesian3.fromDegrees(presentation.lon, presentation.lat),
          point: {
            pixelSize: presentation.pixelSize,
            color: Cesium.Color.fromCssColorString(presentation.colorCss).withAlpha(
              presentation.colorAlpha,
            ),
            outlineColor: Cesium.Color.fromCssColorString(
              presentation.outlineColorCss,
            ).withAlpha(presentation.outlineAlpha),
            outlineWidth: presentation.outlineWidth,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }));
      }
      return entities;
    } catch (error) {
      this.releaseEntities(entities);
      throw error;
    }
  }

  private assertViewerAlive(): void {
    if (this.viewer.isDestroyed()) {
      throw new Error("cannot create a runup overlay for a destroyed Cesium Viewer");
    }
  }

  private nextGroupId(kind: string): string {
    this.groupSerial += 1;
    return `${kind}-group-${this.groupSerial}`;
  }

  private releaseEntities(entities: CesiumTerrainEntityGroup): void {
    if (this.viewer.isDestroyed()) return;
    for (const entity of entities) this.viewer.entities.remove(entity);
    this.viewer.scene.requestRender();
  }

  private createRunupRingBuffer(
    presentations: readonly RunupPrimitivePresentation[],
  ): Cesium.BufferPolylineCollection | null {
    const Constructor = cesiumRuntime.BufferPolylineCollection;
    if (typeof Constructor !== "function" || presentations.length === 0) return null;
    const collection = new Constructor({
      primitiveCountMax: presentations.length,
      vertexCountMax: presentations.length * (BUFFER_SEGMENTS + 1),
      allowPicking: false,
    });
    try {
      for (const presentation of presentations) {
        const positions = toPackedPositions(terrainEllipsePositions(
          presentation.lat,
          presentation.lon,
          runupRadius(presentation.heightM),
          runupRadius(presentation.heightM),
          BUFFER_SEGMENTS,
        ));
        collection.add({
          positions,
          material: new Cesium.BufferPolylineMaterial({
            color: Cesium.Color.fromCssColorString(presentation.colorCss).withAlpha(
              presentation.outlineAlpha,
            ),
            width: 2,
          }),
        }, new Cesium.BufferPolyline());
      }
      this.viewer.scene.primitives.add(collection);
      this.viewer.scene.requestRender();
      return collection;
    } catch {
      collection.destroy();
      return null;
    }
  }

  private createInundationBuffer(
    presentations: readonly InundationPrimitivePresentation[],
  ): Cesium.BufferPolygonCollection | null {
    const Constructor = cesiumRuntime.BufferPolygonCollection;
    if (typeof Constructor !== "function" || presentations.length === 0) return null;
    const collection = new Constructor({
      primitiveCountMax: presentations.length,
      vertexCountMax: presentations.reduce((sum, item) => sum + item.segments, 0),
      triangleCountMax: presentations.reduce((sum, item) => sum + Math.max(0, item.segments - 2), 0),
      allowPicking: false,
    });
    try {
      for (const presentation of presentations) {
        const positions = terrainEllipsePositions(
          presentation.lat,
          presentation.lon,
          presentation.radiusM,
          presentation.radiusM,
          presentation.segments,
        ).slice(0, -1);
        collection.add({
          positions: toPackedPositions(positions),
          triangles: fanTriangles(positions.length),
          material: new Cesium.BufferPolygonMaterial({
            color: Cesium.Color.fromCssColorString(presentation.colorCss).withAlpha(
              presentation.colorAlpha,
            ),
            outlineColor: Cesium.Color.fromCssColorString(presentation.colorCss).withAlpha(
              presentation.outlineAlpha,
            ),
            outlineWidth: presentation.outlineWidth,
          }),
        }, new Cesium.BufferPolygon());
      }
      this.viewer.scene.primitives.add(collection);
      this.viewer.scene.requestRender();
      return collection;
    } catch {
      collection.destroy();
      return null;
    }
  }

  private createGaugeBuffer(
    presentations: readonly GaugePrimitivePresentation[],
  ): Cesium.BufferPointCollection | null {
    const Constructor = cesiumRuntime.BufferPointCollection;
    if (typeof Constructor !== "function" || presentations.length === 0) return null;
    const collection = new Constructor({
      primitiveCountMax: presentations.length,
      allowPicking: false,
    });
    const material = new Cesium.BufferPointMaterial({
      color: Cesium.Color.fromCssColorString(presentations[0].colorCss).withAlpha(
        presentations[0].colorAlpha,
      ),
      outlineColor: Cesium.Color.fromCssColorString(presentations[0].outlineColorCss).withAlpha(
        presentations[0].outlineAlpha,
      ),
      outlineWidth: presentations[0].outlineWidth,
      size: presentations[0].pixelSize,
    });
    try {
      for (const presentation of presentations) {
        collection.add({
          position: Cesium.Cartesian3.fromDegrees(presentation.lon, presentation.lat),
          material,
        }, new Cesium.BufferPoint());
      }
      this.viewer.scene.primitives.add(collection);
      this.viewer.scene.requestRender();
      return collection;
    } catch {
      collection.destroy();
      return null;
    }
  }

  private releaseBuffer(
    collection: Cesium.BufferPolygonCollection | Cesium.BufferPointCollection | Cesium.BufferPolylineCollection | null,
  ): void {
    if (!collection || this.viewer.isDestroyed()) return;
    if (this.viewer.scene.primitives.contains(collection)) {
      this.viewer.scene.primitives.remove(collection);
    } else if (!collection.isDestroyed()) {
      collection.destroy();
    }
    this.viewer.scene.requestRender();
  }
}

function toPackedPositions(positions: readonly Cesium.Cartesian3[]): Float64Array {
  const packed = new Float64Array(positions.length * 3);
  positions.forEach((position, index) => {
    packed[index * 3] = position.x;
    packed[index * 3 + 1] = position.y;
    packed[index * 3 + 2] = position.z;
  });
  return packed;
}

function fanTriangles(vertexCount: number): Uint32Array {
  const triangles = new Uint32Array(Math.max(0, vertexCount - 2) * 3);
  for (let index = 1; index < vertexCount - 1; index += 1) {
    const offset = (index - 1) * 3;
    triangles[offset] = 0;
    triangles[offset + 1] = index + 1;
    triangles[offset + 2] = index;
  }
  return triangles;
}

export function createCesiumRunupOverlayHost(viewer: Cesium.Viewer): CesiumRunupOverlayHost {
  return new CesiumRunupOverlayHostAdapter(viewer);
}
