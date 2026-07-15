import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PresetSelector } from "./components/PresetSelector";
import { ScenarioBuilder } from "./components/ScenarioBuilder";
import { ResultsPanel } from "./components/ResultsPanel";
import { CitationsModal } from "./components/CitationsModal";
import { Settings } from "./components/Settings";
import { FirstRunDisclaimer } from "./components/FirstRunDisclaimer";
import { LaunchExperience } from "./components/LaunchExperience";
import { Tour } from "./components/Tour";
import { GuidedLesson } from "./components/GuidedLesson";
import type { GuidedLesson as GuidedLessonDef } from "./lib/guided-lessons";
import { LogViewer } from "./components/LogViewer";
import { CrashRecoveryNotice } from "./components/CrashRecoveryNotice";
import { UiIcon } from "./components/UiIcon";
import { settings, type WorkspaceMode, type ColormapId } from "./lib/settings";
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
import { copyExportText, exportFailureLabel, exportGlobePng, exportGlobeShareCard, exportGlobeVideo, exportCzml, exportGeoJson, exportKml, exportComparisonPng, type ExportResult, type RunupPoint, type ScreenshotMeta } from "./lib/export";
import { APP_VERSION, type RenderFrameProvenance } from "./lib/model-provenance";
import { downloadTextExport } from "./lib/text-export";
import { presetById, useScenarioSlot } from "./hooks/useScenarioSlot";
import { scenarioFromUrl, scenarioToUrlParams, sourceNumericDefault, sourceTextDefault, type ScenarioInput } from "./lib/scenario-schema";
import {
  DIRECT_SCENARIOS,
  loadScenarioLibraryPreferences,
  recordRecentScenario,
  saveScenarioLibraryPreferences,
  toggleFavoriteScenario,
  type DirectScenarioTemplate,
  type ScenarioLibraryPreferences,
} from "./lib/scenario-library";
import { REFERENCE_CAPTURE_EVENT, type ReferenceCaptureView } from "./lib/reference-capture";
import type { OutcomeFocusRequest } from "./render/cesium/outcome-focus";
import type { Preset } from "./types/scenario";
import { HazardControls } from "./components/HazardControls";
import { SimulationTransport } from "./components/SimulationTransport";
import { LayerInspector } from "./components/LayerInspector";
import { SourceModelSummary } from "./components/SourceModelSummary";
import {
  type AsteroidInput,
  type HazardResult,
  type NuclearDetail,
  type NuclearInput,
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

const JOURNEY_STEPS: Array<{ id: JourneyStage; label: string }> = [
  { id: "prepare", label: "Prepare" },
  { id: "calculate", label: "Calculate" },
  { id: "watch", label: "Watch" },
  { id: "understand", label: "Understand" },
];

function JourneyProgress({ journey, onManual }: { journey: RunJourney; onManual: () => void }) {
  const activeIndex = JOURNEY_STEPS.findIndex((step) => step.id === journey.stage);
  return (
    <div className="journey-progress" role="status" aria-label={`Run and Watch: ${JOURNEY_STEPS[activeIndex].label}`}>
      <ol>
        {JOURNEY_STEPS.map((step, index) => (
          <li key={step.id} data-state={index < activeIndex ? "complete" : index === activeIndex ? "active" : "pending"}>
            <span aria-hidden>{index < activeIndex ? "✓" : index + 1}</span>
            <strong>{step.label}</strong>
          </li>
        ))}
      </ol>
      <button type="button" onClick={onManual}>Manual controls</button>
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

type ToolbarIconName = "inspect" | "compare" | "image" | "share" | "link" | "video" | "text" | "czml" | "geojson" | "kml" | "citations" | "settings";

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
          onUnavailable?.(disabledReason ?? "This action is not available yet.");
          return;
        }
        onClick();
      }}
      title={resolvedTitle}
      type="button"
    >
      <ToolbarIcon name={icon} />
      <span>{children}</span>
    </button>
  );
}

export default function App() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [timeS, setTimeS] = useState<number>(15 * 60);
  const [showCitations, setShowCitations] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  const [timelineRate, setTimelineRate] = useState(1);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("setup");
  const [pickMode, setPickMode] = useState(false);
  const [inspectMode, setInspectMode] = useState(false);
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
  const [compareMode, setCompareMode] = useState(false);
  const [recording, setRecording] = useState(false);
  const [sweSnapshots, setSweSnapshots] = useState<import("./types/scenario").GridSnapshot[] | null>(null);
  const [legendColormap, setLegendColormap] = useState<ColormapId>("diverging");
  const [sweMaxField, setSweMaxField] = useState<import("./types/scenario").MaxFieldProduct | null>(null);
  const [sweRunQualityA, setSweRunQualityA] = useState<import("./types/scenario").RunQualityRecord | null>(null);
  const [sweRunQualityB, setSweRunQualityB] = useState<import("./types/scenario").RunQualityRecord | null>(null);
  const [sweRenderFrameA, setSweRenderFrameA] = useState<RenderFrameProvenance | null>(null);
  const [sweRenderFrameB, setSweRenderFrameB] = useState<RenderFrameProvenance | null>(null);
  const [sweIsochrones, setSweIsochrones] = useState<import("./types/scenario").Isochrone[] | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const [activeLesson, setActiveLesson] = useState<GuidedLessonDef | null>(null);
  const [lessonCompletions, setLessonCompletions] = useState<Record<string, string>>({});
  const [tokenBannerOpen, setTokenBannerOpen] = useState(false);
  const [presetsError, setPresetsError] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
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
  const [scenarioEditRequest, setScenarioEditRequest] = useState<{ id: number; scenario: ScenarioInput } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const lastCameraUpdateAt = useRef(0);
  const outcomeFocusRequestId = useRef(0);
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
  const startupScenario = useMemo(() => scenarioFromUrl(window.location.search), []);
  const startupScenarioHandled = useRef(false);
  const [referenceEffectTimeMs, setReferenceEffectTimeMs] = useState<number | null>(null);

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
      `${exportFailureLabel(result.code)}: ${result.message}`,
      "error",
      result.retryable ? { label: "Retry", run: retry } : undefined,
    );
  }, [showToast]);
  const changeWorkspaceMode = useCallback((mode: WorkspaceMode) => {
    setWorkspaceMode(mode);
    void settings.setWorkspaceMode(mode).catch((error) => {
      console.warn("[settings] failed to persist workspace mode", error);
      showToast("Workspace detail changed for this session, but could not be saved.", "error");
    });
  }, [showToast]);
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

  // Restore scenario from URL query params (?preset=id or ?scenario=base64).
  // Preset IDs wait for the live registry so an unknown link cannot silently
  // fall back to a different demo scenario.
  useEffect(() => {
    if (startupScenarioHandled.current) return;
    if (startupScenario.type === "scenario") {
      startupScenarioHandled.current = true;
      slotA.simulate(startupScenario.scenario);
      return;
    }
    if (startupScenario.type !== "preset" || presets.length === 0) return;
    startupScenarioHandled.current = true;
    if (presets.some((preset) => preset.id === startupScenario.presetId)) {
      setLibraryPreview({ kind: "preset", presetId: startupScenario.presetId });
      setLibraryPreviewPending(false);
      slotA.setActivePresetId(startupScenario.presetId);
    } else {
      showToast(`Scenario link not found: ${startupScenario.presetId}`, "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presets, startupScenario]);

  // Quick Start is the first usable surface after the safety acknowledgement.
  // Settings can explicitly request the longer tour without obscuring launch.
  useEffect(() => {
    const onRequested = () => setTourOpen(true);
    window.addEventListener("tsunamisim:tour-requested", onRequested);
    return () => window.removeEventListener("tsunamisim:tour-requested", onRequested);
  }, []);

  useEffect(() => {
    if (!inTauri) {
      setPresets(listDemoPresets());
      return;
    }
    setPresetsError(null);
    api
      .listPresets()
      .then((p) => {
        setPresets(p);
        setPresetsError(null);
      })
      .catch((err) => {
        console.error("listPresets failed", err);
        setPresetsError(String(err));
      });
  }, [inTauri]);

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
        setHazardError(null);
        if (renderOutcome.status === "fulfilled") {
          setDirectRenderReplay(renderOutcome.value);
        } else {
          console.error("direct hazard render stream failed", renderOutcome.reason);
          setDirectRenderReplay(null);
          showToast("Effects were calculated, but the staged animation could not be prepared.", "error");
        }
      })
      .catch((error) => {
        if (cancelled || requestId !== hazardRequestId.current) return;
        console.error("direct hazard simulation failed", error);
        setHazardResult(null);
        const message = `Direct hazard simulation failed: ${String(error)}`;
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
  const activeSourceLabel = activePresetA?.name ?? slotA.initial?.label ?? "No source selected";
  const activeWorkspaceLabel = inHazardMode
    ? hazardMode === "nuclear"
      ? "Nuclear detonation"
      : "Asteroid impact"
    : activeSourceLabel;
  const viewportSourceLabel = libraryPreviewPending && libraryPreviewLabel && !slotA.initial && !hazardCenter
    ? `Preview · ${libraryPreviewLabel}`
    : activeWorkspaceLabel;
  const sourceRequiredReason = inHazardMode
    ? "Tsunami inspection and exports are unavailable in direct hazard workspaces."
    : "Select a preset or simulate a custom source first.";
  const snapshotsRequiredReason = "Run the SWE solver before exporting CZML.";
  const runupRequiredReason = "Select a source and wait for coastal runup results before exporting GeoJSON.";
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
      ? "Desktop physics required"
      : hazardPending
      ? "Computing effects"
      : hazardResult
      ? "Effects ready"
      : "Awaiting target"
    : recording
      ? "Recording export"
      : timelinePlaying
        ? "Playback active"
        : slotA.busyPresetId
          ? "Loading source"
          : hasSwePlayback
            ? "SWE field ready"
            : slotA.initial
              ? "Source ready"
              : "Awaiting source";
  const exportMetaA = (): ScreenshotMeta => ({
    preset: activePresetA,
    initial: slotA.initial,
    timeS,
    scenarioKind: activePresetA?.source.kind ?? slotA.lastCustomScenario?.kind ?? "Custom",
    solverMode: hasSwePlayback
      ? "Shallow-water-equation snapshot playback"
      : "Analytical source geometry and coastal runup sampling",
    renderFrame: inHazardMode ? directRenderProvenance : sweRenderFrameA,
    runQuality: sweRunQualityA,
  });

  const exportMetaB = (): ScreenshotMeta => ({
    preset: activePresetB,
    initial: slotB.initial,
    timeS,
    scenarioKind: activePresetB?.source.kind ?? slotB.lastCustomScenario?.kind ?? "Custom",
    solverMode: hasSwePlayback
      ? "Shallow-water-equation snapshot playback"
      : "Analytical source geometry and coastal runup sampling",
    renderFrame: sweRenderFrameB,
    runQuality: sweRunQualityB,
  });

  async function handlePickGlobe(lat: number, lon: number) {
    if (directHazardMode) {
      setHazardCenters((current) => ({ ...current, [directHazardMode]: { lat, lon } }));
      try {
        const surface = inTauri
          ? await api.surfaceProbe({ lat_deg: lat, lon_deg: lon })
          : probeSurfaceLocal(lat, lon);
        if (surface.surface_class === "coast" || surface.surface_class === "unknown") {
          showToast(
            `Target is ${surface.surface_class}; preserving the selected material because the coarse mask cannot resolve the shoreline.`,
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
            `Target classified as ${surface.surface_class.replace("_", " ")} by surface mask ${surface.mask_version} (${surface.confidence} confidence).`,
            "info",
          );
        }
      } catch (error) {
        console.warn("[surface] target probe failed", error);
        showToast("Target placed, but automatic surface classification failed; material was preserved.", "error");
      }
    } else {
      setPickedLocation({ lat, lon });
    }
    setPickMode(false);
  }

  function selectHazardMode(mode: HazardMode) {
    setRunJourney(null);
    setHazardMode(mode);
    setLibraryPreviewPending(false);
    if (mode !== "tsunami") {
      setDetonateNonces((current) => ({ ...current, [mode]: 0 }));
    }
    setPickMode(false);
    setInspectMode(false);
    setCompareMode(false);
    setExportMenuOpen(false);
    setTimelinePlaying(false);
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

  function runLibraryPreview() {
    if (!libraryPreview) return;
    setLibraryPreviewPending(false);
    if (libraryPreview.kind === "preset") {
      runPresetFromLibrary(libraryPreview.presetId);
      return;
    }

    const scenario = libraryPreview.scenario;
    const currentCenter = hazardCenters[scenario.domain];
    const currentInput = scenario.domain === "asteroid" ? asteroidInput : nuclearInput;
    const scenarioInput = scenario.domain === "asteroid" ? scenario.asteroid : scenario.nuclear;
    const canReuseResult = hazardMode === scenario.domain
      && hazardResult?.kind === scenario.domain
      && currentCenter?.lat === scenario.center.lat
      && currentCenter?.lon === scenario.center.lon
      && JSON.stringify(currentInput) === JSON.stringify(scenarioInput);
    selectHazardMode(scenario.domain);
    setDirectRenderFrame(null);
    if (!canReuseResult) {
      setHazardResult(null);
      setDirectRenderReplay(null);
      if (scenario.domain === "asteroid" && scenario.asteroid) {
        setAsteroidInput({ ...scenario.asteroid });
      } else if (scenario.domain === "nuclear" && scenario.nuclear) {
        setNuclearInput({ ...scenario.nuclear });
      }
      setHazardCenters((current) => ({ ...current, [scenario.domain]: { ...scenario.center } }));
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

  function detonateActiveHazard() {
    if (!directHazardMode) return;
    setDetonateNonces((current) => ({
      ...current,
      [directHazardMode]: current[directHazardMode] + 1,
    }));
  }

  return (
    <div
      className="app"
      data-compare={compareMode ? "true" : "false"}
      data-domain={hazardMode}
      data-workspace-mode={workspaceMode}
      data-reference-capture={referenceCaptureMode ? "true" : "false"}
      data-reference-direct-frame-ready={referenceCaptureMode && directRenderFrame ? referenceCaptureSceneId : undefined}
    >
      <a className="skip-link" href="#main-globe">Skip to globe</a>
      {toast && (
        <div className="app-toast" data-tone={toast.tone} role="alert" aria-live="assertive">
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
            aria-label="Dismiss notification"
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
              <strong>Higher-detail online maps are available.</strong> The bundled Earth
              works offline. Configure optional streamed terrain and imagery when needed.
            </span>
            <button
              className="token-banner__action"
              onClick={() => setShowSettings(true)}
              type="button"
            >
              Configure maps
            </button>
            <button
              className="token-banner__dismiss"
              aria-label="Dismiss imagery token notice"
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
          <span className="app__brand-mark" aria-hidden="true">≋</span>
          <div className="app__brand-copy">
            <h1 className="app__title">Cataclysm</h1>
            <span className="app__tagline">Planetary hazard simulator</span>
          </div>
          <span className="app__version">v{APP_VERSION}</span>
        </div>
        <div className="app__warning">
          Educational only — not for evacuation. Use NOAA NTWC/PTWC for warnings.
        </div>
        <div className="app__header-actions" aria-label="Application actions">
          <div className="app__command-group app__command-group--hazard" role="group" aria-label="Hazard type">
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
                    ? "Tsunami mode — source models with the shallow-water solver"
                    : m === "asteroid"
                      ? "Asteroid impact mode — entry, crater, thermal and blast rings"
                      : "Nuclear mode — blast, thermal, radiation and fallout rings"
                }
              >
                {m === "tsunami" ? "Tsunami" : m === "asteroid" ? "Impact" : "Nuclear"}
              </button>
            ))}
          </div>
          <div className="app__command-group app__command-group--modes" role="group" aria-label="Analysis modes">
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
              title="Toggle inspect mode — click anywhere on the globe to read amplitude, arrival, and runup"
              disabled={inHazardMode || !slotA.initial}
              disabledReason={sourceRequiredReason}
              onUnavailable={(reason) => showToast(reason, "info")}
            >
              Inspect
            </ToolbarButton>
            <ToolbarButton
              icon="compare"
              active={compareMode}
              variant="mode"
              onClick={() => setCompareMode((v) => !v)}
              title="Toggle side-by-side comparison mode"
              disabled={inHazardMode}
              disabledReason="Compare is available only between two tsunami workspaces."
              onUnavailable={(reason) => showToast(reason, "info")}
            >
              Compare
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
              <span>Export</span>
              <UiIcon name="chevronDown" size={13} />
            </button>
            {exportMenuOpen && <div
              id="export-actions"
              className="app__export-panel"
              tabIndex={-1}
              autoFocus
              role="group"
              aria-label="Export current scenario"
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("button")) {
                  window.setTimeout(() => setExportMenuOpen(false), 0);
                }
              }}
            >
            <ToolbarButton
              icon="image"
              onClick={() => {
                const run = () => reportExportResult(exportGlobePng(exportMetaA()), "Saved globe PNG.", run);
                run();
              }}
              title="Save the current globe view as PNG"
              disabled={inHazardMode || !slotA.initial}
              disabledReason={sourceRequiredReason}
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
                      labelA: activePresetA?.name ?? "Slot A",
                      labelB: activePresetB?.name ?? "Slot B",
                    }),
                    "Saved comparison PNG.",
                    run,
                  );
                  run();
                }}
                title="Export both comparison globes side-by-side as a single PNG"
                disabled={!slotA.initial || !slotB.initial}
                disabledReason="Select a source in both comparison slots first."
                onUnavailable={(reason) => showToast(reason, "info")}
              >
                Compare
              </ToolbarButton>
            )}
            <ToolbarButton
              icon="share"
              onClick={() => {
                const run = () => reportExportResult(exportGlobeShareCard(exportMetaA()), "Saved share card.", run);
                run();
              }}
              title="Save a branded share-card with scenario metadata + citation overlay"
              disabled={inHazardMode || !slotA.initial}
              disabledReason={sourceRequiredReason}
              onUnavailable={(reason) => showToast(reason, "info")}
            >
              Share
            </ToolbarButton>
            <ToolbarButton
              icon="link"
              onClick={() => {
                const params = scenarioToUrlParams(slotA.activePresetId, slotA.lastCustomScenario);
                if (!params) {
                  showToast("Select a preset or run a custom scenario to share as a link.", "info");
                  return;
                }
                const url = `${window.location.origin}${window.location.pathname}${params}`;
                const run = async () => reportExportResult(
                  await copyExportText(url),
                  "Scenario link copied to clipboard.",
                  () => void run(),
                );
                void run();
              }}
              title="Copy a shareable URL for the current scenario"
              disabled={inHazardMode || (!slotA.activePresetId && !slotA.lastCustomScenario)}
              disabledReason={sourceRequiredReason}
              onUnavailable={(reason) => showToast(reason, "info")}
            >
              Link
            </ToolbarButton>
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
                    reportExportResult(result, "Saved globe recording.", () => void run());
                  } finally {
                    setRecording(false);
                  }
                };
                void run();
              }}
              title="Record 6 s of the globe to WebM/MP4. Start SWE playback first to capture the wave."
              disabled={inHazardMode || !slotA.initial || recording}
              disabledReason={recording ? "Recording is already in progress." : sourceRequiredReason}
              onUnavailable={(reason) => showToast(reason, "info")}
            >
              {recording ? "Recording" : "Video"}
            </ToolbarButton>
            <ToolbarButton
              icon="text"
              onClick={() => {
                const run = () => reportExportResult(
                  downloadTextExport({
                    ...exportMetaA(),
                    runupResults: slotA.runupResults,
                    sourceKind: activeScenarioKindA,
                  }),
                  "Saved text results.",
                  run,
                );
                run();
              }}
              title="Export scenario parameters and runup results as a screen-reader-friendly text file"
              disabled={inHazardMode || !slotA.initial}
              disabledReason={sourceRequiredReason}
              onUnavailable={(reason) => showToast(reason, "info")}
            >
              Text
            </ToolbarButton>
            <ToolbarButton
              icon="czml"
              onClick={() => {
                if (sweSnapshots && sweSnapshots.length > 0) {
                  const run = () => reportExportResult(
                    exportCzml(exportMetaA(), sweSnapshots),
                    "Saved CZML playback file.",
                    run,
                  );
                  run();
                } else {
                  showToast("Run SWE simulation first to export CZML.", "error");
                }
              }}
              title="Export SWE simulation as a CZML file for playback in any Cesium viewer"
              disabled={inHazardMode || !sweSnapshots || sweSnapshots.length === 0}
              disabledReason={snapshotsRequiredReason}
              onUnavailable={(reason) => showToast(reason, "info")}
            >
              CZML
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
                  exportGeoJson(points, exportMetaA(), sweMaxField?.isochrones ?? null),
                  "Saved GeoJSON inundation file.",
                  run,
                );
                run();
              }}
              title="Export inundation polygons as GeoJSON"
              disabled={inHazardMode || slotA.runupResults.length === 0}
              disabledReason={runupRequiredReason}
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
                  exportKml(exportMetaA(), points),
                  "Saved KML file for Google Earth.",
                  run,
                );
                run();
              }}
              title="Export source and runup data as KML for Google Earth"
              disabled={inHazardMode || !slotA.initial}
              disabledReason={sourceRequiredReason}
              onUnavailable={(reason) => showToast(reason, "info")}
            >
              KML
            </ToolbarButton>
            </div>}
          </div>
          <div className="app__command-group app__command-group--utility" role="group" aria-label="References and preferences">
            <ToolbarButton icon="citations" variant="utility" onClick={() => setShowCitations(true)} title="View references">
              References
            </ToolbarButton>
            <ToolbarButton icon="settings" variant="utility" onClick={() => setShowSettings(true)} title="Settings">
              Settings
            </ToolbarButton>
          </div>
        </div>
      </header>

      <aside className="app__panel" aria-label={inHazardMode ? "Direct effects workspace" : "Preset scenarios"}>
        {presetsError && (
          <div className="panel-error" role="status" aria-live="polite">
            <span>Couldn't load presets: {presetsError}</span>
            <button
              type="button"
              onClick={() => {
                setPresetsError(null);
                api
                  .listPresets()
                  .then((p) => setPresets(p))
                  .catch((err) => setPresetsError(String(err)));
              }}
            >
              Retry
            </button>
          </div>
        )}
        <PresetSelector
            presets={presets}
            activeId={libraryPreview?.kind === "preset" ? libraryPreview.presetId : null}
            activeDirectId={libraryPreview?.kind === "direct" ? libraryPreview.scenario.id : null}
            onSelect={previewPreset}
            directScenarios={DIRECT_SCENARIOS}
            onSelectDirect={previewDirectScenario}
            onCreateScenario={createCustomScenario}
            onRunActive={runLibraryPreview}
            recentIds={libraryPreferences.recentIds}
            favoriteIds={libraryPreferences.favoriteIds}
            onToggleFavorite={(id) => updateLibraryPreferences((current) => toggleFavoriteScenario(current, id))}
            busyId={slotA.busyPresetId}
            onStartLesson={(lesson) => {
              runPresetFromLibrary(lesson.presetId);
              setActiveLesson(lesson);
            }}
            completedLessons={lessonCompletions}
          />
        {!inHazardMode && compareMode && (
          <div className="app__compare-picker">
            <label htmlFor="compare-source-b">Compare against</label>
            <select
              id="compare-source-b"
              value={slotB.activePresetId ?? ""}
              onChange={(event) => slotB.setActivePresetId(event.target.value || null)}
              disabled={slotB.busyPresetId !== null}
            >
              <option value="">Select Slot B source…</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.name} · {preset.date}</option>
              ))}
            </select>
            <small>{slotB.busyPresetId ? "Loading comparison source…" : activePresetB?.blurb ?? "Choose a second source without leaving Slot A."}</small>
          </div>
        )}
        {inHazardMode && (
          <div className="app__domain-summary" role="status" aria-live="polite">
            <span>Direct effects workspace</span>
            <strong>{activeWorkspaceLabel}</strong>
            <p>Tsunami sources, wave fields, runup, DART stations, and comparison slots are parked while this domain is active.</p>
          </div>
        )}
        <div className="footer-note">
          <span>Peer-reviewed parameters and local diagnostics.</span>
          <button type="button" onClick={() => setShowCitations(true)}>View all references</button>
          <button type="button" onClick={() => setShowLog(true)}>Diagnostics log</button>
        </div>
      </aside>

      <main className="app__globe" id="main-globe" tabIndex={-1} aria-label="Interactive globe simulation">
        <Suspense
          fallback={
            <div className="app__globe-empty">
              <div className="loading-orbit" aria-hidden />
              <h2>Preparing globe</h2>
              <p>Loading terrain, imagery, and simulation layers.</p>
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
                dartBuoys={inHazardMode ? [] : dartPinsForPreset(slotA.activePresetId)}
                pickMode={pickMode}
                onPick={handlePickGlobe}
                onPickCancel={() => setPickMode(false)}
                inspectMode={!inHazardMode && inspectMode}
                inspectIsImpact={activeScenarioKindA === "Asteroid"}
                inspectTimeS={timeS}
                onInspectCancel={() => setInspectMode(false)}
                onAddGauge={inHazardMode ? undefined : (lat, lon) => setPendingGauge({ lat, lon })}
                isochrones={inHazardMode ? null : sweIsochrones}
                hazardRings={inHazardMode ? hazardResult?.rings ?? null : null}
                hazardCenter={inHazardMode ? hazardCenter : null}
                hazardPolygons={hazardPolygons}
                impactKind={hazardMode === "asteroid" ? "asteroid" : hazardMode === "nuclear" ? "nuclear" : null}
                directRenderFrame={directRenderFrame}
                previewCamera={libraryPreviewPending ? libraryPreviewCamera : null}
                previewLabel={libraryPreviewPending ? libraryPreviewLabel : null}
                onCameraTelemetry={handleCameraTelemetry}
                accessibleSceneLabel={viewportSourceLabel}
                simulationTimeS={timeS}
                accessibleCameraTelemetry={cameraTelemetry}
                outcomeFocus={inHazardMode ? null : outcomeFocus}
                onOutcomeFocusTime={setTimeS}
              />
              {compareMode && <div className="app__globe-tag">Slot A</div>}
            </div>
            {compareMode && (
              <div className="app__globe-pane">
                <Globe
                  domain="tsunami"
                  initial={slotB.initial}
                  wavefront={slotB.wavefront}
                  sweSnapshot={slotB.sweSnapshot}
                  runupResults={slotB.runupResults}
                  dartBuoys={dartPinsForPreset(slotB.activePresetId)}
                  directRenderFrame={null}
                  primary={false}
                  accessibleSceneLabel={`Comparison slot B · ${activePresetB?.name ?? slotB.initial?.label ?? "No source selected"}`}
                  simulationTimeS={timeS}
                />
                <div className="app__globe-tag" data-slot="b">Slot B</div>
              </div>
            )}
          </div>
        </Suspense>
        <div className="app__viewport-hud app__viewport-hud--source" aria-label={`Scenario time T plus ${Math.round(timeS / 60)} minutes`}>
          <div className="app__viewport-time">
            <span aria-hidden="true">◷</span>
            <strong>T+{Math.round(timeS / 60)} min</strong>
          </div>
          <small>Scenario time</small>
          <span className="app__viewport-source-name">{viewportSourceLabel}</span>
          {inHazardMode && hazardCenter && <strong>{hazardCenter.lat.toFixed(2)}°, {hazardCenter.lon.toFixed(2)}°</strong>}
          {!inHazardMode && slotA.initial && <strong>{slotA.initial.center.lat_deg.toFixed(2)}°, {slotA.initial.center.lon_deg.toFixed(2)}°</strong>}
        </div>
        <button className="app__viewport-layers" type="button" onClick={() => setInspectorTab("layers")} aria-label="Open visualization layers">
          Layers
          <UiIcon name="chevronDown" size={13} />
        </button>
        <div className="app__viewport-legend" data-visible={!inHazardMode && slotA.initial ? "true" : "false"} aria-label={`Surface displacement legend (${legendColormap})`}>
          <span className="app__viewport-instrument-label">Surface displacement</span>
          <div
            className="app__viewport-legend-ramp"
            style={{ background: colormapLegend(legendColormap).gradient }}
            aria-hidden
          />
          <div className="app__viewport-legend-scale" aria-hidden>
            {colormapLegend(legendColormap).scale.map((label, i) => (
              <span key={i}>{label}</span>
            ))}
          </div>
          <small>{colormapLegend(legendColormap).caption}</small>
        </div>
        <div className="app__viewport-telemetry" aria-label="Viewport telemetry">
          <div className="app__viewport-north" style={{ transform: `rotate(${-cameraTelemetry.headingDeg}deg)` }} aria-hidden>
            <span>N</span>
            <i />
          </div>
          <div>
            <span className="app__viewport-instrument-label">Camera</span>
            <strong>{cameraTelemetry.altitudeM >= 1_000_000 ? `${(cameraTelemetry.altitudeM / 1_000_000).toFixed(1)} Mm` : `${(cameraTelemetry.altitudeM / 1000).toFixed(0)} km`} altitude</strong>
            <small>{Math.abs(cameraTelemetry.lat).toFixed(2)}° {cameraTelemetry.lat >= 0 ? "N" : "S"} · {Math.abs(cameraTelemetry.lon).toFixed(2)}° {cameraTelemetry.lon >= 0 ? "E" : "W"}</small>
          </div>
        </div>
      </main>

      <aside className="app__panel app__panel--right" aria-label="Simulation controls and results">
        <div className="inspector__header">
          <div className="inspector__identity">
            <span>Active workspace</span>
            <strong>{inHazardMode ? (hazardMode === "nuclear" ? "Nuclear detonation" : "Asteroid impact") : activeSourceLabel}</strong>
          </div>
          <div className="workspace-mode" role="group" aria-label="Workspace detail">
            {(["simple", "customize", "advanced"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={workspaceMode === mode}
                data-active={workspaceMode === mode ? "true" : undefined}
                onClick={() => changeWorkspaceMode(mode)}
              >
                {mode[0].toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
          <div className="inspector__tabs" role="tablist" aria-label="Simulation inspector">
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
                {tab[0].toUpperCase() + tab.slice(1)}
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
          <HazardControls
            mode={hazardMode === "nuclear" ? "nuclear" : "asteroid"}
            nuclear={nuclearInput}
            asteroid={asteroidInput}
            onNuclearChange={setNuclearInput}
            onAsteroidChange={setAsteroidInput}
            center={hazardCenter}
            onTogglePick={() => setPickMode((p) => !p)}
            pickActive={pickMode}
            result={hazardResult}
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
        )}
        <div hidden={inspectorTab !== "setup" || inHazardMode}>
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
            onColormap={setLegendColormap}
            pendingGauge={pendingGauge}
            dartBuoys={getDartBuoysForPreset(slotA.activePresetId)}
            onMaxField={setSweMaxField}
            onRunQuality={setSweRunQualityA}
            onIsochrones={setSweIsochrones}
            onRenderFrame={setSweRenderFrameA}
            playbackTimeS={timeS}
            onPlaybackTimeChange={setTimeS}
            slotLabel={compareMode ? "Slot A" : undefined}
            runAndWatchNonce={sweRunAndWatchNonce}
            workspaceMode={referenceCaptureMode ? "advanced" : workspaceMode}
          />
          <div hidden={!compareMode} aria-label="Comparison slot B solver">
            <SwePlayback initial={slotB.initial} onSnapshot={slotB.setSweSnapshot} onRunQuality={setSweRunQualityB} onRenderFrame={setSweRenderFrameB} playbackTimeS={timeS} onPlaybackTimeChange={setTimeS} slotLabel="Slot B" />
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
          timeS={timeS}
          onTimeChange={setTimeS}
          showTimeline={false}
          sourceKind={activeScenarioKindA}
          runupResults={slotA.runupResults}
          onFocusOutcome={handleOutcomeFocus}
          scienceContent={<AttenuationChart
            initial={slotA.initial}
            isImpact={activeScenarioKindA === "Asteroid"}
            timeS={timeS}
            runupResults={slotA.runupResults}
          />}
          validationContent={<DartOverlay
            presetId={slotA.activePresetId}
            timeS={timeS}
            sweSnapshots={sweSnapshots}
          />}
        />}
        {inspectorTab === "results" && compareMode && (
          <div className="app__compare-rail">
            <div className="app__compare-rail-label">Slot B readout</div>
            <ResultsPanel
              initial={slotB.initial}
              timeS={timeS}
              onTimeChange={setTimeS}
              showTimeline={false}
              sourceKind={activeScenarioKindB}
              runupResults={slotB.runupResults}
              scienceContent={<AttenuationChart
                initial={slotB.initial}
                isImpact={activeScenarioKindB === "Asteroid"}
                timeS={timeS}
                runupResults={slotB.runupResults}
              />}
              validationContent={<DartOverlay
                presetId={slotB.activePresetId}
                timeS={timeS}
                sweSnapshots={null}
              />}
            />
          </div>
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
          onOpenSettings={() => setShowSettings(true)}
        />}
        </div>
      </aside>

      {!inHazardMode && <CoastalRunupOverlay
        initial={slotA.initial}
        activePreset={activePresetA}
        sourceKind={activeScenarioKindA}
        timeS={timeS}
        onResults={slotA.setRunupResults}
      />}
      {!inHazardMode && compareMode && (
        <CoastalRunupOverlay
          initial={slotB.initial}
          activePreset={activePresetB}
          sourceKind={activeScenarioKindB}
          timeS={timeS}
          onResults={slotB.setRunupResults}
        />
      )}
      {showCitations && <CitationsModal presets={presets} onClose={() => setShowCitations(false)} />}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      <LogViewer open={showLog} onClose={() => setShowLog(false)} />
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
        sourceLabel={inHazardMode ? (hazardMode === "nuclear" ? "Nuclear detonation" : "Asteroid impact") : activeSourceLabel}
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
          Renderer <strong>CesiumJS</strong>
        </div>
        <div className="statusbar__item statusbar__item--wide">
          WGS84 Earth · visual terrain · analytical ocean-depth model
        </div>
        <div className="statusbar__item statusbar__item--warning">
          <UiIcon name="alert" size={14} />
          Educational only
        </div>
      </div>
    </div>
  );
}
