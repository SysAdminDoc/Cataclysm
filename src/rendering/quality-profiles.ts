import * as Cesium from "cesium";
import {
  RENDERER_QUALITY_BUDGETS,
  type RendererQualityTier,
} from "../render/quality/quality-controller";

export type { RendererQualityTier } from "../render/quality/quality-controller";

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
    // Reference captures stay at native drawing-buffer resolution. The live
    // quality runtime applies the Low 0.75 scale from its budget separately.
    tier: "Low", resolutionScale: 1, msaaSamples: RENDERER_QUALITY_BUDGETS.Low.features.msaaSamples, highDynamicRange: false,
    tonemapper: Cesium.Tonemapper.REINHARD, exposure: 1, fxaa: true, bloom: false,
    maximumScreenSpaceError: RENDERER_QUALITY_BUDGETS.Low.features.maximumScreenSpaceError, fog: true, atmosphereLighting: true,
  },
  Medium: {
    tier: "Medium", resolutionScale: RENDERER_QUALITY_BUDGETS.Medium.resolution.resolutionScale, msaaSamples: RENDERER_QUALITY_BUDGETS.Medium.features.msaaSamples, highDynamicRange: true,
    tonemapper: Cesium.Tonemapper.ACES, exposure: 1, fxaa: true, bloom: false,
    maximumScreenSpaceError: RENDERER_QUALITY_BUDGETS.Medium.features.maximumScreenSpaceError, fog: true, atmosphereLighting: true,
  },
  High: {
    tier: "High", resolutionScale: RENDERER_QUALITY_BUDGETS.High.resolution.resolutionScale, msaaSamples: RENDERER_QUALITY_BUDGETS.High.features.msaaSamples, highDynamicRange: true,
    tonemapper: Cesium.Tonemapper.ACES, exposure: 1, fxaa: true, bloom: false,
    maximumScreenSpaceError: RENDERER_QUALITY_BUDGETS.High.features.maximumScreenSpaceError, fog: true, atmosphereLighting: true,
  },
  Cinematic: {
    tier: "Cinematic", resolutionScale: RENDERER_QUALITY_BUDGETS.Cinematic.resolution.resolutionScale, msaaSamples: RENDERER_QUALITY_BUDGETS.Cinematic.features.msaaSamples, highDynamicRange: true,
    tonemapper: Cesium.Tonemapper.ACES, exposure: 1, fxaa: true, bloom: true,
    maximumScreenSpaceError: RENDERER_QUALITY_BUDGETS.Cinematic.features.maximumScreenSpaceError, fog: true, atmosphereLighting: true,
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
