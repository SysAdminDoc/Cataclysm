import presetData from "../data/nukemap/mirv-presets.json";

export type MirvPattern = "circle" | "triangle" | "grid" | "cross";

export type MirvPreset = Readonly<{
  id: string;
  name: string;
  warheads: number;
  spreadKm: number;
  yieldKt: number;
  pattern: MirvPattern;
  description: string;
}>;

export type MirvPoint = Readonly<{
  id: string;
  index: number;
  lat: number;
  lon: number;
  delayMs: number;
}>;

export type MirvPreview = Readonly<{
  id: string;
  center: Readonly<{ lat: number; lon: number }>;
  preset: MirvPreset;
  points: readonly MirvPoint[];
}>;

export const MIRV_PRESETS = presetData.items as MirvPreset[];

function assertMirvInput(center: Readonly<{ lat: number; lon: number }>, preset: MirvPreset): void {
  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lon) || Math.abs(center.lat) > 89 || center.lon < -180 || center.lon > 180) {
    throw new Error("MIRV preview center must be within ±89° latitude and ±180° longitude.");
  }
  if (!Number.isInteger(preset.warheads) || preset.warheads < 1 || preset.warheads > 20) {
    throw new Error("MIRV preview requires 1–20 warheads.");
  }
  if (!Number.isFinite(preset.spreadKm) || preset.spreadKm <= 0 || preset.spreadKm > 100) {
    throw new Error("MIRV preview spread must be greater than 0 and no more than 100 km.");
  }
}

function wrapLongitude(lon: number): number {
  return ((lon + 180) % 360 + 360) % 360 - 180;
}

export function generateMirvPattern(
  center: Readonly<{ lat: number; lon: number }>,
  preset: MirvPreset,
): MirvPoint[] {
  assertMirvInput(center, preset);
  const earthRadiusKm = 6_371;
  const degrees = 180 / Math.PI;
  const longitudeScale = Math.cos(center.lat * Math.PI / 180);
  const points: Array<Omit<MirvPoint, "id" | "index">> = [];
  const add = (lat: number, lon: number, delayMs: number) => points.push({ lat, lon: wrapLongitude(lon), delayMs });

  if (preset.pattern === "circle") {
    for (let index = 0; index < preset.warheads; index += 1) {
      const angle = (index / preset.warheads) * Math.PI * 2 - Math.PI / 2;
      const dLat = ((preset.spreadKm / 2) * Math.sin(angle)) / earthRadiusKm * degrees;
      const dLon = ((preset.spreadKm / 2) * Math.cos(angle)) / earthRadiusKm * degrees / longitudeScale;
      add(center.lat + dLat, center.lon + dLon, index * 200);
    }
  } else if (preset.pattern === "triangle") {
    const angles = [0, 2 * Math.PI / 3, 4 * Math.PI / 3];
    for (let index = 0; index < Math.min(preset.warheads, angles.length); index += 1) {
      const dLat = ((preset.spreadKm / 2) * Math.sin(angles[index])) / earthRadiusKm * degrees;
      const dLon = ((preset.spreadKm / 2) * Math.cos(angles[index])) / earthRadiusKm * degrees / longitudeScale;
      add(center.lat + dLat, center.lon + dLon, index * 300);
    }
  } else if (preset.pattern === "grid") {
    const columns = Math.ceil(Math.sqrt(preset.warheads));
    const rows = Math.ceil(preset.warheads / columns);
    let index = 0;
    for (let row = 0; row < rows && index < preset.warheads; row += 1) {
      for (let column = 0; column < columns && index < preset.warheads; column += 1) {
        const dx = (column - (columns - 1) / 2) * preset.spreadKm / columns;
        const dy = (row - (rows - 1) / 2) * preset.spreadKm / rows;
        add(
          center.lat + dy / earthRadiusKm * degrees,
          center.lon + dx / earthRadiusKm * degrees / longitudeScale,
          index * 150,
        );
        index += 1;
      }
    }
  } else {
    add(center.lat, center.lon, 0);
    const directions = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    for (let index = 0; index < Math.min(preset.warheads - 1, directions.length); index += 1) {
      const dLat = directions[index][0] * preset.spreadKm / 2 / earthRadiusKm * degrees;
      const dLon = directions[index][1] * preset.spreadKm / 2 / earthRadiusKm * degrees / longitudeScale;
      add(center.lat + dLat, center.lon + dLon, (index + 1) * 250);
    }
  }

  return points.map((point, index) => ({
    id: `${preset.id}:warhead:${index + 1}`,
    index: index + 1,
    ...point,
  }));
}

export function buildMirvPreview(
  center: Readonly<{ lat: number; lon: number }>,
  preset: MirvPreset,
): MirvPreview {
  return {
    id: `${preset.id}:${center.lat.toFixed(6)}:${center.lon.toFixed(6)}`,
    center: { ...center },
    preset,
    points: generateMirvPattern(center, preset),
  };
}

export function mirvSpreadCircle(preview: MirvPreview, segments = 72): Array<Readonly<{ lat: number; lon: number }>> {
  const earthRadiusKm = 6_371;
  const degrees = 180 / Math.PI;
  const longitudeScale = Math.cos(preview.center.lat * Math.PI / 180);
  const points = Array.from({ length: Math.max(12, segments) }, (_, index) => {
    const angle = (index / Math.max(12, segments)) * Math.PI * 2 - Math.PI / 2;
    const dLat = ((preview.preset.spreadKm / 2) * Math.sin(angle)) / earthRadiusKm * degrees;
    const dLon = ((preview.preset.spreadKm / 2) * Math.cos(angle)) / earthRadiusKm * degrees / longitudeScale;
    return { lat: preview.center.lat + dLat, lon: wrapLongitude(preview.center.lon + dLon) };
  });
  return [...points, points[0]];
}
