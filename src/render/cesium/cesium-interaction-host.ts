import * as Cesium from "cesium";
import type { InteractionOwnershipHost } from "./interaction-ownership-controller";

export type CesiumInteractionMode = Readonly<{
  kind: "pick" | "inspect";
  onPosition(lat_deg: number, lon_deg: number): void;
  onCancel(): void;
}>;

export type CesiumEscapeListener = {
  readonly generation: number;
  readonly callback: (event: KeyboardEvent) => void;
  active: boolean;
};

/** Concrete Cesium/DOM ownership adapter for mutually exclusive globe interactions. */
export class CesiumInteractionOwnershipHost implements InteractionOwnershipHost<
  CesiumInteractionMode,
  Cesium.ScreenSpaceEventHandler,
  CesiumEscapeListener,
  Cesium.Entity
> {
  readonly #viewer: Cesium.Viewer;
  #activeHandler: Cesium.ScreenSpaceEventHandler | null = null;
  #activeListener: CesiumEscapeListener | null = null;

  constructor(viewer: Cesium.Viewer) {
    this.#viewer = viewer;
  }

  attachHandler(mode: CesiumInteractionMode, _generation: number): Cesium.ScreenSpaceEventHandler {
    this.#requireViewer();
    if (this.#activeHandler) throw new Error("Cesium interaction host already owns an input handler.");
    this.#viewer.canvas.style.cursor = mode.kind === "pick" ? "crosshair" : "help";
    const handler = new Cesium.ScreenSpaceEventHandler(this.#viewer.canvas);
    handler.setInputAction((event: { position: Cesium.Cartesian2 }) => {
      if (this.#viewer.isDestroyed()) return;
      const cartesian = this.#viewer.scene.camera.pickEllipsoid(
        event.position,
        this.#viewer.scene.globe.ellipsoid,
      );
      if (!cartesian) return;
      const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
      const lat = Cesium.Math.toDegrees(cartographic.latitude);
      const lon = Cesium.Math.toDegrees(cartographic.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lon)) mode.onPosition(lat, lon);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    this.#activeHandler = handler;
    return handler;
  }

  detachHandler(handler: Cesium.ScreenSpaceEventHandler): void {
    if (!handler.isDestroyed()) handler.destroy();
    if (this.#activeHandler === handler) {
      this.#activeHandler = null;
      if (!this.#viewer.isDestroyed()) this.#viewer.canvas.style.cursor = "";
    }
  }

  attachListener(mode: CesiumInteractionMode, generation: number): CesiumEscapeListener {
    if (this.#activeListener) throw new Error("Cesium interaction host already owns an Escape listener.");
    const listener: CesiumEscapeListener = {
      generation,
      active: true,
      callback: (event) => {
        if (listener.active && event.key === "Escape") mode.onCancel();
      },
    };
    window.addEventListener("keydown", listener.callback);
    this.#activeListener = listener;
    return listener;
  }

  detachListener(listener: CesiumEscapeListener): void {
    if (!listener.active) return;
    listener.active = false;
    window.removeEventListener("keydown", listener.callback);
    if (this.#activeListener === listener) this.#activeListener = null;
  }

  removeEntity(entity: Cesium.Entity): void {
    if (this.#viewer.isDestroyed()) return;
    if (this.#viewer.entities.contains(entity)) this.#viewer.entities.remove(entity);
  }

  #requireViewer(): void {
    if (this.#viewer.isDestroyed()) throw new Error("Cannot attach interactions to a destroyed Cesium viewer.");
  }
}
