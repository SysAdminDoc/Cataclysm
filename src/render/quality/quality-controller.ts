export const RENDERER_QUALITY_TIERS = ["Low", "Medium", "High", "Cinematic"] as const;
export type RendererQualityTier = (typeof RENDERER_QUALITY_TIERS)[number];

export interface RendererResolutionBudget {
  width: number;
  height: number;
  pixelCount: number;
  resolutionScale: number;
}

export interface RendererFeatureBudget {
  msaaSamples: 1 | 2 | 4 | 8;
  maximumScreenSpaceError: number;
  shadowMapSize: 0 | 1024 | 2048 | 4096;
  volumetricSampleCount: 0 | 24 | 48 | 96;
  maximumParticles: number;
  maximumDynamicLights: 0 | 2 | 8 | 16;
  anisotropy: 2 | 4 | 8 | 16;
  cloudLayers: 0 | 1 | 2 | 3;
  waterReflectionScale: 0 | 0.5 | 0.75 | 1;
  terrainShadows: boolean;
  volumetricClouds: boolean;
  waterReflections: boolean;
  ambientOcclusion: boolean;
  bloom: boolean;
  scientificFieldPolicy: "passthrough_required";
}

export interface RendererGpuBudget {
  totalMemoryMb: 512 | 1024 | 2048 | 4096;
  textureMemoryMb: 256 | 512 | 1024 | 2048;
  geometryMemoryMb: 128 | 256 | 512 | 1024;
  transientMemoryMb: 128 | 256 | 512 | 1024;
}

export interface RendererQualityBudget {
  tier: RendererQualityTier;
  resolution: RendererResolutionBudget;
  targetFps: 30 | 60;
  targetFrameTimeMs: number;
  gpu: RendererGpuBudget;
  features: RendererFeatureBudget;
}

function budget(
  tier: RendererQualityTier,
  width: number,
  height: number,
  targetFps: 30 | 60,
  resolutionScale: number,
  gpu: RendererGpuBudget,
  features: Omit<RendererFeatureBudget, "scientificFieldPolicy">,
): RendererQualityBudget {
  return Object.freeze({
    tier,
    resolution: Object.freeze({
      width,
      height,
      pixelCount: width * height,
      resolutionScale,
    }),
    targetFps,
    targetFrameTimeMs: 1_000 / targetFps,
    gpu: Object.freeze(gpu),
    features: Object.freeze({
      ...features,
      scientificFieldPolicy: "passthrough_required" as const,
    }),
  });
}

export const RENDERER_QUALITY_BUDGETS: Readonly<
  Record<RendererQualityTier, RendererQualityBudget>
> = Object.freeze({
  Low: budget("Low", 1_280, 720, 60, 0.75, {
    totalMemoryMb: 512,
    textureMemoryMb: 256,
    geometryMemoryMb: 128,
    transientMemoryMb: 128,
  }, {
    msaaSamples: 1,
    maximumScreenSpaceError: 4,
    shadowMapSize: 0,
    volumetricSampleCount: 0,
    maximumParticles: 10_000,
    maximumDynamicLights: 0,
    anisotropy: 2,
    cloudLayers: 0,
    waterReflectionScale: 0,
    terrainShadows: false,
    volumetricClouds: false,
    waterReflections: false,
    ambientOcclusion: false,
    bloom: false,
  }),
  Medium: budget("Medium", 1_920, 1_080, 60, 1, {
    totalMemoryMb: 1_024,
    textureMemoryMb: 512,
    geometryMemoryMb: 256,
    transientMemoryMb: 256,
  }, {
    msaaSamples: 2,
    maximumScreenSpaceError: 2.5,
    shadowMapSize: 1_024,
    volumetricSampleCount: 24,
    maximumParticles: 30_000,
    maximumDynamicLights: 2,
    anisotropy: 4,
    cloudLayers: 1,
    waterReflectionScale: 0.5,
    terrainShadows: false,
    volumetricClouds: false,
    waterReflections: true,
    ambientOcclusion: false,
    bloom: false,
  }),
  High: budget("High", 2_560, 1_440, 60, 1, {
    totalMemoryMb: 2_048,
    textureMemoryMb: 1_024,
    geometryMemoryMb: 512,
    transientMemoryMb: 512,
  }, {
    msaaSamples: 4,
    maximumScreenSpaceError: 1.5,
    shadowMapSize: 2_048,
    volumetricSampleCount: 48,
    maximumParticles: 80_000,
    maximumDynamicLights: 8,
    anisotropy: 8,
    cloudLayers: 2,
    waterReflectionScale: 0.75,
    terrainShadows: true,
    volumetricClouds: true,
    waterReflections: true,
    ambientOcclusion: true,
    bloom: false,
  }),
  Cinematic: budget("Cinematic", 3_840, 2_160, 30, 1, {
    totalMemoryMb: 4_096,
    textureMemoryMb: 2_048,
    geometryMemoryMb: 1_024,
    transientMemoryMb: 1_024,
  }, {
    msaaSamples: 8,
    maximumScreenSpaceError: 1,
    shadowMapSize: 4_096,
    volumetricSampleCount: 96,
    maximumParticles: 200_000,
    maximumDynamicLights: 16,
    anisotropy: 16,
    cloudLayers: 3,
    waterReflectionScale: 1,
    terrainShadows: true,
    volumetricClouds: true,
    waterReflections: true,
    ambientOcclusion: true,
    bloom: true,
  }),
});

export interface QualityHysteresisPolicy {
  rollingWindowSamples: number;
  minimumSamples: number;
  evaluationIntervalSamples: number;
  consecutiveEvaluations: number;
  downgradeFrameTimeRatio: number;
  recoveryFrameTimeRatio: number;
}

export const DEFAULT_QUALITY_HYSTERESIS: Readonly<QualityHysteresisPolicy> = Object.freeze({
  rollingWindowSamples: 120,
  minimumSamples: 60,
  evaluationIntervalSamples: 30,
  consecutiveEvaluations: 2,
  downgradeFrameTimeRatio: 1.15,
  recoveryFrameTimeRatio: 0.8,
});

export type GpuRecoveryState = "ready" | "lost" | "resetting" | "recoverable_error";
export type QualityDecision =
  | "none"
  | "performance_downgrade"
  | "performance_recovery"
  | "requested_cap"
  | "gpu_loss";

export interface ScientificRendererFrame<Fields = unknown> {
  readonly solver_tick: number;
  readonly simulation_time_s: number;
  readonly tick_duration_s: number;
  readonly fields: Fields;
}

export interface RendererFramePolicy<Frame extends ScientificRendererFrame> {
  readonly scientificFrame: Frame;
  readonly qualityBudget: RendererQualityBudget;
}

export interface RendererQualityDiagnostics {
  requestedTier: RendererQualityTier;
  activeTier: RendererQualityTier;
  gpuState: GpuRecoveryState;
  gpuMessage: string | null;
  recoverable: boolean;
  rollingSampleCount: number;
  rollingMeanFrameTimeMs: number | null;
  rollingP95FrameTimeMs: number | null;
  downgradeStreak: number;
  recoveryStreak: number;
  downgradeCount: number;
  recoveryCount: number;
  gpuLossCount: number;
  gpuResetAttemptCount: number;
  gpuResetSuccessCount: number;
  gpuResetFailureCount: number;
  ignoredFrameSampleCount: number;
  lastDecision: QualityDecision;
}

export interface RendererQualityControllerOptions {
  requestedTier?: RendererQualityTier;
  automatic?: boolean;
  hysteresis?: Partial<QualityHysteresisPolicy>;
  onTierChanged?: (
    tier: RendererQualityTier,
    budget: RendererQualityBudget,
    decision: QualityDecision,
  ) => void;
}

function tierIndex(tier: RendererQualityTier): number {
  return RENDERER_QUALITY_TIERS.indexOf(tier);
}

function percentile95(samples: readonly number[]): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

/** Returns the exact authoritative object; renderer quality may not rewrite it. */
export function passthroughScientificFrame<Frame extends ScientificRendererFrame>(
  frame: Frame,
): Frame {
  return frame;
}

export class RendererQualityController {
  private requestedTier: RendererQualityTier;
  private activeTier: RendererQualityTier;
  private readonly automatic: boolean;
  private readonly hysteresis: QualityHysteresisPolicy;
  private readonly onTierChanged: RendererQualityControllerOptions["onTierChanged"];
  private samples: number[] = [];
  private samplesSinceEvaluation = 0;
  private downgradeStreak = 0;
  private recoveryStreak = 0;
  private downgradeCount = 0;
  private recoveryCount = 0;
  private gpuState: GpuRecoveryState = "ready";
  private gpuMessage: string | null = null;
  private gpuLossCount = 0;
  private gpuResetAttemptCount = 0;
  private gpuResetSuccessCount = 0;
  private gpuResetFailureCount = 0;
  private ignoredFrameSampleCount = 0;
  private lastDecision: QualityDecision = "none";

  constructor(options: RendererQualityControllerOptions = {}) {
    this.requestedTier = options.requestedTier ?? "High";
    this.activeTier = this.requestedTier;
    this.automatic = options.automatic ?? true;
    this.hysteresis = {
      ...DEFAULT_QUALITY_HYSTERESIS,
      ...options.hysteresis,
    };
    this.validateHysteresis();
    this.onTierChanged = options.onTierChanged;
  }

  budget(): RendererQualityBudget {
    return RENDERER_QUALITY_BUDGETS[this.activeTier];
  }

  setRequestedTier(tier: RendererQualityTier): void {
    this.requestedTier = tier;
    if (tierIndex(this.activeTier) > tierIndex(tier)) {
      this.changeTier(tier, "requested_cap");
    }
  }

  recordFrameTime(frameTimeMs: number): RendererQualityTier {
    if (!Number.isFinite(frameTimeMs) || frameTimeMs <= 0) {
      throw new RangeError("renderer frame time must be finite and greater than zero");
    }
    if (this.gpuState !== "ready") {
      this.ignoredFrameSampleCount += 1;
      return this.activeTier;
    }
    this.samples.push(frameTimeMs);
    if (this.samples.length > this.hysteresis.rollingWindowSamples) this.samples.shift();
    this.samplesSinceEvaluation += 1;
    if (
      this.automatic &&
      this.samples.length >= this.hysteresis.minimumSamples &&
      this.samplesSinceEvaluation >= this.hysteresis.evaluationIntervalSamples
    ) {
      this.samplesSinceEvaluation = 0;
      this.evaluatePerformance();
    }
    return this.activeTier;
  }

  reportGpuLoss(message = "GPU context lost. Renderer can be reset."): void {
    if (this.gpuState === "lost") return;
    this.gpuState = "lost";
    this.gpuMessage = message;
    this.gpuLossCount += 1;
    if (this.activeTier !== "Low") this.changeTier("Low", "gpu_loss");
    else {
      this.lastDecision = "gpu_loss";
      this.clearPerformanceHistory();
    }
  }

  beginGpuReset(): boolean {
    if (this.gpuState !== "lost" && this.gpuState !== "recoverable_error") return false;
    this.gpuState = "resetting";
    this.gpuResetAttemptCount += 1;
    return true;
  }

  completeGpuReset(success: boolean, message?: string): boolean {
    if (this.gpuState !== "resetting") return false;
    if (success) {
      this.gpuState = "ready";
      this.gpuMessage = null;
      this.gpuResetSuccessCount += 1;
      if (this.activeTier !== this.requestedTier) {
        this.recoveryCount += 1;
        this.changeTier(this.requestedTier, "performance_recovery");
      } else {
        this.clearPerformanceHistory();
      }
    } else {
      this.gpuState = "recoverable_error";
      this.gpuMessage = message ?? "GPU reset failed. Retry is available.";
      this.gpuResetFailureCount += 1;
    }
    return true;
  }

  policyFor<Frame extends ScientificRendererFrame>(frame: Frame): RendererFramePolicy<Frame> {
    return Object.freeze({
      scientificFrame: passthroughScientificFrame(frame),
      qualityBudget: this.budget(),
    });
  }

  diagnostics(): RendererQualityDiagnostics {
    const mean = this.samples.length === 0
      ? null
      : this.samples.reduce((sum, sample) => sum + sample, 0) / this.samples.length;
    return {
      requestedTier: this.requestedTier,
      activeTier: this.activeTier,
      gpuState: this.gpuState,
      gpuMessage: this.gpuMessage,
      recoverable: this.gpuState !== "ready",
      rollingSampleCount: this.samples.length,
      rollingMeanFrameTimeMs: mean,
      rollingP95FrameTimeMs: percentile95(this.samples),
      downgradeStreak: this.downgradeStreak,
      recoveryStreak: this.recoveryStreak,
      downgradeCount: this.downgradeCount,
      recoveryCount: this.recoveryCount,
      gpuLossCount: this.gpuLossCount,
      gpuResetAttemptCount: this.gpuResetAttemptCount,
      gpuResetSuccessCount: this.gpuResetSuccessCount,
      gpuResetFailureCount: this.gpuResetFailureCount,
      ignoredFrameSampleCount: this.ignoredFrameSampleCount,
      lastDecision: this.lastDecision,
    };
  }

  private evaluatePerformance(): void {
    const p95 = percentile95(this.samples);
    if (p95 === null) return;
    const activeIndex = tierIndex(this.activeTier);
    const downgradeThreshold = this.budget().targetFrameTimeMs *
      this.hysteresis.downgradeFrameTimeRatio;
    if (p95 > downgradeThreshold && activeIndex > 0) {
      this.downgradeStreak += 1;
      this.recoveryStreak = 0;
      if (this.downgradeStreak >= this.hysteresis.consecutiveEvaluations) {
        this.downgradeCount += 1;
        this.changeTier(RENDERER_QUALITY_TIERS[activeIndex - 1], "performance_downgrade");
      }
      return;
    }

    const requestedIndex = tierIndex(this.requestedTier);
    if (activeIndex < requestedIndex) {
      const nextTier = RENDERER_QUALITY_TIERS[activeIndex + 1];
      const recoveryThreshold = RENDERER_QUALITY_BUDGETS[nextTier].targetFrameTimeMs *
        this.hysteresis.recoveryFrameTimeRatio;
      if (p95 < recoveryThreshold) {
        this.recoveryStreak += 1;
        this.downgradeStreak = 0;
        if (this.recoveryStreak >= this.hysteresis.consecutiveEvaluations) {
          this.recoveryCount += 1;
          this.changeTier(nextTier, "performance_recovery");
        }
        return;
      }
    }
    this.downgradeStreak = 0;
    this.recoveryStreak = 0;
  }

  private changeTier(tier: RendererQualityTier, decision: QualityDecision): void {
    if (tier === this.activeTier) return;
    this.activeTier = tier;
    this.lastDecision = decision;
    this.clearPerformanceHistory();
    this.onTierChanged?.(tier, this.budget(), decision);
  }

  private clearPerformanceHistory(): void {
    this.samples = [];
    this.samplesSinceEvaluation = 0;
    this.downgradeStreak = 0;
    this.recoveryStreak = 0;
  }

  private validateHysteresis(): void {
    const policy = this.hysteresis;
    if (
      !Number.isSafeInteger(policy.rollingWindowSamples) ||
      !Number.isSafeInteger(policy.minimumSamples) ||
      !Number.isSafeInteger(policy.evaluationIntervalSamples) ||
      !Number.isSafeInteger(policy.consecutiveEvaluations) ||
      policy.minimumSamples <= 0 ||
      policy.rollingWindowSamples < policy.minimumSamples ||
      policy.evaluationIntervalSamples <= 0 ||
      policy.consecutiveEvaluations <= 0 ||
      !Number.isFinite(policy.downgradeFrameTimeRatio) ||
      policy.downgradeFrameTimeRatio <= 1 ||
      !Number.isFinite(policy.recoveryFrameTimeRatio) ||
      policy.recoveryFrameTimeRatio <= 0 ||
      policy.recoveryFrameTimeRatio >= 1
    ) {
      throw new RangeError("invalid renderer quality hysteresis policy");
    }
  }
}
