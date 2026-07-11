import { useEffect, useState } from 'react';
import { FALLBACK_FIREBALLS } from '../data/fallbackFireballs';
import { fetchJplJson } from '../services/jplApi';
import type { FireballEvent } from '../types/fireballs';

interface FireballApiResponse {
  fields?: string[];
  data?: (string | null)[][];
}

function numberAt(row: (string | null)[], fields: string[], name: string): number | null {
  const index = fields.indexOf(name);
  if (index < 0) return null;
  const value = row[index];
  if (value === null || value === '') return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function signedCoordinate(value: number | null, direction: string | null): number | null {
  if (value === null) return null;
  if (direction === 'S' || direction === 'W') return -value;
  return value;
}

function parseFireballs(response: FireballApiResponse): FireballEvent[] {
  const fields = response.fields ?? [];
  const rows = response.data ?? [];
  const dateIndex = fields.indexOf('date');
  const latDirIndex = fields.indexOf('lat-dir');
  const lonDirIndex = fields.indexOf('lon-dir');

  return rows.flatMap((row, index) => {
    const lat = signedCoordinate(numberAt(row, fields, 'lat'), row[latDirIndex]);
    const lon = signedCoordinate(numberAt(row, fields, 'lon'), row[lonDirIndex]);
    const date = dateIndex >= 0 ? row[dateIndex] : null;
    if (lat === null || lon === null || !date) return [];

    return [{
      id: `${date}-${index}`,
      date,
      lat,
      lon,
      energyKt: numberAt(row, fields, 'energy') ?? 0,
      impactEnergyKt: numberAt(row, fields, 'impact-e') ?? 0,
      altitudeKm: numberAt(row, fields, 'alt'),
      velocityKmS: numberAt(row, fields, 'vel'),
    }];
  });
}

export function useFireballs(enabled: boolean) {
  const [events, setEvents] = useState<FireballEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled) return;
    if (events.length > 0) return;

    let cancelled = false;
    setLoading(true);
    setError('');

    const params = new URLSearchParams({
      'req-loc': '1',
      limit: '80',
      sort: '-date',
    });

    fetchJplJson<FireballApiResponse>('fireball.api', params)
      .then(response => {
        if (cancelled) return;
        const parsed = parseFireballs(response);
        if (parsed.length > 0) {
          setEvents(parsed);
        } else {
          setEvents(FALLBACK_FIREBALLS);
          setError('Live fireball feed had no plotted events; showing built-in notable events.');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setEvents(FALLBACK_FIREBALLS);
        setError('Live fireball feed unavailable; showing built-in notable events.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, events.length]);

  return { events, loading, error };
}

export type { FireballEvent };
