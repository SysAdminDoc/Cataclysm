import { Activity, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PresetSelector } from "./components/PresetSelector";
import { ScenarioBuilder } from "./components/ScenarioBuilder";
import { ResultsPanel } from "./components/ResultsPanel";
import { CitationsModal } from "./components/CitationsModal";
import { Settings } from "./components/Settings";
import { FirstRunDisclaimer } from "./components/FirstRunDisclaimer";
import { Tour } from "./components/Tour";
import { GuidedLesson } from "./components/GuidedLesson";
import type { GuidedLesson as GuidedLessonDef } from "./lib/guided-lessons";
import { LogViewer } from "./components/LogViewer";
import { UiIcon } from "./components/UiIcon";
import { settings } from "./lib/settings";
import { CoastalRunupOverlay } from "./components/CoastalRunupOverlay";
import { DartOverlay } from "./components/DartOverlay";
import { SwePlayback } from "./components/SwePlayback";
import { AttenuationChart } from "./components/AttenuationChart";
import { api, isTauri } from "./lib/tauri";
import { dartPinsForPreset } from "./lib/dart";
import { getDartBuoysForPreset } from "./lib/data";
import { listDemoPresets } from "./lib/demo";
import { applyTheme, loadTheme } from "./lib/theme";
import { exportGlobePng, exportGlobeShareCard, exportGlobeVideo, exportCzml, exportGeoJson, exportKml, exportComparisonPng, type RunupPoint, type ScreenshotMeta } from "./lib/export";
import { APP_VERSION, type RenderFrameProvenance } from "./lib/model-provenance";
import { downloadTextExport } from "./lib/text-export";
import { presetById, useScenarioSlot } from "./hooks/useScenarioSlot";
import { scenarioFromUrl, scenarioToUrlParams } from "./lib/scenario-schema";
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
  const [nuclearInput, setNuclearInput] = useState<NuclearInput>({ yieldKt: 100, burstType: "airburst", populationDensity: 5000 });
  // Default to a 300 m impactor: reaches the ground and excavates a crater
  // (a 100 m stony airbursts) without continental-scale blast radii, so the
  // default "Impact" is dramatic but the effects still frame nicely.
  const [asteroidInput, setAsteroidInput] = useState<AsteroidInput>({ diameterM: 300, densityKgM3: 4000, velocityKmS: 20, angleDeg: 45, targetType: "sedimentary_rock", waterDepthM: 4000 });
  const [hazardResult, setHazardResult] = useState<HazardResult | null>(null);
  const [directRenderReplay, setDirectRenderReplay] = useState<RenderReplayAdapter | null>(null);
  const [directRenderFrame, setDirectRenderFrame] = useState<RendererNeutralFrameView | null>(null);
  const [hazardPending, setHazardPending] = useState(false);
  const hazardRequestId = useRef(0);
  const [windFromDeg, setWindFromDeg] = useState(270);
  const [detonateNonces, setDetonateNonces] = useState<Record<DirectHazardMode, number>>({
    asteroid: 0,
    nuclear: 0,
  });
  const [pendingGauge, setPendingGauge] = useState<{ lat: number; lon: number } | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [recording, setRecording] = useState(false);
  const [sweSnapshots, setSweSnapshots] = useState<import("./types/scenario").GridSnapshot[] | null>(null);
  const [sweMaxField, setSweMaxField] = useState<import("./types/scenario").MaxFieldProduct | null>(null);
  const [sweRenderFrameA, setSweRenderFrameA] = useState<RenderFrameProvenance | null>(null);
  const [sweRenderFrameB, setSweRenderFrameB] = useState<RenderFrameProvenance | null>(null);
  const [sweIsochrones, setSweIsochrones] = useState<import("./types/scenario").Isochrone[] | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const [activeLesson, setActiveLesson] = useState<GuidedLessonDef | null>(null);
  const [lessonCompletions, setLessonCompletions] = useState<Record<string, string>>({});
  const [tokenBannerOpen, setTokenBannerOpen] = useState(false);
  const [presetsError, setPresetsError] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [cameraTelemetry, setCameraTelemetry] = useState({ lat: 0, lon: 0, altitudeM: 20_000_000, headingDeg: 0 });
  const [toast, setToast] = useState<{ msg: string; tone: "error" | "info" } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const inTauri = useMemo(isTauri, []);
  const referenceCaptureMode = useMemo(
    () => new URLSearchParams(window.location.search).get("referenceCapture") === "1",
    [],
  );
  const referenceCaptureSceneId = useMemo(
    () => new URLSearchParams(window.location.search).get("referenceScene"),
    [],
  );

  const slotA = useScenarioSlot(timeS);
  const slotB = useScenarioSlot(timeS);

  // Ephemeral status toast for actions that otherwise fail silently
  // (exports, IPC errors). Auto-dismisses; replaced by the next message.
  const showToast = useCallback((msg: string, tone: "error" | "info" = "info") => {
    setToast({ msg, tone });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 6000);
  }, []);
  const handleCameraTelemetry = useCallback((telemetry: { lat: number; lon: number; altitudeM: number; headingDeg: number }) => {
    setCameraTelemetry(telemetry);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  useEffect(() => {
    if (!timelinePlaying) return;
    const timer = window.setInterval(() => {
      setTimeS((current) => {
        const next = current + 60 * timelineRate;
        if (next >= 6 * 3600) {
          setTimelinePlaying(false);
          return 6 * 3600;
        }
        return next;
      });
    }, 250);
    return () => window.clearInterval(timer);
  }, [timelinePlaying, timelineRate]);

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
  useEffect(() => {
    const result = scenarioFromUrl(window.location.search);
    if (result.type === "preset") {
      slotA.setActivePresetId(result.presetId);
    } else if (result.type === "scenario") {
      slotA.simulate(result.scenario);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // First-run tour: trigger after the disclaimer is acknowledged (or
  // already-acknowledged) the first time the user reaches the app.
  // Settings → 'Show tour again' clears the flag so this fires again.
  useEffect(() => {
    let cancelled = false;
    Promise.all([settings.getDisclaimerAcknowledged(), settings.getTourCompleted()])
      .then(([disclaimer, tour]) => {
        if (cancelled) return;
        if (disclaimer && !tour) setTourOpen(true);
      })
      .catch((err) => console.warn("[tour] failed to read first-run state", err));
    const onSaved = () => {
      // Re-evaluate after Settings save or first-run acknowledgement.
      Promise.all([settings.getDisclaimerAcknowledged(), settings.getTourCompleted()])
        .then(([disclaimer, tour]) => {
          if (cancelled) return;
          if (disclaimer && !tour) setTourOpen(true);
        })
        .catch((err) => console.warn("[tour] failed to refresh first-run state", err));
    };
    window.addEventListener("tsunamisim:settings-saved", onSaved);
    window.addEventListener("tsunamisim:disclaimer-acknowledged", onSaved);
    return () => {
      cancelled = true;
      window.removeEventListener("tsunamisim:settings-saved", onSaved);
      window.removeEventListener("tsunamisim:disclaimer-acknowledged", onSaved);
    };
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
    setDirectRenderReplay(null);
    setDirectRenderFrame(null);
    setHazardPending(true);
    const center = { lat: hazardCenter.lat, lon: hazardCenter.lon };
    const nuclearRequest = {
          center,
          yield_kt: nuclearInput.yieldKt,
          burst_type: nuclearInput.burstType,
          height_m: nuclearInput.heightM,
          fission_pct: nuclearInput.fissionPct ?? 50,
          population_density: nuclearInput.populationDensity ?? 0,
        };
    const asteroidRequest = {
          center,
          diameter_m: asteroidInput.diameterM,
          density_kg_m3: asteroidInput.densityKgM3,
          velocity_km_s: asteroidInput.velocityKmS,
          angle_deg: asteroidInput.angleDeg,
          target_type: asteroidInput.targetType,
          water_depth_m: asteroidInput.waterDepthM ?? 0,
          beach_slope_rad: asteroidInput.beachSlopeRad ?? 0.02,
        };
    const request = hazardMode === "nuclear"
      ? Promise.all([
          api.simulateNuclearHazard(nuclearRequest),
          api.simulateNuclearHazardRender(nuclearRequest),
        ])
      : Promise.all([
          api.simulateAsteroidHazard(asteroidRequest),
          api.simulateAsteroidHazardRender(asteroidRequest),
        ]);

    void request
      .then(([result, replay]) => {
        if (cancelled || requestId !== hazardRequestId.current) return;
        if (result.authority !== "rust" || result.kind !== hazardMode) {
          throw new Error("backend returned an invalid direct-hazard authority contract");
        }
        setHazardResult(result);
        setDirectRenderReplay(replay);
      })
      .catch((error) => {
        if (cancelled || requestId !== hazardRequestId.current) return;
        console.error("direct hazard simulation failed", error);
        setHazardResult(null);
        showToast(`Direct hazard simulation failed: ${String(error)}`, "error");
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
    nuclearInput,
    asteroidInput,
    referenceCaptureMode,
    referenceCaptureSceneId,
    showToast,
  ]);

  useEffect(() => {
    setDirectRenderFrame(null);
    if (!directRenderReplay || !detonateNonce) return;
    const frames = directRenderReplay.frames;
    const lastTick = frames.at(-1)?.header.solver_tick ?? 0;
    const tickDurationS = directRenderReplay.scenario?.header.tick_duration_s ?? 0.1;
    if (referenceCaptureMode && referenceCaptureSceneId) {
      const scene = referenceScenes.scenes.find((entry) => entry.id === referenceCaptureSceneId);
      const tick = Math.min(lastTick, Math.max(0, Math.round((scene?.effectTimeMs ?? 0) / (tickDurationS * 1000))));
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
  }, [directRenderReplay, detonateNonce, referenceCaptureMode, referenceCaptureSceneId]);

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
  });

  const exportMetaB = (): ScreenshotMeta => ({
    preset: activePresetB,
    initial: slotB.initial,
    timeS,
    scenarioKind: activePresetB?.source.kind ?? "Custom",
    solverMode: hasSwePlayback
      ? "Shallow-water-equation snapshot playback"
      : "Analytical source geometry and coastal runup sampling",
    renderFrame: sweRenderFrameB,
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
    setHazardMode(mode);
    setPickMode(false);
    setInspectMode(false);
    setCompareMode(false);
    setExportMenuOpen(false);
    setTimelinePlaying(false);
    setPendingGauge(null);
    setInspectorTab("setup");
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
      data-reference-capture={referenceCaptureMode ? "true" : "false"}
    >
      <a className="skip-link" href="#main-globe">Skip to globe</a>
      {toast && (
        <div className="app-toast" data-tone={toast.tone} role="alert" aria-live="assertive">
          <span>{toast.msg}</span>
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
      <header className="app__header">
        <div className="app__brand">
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
                if (!inspectMode) setPickMode(false);
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
          <div className="app__export-menu">
            <button
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
                const ok = exportGlobePng(exportMetaA());
                showToast(ok ? "Saved globe PNG." : "No globe view to export yet.", ok ? "info" : "error");
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
                  const ok = exportComparisonPng({
                    metaA: exportMetaA(),
                    metaB: exportMetaB(),
                    labelA: activePresetA?.name ?? "Slot A",
                    labelB: activePresetB?.name ?? "Slot B",
                  });
                  showToast(ok ? "Saved comparison PNG." : "Both globe views must be visible.", ok ? "info" : "error");
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
                const ok = exportGlobeShareCard(exportMetaA());
                showToast(ok ? "Saved share card." : "No globe view to export yet.", ok ? "info" : "error");
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
                navigator.clipboard.writeText(url).then(
                  () => showToast("Scenario link copied to clipboard.", "info"),
                  () => showToast("Failed to copy link to clipboard.", "error"),
                );
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
              onClick={async () => {
                if (recording) return;
                setRecording(true);
                try {
                  const result = await exportGlobeVideo(
                    exportMetaA(),
                    { fps: 30, durationMs: 6_000, bitsPerSecond: 6_000_000 },
                  );
                  showToast(
                    result.ok ? "Saved globe recording." : `Video export failed: ${result.reason}`,
                    result.ok ? "info" : "error",
                  );
                } finally {
                  setRecording(false);
                }
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
                downloadTextExport({
                  ...exportMetaA(),
                  runupResults: slotA.runupResults,
                });
                showToast("Saved text results.", "info");
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
                  const ok = exportCzml(exportMetaA(), sweSnapshots);
                  showToast(ok ? "Saved CZML playback file." : "No snapshots to export.", ok ? "info" : "error");
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
                }));
                const ok = exportGeoJson(points, exportMetaA(), sweMaxField?.isochrones ?? null);
                showToast(ok ? "Saved GeoJSON inundation file." : "No runup data to export.", ok ? "info" : "error");
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
                }));
                const ok = exportKml(exportMetaA(), points);
                showToast(ok ? "Saved KML file for Google Earth." : "No data to export.", ok ? "info" : "error");
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
        {!inHazardMode && presetsError && (
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
        {!inHazardMode && <PresetSelector
            presets={presets}
            activeId={slotA.activePresetId}
            onSelect={(id) => {
              slotA.setActivePresetId(id);
              setInspectorTab("setup");
            }}
            busyId={slotA.busyPresetId}
            onStartLesson={setActiveLesson}
            completedLessons={lessonCompletions}
          />}
        {!inHazardMode && compareMode && (
          <div className="app__compare-rail">
            <div className="app__compare-rail-label">Compare slot B</div>
            <PresetSelector
              presets={presets}
              activeId={slotB.activePresetId}
              onSelect={slotB.setActivePresetId}
              busyId={slotB.busyPresetId}
            />
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
                inspectIsImpact={activePresetA?.source.kind === "Asteroid"}
                inspectTimeS={timeS}
                onInspectCancel={() => setInspectMode(false)}
                onAddGauge={inHazardMode ? undefined : (lat, lon) => setPendingGauge({ lat, lon })}
                isochrones={inHazardMode ? null : sweIsochrones}
                hazardRings={inHazardMode ? hazardResult?.rings ?? null : null}
                hazardCenter={inHazardMode ? hazardCenter : null}
                hazardPolygons={hazardPolygons}
                impactKind={hazardMode === "asteroid" ? "asteroid" : hazardMode === "nuclear" ? "nuclear" : null}
                directRenderFrame={directRenderFrame}
                onCameraTelemetry={handleCameraTelemetry}
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
                />
                <div className="app__globe-tag" data-slot="b">Slot B</div>
              </div>
            )}
          </div>
        </Suspense>
        <div className="app__viewport-hud app__viewport-hud--source">
          <span>{activeWorkspaceLabel}</span>
          {inHazardMode && hazardCenter && <strong>{hazardCenter.lat.toFixed(2)}°, {hazardCenter.lon.toFixed(2)}°</strong>}
          {!inHazardMode && slotA.initial && <strong>{slotA.initial.center.lat_deg.toFixed(2)}°, {slotA.initial.center.lon_deg.toFixed(2)}°</strong>}
        </div>
        <button className="app__viewport-layers" type="button" onClick={() => setInspectorTab("layers")} aria-label="Open visualization layers">
          Layers
          <UiIcon name="chevronDown" size={13} />
        </button>
        <div className="app__viewport-legend" data-visible={!inHazardMode && slotA.initial ? "true" : "false"} aria-label="Surface displacement legend">
          <span className="app__viewport-instrument-label">Surface displacement</span>
          <div className="app__viewport-legend-ramp" aria-hidden />
          <div className="app__viewport-legend-scale" aria-hidden>
            <span>0</span><span>0.1</span><span>1</span><span>5</span><span>10+</span>
          </div>
          <small>metres · analytical overlay</small>
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
        <div className="inspector__body" id="inspector-panel" role="tabpanel" aria-labelledby={`inspector-tab-${inspectorTab}`}>
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
          />
        )}
        {inspectorTab === "setup" && !inHazardMode && (
          <SourceModelSummary
            preset={activePresetA ?? null}
            initial={slotA.initial}
            onEdit={() => {
              const editor = document.querySelector<HTMLElement>(".scenario-form");
              editor?.scrollIntoView({ block: "start", behavior: "smooth" });
              editor?.querySelector<HTMLElement>("button, input, select")?.focus();
            }}
          />
        )}
        {inspectorTab === "setup" && !inHazardMode && <SwePlayback
          initial={slotA.initial}
          onSnapshot={slotA.setSweSnapshot}
          onSnapshotsReady={setSweSnapshots}
          pendingGauge={pendingGauge}
          dartBuoys={getDartBuoysForPreset(slotA.activePresetId)}
          onMaxField={setSweMaxField}
          onIsochrones={setSweIsochrones}
          onRenderFrame={setSweRenderFrameA}
        />}
        {inspectorTab === "setup" && !inHazardMode && <Activity mode={compareMode ? "visible" : "hidden"}>
          <SwePlayback initial={slotB.initial} onSnapshot={slotB.setSweSnapshot} onRenderFrame={setSweRenderFrameB} />
        </Activity>}
        {inspectorTab === "setup" && !inHazardMode && !compareMode && (
          <ScenarioBuilder
            onSimulate={(scenario) => {
              slotA.simulate(scenario);
              setInspectorTab("results");
            }}
            pickedLocation={pickedLocation}
            onTogglePick={() => setPickMode((p) => !p)}
            pickActive={pickMode}
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
          windFromDeg={windFromDeg}
          onWindChange={setWindFromDeg}
          onDetonate={detonateActiveHazard}
          backendAvailable={inTauri}
          display="results"
        />}
        {inspectorTab === "results" && !inHazardMode && <ResultsPanel initial={slotA.initial} timeS={timeS} onTimeChange={setTimeS} showTimeline={false} />}
        {inspectorTab === "results" && !inHazardMode && <AttenuationChart
          initial={slotA.initial}
          isImpact={activePresetA?.source.kind === "Asteroid"}
          timeS={timeS}
          runupResults={slotA.runupResults}
        />}
        {inspectorTab === "results" && compareMode && (
          <div className="app__compare-rail">
            <div className="app__compare-rail-label">Slot B readout</div>
            <ResultsPanel initial={slotB.initial} timeS={timeS} onTimeChange={setTimeS} showTimeline={false} />
          </div>
        )}
        {inspectorTab === "results" && !inHazardMode && <DartOverlay presetId={slotA.activePresetId} timeS={timeS} initial={slotA.initial} sweSnapshots={sweSnapshots} />}
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
        timeS={timeS}
        onResults={slotA.setRunupResults}
      />}
      {!inHazardMode && compareMode && (
        <CoastalRunupOverlay
          initial={slotB.initial}
          activePreset={activePresetB}
          timeS={timeS}
          onResults={slotB.setRunupResults}
        />
      )}
      {showCitations && <CitationsModal presets={presets} onClose={() => setShowCitations(false)} />}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      <LogViewer open={showLog} onClose={() => setShowLog(false)} />
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
