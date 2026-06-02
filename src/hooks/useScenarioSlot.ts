import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, isTauri, type RunupAtPointResult } from "../lib/tauri";
import { demoInitialForScenario, runDemoPreset } from "../lib/demo";
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
  /** Last preset/scenario IPC failure, surfaced to the user. Cleared on the
   *  next successful (or newly-started) request. */
  error: string | null;
  clearError: () => void;
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
  const [error, setError] = useState<string | null>(null);
  // Monotonic request id — only the most recent runPreset response is
  // allowed to commit. Stops a slow earlier call from overwriting a fast
  // later one on rapid timeline scrubs.
  const runPresetReqIdRef = useRef(0);
  const simulateReqIdRef = useRef(0);
  // Track whether the hook is still mounted so async resolvers don't
  // setState on an unmounted component.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const inTauri = useMemo(isTauri, []);

  useEffect(() => {
    if (!activePresetId) {
      runPresetReqIdRef.current += 1;
      setBusyPresetId(null);
      return;
    }
    runPresetReqIdRef.current += 1;
    const reqId = runPresetReqIdRef.current;
    setBusyPresetId(activePresetId);
    setError(null);
    if (!inTauri) {
      window.setTimeout(() => {
        if (!mountedRef.current || reqId !== runPresetReqIdRef.current) return;
        const resp = runDemoPreset(activePresetId, timeS);
        setInitial(resp.initial);
        setWavefront(resp.wavefront);
        setBusyPresetId(null);
      }, 80);
      return;
    }
    api
      .runPreset({ preset_id: activePresetId, time_s: timeS, mean_depth_m: 0, n_samples: 48 })
      .then((resp) => {
        // Drop stale responses + don't touch unmounted state.
        if (!mountedRef.current || reqId !== runPresetReqIdRef.current) return;
        setInitial(resp.initial);
        setWavefront(resp.wavefront);
      })
      .catch((err) => {
        if (!mountedRef.current || reqId !== runPresetReqIdRef.current) return;
        console.error("runPreset failed", err);
        setError(`Couldn't load this preset: ${String(err)}`);
      })
      .finally(() => {
        if (!mountedRef.current || reqId !== runPresetReqIdRef.current) return;
        setBusyPresetId(null);
      });
  }, [activePresetId, timeS, inTauri]);

  const simulate = useCallback(
    (input: ScenarioInput) => {
      // A custom scenario supersedes any preset fetch already in flight.
      // Without this, a slow `run_preset` response can overwrite the custom
      // source after the user has moved on.
      runPresetReqIdRef.current += 1;
      setBusyPresetId(null);
      setActivePresetId(null);
      setError(null);
      if (!inTauri) {
        const d = demoInitialForScenario(input);
        setInitial(d);
        setWavefront(null);
        setSweSnapshot(null);
        return;
      }
      simulateReqIdRef.current += 1;
      const reqId = simulateReqIdRef.current;
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
          if (!mountedRef.current || reqId !== simulateReqIdRef.current) return;
          setInitial(d);
          setWavefront(null);
          setSweSnapshot(null);
        })
        .catch((err) => {
          if (!mountedRef.current || reqId !== simulateReqIdRef.current) return;
          console.error(`${input.kind} initial_conditions failed`, err);
          setError(`Couldn't simulate this ${input.kind.toLowerCase()} scenario: ${String(err)}`);
        });
    },
    [inTauri],
  );

  // Reset SWE + runup when the source location/amplitude meaningfully
  // changes (a new scenario, not a timeline scrub).
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
    error,
    clearError: () => setError(null),
  };
}

/** Helper: find the Preset metadata for a slot's active id. */
export function presetById(presets: Preset[], id: string | null): Preset | null {
  return id ? presets.find((p) => p.id === id) ?? null : null;
}
