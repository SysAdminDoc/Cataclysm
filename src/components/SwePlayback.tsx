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
 */
export function SwePlayback({ initial, onSnapshot }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [snapshots, setSnapshots] = useState<GridSnapshot[] | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [useBathy, setUseBathy] = useState(true);
  const [includeLambWave, setIncludeLambWave] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [diag, setDiag] = useState<{ dt_s: number; nx: number; ny: number } | null>(null);
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

  // Auto-play: advance the scrubber every 250 ms when playing.
  useEffect(() => {
    if (!isPlaying || !snapshots || snapshots.length < 2) return;
    const interval = window.setInterval(() => {
      setActiveIdx((i) => {
        const next = i + 1;
        if (next >= (snapshots?.length ?? 0)) {
          setIsPlaying(false);
          return i;
        }
        return next;
      });
    }, 250);
    return () => window.clearInterval(interval);
  }, [isPlaying, snapshots]);

  const run = useCallback(async () => {
    if (!initial || !isTauri()) return;
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
        include_lamb_wave: includeLambWave,
      });
      if (!mountedRef.current || reqId !== reqIdRef.current) return;
      setSnapshots(resp.snapshots);
      setDiag({ dt_s: resp.dt_s, nx: resp.nx, ny: resp.ny });
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
      <div className="section__title">Live SWE Solver (CPU)</div>
      <p className="swe__hint">
        Run a real shallow-water-equation propagation around the source.
        Offline-bathymetry toggle uses a coarse basin-mean + shelf-taper
        approximation; real GEBCO 2024 streaming lands in v0.3.0.
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
          disabled={status === "running" || !isTauri()}
          style={{ flex: 1 }}
        >
          {status === "running" ? "Computing…" : status === "ready" ? "Re-run" : "Run simulation"}
        </button>
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
              onClick={() => setIsPlaying((p) => !p)}
              disabled={status !== "ready"}
              style={{ flex: "0 0 auto" }}
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
              style={{ flex: 1 }}
              aria-label="Simulation timeline scrubber"
            />
          </div>
          <div className="swe__readout">
            <span>frame {activeIdx + 1}/{snapshots.length}</span>
            <span>t = {(snapshots[activeIdx].time_s / 60).toFixed(1)} min</span>
            <span>|η|max = {snapshots[activeIdx].eta_abs_max_m.toFixed(2)} m</span>
          </div>
          {diag && (
            <div className="swe__readout" style={{ color: "var(--overlay)" }}>
              <span>Δt = {diag.dt_s.toFixed(2)} s</span>
              <span>grid {diag.nx}×{diag.ny}</span>
              <span>{(diag.nx * diag.ny).toLocaleString()} cells</span>
            </div>
          )}
        </>
      )}
      {!isTauri() && (
        <div className="swe__error">Solver requires the Tauri runtime.</div>
      )}
    </div>
  );
}
