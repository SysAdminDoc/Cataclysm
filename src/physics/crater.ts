import { GRAVITY, TARGET_DENSITY, SIMPLE_COMPLEX_TRANSITION } from './constants';
import type { CraterResult, TargetType } from './types';

export function computeCrater(
  impactorDiameter: number,
  impactorDensity: number,
  impactVelocity: number,
  angleDeg: number,
  targetType: TargetType,
  kineticEnergy: number,
): CraterResult {
  const rhoT = TARGET_DENSITY[targetType];
  const sinTheta = Math.sin((angleDeg * Math.PI) / 180);
  const Dsc = SIMPLE_COMPLEX_TRANSITION[targetType];

  const Dtc =
    1.161 *
    (impactorDensity / rhoT) ** (1 / 3) *
    impactorDiameter ** 0.78 *
    impactVelocity ** 0.44 *
    GRAVITY ** -0.22 *
    sinTheta ** (1 / 3);

  const isComplex = Dtc * 1.25 >= Dsc;

  let finalDiameter: number;
  let craterDepth: number;

  if (isComplex) {
    finalDiameter = 1.17 * Dtc ** 1.13 * Dsc ** -0.13;
    craterDepth = 0.15 * finalDiameter ** 0.43 * Dsc ** 0.57;
  } else {
    finalDiameter = 1.25 * Dtc;
    craterDepth = finalDiameter / 5;
  }

  const rimHeight = 0.04 * finalDiameter;

  const meltVolume =
    kineticEnergy > 1e18
      ? 8.9e-12 * kineticEnergy ** 0.85 * sinTheta ** 2
      : 0;

  const brecciaVolume = 0.5 * Math.PI * (finalDiameter / 2) ** 2 * craterDepth * 0.3;

  return {
    transientDiameter: Dtc,
    finalDiameter: Math.max(0, finalDiameter),
    craterDepth: Math.max(0, craterDepth),
    isComplex,
    rimHeight: Math.max(0, rimHeight),
    meltVolume: Math.max(0, meltVolume),
    brecciaVolume: Math.max(0, brecciaVolume),
  };
}
