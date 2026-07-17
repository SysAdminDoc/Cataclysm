import { describe, expect, it } from "vitest";
import {
  buildWw3ExchangePlan,
  estimateWw3Casualties,
  greatCircleArc,
  WW3_GLOBAL_WARHEAD_COUNT,
  WW3_SCENARIOS,
  WW3_TARGET_COUNT,
} from "../ww3";

describe("WW3 exchange planning", () => {
  it("loads the complete preserved scenario and target registry", () => {
    expect(WW3_SCENARIOS).toHaveLength(7);
    expect(WW3_TARGET_COUNT).toBe(427);
    expect(WW3_GLOBAL_WARHEAD_COUNT).toBe(712);
  });

  it("builds the global exchange deterministically", () => {
    const first = buildWw3ExchangePlan("global", "all");
    const second = buildWw3ExchangePlan("global", "all");
    expect(first.strikes).toHaveLength(712);
    expect(first.targetRecordCount).toBe(427);
    expect(first.targetCount).toBe(425);
    expect(first.phaseStrikeCounts.reduce((sum, count) => sum + count, 0)).toBe(712);
    expect(first.strikes.slice(0, 8)).toEqual(second.strikes.slice(0, 8));
    expect(first.totalYieldKt).toBeGreaterThan(0);
    expect(first.estimatedDeaths).toBeGreaterThan(0);
  });

  it("applies operator targeting filters without crossing target classes", () => {
    const counterforce = buildWw3ExchangePlan("global", "counterforce");
    const countervalue = buildWw3ExchangePlan("global", "countervalue");
    expect(counterforce.strikes.every((strike) => strike.target.type !== "city" && strike.target.type !== "infra")).toBe(true);
    expect(countervalue.strikes.every((strike) => strike.target.type === "city" || strike.target.type === "infra")).toBe(true);
    expect(counterforce.strikes.length + countervalue.strikes.length).toBe(712);
  });

  it("preserves the legacy NukeMap mortality result for a fixed city strike", () => {
    expect(estimateWw3Casualties(40.7128, -74.006, 800)).toEqual({
      deaths: 1_720_506,
      injuries: 4_190_747,
      density: 15_000,
    });
  });

  it("creates bounded three-dimensional great-circle arcs", () => {
    const arc = greatCircleArc({ lat: 47.506, lon: -111.183 }, { lat: 55.75, lon: 37.62 });
    expect(arc).toHaveLength(37);
    expect(arc[0].lat).toBeCloseTo(47.506, 10);
    expect(arc[0].lon).toBeCloseTo(-111.183, 10);
    expect(arc[0].altitudeM).toBe(0);
    expect(arc.at(-1)?.lat).toBeCloseTo(55.75, 8);
    expect(arc.at(-1)?.lon).toBeCloseTo(37.62, 8);
    expect(Math.max(...arc.map((point) => point.altitudeM))).toBeLessThanOrEqual(1_200_000);
    expect(Math.max(...arc.map((point) => point.altitudeM))).toBeGreaterThan(100_000);
  });
});
