import type * as Cesium from "cesium";
import { applyRendererQualityProfile } from "../../rendering/quality-profiles";
import {
  RendererQualityController,
  RENDERER_QUALITY_BUDGETS,
  type RendererQualityDiagnostics,
  type RendererQualityTier,
} from "./quality-controller";

export interface RendererAdapterDiagnostics {
  vendor: string;
  renderer: string;
  webglVersion: string;
}

export interface CesiumQualityDiagnostics extends RendererQualityDiagnostics {
  automatic: boolean;
  targetWidth: number;
  targetHeight: number;
  targetFps: number;
  targetFrameTimeMs: number;
  adapter: RendererAdapterDiagnostics;
}

export interface CesiumQualityRuntimeOptions {
  requestedTier: RendererQualityTier;
  automatic: boolean;
  publishGlobal?: boolean;
  onDiagnostics?: (diagnostics: CesiumQualityDiagnostics) => void;
  onRecoverableError?: (message: string | null) => void;
}

let currentDiagnostics: CesiumQualityDiagnostics | null = null;

declare global {
  interface Window {
    __CATACLYSM_RENDERER_DIAGNOSTICS__?: () => CesiumQualityDiagnostics | null;
  }
}

export function getRendererQualityDiagnostics(): CesiumQualityDiagnostics | null {
  return currentDiagnostics ? structuredClone(currentDiagnostics) : null;
}

function adapterDiagnostics(canvas: HTMLCanvasElement): RendererAdapterDiagnostics {
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  if (!gl) return { vendor: "unavailable", renderer: "unavailable", webglVersion: "unavailable" };
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const vendor = debug ? String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)) : String(gl.getParameter(gl.VENDOR));
  const renderer = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  return { vendor, renderer, webglVersion: String(gl.getParameter(gl.VERSION)) };
}

function applyRuntimeTier(viewer: Cesium.Viewer, tier: RendererQualityTier): void {
  applyRendererQualityProfile(viewer, tier);
  viewer.resolutionScale = RENDERER_QUALITY_BUDGETS[tier].resolution.resolutionScale;
}

/** Applies visual-only budgets and owns frame telemetry/context recovery listeners. */
export class CesiumQualityRuntime {
  readonly #viewer: Cesium.Viewer;
  readonly #automatic: boolean;
  readonly #controller: RendererQualityController;
  readonly #onDiagnostics?: (diagnostics: CesiumQualityDiagnostics) => void;
  readonly #onRecoverableError?: (message: string | null) => void;
  readonly #publishGlobal: boolean;
  readonly #canvas: HTMLCanvasElement;
  readonly #removePostRender: () => void;
  readonly #contextLost: (event: Event) => void;
  readonly #contextRestored: () => void;
  readonly #adapter: RendererAdapterDiagnostics;
  #lastFrameAt: number | null = null;
  #lastUiPublishAt = 0;
  #destroyed = false;

  constructor(viewer: Cesium.Viewer, options: CesiumQualityRuntimeOptions) {
    this.#viewer = viewer;
    this.#automatic = options.automatic;
    this.#onDiagnostics = options.onDiagnostics;
    this.#onRecoverableError = options.onRecoverableError;
    this.#publishGlobal = options.publishGlobal ?? true;
    this.#canvas = viewer.canvas;
    this.#adapter = adapterDiagnostics(this.#canvas);
    this.#controller = new RendererQualityController({
      requestedTier: options.requestedTier,
      automatic: options.automatic,
      onTierChanged: (tier, _budget, decision) => {
        if (!this.#destroyed && !this.#viewer.isDestroyed()) {
          try {
            applyRuntimeTier(this.#viewer, tier);
            this.#viewer.scene.requestRender();
            console.info(`[renderer] quality ${tier} (${decision})`);
          } catch (error) {
            // A lost WebGL context may reject state writes. The context-loss
            // handler below still publishes recovery UX and preserves state.
            console.warn(`[renderer] could not apply ${tier} during ${decision}`, error);
          }
        }
        this.#publish();
      },
    });
    applyRuntimeTier(viewer, options.requestedTier);
    this.#removePostRender = viewer.scene.postRender.addEventListener(() => this.#recordFrame());
    this.#contextLost = (event) => {
      event.preventDefault();
      this.#controller.reportGpuLoss("Graphics context was lost. Simulation state is safe; reset the renderer to continue.");
      this.#onRecoverableError?.(this.#controller.diagnostics().gpuMessage ?? "Graphics context lost.");
      this.#publish();
    };
    this.#contextRestored = () => {
      if (!this.#controller.beginGpuReset()) return;
      try {
        applyRuntimeTier(this.#viewer, options.requestedTier);
        this.#viewer.scene.requestRender();
        this.#controller.completeGpuReset(true);
        this.#onRecoverableError?.(null);
      } catch (error) {
        const message = `Graphics context restored, but renderer reset failed: ${String(error)}`;
        this.#controller.completeGpuReset(false, message);
        this.#onRecoverableError?.(message);
      }
      this.#publish();
    };
    this.#canvas.addEventListener("webglcontextlost", this.#contextLost, false);
    this.#canvas.addEventListener("webglcontextrestored", this.#contextRestored, false);
    this.#publish();
  }

  diagnostics(): CesiumQualityDiagnostics {
    const controller = this.#controller.diagnostics();
    const budget = this.#controller.budget();
    return {
      ...controller,
      automatic: this.#automatic,
      targetWidth: budget.resolution.width,
      targetHeight: budget.resolution.height,
      targetFps: budget.targetFps,
      targetFrameTimeMs: budget.targetFrameTimeMs,
      adapter: { ...this.#adapter },
    };
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#removePostRender();
    this.#canvas.removeEventListener("webglcontextlost", this.#contextLost, false);
    this.#canvas.removeEventListener("webglcontextrestored", this.#contextRestored, false);
    if (this.#publishGlobal) currentDiagnostics = null;
  }

  #recordFrame(): void {
    const now = performance.now();
    if (this.#lastFrameAt !== null) {
      const elapsed = now - this.#lastFrameAt;
      // Ignore background-tab stalls; they describe scheduling, not GPU throughput.
      if (elapsed > 0 && elapsed < 250) this.#controller.recordFrameTime(elapsed);
    }
    this.#lastFrameAt = now;
    this.#publish(false);
  }

  #publish(force = true): void {
    const now = performance.now();
    if (!force && now - this.#lastUiPublishAt < 500) return;
    this.#lastUiPublishAt = now;
    const diagnostics = this.diagnostics();
    if (this.#publishGlobal) currentDiagnostics = diagnostics;
    if (this.#publishGlobal && typeof window !== "undefined") {
      window.__CATACLYSM_RENDERER_DIAGNOSTICS__ = getRendererQualityDiagnostics;
    }
    this.#onDiagnostics?.(diagnostics);
  }
}
