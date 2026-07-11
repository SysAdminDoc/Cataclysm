import { MT_TO_JOULES, KT_TO_JOULES } from './constants';
import type { EnergyResult } from './types';

export function computeEnergy(
  diameter: number,
  density: number,
  velocity: number,
): EnergyResult {
  const radius = diameter / 2;
  const volume = (4 / 3) * Math.PI * radius ** 3;
  const mass = density * volume;
  const kineticEnergy = 0.5 * mass * velocity ** 2;

  return {
    kineticEnergy,
    megatons: kineticEnergy / MT_TO_JOULES,
    kilotons: kineticEnergy / KT_TO_JOULES,
    impactorMass: mass,
  };
}
