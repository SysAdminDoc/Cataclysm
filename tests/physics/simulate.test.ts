import { describe, it, expect } from 'vitest';
import { simulate } from '../../src/physics/simulate';
import type { ImpactParams } from '../../src/physics/types';

const CHELYABINSK: ImpactParams = {
  diameter: 19,
  density: 3300,
  velocity: 19000,
  angle: 18,
  targetType: 'sedimentary_rock',
  waterDepth: 0,
  distance: 50000,
};

const METEOR_CRATER: ImpactParams = {
  diameter: 50,
  density: 7800,
  velocity: 12800,
  angle: 45,
  targetType: 'sedimentary_rock',
  waterDepth: 0,
  distance: 50000,
};

const CHICXULUB: ImpactParams = {
  diameter: 12000,
  density: 2600,
  velocity: 20000,
  angle: 60,
  targetType: 'crystalline_rock',
  waterDepth: 0,
  distance: 1000000,
};

describe('simulate (full chain)', () => {
  it('Chelyabinsk: airburst, no crater, seismic + airblast effects', () => {
    const result = simulate(CHELYABINSK);
    expect(result.atmosphericEntry.reachesGround).toBe(false);
    expect(result.crater).toBeNull();
    expect(result.ejecta).toBeNull();
    expect(result.airblast.overpressure).toBeGreaterThan(0);
    expect(result.seismic.magnitude).toBeGreaterThan(0);
    expect(result.tsunami.applies).toBe(false);
  });

  it('Meteor Crater: ground impact, crater formed, ejecta', () => {
    const result = simulate(METEOR_CRATER);
    expect(result.atmosphericEntry.reachesGround).toBe(true);
    expect(result.crater).not.toBeNull();
    expect(result.crater!.finalDiameter).toBeGreaterThan(500);
    expect(result.ejecta).not.toBeNull();
    expect(result.ejecta!.maxEjectaRange).toBeGreaterThan(0);
  });

  it('Chicxulub: ground impact, massive complex crater', () => {
    const result = simulate(CHICXULUB);
    expect(result.atmosphericEntry.reachesGround).toBe(true);
    expect(result.crater).not.toBeNull();
    expect(result.crater!.isComplex).toBe(true);
    expect(result.crater!.finalDiameter).toBeGreaterThan(50000);
    expect(result.seismic.magnitude).toBeGreaterThan(9);
  });

  it('ocean impact produces tsunami', () => {
    const params: ImpactParams = {
      diameter: 500,
      density: 3300,
      velocity: 20000,
      angle: 45,
      targetType: 'water',
      waterDepth: 4000,
      distance: 500000,
    };
    const result = simulate(params);
    expect(result.tsunami.applies).toBe(true);
    expect(result.tsunami.cavityDiameter).toBeGreaterThan(0);
  });

  it('all effect categories are populated', () => {
    const result = simulate(METEOR_CRATER);
    expect(result.energy.kineticEnergy).toBeGreaterThan(0);
    expect(result.thermal.fireballRadius).toBeGreaterThan(0);
    expect(result.seismic.magnitude).toBeGreaterThan(0);
    expect(result.airblast.overpressure).toBeGreaterThan(0);
  });
});
