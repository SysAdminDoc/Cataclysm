import { GRAVITY } from './constants';
import type { EjectaResult } from './types';

export function computeEjecta(
  craterDiameter: number,
  craterDepth: number,
  _energy: number,
  distance: number,
): EjectaResult {
  const Rc = craterDiameter / 2;

  if (Rc <= 0) {
    return {
      ejectaThickness: 0,
      ejectaArrivalTime: 0,
      maxEjectaRange: 0,
      rimThickness: 0,
    };
  }

  const rimThickness = 0.14 * Rc * (Rc / craterDiameter) ** 0.74;

  const ejectaThickness =
    distance > Rc
      ? rimThickness * (distance / Rc) ** -3
      : rimThickness;

  const ejectVelocity = Math.sqrt(2 * GRAVITY * craterDepth) * 2;
  const maxEjectaRange = (ejectVelocity ** 2) / GRAVITY;

  const ballisticTime =
    distance > 0
      ? Math.sqrt((2 * Math.min(distance, maxEjectaRange)) / GRAVITY)
      : 0;

  return {
    ejectaThickness: Math.max(0, ejectaThickness),
    ejectaArrivalTime: ballisticTime,
    maxEjectaRange: Math.max(0, maxEjectaRange),
    rimThickness: Math.max(0, rimThickness),
  };
}
