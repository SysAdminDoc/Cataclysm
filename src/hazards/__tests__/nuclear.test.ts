import { describe, expect, it } from "vitest";
import { calcEffects, calcZoneMortality } from "../nuclear/physics";
import { WEAPON_PRESETS, nuclearEngine } from "../nuclear";

// Regression values mirror NukeMap's test/run-physics.js reference cases
// (HSAJ 10 kT airburst calibration, G&D scaling).
describe("nuclear calcEffects", () => {
  it("matches the HSAJ 10 kT airburst 5 psi radius (~1.51 km ±10%)", () => {
    const e = calcEffects(10, "airburst");
    expect(e.psi5).toBeGreaterThan(1.51 * 0.9);
    expect(e.psi5).toBeLessThan(1.51 * 1.1);
  });

  it("1 MT at 20 psi lands near 2.8 km ±15%", () => {
    const e = calcEffects(1000, "airburst");
    expect(e.psi20).toBeGreaterThan(2.8 * 0.85);
    expect(e.psi20).toBeLessThan(2.8 * 1.15);
  });

  it("surface bursts reduce blast radii by the 0.8 factor and create a crater", () => {
    const air = calcEffects(100, "airburst");
    const surf = calcEffects(100, "surface");
    expect(surf.psi5).toBeCloseTo(air.psi5 * 0.8, 5);
    expect(surf.craterR).toBeGreaterThan(0);
    expect(air.craterR).toBe(0);
  });

  it("clamps non-finite and sub-minimum yields to 0.001 kt", () => {
    const e = calcEffects(Number.NaN, "airburst");
    expect(e.yieldKt).toBe(0.001);
    expect(Number.isFinite(e.psi1)).toBe(true);
  });

  it("only surface/water bursts and low airbursts generate fallout", () => {
    expect(calcEffects(100, "airburst").fallout).toBeNull();
    expect(calcEffects(100, "surface").fallout).not.toBeNull();
    expect(calcEffects(100, "water").fallout).not.toBeNull();
  });

  it("water bursts produce a surface wave, land bursts do not", () => {
    expect(calcEffects(100, "water").waveHeight).toBeGreaterThan(0);
    expect(calcEffects(100, "surface").waveHeight).toBe(0);
  });
});

describe("nuclear casualties", () => {
  it("scale monotonically with population density", () => {
    const e = calcEffects(100, "airburst");
    const rural = calcZoneMortality(e, 200);
    const urban = calcZoneMortality(e, 10000);
    expect(urban.deaths).toBeGreaterThan(rural.deaths);
    expect(rural.deaths).toBeGreaterThanOrEqual(0);
  });
});

describe("nuclearEngine.run", () => {
  it("produces globe-ready rings sorted largest-first, in meters", () => {
    const r = nuclearEngine.run({ yieldKt: 100, burstType: "airburst", populationDensity: 5000 }, { lat: 40, lon: -74 });
    expect(r.kind).toBe("nuclear");
    expect(r.rings.length).toBeGreaterThan(0);
    // sorted descending
    for (let i = 1; i < r.rings.length; i++) {
      expect(r.rings[i - 1].radiusM).toBeGreaterThanOrEqual(r.rings[i].radiusM);
    }
    // km->m conversion: a 100 kt fireball is a few hundred meters, not < 1
    expect(Math.max(...r.rings.map((x) => x.radiusM))).toBeGreaterThan(1000);
    expect(r.casualties?.deaths).toBeGreaterThan(0);
  });

  it("ships a non-empty weapon preset table", () => {
    expect(WEAPON_PRESETS.length).toBeGreaterThan(5);
    expect(WEAPON_PRESETS.every((w) => w.yieldKt > 0)).toBe(true);
  });
});
