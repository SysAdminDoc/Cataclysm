import { useEffect, useMemo, useRef, useState } from "react";

import { findStyle, type GlobeStyleId } from "../lib/globe-styles";
import type { ImageryControllerStatus } from "../render/cesium/imagery-controller";

type CameraTelemetry = Readonly<{
  lat: number;
  lon: number;
  altitudeM: number;
  headingDeg: number;
}>;

type GlobeAccessibilityState = Readonly<{
  resolvedStyle: GlobeStyleId;
  hasInitial: boolean;
  hasWavefront: boolean;
  hasSweSnapshot: boolean;
  isochroneCount: number;
  runupResultCount: number;
  gaugeCount: number;
  dartBuoyCount: number;
  hasHazardCenter: boolean;
  hazardRingCount: number;
  hazardPolygonCount: number;
  hasDirectRenderFrame: boolean;
  hasWw3Plan: boolean;
  mirvPointCount: number;
  camera?: CameraTelemetry;
  sceneLabel: string;
  simulationTimeS: number;
  rendererError: string | null;
  imageryStatus: ImageryControllerStatus;
  imageryMessage: string;
  lastInspectionSummary: string | null;
  inspectMode: boolean;
  pickMode: boolean;
}>;

export function buildGlobeAccessibilitySummary(state: GlobeAccessibilityState): string {
  const layers = [`${findStyle(state.resolvedStyle).label} base imagery`];
  if (state.hasInitial) layers.push("source geometry");
  if (state.hasWavefront) layers.push("analytical wavefront");
  if (state.hasSweSnapshot) layers.push("SWE water field");
  if (state.isochroneCount > 0) layers.push("arrival isochrones");
  if (state.runupResultCount > 0) layers.push("coastal runup samples");
  if (state.gaugeCount > 0) layers.push(`${state.gaugeCount} user gauges`);
  if (state.dartBuoyCount > 0) layers.push("DART observations");
  if (state.hasHazardCenter) layers.push("effects origin");
  if (state.hazardRingCount > 0) layers.push("hazard effect rings");
  if (state.hazardPolygonCount > 0) layers.push("fallout plume");
  if (state.hasDirectRenderFrame) layers.push("authoritative direct-effects frame");
  if (state.hasWw3Plan) layers.push("illustrative exchange targets and missile arcs");
  if (state.mirvPointCount > 0) layers.push(`MIRV pattern preview with ${state.mirvPointCount} aim points`);

  const camera = state.camera;
  const cameraSummary = camera
    ? `Camera centered at ${Math.abs(camera.lat).toFixed(2)} degrees ${camera.lat >= 0 ? "north" : "south"}, ${Math.abs(camera.lon).toFixed(2)} degrees ${camera.lon >= 0 ? "east" : "west"}, at ${camera.altitudeM >= 1_000_000 ? `${(camera.altitudeM / 1_000_000).toFixed(1)} megametres` : `${(camera.altitudeM / 1_000).toFixed(0)} kilometres`} altitude.`
    : "Camera position is not available for this comparison pane.";
  const rendererSummary = state.rendererError
    ? `Renderer failed: ${state.rendererError}`
    : state.imageryStatus === "ready"
      ? "Renderer and base imagery are ready."
      : `Renderer imagery is ${state.imageryStatus}: ${state.imageryMessage}`;
  const interactionSummary = state.lastInspectionSummary
    ?? (state.inspectMode
      ? "Inspect mode is active; choose the globe or enter latitude and longitude."
      : state.pickMode
        ? "Location picking is active; choose the globe or enter latitude and longitude."
        : "Latitude and longitude entry is available when location picking or inspection is active.");

  return `${state.sceneLabel}. ${cameraSummary} Scenario time T plus ${Math.round(state.simulationTimeS / 60)} minutes. Visible analytical layers: ${layers.join(", ")}. ${rendererSummary} ${interactionSummary}`;
}

export function useGlobeAccessibilitySummary(state: GlobeAccessibilityState) {
  const summary = useMemo(() => buildGlobeAccessibilitySummary(state), [state]);
  const [announcedSummary, setAnnouncedSummary] = useState("");
  const announcedSummaryRef = useRef("");

  useEffect(() => {
    const delayMs = announcedSummaryRef.current ? 1_200 : 0;
    const timer = window.setTimeout(() => {
      announcedSummaryRef.current = summary;
      setAnnouncedSummary(summary);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [summary]);

  return { summary, announcedSummary };
}
