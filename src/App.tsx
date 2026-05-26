import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { PresetSelector } from "./components/PresetSelector";
import { ScenarioBuilder } from "./components/ScenarioBuilder";
import { ResultsPanel } from "./components/ResultsPanel";
import { CitationsModal } from "./components/CitationsModal";
import { Settings } from "./components/Settings";
import { FirstRunDisclaimer } from "./components/FirstRunDisclaimer";
import { Tour } from "./components/Tour";
import { settings } from "./lib/settings";
import { CoastalRunupOverlay } from "./components/CoastalRunupOverlay";
import { DartOverlay, dartPinsForPreset } from "./components/DartOverlay";
import { SwePlayback } from "./components/SwePlayback";
import { api, isTauri } from "./lib/tauri";
import { listDemoPresets } from "./lib/demo";
import { applyTheme, loadTheme } from "./lib/theme";
import { exportGlobePng, exportGlobeShareCard, exportGlobeVideo } from "./lib/export";
import { presetById, useScenarioSlot } from "./hooks/useScenarioSlot";
import type { Preset } from "./types/scenario";

const Globe = lazy(() => import("./components/Globe").then((m) => ({ default: m.Globe })));

type ToolbarIconName = "inspect" | "compare" | "image" | "share" | "video" | "citations" | "settings";

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
  if (name === "video") {
    return (
      <svg {...common}>
        <rect x="4" y="6" width="12" height="12" rx="2" />
        <path d="m16 10 4-2v8l-4-2" />
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
  title,
  onClick,
  children,
}: {
  icon: ToolbarIconName;
  active?: boolean;
  disabled?: boolean;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className="icon-button"
      data-active={active ? "true" : "false"}
      onClick={onClick}
      title={title}
      disabled={disabled}
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
  const [compareMode, setCompareMode] = useState(false);
  const [recording, setRecording] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [tokenBannerOpen, setTokenBannerOpen] = useState(false);
  const inTauri = useMemo(isTauri, []);

  const slotA = useScenarioSlot(timeS);
  const slotB = useScenarioSlot(timeS);

  // Apply persisted theme once at startup.
  useEffect(() => {
    loadTheme().then(applyTheme).catch(() => applyTheme("mocha"));
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
      .catch(() => {});
    const onSaved = () => {
      // Re-evaluate after Settings save (in case the user reset the tour).
      Promise.all([settings.getDisclaimerAcknowledged(), settings.getTourCompleted()])
        .then(([disclaimer, tour]) => {
          if (cancelled) return;
          if (disclaimer && !tour) setTourOpen(true);
        })
        .catch(() => {});
    };
    window.addEventListener("tsunamisim:settings-saved", onSaved);
    return () => {
      cancelled = true;
      window.removeEventListener("tsunamisim:settings-saved", onSaved);
    };
  }, []);

  useEffect(() => {
    if (!inTauri) {
      setPresets(listDemoPresets());
      return;
    }
    api
      .listPresets()
      .then(setPresets)
      .catch((err) => console.error("listPresets failed", err));
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
        .catch(() => {});
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

  function handlePickGlobe(lat: number, lon: number) {
    setPickedLocation({ lat, lon });
    setPickMode(false);
  }

  return (
    <div className="app" data-compare={compareMode ? "true" : "false"}>
      <a className="skip-link" href="#main-globe">Skip to globe</a>
      {tokenBannerOpen && (
        <div className="token-banner" role="status" aria-live="polite">
          <span className="token-banner__icon" aria-hidden>
            i
          </span>
          <span>
            <strong>Optional imagery token.</strong> Add a free Cesium ion token for
            satellite imagery and bathymetry. The default OSM globe works without setup.
          </span>
          <button
            className="token-banner__action"
            onClick={() => setShowSettings(true)}
          >
            Open Settings
          </button>
          <button
            className="token-banner__dismiss"
            aria-label="Dismiss imagery token notice"
            onClick={() => {
              setTokenBannerOpen(false);
              settings.dismissTokenBanner().catch(() => {});
            }}
          >
            ✕
          </button>
        </div>
      )}
      <header className="app__header">
        <div className="app__brand">
          <span className="app__brand-mark" aria-hidden>
            TS
          </span>
          <span className="app__title">TsunamiSimulator</span>
          <span className="app__version">v0.2.1</span>
        </div>
        <div className="app__warning">
          Educational only — not for evacuation. Use NOAA NTWC/PTWC for warnings.
        </div>
        <div className="app__header-actions">
          <ToolbarButton
            icon="inspect"
            active={inspectMode}
            onClick={() => {
              setInspectMode((v) => !v);
              if (!inspectMode) setPickMode(false);
            }}
            title="Toggle inspect mode — click anywhere on the globe to read amplitude, arrival, and runup"
            disabled={!slotA.initial}
          >
            Inspect
          </ToolbarButton>
          <ToolbarButton
            icon="compare"
            active={compareMode}
            onClick={() => setCompareMode((v) => !v)}
            title="Toggle side-by-side comparison mode"
          >
            Compare
          </ToolbarButton>
          <ToolbarButton
            icon="image"
            onClick={() => {
              const ok = exportGlobePng({ preset: activePresetA, initial: slotA.initial, timeS });
              if (!ok) console.warn("No globe canvas found to export");
            }}
            title="Save the current globe view as PNG"
            disabled={!slotA.initial}
          >
            PNG
          </ToolbarButton>
          <ToolbarButton
            icon="share"
            onClick={() => {
              const ok = exportGlobeShareCard({
                preset: activePresetA,
                initial: slotA.initial,
                timeS,
              });
              if (!ok) console.warn("No globe canvas found to export");
            }}
            title="Save a branded share-card with scenario metadata + citation overlay"
            disabled={!slotA.initial}
          >
            Share
          </ToolbarButton>
          <ToolbarButton
            icon="video"
            onClick={async () => {
              if (recording) return;
              setRecording(true);
              try {
                const result = await exportGlobeVideo(
                  { preset: activePresetA, initial: slotA.initial, timeS },
                  { fps: 30, durationMs: 6_000, bitsPerSecond: 6_000_000 },
                );
                if (!result.ok) {
                  console.warn("Video export failed:", result.reason);
                }
              } finally {
                setRecording(false);
              }
            }}
            title="Record 6 s of the globe to WebM/MP4. Start SWE playback first to capture the wave."
            disabled={!slotA.initial || recording}
          >
            {recording ? "Recording" : "Video"}
          </ToolbarButton>
          <ToolbarButton icon="citations" onClick={() => setShowCitations(true)} title="View citations">
            Citations
          </ToolbarButton>
          <ToolbarButton icon="settings" onClick={() => setShowSettings(true)} title="Settings">
            Settings
          </ToolbarButton>
        </div>
      </header>

      <aside className="app__panel" aria-label="Preset scenarios">
        <PresetSelector
          presets={presets}
          activeId={slotA.activePresetId}
          onSelect={slotA.setActivePresetId}
          busyId={slotA.busyPresetId}
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
          Each preset cites a peer-reviewed paper.{" "}
          <button onClick={() => setShowCitations(true)}>View all citations →</button>
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
                />
                <div className="app__globe-tag" data-slot="b">Slot B</div>
              </div>
            )}
          </div>
        </Suspense>
      </main>

      <aside className="app__panel app__panel--right" aria-label="Simulation controls and results">
        <ResultsPanel initial={slotA.initial} timeS={timeS} onTimeChange={setTimeS} />
        {compareMode && (
          <div className="app__compare-rail">
            <div className="app__compare-rail-label">Slot B readout</div>
            <ResultsPanel initial={slotB.initial} timeS={timeS} onTimeChange={setTimeS} />
          </div>
        )}
        <SwePlayback initial={slotA.initial} onSnapshot={slotA.setSweSnapshot} />
        {compareMode && <SwePlayback initial={slotB.initial} onSnapshot={slotB.setSweSnapshot} />}
        <DartOverlay presetId={slotA.activePresetId} timeS={timeS} />
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
      <FirstRunDisclaimer />
      <Tour
        open={tourOpen}
        onClose={() => {
          setTourOpen(false);
          settings.markTourCompleted().catch(() => {});
        }}
      />
    </div>
  );
}
