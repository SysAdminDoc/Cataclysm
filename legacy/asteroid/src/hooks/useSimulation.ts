import { useState, useCallback, useMemo, useEffect } from 'react';
import { simulate } from '../physics';
import { EARTH_RADIUS } from '../physics/constants';
import type { ImpactParams, TargetType } from '../physics/types';
import { PRESETS } from '../presets/historical';

const DEFAULT_PARAMS: ImpactParams = {
  diameter: 50,
  density: 7800,
  velocity: 12800,
  angle: 45,
  targetType: 'sedimentary_rock',
  waterDepth: 0,
  beachSlope: 0.02,
  distance: 50000,
};

const DEFAULT_LAT = 35.0268;
const DEFAULT_LON = -111.0222;

interface UseSimulationOptions {
  syncUrl?: boolean;
  defaultParams?: ImpactParams;
  defaultLat?: number;
  defaultLon?: number;
}

interface ScenarioSnapshot {
  params: ImpactParams;
  impactLat: number;
  impactLon: number;
  observerLat: number | null;
  observerLon: number | null;
}

function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(a));
}

const LAND_BOXES: [number, number, number, number][] = [
  [-35, -75, 12, -34],    // South America
  [7, -83, 49, -52],      // Central + North America east
  [25, -130, 70, -83],    // North America west
  [60, -170, 72, -130],   // Alaska
  [35, -12, 71, 40],      // Europe
  [-35, 8, 37, 52],       // Africa
  [1, 95, 55, 145],       // East Asia
  [8, 68, 55, 95],        // South/Central Asia
  [40, 40, 55, 68],       // Middle East/Central Asia
  [-47, 113, -10, 154],   // Australia
  [-48, 165, -34, 179],   // New Zealand
  [60, 30, 78, 180],      // Siberia
  [-90, -180, -60, 180],  // Antarctica
];

function detectOcean(lat: number, lon: number): boolean {
  for (const [latMin, lonMin, latMax, lonMax] of LAND_BOXES) {
    if (lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax) {
      return false;
    }
  }
  return true;
}

function estimateOceanDepth(lat: number): number {
  const absLat = Math.abs(lat);
  if (absLat > 60) return 3000;
  if (absLat < 15) return 4500;
  return 4000;
}

function parseUrlParams(): { params: ImpactParams; lat: number; lon: number } | null {
  const hash = window.location.hash.slice(1);
  if (!hash) return null;
  try {
    const sp = new URLSearchParams(hash);
    const d = sp.get('d'), rho = sp.get('rho'), v = sp.get('v'),
      a = sp.get('a'), t = sp.get('t'), wd = sp.get('wd'),
      dist = sp.get('dist'), lat = sp.get('lat'), lon = sp.get('lon');
    if (!d || !rho || !v || !a) return null;
    return {
      params: {
        diameter: parseFloat(d),
        density: parseFloat(rho),
        velocity: parseFloat(v),
        angle: parseFloat(a),
        targetType: (t || 'sedimentary_rock') as TargetType,
        waterDepth: parseFloat(wd || '0'),
        beachSlope: 0.02,
        distance: parseFloat(dist || '50000'),
      },
      lat: parseFloat(lat || String(DEFAULT_LAT)),
      lon: parseFloat(lon || String(DEFAULT_LON)),
    };
  } catch {
    return null;
  }
}

function writeUrlParams(params: ImpactParams, lat: number, lon: number) {
  const sp = new URLSearchParams();
  sp.set('d', String(params.diameter));
  sp.set('rho', String(params.density));
  sp.set('v', String(params.velocity));
  sp.set('a', String(params.angle));
  sp.set('t', params.targetType);
  if (params.waterDepth > 0) sp.set('wd', String(params.waterDepth));
  sp.set('dist', String(params.distance));
  sp.set('lat', lat.toFixed(4));
  sp.set('lon', lon.toFixed(4));
  window.history.replaceState(null, '', `#${sp.toString()}`);
}

export function useSimulation(options: UseSimulationOptions = {}) {
  const syncUrl = options.syncUrl ?? true;
  const initial = syncUrl ? parseUrlParams() : null;
  const [params, setParams] = useState<ImpactParams>(
    initial?.params ?? options.defaultParams ?? DEFAULT_PARAMS,
  );
  const [impactLat, setImpactLat] = useState(initial?.lat ?? options.defaultLat ?? DEFAULT_LAT);
  const [impactLon, setImpactLon] = useState(initial?.lon ?? options.defaultLon ?? DEFAULT_LON);
  const [observerLat, setObserverLat] = useState<number | null>(null);
  const [observerLon, setObserverLon] = useState<number | null>(null);

  const results = useMemo(() => simulate(params), [params]);

  useEffect(() => {
    if (!syncUrl) return;
    writeUrlParams(params, impactLat, impactLon);
  }, [params, impactLat, impactLon, syncUrl]);

  const updateParam = useCallback(<K extends keyof ImpactParams>(
    key: K,
    value: ImpactParams[K],
  ) => {
    setParams(prev => ({ ...prev, [key]: value }));
  }, []);

  const setImpactLocation = useCallback((lat: number, lon: number) => {
    setImpactLat(lat);
    setImpactLon(lon);

    const isOcean = detectOcean(lat, lon);
    if (isOcean) {
      setParams(prev => ({
        ...prev,
        targetType: 'water',
        waterDepth: estimateOceanDepth(lat),
      }));
    } else {
      setParams(prev => ({
        ...prev,
        targetType: prev.targetType === 'water' ? 'sedimentary_rock' : prev.targetType,
        waterDepth: 0,
      }));
    }
  }, []);

  const setObserverLocation = useCallback((lat: number, lon: number) => {
    setObserverLat(lat);
    setObserverLon(lon);
    const dist = haversineDistance(impactLat, impactLon, lat, lon);
    setParams(prev => ({ ...prev, distance: Math.round(dist) }));
  }, [impactLat, impactLon]);

  const loadPreset = useCallback((index: number) => {
    const preset = PRESETS[index];
    if (preset) {
      setParams(preset.params);
      setObserverLat(null);
      setObserverLon(null);
    }
  }, []);

  const replaceScenario = useCallback((snapshot: ScenarioSnapshot) => {
    setParams({ ...snapshot.params });
    setImpactLat(snapshot.impactLat);
    setImpactLon(snapshot.impactLon);
    setObserverLat(snapshot.observerLat);
    setObserverLon(snapshot.observerLon);
  }, []);

  return {
    params,
    results,
    impactLat,
    impactLon,
    observerLat,
    observerLon,
    updateParam,
    setImpactLocation,
    setObserverLocation,
    loadPreset,
    replaceScenario,
  };
}
