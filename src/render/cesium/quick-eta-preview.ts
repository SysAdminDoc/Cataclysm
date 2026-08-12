import type { QuickEtaPreview } from "../../types/scenario";

const MAX_PREVIEW_CELLS = 500_000;

function validBbox(bbox: readonly number[]): bbox is [number, number, number, number] {
  if (bbox.length !== 4 || !bbox.every(Number.isFinite)) return false;
  const [west, south, east, north] = bbox;
  return west >= -180 && east <= 180 && south >= -90 && north <= 90 && east > west && north > south;
}

export function isValidQuickEtaPreview(value: QuickEtaPreview | null | undefined): value is QuickEtaPreview {
  return Boolean(
    value
    && Number.isSafeInteger(value.nx)
    && Number.isSafeInteger(value.ny)
    && value.nx > 0
    && value.ny > 0
    && value.nx * value.ny <= MAX_PREVIEW_CELLS
    && validBbox(value.bbox)
    && Array.isArray(value.arrival_s)
    && value.arrival_s.length === value.nx * value.ny
    && value.arrival_s.every((arrival) => arrival === null || (Number.isFinite(arrival) && arrival >= 0))
    && Number.isFinite(value.elapsed_wall_ms)
    && value.elapsed_wall_ms >= 0,
  );
}

export function quickEtaArrivalRange(value: QuickEtaPreview | null | undefined): {
  minimumS: number;
  maximumS: number;
  reachedCells: number;
} | null {
  if (!isValidQuickEtaPreview(value)) return null;
  let minimumS = Number.POSITIVE_INFINITY;
  let maximumS = Number.NEGATIVE_INFINITY;
  let reachedCells = 0;
  for (const arrival of value.arrival_s) {
    if (arrival === null) continue;
    minimumS = Math.min(minimumS, arrival);
    maximumS = Math.max(maximumS, arrival);
    reachedCells += 1;
  }
  if (reachedCells === 0) return null;
  return {
    minimumS,
    maximumS,
    reachedCells,
  };
}

function channel(start: number, end: number, amount: number): number {
  return Math.round(start + (end - start) * amount);
}

/** Build a transparent PNG from backend arrival values for Cesium's imagery
 * pipeline. This is a visualization transform only; no arrival values are
 * interpolated, extrapolated, or otherwise recomputed here. */
export function quickEtaPreviewPng(value: QuickEtaPreview | null | undefined): string | null {
  const range = quickEtaArrivalRange(value);
  if (!range || !value || typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = value.nx;
  canvas.height = value.ny;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const image = context.createImageData(value.nx, value.ny);
  const span = Math.max(range.maximumS - range.minimumS, 1);
  for (let index = 0; index < value.arrival_s.length; index += 1) {
    const arrival = value.arrival_s[index];
    if (arrival === null) continue;
    const amount = Math.min(1, Math.max(0, (arrival - range.minimumS) / span));
    const offset = index * 4;
    // Purple → gold keeps the preview visually distinct from the diverging
    // SWE elevation field and the dashed authoritative isochrones.
    image.data[offset] = channel(108, 249, amount);
    image.data[offset + 1] = channel(92, 226, amount);
    image.data[offset + 2] = channel(231, 175, amount);
    image.data[offset + 3] = 170;
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}
