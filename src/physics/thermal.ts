import { THERMAL_THRESHOLDS } from './constants';
import type { ThermalResult } from './types';

function luminousEfficiency(energy: number): number {
  if (energy > 1e23) return 1e-4;
  if (energy > 1e20) return 3e-4;
  if (energy > 1e17) return 1e-3;
  return 0.01;
}

function radiusForExposure(energy: number, eta: number, threshold: number): number {
  const r = Math.sqrt((energy * eta) / (2 * Math.PI * threshold));
  return Math.max(0, r);
}

export function computeThermal(
  energy: number,
  distance: number,
  burstAltitude: number,
): ThermalResult {
  const fireballRadius = 0.002 * energy ** (1 / 3);

  const fireballDuration = 0.05 * energy ** (1 / 6);

  const eta = luminousEfficiency(energy);

  const slantRange = Math.sqrt(distance ** 2 + burstAltitude ** 2);
  const thermalExposure =
    slantRange > 0 ? (energy * eta) / (2 * Math.PI * slantRange ** 2) : Infinity;

  return {
    fireballRadius,
    fireballDuration,
    thermalExposure,
    thermalRadiusThirdDegree: radiusForExposure(energy, eta, THERMAL_THRESHOLDS.thirdDegreeBurn),
    thermalRadiusSecondDegree: radiusForExposure(energy, eta, THERMAL_THRESHOLDS.secondDegreeBurn),
    thermalRadiusFirstDegree: radiusForExposure(energy, eta, THERMAL_THRESHOLDS.firstDegreeBurn),
    thermalRadiusIgnition: radiusForExposure(energy, eta, THERMAL_THRESHOLDS.woodIgnition),
  };
}
