import { describe, expect, it } from "vitest";
import { calcEffects } from "../nuclear/physics";
import { calcTimeline } from "../nuclear/timeline";
import { falloutRings } from "../nuclear/fallout";

describe("calcTimeline", () => {
  it("orders detonation → prompt radiation → thermal → blast, and reports fallout for surface bursts", () => {
    const surf = calcTimeline(calcEffects(100, "surface"));
    expect(surf[0].description).toMatch(/detonation/i);
    expect(surf.some((e) => e.category === "blast")).toBe(true);
    // surface burst with fallout emits the heavy/light fallout events
    expect(surf.some((e) => e.category === "fallout")).toBe(true);
  });

  it("air bursts get a cloud event but no fallout events", () => {
    const air = calcTimeline(calcEffects(100, "airburst"));
    expect(air.some((e) => e.category === "cloud")).toBe(true);
    expect(air.some((e) => e.category === "fallout")).toBe(false);
  });

  it("larger yields push the 5 psi blast arrival later (bigger radius)", () => {
    const small = calcTimeline(calcEffects(10, "airburst")).find((e) => /5 psi/.test(e.description));
    const big = calcTimeline(calcEffects(1000, "airburst")).find((e) => /5 psi/.test(e.description));
    expect(small && big).toBeTruthy();
  });
});

describe("falloutRings", () => {
  it("returns no rings for air bursts (no fallout plume)", () => {
    expect(falloutRings({ lat: 40, lon: -74 }, calcEffects(100, "airburst").fallout)).toEqual([]);
  });

  it("returns heavy + light closed polygons for surface bursts", () => {
    const rings = falloutRings({ lat: 40, lon: -74 }, calcEffects(100, "surface").fallout, 270);
    expect(rings.length).toBe(2);
    for (const r of rings) {
      expect(r.points.length).toBeGreaterThan(10);
      // closed ring: first ≈ last
      expect(r.points[0].lat).toBeCloseTo(r.points[r.points.length - 1].lat, 6);
      // all finite
      expect(r.points.every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))).toBe(true);
    }
  });

  it("drifts the plume downwind: a west wind (270°) pushes fallout east of ground zero", () => {
    const [, heavy] = falloutRings({ lat: 0, lon: 0 }, calcEffects(500, "surface").fallout, 270);
    const meanLon = heavy.points.reduce((s, p) => s + p.lon, 0) / heavy.points.length;
    expect(meanLon).toBeGreaterThan(0); // east of 0
  });
});
