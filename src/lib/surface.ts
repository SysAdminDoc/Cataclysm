import maskJson from "../data/surface-mask.json";
import { COARSE_BATHYMETRY_DEPTH_FIELD, type HeightFieldMetadata } from "./geodesy";

export type SurfaceClass = "land" | "ocean" | "inland_water" | "ice" | "coast" | "unknown";
type SurfaceRegion = { id: string; surface_class: SurfaceClass; bounds: [number, number, number, number] };
type SurfaceMask = {
  schema_version: number;
  mask_version: string;
  source_asset_id: string;
  horizontal_crs: string;
  vertical_datum: string;
  coastal_band_deg: number;
  declared_horizontal_error_m: number;
  confidence: string;
  wet_classes: string[];
  regions: SurfaceRegion[];
};
const mask = maskJson as unknown as SurfaceMask;

export type SurfaceProbe = {
  lat_deg: number;
  lon_deg: number;
  surface_class: SurfaceClass;
  is_wet: boolean;
  water_depth_m: number;
  mask_version: string;
  mask_source_asset_id: string;
  confidence: string;
  declared_horizontal_error_m: number;
  height_field: HeightFieldMetadata;
};

function normalize(latDeg: number, lonDeg: number): [number, number] | null {
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg) || Math.abs(latDeg) > 90) return null;
  return [latDeg, ((lonDeg + 180) % 360 + 360) % 360 - 180];
}

function contains(region: SurfaceRegion, lat: number, lon: number): boolean {
  const [west, south, east, north] = region.bounds;
  return lat >= south && lat <= north && lon >= west && lon <= east;
}

function distanceToRegion(region: SurfaceRegion, lat: number, lon: number): number {
  const [west, south, east, north] = region.bounds;
  const dLat = lat < south ? south - lat : lat > north ? lat - north : 0;
  const dLon = lon < west ? west - lon : lon > east ? lon - east : 0;
  return Math.hypot(dLat, dLon);
}

function distanceToRegionEdge(region: SurfaceRegion, lat: number, lon: number): number {
  if (!contains(region, lat, lon)) return distanceToRegion(region, lat, lon);
  const [west, south, east, north] = region.bounds;
  return Math.min(lat - south, north - lat, lon - west, east - lon);
}

export function classifySurface(latDeg: number, lonDeg: number): SurfaceClass {
  const normalized = normalize(latDeg, lonDeg);
  if (!normalized) return "unknown";
  const [lat, lon] = normalized;
  const special = mask.regions.find((region) => region.surface_class !== "land" && contains(region, lat, lon));
  if (special) return special.surface_class;
  const land = mask.regions.find((region) => region.surface_class === "land" && contains(region, lat, lon));
  if (land) return distanceToRegionEdge(land, lat, lon) <= mask.coastal_band_deg ? "coast" : "land";
  const dryDistance = mask.regions
    .filter((region) => region.surface_class === "land" || region.surface_class === "ice")
    .reduce((distance, region) => Math.min(distance, distanceToRegion(region, lat, lon)), 180);
  return dryDistance <= mask.coastal_band_deg ? "coast" : "ocean";
}

export function isWetSurfaceClass(surfaceClass: SurfaceClass): boolean {
  return surfaceClass === "ocean" || surfaceClass === "inland_water";
}

export function asteroidTargetFromSurface(
  surfaceClass: SurfaceClass,
): "water" | "sedimentary_rock" | null {
  if (surfaceClass === "coast" || surfaceClass === "unknown") return null;
  return isWetSurfaceClass(surfaceClass) ? "water" : "sedimentary_rock";
}

export function surfaceBurstTypeFromSurface(
  current: "airburst" | "surface" | "custom" | "hemp" | "water",
  surfaceClass: SurfaceClass,
): typeof current {
  if (current !== "surface" && current !== "water") return current;
  const target = asteroidTargetFromSurface(surfaceClass);
  if (target === null) return current;
  return target === "water" ? "water" : "surface";
}

export function probeSurfaceLocal(latDeg: number, lonDeg: number): SurfaceProbe {
  const normalized = normalize(latDeg, lonDeg);
  if (!normalized) throw new Error("Surface probe coordinates must be finite and normalized.");
  const [lat, lon] = normalized;
  const surfaceClass = classifySurface(lat, lon);
  return {
    lat_deg: lat,
    lon_deg: lon,
    surface_class: surfaceClass,
    is_wet: isWetSurfaceClass(surfaceClass),
    water_depth_m: surfaceClass === "inland_water" ? 50 : surfaceClass === "ocean" ? 4000 : 0,
    mask_version: mask.mask_version,
    mask_source_asset_id: mask.source_asset_id,
    confidence: mask.confidence,
    declared_horizontal_error_m: mask.declared_horizontal_error_m,
    height_field: { ...COARSE_BATHYMETRY_DEPTH_FIELD },
  };
}

export function getSurfaceMaskDiagnosticsSnapshot() {
  return {
    schemaVersion: mask.schema_version,
    maskVersion: mask.mask_version,
    sourceAssetId: mask.source_asset_id,
    horizontalCrs: mask.horizontal_crs,
    verticalDatum: mask.vertical_datum,
    coastalBandDeg: mask.coastal_band_deg,
    declaredHorizontalErrorM: mask.declared_horizontal_error_m,
    confidence: mask.confidence,
    wetClasses: [...mask.wet_classes],
    regions: mask.regions.map((region) => ({ ...region, bounds: [...region.bounds] })),
  };
}
