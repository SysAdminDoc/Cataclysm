// Slab2-derived subduction-zone geometry lookup.
//
// Auto-fills Okada 1985 fault orientation (strike / dip / rake) and a
// representative seismogenic hypocentre depth for a placed earthquake
// epicentre, so users no longer have to hand-enter tectonic geometry. This is
// *input assembly* — it only prepares the parameters the Rust Okada solver
// consumes; no wave physics is computed here (see CLAUDE.md "Physics in Rust
// only"). Fault length/width are intentionally left to the Rust
// Wells-Coppersmith auto-sizing (pass 0).
//
// Representative geometry is a zone average from the Slab2 global model
// (Hayes et al. 2018) and published event inversions — not a location-exact
// finite-fault solution. See src/data/subduction-zones.json for provenance.

import registry from "../data/subduction-zones.json";

export type SubductionZone = {
  id: string;
  name: string;
  lat_deg: number;
  lon_deg: number;
  strike_deg: number;
  dip_deg: number;
  rake_deg: number;
  seismogenic_depth_m: number;
  reference_event: string;
};

export type SubductionMatch = {
  zone: SubductionZone;
  /** Great-circle distance from the query point to the zone reference point. */
  distanceKm: number;
  /** True when the match is within `maxMatchDistanceKm` of a mapped zone. */
  onMappedZone: boolean;
};

/** Derived Okada geometry ready to merge into an EarthquakeInput. */
export type DerivedFaultGeometry = {
  strike_deg: number;
  dip_deg: number;
  rake_deg: number;
  depth_m: number;
  /** Always 0 → Rust derives length via Wells-Coppersmith scaling. */
  fault_length_m: number;
  /** Always 0 → Rust derives width via Wells-Coppersmith scaling. */
  fault_width_m: number;
};

export const SUBDUCTION_ZONES: readonly SubductionZone[] =
  registry.zones as SubductionZone[];

export const MAX_MATCH_DISTANCE_KM: number = registry.maxMatchDistanceKm;

export const SUBDUCTION_CITATION: string = registry.citation;

const EARTH_RADIUS_KM = 6371.0088;

/** Great-circle (haversine) distance between two lat/lon points, kilometres. */
export function greatCircleKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) *
      Math.cos(lat2 * toRad) *
      Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Find the nearest mapped subduction zone to a query point. Returns `null`
 * only when the registry is empty; otherwise always returns the closest zone
 * with `onMappedZone` indicating whether it is close enough to be meaningful.
 */
export function nearestSubductionZone(
  lat_deg: number,
  lon_deg: number,
): SubductionMatch | null {
  if (!Number.isFinite(lat_deg) || !Number.isFinite(lon_deg)) return null;
  let best: SubductionMatch | null = null;
  for (const zone of SUBDUCTION_ZONES) {
    const distanceKm = greatCircleKm(
      lat_deg,
      lon_deg,
      zone.lat_deg,
      zone.lon_deg,
    );
    if (best === null || distanceKm < best.distanceKm) {
      best = {
        zone,
        distanceKm,
        onMappedZone: distanceKm <= MAX_MATCH_DISTANCE_KM,
      };
    }
  }
  return best;
}

/** Map a matched zone to Okada input geometry (length/width left auto). */
export function faultGeometryFromZone(zone: SubductionZone): DerivedFaultGeometry {
  return {
    strike_deg: zone.strike_deg,
    dip_deg: zone.dip_deg,
    rake_deg: zone.rake_deg,
    depth_m: zone.seismogenic_depth_m,
    fault_length_m: 0,
    fault_width_m: 0,
  };
}
