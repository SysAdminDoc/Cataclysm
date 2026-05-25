import { useCallback, useEffect, useState } from "react";
import { api, isTauri, type RunupAtPointResult } from "../lib/tauri";
import type {
  AsteroidImpactInput,
  EarthquakeInput,
  GridSnapshot,
  InitialDisplacement,
  LandslideInput,
  NuclearBurstInput,
  Preset,
  PropagationSnapshot,
} from "../types/scenario";

export type ScenarioInput =
  | { kind: "Asteroid"; source: AsteroidImpactInput }
  | { kind: "Nuclear"; source: NuclearBurstInput }
  | { kind: "Earthquake"; source: EarthquakeInput }
  | { kind: "Landslide"; source: LandslideInput };

export type ScenarioSlot = {
  activePresetId: string | null;
  setActivePresetId: (id: string | null) => void;
  initial: InitialDisplacement | null;
  wavefront: PropagationSnapshot | null;
  sweSnapshot: GridSnapshot | null;
  setSweSnapshot: (s: GridSnapshot | null) => void;
  runupResults: RunupAtPointResult[];
  setRunupResults: (r: RunupAtPointResult[]) => void;
  busyPresetId: string | null;
  simulate: (input: ScenarioInput) => void;
};

/**
 * Encapsulates the per-slot reactive state + IPC plumbing so the app can run
 * one or two scenario slots in parallel for the F7 comparison view.
 */
export function useScenarioSlot(timeS: number): ScenarioSlot {
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [initial, setInitial] = useState<InitialDisplacement | null>(null);
  const [wavefront, setWavefront] = useState<PropagationSnapshot | null>(null);
  const [sweSnapshot, setSweSnapshot] = useState<GridSnapshot | null>(null);
  const [runupResults, setRunupResults] = useState<RunupAtPointResult[]>([]);
  const [busyPresetId, setBusyPresetId] = useState<string | null>(null);
  const inTauri = isTauri();

  useEffect(() => {
    if (!inTauri || !activePresetId) return;
    setBusyPresetId(activePresetId);
    api
      .runPreset({ preset_id: activePresetId, time_s: timeS, mean_depth_m: 0, n_samples: 48 })
      .then((resp) => {
        setInitial(resp.initial);
        setWavefront(resp.wavefront);
      })
      .catch((err) => console.error("runPreset failed", err))
      .finally(() => setBusyPresetId(null));
  }, [activePresetId, timeS, inTauri]);

  const simulate = useCallback(
    (input: ScenarioInput) => {
      if (!inTauri) {
        console.warn("Custom scenarios require the Tauri runtime; browser preview disabled.");
        return;
      }
      const route =
        input.kind === "Asteroid"
          ? api.asteroidInitialConditions(input.source)
          : input.kind === "Nuclear"
            ? api.nuclearInitialConditions(input.source)
            : input.kind === "Earthquake"
              ? api.earthquakeInitialConditions(input.source)
              : api.landslideInitialConditions(input.source);
      route
        .then((d) => {
          setInitial(d);
          setActivePresetId(null);
          setWavefront(null);
          setSweSnapshot(null);
        })
        .catch((err) => console.error(`${input.kind} initial_conditions failed`, err));
    },
    [inTauri],
  );

  // Reset SWE + runup when preset/initial changes.
  useEffect(() => {
    setSweSnapshot(null);
    setRunupResults([]);
  }, [initial?.center.lat_deg, initial?.center.lon_deg, initial?.peak_amplitude_m]);

  return {
    activePresetId,
    setActivePresetId,
    initial,
    wavefront,
    sweSnapshot,
    setSweSnapshot,
    runupResults,
    setRunupResults,
    busyPresetId,
    simulate,
  };
}

/** Helper: find the Preset metadata for a slot's active id. */
export function presetById(presets: Preset[], id: string | null): Preset | null {
  return id ? presets.find((p) => p.id === id) ?? null : null;
}
