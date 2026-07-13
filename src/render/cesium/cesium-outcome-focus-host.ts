import * as Cesium from "cesium";
import type { OutcomeFocusHost, OutcomeFocusTarget } from "./outcome-focus";

/** Cesium adapter for result-driven place focus; timeline ownership stays in React. */
export class CesiumOutcomeFocusHost implements OutcomeFocusHost {
  readonly #viewer: Cesium.Viewer;
  readonly #focusTime: (time_s: number) => void;
  #focusMarker: Cesium.Entity | null = null;

  constructor(viewer: Cesium.Viewer, focusTime: (time_s: number) => void) {
    this.#viewer = viewer;
    this.#focusTime = focusTime;
  }

  cancelCameraFlight(): void {
    if (!this.#viewer.isDestroyed()) this.#viewer.camera.cancelFlight();
  }

  flyTo(target: OutcomeFocusTarget, signal: AbortSignal): Promise<boolean> {
    if (this.#viewer.isDestroyed() || signal.aborted) return Promise.resolve(false);
    return new Promise<boolean>((resolve, reject) => {
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        resolve(value);
      };
      const abort = () => {
        this.cancelCameraFlight();
        finish(false);
      };
      signal.addEventListener("abort", abort, { once: true });
      try {
        this.#viewer.camera.flyToBoundingSphere(this.#sphere(target), {
          duration: target.duration_s,
          offset: this.#offset(target),
          complete: () => finish(true),
          cancel: () => finish(false),
        });
      } catch (error) {
        signal.removeEventListener("abort", abort);
        reject(error);
      }
    });
  }

  setCameraView(target: OutcomeFocusTarget): void {
    if (this.#viewer.isDestroyed()) return;
    this.#viewer.camera.cancelFlight();
    this.#viewer.camera.viewBoundingSphere(this.#sphere(target), this.#offset(target));
  }

  focusSimulationTime(time_s: number): void {
    this.#focusTime(time_s);
  }

  requestRender(): void {
    if (!this.#viewer.isDestroyed()) this.#viewer.scene.requestRender();
  }

  showFocus(target: OutcomeFocusTarget): void {
    if (this.#viewer.isDestroyed()) return;
    this.clearFocus();
    this.#focusMarker = this.#viewer.entities.add({
      id: `outcome-focus:${target.lat_deg}:${target.lon_deg}`,
      position: Cesium.Cartesian3.fromDegrees(target.lon_deg, target.lat_deg, 8),
      point: {
        pixelSize: 13,
        color: Cesium.Color.fromCssColorString("#22d3ee"),
        outlineColor: Cesium.Color.fromCssColorString("#07111f"),
        outlineWidth: 4,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: target.label ? {
        text: target.label,
        font: "600 14px Inter, system-ui, sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString("#07111f"),
        outlineWidth: 4,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(18, -20),
        horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      } : undefined,
    });
  }

  clearFocus(): void {
    if (!this.#focusMarker) return;
    if (!this.#viewer.isDestroyed()) this.#viewer.entities.remove(this.#focusMarker);
    this.#focusMarker = null;
  }

  #sphere(target: OutcomeFocusTarget): Cesium.BoundingSphere {
    return new Cesium.BoundingSphere(
      Cesium.Cartesian3.fromDegrees(target.lon_deg, target.lat_deg, 0),
      Math.max(1_000, target.range_m / 3),
    );
  }

  #offset(target: OutcomeFocusTarget): Cesium.HeadingPitchRange {
    return new Cesium.HeadingPitchRange(
      target.heading_rad,
      target.pitch_rad,
      target.range_m,
    );
  }
}
