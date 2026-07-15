import { describe, expect, it } from "vitest";
import {
  buildComparisonMetrics,
  comparisonMetricLines,
  comparisonStoryForPair,
  comparisonStoryForPreset,
} from "../comparison-stories";

const initial = (peak: number, energy: number, radius: number) => ({
  center: { lat_deg: 0, lon_deg: 0 },
  cavity_radius_m: radius,
  peak_amplitude_m: peak,
  source_energy_j: energy,
  seismic_mw_equivalent: 0,
  label: "Fixture",
});

describe("comparison stories", () => {
  it("suggests a story for either member and recognizes reversed panes", () => {
    expect(comparisonStoryForPreset("indian_ocean_2004").id).toBe("megathrust-oceans");
    expect(comparisonStoryForPair("indian_ocean_2004", "tohoku_2011")?.id).toBe("megathrust-oceans");
    expect(comparisonStoryForPair("tohoku_2011", "chicxulub")).toBeNull();
  });

  it("reports only deterministic source quantities and their direction", () => {
    const metrics = buildComparisonMetrics(initial(20, 1e18, 4_000), initial(5, 2e16, 2_000));
    expect(metrics).toEqual([
      { label: "Peak source amplitude", slotA: "20 m", slotB: "5.0 m", difference: "4.0× larger in Slot A" },
      { label: "Source energy", slotA: "1 EJ", slotB: "20 PJ", difference: "50× larger in Slot A" },
      { label: "Source radius", slotA: "4 km", slotB: "2 km", difference: "2.0× larger in Slot A" },
    ]);
    expect(comparisonMetricLines(metrics)[0]).toBe(
      "Peak source amplitude: A 20 m; B 5.0 m; 4.0× larger in Slot A",
    );
  });

  it("waits for both sources and avoids invalid zero ratios", () => {
    expect(buildComparisonMetrics(null, initial(1, 1, 1))).toEqual([]);
    expect(buildComparisonMetrics(initial(0, 0, 0), initial(0, 1, 0))[0].difference)
      .toBe("not ratio-comparable");
  });
});
