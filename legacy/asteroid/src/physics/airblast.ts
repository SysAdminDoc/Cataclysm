import {
  KT_TO_JOULES,
  SEA_LEVEL_PRESSURE,
  SEA_LEVEL_DENSITY,
  SOUND_SPEED_AIR,
  OVERPRESSURE_THRESHOLDS,
} from './constants';
import type { AirblastResult } from './types';

function overpressureAtScaledDistance(x: number): number {
  if (x <= 0) return SEA_LEVEL_PRESSURE * 1000;
  return 3.14e11 * x ** -2.6 + 1.8e7 * x ** -1.13;
}

function groundReflectionFactor(burstAltitude: number, groundRange: number): number {
  if (burstAltitude <= 0) return 1.8;
  const heightToRange = burstAltitude / Math.max(groundRange, 1);
  if (heightToRange > 2) return 1.0;
  if (heightToRange < 0.1) return 1.8;
  return 1.0 + 0.8 * (1 - Math.min(heightToRange / 2, 1));
}

function scaledDistance(distanceM: number, energyKt: number): number {
  if (energyKt <= 0) return Infinity;
  return distanceM / (energyKt ** (1 / 3));
}

function radiusForOverpressure(
  targetPa: number,
  energyKt: number,
  burstAltitude: number,
): number {
  let lo = 1;
  let hi = 1e8;

  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const slant = Math.sqrt(mid ** 2 + burstAltitude ** 2);
    const x = scaledDistance(slant, energyKt);
    const refl = groundReflectionFactor(burstAltitude, mid);
    const p = overpressureAtScaledDistance(x) * refl;
    if (p > targetPa) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

function windFromOverpressure(deltaP: number): number {
  if (deltaP <= 0) return 0;
  return (
    (5 * deltaP) /
    (7 * SEA_LEVEL_PRESSURE) *
    Math.sqrt((2 * SEA_LEVEL_PRESSURE) / (7 * SEA_LEVEL_DENSITY))
  );
}

function overpressureToDb(deltaP: number): number {
  if (deltaP <= 0) return 0;
  return 20 * Math.log10(deltaP / 2e-5);
}

function damageDescription(deltaP: number): string {
  if (deltaP >= OVERPRESSURE_THRESHOLDS.totalDestruction) return 'Total destruction of all structures';
  if (deltaP >= OVERPRESSURE_THRESHOLDS.reinforcedDamage) return 'Reinforced concrete severely damaged';
  if (deltaP >= OVERPRESSURE_THRESHOLDS.severeDamage) return 'Most buildings collapse';
  if (deltaP >= OVERPRESSURE_THRESHOLDS.moderateDamage) return 'Moderate structural damage, injuries from debris';
  if (deltaP >= OVERPRESSURE_THRESHOLDS.minorDamage) return 'Minor structural damage, doors blown in';
  if (deltaP >= OVERPRESSURE_THRESHOLDS.windowBreakage) return 'Window breakage, light injuries';
  if (deltaP >= 1000) return 'Audible boom, no damage';
  return 'No significant effects';
}

export function computeAirblast(
  energy: number,
  distance: number,
  burstAltitude: number,
): AirblastResult {
  const energyKt = energy / KT_TO_JOULES;

  const slantRange = Math.sqrt(distance ** 2 + burstAltitude ** 2);
  const x = scaledDistance(slantRange, energyKt);
  const reflFactor = groundReflectionFactor(burstAltitude, distance);
  const overpressure = overpressureAtScaledDistance(x) * reflFactor;

  const wind = windFromOverpressure(overpressure);
  const db = overpressureToDb(overpressure);

  const arrivalTime = distance > 0 ? distance / SOUND_SPEED_AIR : 0;

  return {
    overpressure,
    windVelocity: wind,
    soundIntensity: db,
    damageDescription: damageDescription(overpressure),
    arrivalTime,
    radiusWindowBreakage: radiusForOverpressure(OVERPRESSURE_THRESHOLDS.windowBreakage, energyKt, burstAltitude),
    radiusMinorDamage: radiusForOverpressure(OVERPRESSURE_THRESHOLDS.minorDamage, energyKt, burstAltitude),
    radiusModerateDamage: radiusForOverpressure(OVERPRESSURE_THRESHOLDS.moderateDamage, energyKt, burstAltitude),
    radiusSevereDamage: radiusForOverpressure(OVERPRESSURE_THRESHOLDS.severeDamage, energyKt, burstAltitude),
    radiusTotalDestruction: radiusForOverpressure(OVERPRESSURE_THRESHOLDS.totalDestruction, energyKt, burstAltitude),
  };
}
