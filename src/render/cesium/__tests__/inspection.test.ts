import { describe, expect, it } from "vitest";
import type { InspectAtPointResult } from "../../../lib/tauri";
import type { DirectHazardProbeResult } from "../../../hazards";
import type { InitialDisplacement } from "../../../types/scenario";
import {
  buildInspectionRequest,
  formatDirectHazardProbeLabel,
  formatInspectionLabel,
} from "../inspection";

const INITIAL: InitialDisplacement = {
  center: { lat_deg: 10, lon_deg: 20 },
  cavity_radius_m: 12_000,
  peak_amplitude_m: 42,
  source_energy_j: 1e18,
  seismic_mw_equivalent: 8,
  label: "Inspection fixture",
};

const RESULT: InspectAtPointResult = {
  range_m: 1_234_500,
  arrival_time_s: 5_430,
  offshore_amplitude_m: 1.234,
  runup_m: 6.78,
  inundation_extent_m: 9_876,
  has_arrived: true,
  governing_model: "impact-far-field + synolakis-runup",
  citations: ["Ward & Asphaug (2000)"],
  assumptions: ["Uniform ocean", "Nominal 1° slope / 50 m depth"],
  confidence: "illustrative",
  unknowns: ["Local bathymetry is unresolved"],
};

describe("buildInspectionRequest", () => {
  it("applies deterministic defaults when depth and options are absent", () => {
    expect(buildInspectionRequest(INITIAL, 11.5, -22.25)).toEqual({
      source: INITIAL.center,
      initial_amplitude_m: 42,
      cavity_radius_m: 12_000,
      is_impact: false,
      mean_depth_m: 4_000,
      time_s: 0,
      click_lat: 11.5,
      click_lon: -22.25,
      beach_slope_deg: 1,
      offshore_depth_m: 50,
    });
  });

  it("preserves a finite positive source depth and explicit inspection options", () => {
    const initial = { ...INITIAL, center: { ...INITIAL.center, depth_m: 3_250 } };
    expect(buildInspectionRequest(initial, -8, 140, { isImpact: true, timeS: 720 })).toMatchObject({
      mean_depth_m: 3_250,
      is_impact: true,
      time_s: 720,
    });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "falls back from invalid source depth %s",
    (depth) => {
      const initial = { ...INITIAL, center: { ...INITIAL.center, depth_m: depth } };
      expect(buildInspectionRequest(initial, 0, 0).mean_depth_m).toBe(4_000);
    },
  );
});

describe("formatInspectionLabel", () => {
  it("formats finite values, hour arrivals, and arrived state deterministically", () => {
    expect(formatInspectionLabel(12.345, -98.765, RESULT)).toBe([
      "12.35°, -98.77°",
      "Range  1235 km   ·   ARRIVED",
      "Arrival T+1h31",
      "Offshore 1.23 m   ·   Runup 6.8 m",
      "Inundation ~9.88 km",
      "illustrative confidence · impact-far-field + synolakis-runup",
      "Basis: Ward & Asphaug (2000)",
      "Assumption: Nominal 1° slope / 50 m depth",
      "Unknown: Local bathymetry is unresolved",
    ].join("\n"));
  });

  it("formats sub-hour arrivals and in-transit state", () => {
    expect(formatInspectionLabel(0, 0, { ...RESULT, arrival_time_s: 1_500, has_arrived: false }))
      .toContain("Arrival T+25m\nOffshore");
    expect(formatInspectionLabel(0, 0, { ...RESULT, arrival_time_s: 1_500, has_arrived: false }))
      .toContain("·   in transit");
  });

  it("never exposes NaN or Infinity in labels", () => {
    const invalid: InspectAtPointResult = {
      range_m: Number.NaN,
      arrival_time_s: Number.POSITIVE_INFINITY,
      offshore_amplitude_m: Number.NEGATIVE_INFINITY,
      runup_m: Number.NaN,
      inundation_extent_m: Number.POSITIVE_INFINITY,
      has_arrived: false,
    };
    const label = formatInspectionLabel(Number.NaN, Number.POSITIVE_INFINITY, invalid);
    expect(label).not.toMatch(/NaN|Infinity/);
    expect(label.match(/—/g)).toHaveLength(7);
  });
});

describe("formatDirectHazardProbeLabel", () => {
  const PROBE: DirectHazardProbeResult = {
    result_id: `nuclear-${"a".repeat(64)}`,
    kind: "nuclear",
    click_lat: 12.5,
    click_lon: -40.25,
    range_m: 25_000,
    status: "threshold_exceeded",
    effects: [{
      label: "5 psi — buildings destroyed",
      category: "blast",
      threshold_value: 5,
      threshold_unit: "psi",
      value_qualifier: "at_least",
      arrival_time_s: 72.9,
    }],
    governing_model: "nuclear-direct-1.0.0",
    citations: ["Glasstone & Dolan (1977)"],
    assumptions: ["Spherical Earth", "Level, unobstructed terrain"],
    confidence: "screening_estimate",
    unknowns: ["Local shielding is not modeled"],
  };

  it("shows threshold, arrival, model, citation, assumptions, confidence, and unknowns", () => {
    const label = formatDirectHazardProbeLabel(PROBE);
    expect(label).toContain("Threshold lower bounds: 5 psi");
    expect(label).toContain("Earliest modeled arrival: T+1m");
    expect(label).toContain("Model nuclear-direct-1.0.0 · screening estimate");
    expect(label).toContain("Basis: Glasstone & Dolan (1977)");
    expect(label).toContain("Assumption: Level, unobstructed terrain");
    expect(label).toContain("Unknown: Local shielding is not modeled");
  });

  it("does not call an outside-threshold coordinate safe", () => {
    const label = formatDirectHazardProbeLabel({
      ...PROBE,
      status: "no_displayed_threshold",
      effects: [],
    });
    expect(label).toContain("not a safety finding");
    expect(label).toContain("No numeric displayed threshold");
  });
});
