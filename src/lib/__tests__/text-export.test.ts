import { describe, it, expect } from "vitest";
import { generateTextExport } from "../text-export";
import type { InitialDisplacement } from "../../types/scenario";
import { getCoastalPoints } from "../data";
import { demoRunupAtPoints } from "../demo";

const MOCK_INITIAL: InitialDisplacement = {
  peak_amplitude_m: 1500,
  cavity_radius_m: 50000,
  source_energy_j: 4.2e23,
  dominant_wavelength_m: 100000,
  seismic_mw_equivalent: 12.5,
  center: { lat_deg: 21.4, lon_deg: -89.5, depth_m: 1500 },
  label: "Chicxulub",
};

describe("generateTextExport", () => {
  it("includes preset name when provided", () => {
    const report = generateTextExport({
      preset: {
        id: "chicxulub",
        name: "Chicxulub Impact",
        date: "66 Ma",
        reference: "Range 2022",
        reference_url: "https://doi.org/10.1029/2021AV000627",
        source: { kind: "Asteroid", source: {} },
      } as never,
      initial: MOCK_INITIAL,
      generatedAt: "2026-06-28T00:00:00.000Z",
      solverMode: "SWE snapshot playback",
      timeS: 900,
    });
    expect(report).toContain("Chicxulub Impact");
    expect(report).toContain("Range 2022");
    expect(report).toContain("Provenance");
    expect(report).toContain("Cataclysm v0.10.4");
    expect(report).toContain("Generated: 2026-06-28T00:00:00.000Z");
    expect(report).toContain("Scenario type: Asteroid");
    expect(report).toContain("Solver mode: SWE snapshot playback");
    expect(report).toContain("Bathymetry source: Low-confidence coarse basin/shelf approximation");
    expect(report).toContain("GEBCO_2026/TID raster sampling is not bundled");
    expect(report).toContain("Citation: Range 2022 (https://doi.org/10.1029/2021AV000627)");
    expect(report).toContain("Model limitation: Educational model only");
  });

  it("includes peak amplitude", () => {
    const report = generateTextExport({
      initial: MOCK_INITIAL,
      timeS: 0,
    });
    expect(report).toContain("1500");
  });

  it("handles missing initial gracefully", () => {
    const report = generateTextExport({ timeS: 0 });
    expect(report).toBeTruthy();
    expect(report).toContain("Cataclysm");
  });

  it("includes header", () => {
    const report = generateTextExport({ timeS: 0 });
    expect(report).toContain("Scenario Results Export");
  });

  it("formats southern/western coordinates correctly", () => {
    const report = generateTextExport({
      initial: {
        ...MOCK_INITIAL,
        center: { lat_deg: -33.86, lon_deg: -151.2, depth_m: 2000 },
      },
      timeS: 0,
    });
    expect(report).toContain("33.8600° S");
    expect(report).toContain("151.2000° W");
    expect(report).not.toContain("-33");
    expect(report).not.toContain("-151");
  });

  it("exports the same qualified coastal place, time, reach, and limitation story", () => {
    const runupResults = demoRunupAtPoints({
      source: MOCK_INITIAL.center,
      initial_amplitude_m: MOCK_INITIAL.peak_amplitude_m,
      cavity_radius_m: MOCK_INITIAL.cavity_radius_m,
      is_impact: true,
      mean_depth_m: 4_000,
      time_s: Number.MAX_SAFE_INTEGER,
      points: getCoastalPoints().slice(0, 2),
    });
    const report = generateTextExport({
      initial: MOCK_INITIAL,
      sourceKind: "Asteroid",
      timeS: Number.MAX_SAFE_INTEGER,
      runupResults,
    });
    expect(report).toContain("Outcome Summary");
    expect(report).toContain("Maximum affected named coast");
    expect(report).toContain("First affected named coast");
    expect(report).toContain("Nearest affected named coast");
    expect(report).toContain("Farthest affected named coast in screening set");
    expect(report).toContain("not a continuous inundation footprint");
  });

  it("never exports earthquake source geometry as a cavity", () => {
    const report = generateTextExport({
      initial: MOCK_INITIAL,
      sourceKind: "Earthquake",
      timeS: 0,
    });
    expect(report).toContain("Source region radius");
    expect(report).not.toContain("Cavity radius");
  });
});
