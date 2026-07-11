import { describe, expect, it } from "vitest";
import { asteroidEngine } from "../asteroid";

// Calibration cases mirror AsteroidSimulator's own physics suite, exercised
// here through the unified engine wrapper (km/s input, HazardResult output).
describe("asteroidEngine.run", () => {
  it("Chelyabinsk-class object airbursts (does not reach ground)", () => {
    const r = asteroidEngine.run(
      { diameterM: 19, densityKgM3: 3300, velocityKmS: 19, angleDeg: 18, targetType: "sedimentary_rock" },
      { lat: 55, lon: 61 },
    );
    const e = r.detail as { atmosphericEntry: { reachesGround: boolean }; crater: unknown };
    expect(e.atmosphericEntry.reachesGround).toBe(false);
    expect(e.crater).toBeNull();
    // no crater ring when it airbursts
    expect(r.rings.some((x) => x.category === "crater")).toBe(false);
  });

  it("Chicxulub-class impactor reaches ground and excavates a large crater", () => {
    const r = asteroidEngine.run(
      { diameterM: 12000, densityKgM3: 2600, velocityKmS: 20, angleDeg: 60, targetType: "crystalline_rock" },
      { lat: 21, lon: -89 },
    );
    const e = r.detail as { crater: { finalDiameter: number } | null };
    expect(e.crater).not.toBeNull();
    // Chicxulub final crater is ~150-200 km across
    expect((e.crater as { finalDiameter: number }).finalDiameter).toBeGreaterThan(100000);
    expect(r.rings.some((x) => x.category === "crater")).toBe(true);
  });

  it("ocean impacts flag a tsunami in the readout", () => {
    const r = asteroidEngine.run(
      { diameterM: 500, densityKgM3: 3000, velocityKmS: 20, angleDeg: 45, targetType: "water", waterDepthM: 4000 },
      { lat: 0, lon: -140 },
    );
    expect(r.readout.some((x) => x.label.toLowerCase().includes("tsunami"))).toBe(true);
  });

  it("rings are in meters and sorted largest-first", () => {
    const r = asteroidEngine.run(
      { diameterM: 100, densityKgM3: 3000, velocityKmS: 20, angleDeg: 45, targetType: "sedimentary_rock" },
      { lat: 40, lon: -100 },
    );
    expect(r.rings.length).toBeGreaterThan(0);
    for (let i = 1; i < r.rings.length; i++) {
      expect(r.rings[i - 1].radiusM).toBeGreaterThanOrEqual(r.rings[i].radiusM);
    }
  });
});
