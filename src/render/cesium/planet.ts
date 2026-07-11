import * as Cesium from "cesium";

/** Applies the physically based Earth defaults shared by every globe pane. */
export function configurePlanet(viewer: Cesium.Viewer): void {
  viewer.scene.globe.enableLighting = true;
  viewer.scene.globe.dynamicAtmosphereLighting = true;
  viewer.scene.globe.dynamicAtmosphereLightingFromSun = true;
  viewer.scene.highDynamicRange = true;
  if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
  viewer.scene.fog.enabled = true;
}
