import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { PresetSelector } from "./components/PresetSelector";
import { ScenarioBuilder } from "./components/ScenarioBuilder";
import { ResultsPanel } from "./components/ResultsPanel";
import { CitationsModal } from "./components/CitationsModal";
import { Settings } from "./components/Settings";
import { FirstRunDisclaimer } from "./components/FirstRunDisclaimer";
import { CoastalRunupOverlay } from "./components/CoastalRunupOverlay";
import { SwePlayback } from "./components/SwePlayback";
import { api, isTauri, type RunupAtPointResult } from "./lib/tauri";
import { applyTheme, loadTheme } from "./lib/theme";
import { exportGlobePng } from "./lib/export";
import type {
  AsteroidImpactInput,
  EarthquakeInput,
  GridSnapshot,
  InitialDisplacement,
  LandslideInput,
  NuclearBurstInput,
  Preset,
  PropagationSnapshot,
} from "./types/scenario";

const Globe = lazy(() => import("./components/Globe").then((m) => ({ default: m.Globe })));

type ScenarioInput =
  | { kind: "Asteroid"; source: AsteroidImpactInput }
  | { kind: "Nuclear"; source: NuclearBurstInput }
  | { kind: "Earthquake"; source: EarthquakeInput }
  | { kind: "Landslide"; source: LandslideInput };

export default function App() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [initial, setInitial] = useState<InitialDisplacement | null>(null);
  const [wavefront, setWavefront] = useState<PropagationSnapshot | null>(null);
  const [runupResults, setRunupResults] = useState<RunupAtPointResult[]>([]);
  const [sweSnapshot, setSweSnapshot] = useState<GridSnapshot | null>(null);
  const [timeS, setTimeS] = useState<number>(15 * 60);
  const [showCitations, setShowCitations] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [pickMode, setPickMode] = useState(false);
  const [pickedLocation, setPickedLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [busyPresetId, setBusyPresetId] = useState<string | null>(null);
  const inTauri = useMemo(isTauri, []);

  const activePreset = useMemo(
    () => presets.find((p) => p.id === activePresetId) ?? null,
    [presets, activePresetId],
  );

  // Apply persisted theme once at startup.
  useEffect(() => {
    loadTheme().then(applyTheme).catch(() => applyTheme("mocha"));
  }, []);

  useEffect(() => {
    if (!inTauri) return;
    api
      .listPresets()
      .then(setPresets)
      .catch((err) => console.error("listPresets failed", err));
  }, [inTauri]);

  // Active preset + time → wavefront refresh.
  useEffect(() => {
    if (!inTauri || !activePresetId) return;
    setBusyPresetId(activePresetId);
    api
      .runPreset({
        preset_id: activePresetId,
        time_s: timeS,
        mean_depth_m: 0, // 0 = backend uses preset's own water depth
        n_samples: 48,
      })
      .then((resp) => {
        setInitial(resp.initial);
        setWavefront(resp.wavefront);
      })
      .catch((err) => console.error("runPreset failed", err))
      .finally(() => setBusyPresetId(null));
  }, [activePresetId, timeS, inTauri]);

  function handleSimulate(input: ScenarioInput) {
    if (!inTauri) {
      console.warn("Custom scenarios require the Tauri runtime; browser preview disabled.");
      return;
    }
    const route =
      input.kind === "Asteroid" ? api.asteroidInitialConditions(input.source)
      : input.kind === "Nuclear" ? api.nuclearInitialConditions(input.source)
      : input.kind === "Earthquake" ? api.earthquakeInitialConditions(input.source)
      : api.landslideInitialConditions(input.source);
    route
      .then((d) => {
        setInitial(d);
        setActivePresetId(null);
        setWavefront(null); // custom scenarios reset the wavefront sampler
      })
      .catch((err) => console.error(`${input.kind} initial_conditions failed`, err));
  }

  function handlePickGlobe(lat: number, lon: number) {
    setPickedLocation({ lat, lon });
    setPickMode(false);
  }

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <span className="app__title">TsunamiSimulator</span>
          <span className="app__version">v0.1.0</span>
        </div>
        <div className="app__warning">
          Educational only — not for evacuation. Use NOAA NTWC/PTWC for warnings.
        </div>
        <div className="app__header-actions">
          <button
            className="icon-button"
            onClick={() => {
              const ok = exportGlobePng({ preset: activePreset, initial, timeS });
              if (!ok) console.warn("No globe canvas found to export");
            }}
            title="Save the current globe view as PNG"
            disabled={!initial}
          >
            📸 Export PNG
          </button>
          <button className="icon-button" onClick={() => setShowCitations(true)} title="View citations">
            Citations
          </button>
          <button className="icon-button" onClick={() => setShowSettings(true)} title="Settings">
            ⚙ Settings
          </button>
        </div>
      </header>

      <aside className="app__panel">
        <PresetSelector
          presets={presets}
          activeId={activePresetId}
          onSelect={setActivePresetId}
          busyId={busyPresetId}
        />
        <div className="footer-note">
          Each preset cites a peer-reviewed paper.{" "}
          <button onClick={() => setShowCitations(true)}>View all citations →</button>
        </div>
      </aside>

      <main className="app__globe">
        <Suspense fallback={<div className="app__globe-empty"><h2>Loading globe…</h2></div>}>
          <Globe
            initial={initial}
            wavefront={wavefront}
            sweSnapshot={sweSnapshot}
            runupResults={runupResults}
            pickMode={pickMode}
            onPick={handlePickGlobe}
            onPickCancel={() => setPickMode(false)}
          />
        </Suspense>
      </main>

      <aside className="app__panel app__panel--right">
        <ResultsPanel initial={initial} timeS={timeS} onTimeChange={setTimeS} />
        <SwePlayback initial={initial} onSnapshot={setSweSnapshot} />
        <ScenarioBuilder
          onSimulate={handleSimulate}
          pickedLocation={pickedLocation}
          onTogglePick={() => setPickMode((p) => !p)}
          pickActive={pickMode}
        />
      </aside>

      <CoastalRunupOverlay
        initial={initial}
        activePreset={activePreset}
        timeS={timeS}
        onResults={setRunupResults}
      />
      {showCitations && <CitationsModal presets={presets} onClose={() => setShowCitations(false)} />}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      <FirstRunDisclaimer />
    </div>
  );
}
