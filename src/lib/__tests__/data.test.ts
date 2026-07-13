import { describe, expect, it } from "vitest";
import { getCoastalPoints } from "../data";

describe("coastal point provenance", () => {
  it("resolves exactly 79 runnable points with independent stable sample IDs", () => {
    const points = getCoastalPoints();
    expect(points).toHaveLength(79);
    expect(new Set(points.map((point) => point.id)).size).toBe(points.length);
    for (const point of points) {
      expect(point.slope_provenance.sample_id).toBe(`${point.id}:slope`);
      expect(point.depth_provenance.sample_id).toBe(`${point.id}:depth`);
      expect(point.slope_provenance.record_id).toMatch(/^slope:/);
      expect(point.depth_provenance.record_id).toMatch(/^depth:/);
    }
  });

  it("never presents placeholder inputs as medium or high confidence", () => {
    for (const point of getCoastalPoints()) {
      for (const provenance of [point.slope_provenance, point.depth_provenance]) {
        if (provenance.placeholder) expect(provenance.confidence).toBe("low");
      }
    }
  });

  it("excludes zero-slope deep-water references from the runup path", () => {
    const ids = getCoastalPoints().map((point) => point.id);
    expect(ids).not.toContain("iquique_offshore");
    expect(ids).not.toContain("tohoku_dart_21413");
    expect(ids).not.toContain("tonga_dart_51425");
  });
});
