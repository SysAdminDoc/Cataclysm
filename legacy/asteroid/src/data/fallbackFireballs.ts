import type { FireballEvent } from '../types/fireballs';

export const FALLBACK_FIREBALLS: FireballEvent[] = [
  {
    id: 'chelyabinsk-2013',
    date: '2013-02-15 03:20:33',
    lat: 54.8,
    lon: 61.1,
    energyKt: 440,
    impactEnergyKt: 440,
    altitudeKm: 23.3,
    velocityKmS: 18.6,
  },
  {
    id: 'bering-sea-2018',
    date: '2018-12-18 23:48:20',
    lat: 56.9,
    lon: 172.4,
    energyKt: 173,
    impactEnergyKt: 173,
    altitudeKm: 25.6,
    velocityKmS: 32,
  },
  {
    id: 'tunguska-region-1908',
    date: '1908-06-30 00:14:00',
    lat: 60.9,
    lon: 101.9,
    energyKt: 10_000,
    impactEnergyKt: 10_000,
    altitudeKm: 8,
    velocityKmS: 27,
  },
];
