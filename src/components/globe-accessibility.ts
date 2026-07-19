import { useEffect, useMemo, useRef, useState } from "react";

import { findStyle, type GlobeStyleId } from "../lib/globe-styles";
import { LANGUAGE_TAGS, translate, type MessageKey } from "../lib/i18n-core";
import { useI18n } from "../lib/i18n";
import type { ImageryControllerStatus } from "../render/cesium/imagery-controller";
import { useUnits } from "../hooks/useUnits";
import { formatLength, quantityText, type UnitSystem } from "../lib/units";

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

type AccessibilityFormatter = Readonly<{
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
}>;

const ENGLISH_FORMATTER: AccessibilityFormatter = {
  t: (key, values) => translate("en", key, values),
  formatNumber: (value, options) => value.toLocaleString(LANGUAGE_TAGS.en, options),
};

export function localizedGlobeStyleLabel(
  style: GlobeStyleId,
  t: AccessibilityFormatter["t"],
): string {
  switch (style) {
    case "natural-earth-2": return t("style.naturalLabel");
    case "osm": return t("style.osmLabel");
    case "esri-world-imagery": return t("style.esriLabel");
    case "cesium-world-imagery": return t("style.cesiumLabel");
    case "cesium-bathymetry": return t("style.bathymetryLabel");
    default: return findStyle(style).label;
  }
}

export function buildGlobeAccessibilitySummary(
  state: GlobeAccessibilityState,
  formatter: AccessibilityFormatter = ENGLISH_FORMATTER,
  unitSystem: UnitSystem = "metric",
): string {
  const { t, formatNumber } = formatter;
  const layers = [t("globe.access.layer.base", {
    style: localizedGlobeStyleLabel(state.resolvedStyle, t),
  })];
  if (state.hasInitial) layers.push(t("globe.access.layer.source"));
  if (state.hasWavefront) layers.push(t("globe.access.layer.wavefront"));
  if (state.hasSweSnapshot) layers.push(t("globe.access.layer.swe"));
  if (state.isochroneCount > 0) layers.push(t("globe.access.layer.isochrones"));
  if (state.runupResultCount > 0) layers.push(t("globe.access.layer.runup"));
  if (state.gaugeCount > 0) layers.push(t("globe.access.layer.gauges", {
    count: formatNumber(state.gaugeCount),
  }));
  if (state.dartBuoyCount > 0) layers.push(t("globe.access.layer.dart"));
  if (state.hasHazardCenter) layers.push(t("globe.access.layer.origin"));
  if (state.hazardRingCount > 0) layers.push(t("globe.access.layer.rings"));
  if (state.hazardPolygonCount > 0) layers.push(t("globe.access.layer.fallout"));
  if (state.hasDirectRenderFrame) layers.push(t("globe.access.layer.directFrame"));
  if (state.hasWw3Plan) layers.push(t("globe.access.layer.exchange"));
  if (state.mirvPointCount > 0) layers.push(t("globe.access.layer.mirv", {
    count: formatNumber(state.mirvPointCount),
  }));

  const camera = state.camera;
  const altitude = camera
    ? unitSystem === "metric"
      ? camera.altitudeM >= 1_000_000
        ? t("globe.access.megametres", {
            value: formatNumber(camera.altitudeM / 1_000_000, { maximumFractionDigits: 1 }),
          })
        : t("globe.access.kilometres", {
            value: formatNumber(camera.altitudeM / 1_000, { maximumFractionDigits: 0 }),
          })
      : quantityText(formatLength(camera.altitudeM, formatNumber, unitSystem))
    : "";
  const cameraSummary = camera
    ? t("globe.access.camera", {
        lat: formatNumber(Math.abs(camera.lat), { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        latDirection: t(camera.lat >= 0 ? "globe.access.north" : "globe.access.south"),
        lon: formatNumber(Math.abs(camera.lon), { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        lonDirection: t(camera.lon >= 0 ? "globe.access.east" : "globe.access.west"),
        altitude,
      })
    : t("globe.access.cameraUnavailable");
  const rendererSummary = state.rendererError
    ? t("globe.access.rendererFailed", { error: state.rendererError })
    : state.imageryStatus === "ready"
      ? t("globe.access.rendererReady")
      : t("globe.access.rendererStatus", {
          status: t(`globe.access.status.${state.imageryStatus}` as MessageKey),
          message: state.imageryMessage,
        });
  const interactionSummary = state.lastInspectionSummary
    ?? (state.inspectMode
      ? t("globe.access.inspectActive")
      : state.pickMode
        ? t("globe.access.pickActive")
        : t("globe.access.entryAvailable"));

  return t("globe.access.summary", {
    scene: state.sceneLabel,
    camera: cameraSummary,
    time: t("globe.access.time", {
      minutes: formatNumber(Math.round(state.simulationTimeS / 60)),
    }),
    layers: t("globe.access.layers", {
      layers: layers.join(t("globe.access.listSeparator")),
    }),
    renderer: rendererSummary,
    interaction: interactionSummary,
  });
}

export function useGlobeAccessibilitySummary(state: GlobeAccessibilityState) {
  const { t, formatNumber } = useI18n();
  const unitSystem = useUnits();
  const summary = useMemo(
    () => buildGlobeAccessibilitySummary(state, { t, formatNumber }, unitSystem),
    [formatNumber, state, t, unitSystem],
  );
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
