import { describe, it, expect } from 'vitest';
import { computeCrater } from '../../src/physics/crater';
import { computeEnergy } from '../../src/physics/energy';

describe('computeCrater', () => {
  it('Meteor Crater: ~50m iron → ~1.2 km crater, simple', () => {
    const e = computeEnergy(50, 7800, 12800);
    const result = computeCrater(50, 7800, 12800, 45, 'sedimentary_rock', e.kineticEnergy);
    expect(result.finalDiameter).toBeGreaterThan(500);
    expect(result.finalDiameter).toBeLessThan(3000);
    expect(result.isComplex).toBe(false);
  });

  it('Chicxulub: ~12km asteroid → ~180 km crater, complex', () => {
    const e = computeEnergy(12000, 2600, 20000);
    const result = computeCrater(12000, 2600, 20000, 60, 'crystalline_rock', e.kineticEnergy);
    expect(result.finalDiameter).toBeGreaterThan(50000);
    expect(result.finalDiameter).toBeLessThan(500000);
    expect(result.isComplex).toBe(true);
  });

  it('Ries Crater: ~1500m → ~24 km crater, complex', () => {
    const e = computeEnergy(1500, 3500, 20000);
    const result = computeCrater(1500, 3500, 20000, 30, 'crystalline_rock', e.kineticEnergy);
    expect(result.finalDiameter).toBeGreaterThan(10000);
    expect(result.finalDiameter).toBeLessThan(60000);
    expect(result.isComplex).toBe(true);
  });

  it('small impactor makes shallow simple crater', () => {
    const e = computeEnergy(10, 3300, 15000);
    const result = computeCrater(10, 3300, 15000, 45, 'sedimentary_rock', e.kineticEnergy);
    expect(result.isComplex).toBe(false);
    expect(result.craterDepth).toBeLessThan(result.finalDiameter);
  });

  it('complex craters are shallower relative to diameter', () => {
    const e1 = computeEnergy(10, 3300, 15000);
    const simple = computeCrater(10, 3300, 15000, 45, 'sedimentary_rock', e1.kineticEnergy);
    const e2 = computeEnergy(5000, 3300, 20000);
    const complex = computeCrater(5000, 3300, 20000, 45, 'sedimentary_rock', e2.kineticEnergy);

    const simpleRatio = simple.craterDepth / simple.finalDiameter;
    const complexRatio = complex.craterDepth / complex.finalDiameter;
    expect(complexRatio).toBeLessThan(simpleRatio);
  });

  it('melt volume is zero for small impacts', () => {
    const e = computeEnergy(1, 3300, 15000);
    const result = computeCrater(1, 3300, 15000, 45, 'sedimentary_rock', e.kineticEnergy);
    expect(result.meltVolume).toBe(0);
  });

  it('steeper angle produces larger crater', () => {
    const e = computeEnergy(50, 7800, 12800);
    const shallow = computeCrater(50, 7800, 12800, 15, 'sedimentary_rock', e.kineticEnergy);
    const steep = computeCrater(50, 7800, 12800, 75, 'sedimentary_rock', e.kineticEnergy);
    expect(steep.finalDiameter).toBeGreaterThan(shallow.finalDiameter);
  });
});
