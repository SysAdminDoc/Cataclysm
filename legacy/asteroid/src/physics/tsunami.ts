import { GRAVITY, SEAWATER_DENSITY } from './constants';
import type { TsunamiResult, TargetType } from './types';

export function computeTsunami(
  energy: number,
  distance: number,
  targetType: TargetType,
  waterDepth: number,
  beachSlope: number = 0.02,
): TsunamiResult {
  if (targetType !== 'water' || waterDepth <= 0) {
    return {
      applies: false,
      cavityDiameter: 0,
      cavityDepth: 0,
      initialAmplitude: 0,
      amplitudeAtDistance: 0,
      runupHeight: 0,
      arrivalTime: 0,
    };
  }

  const cavityDiameter =
    1.27 * (energy / (SEAWATER_DENSITY * GRAVITY)) ** 0.25;

  const cavityDepth = Math.min(cavityDiameter / 2, waterDepth);

  const initialAmplitude = cavityDepth / 2;

  const R0 = cavityDiameter / 2;

  const isDispersive = cavityDiameter < waterDepth * 4;
  const decayExponent = isDispersive ? 1.0 : 0.5;

  let amplitudeAtDistance = initialAmplitude;
  if (distance > R0) {
    amplitudeAtDistance = initialAmplitude * (R0 / distance) ** decayExponent;
  }

  const cotBeta = 1 / beachSlope;
  const runupHeight =
    amplitudeAtDistance > 0.01
      ? 2.831 *
        Math.sqrt(cotBeta) *
        amplitudeAtDistance *
        (amplitudeAtDistance / waterDepth) ** (5 / 4)
      : 0;

  const waveSpeed = Math.sqrt(GRAVITY * waterDepth);
  const arrivalTime = distance > 0 ? distance / waveSpeed : 0;

  return {
    applies: true,
    cavityDiameter,
    cavityDepth,
    initialAmplitude,
    amplitudeAtDistance: Math.max(0, amplitudeAtDistance),
    runupHeight: Math.max(0, runupHeight),
    arrivalTime,
  };
}
