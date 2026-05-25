import { useEffect, useMemo, useRef } from "react";
import { api, isTauri, type RunupAtPointResult } from "../lib/tauri";
import type { CoastalPoint, CoastalPointDatabase, InitialDisplacement, Preset } from "../types/scenario";
import coastalDb from "../data/coastal_points.json";

type Props = {
  initial: InitialDisplacement | null;
  activePreset: Preset | null;
  timeS: number;
  onResults: (results: RunupAtPointResult[]) => void;
};

const db = coastalDb as CoastalPointDatabase;

/**
 * Hidden React component that runs the runup_at_points Tauri command whenever
 * the scenario or time changes, and pushes the results back to its parent (so
 * the Globe component can render them as 3D bars). No DOM output of its own.
 *
 * Uses a monotonic request id to drop stale responses on rapid scrubbing,
 * and a mounted ref to avoid setting state on an unmounted component.
 */
export function CoastalRunupOverlay({ initial, activePreset, timeS, onResults }: Props) {
  const reqIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const isImpact = useMemo<boolean>(() => {
    if (!activePreset) return false;
    return activePreset.source.kind === "Asteroid";
  }, [activePreset]);

  useEffect(() => {
    if (!isTauri() || !initial) {
      onResults([]);
      return;
    }
    reqIdRef.current += 1;
    const reqId = reqIdRef.current;
    const points: CoastalPoint[] = db.points;
    api
      .runupAtPoints({
        source: initial.center,
        initial_amplitude_m: initial.peak_amplitude_m,
        cavity_radius_m: initial.cavity_radius_m,
        is_impact: isImpact,
        mean_depth_m: 4000,
        time_s: timeS,
        points,
      })
      .then((res) => {
        if (!mountedRef.current || reqId !== reqIdRef.current) return;
        onResults(res);
      })
      .catch((err) => {
        if (!mountedRef.current || reqId !== reqIdRef.current) return;
        console.error("runup_at_points failed", err);
        onResults([]);
      });
  }, [initial, isImpact, timeS, onResults]);

  return null;
}
