import { describe, expect, it } from 'vitest';
import { validateImpactParams } from '../../src/validation/impactValidation';
import type { ImpactParams } from '../../src/physics/types';

const VALID_PARAMS: ImpactParams = {
  diameter: 50,
  density: 3300,
  velocity: 20_000,
  angle: 45,
  targetType: 'sedimentary_rock',
  waterDepth: 0,
  beachSlope: 0.02,
  distance: 50_000,
};

describe('validateImpactParams', () => {
  it('accepts normal meteor crater style parameters', () => {
    expect(validateImpactParams(VALID_PARAMS)).toEqual([]);
  });

  it('flags impossible physical values as danger warnings', () => {
    const warnings = validateImpactParams({
      ...VALID_PARAMS,
      diameter: 0,
      density: 0,
      velocity: 0,
      angle: 120,
      distance: -1,
    });

    expect(warnings.filter(w => w.severity === 'danger')).toHaveLength(5);
  });

  it('flags extreme but still computable values as warnings', () => {
    const warnings = validateImpactParams({
      ...VALID_PARAMS,
      diameter: 75_000,
      velocity: 90_000,
      angle: 3,
    });

    expect(warnings.map(w => w.message)).toContain('Diameter is beyond the calibrated crater range.');
    expect(warnings.map(w => w.message)).toContain('Velocity exceeds typical Solar System impact limits.');
    expect(warnings.map(w => w.message)).toContain('Very shallow entry has high uncertainty.');
  });

  it('catches water and land target mismatches', () => {
    expect(validateImpactParams({ ...VALID_PARAMS, targetType: 'water', waterDepth: 0 }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ message: 'Ocean impacts need a positive water depth.' }),
      ]));

    expect(validateImpactParams({ ...VALID_PARAMS, waterDepth: 1_000 }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ message: 'Water depth is ignored for land targets.' }),
      ]));
  });
});
