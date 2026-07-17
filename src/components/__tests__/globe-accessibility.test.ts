import { describe, expect, it } from "vitest";

import { buildGlobeAccessibilitySummary } from "../globe-accessibility";

const baseState = {
  resolvedStyle: "esri-world-imagery" as const,
  hasInitial: false,
  hasWavefront: false,
  hasSweSnapshot: false,
  isochroneCount: 0,
  runupResultCount: 0,
  dartBuoyCount: 0,
  hasHazardCenter: false,
  hazardRingCount: 0,
  hazardPolygonCount: 0,
  hasDirectRenderFrame: false,
  hasWw3Plan: false,
  mirvPointCount: 0,
  sceneLabel: "Unconfigured planetary hazard scene",
  simulationTimeS: 0,
  rendererError: null,
  imageryStatus: "connecting" as const,
  imageryMessage: "Connecting to globe imagery…",
  lastInspectionSummary: null,
  inspectMode: false,
  pickMode: false,
};

describe("buildGlobeAccessibilitySummary", () => {
  it("preserves the empty-scene text equivalent", () => {
    expect(buildGlobeAccessibilitySummary(baseState)).toBe(
      "Unconfigured planetary hazard scene. Camera position is not available for this comparison pane. Scenario time T plus 0 minutes. Visible analytical layers: Esri World Imagery (satellite, no token) base imagery. Renderer imagery is connecting: Connecting to globe imagery… Latitude and longitude entry is available when location picking or inspection is active.",
    );
  });

  it("announces active analytical layers, camera, renderer, and interaction state", () => {
    const summary = buildGlobeAccessibilitySummary({
      ...baseState,
      hasInitial: true,
      hasWavefront: true,
      hasSweSnapshot: true,
      isochroneCount: 2,
      runupResultCount: 4,
      dartBuoyCount: 1,
      hasHazardCenter: true,
      hazardRingCount: 3,
      hazardPolygonCount: 1,
      hasDirectRenderFrame: true,
      hasWw3Plan: true,
      mirvPointCount: 6,
      camera: { lat: -35.5, lon: 140.25, altitudeM: 2_500_000, headingDeg: 0 },
      simulationTimeS: 7_200,
      imageryStatus: "ready",
      imageryMessage: "Ready",
      inspectMode: true,
    });

    expect(summary).toContain("Camera centered at 35.50 degrees south, 140.25 degrees east, at 2.5 megametres altitude.");
    expect(summary).toContain("Scenario time T plus 120 minutes.");
    expect(summary).toContain("MIRV pattern preview with 6 aim points");
    expect(summary).toContain("Renderer and base imagery are ready.");
    expect(summary).toContain("Inspect mode is active");
  });
});
