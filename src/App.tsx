import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { PresetSelector } from "./components/PresetSelector";
import { ScenarioBuilder } from "./components/ScenarioBuilder";
import { ResultsPanel } from "./components/ResultsPanel";
import { CitationsModal } from "./components/CitationsModal";
import { Settings } from "./components/Settings";
import { FirstRunDisclaimer } from "./components/FirstRunDisclaimer";
import { CoastalRunupOverlay } from "./components/CoastalRunupOverlay";
import { DartOverlay, dartPinsForPreset } from "./components/DartOverlay";
import { SwePlayback } from "./components/SwePlayback";
import { api, isTauri } from "./lib/tauri";
import { applyTheme, loadTheme } from "./lib/theme";
import { exportGlobePng } from "./lib/export";
import { presetById, useScenarioSlot } from "./hooks/useScenarioSlot";
import type { Preset } from "./types/scenario";

const Globe = lazy(() => import("./components/Globe").then((m) => ({ default: m.Globe })));

export default function App() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [timeS, setTimeS] = useState<number>(15 * 60);
  const [showCitations, setShowCitations] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [pickMode, setPickMode] = useState(false);
  const [pickedLocation, setPickedLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const inTauri = useMemo(isTauri, []);

  const slotA = useScenarioSlot(timeS);
  const slotB = useScenarioSlot(timeS);

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

  const activePresetA = presetById(presets, slotA.activePresetId);
  const activePresetB = presetById(presets, slotB.activePresetId);

  function handlePickGlobe(lat: number, lon: number) {
    setPickedLocation({ lat, lon });
    setPickMode(false);
  }

  return (
    <div className="app" data-compare={compareMode ? "true" : "false"}>
      <header className="app__header">
        <div>
          <span className="app__title">TsunamiSimulator</span>
          <span className="app__version">v0.2.1</span>
        </div>
        <div className="app__warning">
          Educational only — not for evacuation. Use NOAA NTWC/PTWC for warnings.
        </div>
        <div className="app__header-actions">
          <button
            className="icon-button"
            data-active={compareMode ? "true" : "false"}
            onClick={() => setCompareMode((v) => !v)}
            title="Toggle side-by-side comparison mode"
          >
            ⇆ Compare
          </button>
          <button
            className="icon-button"
            onClick={() => {
              const ok = exportGlobePng({ preset: activePresetA, initial: slotA.initial, timeS });
              if (!ok) console.warn("No globe canvas found to export");
            }}
            title="Save the current globe view as PNG"
            disabled={!slotA.initial}
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

      <main className="app__globe">
        <Suspense fallback={<div className="app__globe-empty"><h2>Loading globe…</h2></div>}>
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

      <aside className="app__panel app__panel--right">
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
    </div>
  );
}
