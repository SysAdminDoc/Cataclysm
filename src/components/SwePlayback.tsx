import { useCallback, useEffect, useRef, useState } from "react";
import { api, isTauri } from "../lib/tauri";
import { settings } from "../lib/settings";
import { simulateDemoGrid } from "../lib/demo";
import type { GridSnapshot, InitialDisplacement } from "../types/scenario";
import { UiIcon } from "./UiIcon";

type Props = {
  initial: InitialDisplacement | null;
  onSnapshot?: (snap: GridSnapshot | null) => void;
  onSnapshotsReady?: (snaps: GridSnapshot[] | null) => void;
};

type Status = "idle" | "running" | "ready" | "error";

/**
 * Drives the CPU shallow-water solver via the `simulate_grid` Tauri command
 * and renders a small control panel for kicking off / scrubbing through the
 * resulting snapshots. Snapshot PNG data flows to the parent via `onSnapshot`
 * so the Globe component can paint it as an imagery layer.
 */
const N_SNAPSHOTS = 24;
const SPEED_OPTIONS = [
  { label: "0.5×", ms: 500 },
  { label: "1×", ms: 250 },
  { label: "2×", ms: 125 },
  { label: "4×", ms: 62 },
] as const;

export function SwePlayback({ initial, onSnapshot, onSnapshotsReady }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [snapshots, setSnapshots] = useState<GridSnapshot[] | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [useBathy, setUseBathy] = useState(true);
  const [includeLambWave, setIncludeLambWave] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  const [cellsPerDeg, setCellsPerDeg] = useState(6);
  const [streamProgress, setStreamProgress] = useState(0);
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
      onSnapshotsReady?.(null);
    }
  }, [initial, onSnapshot, onSnapshotsReady]);

  // Push the currently-scrubbed snapshot up.
  useEffect(() => {
    if (snapshots && snapshots[activeIdx]) {
      onSnapshot?.(snapshots[activeIdx]);
    }
  }, [snapshots, activeIdx, onSnapshot]);

  useEffect(() => {
    if (!isPlaying || !snapshots || snapshots.length < 2) return;
    const interval = window.setInterval(() => {
      setActiveIdx((i) => Math.min(i + 1, snapshots.length - 1));
    }, SPEED_OPTIONS[speedIdx].ms);
    return () => window.clearInterval(interval);
  }, [isPlaying, snapshots, speedIdx]);

  // Stop playback when the scrubber reaches the final frame.
  useEffect(() => {
    if (isPlaying && snapshots && activeIdx >= snapshots.length - 1) {
      setIsPlaying(false);
    }
  }, [isPlaying, snapshots, activeIdx]);

  const cancel = useCallback(() => {
    reqIdRef.current += 1;
    if (isTauri()) {
      api.cancelSimulation().catch(() => {});
    }
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
    setStreamProgress(0);
    try {
      const halfDeg = Math.min(
        25,
        Math.max(2, (initial.cavity_radius_m / 1000) * 0.05 + 4),
      );
      const sigmaM = Math.max(initial.cavity_radius_m, 5000);
      const colormap = await settings.getColormap();
      const gridReq = {
        source: initial.center,
        initial_amplitude_m: initial.peak_amplitude_m,
        source_sigma_m: sigmaM,
        mean_depth_m: Math.max(initial.center.depth_m ?? 4000, 50),
        use_real_bathymetry: useBathy,
        box_half_size_deg: halfDeg,
        cells_per_deg: cellsPerDeg,
        t_end_s: 60 * 60,
        n_snapshots: N_SNAPSHOTS,
        include_lamb_wave: includeLambWave,
        colormap,
      };
      if (isTauri()) {
        const streamSnaps: GridSnapshot[] = [];
        const meta = await api.simulateGridStreaming(gridReq, (snap) => {
          if (!mountedRef.current || reqId !== reqIdRef.current) return;
          streamSnaps.push(snap);
          setSnapshots([...streamSnaps]);
          setActiveIdx(streamSnaps.length - 1);
          setStreamProgress(streamSnaps.length);
          onSnapshot?.(snap);
        });
        if (!mountedRef.current || reqId !== reqIdRef.current) return;
        setDiag({ dt_s: meta.dt_s, nx: meta.nx, ny: meta.ny, used_gpu: meta.used_gpu });
        setActiveIdx(0);
        setStatus("ready");
        onSnapshotsReady?.(streamSnaps);
      } else {
        const resp = simulateDemoGrid(initial, {
          boxHalfSizeDeg: halfDeg,
          nSnapshots: N_SNAPSHOTS,
          tEndS: 60 * 60,
          includeLambWave,
        });
        if (!mountedRef.current || reqId !== reqIdRef.current) return;
        setSnapshots(resp.snapshots);
        setDiag({ dt_s: resp.dt_s, nx: resp.nx, ny: resp.ny, used_gpu: resp.used_gpu ?? false });
        setActiveIdx(0);
        setStatus("ready");
        onSnapshotsReady?.(resp.snapshots);
      }
    } catch (err) {
      if (!mountedRef.current || reqId !== reqIdRef.current) return;
      console.error("simulate_grid failed", err);
      setErrMsg(String(err));
      setStatus("error");
    }
  }, [initial, useBathy, includeLambWave, cellsPerDeg, onSnapshot, onSnapshotsReady]);

  if (!initial) return null;

  return (
    <div className="section">
      <div className="section__title">
        <span>Live SWE Solver</span>
        <span className="section__badge">{diag?.used_gpu ? "GPU" : "CPU"}</span>
      </div>
      <p className="swe__hint">
        Run a shallow-water-equation propagation around the source.
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
      <label className="swe__check swe__resolution">
        <span>Resolution: {cellsPerDeg} cells/° ({cellsPerDeg <= 4 ? "fast preview" : cellsPerDeg >= 10 ? "high fidelity" : "balanced"})</span>
        <input
          type="range"
          min={3}
          max={12}
          step={1}
          value={cellsPerDeg}
          onChange={(e) => setCellsPerDeg(Number(e.target.value))}
          aria-label="Grid resolution in cells per degree"
          title="Higher resolution is more accurate but slower. Default is 6."
        />
      </label>
      <div className="swe__row">
        <button
          className="primary"
          onClick={run}
          disabled={status === "running"}
          type="button"
        >
          {status === "running" ? "Computing..." : status === "ready" ? "Re-run" : "Run simulation"}
        </button>
        {status === "running" && (
          <button
            onClick={cancel}
            title="Cancel the in-flight simulation and return to idle."
            type="button"
          >
            Cancel
          </button>
        )}
      </div>
      {status === "running" && (
        <div className="swe__run-state" role="status" aria-live="polite">
          <span>Streaming frame {streamProgress} / {N_SNAPSHOTS}</span>
          <div className="swe__progress" aria-hidden>
            <span style={{ width: `${(streamProgress / N_SNAPSHOTS) * 100}%` }} />
          </div>
        </div>
      )}
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
              type="button"
            >
              {isPlaying ? (
                <>
                  <UiIcon name="pause" size={14} />
                  Pause
                </>
              ) : (
                <>
                  <UiIcon name="play" size={14} />
                  Play
                </>
              )}
            </button>
            <select
              className="swe__speed"
              value={speedIdx}
              onChange={(e) => setSpeedIdx(Number(e.target.value))}
              aria-label="Playback speed"
              title="Playback speed"
            >
              {SPEED_OPTIONS.map((opt, i) => (
                <option key={opt.label} value={i}>{opt.label}</option>
              ))}
            </select>
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
