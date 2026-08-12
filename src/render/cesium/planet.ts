import * as Cesium from "cesium";

/** Applies the physically based Earth defaults shared by every globe pane. */
export function configurePlanet(viewer: Cesium.Viewer): void {
  viewer.scene.globe.enableLighting = true;
  viewer.scene.globe.dynamicAtmosphereLighting = true;
  viewer.scene.globe.dynamicAtmosphereLightingFromSun = true;
  // Ground-classified analytical overlays must disappear behind mountains
  // instead of being composited through the visible terrain surface.
  viewer.scene.globe.depthTestAgainstTerrain = true;
  // HDR is valuable for fireball/thermal luminance, but WebGL adapters can
  // reject the floating-point render targets. The quality runtime repeats
  // this fail-closed check when it applies the selected tier.
  viewer.scene.highDynamicRange = viewer.scene.highDynamicRangeSupported !== false;
  if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
  viewer.scene.fog.enabled = true;
}
