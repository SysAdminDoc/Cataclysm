import { describe, it, expect } from "vitest";
import { generateTextExport } from "../text-export";
import type { InitialDisplacement } from "../../types/scenario";

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
      preset: { id: "chicxulub", name: "Chicxulub Impact", date: "66 Ma", reference: "Range 2022" } as never,
      initial: MOCK_INITIAL,
      timeS: 900,
    });
    expect(report).toContain("Chicxulub Impact");
    expect(report).toContain("Range 2022");
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
    expect(report).toContain("TsunamiSimulator");
  });

  it("includes header", () => {
    const report = generateTextExport({ timeS: 0 });
    expect(report).toContain("Scenario Results Export");
  });
});
