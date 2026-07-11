import { describe, it, expect } from 'vitest';
import { simulateAtmosphericEntry } from '../../src/physics/atmospheric-entry';

describe('simulateAtmosphericEntry', () => {
  it('Chelyabinsk: ~19m stony at 19 km/s, 18 deg should airburst', () => {
    const result = simulateAtmosphericEntry(19, 3300, 19000, 18);
    expect(result.reachesGround).toBe(false);
    expect(result.airburstAltitude).toBeGreaterThan(10000);
    expect(result.airburstAltitude).toBeLessThan(50000);
  });

  it('Meteor Crater: ~50m iron at 12.8 km/s should reach ground', () => {
    const result = simulateAtmosphericEntry(50, 7800, 12800, 45);
    expect(result.reachesGround).toBe(true);
    expect(result.impactVelocity).toBeGreaterThan(5000);
  });

  it('Chicxulub: ~12km asteroid should reach ground with minimal slowdown', () => {
    const result = simulateAtmosphericEntry(12000, 2600, 20000, 60);
    expect(result.reachesGround).toBe(true);
    expect(result.impactVelocity).toBeGreaterThan(19000);
  });

  it('tiny ice fragment should disintegrate', () => {
    // 1cm ice comet at 25 km/s — low strength, high velocity, tiny mass
    const result = simulateAtmosphericEntry(0.01, 1000, 25000, 45);
    expect(result.reachesGround).toBe(false);
  });

  it('small stony meteorite reaches ground as decelerated fragment', () => {
    // 10cm stony at 20 km/s — slows to terminal velocity, falls as meteorite
    const result = simulateAtmosphericEntry(0.1, 3300, 20000, 45);
    expect(result.impactVelocity).toBeLessThan(5000);
  });

  it('large iron should reach ground', () => {
    const result = simulateAtmosphericEntry(100, 7800, 15000, 45);
    expect(result.reachesGround).toBe(true);
  });

  it('trajectory should have decreasing altitude', () => {
    const result = simulateAtmosphericEntry(50, 3300, 15000, 45);
    const traj = result.trajectory;
    expect(traj.length).toBeGreaterThan(2);
    expect(traj[0].altitude).toBeGreaterThan(traj[traj.length - 1].altitude);
  });

  it('breakup altitude should be set for fragile objects', () => {
    const result = simulateAtmosphericEntry(30, 1500, 20000, 45);
    expect(result.breakupAltitude).toBeGreaterThan(0);
  });
});
