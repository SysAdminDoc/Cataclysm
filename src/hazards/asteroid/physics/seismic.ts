import { SEISMIC_VELOCITY, MERCALLI_DESCRIPTIONS } from './constants';
import type { SeismicResult } from './types';

export function computeSeismic(
  energy: number,
  distance: number,
): SeismicResult {
  const magnitude = 0.67 * Math.log10(energy) - 5.87;

  const distKm = distance / 1000;
  let mercalli: number;

  if (distKm <= 0) {
    mercalli = 12;
  } else {
    mercalli = magnitude + 1.5 - 3.0 * Math.log10(Math.max(distKm, 1));
  }

  mercalli = Math.max(1, Math.min(12, Math.round(mercalli)));

  const arrivalTime = distance > 0 ? distance / SEISMIC_VELOCITY : 0;

  return {
    magnitude: Math.max(0, magnitude),
    mercalliIntensity: mercalli,
    mercalliDescription: MERCALLI_DESCRIPTIONS[mercalli] ?? 'Unknown',
    arrivalTime,
  };
}
