import { describe, it, expect } from 'vitest';
import { computeEnergy } from '../../src/physics/energy';

describe('computeEnergy', () => {
  it('computes mass of a sphere correctly', () => {
    const result = computeEnergy(10, 3000, 20000);
    const expectedMass = 3000 * (4 / 3) * Math.PI * 5 ** 3;
    expect(result.impactorMass).toBeCloseTo(expectedMass, 0);
  });

  it('computes kinetic energy correctly', () => {
    const result = computeEnergy(10, 3000, 20000);
    const expectedKE = 0.5 * result.impactorMass * 20000 ** 2;
    expect(result.kineticEnergy).toBeCloseTo(expectedKE, 0);
  });

  it('converts to megatons correctly', () => {
    const result = computeEnergy(10, 3000, 20000);
    expect(result.megatons).toBe(result.kineticEnergy / 4.184e15);
  });

  it('Chelyabinsk: ~19m stony at 19 km/s should give ~500 kt', () => {
    const result = computeEnergy(19, 3300, 19000);
    expect(result.kilotons).toBeGreaterThan(100);
    expect(result.kilotons).toBeLessThan(2000);
  });

  it('Meteor Crater: ~50m iron at 12.8 km/s should give ~10 Mt range', () => {
    const result = computeEnergy(50, 7800, 12800);
    expect(result.megatons).toBeGreaterThan(1);
    expect(result.megatons).toBeLessThan(100);
  });

  it('Chicxulub: ~12km asteroid at 20 km/s should give >1e23 J', () => {
    const result = computeEnergy(12000, 2600, 20000);
    expect(result.kineticEnergy).toBeGreaterThan(1e23);
    expect(result.kineticEnergy).toBeLessThan(1e26);
  });
});
