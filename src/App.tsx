import { useEffect, useMemo, useState } from "react";
import { Globe } from "./components/Globe";
import { PresetSelector } from "./components/PresetSelector";
import { ScenarioBuilder } from "./components/ScenarioBuilder";
import { ResultsPanel } from "./components/ResultsPanel";
import { api, isTauri } from "./lib/tauri";
import type {
  AsteroidImpactInput,
  InitialDisplacement,
  Preset,
  PropagationSnapshot,
} from "./types/scenario";

const MOCK_PRESETS: Preset[] = [
  {
    id: "chicxulub",
    name: "Chicxulub Impact",
    date: "66 Ma",
    blurb: "14-km asteroid into a shallow Yucatan sea. End-Cretaceous extinction event.",
    reference: "Range et al. 2022, AGU Advances",
    source: {
      kind: "Asteroid",
      source: {
        diameter_m: 14000,
        density_kg_m3: 3000,
        velocity_m_s: 20000,
        angle_deg: 60,
        water_depth_m: 1500,
        location: { lat_deg: 21.4, lon_deg: -89.5, depth_m: 1500 },
      },
    },
  },
];

export default function App() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [initial, setInitial] = useState<InitialDisplacement | null>(null);
  const [wavefront, setWavefront] = useState<PropagationSnapshot | null>(null);
  const [timeS, setTimeS] = useState<number>(15 * 60); // default: 15 min after event
  const inTauri = useMemo(isTauri, []);

  useEffect(() => {
    if (!inTauri) {
      setPresets(MOCK_PRESETS);
      return;
    }
    api
      .listPresets()
      .then(setPresets)
      .catch((err) => console.error("listPresets failed", err));
  }, [inTauri]);

  // When time changes for the active preset, re-sample the wavefront.
  useEffect(() => {
    if (!inTauri || !activePresetId) return;
    api
      .runPreset({
        preset_id: activePresetId,
        time_s: timeS,
        mean_depth_m: 4000,
        n_samples: 64,
      })
      .then((resp) => {
        setInitial(resp.initial);
        setWavefront(resp.wavefront);
      })
      .catch((err) => console.error("runPreset failed", err));
  }, [activePresetId, timeS, inTauri]);

  function handleSimulateScenario(input: AsteroidImpactInput) {
    if (!inTauri) {
      // Mock readout in browser preview — rough Schmidt-Holsapple inline.
      const r = input.diameter_m / 2;
      const m = (4 / 3) * Math.PI * r ** 3 * input.density_kg_m3;
      const e = 0.5 * m * input.velocity_m_s ** 2;
      const cavityD =
        1.88 *
        input.diameter_m *
        (input.density_kg_m3 / 1025) ** (1 / 3) *
        (input.velocity_m_s ** 2 / (9.80665 * input.diameter_m)) ** 0.22 *
        Math.sin((input.angle_deg * Math.PI) / 180) ** (1 / 3);
      const cavityR = cavityD / 2;
      const cavityDepth = cavityD / 2.83;
      setInitial({
        center: input.location,
        cavity_radius_m: cavityR,
        peak_amplitude_m: 0.5 * Math.min(cavityDepth, input.water_depth_m),
        source_energy_j: e,
        seismic_mw_equivalent: (2 / 3) * (Math.log10((0.01 * e) / 5e-5) - 9.1),
        label: `${input.diameter_m} m impactor (browser preview)`,
        dominant_wavelength_m: 2 * cavityR,
      });
      setActivePresetId(null);
      return;
    }
    api
      .asteroidInitialConditions(input)
      .then((d) => {
        setInitial(d);
        setActivePresetId(null);
      })
      .catch((err) => console.error("asteroid_initial_conditions failed", err));
  }

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <span className="app__title">TsunamiSimulator</span>
          <span className="app__version">v0.0.1</span>
        </div>
        <div className="app__warning">
          Educational only — not for evacuation. Use NOAA NTWC/PTWC for warnings.
        </div>
      </header>

      <aside className="app__panel">
        <PresetSelector
          presets={presets}
          activeId={activePresetId}
          onSelect={(id) => setActivePresetId(id)}
        />
        <div className="footer-note">
          Sources cite peer-reviewed papers. See <code>docs/science/</code>.
        </div>
      </aside>

      <main className="app__globe">
        <Globe initial={initial} wavefront={wavefront} />
      </main>

      <aside className="app__panel app__panel--right">
        <ResultsPanel initial={initial} timeS={timeS} onTimeChange={setTimeS} />
        <ScenarioBuilder onSimulate={handleSimulateScenario} />
      </aside>
    </div>
  );
}
