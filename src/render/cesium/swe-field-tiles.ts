import type { GridSnapshot } from "../../types/scenario";

export type SweImageryTile = Readonly<{
  bbox: readonly [number, number, number, number];
  pngBase64: string;
}>;

/**
 * Resolve one or more non-wrapping imagery rectangles from a solver snapshot.
 * Tiled snapshots must cover source columns exactly once and in order. Legacy
 * single-image snapshots remain supported only when their rectangle is already
 * representable without clamping or cropping.
 */
export function resolveSweImageryTiles(snapshot: GridSnapshot): SweImageryTile[] {
  if (snapshot.field_tiles?.length) {
    let expectedColumn = 0;
    const resolved: SweImageryTile[] = [];
    for (const tile of snapshot.field_tiles) {
      if (
        !Number.isSafeInteger(tile.column_offset)
        || !Number.isSafeInteger(tile.column_count)
        || tile.column_offset !== expectedColumn
        || tile.column_count <= 0
        || tile.column_offset + tile.column_count > snapshot.nx
        || !validRectangle(tile.bbox)
        || !tile.eta_png_b64
      ) return [];
      expectedColumn += tile.column_count;
      resolved.push({ bbox: tile.bbox, pngBase64: tile.eta_png_b64 });
    }
    return expectedColumn === snapshot.nx ? resolved : [];
  }
  if (!snapshot.eta_png_b64 || !validRectangle(snapshot.bbox)) return [];
  return [{ bbox: snapshot.bbox, pngBase64: snapshot.eta_png_b64 }];
}

function validRectangle(bbox: readonly number[]): bbox is readonly [number, number, number, number] {
  if (bbox.length !== 4 || !bbox.every(Number.isFinite)) return false;
  const [west, south, east, north] = bbox;
  return west >= -180 && east <= 180 && south >= -90 && north <= 90 && east > west && north > south;
}
