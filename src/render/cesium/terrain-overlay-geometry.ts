import * as Cesium from "cesium";

const EARTH_RADIUS_M = 6_371_000;

/** Builds a closed, ground-clampable geodesic ellipse boundary. */
export function terrainEllipsePositions(
  latDeg: number,
  lonDeg: number,
  semiMajorM: number,
  semiMinorM: number,
  segments = 96,
): Cesium.Cartesian3[] {
  const latitude = Cesium.Math.toRadians(latDeg);
  const longitude = Cesium.Math.toRadians(lonDeg);
  const positions: Cesium.Cartesian3[] = [];
  for (let index = 0; index <= segments; index += 1) {
    const bearing = (index / segments) * Cesium.Math.TWO_PI;
    const cosBearing = Math.cos(bearing);
    const sinBearing = Math.sin(bearing);
    const radialDistanceM = (semiMajorM * semiMinorM) / Math.sqrt(
      semiMinorM * semiMinorM * cosBearing * cosBearing
      + semiMajorM * semiMajorM * sinBearing * sinBearing,
    );
    const angularDistance = radialDistanceM / EARTH_RADIUS_M;
    const targetLatitude = Math.asin(
      Math.sin(latitude) * Math.cos(angularDistance)
      + Math.cos(latitude) * Math.sin(angularDistance) * cosBearing,
    );
    const targetLongitude = longitude + Math.atan2(
      sinBearing * Math.sin(angularDistance) * Math.cos(latitude),
      Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(targetLatitude),
    );
    positions.push(Cesium.Cartesian3.fromRadians(targetLongitude, targetLatitude));
  }
  return positions;
}

export function terrainEllipsePositionsFromCartesian(
  center: Cesium.Cartesian3,
  semiMajorM: number,
  semiMinorM: number,
): Cesium.Cartesian3[] {
  const cartographic = Cesium.Cartographic.fromCartesian(center);
  return terrainEllipsePositions(
    Cesium.Math.toDegrees(cartographic.latitude),
    Cesium.Math.toDegrees(cartographic.longitude),
    semiMajorM,
    semiMinorM,
  );
}
