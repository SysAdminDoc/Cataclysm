import { describe, expect, it } from "vitest";
import type { FalloutPlume } from "../types";
import { falloutRings } from "../nuclear/fallout";

const backendPlume: FalloutPlume = {
  heavy: { length: 42, width: 9 },
  light: { length: 120, width: 24 },
};

describe("falloutRings presentation geometry", () => {
  it("returns no rings when the backend reports no fallout plume", () => {
    expect(falloutRings({ lat: 40, lon: -74 }, null)).toEqual([]);
  });

  it("turns backend heavy and light dimensions into closed finite polygons", () => {
    const rings = falloutRings({ lat: 40, lon: -74 }, backendPlume, 270);
    expect(rings).toHaveLength(2);
    for (const ring of rings) {
      expect(ring.points.length).toBeGreaterThan(10);
      expect(ring.points[0].lat).toBeCloseTo(ring.points.at(-1)!.lat, 6);
      expect(ring.points.every((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon))).toBe(true);
    }
  });

  it("rotates the backend plume downwind without changing scientific dimensions", () => {
    const [, heavy] = falloutRings({ lat: 0, lon: 0 }, backendPlume, 270);
    const meanLon = heavy.points.reduce((sum, point) => sum + point.lon, 0) / heavy.points.length;
    expect(meanLon).toBeGreaterThan(0);
  });
});
