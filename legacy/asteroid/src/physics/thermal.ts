import { THERMAL_THRESHOLDS } from './constants';
import type { ThermalResult } from './types';

function luminousEfficiency(energy: number): number {
  if (energy <= 0) return 0;
  const logE = Math.log10(energy);
  if (logE >= 23) return 1e-4;
  if (logE <= 14) return 0.01;
  return Math.pow(10, -2 + (logE - 14) * (-4 - -2) / (23 - 14));
}

function atmosphericTransmittance(slantRange: number): number {
  if (slantRange <= 0) return 1;
  const opticalDepthPerMeter = 1.5e-5;
  const tau = opticalDepthPerMeter * slantRange;
  return Math.exp(-tau);
}

function radiusForExposure(
  energy: number,
  eta: number,
  threshold: number,
  burstAltitude: number,
): number {
  let lo = 1;
  let hi = 1e8;

  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const slant = Math.sqrt(mid ** 2 + burstAltitude ** 2);
    const trans = atmosphericTransmittance(slant);
    const exposure = (energy * eta * trans) / (2 * Math.PI * slant ** 2);
    if (exposure > threshold) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
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
  const trans = atmosphericTransmittance(slantRange);
  const thermalExposure =
    slantRange > 0
      ? (energy * eta * trans) / (2 * Math.PI * slantRange ** 2)
      : (energy * eta) / (2 * Math.PI * fireballRadius ** 2);

  return {
    fireballRadius,
    fireballDuration,
    thermalExposure,
    thermalRadiusThirdDegree: radiusForExposure(energy, eta, THERMAL_THRESHOLDS.thirdDegreeBurn, burstAltitude),
    thermalRadiusSecondDegree: radiusForExposure(energy, eta, THERMAL_THRESHOLDS.secondDegreeBurn, burstAltitude),
    thermalRadiusFirstDegree: radiusForExposure(energy, eta, THERMAL_THRESHOLDS.firstDegreeBurn, burstAltitude),
    thermalRadiusIgnition: radiusForExposure(energy, eta, THERMAL_THRESHOLDS.woodIgnition, burstAltitude),
  };
}
