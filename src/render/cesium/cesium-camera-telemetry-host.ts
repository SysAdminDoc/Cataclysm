import * as Cesium from "cesium";

import type { CameraTelemetryHost } from "./camera-telemetry";

export class CesiumCameraTelemetryHost implements CameraTelemetryHost {
  readonly #viewer: Cesium.Viewer;

  constructor(viewer: Cesium.Viewer) {
    this.#viewer = viewer;
  }

  read() {
    const position = this.#viewer.camera.positionCartographic;
    return {
      lat: Cesium.Math.toDegrees(position.latitude),
      lon: Cesium.Math.toDegrees(position.longitude),
      altitudeM: Math.max(0, position.height),
      headingDeg: Cesium.Math.toDegrees(Cesium.Math.zeroToTwoPi(this.#viewer.camera.heading)),
    };
  }

  subscribe(listener: () => void): () => void {
    this.#viewer.camera.percentageChanged = 0.01;
    this.#viewer.camera.changed.addEventListener(listener);
    return () => {
      if (!this.#viewer.isDestroyed()) this.#viewer.camera.changed.removeEventListener(listener);
    };
  }
}
