import { useCallback, useEffect, useRef, useState } from "react";
import { api, isTauri } from "../lib/tauri";
import { simulateDemoGrid } from "../lib/demo";
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
 */
export function SwePlayback({ initial, onSnapshot }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [snapshots, setSnapshots] = useState<GridSnapshot[] | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [useBathy, setUseBathy] = useState(true);
  const [includeLambWave, setIncludeLambWave] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [diag, setDiag] = useState<{ dt_s: number; nx: number; ny: number; used_gpu: boolean } | null>(null);
  const lastInitialRef = useRef<InitialDisplacement | null>(null);
  const reqIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Reset state when scenario changes.
  useEffect(() => {
    if (initial !== lastInitialRef.current) {
      lastInitialRef.current = initial;
      setStatus("idle");
      setSnapshots(null);
      setActiveIdx(0);
      setIsPlaying(false);
      setDiag(null);
      onSnapshot?.(null);
    }
  }, [initial, onSnapshot]);

  // Push the currently-scrubbed snapshot up.
  useEffect(() => {
    if (snapshots && snapshots[activeIdx]) {
      onSnapshot?.(snapshots[activeIdx]);
    }
  }, [snapshots, activeIdx, onSnapshot]);

  // Auto-play: advance the scrubber every 250 ms when playing. The updater
  // stays pure (no nested setState) — reaching the end is handled by the
  // separate effect below so it behaves correctly under StrictMode.
  useEffect(() => {
    if (!isPlaying || !snapshots || snapshots.length < 2) return;
    const interval = window.setInterval(() => {
      setActiveIdx((i) => Math.min(i + 1, snapshots.length - 1));
    }, 250);
    return () => window.clearInterval(interval);
  }, [isPlaying, snapshots]);

  // Stop playback when the scrubber reaches the final frame.
  useEffect(() => {
    if (isPlaying && snapshots && activeIdx >= snapshots.length - 1) {
      setIsPlaying(false);
    }
  }, [isPlaying, snapshots, activeIdx]);

  // Cancel an in-flight simulation. The Tauri worker keeps running
  // to completion (the IPC layer has no cancel signal), but bumping
  // `reqIdRef` causes the response to be ignored on arrival and the
  // UI returns to idle immediately so the user can re-configure.
  const cancel = useCallback(() => {
    reqIdRef.current += 1;
    setStatus("idle");
    setErrMsg(null);
    setIsPlaying(false);
  }, []);

  const run = useCallback(async () => {
    if (!initial) return;
    reqIdRef.current += 1;
    const reqId = reqIdRef.current;
    setStatus("running");
    setErrMsg(null);
    setIsPlaying(false);
    try {
      // Box half-size scales with the source cavity so small impacts get a
      // tight grid and ocean-scale impacts get a wider one. Clamp 2°–25°.
      const halfDeg = Math.min(
        25,
        Math.max(2, (initial.cavity_radius_m / 1000) * 0.05 + 4),
      );
      const sigmaM = Math.max(initial.cavity_radius_m, 5000);
      const resp = isTauri()
        ? await api.simulateGrid({
            source: initial.center,
            initial_amplitude_m: initial.peak_amplitude_m,
            source_sigma_m: sigmaM,
            mean_depth_m: Math.max(initial.center.depth_m ?? 4000, 50),
            use_real_bathymetry: useBathy,
            box_half_size_deg: halfDeg,
            cells_per_deg: 6,
            t_end_s: 60 * 60, // 1 simulated hour
            n_snapshots: 24,
            include_lamb_wave: includeLambWave,
          })
        : simulateDemoGrid(initial, {
            boxHalfSizeDeg: halfDeg,
            nSnapshots: 24,
            tEndS: 60 * 60,
            includeLambWave,
          });
      if (!mountedRef.current || reqId !== reqIdRef.current) return;
      setSnapshots(resp.snapshots);
      setDiag({ dt_s: resp.dt_s, nx: resp.nx, ny: resp.ny, used_gpu: resp.used_gpu ?? false });
      setActiveIdx(0);
      setStatus("ready");
    } catch (err) {
      if (!mountedRef.current || reqId !== reqIdRef.current) return;
      console.error("simulate_grid failed", err);
      setErrMsg(String(err));
      setStatus("error");
    }
  }, [initial, useBathy, includeLambWave]);

  if (!initial) return null;

  return (
    <div className="section">
      <div className="section__title">
        Live SWE Solver {diag?.used_gpu ? "(GPU)" : "(CPU)"}
      </div>
      <p className="swe__hint">
        Run a real shallow-water-equation propagation around the source.
        Offline-bathymetry toggle uses a coarse basin-mean + shelf-taper
        approximation; browser preview uses deterministic demo frames.
      </p>
      <label className="swe__check">
        <input
          type="checkbox"
          checked={useBathy}
          onChange={(e) => setUseBathy(e.target.checked)}
        />
        <span>Use coarse offline bathymetry (basin-mean + shelf taper)</span>
      </label>
      <label className="swe__check">
        <input
          type="checkbox"
          checked={includeLambWave}
          onChange={(e) => setIncludeLambWave(e.target.checked)}
        />
        <span>
          Include atmospheric Lamb-wave forcing (Hunga Tonga only — Carvajal 2022, Matoza 2022)
        </span>
      </label>
      <div className="swe__row">
        <button
          className="primary"
          onClick={run}
          disabled={status === "running"}
        >
          {status === "running" ? "Computing…" : status === "ready" ? "Re-run" : "Run simulation"}
        </button>
        {status === "running" && (
          <button
            onClick={cancel}
            title="Cancel the in-flight simulation and return to idle. The worker keeps running in the background but its result will be dropped."
          >
            Cancel
          </button>
        )}
      </div>
      {status === "error" && (
        <div className="swe__error" role="status" aria-live="polite">
          {errMsg ?? "Simulation failed."}
        </div>
      )}
      {snapshots && snapshots.length > 1 && (
        <>
          <div className="swe__row">
            <button
              onClick={() => {
                // Pressing Play at the final frame restarts from the top
                // instead of silently no-opping.
                if (!isPlaying && activeIdx >= snapshots.length - 1) {
                  setActiveIdx(0);
                }
                setIsPlaying((p) => !p);
              }}
              disabled={status === "running" || snapshots.length < 2}
              title="Play / pause the snapshot sequence"
            >
              {isPlaying ? "❚❚ Pause" : "▶ Play"}
            </button>
            <input
              type="range"
              min={0}
              max={snapshots.length - 1}
              step={1}
              value={activeIdx}
              onChange={(e) => {
                setIsPlaying(false);
                setActiveIdx(Number(e.target.value));
              }}
              aria-label="Simulation timeline scrubber"
            />
          </div>
          <div className="swe__readout">
            <span>frame {activeIdx + 1}/{snapshots.length}</span>
            <span>t = {(snapshots[activeIdx].time_s / 60).toFixed(1)} min</span>
            <span>|η|max = {snapshots[activeIdx].eta_abs_max_m.toFixed(2)} m</span>
          </div>
          {diag && (
            <div className="swe__readout swe__readout--muted">
              <span>Δt = {diag.dt_s.toFixed(2)} s</span>
              <span>grid {diag.nx}×{diag.ny}</span>
              <span>{(diag.nx * diag.ny).toLocaleString()} cells</span>
              <span>{diag.used_gpu ? "GPU (wgpu)" : "CPU (rayon)"}</span>
            </div>
          )}
        </>
      )}
      {!isTauri() && (
        <div className="swe__error">Browser preview: demo SWE frames, not backend physics.</div>
      )}
    </div>
  );
}
