import * as Cesium from "cesium";
import type {
  DirectCylinderState,
  DirectEffectsHost,
  DirectEllipseState,
  DirectPointState,
  DirectPolylineState,
  EcefPoint,
} from "./direct-effects";
import { terrainEllipsePositionsFromCartesian } from "./terrain-overlay-geometry";

function point(value: EcefPoint): Cesium.Cartesian3 {
  return new Cesium.Cartesian3(value[0], value[1], value[2]);
}

function ellipseStyle(id: string): { color: Cesium.Color; alpha: number } {
  if (id.includes("wave_0_radius")) return { color: Cesium.Color.fromCssColorString("#dff1ff"), alpha: 0.24 };
  if (id.includes("wave_1_radius")) return { color: Cesium.Color.fromCssColorString("#8bc8ff"), alpha: 0.2 };
  if (id.includes("wave_2_radius")) return { color: Cesium.Color.fromCssColorString("#3aa0ff"), alpha: 0.16 };
  if (id.includes("asteroid-fireball")) return { color: Cesium.Color.WHITE, alpha: 0.7 };
  if (id.includes("fireball")) return { color: Cesium.Color.WHITE, alpha: 0.72 };
  if (id.includes("fallout")) return { color: Cesium.Color.fromCssColorString("#a6e3a1"), alpha: 0.12 };
  if (id.includes("crater")) return { color: Cesium.Color.fromCssColorString("#fab387"), alpha: 0.16 };
  if (id.includes("cavity")) return { color: Cesium.Color.fromCssColorString("#dff1ff"), alpha: 0.24 };
  return { color: Cesium.Color.fromCssColorString("#f9e2af"), alpha: 0.2 };
}

function cylinderStyle(id: string): { color: Cesium.Color; alpha: number } {
  if (id.includes("cavity") || id.includes("splash")) {
    return { color: Cesium.Color.fromCssColorString("#e8f6ff"), alpha: 0.75 };
  }
  if (id.includes("cloud")) return { color: Cesium.Color.fromCssColorString("#d4c7b0"), alpha: 0.58 };
  return { color: Cesium.Color.fromCssColorString("#f9e2af"), alpha: 0.72 };
}

export class CesiumDirectEffectsHost implements DirectEffectsHost<Cesium.Entity> {
  readonly #viewer: Cesium.Viewer;

  constructor(viewer: Cesium.Viewer) {
    this.#viewer = viewer;
  }

  createEllipse(id: string, state: DirectEllipseState): Cesium.Entity {
    const style = ellipseStyle(id);
    const drapeOnTerrain = !id.includes("wave_") && !id.includes("cavity");
    const center = point(state.centerEcefM);
    return this.#viewer.entities.add({
      id: `protocol:${id}`,
      position: center,
      ellipse: {
        semiMajorAxis: state.semiMajorM,
        semiMinorAxis: state.semiMinorM,
        material: style.color.withAlpha(style.alpha),
        outline: !drapeOnTerrain,
        outlineColor: style.color.withAlpha(0.9),
        outlineWidth: 3,
        height: drapeOnTerrain ? undefined : 0,
        classificationType: drapeOnTerrain ? Cesium.ClassificationType.TERRAIN : Cesium.ClassificationType.BOTH,
      },
      polyline: drapeOnTerrain ? {
        positions: terrainEllipsePositionsFromCartesian(center, state.semiMajorM, state.semiMinorM),
        width: 3,
        material: style.color.withAlpha(0.9),
        clampToGround: true,
        classificationType: Cesium.ClassificationType.TERRAIN,
      } : undefined,
    });
  }

  updateEllipse(entity: Cesium.Entity, state: DirectEllipseState): void {
    entity.position = new Cesium.ConstantPositionProperty(point(state.centerEcefM));
    if (!entity.ellipse) return;
    entity.ellipse.semiMajorAxis = new Cesium.ConstantProperty(state.semiMajorM);
    entity.ellipse.semiMinorAxis = new Cesium.ConstantProperty(state.semiMinorM);
    if (entity.polyline) {
      entity.polyline.positions = new Cesium.ConstantProperty(
        terrainEllipsePositionsFromCartesian(point(state.centerEcefM), state.semiMajorM, state.semiMinorM),
      );
    }
  }

  createPoint(id: string, state: DirectPointState): Cesium.Entity {
    return this.#viewer.entities.add({
      id: `protocol:${id}`,
      position: point(state.positionEcefM),
      point: {
        pixelSize: 18,
        color: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString("#ff8c42"),
        outlineWidth: 8,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      properties: { physicalRadiusM: state.radiusM },
    });
  }

  updatePoint(entity: Cesium.Entity, state: DirectPointState): void {
    entity.position = new Cesium.ConstantPositionProperty(point(state.positionEcefM));
    entity.properties?.physicalRadiusM?.setValue(state.radiusM);
  }

  createPolyline(id: string, state: DirectPolylineState): Cesium.Entity {
    return this.#viewer.entities.add({
      id: `protocol:${id}`,
      polyline: {
        positions: state.positionsEcefM.map(point),
        width: 8,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.55,
          color: Cesium.Color.fromCssColorString("#ff8c42").withAlpha(0.88),
        }),
      },
    });
  }

  updatePolyline(entity: Cesium.Entity, state: DirectPolylineState): void {
    if (entity.polyline) entity.polyline.positions = new Cesium.ConstantProperty(state.positionsEcefM.map(point));
  }

  createCylinder(id: string, state: DirectCylinderState): Cesium.Entity {
    const style = cylinderStyle(id);
    return this.#viewer.entities.add({
      id: `protocol:${id}`,
      position: point(state.centerEcefM),
      cylinder: {
        length: state.heightM,
        topRadius: Math.max(state.heightM * 0.1, 700),
        bottomRadius: Math.max(state.heightM * 0.24, 1_400),
        material: style.color.withAlpha(style.alpha),
      },
    });
  }

  updateCylinder(entity: Cesium.Entity, state: DirectCylinderState): void {
    entity.position = new Cesium.ConstantPositionProperty(point(state.centerEcefM));
    if (!entity.cylinder) return;
    entity.cylinder.length = new Cesium.ConstantProperty(state.heightM);
    entity.cylinder.topRadius = new Cesium.ConstantProperty(Math.max(state.heightM * 0.1, 700));
    entity.cylinder.bottomRadius = new Cesium.ConstantProperty(Math.max(state.heightM * 0.24, 1_400));
  }

  remove(entity: Cesium.Entity): void {
    if (!this.#viewer.isDestroyed()) this.#viewer.entities.remove(entity);
  }
}
