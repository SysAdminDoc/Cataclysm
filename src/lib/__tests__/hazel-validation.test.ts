import { describe, expect, it } from "vitest";
import { prepareHazelValidation, type ModeledRunupComparisonPoint } from "../hazel-validation";
import type { HazelRunupSearchResponse } from "../ncei-hazel";

const modeled = (overrides: Partial<ModeledRunupComparisonPoint> = {}): ModeledRunupComparisonPoint => ({
  id: "coast-a",
  name: "Coast A",
  lat: 35,
  lon: 140,
  runup_m: 4,
  has_arrived: true,
  ...overrides,
});

const response: HazelRunupSearchResponse = {
  items: [
    { id: 2, locationName: "Point B", country: "JP", latitude: 35.1, longitude: 140.1, runupHt: 2 },
    { id: 1, locationName: "Point A", country: "JP", latitude: 35.0005, longitude: 140.0005, runupHt: 1 },
    { id: 99, locationName: "Bad", latitude: null, longitude: 0, runupHt: 20 },
  ],
  page: 1,
  totalPages: 1,
  itemsPerPage: 100,
  totalItems: 3,
  sampledItems: 3,
  truncated: false,
};

describe("HazEL observed-runup validation", () => {
  it("normalizes bounded observations and reports nearest residuals once per model point", () => {
    const result = prepareHazelValidation(response, [
      modeled(),
      modeled({ id: "coast-b", name: "Coast B", lat: 35.1, lon: 140.1, runup_m: 3 }),
    ]);
    expect(result.summary.validObservedCount).toBe(2);
    expect(result.summary.plottedCount).toBe(2);
    expect(result.summary.matchedCount).toBe(2);
    expect(result.matches.map((match) => match.residualM)).toEqual([3, 1]);
    expect(result.summary.biasM).toBe(2);
    expect(result.summary.rmseM).toBeCloseTo(Math.sqrt(5));
  });

  it("keeps the comparison empty when model points have not arrived or are too far away", () => {
    const result = prepareHazelValidation(response, [
      modeled({ has_arrived: false }),
      modeled({ id: "far", lat: 0, lon: 0 }),
    ]);
    expect(result.points).toHaveLength(2);
    expect(result.matches).toHaveLength(0);
    expect(result.summary.rmseM).toBeNull();
  });

  it("samples display points deterministically while retaining all valid records for summary matching", () => {
    const items = Array.from({ length: 5 }, (_, id) => ({
      id: id + 1,
      locationName: `Point ${id + 1}`,
      latitude: 10 + id * 0.01,
      longitude: 20,
      runupHt: id,
    }));
    const result = prepareHazelValidation({ ...response, items, totalItems: 5, sampledItems: 5, truncated: true }, [], { maxPlottedPoints: 2 });
    expect(result.points.map((point) => point.sourceId)).toEqual([1, 3]);
    expect(result.summary.validObservedCount).toBe(5);
    expect(result.summary.displaySampled).toBe(true);
    expect(result.summary.sourceTruncated).toBe(true);
  });
});
