import type { ImpactParams, ImpactEffects } from './types';
import { computeEnergy } from './energy';
import { simulateAtmosphericEntry } from './atmospheric-entry';
import { computeCrater } from './crater';
import { computeThermal } from './thermal';
import { computeSeismic } from './seismic';
import { computeAirblast } from './airblast';
import { computeEjecta } from './ejecta';
import { computeTsunami } from './tsunami';

export function simulate(params: ImpactParams): ImpactEffects {
  const energy = computeEnergy(params.diameter, params.density, params.velocity);

  const entry = simulateAtmosphericEntry(
    params.diameter,
    params.density,
    params.velocity,
    params.angle,
  );

  const effectiveEnergy = entry.airburstEnergy;
  const burstAltitude = entry.airburstAltitude;

  let crater = null;
  if (entry.reachesGround) {
    crater = computeCrater(
      params.diameter,
      params.density,
      entry.impactVelocity,
      params.angle,
      params.targetType,
      effectiveEnergy,
    );
  }

  const thermal = computeThermal(
    effectiveEnergy,
    params.distance,
    burstAltitude,
  );

  const seismic = computeSeismic(effectiveEnergy, params.distance);

  const airblast = computeAirblast(
    effectiveEnergy,
    params.distance,
    burstAltitude,
  );

  let ejecta = null;
  if (crater && crater.finalDiameter > 0) {
    ejecta = computeEjecta(
      crater.finalDiameter,
      crater.craterDepth,
      effectiveEnergy,
      params.distance,
    );
  }

  const tsunami = computeTsunami(
    effectiveEnergy,
    params.distance,
    params.targetType,
    params.waterDepth,
  );

  return {
    params,
    energy,
    atmosphericEntry: entry,
    crater,
    thermal,
    seismic,
    airblast,
    ejecta,
    tsunami,
  };
}
