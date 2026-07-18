import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { api, isTauri, type RunupAtPointResult } from "../lib/tauri";
import { demoInitialForScenario, runDemoPreset } from "../lib/demo";
import { asyncResultValue, rejectAsyncResult, startAsyncResult, type AsyncResult } from "../lib/async-result";
import type {
  AsteroidImpactInput,
  EarthquakeInput,
  GridSnapshot,
  InitialDisplacement,
  LandslideInput,
  MeteotsunamiInput,
  NuclearBurstInput,
  Preset,
  PropagationSnapshot,
} from "../types/scenario";

export type ScenarioInput =
  | { kind: "Asteroid"; source: AsteroidImpactInput }
  | { kind: "Nuclear"; source: NuclearBurstInput }
  | { kind: "Earthquake"; source: EarthquakeInput }
  | { kind: "Landslide"; source: LandslideInput }
  | { kind: "Meteotsunami"; source: MeteotsunamiInput };

export type ScenarioSlot = {
  activePresetId: string | null;
  setActivePresetId: (id: string | null) => void;
  sourceResult: AsyncResult<InitialDisplacement>;
  initial: InitialDisplacement | null;
  wavefront: PropagationSnapshot | null;
  sweSnapshot: GridSnapshot | null;
  setSweSnapshot: (s: GridSnapshot | null) => void;
  runupResult: AsyncResult<RunupAtPointResult[]>;
  runupResults: RunupAtPointResult[];
  setRunupResult: Dispatch<SetStateAction<AsyncResult<RunupAtPointResult[]>>>;
  runupRetryNonce: number;
  retryRunup: () => void;
  busyPresetId: string | null;
  simulate: (input: ScenarioInput) => void;
  lastCustomScenario: ScenarioInput | null;
  error: string | null;
  retrySource: () => void;
};

function sameInitial(a: InitialDisplacement | null, b: InitialDisplacement): boolean {
  return Boolean(
    a &&
      a.center.lat_deg === b.center.lat_deg &&
      a.center.lon_deg === b.center.lon_deg &&
      (a.center.depth_m ?? null) === (b.center.depth_m ?? null) &&
      a.peak_amplitude_m === b.peak_amplitude_m &&
      a.cavity_radius_m === b.cavity_radius_m &&
      a.source_energy_j === b.source_energy_j,
  );
}

/**
 * Encapsulates the per-slot reactive state + IPC plumbing so the app can run
 * one or two scenario slots in parallel for the F7 comparison view.
 */
export function useScenarioSlot(timeS: number): ScenarioSlot {
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [initial, setInitial] = useState<InitialDisplacement | null>(null);
  const [sourceResult, setSourceResult] = useState<AsyncResult<InitialDisplacement>>({ status: "idle" });
  const [wavefront, setWavefront] = useState<PropagationSnapshot | null>(null);
  const [sweSnapshot, setSweSnapshot] = useState<GridSnapshot | null>(null);
  const [runupResult, setRunupResult] = useState<AsyncResult<RunupAtPointResult[]>>({ status: "idle" });
  const runupResults = asyncResultValue(runupResult) ?? [];
  const [runupRetryNonce, setRunupRetryNonce] = useState(0);
  const [busyPresetId, setBusyPresetId] = useState<string | null>(null);
  const [sourceRetryNonce, setSourceRetryNonce] = useState(0);
  const [lastCustomScenario, setLastCustomScenario] = useState<ScenarioInput | null>(null);
  // Monotonic request id — only the most recent runPreset response is
  // allowed to commit. Stops a slow earlier call from overwriting a fast
  // later one on rapid timeline scrubs.
  const runPresetReqIdRef = useRef(0);
  const simulateReqIdRef = useRef(0);
  const loadedPresetIdRef = useRef<string | null>(null);
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
    const sourceChanged = loadedPresetIdRef.current !== activePresetId;
    loadedPresetIdRef.current = activePresetId;
    if (!activePresetId) {
      runPresetReqIdRef.current += 1;
      setBusyPresetId(null);
      return;
    }
    if (sourceChanged) {
      setSourceResult({ status: "loading" });
      setInitial(null);
      setWavefront(null);
      setSweSnapshot(null);
      setRunupResult({ status: "idle" });
    }
    setLastCustomScenario(null);
    // A preset selection supersedes any custom scenario IPC already in flight.
    // Otherwise a slow custom response can overwrite the preset the user just picked.
    simulateReqIdRef.current += 1;
    runPresetReqIdRef.current += 1;
    const reqId = runPresetReqIdRef.current;
    // Only show the "loading source" state when the preset actually changes.
    // The wavefront is re-fetched on every timeline tick; without this guard the
    // busy badge flickers on/off throughout playback and scrubbing.
    if (sourceChanged) setBusyPresetId(activePresetId);
    if (!sourceChanged) setSourceResult((current) => startAsyncResult(current));
    if (!inTauri) {
      window.setTimeout(() => {
        if (!mountedRef.current || reqId !== runPresetReqIdRef.current) return;
        void runDemoPreset(activePresetId, timeS)
          .then((resp) => {
            if (!mountedRef.current || reqId !== runPresetReqIdRef.current) return;
            setInitial((current) => (sameInitial(current, resp.initial) ? current : resp.initial));
            setSourceResult({ status: "ready", value: resp.initial });
            setWavefront(resp.wavefront);
          })
          .catch((err) => {
            if (!mountedRef.current || reqId !== runPresetReqIdRef.current) return;
            setSourceResult((current) => rejectAsyncResult(current, `Couldn't load browser physics: ${String(err)}`));
          })
          .finally(() => {
            if (!mountedRef.current || reqId !== runPresetReqIdRef.current) return;
            setBusyPresetId(null);
          });
      }, 80);
      return;
    }
    if (sourceChanged) {
      api
        .runPreset({ preset_id: activePresetId, time_s: timeS, mean_depth_m: 0, n_samples: 48 })
        .then((resp) => {
          if (!mountedRef.current || reqId !== runPresetReqIdRef.current) return;
          setInitial((current) => (sameInitial(current, resp.initial) ? current : resp.initial));
          setSourceResult({ status: "ready", value: resp.initial });
          setWavefront(resp.wavefront);
        })
        .catch((err) => {
          if (!mountedRef.current || reqId !== runPresetReqIdRef.current) return;
          console.error("runPreset failed", err);
          setSourceResult((current) => rejectAsyncResult(current, `Couldn't load this preset: ${String(err)}`));
        })
        .finally(() => {
          if (!mountedRef.current || reqId !== runPresetReqIdRef.current) return;
          setBusyPresetId(null);
        });
    } else {
      api
        .samplePresetWavefront(activePresetId, timeS, 48)
        .then((wf) => {
          if (!mountedRef.current || reqId !== runPresetReqIdRef.current) return;
          setWavefront(wf);
        })
        .catch(() => {});
    }
  }, [activePresetId, timeS, inTauri, sourceRetryNonce]);

  const simulate = useCallback(
    (input: ScenarioInput) => {
      // A custom scenario supersedes any preset fetch already in flight.
      // Without this, a slow `run_preset` response can overwrite the custom
      // source after the user has moved on.
      runPresetReqIdRef.current += 1;
      setBusyPresetId(null);
      setActivePresetId(null);
      setLastCustomScenario(input);
      setSourceResult({ status: "loading" });
      setInitial(null);
      setWavefront(null);
      setSweSnapshot(null);
      setRunupResult({ status: "idle" });
      if (!inTauri) {
        simulateReqIdRef.current += 1;
        const reqId = simulateReqIdRef.current;
        void demoInitialForScenario(input)
          .then((d) => {
            if (!mountedRef.current || reqId !== simulateReqIdRef.current) return;
            setInitial(d);
            setSourceResult({ status: "ready", value: d });
            setWavefront(null);
            setSweSnapshot(null);
          })
          .catch((err) => {
            if (!mountedRef.current || reqId !== simulateReqIdRef.current) return;
            setSourceResult((current) => rejectAsyncResult(current, `Couldn't run browser physics: ${String(err)}`));
          });
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
              : input.kind === "Landslide"
                ? api.landslideInitialConditions(input.source)
                : api.meteotsunamiInitialConditions(input.source);
      route
        .then((d) => {
          if (!mountedRef.current || reqId !== simulateReqIdRef.current) return;
          setInitial(d);
          setSourceResult({ status: "ready", value: d });
          setWavefront(null);
          setSweSnapshot(null);
        })
        .catch((err) => {
          if (!mountedRef.current || reqId !== simulateReqIdRef.current) return;
          console.error(`${input.kind} initial_conditions failed`, err);
          setSourceResult((current) => rejectAsyncResult(current, `Couldn't simulate this ${input.kind.toLowerCase()} scenario: ${String(err)}`));
        });
    },
    [inTauri],
  );

  const retrySource = useCallback(() => {
    if (activePresetId) {
      setSourceRetryNonce((value) => value + 1);
    } else if (lastCustomScenario) {
      simulate(lastCustomScenario);
    }
  }, [activePresetId, lastCustomScenario, simulate]);

  // Reset SWE + runup when the source location/amplitude meaningfully
  // changes (a new scenario, not a timeline scrub).
  useEffect(() => {
    setSweSnapshot(null);
    setRunupResult({ status: "idle" });
  }, [initial?.center.lat_deg, initial?.center.lon_deg, initial?.peak_amplitude_m]);

  return {
    activePresetId,
    setActivePresetId,
    sourceResult,
    initial,
    wavefront,
    sweSnapshot,
    setSweSnapshot,
    runupResult,
    runupResults,
    setRunupResult,
    runupRetryNonce,
    retryRunup: () => setRunupRetryNonce((value) => value + 1),
    busyPresetId,
    simulate,
    lastCustomScenario,
    error: sourceResult.status === "error" || sourceResult.status === "stale" ? sourceResult.error : null,
    retrySource,
  };
}

/** Helper: find the Preset metadata for a slot's active id. */
export function presetById(presets: Preset[], id: string | null): Preset | null {
  return id ? presets.find((p) => p.id === id) ?? null : null;
}
