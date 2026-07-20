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

export type CesiumRunupOverlayHost = RunupOverlayHost<
  CesiumTerrainEntityGroup,
  CesiumTerrainEntityGroup,
  CesiumTerrainEntityGroup,
  Cesium.Entity
>;

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
  ): CesiumTerrainEntityGroup {
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
      return entities;
    } catch (error) {
      this.releaseEntities(entities);
      throw error;
    }
  }

  removeRunupPrimitive(entities: CesiumTerrainEntityGroup): void {
    this.releaseEntities(entities);
  }

  createInundationPrimitive(
    presentations: readonly InundationPrimitivePresentation[],
  ): CesiumTerrainEntityGroup {
    this.assertViewerAlive();
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

  removeInundationPrimitive(entities: CesiumTerrainEntityGroup): void {
    this.releaseEntities(entities);
  }

  createGaugePrimitive(
    presentations: readonly GaugePrimitivePresentation[],
  ): CesiumTerrainEntityGroup {
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

  removeGaugePrimitive(entities: CesiumTerrainEntityGroup): void {
    this.releaseEntities(entities);
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
}

export function createCesiumRunupOverlayHost(viewer: Cesium.Viewer): CesiumRunupOverlayHost {
  return new CesiumRunupOverlayHostAdapter(viewer);
}
