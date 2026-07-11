export type RendererClockMode = "raf" | "manual";

export interface RendererSimulationFrame {
  solverTick: number;
  simulationTimeS: number;
}

export interface RendererClockDiagnostics {
  mode: RendererClockMode;
  running: boolean;
  destroyed: boolean;
  ownedCallbackCount: 0 | 1;
  requestedCallbackCount: number;
  cancelledCallbackCount: number;
  firedCallbackCount: number;
  deliveredFrameCount: number;
  startCount: number;
  stopCount: number;
  resetCount: number;
  solverTick: number;
  simulationTimeS: number;
}

export interface RendererClockOptions {
  mode: RendererClockMode;
  onFrame: (frame: Readonly<RendererSimulationFrame>) => void;
  initialFrame?: RendererSimulationFrame;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
}

const INITIAL_FRAME: RendererSimulationFrame = {
  solverTick: 0,
  simulationTimeS: 0,
};

function validateFrame(frame: RendererSimulationFrame): RendererSimulationFrame {
  if (!Number.isSafeInteger(frame.solverTick) || frame.solverTick < 0) {
    throw new RangeError("renderer clock solverTick must be a non-negative safe integer");
  }
  if (!Number.isFinite(frame.simulationTimeS) || frame.simulationTimeS < 0) {
    throw new RangeError("renderer clock simulationTimeS must be finite and non-negative");
  }
  return {
    solverTick: frame.solverTick,
    simulationTimeS: frame.simulationTimeS,
  };
}

/**
 * Presentation-only renderer clock. Simulation tick and time are supplied by
 * the replay/solver boundary; this class never derives or integrates physics.
 */
export class RendererClock {
  readonly mode: RendererClockMode;

  private onFrame: RendererClockOptions["onFrame"] | null;
  private readonly requestFrame: ((callback: FrameRequestCallback) => number) | null;
  private readonly cancelFrame: ((handle: number) => void) | null;
  private frame: RendererSimulationFrame;
  private callbackHandle: number | null = null;
  private running = false;
  private destroyed = false;
  private requestedCallbackCount = 0;
  private cancelledCallbackCount = 0;
  private firedCallbackCount = 0;
  private deliveredFrameCount = 0;
  private startCount = 0;
  private stopCount = 0;
  private resetCount = 0;

  constructor(options: RendererClockOptions) {
    this.mode = options.mode;
    this.onFrame = options.onFrame;
    this.frame = validateFrame(options.initialFrame ?? INITIAL_FRAME);

    if (this.mode === "raf") {
      const request = options.requestFrame ?? globalThis.requestAnimationFrame?.bind(globalThis);
      const cancel = options.cancelFrame ?? globalThis.cancelAnimationFrame?.bind(globalThis);
      if (!request || !cancel) {
        throw new Error("RAF renderer clock requires requestAnimationFrame and cancelAnimationFrame");
      }
      this.requestFrame = request;
      this.cancelFrame = cancel;
    } else {
      this.requestFrame = null;
      this.cancelFrame = null;
    }
  }

  start(): void {
    if (this.destroyed || this.running) return;
    this.running = true;
    this.startCount += 1;
    if (this.mode === "raf") this.scheduleFrame();
  }

  stop(): void {
    if (this.destroyed || !this.running) return;
    this.running = false;
    this.stopCount += 1;
    this.cancelOwnedCallback();
  }

  reset(frame: RendererSimulationFrame = INITIAL_FRAME): void {
    if (this.destroyed) return;
    if (this.running) this.stop();
    this.frame = validateFrame(frame);
    this.resetCount += 1;
  }

  destroy(): void {
    if (this.destroyed) return;
    if (this.running) this.stop();
    this.cancelOwnedCallback();
    this.onFrame = null;
    this.destroyed = true;
  }

  /**
   * Supplies the authoritative simulation position. Manual clocks present it
   * synchronously while running; RAF clocks present the latest position on the
   * next browser animation callback.
   */
  present(frame: RendererSimulationFrame): boolean {
    if (this.destroyed) return false;
    this.frame = validateFrame(frame);
    if (!this.running) return false;
    if (this.mode === "manual") this.deliverFrame();
    return true;
  }

  diagnostics(): RendererClockDiagnostics {
    return {
      mode: this.mode,
      running: this.running,
      destroyed: this.destroyed,
      ownedCallbackCount: this.callbackHandle === null ? 0 : 1,
      requestedCallbackCount: this.requestedCallbackCount,
      cancelledCallbackCount: this.cancelledCallbackCount,
      firedCallbackCount: this.firedCallbackCount,
      deliveredFrameCount: this.deliveredFrameCount,
      startCount: this.startCount,
      stopCount: this.stopCount,
      resetCount: this.resetCount,
      solverTick: this.frame.solverTick,
      simulationTimeS: this.frame.simulationTimeS,
    };
  }

  private scheduleFrame(): void {
    if (!this.running || this.destroyed || this.callbackHandle !== null || !this.requestFrame) {
      return;
    }
    this.callbackHandle = this.requestFrame(this.handleAnimationFrame);
    this.requestedCallbackCount += 1;
  }

  private readonly handleAnimationFrame: FrameRequestCallback = () => {
    if (this.callbackHandle === null) return;
    this.callbackHandle = null;
    this.firedCallbackCount += 1;
    if (!this.running || this.destroyed) return;
    try {
      this.deliverFrame();
    } finally {
      this.scheduleFrame();
    }
  };

  private deliverFrame(): void {
    const callback = this.onFrame;
    if (!callback) return;
    this.deliveredFrameCount += 1;
    callback({
      solverTick: this.frame.solverTick,
      simulationTimeS: this.frame.simulationTimeS,
    });
  }

  private cancelOwnedCallback(): void {
    if (this.callbackHandle === null) return;
    this.cancelFrame?.(this.callbackHandle);
    this.callbackHandle = null;
    this.cancelledCallbackCount += 1;
  }
}
