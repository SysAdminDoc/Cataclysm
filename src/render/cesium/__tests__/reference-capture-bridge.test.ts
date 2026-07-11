import * as Cesium from "cesium";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getActiveEarthSession } from "../../../lib/earth-assets";
import {
  REFERENCE_CAPTURE_EVENT,
  type ReferenceCaptureView,
} from "../../../lib/reference-capture";
import { RENDERER_QUALITY_PROFILES } from "../../../rendering/quality-profiles";
import { CesiumReferenceCaptureHost } from "../cesium-reference-capture-host";
import {
  ReferenceCaptureBridgeController,
  type ReferenceCaptureProjection,
  type ReferenceCaptureProjectionHost,
} from "../reference-capture-bridge";

function view(overrides: Partial<ReferenceCaptureView> = {}): ReferenceCaptureView {
  return {
    sceneId: "capture-scene",
    utc: "2026-07-11T12:00:00Z",
    seed: 42,
    qualityTier: "High",
    exposure: 1.15,
    simulationTimeS: 900,
    effectTimeMs: 1_250,
    camera: {
      lat: 35,
      lon: 140,
      altitudeM: 1_500_000,
      headingDeg: 12,
      pitchDeg: -48,
      rollDeg: 0,
      verticalFovDeg: 55,
    },
    ...overrides,
  };
}

function projection(input: ReferenceCaptureView): ReferenceCaptureProjection {
  const requested = { ...RENDERER_QUALITY_PROFILES[input.qualityTier], exposure: input.exposure };
  return {
    renderer: "test-renderer",
    earthSession: getActiveEarthSession(),
    sunPositionEciM: { x: 1, y: 2, z: 3 },
    actualCamera: { ...input.camera },
    quality: {
      requested,
      effective: { ...requested },
    },
  };
}

class FakeProjectionHost implements ReferenceCaptureProjectionHost {
  calls: ReferenceCaptureView[] = [];
  failure: Error | null = null;

  applyReferenceView(input: ReferenceCaptureView): ReferenceCaptureProjection {
    this.calls.push(input);
    if (this.failure) throw this.failure;
    return projection(input);
  }
}

beforeEach(() => {
  window.__CATACLYSM_REFERENCE_CAPTURE__ = undefined;
  window.__CATACLYSM_APPLY_REFERENCE_VIEW__ = undefined;
  delete document.documentElement.dataset.referenceBridgeReady;
  delete document.documentElement.dataset.referenceEventReceived;
});

describe("ReferenceCaptureBridgeController", () => {
  it("owns the exact window event/global contract and publishes the capture runtime", () => {
    const host = new FakeProjectionHost();
    const controller = new ReferenceCaptureBridgeController(host);
    expect(controller.enable()).toBe(true);
    expect(controller.enable()).toBe(true);
    expect(document.documentElement.dataset.referenceBridgeReady).toBe("true");
    expect(window.__CATACLYSM_APPLY_REFERENCE_VIEW__).toBeTypeOf("function");

    const requested = view();
    window.__CATACLYSM_APPLY_REFERENCE_VIEW__?.(requested);
    expect(host.calls).toEqual([requested]);
    expect(document.documentElement.dataset.referenceEventReceived).toBe("capture-scene");
    expect(window.__CATACLYSM_REFERENCE_CAPTURE__).toEqual({
      ...requested,
      ready: true,
      ...projection(requested),
    });
    expect(controller.diagnostics()).toMatchObject({
      enabled: true,
      destroyed: false,
      owned_listener_count: 1,
      owned_global_count: 1,
      enable_count: 1,
      apply_count: 1,
      invalid_view_count: 0,
      failed_apply_count: 0,
      last_scene_id: "capture-scene",
    });

    controller.destroy();
    controller.destroy();
    expect(window.__CATACLYSM_APPLY_REFERENCE_VIEW__).toBeUndefined();
    expect(window.__CATACLYSM_REFERENCE_CAPTURE__).toBeUndefined();
    expect(document.documentElement.dataset.referenceBridgeReady).toBeUndefined();
    expect(document.documentElement.dataset.referenceEventReceived).toBeUndefined();
    expect(controller.diagnostics()).toMatchObject({
      enabled: false,
      destroyed: true,
      owned_listener_count: 0,
      owned_global_count: 0,
      destroy_count: 1,
    });
    expect(controller.enable()).toBe(false);
  });

  it("rejects malformed views and records renderer projection failures", () => {
    const host = new FakeProjectionHost();
    const controller = new ReferenceCaptureBridgeController(host);
    controller.enable();
    window.dispatchEvent(new CustomEvent(REFERENCE_CAPTURE_EVENT, {
      detail: view({ seed: Number.NaN }),
    }));
    expect(host.calls).toHaveLength(0);
    expect(controller.diagnostics().invalid_view_count).toBe(1);

    host.failure = new Error("viewer unavailable");
    window.__CATACLYSM_APPLY_REFERENCE_VIEW__?.(view({ sceneId: "failed-scene" }));
    expect(window.__CATACLYSM_REFERENCE_CAPTURE__).toBeUndefined();
    expect(document.documentElement.dataset.referenceEventReceived).toBe("failed-scene");
    expect(controller.diagnostics()).toMatchObject({
      apply_count: 0,
      failed_apply_count: 1,
      last_error: "viewer unavailable",
    });
    controller.destroy();
  });

  it("completes 100 enable/apply/destroy cycles with matched zero listener/global ownership", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    for (let cycle = 0; cycle < 100; cycle += 1) {
      const host = new FakeProjectionHost();
      const controller = new ReferenceCaptureBridgeController(host);
      controller.enable();
      window.__CATACLYSM_APPLY_REFERENCE_VIEW__?.(view({ sceneId: `scene-${cycle}`, seed: cycle }));
      expect(controller.diagnostics()).toMatchObject({
        owned_listener_count: 1,
        owned_global_count: 1,
        apply_count: 1,
      });
      controller.destroy();
      expect(controller.diagnostics()).toMatchObject({
        owned_listener_count: 0,
        owned_global_count: 0,
      });
      expect(window.__CATACLYSM_APPLY_REFERENCE_VIEW__).toBeUndefined();
      expect(window.__CATACLYSM_REFERENCE_CAPTURE__).toBeUndefined();
      expect(document.documentElement.dataset.referenceBridgeReady).toBeUndefined();
      expect(document.documentElement.dataset.referenceEventReceived).toBeUndefined();
    }
    const matchingAdds = add.mock.calls.filter(([name]) => name === REFERENCE_CAPTURE_EVENT);
    const matchingRemoves = remove.mock.calls.filter(([name]) => name === REFERENCE_CAPTURE_EVENT);
    expect(matchingAdds).toHaveLength(100);
    expect(matchingRemoves).toHaveLength(100);
    add.mockRestore();
    remove.mockRestore();
  });
});

describe("CesiumReferenceCaptureHost", () => {
  it("cancels flight before applying the exact camera pose and projects quality/sun/session", () => {
    const operations: string[] = [];
    const frustum = new Cesium.PerspectiveFrustum();
    frustum.fov = Cesium.Math.toRadians(60);
    let positionCartographic = Cesium.Cartographic.fromDegrees(0, 0, 0);
    const camera = {
      frustum,
      heading: 0,
      pitch: 0,
      roll: 0,
      get positionCartographic() {
        return positionCartographic;
      },
      cancelFlight() {
        operations.push("cancelFlight");
      },
      setView(options: {
        destination: Cesium.Cartesian3;
        orientation: { heading: number; pitch: number; roll: number };
      }) {
        operations.push("setView");
        positionCartographic = Cesium.Cartographic.fromCartesian(options.destination);
        this.heading = options.orientation.heading;
        this.pitch = options.orientation.pitch;
        this.roll = options.orientation.roll;
      },
    };
    const viewer = {
      isDestroyed: () => false,
      resolutionScale: 1,
      clock: {
        currentTime: Cesium.JulianDate.now(),
        shouldAnimate: true,
      },
      camera,
      scene: {
        requestRenderMode: false,
        maximumRenderTimeChange: 0,
        msaaSamples: 1,
        highDynamicRange: false,
        postProcessStages: {
          tonemapper: Cesium.Tonemapper.REINHARD,
          exposure: 1,
          fxaa: { enabled: false },
          bloom: { enabled: false },
        },
        globe: {
          maximumScreenSpaceError: 4,
          dynamicAtmosphereLighting: false,
          dynamicAtmosphereLightingFromSun: false,
        },
        fog: { enabled: false },
        requestRender() {
          operations.push("requestRender");
        },
      },
      resize() {
        operations.push("resize");
      },
    } as unknown as Cesium.Viewer;
    const requested = view();
    const result = new CesiumReferenceCaptureHost(viewer).applyReferenceView(requested);

    expect(operations).toEqual(["cancelFlight", "setView", "resize", "requestRender"]);
    expect(viewer.clock.shouldAnimate).toBe(false);
    expect(viewer.scene.requestRenderMode).toBe(true);
    expect(viewer.scene.maximumRenderTimeChange).toBe(Number.POSITIVE_INFINITY);
    expect(Cesium.Math.toDegrees(frustum.fov)).toBeCloseTo(55, 10);
    expect(result.renderer).toBe("CesiumJS 1.143.0");
    expect(result.actualCamera.lat).toBeCloseTo(35, 8);
    expect(result.actualCamera.lon).toBeCloseTo(140, 8);
    expect(result.actualCamera.altitudeM).toBeCloseTo(1_500_000, 5);
    expect(result.actualCamera.headingDeg).toBeCloseTo(12, 10);
    expect(result.actualCamera.pitchDeg).toBeCloseTo(-48, 10);
    expect(result.actualCamera.rollDeg).toBeCloseTo(0, 10);
    expect(result.actualCamera.verticalFovDeg).toBeCloseTo(55, 10);
    expect(Number.isFinite(result.sunPositionEciM.x)).toBe(true);
    expect(result.quality.requested.tier).toBe("High");
    expect(result.quality.requested.exposure).toBe(1.15);
    expect(result.earthSession).toEqual(getActiveEarthSession());
  });
});
