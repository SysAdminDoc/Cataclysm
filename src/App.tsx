import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import cataclysmLogoUrl from "../assets/branding/logo.svg";
import { PresetSelector } from "./components/PresetSelector";
import { ComparisonStories } from "./components/ComparisonStories";
import { ScenarioBuilder } from "./components/ScenarioBuilder";
import { ResultsPanel } from "./components/ResultsPanel";
import { PointProbePanel } from "./components/PointProbePanel";
import { FamiliarPlacePanel } from "./components/FamiliarPlacePanel";
import { CitationsModal } from "./components/CitationsModal";
import { HistoricalTsunamiBrowser } from "./components/HistoricalTsunamiBrowser";
import { Settings } from "./components/Settings";
import { FirstRunDisclaimer } from "./components/FirstRunDisclaimer";
import { LaunchExperience } from "./components/LaunchExperience";
import { Tour } from "./components/Tour";
import { GuidedLesson } from "./components/GuidedLesson";
import type {
  GuidedLesson as GuidedLessonDef,
  GuidedStoryCue,
  GuidedStoryTarget,
} from "./lib/guided-lessons";
import { LogViewer } from "./components/LogViewer";
import { PerformancePanel } from "./components/PerformancePanel";
import { CrashRecoveryNotice } from "./components/CrashRecoveryNotice";
import { UiIcon } from "./components/UiIcon";
import { settings, type WorkspaceMode, type ColormapId } from "./lib/settings";
import { useI18n } from "./lib/i18n";
import type { MessageKey } from "./lib/i18n-core";
import { colormapLegend } from "./lib/colormap-legend";
import { CoastalRunupOverlay } from "./components/CoastalRunupOverlay";
import { DartOverlay } from "./components/DartOverlay";
import { SwePlayback } from "./components/SwePlayback";
import { AttenuationChart } from "./components/AttenuationChart";
import { api, isTauri } from "./lib/tauri";
import { dartPinsForPreset } from "./lib/dart";
import { getDartBuoysForPreset } from "./lib/data";
import { listDemoPresets } from "./lib/demo";
import { applyTheme, loadTheme } from "./lib/theme";
import { copyExportText, exportGlobePng, exportGlobeShareCard, exportGlobeVideo, exportCzml, exportGeoJson, exportKml, exportComparisonPng, type DirectHazardExportData, type ExportResult, type RunupPoint, type ScreenshotMeta } from "./lib/export";
import { APP_VERSION, type RenderFrameProvenance } from "./lib/model-provenance";
import {
  buildDirectResultEvidence,
  buildDirectScenarioEvidence,
  buildLayerEvidence,
  buildOutcomeEvidence,
  buildSourceEvidence,
  evidenceIds,
} from "./lib/trust-evidence";
import {
  asyncResultValue,
  rejectAsyncResult,
  resolveAsyncResult,
  startAsyncResult,
  type AsyncResult,
} from "./lib/async-result";
import { downloadTextExport } from "./lib/text-export";
import { exportScientificNetcdf, exportScientificZarr } from "./lib/scientific-export";
import { presetById, useScenarioSlot } from "./hooks/useScenarioSlot";
import { useHumanitarianFacilities } from "./hooks/useHumanitarianFacilities";
import { scenarioFromUrl, scenarioToUrlParams, sourceNumericDefault, sourceTextDefault, type ScenarioInput, type UrlScenarioResult } from "./lib/scenario-schema";
import type { HistoricalScenarioImport } from "./lib/ncei-hazel";
import { subscribeToScenarioDeepLinks } from "./lib/deep-links";
import {
  DIRECT_SCENARIOS,
  loadScenarioLibraryPreferences,
  recordRecentScenario,
  saveScenarioLibraryPreferences,
  toggleFavoriteScenario,
  type DirectScenarioTemplate,
  type ScenarioLibraryPreferences,
} from "./lib/scenario-library";
import {
  buildComparisonMetrics,
  comparisonMetricLines,
  comparisonStoryForPair,
  comparisonStoryForPreset,
  type ComparisonStory,
} from "./lib/comparison-stories";
import { REFERENCE_CAPTURE_EVENT, type ReferenceCaptureView } from "./lib/reference-capture";
import type { OutcomeFocusRequest } from "./render/cesium/outcome-focus";
import type { PointProbeReport } from "./render/cesium/inspection";
import type { Gauge, Preset } from "./types/scenario";
import type { NukemapLocationResult } from "./types/nukemap-data";
import { HazardControls } from "./components/HazardControls";
import { WW3ExchangeHud, WW3ExchangePanel, type Ww3ExchangeSession } from "./components/WW3Exchange";
import { MIRVPatternPanel } from "./components/MIRVPatternPanel";
import type { MirvPreview } from "./lib/mirv";
import { useFireballs } from "./hooks/useFireballs";
import { SimulationTransport } from "./components/SimulationTransport";
import { LayerInspector } from "./components/LayerInspector";
import { SourceModelSummary } from "./components/SourceModelSummary";
import {
  type AsteroidInput,
  type AsteroidVisualReport,
  type GeoPoint,
  type HazardResult,
  type NuclearDetail,
  type NuclearInput,
  type NuclearShelterReport,
} from "./hazards";
import { falloutRings } from "./hazards/nuclear/fallout";
import {
  asteroidTargetFromSurface,
  probeSurfaceLocal,
  surfaceBurstTypeFromSurface,
} from "./lib/surface";
import directHazardCaptureFixtures from "./data/direct-hazard-capture-fixtures.json";
import referenceScenes from "./data/reference-scenes.json";
import asteroidEntryRecordingUrl from "./data/direct-render/asteroid-entry.catframe?url";
import asteroidLandRecordingUrl from "./data/direct-render/asteroid-land-impact.catframe?url";
import asteroidOceanRecordingUrl from "./data/direct-render/asteroid-ocean-impact.catframe?url";
import nuclearAirburstRecordingUrl from "./data/direct-render/nuclear-airburst.catframe?url";
import nuclearSurfaceRecordingUrl from "./data/direct-render/nuclear-surface-burst.catframe?url";
import {
  ingestRenderRecording,
  type RendererNeutralFrameView,
  type RenderReplayAdapter,
} from "./rendering/protocol";

type HazardMode = "tsunami" | "nuclear" | "asteroid";
type DirectHazardMode = Exclude<HazardMode, "tsunami">;
type InspectorTab = "setup" | "results" | "layers";
type ToastAction = { label: string; run: () => void };
type ToastMessage = { msg: string; tone: "error" | "info"; action?: ToastAction };
type LibraryPreview =
  | { kind: "preset"; presetId: string }
  | { kind: "direct"; scenario: DirectScenarioTemplate };
type JourneyStage = "prepare" | "calculate" | "watch" | "understand";
type RunJourney = { scenarioId: string; stage: JourneyStage };
type ActiveWw3ExchangeSession = Ww3ExchangeSession & { elapsedMs: number };

const JOURNEY_STEPS: JourneyStage[] = ["prepare", "calculate", "watch", "understand"];

function JourneyProgress({ journey, onManual }: { journey: RunJourney; onManual: () => void }) {
  const { t } = useI18n();
  const labels: Record<JourneyStage, string> = {
    prepare: t("journey.prepare"),
    calculate: t("journey.calculate"),
    watch: t("journey.watch"),
    understand: t("journey.understand"),
  };
  const activeIndex = JOURNEY_STEPS.indexOf(journey.stage);
  return (
    <div className="journey-progress" role="status" aria-label={t("journey.status", { stage: labels[JOURNEY_STEPS[activeIndex]] })}>
      <ol>
        {JOURNEY_STEPS.map((step, index) => (
          <li key={step} data-state={index < activeIndex ? "complete" : index === activeIndex ? "active" : "pending"}>
            <span aria-hidden>{index < activeIndex ? "✓" : index + 1}</span>
            <strong>{labels[step]}</strong>
          </li>
        ))}
      </ol>
      <button type="button" onClick={onManual}>{t("journey.manual")}</button>
    </div>
  );
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

const DIRECT_RENDER_FIXTURE_URLS: Record<string, string> = {
  "asteroid-entry": asteroidEntryRecordingUrl,
  "asteroid-land-impact": asteroidLandRecordingUrl,
  "asteroid-ocean-impact": asteroidOceanRecordingUrl,
  "nuclear-airburst": nuclearAirburstRecordingUrl,
  "nuclear-surface-burst": nuclearSurfaceRecordingUrl,
};

const Globe = lazy(() => import("./components/Globe").then((m) => ({ default: m.Globe })));

type ToolbarIconName = "inspect" | "compare" | "image" | "share" | "link" | "video" | "text" | "czml" | "netcdf" | "zarr" | "geojson" | "kml" | "citations" | "settings";

function ToolbarIcon({ name }: { name: ToolbarIconName }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (name === "inspect") {
    return (
      <svg {...common}>
        <circle cx="10.5" cy="10.5" r="5.5" />
        <path d="m15 15 5 5" />
      </svg>
    );
  }
  if (name === "compare") {
    return (
      <svg {...common}>
        <path d="M7 7h13m0 0-4-4m4 4-4 4" />
        <path d="M17 17H4m0 0 4 4m-4-4 4-4" />
      </svg>
    );
  }
  if (name === "image") {
    return (
      <svg {...common}>
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="m7 16 4-4 3 3 2-2 3 3" />
        <circle cx="9" cy="9" r="1" />
      </svg>
    );
  }
  if (name === "share") {
    return (
      <svg {...common}>
        <rect x="5" y="4" width="14" height="16" rx="2" />
        <path d="M8 9h8M8 13h5" />
        <path d="M15 15h4v4" />
      </svg>
    );
  }
  if (name === "link") {
    return (
      <svg {...common}>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    );
  }
  if (name === "video") {
    return (
      <svg {...common}>
        <rect x="4" y="6" width="12" height="12" rx="2" />
        <path d="m16 10 4-2v8l-4-2" />
      </svg>
    );
  }
  if (name === "text") {
    return (
      <svg {...common}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6M8 13h8M8 17h5" />
      </svg>
    );
  }
  if (name === "czml") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3a14 14 0 0 0 0 18M12 3a14 14 0 0 1 0 18M3 12h18" />
      </svg>
    );
  }
  if (name === "netcdf") {
    return (
      <svg {...common}>
        <path d="M5 3h10l4 4v14H5Z" />
        <path d="M15 3v5h5M8 12h8M8 16h8" />
      </svg>
    );
  }
  if (name === "zarr") {
    return (
      <svg {...common}>
        <path d="m12 2 8 4.5v11L12 22l-8-4.5v-11Z" />
        <path d="m4 6.5 8 4.5 8-4.5M12 11v11" />
      </svg>
    );
  }
  if (name === "geojson") {
    return (
      <svg {...common}>
        <path d="M12 2 L22 8.5 L22 15.5 L12 22 L2 15.5 L2 8.5 Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  if (name === "kml") {
    return (
      <svg {...common}>
        <path d="M12 2 L20 7v10l-8 5-8-5V7Z" />
        <path d="M12 12V2M12 12l8-5M12 12l-8-5" />
      </svg>
    );
  }
  if (name === "citations") {
    return (
      <svg {...common}>
        <path d="M6 5h9a3 3 0 0 1 3 3v11H8a3 3 0 0 0-3 3V8a3 3 0 0 1 3-3Z" />
        <path d="M8 9h6M8 13h7" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M4.8 4.8 7 7M17 17l2.2 2.2M3 12h3M18 12h3M4.8 19.2 7 17M17 7l2.2-2.2" />
    </svg>
  );
}

function ToolbarButton({
  icon,
  active,
  disabled,
  disabledReason,
  variant = "export",
  title,
  onClick,
  onUnavailable,
  children,
}: {
  icon: ToolbarIconName;
  active?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  variant?: "mode" | "export" | "utility";
  title: string;
  onClick: () => void;
  onUnavailable?: (reason: string) => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const unavailable = disabled === true;
  const resolvedTitle = unavailable && disabledReason ? disabledReason : title;

  return (
    <button
      className="icon-button"
      data-active={active ? "true" : "false"}
      data-disabled={unavailable ? "true" : "false"}
      data-variant={variant}
      aria-disabled={unavailable}
      onClick={() => {
        if (unavailable) {
          onUnavailable?.(disabledReason ?? t("app.unavailable"));
          return;
        }
        onClick();
      }}
      title={resolvedTitle}
      type="button"
    >
      <ToolbarIcon name={icon} />
      <span className="icon-button__label">{children}</span>
      {variant === "export" && unavailable && disabledReason && (
        <small className="icon-button__reason">{t("app.requires", { reason: disabledReason })}</small>
      )}
    </button>
  );
}

function ExportGroup({
  id,
  label,
  description,
  children,
}: {
  id: string;
  label: string;
  description: string;
  children: ReactNode;
}) {
  const headingId = `export-group-${id}`;
  return (
    <section className="app__export-group" aria-labelledby={headingId}>
      <header className="app__export-group-header">
        <strong id={headingId}>{label}</strong>
        <span>{description}</span>
      </header>
      <div className="app__export-group-actions">{children}</div>
    </section>
  );
}

export default function App() {
  const { t, formatNumber } = useI18n();
  const [presetsResult, setPresetsResult] = useState<AsyncResult<Preset[]>>({ status: "loading" });
  const presets = useMemo(() => asyncResultValue(presetsResult) ?? [], [presetsResult]);
  const [timeS, setTimeS] = useState<number>(15 * 60);
  const [showCitations, setShowCitations] = useState(false);
  const [showHistoricalBrowser, setShowHistoricalBrowser] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  const [timelineRate, setTimelineRate] = useState(1);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("setup");
  const [pickMode, setPickMode] = useState(false);
  const [inspectMode, setInspectMode] = useState(false);
  const [comparisonInspectCoordinate, setComparisonInspectCoordinate] = useState<GeoPoint | null>(null);
  const [pointProbeA, setPointProbeA] = useState<PointProbeReport | null>(null);
  const [pointProbeB, setPointProbeB] = useState<PointProbeReport | null>(null);
  const [familiarPlace, setFamiliarPlace] = useState<NukemapLocationResult | null>(null);
  useEffect(() => {
    if (!inspectMode) setComparisonInspectCoordinate(null);
  }, [inspectMode]);
  const [pickedLocation, setPickedLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [hazardMode, setHazardMode] = useState<HazardMode>("tsunami");
  const [hazardCenters, setHazardCenters] = useState<Record<DirectHazardMode, { lat: number; lon: number } | null>>({
    asteroid: null,
    nuclear: null,
  });
  const [nuclearInput, setNuclearInput] = useState<NuclearInput>({
    yieldKt: sourceNumericDefault("DirectNuclear", "yield_kt"),
    burstType: sourceTextDefault("DirectNuclear", "burst_type") as NuclearInput["burstType"],
    populationDensity: sourceNumericDefault("DirectNuclear", "population_density"),
  });
  // Default to a 300 m impactor: reaches the ground and excavates a crater
  // (a 100 m stony airbursts) without continental-scale blast radii, so the
  // default "Impact" is dramatic but the effects still frame nicely.
  const [asteroidInput, setAsteroidInput] = useState<AsteroidInput>({
    diameterM: sourceNumericDefault("DirectAsteroid", "diameter_m"),
    densityKgM3: sourceNumericDefault("DirectAsteroid", "density_kg_m3"),
    velocityKmS: sourceNumericDefault("DirectAsteroid", "velocity_km_s"),
    angleDeg: sourceNumericDefault("DirectAsteroid", "angle_deg"),
    targetType: sourceTextDefault("DirectAsteroid", "target_type") as AsteroidInput["targetType"],
    waterDepthM: sourceNumericDefault("DirectAsteroid", "water_depth_m"),
  });
  const [hazardResult, setHazardResult] = useState<HazardResult | null>(null);
  const [ww3Session, setWw3Session] = useState<ActiveWw3ExchangeSession | null>(null);
  const [mirvPreview, setMirvPreview] = useState<MirvPreview | null>(null);
  const [showFireballs, setShowFireballs] = useState(false);
  const [humanitarianFacilitiesEnabled, setHumanitarianFacilitiesEnabled] = useState(false);
  const fireballFeed = useFireballs(hazardMode === "asteroid" && showFireballs);
  const [asteroidVisualReport, setAsteroidVisualReport] = useState<AsteroidVisualReport | null>(null);
  const [nuclearShelterReport, setNuclearShelterReport] = useState<NuclearShelterReport | null>(null);
  const [hazardError, setHazardError] = useState<string | null>(null);
  const [directRenderReplay, setDirectRenderReplay] = useState<RenderReplayAdapter | null>(null);
  const [directRenderFrame, setDirectRenderFrame] = useState<RendererNeutralFrameView | null>(null);
  const [hazardPending, setHazardPending] = useState(false);
  const hazardRequestId = useRef(0);
  const [windFromDeg, setWindFromDeg] = useState(sourceNumericDefault("DirectNuclear", "wind_from_deg"));
  const [detonateNonces, setDetonateNonces] = useState<Record<DirectHazardMode, number>>({
    asteroid: 0,
    nuclear: 0,
  });
  const [pendingGauge, setPendingGauge] = useState<{ lat: number; lon: number } | null>(null);
  const [sweGaugesA, setSweGaugesA] = useState<Gauge[]>([]);
  const [sweGaugesB, setSweGaugesB] = useState<Gauge[]>([]);
  const [compareMode, setCompareMode] = useState(false);
  const [recording, setRecording] = useState(false);
  const [sweSnapshots, setSweSnapshots] = useState<import("./types/scenario").GridSnapshot[] | null>(null);
  const [legendColormap, setLegendColormap] = useState<ColormapId>("diverging");
  const [sweMaxField, setSweMaxField] = useState<import("./types/scenario").MaxFieldProduct | null>(null);
  const [sweScientificExport, setSweScientificExport] = useState<import("./types/scenario").ScientificExportDescriptor | null>(null);
  const [sweScientificExportError, setSweScientificExportError] = useState<string | null>(null);
  const [sweRunQualityA, setSweRunQualityA] = useState<import("./types/scenario").RunQualityRecord | null>(null);
  const [sweRunQualityB, setSweRunQualityB] = useState<import("./types/scenario").RunQualityRecord | null>(null);
  const [sweRenderFrameA, setSweRenderFrameA] = useState<RenderFrameProvenance | null>(null);
  const [sweRenderFrameB, setSweRenderFrameB] = useState<RenderFrameProvenance | null>(null);
  const [sweIsochrones, setSweIsochrones] = useState<import("./types/scenario").Isochrone[] | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const [activeLesson, setActiveLesson] = useState<GuidedLessonDef | null>(null);
  const [activeStoryTarget, setActiveStoryTarget] = useState<GuidedStoryTarget | null>(null);
  const [lessonCompletions, setLessonCompletions] = useState<Record<string, string>>({});
  const [tokenBannerOpen, setTokenBannerOpen] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showPerfPanel, setShowPerfPanel] = useState(false);
  const [libraryPreview, setLibraryPreview] = useState<LibraryPreview | null>(null);
  const [libraryPreviewPending, setLibraryPreviewPending] = useState(false);
  const [libraryPreferences, setLibraryPreferences] = useState<ScenarioLibraryPreferences>(loadScenarioLibraryPreferences);
  const [sweRunAndWatchNonce, setSweRunAndWatchNonce] = useState(0);
  const [pendingRunPresetId, setPendingRunPresetId] = useState<string | null>(null);
  const [runJourney, setRunJourney] = useState<RunJourney | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("simple");
  const [customEditorOpen, setCustomEditorOpen] = useState(false);
  const [cameraTelemetry, setCameraTelemetry] = useState({ lat: 0, lon: 0, altitudeM: 20_000_000, headingDeg: 0 });
  const [outcomeFocus, setOutcomeFocus] = useState<OutcomeFocusRequest | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [scenarioEditRequest, setScenarioEditRequest] = useState<{ id: number; scenario: ScenarioInput; provenanceNote?: string } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const lastCameraUpdateAt = useRef(0);
  const outcomeFocusRequestId = useRef(0);
  const guidedStoryRuns = useRef(new Set<string>());
  const inspectorBodyRef = useRef<HTMLDivElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const exportTriggerRef = useRef<HTMLButtonElement | null>(null);
  const inTauri = useMemo(isTauri, []);
  const debouncedNuclearInput = useDebouncedValue(nuclearInput, 180);
  const debouncedAsteroidInput = useDebouncedValue(asteroidInput, 180);
  const referenceCaptureMode = useMemo(
    () => new URLSearchParams(window.location.search).get("referenceCapture") === "1",
    [],
  );
  const referenceCaptureSceneId = useMemo(
    () => new URLSearchParams(window.location.search).get("referenceScene"),
    [],
  );
  const [scenarioLinkRequest, setScenarioLinkRequest] = useState<{
    id: number;
    result: UrlScenarioResult;
  }>(() => ({ id: 0, result: scenarioFromUrl(window.location.search) }));
  const nextScenarioLinkRequestId = useRef(0);
  const handledScenarioLinkRequestId = useRef(-1);
  const [referenceEffectTimeMs, setReferenceEffectTimeMs] = useState<number | null>(null);

  const handleScientificExport = useCallback((
    descriptor: import("./types/scenario").ScientificExportDescriptor | null,
    error: string | null,
  ) => {
    setSweScientificExport(descriptor);
    setSweScientificExportError(error);
  }, []);

  const handleMirvPreviewChange = useCallback((preview: MirvPreview | null) => {
    setMirvPreview(preview);
    if (preview) setWw3Session(null);
  }, []);

  useEffect(() => {
    if (ww3Session?.state !== "running") return;
    const timer = window.setInterval(() => {
      setWw3Session((current) => {
        if (!current || current.state !== "running") return current;
        const scenarioDurationMs = Math.max(
          ...current.plan.scenario.phases.map((phase) => phase.delayMs + phase.durationMs),
          0,
        ) + 18_000;
        const elapsedMs = Math.min(scenarioDurationMs, current.elapsedMs + 250 * current.speed);
        const visibleStrikeCount = current.plan.strikes.length === 0
          ? 0
          : Math.min(current.plan.strikes.length, Math.floor((elapsedMs / scenarioDurationMs) * current.plan.strikes.length));
        return {
          ...current,
          elapsedMs,
          visibleStrikeCount,
          state: elapsedMs >= scenarioDurationMs ? "complete" : "running",
        };
      });
    }, 250);
    return () => window.clearInterval(timer);
  }, [ww3Session?.plan.id, ww3Session?.state]);

  const handleOutcomeFocus = useCallback((place: {
    name: string;
    lat: number;
    lon: number;
    range_m: number;
    arrival_time_s: number;
  }) => {
    outcomeFocusRequestId.current += 1;
    setOutcomeFocus({
      request_id: `outcome-${outcomeFocusRequestId.current}`,
      place: {
        label: place.name,
        lat_deg: place.lat,
        lon_deg: place.lon,
        range_m: Math.max(100_000, Math.min(2_500_000, place.range_m * 0.45)),
      },
      simulation_time_s: place.arrival_time_s,
    });
  }, []);

  useEffect(() => {
    if (!referenceCaptureMode) return;
    const handleReferenceView = (event: Event) => {
      const view = (event as CustomEvent<ReferenceCaptureView>).detail;
      if (view?.sceneId === referenceCaptureSceneId && Number.isFinite(view.effectTimeMs)) {
        setReferenceEffectTimeMs(view.effectTimeMs);
      }
    };
    window.addEventListener(REFERENCE_CAPTURE_EVENT, handleReferenceView);
    return () => window.removeEventListener(REFERENCE_CAPTURE_EVENT, handleReferenceView);
  }, [referenceCaptureMode, referenceCaptureSceneId]);

  const slotA = useScenarioSlot(timeS);
  const slotB = useScenarioSlot(timeS);
  const setSlotBActivePresetId = slotB.setActivePresetId;

  const handleGuidedStoryCue = useCallback((
    cue: GuidedStoryCue | null,
    lessonId: string,
    stepIndex: number,
  ) => {
    setActiveStoryTarget(cue?.target ?? null);
    if (!cue) return;

    if (cue.panel) setInspectorTab(cue.panel);
    if (cue.timeS !== undefined) setTimeS(cue.timeS);
    if (cue.playback) setTimelinePlaying(cue.playback === "play");
    if (cue.runSolver && !guidedStoryRuns.current.has(lessonId)) {
      guidedStoryRuns.current.add(lessonId);
      setSweRunAndWatchNonce((nonce) => nonce + 1);
    }
    if (cue.comparisonPresetId) {
      setSlotBActivePresetId(cue.comparisonPresetId);
      setCompareMode(true);
    }
    if (cue.camera) {
      outcomeFocusRequestId.current += 1;
      setOutcomeFocus({
        request_id: `lesson-${lessonId}-${stepIndex}-${outcomeFocusRequestId.current}`,
        place: {
          label: cue.camera.label,
          lat_deg: cue.camera.lat,
          lon_deg: cue.camera.lon,
          range_m: cue.camera.rangeM,
        },
        simulation_time_s: cue.timeS ?? 0,
        heading_deg: cue.camera.headingDeg,
        pitch_deg: cue.camera.pitchDeg,
      });
    }
  }, [setSlotBActivePresetId]);

  useEffect(() => {
    const selectors: Record<GuidedStoryTarget, string> = {
      setup: "#inspector-tab-setup",
      solver: ".section.swe",
      globe: ".app__globe-pane:first-child",
      timeline: ".simulation-transport",
      results: "#inspector-tab-results",
      layers: "#inspector-tab-layers",
      comparison: ".app__globe-stack[data-split='true']",
    };
    if (!activeStoryTarget) return;
    const target = document.querySelector<HTMLElement>(selectors[activeStoryTarget]);
    if (!target) return;
    target.setAttribute("data-story-highlight", "true");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
    return () => target.removeAttribute("data-story-highlight");
  }, [activeStoryTarget, compareMode, inspectorTab, slotA.initial]);

  const humanitarianFacilities = useHumanitarianFacilities(
    humanitarianFacilitiesEnabled && hazardMode === "tsunami",
    slotA.runupResults,
  );
  useEffect(() => {
    setPointProbeA(null);
    setPointProbeB(null);
  }, [hazardMode, hazardResult?.resultId, slotA.initial, slotB.initial]);
  useEffect(() => {
    setOutcomeFocus(null);
  }, [slotA.initial]);
  // Floor the duration so a degenerate single-frame (or t=0) run doesn't make
  // the transport report a zero-length timeline that stops playback instantly.
  const timelineDurationS = Math.max(sweSnapshots?.at(-1)?.time_s ?? 6 * 3600, 1);

  useEffect(() => {
    if (!pendingRunPresetId) return;
    if (slotA.error) {
      setPendingRunPresetId(null);
      return;
    }
    if (
      slotA.activePresetId === pendingRunPresetId
      && slotA.busyPresetId === null
      && slotA.initial !== null
    ) {
      setPendingRunPresetId(null);
      setRunJourney({ scenarioId: `preset:${pendingRunPresetId}`, stage: "calculate" });
      setSweRunAndWatchNonce((nonce) => nonce + 1);
    }
  }, [pendingRunPresetId, slotA.activePresetId, slotA.busyPresetId, slotA.error, slotA.initial]);

  // Ephemeral status toast for actions that otherwise fail silently
  // (exports, IPC errors). Auto-dismisses; replaced by the next message.
  const showToast = useCallback((msg: string, tone: "error" | "info" = "info", action?: ToastAction) => {
    setToast({ msg, tone, action });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), action ? 12_000 : 6_000);
  }, []);
  const reportExportResult = useCallback((
    result: ExportResult,
    successMessage: string,
    retry: () => void,
  ) => {
    if (result.ok) {
      showToast(successMessage);
      return;
    }
    showToast(
      `${t(`app.export.failure.${result.code}` as MessageKey)}: ${result.message}`,
      "error",
      result.retryable ? { label: t("app.retry"), run: retry } : undefined,
    );
  }, [showToast, t]);
  const changeWorkspaceMode = useCallback((mode: WorkspaceMode) => {
    setWorkspaceMode(mode);
    void settings.setWorkspaceMode(mode).catch((error) => {
      console.warn("[settings] failed to persist workspace mode", error);
      showToast(t("app.workspacePersistFailed"), "error");
    });
  }, [showToast, t]);
  useEffect(() => {
    settings.getWorkspaceMode().then(setWorkspaceMode).catch((error) => {
      console.warn("[settings] failed to load workspace mode", error);
    });
    settings.getColormap().then(setLegendColormap).catch(() => {
      /* keep the default legend */
    });
  }, []);
  const handleCameraTelemetry = useCallback((telemetry: { lat: number; lon: number; altitudeM: number; headingDeg: number }) => {
    const now = performance.now();
    if (now - lastCameraUpdateAt.current < 100) return;
    lastCameraUpdateAt.current = now;
    setCameraTelemetry((current) =>
      Math.abs(current.lat - telemetry.lat) < 0.005
      && Math.abs(current.lon - telemetry.lon) < 0.005
      && Math.abs(current.altitudeM - telemetry.altitudeM) < 25
      && Math.abs(current.headingDeg - telemetry.headingDeg) < 0.25
        ? current
        : telemetry,
    );
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const handleSweSnapshotsReady = useCallback((snapshots: import("./types/scenario").GridSnapshot[] | null) => {
    setSweSnapshots(snapshots);
    if (snapshots?.length) {
      setTimeS(snapshots[0].time_s);
      const shouldAutoWatch = runJourney?.scenarioId.startsWith("preset:")
        && runJourney.stage === "calculate";
      setTimelinePlaying(Boolean(shouldAutoWatch));
      if (shouldAutoWatch) {
        setInspectorTab("results");
        setRunJourney((current) => current ? { ...current, stage: "watch" } : null);
      }
    }
  }, [runJourney]);

  useEffect(() => {
    if (!runJourney?.scenarioId.startsWith("direct:")) return;
    if (hazardPending) {
      setRunJourney((current) => current ? { ...current, stage: "calculate" } : null);
      return;
    }
    if (hazardResult) {
      setInspectorTab("results");
      setRunJourney((current) => current ? { ...current, stage: "watch" } : null);
    }
  }, [hazardPending, hazardResult, runJourney?.scenarioId]);

  useEffect(() => {
    if (runJourney?.stage !== "watch") return;
    const timer = window.setTimeout(() => {
      setRunJourney((current) => current?.stage === "watch"
        ? { ...current, stage: "understand" }
        : current);
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [runJourney?.stage, runJourney?.scenarioId]);

  useEffect(() => {
    inspectorBodyRef.current?.scrollTo({ top: 0 });
  }, [inspectorTab, hazardMode, compareMode]);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const focusFrame = window.requestAnimationFrame(() => {
      const panel = exportMenuRef.current?.querySelector<HTMLElement>(".app__export-panel");
      const focusTarget = panel?.querySelector<HTMLButtonElement>('button:not([aria-disabled="true"])') ?? panel;
      focusTarget?.focus();
    });
    const closeOutside = (event: PointerEvent) => {
      if (!exportMenuRef.current?.contains(event.target as Node)) setExportMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setExportMenuOpen(false);
      exportTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [exportMenuOpen]);

  useEffect(() => {
    if (!timelinePlaying) return;
    const timer = window.setInterval(() => {
      setTimeS((current) => {
        const next = current + 60 * timelineRate;
        if (next >= timelineDurationS) {
          setTimelinePlaying(false);
          return timelineDurationS;
        }
        return next;
      });
    }, 250);
    return () => window.clearInterval(timer);
  }, [timelinePlaying, timelineRate, timelineDurationS]);

  useEffect(() => {
    settings
      .getLessonCompletions()
      .then(setLessonCompletions)
      .catch((err) => console.warn("[lessons] failed to load completion state", err));
  }, []);

  const markLessonComplete = useCallback((lessonId: string) => {
    const completedAt = new Date().toISOString();
    setLessonCompletions((current) => ({ ...current, [lessonId]: completedAt }));
    settings
      .markLessonCompleted(lessonId, completedAt)
      .catch((err) => console.warn("[lessons] failed to persist lesson completion", err));
  }, []);

  // Surface scenario/preset IPC failures (from either slot) to the user.
  useEffect(() => {
    if (slotA.error) showToast(slotA.error, "error");
  }, [slotA.error, showToast]);
  useEffect(() => {
    if (slotB.error) showToast(slotB.error, "error");
  }, [slotB.error, showToast]);

  // Apply persisted theme once at startup.
  useEffect(() => {
    loadTheme().then(applyTheme).catch((err) => {
      console.warn("[theme] failed to load persisted theme", err);
      applyTheme("mocha");
    });
  }, []);

  // Desktop cold- and warm-launch URLs enter the same request queue as browser
  // share links. The deep-link adapter validates the complete custom URL before
  // forwarding only its query to the canonical scenario decoder.
  useEffect(() => {
    if (!inTauri) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void subscribeToScenarioDeepLinks((result) => {
      if (!active) return;
      nextScenarioLinkRequestId.current += 1;
      setScenarioLinkRequest({ id: nextScenarioLinkRequestId.current, result });
    })
      .then((unlisten) => {
        if (active) unsubscribe = unlisten;
        else unlisten();
      })
      .catch((error) => {
        console.warn("[deep-link] listener unavailable", error);
        if (active) showToast(t("app.deepLinksUnavailable"), "error");
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [inTauri, showToast, t]);

  // Restore scenario from browser/deep-link query params. Preset IDs wait for
  // the live registry so an unknown link cannot silently fall back to a
  // different demo scenario. Each request ID is consumed at most once.
  useEffect(() => {
    if (handledScenarioLinkRequestId.current === scenarioLinkRequest.id) return;
    const request = scenarioLinkRequest.result;
    if (request.type === "none") {
      handledScenarioLinkRequestId.current = scenarioLinkRequest.id;
      return;
    }
    if (request.type === "invalid") {
      handledScenarioLinkRequestId.current = scenarioLinkRequest.id;
      showToast(t("app.linkInvalid", { reason: request.reason }), "error");
      return;
    }
    if (request.type === "scenario") {
      handledScenarioLinkRequestId.current = scenarioLinkRequest.id;
      slotA.simulate(request.scenario);
      return;
    }
    if (presets.length === 0) return;
    handledScenarioLinkRequestId.current = scenarioLinkRequest.id;
    if (presets.some((preset) => preset.id === request.presetId)) {
      setLibraryPreview({ kind: "preset", presetId: request.presetId });
      setLibraryPreviewPending(false);
      slotA.setActivePresetId(request.presetId);
    } else {
      showToast(t("app.linkNotFound", { id: request.presetId }), "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presets, scenarioLinkRequest]);

  // Scenario discovery is the first usable surface after the safety acknowledgement.
  // Settings can explicitly request the longer tour without obscuring launch.
  useEffect(() => {
    const onRequested = () => setTourOpen(true);
    window.addEventListener("tsunamisim:tour-requested", onRequested);
    return () => window.removeEventListener("tsunamisim:tour-requested", onRequested);
  }, []);

  const loadPresets = useCallback(() => {
    if (!inTauri) {
      setPresetsResult(resolveAsyncResult(listDemoPresets(), (items) => items.length === 0));
      return;
    }
    setPresetsResult((current) => startAsyncResult(current));
    api
      .listPresets()
      .then((p) => {
        setPresetsResult(resolveAsyncResult(p, (items) => items.length === 0));
      })
      .catch((err) => {
        console.error("listPresets failed", err);
        setPresetsResult((current) => rejectAsyncResult(current, err));
      });
  }, [inTauri]);

  useEffect(() => {
    loadPresets();
  }, [loadPresets]);

  // First-launch banner: prompt the user to paste a Cesium ion token
  // for satellite imagery. Show only when the user has no token AND
  // hasn't dismissed the banner before. Re-evaluates after Settings
  // save so pasting a token (or resetting settings) updates it live.
  useEffect(() => {
    let cancelled = false;
    const reeval = () => {
      Promise.all([settings.getCesiumToken(), settings.getTokenBannerDismissed()])
        .then(([tok, dismissed]) => {
          if (cancelled) return;
          setTokenBannerOpen(!tok && !dismissed);
        })
        .catch((err) => console.warn("[settings] failed to evaluate token banner state", err));
    };
    reeval();
    window.addEventListener("tsunamisim:settings-saved", reeval);
    return () => {
      cancelled = true;
      window.removeEventListener("tsunamisim:settings-saved", reeval);
    };
  }, []);

  const activePresetA = presetById(presets, slotA.activePresetId);
  const activePresetB = presetById(presets, slotB.activePresetId);
  const activeComparisonStory = comparisonStoryForPair(slotA.activePresetId, slotB.activePresetId);
  const activeComparisonMetrics = useMemo(
    () => buildComparisonMetrics(slotA.initial, slotB.initial),
    [slotA.initial, slotB.initial],
  );
  const layerEvidencePresetA = activePresetA ?? (
    libraryPreview?.kind === "preset" ? presetById(presets, libraryPreview.presetId) : null
  );
  const libraryPreviewCamera = useMemo(() => {
    if (!libraryPreview) return null;
    if (libraryPreview.kind === "direct") {
      const { scenario } = libraryPreview;
      return {
        targetLat: scenario.center.lat,
        targetLon: scenario.center.lon,
        rangeM: scenario.camera.altitudeM,
        headingDeg: scenario.camera.headingDeg,
        pitchDeg: scenario.camera.pitchDeg,
      };
    }
    const preset = presets.find((candidate) => candidate.id === libraryPreview.presetId);
    if (!preset) return null;
    const camera = preset.camera_view ?? { heading_deg: 0, pitch_deg: -55, range_m: 2_000_000 };
    return {
      targetLat: preset.source.source.location.lat_deg,
      targetLon: preset.source.source.location.lon_deg,
      rangeM: camera.range_m,
      headingDeg: camera.heading_deg,
      pitchDeg: camera.pitch_deg,
    };
  }, [libraryPreview, presets]);
  const libraryPreviewLabel = libraryPreview?.kind === "direct"
    ? libraryPreview.scenario.name
    : libraryPreview?.kind === "preset"
      ? presets.find((preset) => preset.id === libraryPreview.presetId)?.name ?? null
      : null;
  const activeScenarioKindA = activePresetA?.source.kind ?? slotA.lastCustomScenario?.kind ?? null;
  const activeScenarioKindB = activePresetB?.source.kind ?? slotB.lastCustomScenario?.kind ?? null;
  const comparisonCameraA = useMemo(() => (
    compareMode && activeComparisonStory && slotA.initial
      ? {
        targetLat: slotA.initial.center.lat_deg,
        targetLon: slotA.initial.center.lon_deg,
        rangeM: activeComparisonStory.cameraRangeM,
        headingDeg: 0,
        pitchDeg: -55,
      }
      : null
  ), [activeComparisonStory, compareMode, slotA.initial]);
  const comparisonCameraB = useMemo(() => (
    compareMode && activeComparisonStory && slotB.initial
      ? {
        targetLat: slotB.initial.center.lat_deg,
        targetLon: slotB.initial.center.lon_deg,
        rangeM: activeComparisonStory.cameraRangeM,
        headingDeg: 0,
        pitchDeg: -55,
      }
      : null
  ), [activeComparisonStory, compareMode, slotB.initial]);
  const directHazardMode: DirectHazardMode | null = hazardMode === "tsunami" ? null : hazardMode;
  const inHazardMode = directHazardMode !== null;
  const hazardCenter = directHazardMode ? hazardCenters[directHazardMode] : null;
  const detonateNonce = directHazardMode ? detonateNonces[directHazardMode] : 0;

  // Rust is the sole authority for direct-hazard products. Each change starts
  // a versioned request and clears the previous product, preventing a slower
  // response from an earlier slider value from replacing the current one.
  useEffect(() => {
    const requestId = ++hazardRequestId.current;
    if (hazardMode === "tsunami" || !hazardCenter) {
      setHazardResult(null);
      setAsteroidVisualReport(null);
      setNuclearShelterReport(null);
      setHazardError(null);
      setDirectRenderReplay(null);
      setDirectRenderFrame(null);
      setHazardPending(false);
      return;
    }
    let cancelled = false;
    if (!inTauri) {
      const fixture = referenceCaptureMode && referenceCaptureSceneId
        ? (directHazardCaptureFixtures as Record<string, HazardResult>)[referenceCaptureSceneId]
        : undefined;
      setHazardResult(fixture?.kind === hazardMode ? structuredClone(fixture) : null);
      setAsteroidVisualReport(null);
      setNuclearShelterReport(null);
      setDirectRenderReplay(null);
      const recordingUrl = referenceCaptureSceneId
        ? DIRECT_RENDER_FIXTURE_URLS[referenceCaptureSceneId]
        : undefined;
      if (recordingUrl) {
        void fetch(recordingUrl)
          .then((response) => {
            if (!response.ok) throw new Error(`render fixture returned ${response.status}`);
            return response.arrayBuffer();
          })
          .then(ingestRenderRecording)
          .then((replay) => {
            if (!cancelled && requestId === hazardRequestId.current) setDirectRenderReplay(replay);
          })
          .catch((error) => {
            if (!cancelled) console.error("direct render fixture failed", error);
          });
      }
      setHazardPending(false);
      return () => {
        cancelled = true;
      };
    }

    setHazardResult(null);
    setAsteroidVisualReport(null);
    setNuclearShelterReport(null);
    setHazardError(null);
    setDirectRenderReplay(null);
    setDirectRenderFrame(null);
    setHazardPending(true);
    const center = { lat: hazardCenter.lat, lon: hazardCenter.lon };
    const nuclearRequest = {
          center,
          yield_kt: debouncedNuclearInput.yieldKt,
          burst_type: debouncedNuclearInput.burstType,
          height_m: debouncedNuclearInput.heightM,
          fission_pct: debouncedNuclearInput.fissionPct ?? sourceNumericDefault("DirectNuclear", "fission_pct"),
          population_density: debouncedNuclearInput.populationDensity ?? sourceNumericDefault("DirectNuclear", "population_density"),
        };
    const asteroidRequest = {
          center,
          diameter_m: debouncedAsteroidInput.diameterM,
          density_kg_m3: debouncedAsteroidInput.densityKgM3,
          velocity_km_s: debouncedAsteroidInput.velocityKmS,
          angle_deg: debouncedAsteroidInput.angleDeg,
          target_type: debouncedAsteroidInput.targetType,
          water_depth_m: debouncedAsteroidInput.waterDepthM ?? 0,
          beach_slope_rad: debouncedAsteroidInput.beachSlopeRad ?? sourceNumericDefault("DirectAsteroid", "beach_slope_rad"),
        };
    const request = hazardMode === "nuclear"
      ? Promise.allSettled([
          api.simulateNuclearHazard(nuclearRequest),
          api.simulateNuclearHazardRender(nuclearRequest),
        ])
      : Promise.allSettled([
          api.simulateAsteroidHazard(asteroidRequest),
          api.simulateAsteroidHazardRender(asteroidRequest),
        ]);

    void request
      .then(([resultOutcome, renderOutcome]) => {
        if (cancelled || requestId !== hazardRequestId.current) return;
        if (resultOutcome.status === "rejected") throw resultOutcome.reason;
        const result = resultOutcome.value;
        if (result.authority !== "rust" || result.kind !== hazardMode) {
          throw new Error("backend returned an invalid direct-hazard authority contract");
        }
        setHazardResult(result);
        if (hazardMode === "asteroid" && result.resultId) {
          void api.asteroidResultVisuals(result.resultId)
            .then((report) => {
              if (!cancelled && requestId === hazardRequestId.current) {
                setAsteroidVisualReport(report);
              }
            })
            .catch((error) => {
              if (!cancelled) console.error("asteroid result diagrams failed", error);
            });
        }
        if (hazardMode === "nuclear" && result.resultId && result.rings.some((ring) => ring.category === "blast" || ring.category === "thermal")) {
          void api.nuclearShelterAdvisor(result.resultId)
            .then((report) => {
              if (!cancelled && requestId === hazardRequestId.current) {
                setNuclearShelterReport(report);
              }
            })
            .catch((error) => {
              if (!cancelled) console.error("nuclear shelter screening failed", error);
            });
        }
        setHazardError(null);
        if (renderOutcome.status === "fulfilled") {
          setDirectRenderReplay(renderOutcome.value);
        } else {
          console.error("direct hazard render stream failed", renderOutcome.reason);
          setDirectRenderReplay(null);
          showToast(t("app.directAnimationFailed"), "error");
        }
      })
      .catch((error) => {
        if (cancelled || requestId !== hazardRequestId.current) return;
        console.error("direct hazard simulation failed", error);
        setHazardResult(null);
        setAsteroidVisualReport(null);
        setNuclearShelterReport(null);
        const message = t("app.directSimulationFailed", { error: String(error) });
        setHazardError(message);
        showToast(message, "error");
      })
      .finally(() => {
        if (!cancelled && requestId === hazardRequestId.current) setHazardPending(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    hazardMode,
    hazardCenter,
    inTauri,
    debouncedNuclearInput,
    debouncedAsteroidInput,
    referenceCaptureMode,
    referenceCaptureSceneId,
    showToast,
    t,
  ]);

  useEffect(() => {
    setDirectRenderFrame(null);
    if (!directRenderReplay || !detonateNonce) return;
    const frames = directRenderReplay.frames;
    const lastTick = frames.at(-1)?.header.solver_tick ?? 0;
    // Guard against a zero/negative tick duration (a malformed header would
    // otherwise divide by zero and snap the animation straight to the last frame).
    const tickDurationS = Math.max(1e-3, directRenderReplay.scenario?.header.tick_duration_s ?? 0.1);
    if (referenceCaptureMode && referenceCaptureSceneId) {
      const scene = referenceScenes.scenes.find((entry) => entry.id === referenceCaptureSceneId);
      const effectTimeMs = referenceEffectTimeMs ?? scene?.effectTimeMs ?? 0;
      const tick = Math.min(lastTick, Math.max(0, Math.round(effectTimeMs / (tickDurationS * 1000))));
      setDirectRenderFrame(directRenderReplay.frameAtTick(tick));
      return;
    }
    let animationFrame = 0;
    const startedAt = performance.now();
    const advance = (now: number) => {
      const tick = Math.min(lastTick, Math.floor((now - startedAt) / (tickDurationS * 1000)));
      setDirectRenderFrame(directRenderReplay.frameAtTick(tick));
      if (tick < lastTick) animationFrame = requestAnimationFrame(advance);
    };
    animationFrame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(animationFrame);
  }, [directRenderReplay, detonateNonce, referenceCaptureMode, referenceCaptureSceneId, referenceEffectTimeMs]);

  // Nuclear fallout plume polygons (surface bursts only), driven by wind.
  const hazardPolygons = useMemo(() => {
    if (hazardMode !== "nuclear" || !hazardCenter || !hazardResult) return null;
    const eff = hazardResult.detail as NuclearDetail | undefined;
    if (!eff?.fallout) return null;
    return falloutRings({ lat: hazardCenter.lat, lon: hazardCenter.lon }, eff.fallout, windFromDeg);
  }, [hazardMode, hazardCenter, hazardResult, windFromDeg]);
  const activeSourceLabel = activePresetA?.name ?? slotA.initial?.label ?? t("layers.noSource");
  const directWorkspaceLabel = hazardMode === "nuclear" ? t("app.nuclearDetonation") : t("app.asteroidImpact");
  const activeWorkspaceLabel = inHazardMode
    ? familiarPlace
      ? t("place.whatIfTitle", { name: familiarPlace.name })
      : directWorkspaceLabel
    : activeSourceLabel;
  const viewportSourceLabel = libraryPreviewPending && libraryPreviewLabel && !slotA.initial && !hazardCenter
    ? t("app.previewLabel", { label: libraryPreviewLabel })
    : activeWorkspaceLabel;
  const sourceRequiredReason = inHazardMode
    ? t("app.reason.directWorkspace")
    : t("app.reason.selectSource");
  const snapshotsRequiredReason = t("app.reason.czml");
  const runupRequiredReason = t("app.reason.runup");
  const directExportRequiredReason = t("app.reason.directExport");
  const hasSwePlayback = !inHazardMode && (sweSnapshots?.length ?? 0) > 0;
  const directRenderProvenance: RenderFrameProvenance | null = directRenderFrame
    ? {
        protocolVersion: "1.0",
        scenarioId: directRenderFrame.scenario_id,
        scenarioSha256: directRenderFrame.scenario_sha256,
        sequence: directRenderFrame.sequence.toString(),
        solverTick: directRenderFrame.solver_tick,
        simulationTimeS: directRenderFrame.simulation_time_s,
        tickDurationS: directRenderFrame.tick_duration_s,
        payloadSha256: directRenderFrame.payload_sha256,
        fieldSha256: {},
      }
    : null;
  const modelStatus = inHazardMode
    ? !inTauri && hazardCenter && !hazardResult
      ? t("app.status.desktopPhysics")
      : hazardPending
      ? t("app.status.computingEffects")
      : hazardResult
      ? t("app.status.effectsReady")
      : t("app.status.awaitingTarget")
    : recording
      ? t("app.status.recordingExport")
      : timelinePlaying
        ? t("app.status.playbackActive")
        : slotA.busyPresetId
          ? t("app.status.loadingSource")
          : hasSwePlayback
            ? t("app.status.sweReady")
            : slotA.initial
              ? t("results.sourceReady")
              : t("app.status.awaitingSource");
  const exportEvidenceIdsA = () => {
    if (inHazardMode) {
      const scenarioEvidence = libraryPreview?.kind === "direct" && libraryPreview.scenario.domain === directHazardMode
        ? buildDirectScenarioEvidence(libraryPreview.scenario)
        : null;
      return evidenceIds([
        scenarioEvidence,
        hazardResult ? buildDirectResultEvidence(hazardResult) : null,
        hazardResult ? buildLayerEvidence("source", null, null, null, hazardResult, directHazardMode) : null,
        hazardResult ? buildLayerEvidence("hazard-rings", null, null, null, hazardResult, directHazardMode) : null,
        directHazardMode === "nuclear" && hazardPolygons?.length
          ? buildLayerEvidence("fallout-plume", null, null, null, hazardResult, directHazardMode)
          : null,
      ]);
    }
    return evidenceIds([
      slotA.initial ? buildSourceEvidence(activePresetA, slotA.initial, activeScenarioKindA) : null,
      slotA.initial ? buildOutcomeEvidence(activePresetA, slotA.initial, activeScenarioKindA) : null,
      slotA.initial ? buildLayerEvidence("source", activePresetA, slotA.initial, activeScenarioKindA) : null,
      slotA.wavefront ? buildLayerEvidence("analytical-wavefront", activePresetA, slotA.initial, activeScenarioKindA) : null,
      slotA.sweSnapshot ? buildLayerEvidence("swe-field", activePresetA, slotA.initial, activeScenarioKindA) : null,
      sweMaxField ? buildLayerEvidence("maximum-field", activePresetA, slotA.initial, activeScenarioKindA) : null,
      sweIsochrones?.length ? buildLayerEvidence("arrival-isochrones", activePresetA, slotA.initial, activeScenarioKindA) : null,
      slotA.runupResults.length ? buildLayerEvidence("coastal-runup", activePresetA, slotA.initial, activeScenarioKindA) : null,
      dartPinsForPreset(slotA.activePresetId).length ? buildLayerEvidence("dart-observations", activePresetA, slotA.initial, activeScenarioKindA) : null,
    ]);
  };
  const exportEvidenceIdsB = () => evidenceIds([
    slotB.initial ? buildSourceEvidence(activePresetB, slotB.initial, activeScenarioKindB) : null,
    slotB.initial ? buildOutcomeEvidence(activePresetB, slotB.initial, activeScenarioKindB) : null,
    slotB.initial ? buildLayerEvidence("source", activePresetB, slotB.initial, activeScenarioKindB) : null,
    slotB.wavefront ? buildLayerEvidence("analytical-wavefront", activePresetB, slotB.initial, activeScenarioKindB) : null,
    slotB.sweSnapshot ? buildLayerEvidence("swe-field", activePresetB, slotB.initial, activeScenarioKindB) : null,
    slotB.runupResults.length ? buildLayerEvidence("coastal-runup", activePresetB, slotB.initial, activeScenarioKindB) : null,
    dartPinsForPreset(slotB.activePresetId).length ? buildLayerEvidence("dart-observations", activePresetB, slotB.initial, activeScenarioKindB) : null,
  ]);
  const activeDirectScenario = libraryPreview?.kind === "direct" && libraryPreview.scenario.domain === directHazardMode
    ? libraryPreview.scenario
    : null;
  const familiarPlaceReport = familiarPlace
    && pointProbeA
    && pointProbeA.lat === familiarPlace.lat
    && pointProbeA.lon === familiarPlace.lon
      ? pointProbeA
      : null;
  const directExportData: DirectHazardExportData | null = inHazardMode && hazardResult
    ? { result: hazardResult, polygons: hazardPolygons }
    : null;
  const exportMetaA = (): ScreenshotMeta => inHazardMode ? ({
    preset: null,
    initial: null,
    timeS: directRenderFrame?.simulation_time_s ?? timeS,
    fileId: activeDirectScenario?.id ?? `${directHazardMode ?? "direct"}-result`,
    scenarioName: activeDirectScenario?.name
      ?? t("app.directScenarioAt", {
        kind: directHazardMode === "nuclear" ? t("app.nuclearDetonation") : t("app.asteroidImpact"),
        lat: hazardResult ? formatNumber(hazardResult.center.lat, { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : "—",
        lon: hazardResult ? formatNumber(hazardResult.center.lon, { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : "—",
      }),
    scenarioKind: directHazardMode === "nuclear" ? "Nuclear" : "Asteroid",
    solverMode: t("app.solver.direct", { version: hazardResult?.modelVersion ?? "direct-hazard" }),
    citationReference: activeDirectScenario?.reference ?? t("app.directCitation"),
    citationUrl: activeDirectScenario?.referenceUrl ?? null,
    limitation: activeDirectScenario?.limitations?.join(" ")
      ?? t("app.directLimitation"),
    bathymetryAssetId: "not-applicable-direct-hazard",
    bathymetrySource: t("app.directBathymetry"),
    renderFrame: directRenderProvenance,
    runQuality: null,
    evidenceIds: exportEvidenceIdsA(),
  }) : ({
    preset: activePresetA,
    initial: slotA.initial,
    timeS,
    scenarioKind: activePresetA?.source.kind ?? slotA.lastCustomScenario?.kind ?? "Custom",
    solverMode: hasSwePlayback
      ? t("app.solver.swe")
      : t("app.solver.analytical"),
    renderFrame: inHazardMode ? directRenderProvenance : sweRenderFrameA,
    runQuality: sweRunQualityA,
    evidenceIds: exportEvidenceIdsA(),
  });

  const exportMetaB = (): ScreenshotMeta => ({
    preset: activePresetB,
    initial: slotB.initial,
    timeS,
    scenarioKind: activePresetB?.source.kind ?? slotB.lastCustomScenario?.kind ?? "Custom",
    solverMode: hasSwePlayback
      ? t("app.solver.swe")
      : t("app.solver.analytical"),
    renderFrame: sweRenderFrameB,
    runQuality: sweRunQualityB,
    evidenceIds: exportEvidenceIdsB(),
  });

  async function handlePickGlobe(lat: number, lon: number, preserveFamiliarPlace = false) {
    if (directHazardMode) {
      if (!preserveFamiliarPlace) {
        setFamiliarPlace(null);
        setComparisonInspectCoordinate(null);
        setPointProbeA(null);
        setPointProbeB(null);
      }
      setHazardCenters((current) => ({ ...current, [directHazardMode]: { lat, lon } }));
      try {
        const surface = inTauri
          ? await api.surfaceProbe({ lat_deg: lat, lon_deg: lon })
          : probeSurfaceLocal(lat, lon);
        if (surface.surface_class === "coast" || surface.surface_class === "unknown") {
          showToast(
            t("app.surface.unresolved", { surface: surface.surface_class }),
            "info",
          );
        } else {
          const asteroidTarget = asteroidTargetFromSurface(surface.surface_class);
          if (directHazardMode === "asteroid") {
            setAsteroidInput((current) => ({
              ...current,
              targetType: asteroidTarget ?? current.targetType,
              waterDepthM: surface.is_wet ? Math.max(1, surface.water_depth_m) : 0,
            }));
          } else {
            setNuclearInput((current) => ({
              ...current,
              burstType: surfaceBurstTypeFromSurface(current.burstType, surface.surface_class),
            }));
          }
          showToast(
            t("app.surface.classified", {
              surface: surface.surface_class.replace("_", " "),
              version: surface.mask_version,
              confidence: surface.confidence,
            }),
            "info",
          );
        }
      } catch (error) {
        console.warn("[surface] target probe failed", error);
        showToast(t("app.surface.failed"), "error");
      }
    } else {
      setPickedLocation({ lat, lon });
    }
    setPickMode(false);
  }

  function handleLocationSelect(location: NukemapLocationResult, openResults = false) {
    setFamiliarPlace(location);
    setComparisonInspectCoordinate({ lat: location.lat, lon: location.lon });
    setPointProbeA(null);
    setPointProbeB(null);
    setInspectMode(true);
    if (directHazardMode) {
      void handlePickGlobe(location.lat, location.lon, true);
    } else {
      outcomeFocusRequestId.current += 1;
      setOutcomeFocus({
        request_id: `familiar-place-${outcomeFocusRequestId.current}`,
        place: {
          label: location.name,
          lat_deg: location.lat,
          lon_deg: location.lon,
          range_m: 900_000,
        },
        simulation_time_s: timeS,
      });
    }
    if (directHazardMode === "nuclear") {
      setNuclearInput((current) => ({
        ...current,
        populationDensity: location.density.peoplePerKm2,
      }));
    }
    if (openResults && (directHazardMode ? hazardCenter : slotA.initial)) {
      setInspectorTab("results");
    }
    setPickMode(false);
  }

  function clearFamiliarPlace() {
    setFamiliarPlace(null);
    setComparisonInspectCoordinate(null);
    setPointProbeA(null);
    setPointProbeB(null);
    setInspectMode(false);
    if (!directHazardMode || !activeDirectScenario) return;
    setHazardCenters((current) => ({
      ...current,
      [directHazardMode]: { ...activeDirectScenario.center },
    }));
    if (activeDirectScenario.domain === "asteroid" && activeDirectScenario.asteroid) {
      setAsteroidInput({ ...activeDirectScenario.asteroid });
    } else if (activeDirectScenario.domain === "nuclear" && activeDirectScenario.nuclear) {
      setNuclearInput({ ...activeDirectScenario.nuclear });
    }
  }

  function selectHazardMode(mode: HazardMode) {
    setRunJourney(null);
    setHazardMode(mode);
    setLibraryPreviewPending(false);
    if (mode !== "tsunami") {
      setDetonateNonces((current) => ({ ...current, [mode]: 0 }));
      if (familiarPlace) {
        setHazardCenters((current) => ({
          ...current,
          [mode]: { lat: familiarPlace.lat, lon: familiarPlace.lon },
        }));
        setComparisonInspectCoordinate({ lat: familiarPlace.lat, lon: familiarPlace.lon });
        if (mode === "nuclear") {
          setNuclearInput((current) => ({
            ...current,
            populationDensity: familiarPlace.density.peoplePerKm2,
          }));
        }
      }
    }
    setPickMode(false);
    setInspectMode(Boolean(familiarPlace));
    setCompareMode(false);
    setExportMenuOpen(false);
    setTimelinePlaying(false);
    if (mode !== "nuclear") {
      setWw3Session(null);
      setMirvPreview(null);
    }
    setPendingGauge(null);
    setInspectorTab("setup");
  }

  function updateLibraryPreferences(
    transform: (current: ScenarioLibraryPreferences) => ScenarioLibraryPreferences,
  ) {
    setLibraryPreferences((current) => {
      const next = transform(current);
      saveScenarioLibraryPreferences(next);
      return next;
    });
  }

  function previewPreset(presetId: string) {
    setRunJourney(null);
    setTimelinePlaying(false);
    setCustomEditorOpen(false);
    setLibraryPreview({ kind: "preset", presetId });
    setLibraryPreviewPending(true);
  }

  function previewDirectScenario(scenario: DirectScenarioTemplate) {
    setRunJourney(null);
    setTimelinePlaying(false);
    setCustomEditorOpen(false);
    setLibraryPreview({ kind: "direct", scenario });
    setLibraryPreviewPending(true);
  }

  function runPresetFromLibrary(presetId: string) {
    const scenarioId = `preset:${presetId}`;
    const canReuseSnapshots = !referenceCaptureMode
      && slotA.activePresetId === presetId
      && Boolean(sweSnapshots?.length);
    selectHazardMode("tsunami");
    setLibraryPreview({ kind: "preset", presetId });
    setLibraryPreviewPending(false);
    setCustomEditorOpen(false);
    slotA.setActivePresetId(presetId);
    if (canReuseSnapshots) {
      setPendingRunPresetId(null);
      setTimeS(sweSnapshots![0].time_s);
      setTimelinePlaying(true);
      setInspectorTab("results");
      setRunJourney({ scenarioId, stage: "watch" });
    } else {
      setPendingRunPresetId(referenceCaptureMode ? null : presetId);
      setInspectorTab("setup");
      setRunJourney(referenceCaptureMode ? null : { scenarioId, stage: "prepare" });
    }
    updateLibraryPreferences((current) => recordRecentScenario(current, scenarioId));
  }

  function startGuidedLesson(lesson: GuidedLessonDef) {
    const scenarioId = `preset:${lesson.presetId}`;
    if (slotA.activePresetId !== lesson.presetId) guidedStoryRuns.current.delete(lesson.id);
    selectHazardMode("tsunami");
    setLibraryPreview({ kind: "preset", presetId: lesson.presetId });
    setLibraryPreviewPending(false);
    setCustomEditorOpen(false);
    setPendingRunPresetId(null);
    setRunJourney(null);
    setTimeS(0);
    slotA.setActivePresetId(lesson.presetId);
    setInspectorTab("setup");
    setActiveLesson(lesson);
    updateLibraryPreferences((current) => recordRecentScenario(current, scenarioId));
  }

  function runLibraryPreview() {
    if (!libraryPreview) return;
    setLibraryPreviewPending(false);
    if (libraryPreview.kind === "preset") {
      runPresetFromLibrary(libraryPreview.presetId);
      return;
    }

    const scenario = libraryPreview.scenario;
    const scenarioCenter = familiarPlace
      ? { lat: familiarPlace.lat, lon: familiarPlace.lon }
      : scenario.center;
    const currentCenter = hazardCenters[scenario.domain];
    const currentInput = scenario.domain === "asteroid" ? asteroidInput : nuclearInput;
    const scenarioInput = scenario.domain === "asteroid" ? scenario.asteroid : scenario.nuclear;
    const canReuseResult = hazardMode === scenario.domain
      && hazardResult?.kind === scenario.domain
      && currentCenter?.lat === scenarioCenter.lat
      && currentCenter?.lon === scenarioCenter.lon
      && JSON.stringify(currentInput) === JSON.stringify(scenarioInput);
    setWw3Session(null);
    setMirvPreview(null);
    selectHazardMode(scenario.domain);
    setDirectRenderFrame(null);
    if (!canReuseResult) {
      setHazardResult(null);
      setDirectRenderReplay(null);
      if (scenario.domain === "asteroid" && scenario.asteroid) {
        setAsteroidInput({ ...scenario.asteroid });
      } else if (scenario.domain === "nuclear" && scenario.nuclear) {
        setNuclearInput({
          ...scenario.nuclear,
          populationDensity: familiarPlace?.density.peoplePerKm2 ?? scenario.nuclear.populationDensity,
        });
      }
      setHazardCenters((current) => ({ ...current, [scenario.domain]: { ...scenarioCenter } }));
    }
    if (familiarPlace) {
      setComparisonInspectCoordinate({ lat: familiarPlace.lat, lon: familiarPlace.lon });
      setInspectMode(true);
    }
    setDetonateNonces((current) => ({
      ...current,
      [scenario.domain]: current[scenario.domain] + 1,
    }));
    setInspectorTab("results");
    setRunJourney({ scenarioId: scenario.id, stage: canReuseResult ? "watch" : "calculate" });
    updateLibraryPreferences((current) => recordRecentScenario(current, scenario.id));
  }

  function createCustomScenario() {
    setRunJourney(null);
    changeWorkspaceMode("customize");
    setCustomEditorOpen(true);
    setLibraryPreview(null);
    setLibraryPreviewPending(false);
    selectHazardMode("tsunami");
    setInspectorTab("setup");
    window.requestAnimationFrame(() => {
      const editor = document.querySelector<HTMLElement>(".scenario-form");
      editor?.scrollIntoView({ block: "start", behavior: "smooth" });
      editor?.querySelector<HTMLElement>("button, input, select")?.focus();
    });
  }

  function loadHistoricalScenario(result: HistoricalScenarioImport) {
    setShowHistoricalBrowser(false);
    setRunJourney(null);
    changeWorkspaceMode("customize");
    setCustomEditorOpen(true);
    setLibraryPreview(null);
    setLibraryPreviewPending(false);
    selectHazardMode("tsunami");
    setInspectorTab("setup");
    setScenarioEditRequest({ id: Date.now(), ...result });
  }

  function detonateActiveHazard() {
    if (!directHazardMode) return;
    if (directHazardMode === "nuclear") {
      setWw3Session(null);
      setMirvPreview(null);
    }
    setDetonateNonces((current) => ({
      ...current,
      [directHazardMode]: current[directHazardMode] + 1,
    }));
  }

  function startComparisonStory(story: ComparisonStory, preservePresetId: string | null = null) {
    const reverse = preservePresetId === story.rightPresetId;
    const activePresetId = reverse ? story.rightPresetId : story.leftPresetId;
    setRunJourney(null);
    setLibraryPreview({ kind: "preset", presetId: activePresetId });
    setLibraryPreviewPending(false);
    setCustomEditorOpen(false);
    setPickMode(false);
    setInspectMode(false);
    setTimelinePlaying(false);
    setTimeS(story.focusTimeS);
    slotA.setActivePresetId(activePresetId);
    slotB.setActivePresetId(reverse ? story.leftPresetId : story.rightPresetId);
    setCompareMode(true);
    setInspectorTab("results");
  }

  function toggleComparisonMode() {
    if (compareMode) {
      setCompareMode(false);
      return;
    }
    startComparisonStory(comparisonStoryForPreset(slotA.activePresetId), slotA.activePresetId);
  }

  return (
    <div
      className="app"
      data-compare={compareMode ? "true" : "false"}
      data-domain={hazardMode}
      data-workspace-mode={workspaceMode}
      data-story-open={activeLesson ? "true" : "false"}
      data-reference-capture={referenceCaptureMode ? "true" : "false"}
      data-reference-direct-frame-ready={referenceCaptureMode && directRenderFrame ? referenceCaptureSceneId : undefined}
    >
      <a className="skip-link" href="#main-globe">{t("app.skipGlobe")}</a>
      {toast && (
        <div
          className="app-toast"
          data-tone={toast.tone}
          role={toast.tone === "error" ? "alert" : "status"}
          aria-live={toast.tone === "error" ? "assertive" : "polite"}
          aria-atomic="true"
        >
          <span>{toast.msg}</span>
          {toast.action && (
            <button
              className="app-toast__action"
              onClick={() => {
                const action = toast.action;
                setToast(null);
                action?.run();
              }}
              type="button"
            >
              {toast.action.label}
            </button>
          )}
          <button
            className="app-toast__dismiss"
            aria-label={t("app.dismissNotification")}
            onClick={() => setToast(null)}
            type="button"
          >
            <UiIcon name="close" size={14} />
          </button>
        </div>
      )}
      <div className="app__banner-stack">
        <CrashRecoveryNotice onInspect={() => setShowLog(true)} />
        {tokenBannerOpen && (
          <div className="token-banner" role="status" aria-live="polite">
            <span className="token-banner__icon" aria-hidden>
              <UiIcon name="info" size={14} />
            </span>
            <span>
              <strong>{t("app.mapBannerTitle")}</strong> {t("app.mapBannerBody")}
            </span>
            <button
              className="token-banner__action"
              onClick={() => setShowSettings(true)}
              type="button"
            >
              {t("app.configureMaps")}
            </button>
            <button
              className="token-banner__dismiss"
              aria-label={t("app.dismissMapNotice")}
              type="button"
              onClick={() => {
                setTokenBannerOpen(false);
                settings
                  .dismissTokenBanner()
                  .catch((err) => console.warn("[settings] failed to dismiss token banner", err));
              }}
            >
              <UiIcon name="close" size={14} />
            </button>
          </div>
        )}
      </div>
      <header className="app__header">
        <div className="app__brand">
          <span className="app__brand-mark" aria-hidden="true">
            <img src={cataclysmLogoUrl} alt="" />
          </span>
          <div className="app__brand-copy">
            <h1 className="app__title">Cataclysm</h1>
            <span className="app__tagline">{t("app.tagline")}</span>
          </div>
          <span className="app__version">v{APP_VERSION}</span>
        </div>
        <div className="app__warning">
          {t("app.safety")}
        </div>
        <div className="app__header-actions" aria-label={t("app.actions")}>
          <div className="app__command-group app__command-group--hazard" role="group" aria-label={t("app.hazardType")}>
            {(["tsunami", "asteroid", "nuclear"] as const).map((m) => (
              <button
                key={m}
                type="button"
                className="hazard-switch"
                data-active={hazardMode === m ? "true" : "false"}
                aria-pressed={hazardMode === m}
                onClick={() => selectHazardMode(m)}
                title={
                  m === "tsunami"
                    ? t("app.tsunamiModeTitle")
                    : m === "asteroid"
                      ? t("app.impactModeTitle")
                      : t("app.nuclearModeTitle")
                }
              >
                {m === "tsunami" ? t("app.tsunami") : m === "asteroid" ? t("app.impact") : t("app.nuclear")}
              </button>
            ))}
          </div>
          <div className="app__command-group app__command-group--modes" role="group" aria-label={t("app.analysisModes")}>
            <ToolbarButton
              icon="inspect"
              active={inspectMode}
              variant="mode"
              onClick={() => {
                setInspectMode((v) => !v);
                if (!inspectMode) {
                  setPickMode(false);
                  setTimelinePlaying(false);
                }
              }}
              title={t("app.inspectTitle")}
              disabled={inHazardMode ? !hazardResult?.resultId : !slotA.initial}
              disabledReason={inHazardMode
                ? t("app.inspectDirectReason")
                : sourceRequiredReason}
              onUnavailable={(reason) => showToast(reason, "info")}
            >
              {t("app.inspect")}
            </ToolbarButton>
            <ToolbarButton
              icon="compare"
              active={compareMode}
              variant="mode"
              onClick={toggleComparisonMode}
              title={t("app.compareTitle")}
              disabled={inHazardMode}
              disabledReason={t("app.compareReason")}
              onUnavailable={(reason) => showToast(reason, "info")}
            >
              {t("app.compare")}
            </ToolbarButton>
          </div>
          <div className="app__export-menu" ref={exportMenuRef}>
            <button
              ref={exportTriggerRef}
              type="button"
              className="app__export-trigger"
              aria-expanded={exportMenuOpen}
              aria-controls="export-actions"
              onClick={() => setExportMenuOpen((open) => !open)}
            >
              <ToolbarIcon name="image" />
              <span>{t("app.export")}</span>
              <UiIcon name="chevronDown" size={13} />
            </button>
            {exportMenuOpen && <div
              id="export-actions"
              className="app__export-panel"
              tabIndex={-1}
              autoFocus
              role="group"
              aria-label={t("app.exportCurrent")}
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("button")) {
                  window.setTimeout(() => {
                    setExportMenuOpen(false);
                    window.requestAnimationFrame(() => exportTriggerRef.current?.focus());
                  }, 0);
                }
              }}
            >
            <ExportGroup
              id="image"
              label={t("app.export.image")}
              description={t("app.export.imageDescription")}
            >
            <ToolbarButton
              icon="image"
              onClick={() => {
                const run = () => reportExportResult(
                  exportGlobePng(exportMetaA()),
                  t("app.export.saved", { item: t("app.export.item.globePng") }),
                  run,
                );
                run();
              }}
              title={t("app.export.title.png")}
              disabled={inHazardMode ? !hazardResult : !slotA.initial}
              disabledReason={inHazardMode ? directExportRequiredReason : sourceRequiredReason}
              onUnavailable={(reason) => showToast(reason, "info")}
            >
              PNG
            </ToolbarButton>
            {compareMode && (
              <ToolbarButton
                icon="compare"
                onClick={() => {
                  const run = () => reportExportResult(
                    exportComparisonPng({
                      metaA: exportMetaA(),
                      metaB: exportMetaB(),
                      labelA: activePresetA?.name ?? t("app.slotA"),
                      labelB: activePresetB?.name ?? t("app.slotB"),
                      storyTitle: activeComparisonStory?.title,
                      storySummary: comparisonMetricLines(activeComparisonMetrics),
                    }),
                    t("app.export.saved", { item: t("app.export.item.comparisonPng") }),
                    run,
                  );
                  run();
                }}
                title={t("app.export.title.comparison")}
                disabled={!slotA.initial || !slotB.initial}
                disabledReason={t("app.export.reason.bothSlots")}
                onUnavailable={(reason) => showToast(reason, "info")}
              >
                {t("app.export.compare")}
              </ToolbarButton>
            )}
            </ExportGroup>
            <ExportGroup
              id="share"
              label={t("app.export.share")}
              description={t("app.export.shareDescription")}
            >
            <ToolbarButton
              icon="share"
              onClick={() => {
                const run = () => reportExportResult(
                  exportGlobeShareCard(exportMetaA()),
                  t("app.export.saved", { item: t("app.export.item.shareCard") }),
                  run,
                );
                run();
              }}
              title={t("app.export.title.share")}
              disabled={inHazardMode ? !hazardResult : !slotA.initial}
              disabledReason={inHazardMode ? directExportRequiredReason : sourceRequiredReason}
              onUnavailable={(reason) => showToast(reason, "info")}
            >
              {t("app.export.share")}
            </ToolbarButton>
            <ToolbarButton
              icon="link"
              onClick={() => {
                const params = scenarioToUrlParams(slotA.activePresetId, slotA.lastCustomScenario);
                if (!params) {
                  showToast(t("app.export.reason.shareLink"), "info");
                  return;
                }
                const url = `${window.location.origin}${window.location.pathname}${params}`;
                const run = async () => reportExportResult(
                  await copyExportText(url),
                  t("app.export.linkCopied"),
                  () => void run(),
                );
                void run();
              }}
              title={t("app.export.title.link")}
              disabled={inHazardMode || (!slotA.activePresetId && !slotA.lastCustomScenario)}
              disabledReason={sourceRequiredReason}
              onUnavailable={(reason) => showToast(reason, "info")}
            >
              {t("app.export.link")}
            </ToolbarButton>
            </ExportGroup>
            <ExportGroup
              id="replay"
              label={t("app.export.replay")}
              description={t("app.export.replayDescription")}
            >
            <ToolbarButton
              icon="video"
              onClick={() => {
                const run = async () => {
                  if (recording) return;
                  setRecording(true);
                  try {
                    const result = await exportGlobeVideo(
                      exportMetaA(),
                      { fps: 30, durationMs: 6_000, bitsPerSecond: 6_000_000 },
                    );
                    reportExportResult(
                      result,
                      t("app.export.saved", { item: t("app.export.item.recording") }),
                      () => void run(),
                    );
                  } finally {
                    setRecording(false);
                  }
                };
                void run();
              }}
              title={t("app.export.title.video")}
              disabled={inHazardMode || !slotA.initial || recording}
              disabledReason={recording ? t("app.export.reason.recording") : sourceRequiredReason}
              onUnavailable={(reason) => showToast(reason, "info")}
            >
              {recording ? t("app.export.recording") : t("app.export.video")}
            </ToolbarButton>
            </ExportGroup>
            <ExportGroup
              id="data"
              label={t("app.export.data")}
              description={t("app.export.dataDescription")}
            >
            <ToolbarButton
              icon="text"
              onClick={() => {
                const run = () => reportExportResult(
                  downloadTextExport({
                    ...exportMetaA(),
                    runupResults: slotA.runupResults,
                    sourceKind: activeScenarioKindA,
                  }),
                  t("app.export.saved", { item: t("app.export.item.textResults") }),
                  run,
                );
                run();
              }}
              title={t("app.export.title.text")}
              disabled={inHazardMode || !slotA.initial}
              disabledReason={sourceRequiredReason}
              onUnavailable={(reason) => showToast(reason, "info")}
            >
              {t("app.export.text")}
            </ToolbarButton>
            <ToolbarButton
              icon="czml"
              onClick={() => {
                if (directExportData || (sweSnapshots && sweSnapshots.length > 0)) {
                  const run = () => reportExportResult(
                    exportCzml(exportMetaA(), sweSnapshots ?? [], directExportData),
                    t("app.export.saved", {
                      item: t(directExportData ? "app.export.item.directCzml" : "app.export.item.czml"),
                    }),
                    run,
                  );
                  run();
                } else {
                  showToast(t("app.export.czmlRunFirst"), "error");
                }
              }}
              title={t(inHazardMode ? "app.export.title.directCzml" : "app.export.title.czml")}
              disabled={inHazardMode ? !directExportData : !sweSnapshots || sweSnapshots.length === 0}
              disabledReason={inHazardMode ? directExportRequiredReason : snapshotsRequiredReason}
              onUnavailable={(reason) => showToast(reason, "info")}
            >
              CZML
            </ToolbarButton>
            <ToolbarButton
              icon="netcdf"
              onClick={() => {
                if (!sweScientificExport) return;
                const run = async () => reportExportResult(
                  await exportScientificNetcdf(sweScientificExport),
                  t("app.export.saved", { item: t("app.export.item.netcdf") }),
                  () => void run(),
                );
                void run();
              }}
              title={t("app.export.title.netcdf")}
              disabled={inHazardMode || !inTauri || !sweScientificExport}
              disabledReason={inHazardMode
                ? t("app.export.reason.netcdfSwe")
                : !inTauri
                  ? t("app.export.reason.netcdfDesktop")
                  : sweScientificExportError ?? t("app.export.reason.netcdfRun")}
              onUnavailable={(reason) => showToast(reason, "info")}
            >
              NetCDF
            </ToolbarButton>
            <ToolbarButton
              icon="zarr"
              onClick={() => {
                if (!sweScientificExport?.zarr) return;
                const run = async () => reportExportResult(
                  await exportScientificZarr(sweScientificExport),
                  t("app.export.saved", { item: t("app.export.item.zarr") }),
                  () => void run(),
                );
                void run();
              }}
              title={t("app.export.title.zarr")}
              disabled={inHazardMode || !inTauri || !sweScientificExport?.zarr}
              disabledReason={inHazardMode
                ? t("app.export.reason.zarrSwe")
                : !inTauri
                  ? t("app.export.reason.zarrDesktop")
                  : sweScientificExport?.zarr_error ?? sweScientificExportError ?? t("app.export.reason.zarrRun")}
              onUnavailable={(reason) => showToast(reason, "info")}
            >
              Zarr
            </ToolbarButton>
            <ToolbarButton
              icon="geojson"
              onClick={() => {
                const points: RunupPoint[] = slotA.runupResults.map((r) => ({
                  id: r.id,
                  name: r.name,
                  lat: r.lat,
                  lon: r.lon,
                  runup_m: r.runup_m,
                  arrival_time_s: r.arrival_time_s,
                  inundation_extent_m: r.inundation_extent_m,
                  offshore_amplitude_m: r.offshore_amplitude_m,
                  beach_slope_deg: r.beach_slope_deg,
                  offshore_depth_m: r.offshore_depth_m,
                  slope_provenance: r.slope_provenance,
                  depth_provenance: r.depth_provenance,
                  quantitative_confidence: r.quantitative_confidence,
                  quantitative_label: r.quantitative_label,
                }));
                const run = () => reportExportResult(
                  exportGeoJson(points, exportMetaA(), sweMaxField?.isochrones ?? null, directExportData),
                  t("app.export.saved", {
                    item: t(directExportData ? "app.export.item.directGeojson" : "app.export.item.geojson"),
                  }),
                  run,
                );
                run();
              }}
              title={t(inHazardMode ? "app.export.title.directGeojson" : "app.export.title.geojson")}
              disabled={inHazardMode ? !directExportData : slotA.runupResults.length === 0}
              disabledReason={inHazardMode ? directExportRequiredReason : runupRequiredReason}
              onUnavailable={(reason) => showToast(reason, "info")}
            >
              GeoJSON
            </ToolbarButton>
            <ToolbarButton
              icon="kml"
              onClick={() => {
                const points: RunupPoint[] = slotA.runupResults.map((r) => ({
                  id: r.id,
                  name: r.name,
                  lat: r.lat,
                  lon: r.lon,
                  runup_m: r.runup_m,
                  arrival_time_s: r.arrival_time_s,
                  inundation_extent_m: r.inundation_extent_m,
                  offshore_amplitude_m: r.offshore_amplitude_m,
                  beach_slope_deg: r.beach_slope_deg,
                  offshore_depth_m: r.offshore_depth_m,
                  slope_provenance: r.slope_provenance,
                  depth_provenance: r.depth_provenance,
                  quantitative_confidence: r.quantitative_confidence,
                  quantitative_label: r.quantitative_label,
                }));
                const run = () => reportExportResult(
                  exportKml(exportMetaA(), points, directExportData),
                  t("app.export.saved", {
                    item: t(directExportData ? "app.export.item.directKml" : "app.export.item.kml"),
                  }),
                  run,
                );
                run();
              }}
              title={t(inHazardMode ? "app.export.title.directKml" : "app.export.title.kml")}
              disabled={inHazardMode ? !directExportData : !slotA.initial}
              disabledReason={inHazardMode ? directExportRequiredReason : sourceRequiredReason}
              onUnavailable={(reason) => showToast(reason, "info")}
            >
              KML
            </ToolbarButton>
            </ExportGroup>
            </div>}
          </div>
          <div className="app__command-group app__command-group--utility" role="group" aria-label={t("app.preferences")}>
            <ToolbarButton icon="citations" variant="utility" onClick={() => setShowCitations(true)} title={t("app.referencesTitle")}>
              {t("app.references")}
            </ToolbarButton>
            <ToolbarButton icon="settings" variant="utility" onClick={() => setShowSettings(true)} title={t("app.settings")}>
              {t("app.settings")}
            </ToolbarButton>
          </div>
        </div>
      </header>

      <aside
        className="app__panel"
        aria-label={inHazardMode ? t("app.directWorkspace") : t("app.presetScenarios")}
        inert={exportMenuOpen ? true : undefined}
      >
        {presetsResult.status === "loading" && (
          <div className="empty-state empty-state--compact" role="status" aria-live="polite">
            <span className="empty-state__icon" aria-hidden />
            <div><strong>{presetsResult.previous ? t("app.refreshingLibrary") : t("app.loadingLibrary")}</strong><p>{presetsResult.previous ? t("app.currentAvailable") : t("app.preparingLibrary")}</p></div>
          </div>
        )}
        {presetsResult.status === "empty" && (
          <div className="empty-state empty-state--compact" role="status">
            <span className="empty-state__icon" aria-hidden />
            <div><strong>{t("app.emptyCatalog")}</strong><p>{t("app.whatIfAvailable")}</p></div>
          </div>
        )}
        {(presetsResult.status === "error" || presetsResult.status === "stale") && (
          <div className="panel-error" role="alert">
            <span>
              {presetsResult.status === "stale" ? t("app.catalogStale") : t("app.loadFailed")}
              {presetsResult.error}
            </span>
            <button type="button" onClick={loadPresets}>{t("app.retryPresets")}</button>
          </div>
        )}
        {!inHazardMode && compareMode && (
          <ComparisonStories
            presets={presets}
            activePresetAId={slotA.activePresetId}
            activePresetBId={slotB.activePresetId}
            initialA={slotA.initial}
            initialB={slotB.initial}
            busy={slotA.busyPresetId !== null || slotB.busyPresetId !== null}
            onSelectStory={(story) => startComparisonStory(story)}
            onSelectCustomB={(presetId) => {
              setTimelinePlaying(false);
              slotB.setActivePresetId(presetId);
            }}
            error={slotB.sourceResult.status === "error" || slotB.sourceResult.status === "stale" ? slotB.sourceResult.error : null}
            stale={slotB.sourceResult.status === "stale"}
            onRetry={slotB.retrySource}
          />
        )}
        <PresetSelector
            presets={presets}
            activeId={libraryPreview?.kind === "preset" ? libraryPreview.presetId : null}
            activeDirectId={libraryPreview?.kind === "direct" ? libraryPreview.scenario.id : null}
            onSelect={previewPreset}
            directScenarios={DIRECT_SCENARIOS}
            onSelectDirect={previewDirectScenario}
            onCreateScenario={createCustomScenario}
            onBrowseHistorical={() => setShowHistoricalBrowser(true)}
            onRunActive={runLibraryPreview}
            recentIds={libraryPreferences.recentIds}
            favoriteIds={libraryPreferences.favoriteIds}
            onToggleFavorite={(id) => updateLibraryPreferences((current) => toggleFavoriteScenario(current, id))}
            onSelectFamiliarPlace={(place) => handleLocationSelect(place, true)}
            busyId={slotA.busyPresetId}
            onStartLesson={startGuidedLesson}
            completedLessons={lessonCompletions}
          />
        {inHazardMode && (
          <div className="app__domain-summary" role="status" aria-live="polite">
            <span>{t("app.directSummary")}</span>
            <strong>{activeWorkspaceLabel}</strong>
            <p>{t("app.directSummaryBody")}</p>
          </div>
        )}
        <div className="footer-note">
          <span>{t("app.footerNote")}</span>
          <button type="button" onClick={() => setShowCitations(true)}>{t("app.bibliography")}</button>
          <button type="button" onClick={() => setShowLog(true)}>{t("app.diagnostics")}</button>
          <button type="button" onClick={() => setShowPerfPanel((v) => !v)}>{t("app.performance")}</button>
        </div>
      </aside>

      <main
        className="app__globe"
        id="main-globe"
        tabIndex={-1}
        aria-label={t("app.interactiveGlobe")}
        inert={exportMenuOpen ? true : undefined}
      >
        <Suspense
          fallback={
            <div className="app__globe-empty">
              <div className="loading-orbit" aria-hidden />
              <h2>{t("app.preparingGlobe")}</h2>
              <p>{t("app.loadingGlobe")}</p>
            </div>
          }
        >
          <div className="app__globe-stack" data-split={compareMode ? "true" : "false"}>
            <div className="app__globe-pane">
              <Globe
                domain={hazardMode}
                initial={inHazardMode ? null : slotA.initial}
                wavefront={inHazardMode ? null : slotA.wavefront}
                sweSnapshot={inHazardMode ? null : slotA.sweSnapshot}
                runupResults={inHazardMode ? [] : slotA.runupResults}
                gauges={inHazardMode ? [] : sweGaugesA}
                dartBuoys={inHazardMode ? [] : dartPinsForPreset(slotA.activePresetId)}
                humanitarianFacilities={!inHazardMode && humanitarianFacilitiesEnabled
                  ? humanitarianFacilities.state.facilities
                  : []}
                pickMode={pickMode}
                onPick={handlePickGlobe}
                onPickCancel={() => setPickMode(false)}
                inspectMode={inspectMode}
                inspectIsImpact={activeScenarioKindA === "Asteroid"}
                inspectTimeS={timeS}
                directHazardResultId={inHazardMode ? hazardResult?.resultId ?? null : null}
                inspectionCoordinate={comparisonInspectCoordinate}
                onInspectionCoordinate={compareMode ? (coordinate) => {
                  setComparisonInspectCoordinate((current) =>
                    current?.lat === coordinate.lat && current.lon === coordinate.lon
                      ? current
                      : coordinate,
                  );
                } : undefined}
                onInspectionReport={setPointProbeA}
                onInspectCancel={() => setInspectMode(false)}
                onAddGauge={inHazardMode ? undefined : (lat, lon) => setPendingGauge({ lat, lon })}
                isochrones={inHazardMode ? null : sweIsochrones}
                hazardRings={inHazardMode ? hazardResult?.rings ?? null : null}
                hazardCenter={inHazardMode ? hazardCenter : null}
                hazardPolygons={hazardPolygons}
                fireballs={hazardMode === "asteroid" && showFireballs ? fireballFeed.events : []}
                ww3Plan={hazardMode === "nuclear" ? ww3Session?.plan ?? null : null}
                mirvPreview={hazardMode === "nuclear" ? mirvPreview : null}
                impactKind={hazardMode === "asteroid" ? "asteroid" : hazardMode === "nuclear" ? "nuclear" : null}
                directRenderFrame={directRenderFrame}
                previewCamera={comparisonCameraA ?? (libraryPreviewPending ? libraryPreviewCamera : null)}
                previewLabel={libraryPreviewPending ? libraryPreviewLabel : null}
                onCameraTelemetry={handleCameraTelemetry}
                accessibleSceneLabel={viewportSourceLabel}
                simulationTimeS={timeS}
                accessibleCameraTelemetry={cameraTelemetry}
                outcomeFocus={inHazardMode ? null : outcomeFocus}
                onOutcomeFocusTime={setTimeS}
              />
              {compareMode && <div className="app__globe-tag">{t("app.slotA")}</div>}
            </div>
            {compareMode && (
              <div className="app__globe-pane">
                <Globe
                  domain="tsunami"
                  initial={slotB.initial}
                  wavefront={slotB.wavefront}
                  sweSnapshot={slotB.sweSnapshot}
                  runupResults={slotB.runupResults}
                  gauges={sweGaugesB}
                  dartBuoys={dartPinsForPreset(slotB.activePresetId)}
                  directRenderFrame={null}
                  inspectMode={inspectMode}
                  inspectIsImpact={activeScenarioKindB === "Asteroid"}
                  inspectTimeS={timeS}
                  inspectionCoordinate={comparisonInspectCoordinate}
                  onInspectionCoordinate={(coordinate) => {
                    setComparisonInspectCoordinate((current) =>
                      current?.lat === coordinate.lat && current.lon === coordinate.lon
                        ? current
                        : coordinate,
                    );
                  }}
                  onInspectionReport={setPointProbeB}
                  onInspectCancel={() => setInspectMode(false)}
                  primary={false}
                  previewCamera={comparisonCameraB}
                  accessibleSceneLabel={t("app.comparisonScene", {
                    slot: t("app.slotB"),
                    source: activePresetB?.name ?? slotB.initial?.label ?? t("layers.noSource"),
                  })}
                  simulationTimeS={timeS}
                />
                <div className="app__globe-tag" data-slot="b">{t("app.slotB")}</div>
              </div>
            )}
          </div>
        </Suspense>
        {hazardMode === "nuclear" && ww3Session && <WW3ExchangeHud session={ww3Session} />}
        <div className="app__viewport-hud app__viewport-hud--source" aria-label={t("app.scenarioTimeAria", { minutes: Math.round(timeS / 60) })}>
          <div className="app__viewport-time">
            <span aria-hidden="true">◷</span>
            <strong>{t("app.timeMinutes", { minutes: formatNumber(Math.round(timeS / 60)) })}</strong>
          </div>
          <small>{t("app.scenarioTime")}</small>
          <span className="app__viewport-source-name">{viewportSourceLabel}</span>
          {inHazardMode && hazardCenter && <strong>{formatNumber(hazardCenter.lat, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}°, {formatNumber(hazardCenter.lon, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}°</strong>}
          {!inHazardMode && slotA.initial && <strong>{formatNumber(slotA.initial.center.lat_deg, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}°, {formatNumber(slotA.initial.center.lon_deg, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}°</strong>}
        </div>
        <button className="app__viewport-layers" type="button" onClick={() => setInspectorTab("layers")} aria-label={t("app.openLayers")}>
          {t("app.layers")}
          <UiIcon name="chevronDown" size={13} />
        </button>
        <div className="app__viewport-legend" data-visible={!inHazardMode && slotA.initial ? "true" : "false"} aria-label={t("app.surfaceLegend", { colormap: legendColormap })}>
          <span className="app__viewport-instrument-label">{t("app.surfaceDisplacement")}</span>
          <div
            className="app__viewport-legend-ramp"
            data-colormap={legendColormap}
            aria-hidden
          />
          <div className="app__viewport-legend-scale" aria-hidden>
            {colormapLegend(legendColormap).scale.map((label, i) => (
              <span key={i}>{label}</span>
            ))}
          </div>
          <small>{colormapLegend(legendColormap).caption}</small>
        </div>
        <div className="app__viewport-telemetry" aria-label={t("app.viewportTelemetry")}>
          <svg className="app__viewport-north" viewBox="0 0 36 36" aria-hidden>
            <g transform={`rotate(${-cameraTelemetry.headingDeg} 18 18)`}>
              <text x="18" y="9">{t("app.direction.northShort")}</text>
              <path d="M18 11 L13 25 L18 22 L23 25 Z" />
            </g>
          </svg>
          <div>
            <span className="app__viewport-instrument-label">{t("app.camera")}</span>
            <strong>{t("app.altitude", { value: cameraTelemetry.altitudeM >= 1_000_000 ? `${formatNumber(cameraTelemetry.altitudeM / 1_000_000, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Mm` : `${formatNumber(cameraTelemetry.altitudeM / 1000, { maximumFractionDigits: 0 })} km` })}</strong>
            <small>{t("app.cameraCoordinates", {
              lat: formatNumber(Math.abs(cameraTelemetry.lat), { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
              latDirection: t(cameraTelemetry.lat >= 0 ? "app.direction.northShort" : "app.direction.southShort"),
              lon: formatNumber(Math.abs(cameraTelemetry.lon), { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
              lonDirection: t(cameraTelemetry.lon >= 0 ? "app.direction.eastShort" : "app.direction.westShort"),
            })}</small>
          </div>
        </div>
      </main>

      <aside
        className="app__panel app__panel--right"
        aria-label={t("app.panelLabel")}
        inert={exportMenuOpen ? true : undefined}
      >
        <div className="inspector__header">
          <div className="inspector__identity">
            <span>{t("app.activeWorkspace")}</span>
            <strong>{activeWorkspaceLabel}</strong>
          </div>
          {inspectorTab === "setup" && <div className="workspace-mode" role="group" aria-label={t("app.workspaceDetail")}>
            {(["simple", "customize", "advanced"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={workspaceMode === mode}
                data-active={workspaceMode === mode ? "true" : undefined}
                onClick={() => changeWorkspaceMode(mode)}
              >
                {mode === "simple" ? t("app.simple") : mode === "customize" ? t("app.customize") : t("app.advanced")}
              </button>
            ))}
          </div>}
          <div className="inspector__tabs" role="tablist" aria-label={t("app.inspector")}>
            {(["setup", "results", "layers"] as const).map((tab) => (
              <button
                id={`inspector-tab-${tab}`}
                key={tab}
                type="button"
                role="tab"
                aria-selected={inspectorTab === tab}
                aria-controls="inspector-panel"
                tabIndex={inspectorTab === tab ? 0 : -1}
                data-active={inspectorTab === tab ? "true" : "false"}
                data-tab={tab}
                onClick={() => setInspectorTab(tab)}
                onKeyDown={(event) => {
                  const tabs = ["setup", "results", "layers"] as const;
                  const currentIndex = tabs.indexOf(tab);
                  let nextIndex: number | null = null;
                  if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
                  if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
                  if (event.key === "Home") nextIndex = 0;
                  if (event.key === "End") nextIndex = tabs.length - 1;
                  if (nextIndex === null) return;
                  event.preventDefault();
                  const next = tabs[nextIndex];
                  setInspectorTab(next);
                  event.currentTarget.parentElement
                    ?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)
                    ?.focus();
                }}
              >
                {tab === "setup" ? t("app.setup") : tab === "results" ? t("app.results") : t("app.layersTab")}
              </button>
            ))}
          </div>
        </div>
        {runJourney && (
          <JourneyProgress
            journey={runJourney}
            onManual={() => {
              setRunJourney(null);
              setTimelinePlaying(false);
              changeWorkspaceMode("customize");
              setInspectorTab("setup");
            }}
          />
        )}
        <div ref={inspectorBodyRef} className="inspector__body" id="inspector-panel" role="tabpanel" aria-labelledby={`inspector-tab-${inspectorTab}`}>
        {inspectorTab === "setup" && inHazardMode && (
          <>
          <HazardControls
            mode={hazardMode === "nuclear" ? "nuclear" : "asteroid"}
            nuclear={nuclearInput}
            asteroid={asteroidInput}
            onNuclearChange={setNuclearInput}
            onAsteroidChange={setAsteroidInput}
            center={hazardCenter}
            onTogglePick={() => setPickMode((p) => !p)}
            onLocationSelect={handleLocationSelect}
            pickActive={pickMode}
            result={hazardResult}
            asteroidVisuals={asteroidVisualReport}
            shelterReport={nuclearShelterReport}
            showFireballs={showFireballs}
            fireballCount={fireballFeed.events.length}
            fireballsLoading={fireballFeed.loading}
            fireballNotice={fireballFeed.notice}
            onToggleFireballs={() => setShowFireballs((shown) => !shown)}
            windFromDeg={windFromDeg}
            onWindChange={setWindFromDeg}
            onDetonate={() => {
              detonateActiveHazard();
              setInspectorTab("results");
            }}
            backendAvailable={inTauri}
            display="setup"
            pending={hazardPending}
            error={hazardError}
            canAnimate={Boolean(directRenderReplay)}
            workspaceMode={referenceCaptureMode ? "advanced" : workspaceMode}
          />
          {hazardMode === "nuclear" && !ww3Session && (
            <MIRVPatternPanel
              center={hazardCenter}
              preview={mirvPreview}
              onPreviewChange={handleMirvPreviewChange}
              onApplyYield={(yieldKt) => setNuclearInput((current) => ({ ...current, yieldKt }))}
            />
          )}
          {hazardMode === "nuclear" && (
            <WW3ExchangePanel
              session={ww3Session}
              onStart={(plan, speed) => {
                setMirvPreview(null);
                setHazardResult(null);
                setDirectRenderFrame(null);
                setDirectRenderReplay(null);
                setWw3Session({
                  plan,
                  speed,
                  elapsedMs: 0,
                  visibleStrikeCount: 0,
                  state: "running",
                });
              }}
              onPause={() => setWw3Session((current) => current ? { ...current, state: "paused" } : null)}
              onResume={() => setWw3Session((current) => current ? { ...current, state: "running" } : null)}
              onStop={() => setWw3Session(null)}
            />
          )}
          </>
        )}
        <div hidden={inspectorTab !== "setup" || inHazardMode}>
          {slotA.sourceResult.status === "loading" && !slotA.sourceResult.previous && (
            <div className="empty-state empty-state--compact" role="status">
              <span className="empty-state__icon" aria-hidden />
              <div><strong>{t("app.computingSource")}</strong><p>{t("app.computingSourceBody")}</p></div>
            </div>
          )}
          {(slotA.sourceResult.status === "error" || slotA.sourceResult.status === "stale") && (
            <div className="panel-error" role="alert">
              <span>{slotA.sourceResult.status === "stale" ? t("app.staleSource") : t("app.sourceFailed")}{slotA.sourceResult.error}</span>
              <button type="button" onClick={slotA.retrySource}>{t("app.retrySource")}</button>
            </div>
          )}
          <SourceModelSummary
            preset={activePresetA ?? null}
            initial={slotA.initial}
            onEdit={compareMode ? undefined : () => {
              const scenario = activePresetA?.source ?? slotA.lastCustomScenario;
              if (!scenario) return;
              changeWorkspaceMode("customize");
              setCustomEditorOpen(true);
              setScenarioEditRequest({ id: Date.now(), scenario });
              window.requestAnimationFrame(() => {
                const editor = document.querySelector<HTMLElement>(".scenario-form");
                editor?.scrollIntoView({ block: "start", behavior: "smooth" });
                editor?.querySelector<HTMLElement>("button, input, select")?.focus();
              });
            }}
          />
          <SwePlayback
            initial={slotA.initial}
            onSnapshot={slotA.setSweSnapshot}
            onSnapshotsReady={handleSweSnapshotsReady}
            onGaugesChange={setSweGaugesA}
            onColormap={setLegendColormap}
            pendingGauge={pendingGauge}
            dartBuoys={getDartBuoysForPreset(slotA.activePresetId)}
            onMaxField={setSweMaxField}
            onScientificExport={handleScientificExport}
            onRunQuality={setSweRunQualityA}
            onIsochrones={setSweIsochrones}
            onRenderFrame={setSweRenderFrameA}
            playbackTimeS={timeS}
            onPlaybackTimeChange={setTimeS}
            slotLabel={compareMode ? t("app.slotA") : undefined}
            runAndWatchNonce={sweRunAndWatchNonce}
            workspaceMode={referenceCaptureMode ? "advanced" : workspaceMode}
          />
          <div hidden={!compareMode} aria-label={t("app.comparisonSolver", { slot: t("app.slotB") })}>
            <SwePlayback initial={slotB.initial} onSnapshot={slotB.setSweSnapshot} onGaugesChange={setSweGaugesB} onRunQuality={setSweRunQualityB} onRenderFrame={setSweRenderFrameB} playbackTimeS={timeS} onPlaybackTimeChange={setTimeS} slotLabel={t("app.slotB")} />
          </div>
          <div hidden={compareMode || !customEditorOpen || workspaceMode === "simple"}>
            <ScenarioBuilder
            editRequest={scenarioEditRequest}
            onSimulate={(scenario) => {
              slotA.simulate(scenario);
              setInspectorTab("results");
            }}
            pickedLocation={pickedLocation}
            onTogglePick={() => setPickMode((p) => !p)}
            pickActive={pickMode}
            />
          </div>
        </div>
        {inspectorTab === "results" && familiarPlace && (
          <FamiliarPlacePanel
            place={familiarPlace}
            report={familiarPlaceReport}
            mode={hazardMode}
            sourceLabel={inHazardMode ? activeDirectScenario?.name ?? directWorkspaceLabel : activeSourceLabel}
            historicalSource={Boolean(activePresetA && !activePresetA.is_speculative)}
            pending={inHazardMode ? hazardPending : Boolean(slotA.initial && inspectMode && !familiarPlaceReport)}
            onClear={clearFamiliarPlace}
          />
        )}
        {inspectorTab === "results" && inHazardMode && <HazardControls
          mode={hazardMode === "nuclear" ? "nuclear" : "asteroid"}
          nuclear={nuclearInput}
          asteroid={asteroidInput}
          onNuclearChange={setNuclearInput}
          onAsteroidChange={setAsteroidInput}
          center={hazardCenter}
          onTogglePick={() => setPickMode((p) => !p)}
          pickActive={pickMode}
          result={hazardResult}
          asteroidVisuals={asteroidVisualReport}
          shelterReport={nuclearShelterReport}
          showFireballs={showFireballs}
          fireballCount={fireballFeed.events.length}
          fireballsLoading={fireballFeed.loading}
          fireballNotice={fireballFeed.notice}
          onToggleFireballs={() => setShowFireballs((shown) => !shown)}
          windFromDeg={windFromDeg}
          onWindChange={setWindFromDeg}
          onDetonate={detonateActiveHazard}
          backendAvailable={inTauri}
          display="results"
          pending={hazardPending}
          error={hazardError}
          canAnimate={Boolean(directRenderReplay)}
          workspaceMode={referenceCaptureMode ? "advanced" : workspaceMode}
        />}
        {inspectorTab === "results" && !inHazardMode && <ResultsPanel
          initial={slotA.initial}
          preset={activePresetA}
          timeS={timeS}
          onTimeChange={setTimeS}
          showTimeline={false}
          sourceKind={activeScenarioKindA}
          runupResults={slotA.runupResults}
          runupResult={slotA.runupResult}
          onRetryRunup={slotA.retryRunup}
          onFocusOutcome={handleOutcomeFocus}
          scienceContent={<AttenuationChart
            initial={slotA.initial}
            isImpact={activeScenarioKindA === "Asteroid"}
            timeS={timeS}
            runupResults={slotA.runupResults}
            movingPressure={activeScenarioKindA === "Meteotsunami"}
          />}
          validationContent={<DartOverlay
            presetId={slotA.activePresetId}
            timeS={timeS}
            sweSnapshots={sweSnapshots}
          />}
        />}
        {inspectorTab === "results" && compareMode && (
          <div className="app__compare-rail">
            <div className="app__compare-rail-label">{t("app.comparisonReadout", { slot: t("app.slotB") })}</div>
            <ResultsPanel
              initial={slotB.initial}
              preset={activePresetB}
              timeS={timeS}
              onTimeChange={setTimeS}
              showTimeline={false}
              sourceKind={activeScenarioKindB}
              runupResults={slotB.runupResults}
              runupResult={slotB.runupResult}
              onRetryRunup={slotB.retryRunup}
              scienceContent={<AttenuationChart
                initial={slotB.initial}
                isImpact={activeScenarioKindB === "Asteroid"}
                timeS={timeS}
                runupResults={slotB.runupResults}
                movingPressure={activeScenarioKindB === "Meteotsunami"}
              />}
              validationContent={<DartOverlay
                presetId={slotB.activePresetId}
                timeS={timeS}
                sweSnapshots={null}
              />}
            />
          </div>
        )}
        {inspectorTab === "results" && (!familiarPlace || compareMode) && (
          <PointProbePanel
            primary={pointProbeA}
            comparison={compareMode
              && pointProbeB
              && pointProbeA?.lat === pointProbeB.lat
              && pointProbeA.lon === pointProbeB.lon
              ? pointProbeB
              : null}
          />
        )}
        {inspectorTab === "layers" && <LayerInspector
          domain={hazardMode}
          hasSource={inHazardMode ? Boolean(hazardResult) : Boolean(slotA.initial)}
          hasWavefront={!inHazardMode && Boolean(slotA.wavefront)}
          hasSweField={!inHazardMode && Boolean(slotA.sweSnapshot)}
          hasMaxField={!inHazardMode && Boolean(sweMaxField)}
          arrivalCount={inHazardMode ? 0 : sweIsochrones?.length ?? 0}
          runupCount={inHazardMode ? 0 : slotA.runupResults.length}
          dartCount={inHazardMode ? 0 : dartPinsForPreset(slotA.activePresetId).length}
          hasFallout={Boolean(hazardPolygons?.length)}
          preset={layerEvidencePresetA}
          initial={slotA.initial}
          sourceKind={activeScenarioKindA}
          directResult={hazardResult}
          humanitarianEnabled={humanitarianFacilitiesEnabled}
          humanitarianState={humanitarianFacilities.state}
          onHumanitarianEnabledChange={setHumanitarianFacilitiesEnabled}
          onRefreshHumanitarian={humanitarianFacilities.refresh}
          onOpenSettings={() => setShowSettings(true)}
        />}
        </div>
      </aside>

      {!inHazardMode && <CoastalRunupOverlay
        initial={slotA.initial}
        activePreset={activePresetA}
        sourceKind={activeScenarioKindA}
        timeS={timeS}
        result={slotA.runupResult}
        onResult={slotA.setRunupResult}
        retryNonce={slotA.runupRetryNonce}
      />}
      {!inHazardMode && compareMode && (
        <CoastalRunupOverlay
          initial={slotB.initial}
          activePreset={activePresetB}
          sourceKind={activeScenarioKindB}
          timeS={timeS}
          result={slotB.runupResult}
          onResult={slotB.setRunupResult}
          retryNonce={slotB.runupRetryNonce}
        />
      )}
      {showCitations && <CitationsModal presets={presets} onClose={() => setShowCitations(false)} />}
      {showHistoricalBrowser && (
        <HistoricalTsunamiBrowser
          onClose={() => setShowHistoricalBrowser(false)}
          onLoad={loadHistoricalScenario}
        />
      )}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      <LogViewer open={showLog} onClose={() => setShowLog(false)} />
      <PerformancePanel visible={showPerfPanel} />
      <LaunchExperience />
      <FirstRunDisclaimer />
      <Tour
        open={tourOpen}
        onClose={() => {
          setTourOpen(false);
          settings
            .markTourCompleted()
            .catch((err) => console.warn("[tour] failed to persist tour completion", err));
        }}
      />
      {activeLesson && (
        <GuidedLesson
          lesson={activeLesson}
          onClose={() => setActiveLesson(null)}
          onComplete={markLessonComplete}
          onCue={handleGuidedStoryCue}
        />
      )}
      <SimulationTransport
        timeS={timeS}
        onTimeChange={setTimeS}
        playing={timelinePlaying}
        onTogglePlaying={() => setTimelinePlaying((playing) => !playing)}
        rate={timelineRate}
        onRateChange={setTimelineRate}
        hasSource={inHazardMode ? Boolean(hazardResult) : Boolean(slotA.initial)}
        sourceLabel={activeWorkspaceLabel}
        solverReady={!inHazardMode && hasSwePlayback}
        domain={hazardMode}
        frameCount={inHazardMode ? 0 : sweSnapshots?.length ?? 0}
        durationS={timelineDurationS}
        onOpenDetails={() => setInspectorTab("setup")}
      />
      <div className="app__statusbar" role="status" aria-live="polite">
        <div className="statusbar__item statusbar__item--ready" data-active={timelinePlaying || recording ? "true" : "false"}>
          <span className="status-dot" aria-hidden />
          {modelStatus}
        </div>
        <div className="statusbar__item">
          {t("app.renderer")} <strong>CesiumJS</strong>
        </div>
        <div className="statusbar__item statusbar__item--wide">
          {t("app.earthContract")}
        </div>
        <div className="statusbar__item statusbar__item--warning">
          <UiIcon name="alert" size={14} />
          {t("app.educationalOnly")}
        </div>
      </div>
    </div>
  );
}
