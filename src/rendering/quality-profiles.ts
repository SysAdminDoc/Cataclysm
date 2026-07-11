import * as Cesium from "cesium";

export type RendererQualityTier = "Low" | "Medium" | "High" | "Cinematic";

export type RendererQualityProfile = {
  tier: RendererQualityTier;
  resolutionScale: number;
  msaaSamples: number;
  highDynamicRange: boolean;
  tonemapper: Cesium.Tonemapper;
  exposure: number;
  fxaa: boolean;
  bloom: boolean;
  maximumScreenSpaceError: number;
  fog: boolean;
  atmosphereLighting: boolean;
};

export const RENDERER_QUALITY_PROFILES: Record<RendererQualityTier, RendererQualityProfile> = {
  Low: {
    tier: "Low", resolutionScale: 1, msaaSamples: 1, highDynamicRange: false,
    tonemapper: Cesium.Tonemapper.REINHARD, exposure: 1, fxaa: true, bloom: false,
    maximumScreenSpaceError: 4, fog: true, atmosphereLighting: true,
  },
  Medium: {
    tier: "Medium", resolutionScale: 1, msaaSamples: 2, highDynamicRange: true,
    tonemapper: Cesium.Tonemapper.ACES, exposure: 1, fxaa: true, bloom: false,
    maximumScreenSpaceError: 2.5, fog: true, atmosphereLighting: true,
  },
  High: {
    tier: "High", resolutionScale: 1, msaaSamples: 4, highDynamicRange: true,
    tonemapper: Cesium.Tonemapper.ACES, exposure: 1, fxaa: true, bloom: false,
    maximumScreenSpaceError: 1.5, fog: true, atmosphereLighting: true,
  },
  Cinematic: {
    tier: "Cinematic", resolutionScale: 1, msaaSamples: 8, highDynamicRange: true,
    tonemapper: Cesium.Tonemapper.ACES, exposure: 1, fxaa: true, bloom: true,
    maximumScreenSpaceError: 1, fog: true, atmosphereLighting: true,
  },
};

export function applyRendererQualityProfile(
  viewer: Cesium.Viewer,
  tier: RendererQualityTier,
  exposureOverride?: number,
) {
  const requested = RENDERER_QUALITY_PROFILES[tier];
  const exposure = exposureOverride ?? requested.exposure;
  viewer.resolutionScale = requested.resolutionScale;
  viewer.scene.msaaSamples = requested.msaaSamples;
  viewer.scene.highDynamicRange = requested.highDynamicRange;
  viewer.scene.postProcessStages.tonemapper = requested.tonemapper;
  viewer.scene.postProcessStages.exposure = exposure;
  viewer.scene.postProcessStages.fxaa.enabled = requested.fxaa;
  viewer.scene.postProcessStages.bloom.enabled = requested.bloom;
  viewer.scene.globe.maximumScreenSpaceError = requested.maximumScreenSpaceError;
  viewer.scene.fog.enabled = requested.fog;
  viewer.scene.globe.dynamicAtmosphereLighting = requested.atmosphereLighting;
  viewer.scene.globe.dynamicAtmosphereLightingFromSun = requested.atmosphereLighting;
  return {
    requested: { ...requested, exposure },
    effective: {
      tier,
      resolutionScale: viewer.resolutionScale,
      msaaSamples: viewer.scene.msaaSamples,
      highDynamicRange: viewer.scene.highDynamicRange,
      tonemapper: viewer.scene.postProcessStages.tonemapper,
      exposure: viewer.scene.postProcessStages.exposure,
      fxaa: viewer.scene.postProcessStages.fxaa.enabled,
      bloom: viewer.scene.postProcessStages.bloom.enabled,
      maximumScreenSpaceError: viewer.scene.globe.maximumScreenSpaceError,
      fog: viewer.scene.fog.enabled,
      atmosphereLighting: viewer.scene.globe.dynamicAtmosphereLighting,
    },
  };
}
