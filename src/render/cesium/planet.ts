import * as Cesium from "cesium";

/** Applies the physically based Earth defaults shared by every globe pane. */
export function configurePlanet(viewer: Cesium.Viewer): void {
  viewer.scene.globe.enableLighting = true;
  viewer.scene.globe.dynamicAtmosphereLighting = true;
  viewer.scene.globe.dynamicAtmosphereLightingFromSun = true;
  // Ground-classified analytical overlays must disappear behind mountains
  // instead of being composited through the visible terrain surface.
  viewer.scene.globe.depthTestAgainstTerrain = true;
  viewer.scene.highDynamicRange = true;
  if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
  viewer.scene.fog.enabled = true;
}
