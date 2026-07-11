// Fallout plume geometry — ported from NukeMap NM.Effects.drawFallout
// (js/effects.js). Pure: turns the {heavy,light} plume dimensions + wind
// bearing into downwind "teardrop" polygons (lon/lat rings) the globe draws.

import type { GeoPoint } from "../types";
import type { FalloutPlume } from "./physics";

const EARTH_R_KM = 6371;
const SEGMENTS = 48;

/** One closed polygon ring (lon/lat degrees), plus its category/color. */
export interface FalloutRing {
  label: string;
  color: string;
  points: GeoPoint[]; // closed ring, {lat, lon}
}

// Teardrop: length extends downwind (1+cos term biases toward the wind
// bearing), width spreads crosswind. windFromDeg is the direction the wind
// blows FROM, so fallout travels toward windFromDeg+180.
function teardrop(lat: number, lon: number, lengthKm: number, widthKm: number, windFromDeg: number): GeoPoint[] {
  const bearing = (((windFromDeg + 180) % 360) * Math.PI) / 180;
  const cosB = Math.cos(bearing);
  const sinB = Math.sin(bearing);
  const cosLat = Math.cos((lat * Math.PI) / 180) || 1e-4;
  const pts: GeoPoint[] = [];
  for (let i = 0; i <= SEGMENTS; i += 1) {
    const t = (i / SEGMENTS) * 2 * Math.PI;
    const along = lengthKm * (0.5 + 0.5 * Math.cos(t));
    const across = (widthKm / 2) * Math.sin(t);
    const dx = along * cosB - across * sinB;
    const dy = along * sinB + across * cosB;
    pts.push({
      lat: lat + (dy / EARTH_R_KM) * (180 / Math.PI),
      lon: lon + (dx / EARTH_R_KM) * (180 / Math.PI) / cosLat,
    });
  }
  return pts;
}

/**
 * Build heavy + light fallout rings for a detonation at `center`. Returns an
 * empty array for air bursts (no ground fallout). windFromDeg defaults to a
 * westerly (270° → plume drifts east).
 */
export function falloutRings(center: GeoPoint, plume: FalloutPlume | null, windFromDeg = 270): FalloutRing[] {
  if (!plume) return [];
  return [
    { label: "Light fallout", color: "#a6e3a1", points: teardrop(center.lat, center.lon, plume.light.length, plume.light.width, windFromDeg) },
    { label: "Heavy fallout (lethal)", color: "#f38ba8", points: teardrop(center.lat, center.lon, plume.heavy.length, plume.heavy.width, windFromDeg) },
  ];
}
