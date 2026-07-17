import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { api, isTauri, type RunupAtPointResult } from "../lib/tauri";
import { getCoastalPoints } from "../lib/data";
import { demoRunupAtPoints } from "../lib/demo";
import type { CoastalPoint, InitialDisplacement, Preset } from "../types/scenario";
import {
  rejectAsyncResult,
  resolveAsyncResult,
  startAsyncResult,
  type AsyncResult,
} from "../lib/async-result";

type Props = {
  initial: InitialDisplacement | null;
  activePreset: Preset | null;
  sourceKind?: "Asteroid" | "Nuclear" | "Earthquake" | "Landslide" | "Meteotsunami" | null;
  timeS: number;
  result: AsyncResult<RunupAtPointResult[]>;
  onResult: Dispatch<SetStateAction<AsyncResult<RunupAtPointResult[]>>>;
  retryNonce?: number;
};

// Coastal points + integrity filter live in lib/data.ts (I4-05).
const VALID_POINTS: readonly CoastalPoint[] = getCoastalPoints();

/**
 * Hidden React component that runs the runup_at_points Tauri command whenever
 * the scenario or time changes, and pushes the results back to its parent (so
 * the Globe component can render them as 3D bars). No DOM output of its own.
 *
 * Uses a monotonic request id to drop stale responses on rapid scrubbing,
 * and a mounted ref to avoid setting state on an unmounted component.
 */
export function CoastalRunupOverlay({ initial, activePreset, sourceKind, timeS, result, onResult, retryNonce = 0 }: Props) {
  const reqIdRef = useRef(0);
  const mountedRef = useRef(true);
  const lastArrivedCountRef = useRef(0);
  const [announcement, setAnnouncement] = useState<string>("");
  const contextRef = useRef<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const isImpact = useMemo<boolean>(() => {
    return sourceKind === "Asteroid" || activePreset?.source.kind === "Asteroid";
  }, [activePreset, sourceKind]);
  const isMovingPressure = sourceKind === "Meteotsunami"
    || activePreset?.source.kind === "Meteotsunami";

  useEffect(() => {
    if (!initial || isMovingPressure) {
      contextRef.current = null;
      onResult({ status: "idle" });
      lastArrivedCountRef.current = 0;
      setAnnouncement("");
      return;
    }
    const context = [
      initial.center.lat_deg,
      initial.center.lon_deg,
      initial.peak_amplitude_m,
      initial.cavity_radius_m,
      isImpact,
    ].join(":");
    const retainPrevious = contextRef.current === context;
    contextRef.current = context;
    onResult((current) => startAsyncResult(current, retainPrevious));
    reqIdRef.current += 1;
    const reqId = reqIdRef.current;
    const points: CoastalPoint[] = [...VALID_POINTS];
    if (!isTauri()) {
      void demoRunupAtPoints({
        source: initial.center,
        initial_amplitude_m: initial.peak_amplitude_m,
        cavity_radius_m: initial.cavity_radius_m,
        is_impact: isImpact,
        mean_depth_m: 4000,
        time_s: timeS,
        points,
      }).then((res) => {
        if (reqId !== reqIdRef.current) return;
        onResult(resolveAsyncResult(res as RunupAtPointResult[], (items) => items.length === 0));
        const arrived = res.filter((r) => r.has_arrived && r.runup_m >= 0.1).length;
        lastArrivedCountRef.current = arrived;
        setAnnouncement(
          arrived > 0
            ? `Tsunami wave has reached ${arrived} coastal ${arrived === 1 ? "point" : "points"}.`
            : "",
        );
      }).catch((error) => {
        if (reqId === reqIdRef.current) onResult((current) => rejectAsyncResult(current, error));
      });
      return;
    }
    api
      .runupAtPoints({
        source: initial.center,
        initial_amplitude_m: initial.peak_amplitude_m,
        cavity_radius_m: initial.cavity_radius_m,
        is_impact: isImpact,
        mean_depth_m: 4000,
        time_s: timeS,
        point_ids: points.map((point) => point.id),
      })
      .then((res) => {
        if (!mountedRef.current || reqId !== reqIdRef.current) return;
        onResult(resolveAsyncResult(res, (items) => items.length === 0));
        const arrived = res.filter((r) => r.has_arrived && r.runup_m >= 0.1).length;
        if (arrived !== lastArrivedCountRef.current) {
          lastArrivedCountRef.current = arrived;
          if (arrived === 0) {
            setAnnouncement("");
          } else {
            setAnnouncement(
              `Tsunami wave has reached ${arrived} coastal ${arrived === 1 ? "point" : "points"}.`,
            );
          }
        }
      })
      .catch((err) => {
        if (!mountedRef.current || reqId !== reqIdRef.current) return;
        console.error("runup_at_points failed", err);
        onResult((current) => rejectAsyncResult(current, err));
      });
  }, [initial, isImpact, isMovingPressure, timeS, retryNonce, onResult]);

  // Screen-reader-only aria-live region. Visually hidden via the global
  // `.sr-only` utility class (styles.css). Sighted users get the same
  // information visually from the 3D bars on the globe.
  return (
    <div role="status" aria-live="polite" className="sr-only">
      {result.status === "loading"
        ? result.previous ? "Refreshing coastal screening; current results remain visible." : "Computing coastal screening."
        : result.status === "stale"
          ? `Coastal screening is stale: ${result.error}`
          : result.status === "error"
            ? `Coastal screening failed: ${result.error}`
            : announcement}
    </div>
  );
}
