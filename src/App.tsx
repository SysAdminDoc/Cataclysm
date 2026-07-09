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
import { APP_VERSION } from "./lib/model-provenance";
import { downloadTextExport } from "./lib/text-export";
import { presetById, useScenarioSlot } from "./hooks/useScenarioSlot";
import { scenarioFromUrl, scenarioToUrlParams } from "./lib/scenario-schema";
import type { Preset } from "./types/scenario";

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
  const [pickMode, setPickMode] = useState(false);
  const [inspectMode, setInspectMode] = useState(false);
  const [pickedLocation, setPickedLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [pendingGauge, setPendingGauge] = useState<{ lat: number; lon: number } | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [recording, setRecording] = useState(false);
  const [sweSnapshots, setSweSnapshots] = useState<import("./types/scenario").GridSnapshot[] | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const [activeLesson, setActiveLesson] = useState<GuidedLessonDef | null>(null);
  const [lessonCompletions, setLessonCompletions] = useState<Record<string, string>>({});
  const [tokenBannerOpen, setTokenBannerOpen] = useState(false);
  const [presetsError, setPresetsError] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [toast, setToast] = useState<{ msg: string; tone: "error" | "info" } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const inTauri = useMemo(isTauri, []);

  const slotA = useScenarioSlot(timeS);
  const slotB = useScenarioSlot(timeS);

  // Ephemeral status toast for actions that otherwise fail silently
  // (exports, IPC errors). Auto-dismisses; replaced by the next message.
  const showToast = useCallback((msg: string, tone: "error" | "info" = "info") => {
    setToast({ msg, tone });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 6000);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

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
  const cockpitMode = compareMode ? "Compare" : inspectMode ? "Inspect" : pickMode ? "Pick location" : "Explore";
  const activeSourceLabel = activePresetA?.name ?? slotA.initial?.label ?? "No source selected";
  const timelineLabel = `${Math.round(timeS / 60)} min`;
  const sourceRequiredReason = "Select a preset or simulate a custom source first.";
  const snapshotsRequiredReason = "Run the SWE solver before exporting CZML.";
  const runupRequiredReason = "Select a source and wait for coastal runup results before exporting GeoJSON.";
  const hasSwePlayback = (sweSnapshots?.length ?? 0) > 0;
  const exportMetaA = (): ScreenshotMeta => ({
    preset: activePresetA,
    initial: slotA.initial,
    timeS,
    scenarioKind: activePresetA?.source.kind ?? slotA.lastCustomScenario?.kind ?? "Custom",
    solverMode: hasSwePlayback
      ? "Shallow-water-equation snapshot playback"
      : "Analytical source geometry and coastal runup sampling",
  });

  const exportMetaB = (): ScreenshotMeta => ({
    preset: activePresetB,
    initial: slotB.initial,
    timeS,
    scenarioKind: activePresetB?.source.kind ?? "Custom",
    solverMode: hasSwePlayback
      ? "Shallow-water-equation snapshot playback"
      : "Analytical source geometry and coastal runup sampling",
  });

  function handlePickGlobe(lat: number, lon: number) {
    setPickedLocation({ lat, lon });
    setPickMode(false);
  }

  return (
    <div className="app" data-compare={compareMode ? "true" : "false"}>
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
            <strong>Optional imagery token.</strong> The default Natural Earth globe
            works locally. Add a free Cesium ion token for satellite imagery and bathymetry.
          </span>
          <button
            className="token-banner__action"
            onClick={() => setShowSettings(true)}
            type="button"
          >
            Open Settings
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
          <span className="app__brand-mark" aria-hidden>
            TS
          </span>
          <h1 className="app__title">TsunamiSimulator</h1>
          <span className="app__version">v{APP_VERSION}</span>
        </div>
        <div className="app__warning">
          Educational only — not for evacuation. Use NOAA NTWC/PTWC for warnings.
        </div>
        <div className="app__header-actions" aria-label="Application actions">
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
              disabled={!slotA.initial}
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
            >
              Compare
            </ToolbarButton>
          </div>
          <div className="app__command-group app__command-group--exports" role="group" aria-label="Export current scenario">
            <ToolbarButton
              icon="image"
              onClick={() => {
                const ok = exportGlobePng(exportMetaA());
                showToast(ok ? "Saved globe PNG." : "No globe view to export yet.", ok ? "info" : "error");
              }}
              title="Save the current globe view as PNG"
              disabled={!slotA.initial}
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
              disabled={!slotA.initial}
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
              disabled={!slotA.activePresetId && !slotA.lastCustomScenario}
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
              disabled={!slotA.initial || recording}
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
              disabled={!slotA.initial}
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
              disabled={!sweSnapshots || sweSnapshots.length === 0}
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
                const ok = exportGeoJson(points, exportMetaA());
                showToast(ok ? "Saved GeoJSON inundation file." : "No runup data to export.", ok ? "info" : "error");
              }}
              title="Export inundation polygons as GeoJSON"
              disabled={slotA.runupResults.length === 0}
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
              disabled={!slotA.initial}
              disabledReason={sourceRequiredReason}
              onUnavailable={(reason) => showToast(reason, "info")}
            >
              KML
            </ToolbarButton>
          </div>
          <div className="app__command-group app__command-group--utility" role="group" aria-label="References and preferences">
            <ToolbarButton icon="citations" variant="utility" onClick={() => setShowCitations(true)} title="View citations">
              Citations
            </ToolbarButton>
            <ToolbarButton icon="settings" variant="utility" onClick={() => setShowSettings(true)} title="Settings">
              Settings
            </ToolbarButton>
          </div>
        </div>
      </header>

      <aside className="app__panel" aria-label="Preset scenarios">
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
          activeId={slotA.activePresetId}
          onSelect={slotA.setActivePresetId}
          busyId={slotA.busyPresetId}
          onStartLesson={setActiveLesson}
          completedLessons={lessonCompletions}
        />
        {compareMode && (
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
        <div className="footer-note">
          <span>Peer-reviewed parameters and local diagnostics.</span>
          <button type="button" onClick={() => setShowCitations(true)}>View all citations</button>
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
                initial={slotA.initial}
                wavefront={slotA.wavefront}
                sweSnapshot={slotA.sweSnapshot}
                runupResults={slotA.runupResults}
                dartBuoys={dartPinsForPreset(slotA.activePresetId)}
                pickMode={pickMode}
                onPick={handlePickGlobe}
                onPickCancel={() => setPickMode(false)}
                inspectMode={inspectMode}
                inspectIsImpact={activePresetA?.source.kind === "Asteroid"}
                inspectTimeS={timeS}
                onInspectCancel={() => setInspectMode(false)}
                onAddGauge={(lat, lon) => setPendingGauge({ lat, lon })}
              />
              {compareMode && <div className="app__globe-tag">Slot A</div>}
            </div>
            {compareMode && (
              <div className="app__globe-pane">
                <Globe
                  initial={slotB.initial}
                  wavefront={slotB.wavefront}
                  sweSnapshot={slotB.sweSnapshot}
                  runupResults={slotB.runupResults}
                  dartBuoys={dartPinsForPreset(slotB.activePresetId)}
                  primary={false}
                />
                <div className="app__globe-tag" data-slot="b">Slot B</div>
              </div>
            )}
          </div>
        </Suspense>
      </main>

      <aside className="app__panel app__panel--right" aria-label="Simulation controls and results">
        <ResultsPanel initial={slotA.initial} timeS={timeS} onTimeChange={setTimeS} />
        <AttenuationChart
          initial={slotA.initial}
          isImpact={activePresetA?.source.kind === "Asteroid"}
          timeS={timeS}
          runupResults={slotA.runupResults}
        />
        {compareMode && (
          <div className="app__compare-rail">
            <div className="app__compare-rail-label">Slot B readout</div>
            <ResultsPanel initial={slotB.initial} timeS={timeS} onTimeChange={setTimeS} />
          </div>
        )}
        <SwePlayback
          initial={slotA.initial}
          onSnapshot={slotA.setSweSnapshot}
          onSnapshotsReady={setSweSnapshots}
          pendingGauge={pendingGauge}
          dartBuoys={getDartBuoysForPreset(slotA.activePresetId)}
        />
        <Activity mode={compareMode ? "visible" : "hidden"}>
          <SwePlayback initial={slotB.initial} onSnapshot={slotB.setSweSnapshot} />
        </Activity>
        <DartOverlay presetId={slotA.activePresetId} timeS={timeS} initial={slotA.initial} sweSnapshots={sweSnapshots} />
        {!compareMode && (
          <ScenarioBuilder
            onSimulate={slotA.simulate}
            pickedLocation={pickedLocation}
            onTogglePick={() => setPickMode((p) => !p)}
            pickActive={pickMode}
          />
        )}
      </aside>

      <CoastalRunupOverlay
        initial={slotA.initial}
        activePreset={activePresetA}
        timeS={timeS}
        onResults={slotA.setRunupResults}
      />
      {compareMode && (
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
      <div className="app__statusbar" role="status" aria-live="polite">
        <div className="statusbar__item statusbar__item--ready">
          <span className="status-dot" aria-hidden />
          Model ready
        </div>
        <div className="statusbar__item">
          Mode <strong>{cockpitMode}</strong>
        </div>
        <div className="statusbar__item statusbar__item--wide">
          {activeSourceLabel}
        </div>
        <div className="statusbar__item">
          Timeline <strong>{timelineLabel}</strong>
        </div>
        <div className="statusbar__item statusbar__item--warning">
          <UiIcon name="alert" size={14} />
          Educational only
        </div>
      </div>
    </div>
  );
}
