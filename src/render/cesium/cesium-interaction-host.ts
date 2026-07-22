import * as Cesium from "cesium";
import type { InteractionOwnershipHost } from "./interaction-ownership-controller";
import { FrameCoalescedCoordinatePicker } from "./coordinate-pick-scheduler";

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
  #activeInspectPicker: FrameCoalescedCoordinatePicker<
    Cesium.Cartesian2,
    Readonly<{ lat: number; lon: number }>
  > | null = null;

  constructor(viewer: Cesium.Viewer) {
    this.#viewer = viewer;
  }

  attachHandler(mode: CesiumInteractionMode, _generation: number): Cesium.ScreenSpaceEventHandler {
    this.#requireViewer();
    if (this.#activeHandler) throw new Error("Cesium interaction host already owns an input handler.");
    this.#viewer.canvas.classList.toggle("cataclysm-cesium-cursor--pick", mode.kind === "pick");
    this.#viewer.canvas.classList.toggle("cataclysm-cesium-cursor--inspect", mode.kind === "inspect");
    const handler = new Cesium.ScreenSpaceEventHandler(this.#viewer.canvas);
    const pickCoordinate = (position: Cesium.Cartesian2): Readonly<{ lat: number; lon: number }> | null => {
      if (this.#viewer.isDestroyed()) return null;
      const cartesian = this.#viewer.scene.camera.pickEllipsoid(
        position,
        this.#viewer.scene.globe.ellipsoid,
      );
      if (!cartesian) return null;
      const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
      const lat = Cesium.Math.toDegrees(cartographic.latitude);
      const lon = Cesium.Math.toDegrees(cartographic.longitude);
      return Number.isFinite(lat) && Number.isFinite(lon) ? Object.freeze({ lat, lon }) : null;
    };
    const commitCoordinate = (coordinate: Readonly<{ lat: number; lon: number }>) => {
      mode.onPosition(coordinate.lat, coordinate.lon);
    };
    if (mode.kind === "inspect") {
      this.#activeInspectPicker = new FrameCoalescedCoordinatePicker({
        pick: pickCoordinate,
        commit: commitCoordinate,
        requestFrame: window.requestAnimationFrame.bind(window),
        cancelFrame: window.cancelAnimationFrame.bind(window),
      });
    }
    handler.setInputAction((event: { position: Cesium.Cartesian2 }) => {
      if (mode.kind === "inspect") {
        this.#activeInspectPicker?.schedule(Cesium.Cartesian2.clone(event.position));
        return;
      }
      const coordinate = pickCoordinate(event.position);
      if (coordinate) commitCoordinate(coordinate);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    this.#activeHandler = handler;
    return handler;
  }

  detachHandler(handler: Cesium.ScreenSpaceEventHandler): void {
    if (!handler.isDestroyed()) handler.destroy();
    if (this.#activeHandler === handler) {
      this.#activeInspectPicker?.destroy();
      this.#activeInspectPicker = null;
      this.#activeHandler = null;
      if (!this.#viewer.isDestroyed()) {
        this.#viewer.canvas.classList.remove(
          "cataclysm-cesium-cursor--pick",
          "cataclysm-cesium-cursor--inspect",
        );
      }
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
