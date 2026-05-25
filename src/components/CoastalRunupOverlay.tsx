import { useEffect, useMemo, useRef, useState } from "react";
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

// Defensive filter: a corrupted bundled JSON (or a future schema change) with
// out-of-range lat/lon would silently nuke the haversine math in the Rust
// command. Drop bad points up front so the rest of the database still works.
const VALID_POINTS: CoastalPoint[] = db.points.filter(
  (p) =>
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lon) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lon >= -180 &&
    p.lon <= 180 &&
    Number.isFinite(p.beach_slope_deg) &&
    Number.isFinite(p.offshore_depth_m),
);

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
  const lastArrivedCountRef = useRef(0);
  const [announcement, setAnnouncement] = useState<string>("");

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
      lastArrivedCountRef.current = 0;
      setAnnouncement("");
      return;
    }
    reqIdRef.current += 1;
    const reqId = reqIdRef.current;
    const points: CoastalPoint[] = VALID_POINTS;
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
        onResults([]);
      });
  }, [initial, isImpact, timeS, onResults]);

  // Screen-reader-only aria-live region. Visually hidden via the global
  // `.sr-only` utility class (styles.css). Sighted users get the same
  // information visually from the 3D bars on the globe.
  return (
    <div role="status" aria-live="polite" className="sr-only">
      {announcement}
    </div>
  );
}
