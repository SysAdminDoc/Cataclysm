import {
  REFERENCE_CAPTURE_EVENT,
  type ReferenceCaptureRuntime,
  type ReferenceCaptureView,
} from "../../lib/reference-capture";

export type ReferenceCaptureProjection = Pick<
  ReferenceCaptureRuntime,
  "renderer" | "earthSession" | "sunPositionEciM" | "actualCamera" | "quality"
>;

export interface ReferenceCaptureProjectionHost {
  applyReferenceView(view: ReferenceCaptureView): ReferenceCaptureProjection;
}

export type ReferenceCaptureBridgeDiagnostics = Readonly<{
  enabled: boolean;
  destroyed: boolean;
  owned_listener_count: 0 | 1;
  owned_global_count: 0 | 1;
  enable_count: number;
  apply_count: number;
  invalid_view_count: number;
  failed_apply_count: number;
  destroy_count: number;
  last_scene_id: string | null;
  last_error: string | null;
}>;

const QUALITY_TIERS = new Set(["Low", "Medium", "High", "Cinematic"]);

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validView(value: unknown): value is ReferenceCaptureView {
  if (!value || typeof value !== "object") return false;
  const view = value as Partial<ReferenceCaptureView>;
  const camera = view.camera;
  return typeof view.sceneId === "string"
    && view.sceneId.length > 0
    && typeof view.utc === "string"
    && view.utc.length > 0
    && finite(view.seed)
    && typeof view.qualityTier === "string"
    && QUALITY_TIERS.has(view.qualityTier)
    && finite(view.exposure)
    && finite(view.simulationTimeS)
    && finite(view.effectTimeMs)
    && !!camera
    && finite(camera.lat)
    && camera.lat >= -90
    && camera.lat <= 90
    && finite(camera.lon)
    && camera.lon >= -180
    && camera.lon <= 180
    && finite(camera.altitudeM)
    && finite(camera.headingDeg)
    && finite(camera.pitchDeg)
    && finite(camera.rollDeg)
    && finite(camera.verticalFovDeg)
    && camera.verticalFovDeg > 0
    && camera.verticalFovDeg < 180;
}

/** Owns the exact HR-00 browser event/global contract around an injected renderer projection. */
export class ReferenceCaptureBridgeController {
  readonly #host: ReferenceCaptureProjectionHost;
  readonly #listener: (event: Event) => void;
  readonly #globalBridge: (view: ReferenceCaptureView) => void;
  #enabled = false;
  #destroyed = false;
  #enableCount = 0;
  #applyCount = 0;
  #invalidViewCount = 0;
  #failedApplyCount = 0;
  #destroyCount = 0;
  #lastSceneId: string | null = null;
  #lastError: string | null = null;

  constructor(host: ReferenceCaptureProjectionHost) {
    this.#host = host;
    this.#listener = (event) => this.#apply((event as CustomEvent<unknown>).detail);
    this.#globalBridge = (view) => {
      window.dispatchEvent(new CustomEvent(REFERENCE_CAPTURE_EVENT, { detail: view }));
    };
  }

  enable(): boolean {
    if (this.#destroyed) return false;
    if (this.#enabled) return true;
    document.documentElement.dataset.referenceBridgeReady = "true";
    window.__CATACLYSM_APPLY_REFERENCE_VIEW__ = this.#globalBridge;
    window.addEventListener(REFERENCE_CAPTURE_EVENT, this.#listener);
    this.#enabled = true;
    this.#enableCount += 1;
    return true;
  }

  destroy(): void {
    if (this.#destroyed) return;
    if (this.#enabled) {
      window.removeEventListener(REFERENCE_CAPTURE_EVENT, this.#listener);
      this.#enabled = false;
    }
    if (window.__CATACLYSM_APPLY_REFERENCE_VIEW__ === this.#globalBridge) {
      window.__CATACLYSM_APPLY_REFERENCE_VIEW__ = undefined;
    }
    window.__CATACLYSM_REFERENCE_CAPTURE__ = undefined;
    delete document.documentElement.dataset.referenceBridgeReady;
    delete document.documentElement.dataset.referenceEventReceived;
    this.#destroyed = true;
    this.#destroyCount += 1;
  }

  diagnostics(): ReferenceCaptureBridgeDiagnostics {
    return Object.freeze({
      enabled: this.#enabled,
      destroyed: this.#destroyed,
      owned_listener_count: this.#enabled ? 1 : 0,
      owned_global_count: this.#enabled && window.__CATACLYSM_APPLY_REFERENCE_VIEW__ === this.#globalBridge ? 1 : 0,
      enable_count: this.#enableCount,
      apply_count: this.#applyCount,
      invalid_view_count: this.#invalidViewCount,
      failed_apply_count: this.#failedApplyCount,
      destroy_count: this.#destroyCount,
      last_scene_id: this.#lastSceneId,
      last_error: this.#lastError,
    });
  }

  #apply(value: unknown): void {
    if (!this.#enabled || this.#destroyed) return;
    if (!validView(value)) {
      this.#invalidViewCount += 1;
      return;
    }
    document.documentElement.dataset.referenceEventReceived = value.sceneId;
    try {
      const projection = this.#host.applyReferenceView(value);
      const runtime: ReferenceCaptureRuntime = {
        ...value,
        ready: true,
        ...projection,
      };
      window.__CATACLYSM_REFERENCE_CAPTURE__ = runtime;
      this.#applyCount += 1;
      this.#lastSceneId = value.sceneId;
      this.#lastError = null;
    } catch (error) {
      this.#failedApplyCount += 1;
      this.#lastError = error instanceof Error ? error.message : String(error);
    }
  }
}
