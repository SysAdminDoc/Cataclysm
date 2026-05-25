import { useCallback, useEffect, useRef, useState } from "react";
import { api, isTauri } from "../lib/tauri";
import type { GridSnapshot, InitialDisplacement } from "../types/scenario";

type Props = {
  initial: InitialDisplacement | null;
  onSnapshot?: (snap: GridSnapshot | null) => void;
};

type Status = "idle" | "running" | "ready" | "error";

/**
 * Drives the CPU shallow-water solver via the `simulate_grid` Tauri command
 * and renders a small control panel for kicking off / scrubbing through the
 * resulting snapshots. Snapshot PNG data flows to the parent via `onSnapshot`
 * so the Globe component can paint it as an imagery layer.
 *
 * Returns its own UI (button + scrubber) — placed in the right rail.
 */
export function SwePlayback({ initial, onSnapshot }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [snapshots, setSnapshots] = useState<GridSnapshot[] | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [useBathy, setUseBathy] = useState(true);
  const lastInitialRef = useRef<InitialDisplacement | null>(null);

  // Reset state when scenario changes.
  useEffect(() => {
    if (initial !== lastInitialRef.current) {
      lastInitialRef.current = initial;
      setStatus("idle");
      setSnapshots(null);
      setActiveIdx(0);
      onSnapshot?.(null);
    }
  }, [initial, onSnapshot]);

  // Push the currently-scrubbed snapshot up.
  useEffect(() => {
    if (snapshots && snapshots[activeIdx]) {
      onSnapshot?.(snapshots[activeIdx]);
    }
  }, [snapshots, activeIdx, onSnapshot]);

  const run = useCallback(async () => {
    if (!initial || !isTauri()) return;
    setStatus("running");
    setErrMsg(null);
    try {
      // Box half-size scales with the source cavity so small impacts get a
      // tight grid and ocean-scale impacts get a wider one. Clamp 2°–25°.
      const halfDeg = Math.min(
        25,
        Math.max(2, (initial.cavity_radius_m / 1000) * 0.05 + 4),
      );
      const sigmaM = Math.max(initial.cavity_radius_m, 5000);
      const resp = await api.simulateGrid({
        source: initial.center,
        initial_amplitude_m: initial.peak_amplitude_m,
        source_sigma_m: sigmaM,
        mean_depth_m: Math.max(initial.center.depth_m ?? 4000, 50),
        use_real_bathymetry: useBathy,
        box_half_size_deg: halfDeg,
        cells_per_deg: 6,
        t_end_s: 60 * 60, // 1 simulated hour
        n_snapshots: 24,
      });
      setSnapshots(resp.snapshots);
      setActiveIdx(0);
      setStatus("ready");
    } catch (err) {
      console.error("simulate_grid failed", err);
      setErrMsg(String(err));
      setStatus("error");
    }
  }, [initial, useBathy]);

  if (!initial) return null;

  return (
    <div className="section">
      <div className="section__title">Live SWE Solver (CPU)</div>
      <p className="swe__hint">
        Run a real shallow-water-equation propagation around the source.
        Uniform-depth approximation; coastal bathymetry lands in v0.3.0.
      </p>
      <label className="swe__check">
        <input
          type="checkbox"
          checked={useBathy}
          onChange={(e) => setUseBathy(e.target.checked)}
        />
        <span>Use coarse offline bathymetry (basin-mean + shelf taper)</span>
      </label>
      <div className="swe__row">
        <button
          className="primary"
          onClick={run}
          disabled={status === "running" || !isTauri()}
          style={{ flex: 1 }}
        >
          {status === "running" ? "Computing…" : status === "ready" ? "Re-run" : "Run simulation"}
        </button>
      </div>
      {status === "error" && (
        <div className="swe__error">{errMsg ?? "Simulation failed."}</div>
      )}
      {snapshots && snapshots.length > 1 && (
        <>
          <input
            type="range"
            min={0}
            max={snapshots.length - 1}
            step={1}
            value={activeIdx}
            onChange={(e) => setActiveIdx(Number(e.target.value))}
          />
          <div className="swe__readout">
            <span>frame {activeIdx + 1}/{snapshots.length}</span>
            <span>t = {(snapshots[activeIdx].time_s / 60).toFixed(1)} min</span>
            <span>|η|max = {snapshots[activeIdx].eta_abs_max_m.toFixed(2)} m</span>
          </div>
        </>
      )}
      {!isTauri() && (
        <div className="swe__error">Solver requires the Tauri runtime.</div>
      )}
    </div>
  );
}
