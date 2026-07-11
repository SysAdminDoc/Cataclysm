import { describe, it, expect } from 'vitest';
import { simulate } from '../../src/physics/simulate';
import { computeEnergy } from '../../src/physics/energy';
import { computeCrater } from '../../src/physics/crater';
import { computeThermal } from '../../src/physics/thermal';
import { computeSeismic } from '../../src/physics/seismic';
import { computeAirblast } from '../../src/physics/airblast';
import { computeTsunami } from '../../src/physics/tsunami';
import { simulateAtmosphericEntry } from '../../src/physics/atmospheric-entry';
import type { ImpactParams } from '../../src/physics/types';

describe('tiny impacts (<1m)', () => {
  it('sub-meter iron produces minimal crater', () => {
    const e = computeEnergy(0.5, 7800, 15000);
    const result = computeCrater(0.5, 7800, 15000, 45, 'sedimentary_rock', e.kineticEnergy);
    expect(result.finalDiameter).toBeLessThan(50);
    expect(result.isComplex).toBe(false);
  });

  it('sub-meter stony has low energy', () => {
    const result = computeEnergy(0.5, 3300, 15000);
    expect(result.kilotons).toBeLessThan(1);
  });
});

describe('extreme energies (>1e25 J)', () => {
  it('50km asteroid produces a massive crater without NaN', () => {
    const e = computeEnergy(50000, 3300, 20000);
    expect(isFinite(e.kineticEnergy)).toBe(true);
    expect(e.kineticEnergy).toBeGreaterThan(1e25);

    const crater = computeCrater(50000, 3300, 20000, 45, 'crystalline_rock', e.kineticEnergy);
    expect(isFinite(crater.finalDiameter)).toBe(true);
    expect(crater.finalDiameter).toBeGreaterThan(100000);
    expect(crater.isComplex).toBe(true);
  });

  it('max params simulation produces finite results', () => {
    const params: ImpactParams = {
      diameter: 50000,
      density: 7800,
      velocity: 72000,
      angle: 90,
      targetType: 'crystalline_rock',
      waterDepth: 0,
      beachSlope: 0.02,
      distance: 1000000,
    };
    const result = simulate(params);
    expect(isFinite(result.energy.kineticEnergy)).toBe(true);
    expect(isFinite(result.seismic.magnitude)).toBe(true);
    expect(isFinite(result.airblast.overpressure)).toBe(true);
    expect(isFinite(result.thermal.fireballRadius)).toBe(true);
  });
});

describe('very shallow angles (5°)', () => {
  it('5-degree entry has longer atmospheric path', () => {
    const shallow = simulateAtmosphericEntry(50, 3300, 20000, 5);
    const steep = simulateAtmosphericEntry(50, 3300, 20000, 60);
    expect(shallow.trajectory.length).toBeGreaterThanOrEqual(steep.trajectory.length);
  });

  it('shallow 30m stony should airburst', () => {
    const result = simulateAtmosphericEntry(30, 3300, 20000, 10);
    expect(result.breakupAltitude).toBeGreaterThan(0);
  });
});

describe('observer at distance=0', () => {
  it('thermal exposure at zero is capped, not Infinity', () => {
    const result = computeThermal(1e18, 0, 0);
    expect(isFinite(result.thermalExposure)).toBe(true);
    expect(result.thermalExposure).toBeGreaterThan(0);
  });

  it('airblast at zero is very large but finite', () => {
    const result = computeAirblast(1e18, 0, 0);
    expect(isFinite(result.overpressure)).toBe(true);
    expect(result.overpressure).toBeGreaterThan(0);
  });

  it('seismic at zero gives max Mercalli', () => {
    const result = computeSeismic(1e20, 0);
    expect(result.mercalliIntensity).toBe(12);
  });
});

describe('luminous efficiency breakpoints', () => {
  it('increases for smaller energies', () => {
    const huge = computeThermal(1e24, 100000, 0);
    const small = computeThermal(1e15, 100000, 0);
    const hugeEfficiency = huge.thermalExposure * (2 * Math.PI * 100000 ** 2) / 1e24;
    const smallEfficiency = small.thermalExposure * (2 * Math.PI * 100000 ** 2) / 1e15;
    expect(smallEfficiency).toBeGreaterThan(hugeEfficiency);
  });
});

describe('tsunami edge cases', () => {
  it('deep ocean vs shallow behavior differs', () => {
    const deep = computeTsunami(1e20, 100000, 'water', 10000);
    const shallow = computeTsunami(1e20, 100000, 'water', 200);
    expect(deep.cavityDepth).toBeGreaterThan(shallow.cavityDepth);
  });

  it('amplitude below threshold produces zero runup', () => {
    const result = computeTsunami(1e10, 1000000, 'water', 4000);
    expect(result.applies).toBe(true);
    expect(result.runupHeight).toBe(0);
  });

  it('beach slope affects runup height', () => {
    const gentle = computeTsunami(1e20, 100000, 'water', 4000, 0.005);
    const steep = computeTsunami(1e20, 100000, 'water', 4000, 0.1);
    expect(steep.runupHeight).toBeLessThan(gentle.runupHeight);
  });
});

describe('seismic boundary clamping', () => {
  it('tiny energy gives Mercalli 1', () => {
    const result = computeSeismic(1, 1000000);
    expect(result.mercalliIntensity).toBe(1);
  });

  it('huge energy at zero distance gives Mercalli 12', () => {
    const result = computeSeismic(1e25, 0);
    expect(result.mercalliIntensity).toBe(12);
  });
});

describe('Chicxulub validation', () => {
  it('produces all 9 effect categories with plausible values', () => {
    const params: ImpactParams = {
      diameter: 12000,
      density: 2600,
      velocity: 20000,
      angle: 60,
      targetType: 'crystalline_rock',
      waterDepth: 0,
      beachSlope: 0.02,
      distance: 1000000,
    };
    const r = simulate(params);

    expect(r.energy.kineticEnergy).toBeGreaterThan(1e23);
    expect(r.atmosphericEntry.reachesGround).toBe(true);
    expect(r.atmosphericEntry.impactVelocity).toBeGreaterThan(19000);
    expect(r.crater).not.toBeNull();
    expect(r.crater!.finalDiameter).toBeGreaterThan(100000);
    expect(r.crater!.finalDiameter).toBeLessThan(300000);
    expect(r.crater!.isComplex).toBe(true);
    expect(r.thermal.fireballRadius).toBeGreaterThan(1000);
    expect(r.seismic.magnitude).toBeGreaterThan(9);
    expect(r.airblast.radiusWindowBreakage).toBeGreaterThan(100000);
    expect(r.ejecta).not.toBeNull();
    expect(r.ejecta!.maxEjectaRange).toBeGreaterThan(1000);
    expect(r.tsunami.applies).toBe(false);
  });
});
