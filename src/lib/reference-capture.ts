import type { EarthSessionSnapshot } from "./earth-assets";
import type { RendererQualityProfile } from "../rendering/quality-profiles";

export const REFERENCE_CAPTURE_EVENT = "cataclysm:reference-capture-view";

export type ReferenceCamera = {
  lat: number;
  lon: number;
  altitudeM: number;
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
  verticalFovDeg: number;
};

export type ReferenceCaptureView = {
  sceneId: string;
  utc: string;
  seed: number;
  qualityTier: "Low" | "Medium" | "High" | "Cinematic";
  exposure: number;
  simulationTimeS: number;
  effectTimeMs: number;
  camera: ReferenceCamera;
};

export type ReferenceCaptureRuntime = ReferenceCaptureView & {
  ready: boolean;
  renderer: string;
  earthSession: EarthSessionSnapshot;
  sunPositionEciM: { x: number; y: number; z: number };
  actualCamera: ReferenceCamera;
  quality: {
    requested: RendererQualityProfile;
    effective: Omit<RendererQualityProfile, "tier"> & { tier: RendererQualityProfile["tier"] };
  };
};

export function referenceCaptureEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("referenceCapture") === "1";
}

declare global {
  interface Window {
    __CATACLYSM_REFERENCE_CAPTURE__?: ReferenceCaptureRuntime;
    __CATACLYSM_APPLY_REFERENCE_VIEW__?: (view: ReferenceCaptureView) => void;
  }
}
