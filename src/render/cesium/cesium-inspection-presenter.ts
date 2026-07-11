import * as Cesium from "cesium";
import { ResourceScope } from "./resources";
import type { ResourceCounts, ResourceLease } from "./types";

export type InspectionPresentation = Readonly<{
  lat: number;
  lon: number;
  text: string;
}>;

export type InspectionPresentationOperations = Readonly<{
  created: number;
  updated: number;
  removed: number;
  unchanged: number;
  invalid_inputs: number;
}>;

export type InspectionPresenterDiagnostics = Readonly<{
  generation: number;
  revision: number;
  destroyed: boolean;
  active_entities: 0 | 1;
  last_update: InspectionPresentationOperations;
  cumulative: InspectionPresentationOperations;
  resources: ResourceCounts;
}>;

const ZERO_OPERATIONS: InspectionPresentationOperations = Object.freeze({
  created: 0,
  updated: 0,
  removed: 0,
  unchanged: 0,
  invalid_inputs: 0,
});

function validCoordinates(value: InspectionPresentation): boolean {
  return Number.isFinite(value.lat)
    && Number.isFinite(value.lon)
    && value.lat >= -90
    && value.lat <= 90
    && value.lon >= -180
    && value.lon <= 180;
}

function signature(value: InspectionPresentation): string {
  return JSON.stringify(value);
}

function freezeOperations(value: InspectionPresentationOperations): InspectionPresentationOperations {
  return Object.freeze({ ...value });
}

/** Owns the single Cesium point/label used to present inspect-at-point results. */
export class CesiumInspectionPresenter {
  readonly #viewer: Cesium.Viewer;
  readonly #scope: ResourceScope;
  #entity: Cesium.Entity | null = null;
  #entityLease: ResourceLease | null = null;
  #signature: string | null = null;
  #revision = 0;
  #destroyed = false;
  #lastUpdate: InspectionPresentationOperations = ZERO_OPERATIONS;
  #cumulative: InspectionPresentationOperations = ZERO_OPERATIONS;

  constructor(viewer: Cesium.Viewer, generation: number) {
    this.#viewer = viewer;
    this.#scope = new ResourceScope(generation);
  }

  get entity(): Cesium.Entity | null {
    return this.#entity;
  }

  get diagnostics(): InspectionPresenterDiagnostics {
    return Object.freeze({
      generation: this.#scope.generation,
      revision: this.#revision,
      destroyed: this.#destroyed,
      active_entities: this.#entity === null ? 0 : 1,
      last_update: this.#lastUpdate,
      cumulative: this.#cumulative,
      resources: this.#scope.snapshotCounts(),
    });
  }

  present(value: InspectionPresentation): InspectionPresenterDiagnostics {
    if (this.#destroyed) throw new Error("CesiumInspectionPresenter is destroyed.");
    if (!validCoordinates(value)) return this.#clear(true);
    const nextSignature = signature(value);
    if (this.#entity === null) {
      const entity = this.#createEntity(value);
      this.#entity = entity;
      this.#entityLease = this.#scope.ownEntity(() => this.#removeEntity(entity));
      this.#signature = nextSignature;
      this.#record({ ...ZERO_OPERATIONS, created: 1 });
      this.#requestRender();
      return this.diagnostics;
    }
    if (this.#signature === nextSignature) {
      this.#record({ ...ZERO_OPERATIONS, unchanged: 1 });
      return this.diagnostics;
    }
    this.#updateEntity(this.#entity, value);
    this.#signature = nextSignature;
    this.#record({ ...ZERO_OPERATIONS, updated: 1 });
    this.#requestRender();
    return this.diagnostics;
  }

  clear(): InspectionPresenterDiagnostics {
    return this.#clear(false);
  }

  destroy(): InspectionPresenterDiagnostics {
    if (this.#destroyed) return this.diagnostics;
    const removed = this.#entity === null ? 0 : 1;
    this.#destroyed = true;
    this.#scope.destroy();
    this.#entity = null;
    this.#entityLease = null;
    this.#signature = null;
    this.#record({ ...ZERO_OPERATIONS, removed });
    if (removed > 0) this.#requestRender();
    return this.diagnostics;
  }

  #clear(invalid: boolean): InspectionPresenterDiagnostics {
    if (this.#destroyed) return this.diagnostics;
    const removed = this.#entity === null ? 0 : 1;
    this.#entityLease?.release();
    this.#entity = null;
    this.#entityLease = null;
    this.#signature = null;
    this.#record({ ...ZERO_OPERATIONS, removed, invalid_inputs: invalid ? 1 : 0 });
    if (removed > 0) this.#requestRender();
    return this.diagnostics;
  }

  #createEntity(value: InspectionPresentation): Cesium.Entity {
    if (this.#viewer.isDestroyed()) throw new Error("Cannot present inspection on a destroyed Cesium viewer.");
    return this.#viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(value.lon, value.lat, 0),
      point: {
        pixelSize: 10,
        color: Cesium.Color.fromCssColorString("#89dceb"),
        outlineColor: Cesium.Color.fromCssColorString("#11111b"),
        outlineWidth: 2,
      },
      label: {
        text: value.text,
        font: "11px Inter, sans-serif",
        fillColor: Cesium.Color.fromCssColorString("#cdd6f4"),
        outlineColor: Cesium.Color.fromCssColorString("#11111b"),
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -16),
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("#1e1e2e").withAlpha(0.92),
        backgroundPadding: new Cesium.Cartesian2(10, 8),
      },
    });
  }

  #updateEntity(entity: Cesium.Entity, value: InspectionPresentation): void {
    if (this.#viewer.isDestroyed() || !this.#viewer.entities.contains(entity)) {
      throw new Error("Cannot update an unowned inspection entity.");
    }
    if (!entity.label) throw new Error("Inspection entity has no label graphics.");
    entity.position = new Cesium.ConstantPositionProperty(
      Cesium.Cartesian3.fromDegrees(value.lon, value.lat, 0),
    );
    entity.label.text = new Cesium.ConstantProperty(value.text);
  }

  #removeEntity(entity: Cesium.Entity): void {
    if (this.#viewer.isDestroyed()) return;
    if (this.#viewer.entities.contains(entity)) this.#viewer.entities.remove(entity);
  }

  #requestRender(): void {
    if (!this.#viewer.isDestroyed()) this.#viewer.scene.requestRender();
  }

  #record(operations: InspectionPresentationOperations): void {
    const frozen = freezeOperations(operations);
    this.#revision += 1;
    this.#lastUpdate = frozen;
    this.#cumulative = freezeOperations({
      created: this.#cumulative.created + frozen.created,
      updated: this.#cumulative.updated + frozen.updated,
      removed: this.#cumulative.removed + frozen.removed,
      unchanged: this.#cumulative.unchanged + frozen.unchanged,
      invalid_inputs: this.#cumulative.invalid_inputs + frozen.invalid_inputs,
    });
  }
}
