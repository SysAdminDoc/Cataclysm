import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUALITY_HYSTERESIS,
  RENDERER_QUALITY_BUDGETS,
  RENDERER_QUALITY_TIERS,
  RendererQualityController,
  passthroughScientificFrame,
  type QualityDecision,
  type RendererQualityTier,
} from "../quality-controller";

function feedUntilTier(
  controller: RendererQualityController,
  frameTimeMs: number,
  tier: RendererQualityTier,
): void {
  for (let sample = 0; sample < 1_000 && controller.diagnostics().activeTier !== tier; sample += 1) {
    controller.recordFrameTime(frameTimeMs);
  }
  expect(controller.diagnostics().activeTier).toBe(tier);
}

describe("renderer quality budgets", () => {
  it("defines exact ordered resolution, frame, and visual feature budgets", () => {
    expect(RENDERER_QUALITY_TIERS).toEqual(["Low", "Medium", "High", "Cinematic"]);
    expect(RENDERER_QUALITY_BUDGETS.Low).toMatchObject({
      resolution: { width: 1_280, height: 720, pixelCount: 921_600, resolutionScale: 0.75 },
      targetFps: 60,
      gpu: { totalMemoryMb: 512, textureMemoryMb: 256, geometryMemoryMb: 128, transientMemoryMb: 128 },
      features: { msaaSamples: 1, maximumParticles: 10_000, volumetricSampleCount: 0 },
    });
    expect(RENDERER_QUALITY_BUDGETS.Medium).toMatchObject({
      resolution: { width: 1_920, height: 1_080, pixelCount: 2_073_600 },
      targetFps: 60,
      gpu: { totalMemoryMb: 1_024, textureMemoryMb: 512, geometryMemoryMb: 256, transientMemoryMb: 256 },
      features: { msaaSamples: 2, maximumParticles: 30_000, volumetricSampleCount: 24 },
    });
    expect(RENDERER_QUALITY_BUDGETS.High).toMatchObject({
      resolution: { width: 2_560, height: 1_440, pixelCount: 3_686_400 },
      targetFps: 60,
      targetFrameTimeMs: 1_000 / 60,
      gpu: { totalMemoryMb: 2_048, textureMemoryMb: 1_024, geometryMemoryMb: 512, transientMemoryMb: 512 },
      features: { msaaSamples: 4, maximumParticles: 80_000, volumetricSampleCount: 48 },
    });
    expect(RENDERER_QUALITY_BUDGETS.Cinematic).toMatchObject({
      resolution: { width: 3_840, height: 2_160, pixelCount: 8_294_400 },
      targetFps: 30,
      targetFrameTimeMs: 1_000 / 30,
      gpu: { totalMemoryMb: 4_096, textureMemoryMb: 2_048, geometryMemoryMb: 1_024, transientMemoryMb: 1_024 },
      features: { msaaSamples: 8, maximumParticles: 200_000, volumetricSampleCount: 96 },
    });
    for (const tier of RENDERER_QUALITY_TIERS) {
      expect(RENDERER_QUALITY_BUDGETS[tier].features.scientificFieldPolicy).toBe(
        "passthrough_required",
      );
      expect(Object.isFrozen(RENDERER_QUALITY_BUDGETS[tier])).toBe(true);
      expect(Object.isFrozen(RENDERER_QUALITY_BUDGETS[tier].features)).toBe(true);
      expect(Object.isFrozen(RENDERER_QUALITY_BUDGETS[tier].gpu)).toBe(true);
    }
  });
});

describe("RendererQualityController", () => {
  it("holds the High 2560x1440 target at a stable 60 fps", () => {
    const controller = new RendererQualityController({ requestedTier: "High" });
    for (let frame = 0; frame < 600; frame += 1) {
      controller.recordFrameTime(1_000 / 60);
    }
    expect(controller.budget()).toBe(RENDERER_QUALITY_BUDGETS.High);
    expect(controller.diagnostics()).toMatchObject({
      activeTier: "High",
      downgradeCount: 0,
      recoveryCount: 0,
      rollingP95FrameTimeMs: 1_000 / 60,
    });
  });

  it("holds the Cinematic 4K target at a stable 30 fps", () => {
    const controller = new RendererQualityController({ requestedTier: "Cinematic" });
    for (let frame = 0; frame < 600; frame += 1) {
      controller.recordFrameTime(1_000 / 30);
    }
    expect(controller.budget()).toBe(RENDERER_QUALITY_BUDGETS.Cinematic);
    expect(controller.diagnostics()).toMatchObject({
      activeTier: "Cinematic",
      downgradeCount: 0,
      recoveryCount: 0,
      rollingP95FrameTimeMs: 1_000 / 30,
    });
  });

  it("downgrades and recovers exactly one ordered tier at a time", () => {
    const decisions: Array<{ tier: RendererQualityTier; decision: QualityDecision }> = [];
    const controller = new RendererQualityController({
      requestedTier: "Cinematic",
      onTierChanged: (tier, _budget, decision) => decisions.push({ tier, decision }),
    });
    feedUntilTier(controller, 45, "High");
    feedUntilTier(controller, 25, "Medium");
    feedUntilTier(controller, 25, "Low");
    feedUntilTier(controller, 12, "Medium");
    feedUntilTier(controller, 12, "High");
    feedUntilTier(controller, 12, "Cinematic");
    expect(decisions).toEqual([
      { tier: "High", decision: "performance_downgrade" },
      { tier: "Medium", decision: "performance_downgrade" },
      { tier: "Low", decision: "performance_downgrade" },
      { tier: "Medium", decision: "performance_recovery" },
      { tier: "High", decision: "performance_recovery" },
      { tier: "Cinematic", decision: "performance_recovery" },
    ]);
    expect(controller.diagnostics()).toMatchObject({ downgradeCount: 3, recoveryCount: 3 });
  });

  it("uses rolling hysteresis instead of flapping on isolated slow frames", () => {
    const controller = new RendererQualityController({ requestedTier: "High" });
    for (let frame = 0; frame < 600; frame += 1) {
      controller.recordFrameTime(frame % 100 === 0 ? 40 : 16);
    }
    expect(controller.diagnostics()).toMatchObject({
      activeTier: "High",
      downgradeCount: 0,
      downgradeStreak: 0,
    });
    expect(DEFAULT_QUALITY_HYSTERESIS.downgradeFrameTimeRatio).toBeGreaterThan(1);
    expect(DEFAULT_QUALITY_HYSTERESIS.recoveryFrameTimeRatio).toBeLessThan(1);
  });

  it("never automatically recovers above the requested tier", () => {
    const controller = new RendererQualityController({ requestedTier: "High" });
    feedUntilTier(controller, 25, "Medium");
    controller.setRequestedTier("Medium");
    for (let frame = 0; frame < 600; frame += 1) controller.recordFrameTime(8);
    expect(controller.diagnostics().activeTier).toBe("Medium");
    controller.setRequestedTier("Low");
    expect(controller.diagnostics()).toMatchObject({
      requestedTier: "Low",
      activeTier: "Low",
      lastDecision: "requested_cap",
    });
  });

  it("surfaces GPU loss and failed reset as recoverable, then recovers safely", () => {
    const controller = new RendererQualityController({ requestedTier: "Cinematic" });
    controller.reportGpuLoss("WebGL context lost");
    controller.reportGpuLoss("duplicate");
    controller.recordFrameTime(16);
    expect(controller.diagnostics()).toMatchObject({
      activeTier: "Low",
      gpuState: "lost",
      gpuMessage: "WebGL context lost",
      recoverable: true,
      gpuLossCount: 1,
      ignoredFrameSampleCount: 1,
      lastDecision: "gpu_loss",
    });
    expect(controller.beginGpuReset()).toBe(true);
    expect(controller.beginGpuReset()).toBe(false);
    expect(controller.completeGpuReset(false, "adapter reset failed")).toBe(true);
    expect(controller.diagnostics()).toMatchObject({
      gpuState: "recoverable_error",
      gpuMessage: "adapter reset failed",
      recoverable: true,
      gpuResetFailureCount: 1,
    });
    expect(controller.beginGpuReset()).toBe(true);
    expect(controller.completeGpuReset(true)).toBe(true);
    expect(controller.diagnostics()).toMatchObject({
      gpuState: "ready",
      gpuMessage: null,
      recoverable: false,
      activeTier: "Cinematic",
      gpuResetAttemptCount: 2,
      gpuResetSuccessCount: 1,
    });
  });

  it("passes scientific fields and authoritative time through by identity at every tier", () => {
    const fields = Object.freeze({ eta: new Float32Array([1, 2]), wet_mask: new Uint8Array([1, 0]) });
    const frame = Object.freeze({
      solver_tick: 42,
      simulation_time_s: 4.2,
      tick_duration_s: 0.1,
      fields,
      events: Object.freeze([{ id: "wave" }]),
    });
    expect(passthroughScientificFrame(frame)).toBe(frame);

    for (const tier of RENDERER_QUALITY_TIERS) {
      const controller = new RendererQualityController({ requestedTier: tier });
      const beforeKeys = Reflect.ownKeys(frame);
      const policy = controller.policyFor(frame);
      expect(policy.scientificFrame).toBe(frame);
      expect(policy.scientificFrame.fields).toBe(fields);
      expect(policy.scientificFrame.solver_tick).toBe(42);
      expect(policy.scientificFrame.simulation_time_s).toBe(4.2);
      expect(policy.scientificFrame.tick_duration_s).toBe(0.1);
      expect(Reflect.ownKeys(policy.scientificFrame)).toEqual(beforeKeys);
      controller.reportGpuLoss();
      expect(controller.policyFor(frame).scientificFrame).toBe(frame);
      expect(controller.policyFor(frame).scientificFrame.fields).toBe(fields);
    }
  });

  it("validates frame samples and hysteresis configuration", () => {
    const controller = new RendererQualityController();
    expect(() => controller.recordFrameTime(0)).toThrow(RangeError);
    expect(() => controller.recordFrameTime(Number.NaN)).toThrow(RangeError);
    expect(
      () => new RendererQualityController({ hysteresis: { recoveryFrameTimeRatio: 1 } }),
    ).toThrow(RangeError);
    expect(
      () => new RendererQualityController({ hysteresis: { minimumSamples: 0 } }),
    ).toThrow(RangeError);
  });
});
