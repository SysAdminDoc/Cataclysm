import { useState, useCallback, useMemo } from 'react';
import { simulate } from '../physics';
import type { ImpactParams, ImpactEffects } from '../physics/types';
import { PRESETS } from '../presets/historical';

const DEFAULT_PARAMS: ImpactParams = {
  diameter: 50,
  density: 7800,
  velocity: 12800,
  angle: 45,
  targetType: 'sedimentary_rock',
  waterDepth: 0,
  distance: 50000,
};

export interface SimulationState {
  params: ImpactParams;
  results: ImpactEffects | null;
  impactLat: number;
  impactLon: number;
}

export function useSimulation() {
  const [params, setParams] = useState<ImpactParams>(DEFAULT_PARAMS);
  const [impactLat, setImpactLat] = useState(35.0268);
  const [impactLon, setImpactLon] = useState(-111.0222);

  const results = useMemo(() => simulate(params), [params]);

  const updateParam = useCallback(<K extends keyof ImpactParams>(
    key: K,
    value: ImpactParams[K],
  ) => {
    setParams(prev => ({ ...prev, [key]: value }));
  }, []);

  const setImpactLocation = useCallback((lat: number, lon: number) => {
    setImpactLat(lat);
    setImpactLon(lon);
  }, []);

  const loadPreset = useCallback((index: number) => {
    const preset = PRESETS[index];
    if (preset) {
      setParams(preset.params);
    }
  }, []);

  const setDistance = useCallback((d: number) => {
    setParams(prev => ({ ...prev, distance: d }));
  }, []);

  return {
    params,
    results,
    impactLat,
    impactLon,
    updateParam,
    setImpactLocation,
    loadPreset,
    setDistance,
  };
}
