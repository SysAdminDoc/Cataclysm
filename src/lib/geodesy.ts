import contractJson from "../data/geodesy-contract.json";

export const GEODESY_CONTRACT_VERSION = contractJson.contract_version;
export const WGS84_A_M = 6_378_137;
export const WGS84_INV_F = 298.257_223_563;

export type VerticalDatum =
  | "wgs84_ellipsoid"
  | "navd88_geoid18"
  | "idealized_mean_sea_level"
  | "depth_below_idealized_mean_sea_level"
  | "local_enu";
export type VerticalAxis = "positive_up" | "positive_down";

export type HeightFieldMetadata = {
  horizontal_crs: string;
  vertical_datum: VerticalDatum;
  vertical_axis: VerticalAxis;
  unit: "metre";
  declared_vertical_error_m: number;
};

export const IDEALIZED_SEA_SURFACE_HEIGHT_FIELD: HeightFieldMetadata = {
  horizontal_crs: "EPSG:4326",
  vertical_datum: "idealized_mean_sea_level",
  vertical_axis: "positive_up",
  unit: "metre",
  declared_vertical_error_m: 4000,
};

export const COARSE_BATHYMETRY_DEPTH_FIELD: HeightFieldMetadata = {
  horizontal_crs: "EPSG:4326",
  vertical_datum: "depth_below_idealized_mean_sea_level",
  vertical_axis: "positive_down",
  unit: "metre",
  declared_vertical_error_m: 4000,
};

export type GeodeticPosition = {
  latDeg: number;
  lonDeg: number;
  ellipsoidHeightM: number;
};

export type EcefPosition = { xM: number; yM: number; zM: number };
export type LocalEnu = { eastM: number; northM: number; upM: number };
export type UnrealPositionCm = { xEastCm: number; yNorthCm: number; zUpCm: number };

export function convertVerticalHeight(
  valueM: number,
  from: VerticalDatum,
  to: VerticalDatum,
  context: { geoidUndulationM?: number } = {},
): number {
  if (!Number.isFinite(valueM)) throw new Error("Vertical value must be finite.");
  if (from === to) return valueM;
  if (from === "wgs84_ellipsoid" && to === "navd88_geoid18") {
    if (!Number.isFinite(context.geoidUndulationM)) {
      throw new Error("WGS84 ellipsoid to NAVD88 requires a reviewed geoid undulation.");
    }
    return valueM - (context.geoidUndulationM as number);
  }
  if (from === "navd88_geoid18" && to === "wgs84_ellipsoid") {
    if (!Number.isFinite(context.geoidUndulationM)) {
      throw new Error("NAVD88 to WGS84 ellipsoid requires a reviewed geoid undulation.");
    }
    return valueM + (context.geoidUndulationM as number);
  }
  if (
    (from === "idealized_mean_sea_level" && to === "depth_below_idealized_mean_sea_level") ||
    (from === "depth_below_idealized_mean_sea_level" && to === "idealized_mean_sea_level")
  ) {
    return -valueM;
  }
  throw new Error(`Unsupported vertical datum conversion: ${from} to ${to}.`);
}

export function geodeticToEcef(position: GeodeticPosition): EcefPosition {
  if (
    !Number.isFinite(position.latDeg) ||
    !Number.isFinite(position.lonDeg) ||
    !Number.isFinite(position.ellipsoidHeightM) ||
    Math.abs(position.latDeg) > 90 ||
    Math.abs(position.lonDeg) > 180
  ) {
    throw new Error("Geodetic coordinates must be finite WGS84 longitude/latitude/height values.");
  }
  const flattening = 1 / WGS84_INV_F;
  const eccentricitySq = flattening * (2 - flattening);
  const lat = position.latDeg * Math.PI / 180;
  const lon = position.lonDeg * Math.PI / 180;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const primeVertical = WGS84_A_M / Math.sqrt(1 - eccentricitySq * sinLat * sinLat);
  return {
    xM: (primeVertical + position.ellipsoidHeightM) * cosLat * Math.cos(lon),
    yM: (primeVertical + position.ellipsoidHeightM) * cosLat * Math.sin(lon),
    zM: (primeVertical * (1 - eccentricitySq) + position.ellipsoidHeightM) * sinLat,
  };
}

export function ecefToLocalEnu(point: EcefPosition, origin: GeodeticPosition): LocalEnu {
  const base = geodeticToEcef(origin);
  const lat = origin.latDeg * Math.PI / 180;
  const lon = origin.lonDeg * Math.PI / 180;
  const dx = point.xM - base.xM;
  const dy = point.yM - base.yM;
  const dz = point.zM - base.zM;
  return {
    eastM: -Math.sin(lon) * dx + Math.cos(lon) * dy,
    northM: -Math.sin(lat) * Math.cos(lon) * dx - Math.sin(lat) * Math.sin(lon) * dy + Math.cos(lat) * dz,
    upM: Math.cos(lat) * Math.cos(lon) * dx + Math.cos(lat) * Math.sin(lon) * dy + Math.sin(lat) * dz,
  };
}

export function enuToUnrealCm(position: LocalEnu): UnrealPositionCm {
  return {
    xEastCm: position.eastM * 100,
    yNorthCm: position.northM * 100,
    zUpCm: position.upM * 100,
  };
}

export function getGeodesyDiagnosticsSnapshot() {
  return structuredClone(contractJson);
}
