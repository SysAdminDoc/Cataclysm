import { describe, it, expect } from 'vitest';
import { computeThermal } from '../../src/physics/thermal';
import { computeSeismic } from '../../src/physics/seismic';
import { computeAirblast } from '../../src/physics/airblast';
import { computeEjecta } from '../../src/physics/ejecta';
import { computeTsunami } from '../../src/physics/tsunami';

describe('computeThermal', () => {
  it('fireball radius scales with energy', () => {
    const small = computeThermal(1e15, 10000, 0);
    const large = computeThermal(1e20, 10000, 0);
    expect(large.fireballRadius).toBeGreaterThan(small.fireballRadius);
  });

  it('thermal exposure decreases with distance', () => {
    const near = computeThermal(1e18, 1000, 0);
    const far = computeThermal(1e18, 100000, 0);
    expect(near.thermalExposure).toBeGreaterThan(far.thermalExposure);
  });

  it('burn radii are ordered: 1st > 2nd > 3rd degree', () => {
    const result = computeThermal(1e20, 10000, 0);
    expect(result.thermalRadiusFirstDegree).toBeGreaterThan(result.thermalRadiusSecondDegree);
    expect(result.thermalRadiusSecondDegree).toBeGreaterThan(result.thermalRadiusThirdDegree);
  });
});

describe('computeSeismic', () => {
  it('Meteor Crater: ~10 Mt → ~4-6 Richter', () => {
    const energy = 10 * 4.184e15;
    const result = computeSeismic(energy, 50000);
    expect(result.magnitude).toBeGreaterThan(3);
    expect(result.magnitude).toBeLessThan(7);
  });

  it('Chicxulub: >1e23 J → ~10+ Richter', () => {
    const result = computeSeismic(4e23, 1000000);
    expect(result.magnitude).toBeGreaterThan(9);
  });

  it('mercalli intensity decreases with distance', () => {
    const near = computeSeismic(1e20, 10000);
    const far = computeSeismic(1e20, 1000000);
    expect(near.mercalliIntensity).toBeGreaterThanOrEqual(far.mercalliIntensity);
  });

  it('mercalli is clamped to 1-12', () => {
    const result = computeSeismic(1e10, 1000000);
    expect(result.mercalliIntensity).toBeGreaterThanOrEqual(1);
    expect(result.mercalliIntensity).toBeLessThanOrEqual(12);
  });
});

describe('computeAirblast', () => {
  it('overpressure decreases with distance', () => {
    const near = computeAirblast(1e18, 1000, 0);
    const far = computeAirblast(1e18, 100000, 0);
    expect(near.overpressure).toBeGreaterThan(far.overpressure);
  });

  it('damage radii are ordered: window > minor > moderate > severe > total', () => {
    const result = computeAirblast(1e18, 10000, 0);
    expect(result.radiusWindowBreakage).toBeGreaterThan(result.radiusMinorDamage);
    expect(result.radiusMinorDamage).toBeGreaterThan(result.radiusModerateDamage);
    expect(result.radiusModerateDamage).toBeGreaterThan(result.radiusSevereDamage);
    expect(result.radiusSevereDamage).toBeGreaterThan(result.radiusTotalDestruction);
  });

  it('wind velocity is positive when overpressure is positive', () => {
    const result = computeAirblast(1e18, 10000, 0);
    expect(result.windVelocity).toBeGreaterThan(0);
  });

  it('airburst at altitude affects ground overpressure', () => {
    const surface = computeAirblast(1e18, 10000, 0);
    const elevated = computeAirblast(1e18, 10000, 30000);
    expect(surface.overpressure).not.toBe(elevated.overpressure);
  });
});

describe('computeEjecta', () => {
  it('ejecta thickness decreases with distance (power law)', () => {
    const near = computeEjecta(1000, 200, 1e18, 2000);
    const far = computeEjecta(1000, 200, 1e18, 10000);
    expect(near.ejectaThickness).toBeGreaterThan(far.ejectaThickness);
  });

  it('zero crater gives zero ejecta', () => {
    const result = computeEjecta(0, 0, 0, 1000);
    expect(result.ejectaThickness).toBe(0);
    expect(result.maxEjectaRange).toBe(0);
  });
});

describe('computeTsunami', () => {
  it('returns applies=false for land impact', () => {
    const result = computeTsunami(1e20, 100000, 'sedimentary_rock', 0);
    expect(result.applies).toBe(false);
  });

  it('ocean impact generates tsunami', () => {
    const result = computeTsunami(1e20, 100000, 'water', 4000);
    expect(result.applies).toBe(true);
    expect(result.cavityDiameter).toBeGreaterThan(0);
    expect(result.initialAmplitude).toBeGreaterThan(0);
  });

  it('amplitude decreases with distance', () => {
    const near = computeTsunami(1e20, 10000, 'water', 4000);
    const far = computeTsunami(1e20, 1000000, 'water', 4000);
    expect(near.amplitudeAtDistance).toBeGreaterThan(far.amplitudeAtDistance);
  });

  it('larger energy creates larger cavity', () => {
    const small = computeTsunami(1e18, 100000, 'water', 4000);
    const large = computeTsunami(1e22, 100000, 'water', 4000);
    expect(large.cavityDiameter).toBeGreaterThan(small.cavityDiameter);
  });
});
