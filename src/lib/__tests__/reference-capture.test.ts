import { describe, expect, it } from "vitest";
import contract from "../../data/reference-scenes.json";
import fixtures from "../../data/direct-hazard-capture-fixtures.json";
import { referenceCaptureEnabled } from "../reference-capture";
import { RENDERER_QUALITY_PROFILES } from "../../rendering/quality-profiles";

describe("HR-00 reference contract", () => {
  it("defines exactly twelve unique scenes at true 1440p and 4K", () => {
    expect(contract.scenes).toHaveLength(12);
    expect(new Set(contract.scenes.map((scene) => scene.id)).size).toBe(12);
    expect(contract.viewports).toEqual({
      "1440p": { width: 2560, height: 1440 },
      "4k": { width: 3840, height: 2160 },
    });
    expect(contract.scenes.every((scene) => scene.requestedStyleId === "natural-earth-2")).toBe(true);
  });

  it("uses only frozen Rust-authority products for direct browser captures", () => {
    const directScenes = contract.scenes.filter((scene) => scene.workflow.kind.startsWith("direct-"));
    expect(directScenes).toHaveLength(5);
    for (const scene of directScenes) {
      const fixture = fixtures[scene.workflow.fixtureId as keyof typeof fixtures];
      expect(fixture.authority).toBe("rust");
      expect(fixture.modelVersion).toBe(
        scene.workflow.kind === "direct-asteroid"
          ? "asteroid-direct-1.1.0"
          : "nuclear-direct-1.0.0",
      );
      expect(fixture.center).toEqual(scene.workflow.request?.center);
    }
  });

  it("keeps Low-tier captures at native drawing-buffer resolution", () => {
    expect(RENDERER_QUALITY_PROFILES.Low.resolutionScale).toBe(1);
    expect(RENDERER_QUALITY_PROFILES.Low.msaaSamples).toBe(1);
  });
});

describe("reference capture activation", () => {
  it("is opt-in through an explicit query parameter", () => {
    window.history.replaceState({}, "", "/");
    expect(referenceCaptureEnabled()).toBe(false);
    window.history.replaceState({}, "", "/?referenceCapture=1");
    expect(referenceCaptureEnabled()).toBe(true);
  });
});
