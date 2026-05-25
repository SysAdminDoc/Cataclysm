/**
 * Bundled-data loader boundary (I4-05). Centralises JSON loading +
 * runtime validation for the static datasets that ship in the bundle:
 *
 * - 60+ named coastal points used by the Synolakis runup overlay.
 * - DART buoy historical observations for the three modern events.
 *
 * Components used to `import jsonFile from "../data/X.json"` directly
 * and run their own integrity filter inline. Centralising here gives
 * us one place to add new datasets (e.g. GEBCO bathymetry tiles in
 * v0.4.0) and one place to add tests.
 */

import type {
  CoastalPoint,
  CoastalPointDatabase,
  DartDatabase,
} from "../types/scenario";
import coastalDbRaw from "../data/coastal_points.json";
import dartDbRaw from "../data/dart_buoys.json";

const coastalDb = coastalDbRaw as CoastalPointDatabase;
const dartDb = dartDbRaw as unknown as DartDatabase;

/** Coastal points filtered to in-range lat/lon and finite slope/depth. A
 *  corrupted bundled JSON (or a future schema change) with out-of-range
 *  coordinates would silently nuke the haversine math in the Rust
 *  command. We drop bad points up front so the rest of the database
 *  still works. Computed once at module load. */
const VALID_COASTAL_POINTS: readonly CoastalPoint[] = coastalDb.points.filter(
  (p) =>
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lon) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lon >= -180 &&
    p.lon <= 180 &&
    Number.isFinite(p.beach_slope_deg) &&
    Number.isFinite(p.offshore_depth_m),
);

/** All in-range coastal points. */
export function getCoastalPoints(): readonly CoastalPoint[] {
  return VALID_COASTAL_POINTS;
}

/** The full DART buoy database (events keyed by preset id). */
export function getDartEvents(): DartDatabase {
  return dartDb;
}

/** Convenience: list of buoys for a single preset id, empty if no event
 *  is bundled for that preset. */
export function getDartBuoysForPreset(presetId: string | null): DartDatabase["events"][string]["buoys"] {
  if (!presetId) return [];
  const eventKey = PRESET_TO_DART_EVENT[presetId];
  if (!eventKey) return [];
  return dartDb.events[eventKey]?.buoys ?? [];
}

/** Mapping from preset id to DART event key. Centralised here so
 *  DartOverlay and the Globe DART-pin renderer share one truth. */
export const PRESET_TO_DART_EVENT: Record<string, string> = {
  tohoku_2011: "tohoku_2011",
  indian_ocean_2004: "indian_ocean_2004",
  hunga_tonga_2022: "hunga_tonga_2022",
};
