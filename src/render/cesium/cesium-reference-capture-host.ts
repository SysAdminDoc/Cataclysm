import * as Cesium from "cesium";
import { getActiveEarthSession } from "../../lib/earth-assets";
import type { ReferenceCaptureView } from "../../lib/reference-capture";
import { applyRendererQualityProfile } from "../../rendering/quality-profiles";
import type {
  ReferenceCaptureProjection,
  ReferenceCaptureProjectionHost,
} from "./reference-capture-bridge";

/** Exact Cesium clock/camera/quality projection used by the deterministic capture bridge. */
export class CesiumReferenceCaptureHost implements ReferenceCaptureProjectionHost {
  readonly #viewer: Cesium.Viewer;

  constructor(viewer: Cesium.Viewer) {
    this.#viewer = viewer;
  }

  applyReferenceView(view: ReferenceCaptureView): ReferenceCaptureProjection {
    if (this.#viewer.isDestroyed()) throw new Error("Cannot apply a reference view to a destroyed Cesium viewer.");
    const currentTime = Cesium.JulianDate.fromIso8601(view.utc);
    this.#viewer.clock.currentTime = currentTime;
    this.#viewer.clock.shouldAnimate = false;
    this.#viewer.scene.requestRenderMode = true;
    this.#viewer.scene.maximumRenderTimeChange = Number.POSITIVE_INFINITY;
    const quality = applyRendererQualityProfile(this.#viewer, view.qualityTier, view.exposure);
    if (this.#viewer.camera.frustum instanceof Cesium.PerspectiveFrustum) {
      this.#viewer.camera.frustum.fov = Cesium.Math.toRadians(view.camera.verticalFovDeg);
    }
    this.#viewer.camera.cancelFlight();
    this.#viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(
        view.camera.lon,
        view.camera.lat,
        view.camera.altitudeM,
      ),
      orientation: {
        heading: Cesium.Math.toRadians(view.camera.headingDeg),
        pitch: Cesium.Math.toRadians(view.camera.pitchDeg),
        roll: Cesium.Math.toRadians(view.camera.rollDeg),
      },
    });
    this.#viewer.resize();
    this.#viewer.scene.requestRender();
    const position = this.#viewer.camera.positionCartographic;
    const sun = Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(
      currentTime,
      new Cesium.Cartesian3(),
    );
    return {
      renderer: "CesiumJS 1.143.0",
      earthSession: getActiveEarthSession(),
      sunPositionEciM: { x: sun.x, y: sun.y, z: sun.z },
      quality,
      actualCamera: {
        lat: Cesium.Math.toDegrees(position.latitude),
        lon: Cesium.Math.toDegrees(position.longitude),
        altitudeM: position.height,
        headingDeg: Cesium.Math.toDegrees(this.#viewer.camera.heading),
        pitchDeg: Cesium.Math.toDegrees(this.#viewer.camera.pitch),
        rollDeg: Cesium.Math.toDegrees(this.#viewer.camera.roll),
        verticalFovDeg: this.#viewer.camera.frustum instanceof Cesium.PerspectiveFrustum
          ? Cesium.Math.toDegrees(
              this.#viewer.camera.frustum.fov ?? Cesium.Math.toRadians(view.camera.verticalFovDeg),
            )
          : view.camera.verticalFovDeg,
      },
    };
  }
}
