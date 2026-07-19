import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api, createSimulationRunId, isTauri, type ImportedBathymetryAsset, type RecoveredGaugeHistoryFrame, type SolverCheckpointSummary } from "../lib/tauri";
import { settings } from "../lib/settings";
import { simulateDemoGrid, sampleGaugesFromDemo } from "../lib/demo";
import { exportFailureLabel, exportGaugeCsv, type ExportResult } from "../lib/export";
import type { RenderFrameProvenance } from "../lib/model-provenance";
import type { Gauge, GaugeTimeSeries, GridSnapshot, InitialDisplacement, MaxFieldProduct, RunQualityRecord, ScientificExportDescriptor } from "../types/scenario";
import { UiIcon } from "./UiIcon";
import type { WorkspaceMode, ColormapId } from "../lib/settings";
import { GlossaryTip } from "./GlossaryTip";
import { SemanticDataTable, type SemanticDataRow } from "./SemanticDataTable";
import { useI18n } from "../lib/i18n";
import type { MessageKey } from "../lib/i18n-core";
import { notifyRunComplete } from "../lib/notify";
import PRODUCT_TRUTH from "../data/product-truth.json";
import { useUnits } from "../hooks/useUnits";
import { formatLength, quantityText } from "../lib/units";

type Props = {
  initial: InitialDisplacement | null;
  onSnapshot?: (snap: GridSnapshot | null) => void;
  onSnapshotsReady?: (snaps: GridSnapshot[] | null) => void;
  /** Publishes user-created gauges so the globe can render one batched point layer. */
  onGaugesChange?: (gauges: Gauge[]) => void;
  pendingGauge?: { lat: number; lon: number } | null;
  /** DART buoys for the active preset. Sampled as hidden `dart-<id>` gauge
   *  points so the overlay can compute model-vs-observed RMSE. */
  dartBuoys?: Array<{ id: string | number; lat: number; lon: number }>;
  /** Fires when a completed run yields max-field products (or null on
   *  reset). App uses this for GeoJSON export enrichment. */
  onMaxField?: (product: MaxFieldProduct | null) => void;
  onRunQuality?: (quality: RunQualityRecord | null) => void;
  onScientificExport?: (descriptor: ScientificExportDescriptor | null, error: string | null) => void;
  /** Fires with the colormap this run's overlay was rendered in, so the
   *  viewport legend can match the actual overlay rather than a fixed ramp. */
  onColormap?: (id: ColormapId) => void;
  /** Fires with the arrival-time contours when the "Arrivals" toggle is on
   *  (null when off or reset). App routes these to the globe layer. */
  onIsochrones?: (isochrones: import("../types/scenario").Isochrone[] | null) => void;
  onRenderFrame?: (frame: RenderFrameProvenance | null) => void;
  playbackTimeS?: number;
  onPlaybackTimeChange?: (timeS: number) => void;
  slotLabel?: string;
  runAndWatchNonce?: number;
  workspaceMode?: WorkspaceMode;
};

type OverlayChoice = "wave" | "peak" | "t_of_max" | "energy";

const OVERLAY_OPTIONS: Array<{ id: OverlayChoice; labelKey: MessageKey; titleKey: MessageKey }> = [
  { id: "wave", labelKey: "swe.wave", titleKey: "swe.waveTitle" },
  { id: "peak", labelKey: "swe.peak", titleKey: "swe.peakTitle" },
  { id: "t_of_max", labelKey: "swe.tMax", titleKey: "swe.tMaxTitle" },
  { id: "energy", labelKey: "swe.energy", titleKey: "swe.energyTitle" },
];

/** Wrap a max-field PNG as a snapshot-shaped object so the existing globe
 *  imagery pipeline renders it unchanged. */
function overlaySnapshot(product: MaxFieldProduct, choice: OverlayChoice): GridSnapshot {
  const png =
    choice === "peak"
      ? product.peak_png_b64
      : choice === "t_of_max"
        ? product.t_of_max_png_b64
        : product.energy_png_b64;
  return {
    time_s: product.t_end_s,
    bbox: product.bbox,
    nx: product.nx,
    ny: product.ny,
    height_field: product.peak_height_field,
    eta_min_m: 0,
    eta_max_m: product.peak_abs_max_m,
    eta_abs_max_m: product.peak_abs_max_m,
    eta_png_b64: png,
    field_tiles: product.field_tiles?.map((tile) => ({
      column_offset: tile.column_offset,
      column_count: tile.column_count,
      bbox: tile.bbox,
      eta_png_b64: choice === "peak"
        ? tile.peak_png_b64
        : choice === "t_of_max"
          ? tile.t_of_max_png_b64
          : tile.energy_png_b64,
    })),
  };
}

type Status = "idle" | "running" | "ready" | "stale" | "error";

/**
 * Drives the CPU shallow-water solver via the `simulate_grid` Tauri command
 * and renders a small control panel for kicking off / scrubbing through the
 * resulting snapshots. Snapshot PNG data flows to the parent via `onSnapshot`
 * so the Globe component can paint it as an imagery layer.
 */
// 60 snapshots over the 1-hour window give visibly smoother wave motion than
// the old 24 (this only changes sampling cadence, not solver work).
const N_SNAPSHOTS = PRODUCT_TRUTH.simulation.defaultPlaybackFrames;
const SPEED_OPTIONS = [
  { label: "0.5×", ms: 320 },
  { label: "1×", ms: 160 },
  { label: "2×", ms: 80 },
  { label: "4×", ms: 40 },
] as const;
const BROWSER_PREVIEW_FIELD_WARNING = "Browser preview SWE fields remain illustrative; source and screening physics use Rust/WASM.";

function initialIdentity(initial: InitialDisplacement | null): string | null {
  if (!initial) return null;
  return JSON.stringify([
    initial.center.lat_deg,
    initial.center.lon_deg,
    initial.center.depth_m ?? null,
    initial.peak_amplitude_m,
    initial.cavity_radius_m,
    initial.source_energy_j,
    initial.source_geometry ?? null,
    initial.meteotsunami_forcing ?? null,
  ]);
}

function seriesFromBackendSamples(
  gauges: Gauge[],
  frames: Array<Pick<GridSnapshot, "time_s" | "gauge_samples">>,
): GaugeTimeSeries[] {
  return gauges
    .map((gauge) => {
      const samplesByTime = new Map<number, number>();
      for (const frame of frames) {
        const sample = frame.gauge_samples?.find((candidate) => candidate.id === gauge.id);
        if (sample && Number.isFinite(sample.eta_m)) {
          samplesByTime.set(frame.time_s, sample.eta_m as number);
        }
      }
      const samples = [...samplesByTime]
        .sort(([left], [right]) => left - right)
        .map(([time_s, eta_m]) => ({ time_s, eta_m }));
      return { gauge, samples };
    })
    .filter((series) => series.samples.length > 0);
}

function gaugeCoordinateError(
  draft: string,
  label: string,
  min: number,
  max: number,
  t: ReturnType<typeof useI18n>["t"],
): string | null {
  if (draft.trim() === "") return null;
  const value = Number(draft);
  if (!Number.isFinite(value)) return t("swe.coordinateNumber", { label });
  if (value < min || value > max) return t("swe.coordinateRange", { label, min, max });
  return null;
}

function localizeSolverWarning(warning: string, t: ReturnType<typeof useI18n>["t"]): string {
  if (warning === BROWSER_PREVIEW_FIELD_WARNING) {
    return t("swe.warningBrowserFields");
  }
  if (warning === "energy-conservation drift is not evaluated for prescribed external pressure forcing") {
    return t("swe.warningExternalPressure");
  }
  const mass = warning.match(/^sponge-adjusted mass drift is (.+)$/);
  if (mass) return t("swe.warningMassDrift", { value: mass[1] });
  const energy = warning.match(/^sponge-adjusted energy increased by (.+)$/);
  if (energy) return t("swe.warningEnergyDrift", { value: energy[1] });
  return warning;
}

export function SwePlayback({ initial, onSnapshot, onSnapshotsReady, onGaugesChange, pendingGauge, dartBuoys, onMaxField, onRunQuality, onScientificExport, onColormap, onIsochrones, onRenderFrame, playbackTimeS, onPlaybackTimeChange, slotLabel, runAndWatchNonce = 0, workspaceMode = "advanced" }: Props) {
  const { t, formatNumber } = useI18n();
  const unitSystem = useUnits();
  const [status, setStatus] = useState<Status>("idle");
  const [snapshots, setSnapshots] = useState<GridSnapshot[] | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [gaugeExportFailure, setGaugeExportFailure] = useState<Extract<ExportResult, { ok: false }> | null>(null);
  const [useBathy, setUseBathy] = useState(true);
  const [bathymetryAssets, setBathymetryAssets] = useState<ImportedBathymetryAsset[]>([]);
  const [bathymetryAssetId, setBathymetryAssetId] = useState("");
  const [bathymetryListError, setBathymetryListError] = useState<string | null>(null);
  const [checkpoints, setCheckpoints] = useState<SolverCheckpointSummary[]>([]);
  const [checkpointIntervalS, setCheckpointIntervalS] = useState(60);
  const [recoveredGaugeHistory, setRecoveredGaugeHistory] = useState<RecoveredGaugeHistoryFrame[]>([]);
  const [includeLambWave, setIncludeLambWave] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  // 8 cells/deg (up from 6) gives a finer wavefront and better coastline
  // capture; still well within the solver's cell/step budget for a 1-hour run.
  const [cellsPerDeg, setCellsPerDeg] = useState(8);
  const [streamProgress, setStreamProgress] = useState(0);
  const [diag, setDiag] = useState<{ dt_s: number; nx: number; ny: number; used_gpu: boolean; quality: RunQualityRecord } | null>(null);
  const [maxField, setMaxField] = useState<MaxFieldProduct | null>(null);
  const [overlay, setOverlay] = useState<OverlayChoice>("wave");
  const [showArrivals, setShowArrivals] = useState(false);
  const [gauges, setGauges] = useState<Gauge[]>([]);
  const [gaugeSeries, setGaugeSeries] = useState<GaugeTimeSeries[]>([]);
  const [gaugeLatInput, setGaugeLatInput] = useState("");
  const [gaugeLonInput, setGaugeLonInput] = useState("");
  const [gaugeNameInput, setGaugeNameInput] = useState("");
  const gaugeEntryId = useId();
  const gaugeLatError = gaugeCoordinateError(gaugeLatInput, t("swe.latitude"), -90, 90, t);
  const gaugeLonError = gaugeCoordinateError(gaugeLonInput, t("swe.longitude"), -180, 180, t);
  const gaugeCoordinatesValid = gaugeLatInput.trim() !== ""
    && gaugeLonInput.trim() !== ""
    && gaugeLatError === null
    && gaugeLonError === null;
  const lastInitialRef = useRef<string | null>(null);
  const reqIdRef = useRef(0);
  const runIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const gaugeCounter = useRef(0);
  const handledRunAndWatchNonce = useRef(0);

  const refreshCheckpoints = useCallback(() => {
    if (!isTauri()) return Promise.resolve();
    return api.listSolverCheckpoints()
      .then(setCheckpoints)
      .catch((error) => console.warn("[solver] failed to list checkpoints", error));
  }, []);

  useEffect(() => {
    void refreshCheckpoints();
  }, [refreshCheckpoints]);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    const refresh = () => {
      api.listImportedBathymetry()
        .then((assets) => {
          if (cancelled) return;
          setBathymetryAssets(assets);
          setBathymetryAssetId((current) => assets.some((asset) => asset.asset_id === current) ? current : "");
          setBathymetryListError(null);
        })
        .catch((cause) => {
          if (!cancelled) setBathymetryListError(cause instanceof Error ? cause.message : String(cause));
        });
    };
    refresh();
    window.addEventListener("cataclysm:bathymetry-cache-changed", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("cataclysm:bathymetry-cache-changed", refresh);
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      reqIdRef.current += 1;
      const runId = runIdRef.current;
      runIdRef.current = null;
      if (runId && isTauri()) {
        void api.cancelSimulation(runId).catch((err) =>
          console.warn("[solver] failed to cancel unmounted simulation", err),
        );
      }
    };
  }, []);

  // Reset state when scenario changes.
  useEffect(() => {
    const identity = initialIdentity(initial);
    if (identity !== lastInitialRef.current) {
      lastInitialRef.current = identity;
      reqIdRef.current += 1;
      const runId = runIdRef.current;
      runIdRef.current = null;
      if (runId && isTauri()) {
        void api.cancelSimulation(runId).catch((err) =>
          console.warn("[solver] failed to cancel replaced simulation", err),
        );
      }
      setStatus("idle");
      setSnapshots(null);
      setActiveIdx(0);
      setIsPlaying(false);
      setDiag(null);
      setMaxField(null);
      setOverlay("wave");
      setShowArrivals(false);
      setGauges([]);
      setGaugeSeries([]);
      gaugeCounter.current = 0;
      lastPendingRef.current = null;
      onGaugesChange?.([]);
      setRecoveredGaugeHistory([]);
      onSnapshot?.(null);
      onSnapshotsReady?.(null);
      onMaxField?.(null);
      onRunQuality?.(null);
      onScientificExport?.(null, null);
      onRenderFrame?.(null);
      // The bundled coarse bathymetry represents inland water at a nominal
      // 50 m and cannot reproduce Lake Superior's resonant depth. Start
      // moving-pressure scenarios on their declared uniform depth; users can
      // still select an imported high-resolution bathymetry asset explicitly.
      if (initial?.meteotsunami_forcing) setUseBathy(false);
    }
  }, [initial, onSnapshot, onSnapshotsReady, onGaugesChange, onMaxField, onRunQuality, onScientificExport, onRenderFrame]);

  useEffect(() => {
    onGaugesChange?.(gauges);
  }, [gauges, onGaugesChange]);

  // Publish the arrival contours to the globe when toggled.
  useEffect(() => {
    onIsochrones?.(showArrivals && maxField ? maxField.isochrones : null);
  }, [showArrivals, maxField, onIsochrones]);

  // Push the currently-scrubbed snapshot up — or, when a max-field overlay
  // is selected, its PNG wrapped in a snapshot shell (same globe pipeline).
  useEffect(() => {
    if (overlay !== "wave" && maxField) {
      onSnapshot?.(overlaySnapshot(maxField, overlay));
      return;
    }
    if (snapshots && snapshots[activeIdx]) {
      onSnapshot?.(snapshots[activeIdx]);
    }
  }, [snapshots, activeIdx, onSnapshot, overlay, maxField]);

  useEffect(() => {
    if (playbackTimeS === undefined || !snapshots?.length) return;
    let nearest = 0;
    let distance = Math.abs(snapshots[0].time_s - playbackTimeS);
    for (let index = 1; index < snapshots.length; index += 1) {
      const candidate = Math.abs(snapshots[index].time_s - playbackTimeS);
      if (candidate < distance) {
        nearest = index;
        distance = candidate;
      }
    }
    setActiveIdx(nearest);
  }, [playbackTimeS, snapshots]);

  // Scrubbing or playing always returns the view to the live wave field.
  useEffect(() => {
    if (isPlaying) setOverlay("wave");
  }, [isPlaying]);

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

  useEffect(() => {
    if (!initial || gauges.length === 0 || !snapshots) {
      setGaugeSeries([]);
      return;
    }
    if (isTauri()) {
      setGaugeSeries(seriesFromBackendSamples(gauges, [...recoveredGaugeHistory, ...snapshots]));
      return;
    }
    const tEndS = snapshots.length > 1 ? snapshots[snapshots.length - 1].time_s : 3600;
    const series = sampleGaugesFromDemo(initial, gauges, snapshots.length, tEndS);
    setGaugeSeries(series);
  }, [initial, gauges, snapshots, recoveredGaugeHistory]);

  const addGauge = useCallback(() => {
    const lat = Number(gaugeLatInput);
    const lon = Number(gaugeLonInput);
    if (!gaugeCoordinatesValid) return;
    gaugeCounter.current += 1;
    const name = gaugeNameInput.trim() || t("swe.gaugeNumber", { count: gaugeCounter.current });
    setGauges((prev) => [
      ...prev,
      { id: `gauge-${gaugeCounter.current}`, name, lat_deg: lat, lon_deg: lon },
    ]);
    setGaugeLatInput("");
    setGaugeLonInput("");
    setGaugeNameInput("");
  }, [gaugeCoordinatesValid, gaugeLatInput, gaugeLonInput, gaugeNameInput, t]);

  const removeGauge = useCallback((id: string) => {
    setGauges((prev) => prev.filter((g) => g.id !== id));
  }, []);

  const lastPendingRef = useRef<{ lat: number; lon: number } | null>(null);
  useEffect(() => {
    if (!pendingGauge) return;
    if (
      lastPendingRef.current &&
      lastPendingRef.current.lat === pendingGauge.lat &&
      lastPendingRef.current.lon === pendingGauge.lon
    ) return;
    lastPendingRef.current = pendingGauge;
    gaugeCounter.current += 1;
    const name = t("swe.inspectNumber", { count: gaugeCounter.current });
    setGauges((prev) => [
      ...prev,
      { id: `gauge-${gaugeCounter.current}`, name, lat_deg: pendingGauge.lat, lon_deg: pendingGauge.lon },
    ]);
  }, [pendingGauge, t]);

  const handleGaugeCsvExport = useCallback(() => {
    if (gaugeSeries.length === 0) return;
    const mode = isTauri() ? t("swe.backendSolver") : t("swe.browserApproximate");
    const selectedAsset = bathymetryAssets.find((asset) => asset.asset_id === bathymetryAssetId);
    const bathy = !useBathy
      ? t("swe.uniformDepth")
      : selectedAsset
        ? t("swe.localRasterExport", { file: selectedAsset.report.file_name, sha256: selectedAsset.report.sha256 })
        : t("swe.coarseBasinShelf");
    const result = exportGaugeCsv(gaugeSeries, mode, bathy, diag?.quality, unitSystem);
    setGaugeExportFailure(result.ok ? null : result);
  }, [bathymetryAssetId, bathymetryAssets, diag?.quality, gaugeSeries, unitSystem, useBathy, t]);

  const cancel = useCallback(() => {
    reqIdRef.current += 1;
    const runId = runIdRef.current;
    runIdRef.current = null;
    if (runId && isTauri()) {
      api
        .cancelSimulation(runId)
        .then(() => window.setTimeout(() => void refreshCheckpoints(), 750))
        .catch((err) => console.warn("[solver] failed to cancel active simulation", err));
    }
    setStatus("idle");
    setErrMsg(null);
    setIsPlaying(false);
    setSnapshots(null);
    setActiveIdx(0);
    setStreamProgress(0);
    setDiag(null);
    setMaxField(null);
    onSnapshot?.(null);
    onSnapshotsReady?.(null);
    onMaxField?.(null);
    onRunQuality?.(null);
    onScientificExport?.(null, null);
    onRenderFrame?.(null);
  }, [onSnapshot, onSnapshotsReady, onMaxField, onRunQuality, onScientificExport, onRenderFrame, refreshCheckpoints]);

  const run = useCallback(async (autoPlay = false, resumeRunId: string | null = null) => {
    if (!initial) return;
    const previousSnapshots = snapshots;
    const previousDiag = diag;
    const previousMaxField = maxField;
    const previousGaugeHistory = recoveredGaugeHistory;
    const previousQuality = diag?.quality ?? null;
    reqIdRef.current += 1;
    const reqId = reqIdRef.current;
    const previousRunId = runIdRef.current;
    if (previousRunId && isTauri()) {
      // Await the cancel so the backend cancellation flag is set before the new
      // run starts. Otherwise the superseded CPU worker keeps running to
      // completion alongside the new one, doubling compute for large grids.
      await api.cancelSimulation(previousRunId).catch((err) =>
        console.warn("[solver] failed to supersede active simulation", err),
      );
      if (reqId !== reqIdRef.current) return;
    }
    const runId = createSimulationRunId();
    runIdRef.current = isTauri() ? runId : null;
    setStatus("running");
    setErrMsg(null);
    setIsPlaying(false);
    onRenderFrame?.(null);
    setStreamProgress(0);
    if (!previousSnapshots) {
      setSnapshots(null);
      setActiveIdx(0);
      setDiag(null);
      setMaxField(null);
      setRecoveredGaugeHistory([]);
      onSnapshot?.(null);
      onSnapshotsReady?.(null);
      onMaxField?.(null);
      onRunQuality?.(null);
      onScientificExport?.(null, null);
    }
    try {
      const halfDeg = Math.min(
        25,
        Math.max(2, (initial.cavity_radius_m / 1000) * 0.05 + 4),
      );
      const sigmaM = Math.max(initial.cavity_radius_m, 5000);
      const colormap = await settings.getColormap();
      onColormap?.(colormap);
      const gridReq = {
        source: initial.center,
        initial_amplitude_m: initial.peak_amplitude_m,
        source_sigma_m: sigmaM,
        source_geometry: initial.source_geometry ?? null,
        mean_depth_m: Math.max(initial.center.depth_m ?? 4000, 50),
        use_real_bathymetry: useBathy,
        bathymetry_asset_id: useBathy && bathymetryAssetId ? bathymetryAssetId : null,
        box_half_size_deg: halfDeg,
        cells_per_deg: cellsPerDeg,
        t_end_s: 60 * 60,
        n_snapshots: N_SNAPSHOTS,
        include_lamb_wave: includeLambWave,
        meteotsunami_forcing: initial.meteotsunami_forcing ?? null,
        colormap,
        gauge_points: [
          ...gauges.map((g) => ({
            id: g.id,
            lat_deg: g.lat_deg,
            lon_deg: g.lon_deg,
          })),
          // Hidden sample points at DART buoy positions; consumed by
          // DartOverlay for model-vs-observed RMSE, never shown as gauges.
          ...(dartBuoys ?? []).map((b) => ({
            id: `dart-${b.id}`,
            lat_deg: b.lat,
            lon_deg: b.lon,
          })),
        ],
      };
      if (isTauri()) {
        const streamSnaps: GridSnapshot[] = [];
        const meta = await api.simulateGridStreaming(
          runId,
          gridReq,
          (snap) => {
            if (!mountedRef.current || reqId !== reqIdRef.current) return;
            streamSnaps.push(snap);
            setSnapshots([...streamSnaps]);
            setActiveIdx(streamSnaps.length - 1);
            setStreamProgress(streamSnaps.length);
            onSnapshot?.(snap);
          },
          (packet) => {
            if (!mountedRef.current || reqId !== reqIdRef.current || packet.kind !== "frame") return;
            onRenderFrame?.({
              protocolVersion: `${packet.prelude.major}.${packet.prelude.minor}`,
              scenarioId: packet.header.scenario_id,
              scenarioSha256: packet.header.scenario_sha256,
              sequence: packet.prelude.sequence.toString(),
              solverTick: packet.header.solver_tick,
              simulationTimeS: packet.header.simulation_time_s,
              tickDurationS: packet.header.tick_duration_s,
              payloadSha256: packet.header.payload_sha256,
              fieldSha256: Object.fromEntries(
                packet.header.fields.map((field) => [field.id, field.sha256]),
              ),
            });
          },
          resumeRunId,
          checkpointIntervalS,
        );
        if (!mountedRef.current || reqId !== reqIdRef.current) return;
        runIdRef.current = null;
        if (meta.cancelled) {
          setStatus("idle");
          return;
        }
        setDiag({ dt_s: meta.dt_s, nx: meta.nx, ny: meta.ny, used_gpu: meta.used_gpu, quality: meta.run_quality });
        onRunQuality?.(meta.run_quality);
        setActiveIdx(0);
        setStatus("ready");
        void notifyRunComplete("Cataclysm", t("swe.runComplete"));
        onSnapshotsReady?.(streamSnaps);
        setMaxField(meta.max_field ?? null);
        setRecoveredGaugeHistory(meta.recovered_gauge_history ?? []);
        onMaxField?.(meta.max_field ?? null);
        onScientificExport?.(meta.scientific_export ?? null, meta.scientific_export_error ?? null);
        await refreshCheckpoints();
        if (autoPlay && playbackTimeS === undefined) setIsPlaying(true);
      } else {
        const resp = simulateDemoGrid(initial, {
          boxHalfSizeDeg: halfDeg,
          nSnapshots: N_SNAPSHOTS,
          tEndS: 60 * 60,
          includeLambWave,
        });
        if (!mountedRef.current || reqId !== reqIdRef.current) return;
        setSnapshots(resp.snapshots);
        setDiag({ dt_s: resp.dt_s, nx: resp.nx, ny: resp.ny, used_gpu: resp.used_gpu ?? false, quality: resp.run_quality });
        onRunQuality?.(resp.run_quality);
        onScientificExport?.(null, t("swe.netcdfDesktop"));
        setActiveIdx(0);
        setStatus("ready");
        onSnapshotsReady?.(resp.snapshots);
        if (autoPlay && playbackTimeS === undefined) setIsPlaying(true);
      }
    } catch (err) {
      if (!mountedRef.current || reqId !== reqIdRef.current) return;
      runIdRef.current = null;
      console.error("simulate_grid failed", err);
      await refreshCheckpoints();
      setErrMsg(String(err));
      if (previousSnapshots) {
        setSnapshots(previousSnapshots);
        setMaxField(previousMaxField);
        setRecoveredGaugeHistory(previousGaugeHistory);
        setDiag(previousDiag);
        setActiveIdx((index) => Math.min(index, previousSnapshots.length - 1));
        onSnapshotsReady?.(previousSnapshots);
        onMaxField?.(previousMaxField);
        onRunQuality?.(previousQuality);
        setStatus("stale");
      } else {
        setSnapshots(null);
        setMaxField(null);
        setDiag(null);
        onSnapshot?.(null);
        onSnapshotsReady?.(null);
        onMaxField?.(null);
        onRunQuality?.(null);
        onScientificExport?.(null, String(err));
        setStatus("error");
      }
    }
  }, [initial, snapshots, diag, maxField, recoveredGaugeHistory, useBathy, bathymetryAssetId, includeLambWave, cellsPerDeg, checkpointIntervalS, gauges, dartBuoys, onSnapshot, onSnapshotsReady, onMaxField, onRunQuality, onScientificExport, onColormap, onRenderFrame, playbackTimeS, refreshCheckpoints, t]);

  useEffect(() => {
    if (!initial || runAndWatchNonce <= handledRunAndWatchNonce.current) return;
    handledRunAndWatchNonce.current = runAndWatchNonce;
    void run(true);
  }, [initial, run, runAndWatchNonce]);

  if (!initial) return null;

  const solverBadge =
    status === "running"
      ? t("swe.running")
      : status === "ready"
        ? diag?.used_gpu
          ? t("swe.gpuReady")
          : t("swe.cpuReady")
        : status === "stale" ? t("swe.stale") : t("swe.ready");
  const fidelityLabel = cellsPerDeg <= 4 ? t("swe.preview") : cellsPerDeg >= 10 ? t("swe.high") : t("swe.standard");
  const displaySlotLabel = slotLabel === "Slot A" ? t("app.slotA") : slotLabel === "Slot B" ? t("app.slotB") : slotLabel;
  const qualityStatus = diag?.quality.status === "pass"
    ? t("swe.qualityPass")
    : diag?.quality.status === "warning"
      ? t("swe.qualityWarning")
      : t("swe.qualityFail");

  return (
    <div className="section swe" aria-label={displaySlotLabel ? t("swe.slotPropagation", { slot: displaySlotLabel }) : undefined}>
      <div className="section__title">
        <span>{displaySlotLabel && <>{displaySlotLabel} · </>}{t("swe.propagation")} <small>{t("swe.shallowWaterModel")}</small> <GlossaryTip term="swe">SWE</GlossaryTip></span>
        <span className="section__badge" data-tone={status === "error" || status === "stale" ? "danger" : status === "running" ? "active" : undefined}>
          {solverBadge}
        </span>
      </div>
      {workspaceMode === "advanced" && <p className="swe__hint">
        {t("swe.intro")}
      </p>}
      {workspaceMode === "advanced" && <div className="swe__meta-grid" aria-label={t("swe.solverSetup")}>
        <span><strong>{formatNumber(N_SNAPSHOTS)}</strong> {t("swe.framesLabel")}</span>
        <span><strong>{formatNumber(60)}</strong> {t("swe.minuteWindowLabel")}</span>
        <span><strong>{isTauri() ? t("swe.backend") : t("swe.preview")}</strong> {t("swe.modeLabel")}</span>
      </div>}
      {(workspaceMode !== "simple" || status === "running" || status === "error" || status === "stale") && <div className="swe__row swe__row--primary">
        <button
          className="primary"
          onClick={() => void run(false)}
          disabled={status === "running"}
          type="button"
        >
          {status !== "running" && <UiIcon name={status === "ready" ? "refresh" : "play"} size={14} />}
          {status === "running" ? t("swe.computing") : status === "ready" ? t("swe.rerun") : status === "error" || status === "stale" ? t("swe.retrySimulation") : t("swe.runSimulation")}
        </button>
        {status === "running" && (
          <button
            onClick={cancel}
            title={t("swe.cancelTitle")}
            type="button"
          >
            <UiIcon name="close" size={14} />
            {t("swe.cancel")}
          </button>
        )}
      </div>}
      {isTauri() && status !== "running" && checkpoints[0] && (
        <div className="swe__confidence" role="note">
          <strong>{t("swe.interruptedAvailable")}</strong>
          <span>
            {t("swe.checkpointProgress", {
              current: formatNumber(checkpoints[0].time_s / 60, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
              total: formatNumber(checkpoints[0].t_end_s / 60, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
              step: formatNumber(checkpoints[0].step_index),
            })}
          </span>
          <button type="button" onClick={() => void run(false, checkpoints[0].run_id)}>
            {t("swe.resumeCompatible")}
          </button>
          <button
            type="button"
            onClick={() => void api.removeSolverCheckpoint(checkpoints[0].run_id).then(refreshCheckpoints)}
          >
            {t("swe.remove")}
          </button>
        </div>
      )}
      {workspaceMode !== "simple" && <div className="swe__options" role="group" aria-label={t("swe.solverOptions")}>
        <label className="swe__check">
          <input
            type="checkbox"
            checked={useBathy}
            onChange={(e) => setUseBathy(e.target.checked)}
          />
          <span>{t("swe.useBathymetry")}</span>
        </label>
        {useBathy && isTauri() && (
          <label className="swe__check swe__bathymetry-source">
            <span>{t("swe.bathymetrySource")}</span>
            <select value={bathymetryAssetId} onChange={(event) => setBathymetryAssetId(event.target.value)} aria-label={t("swe.bathymetrySource")}>
              <option value="">{t("swe.bundledBathymetry")}</option>
              {bathymetryAssets.map((asset) => <option key={asset.asset_id} value={asset.asset_id}>{asset.report.file_name} · {asset.report.source_label}</option>)}
            </select>
          </label>
        )}
        {workspaceMode === "advanced" && bathymetryAssetId === "" && <div className="swe__confidence" role="note">
          {t("swe.lowConfidenceBathy")}
        </div>}
        {workspaceMode === "advanced" && bathymetryAssetId !== "" && <div className="swe__confidence" role="note">
          {t("swe.localRasterNote")}
        </div>}
        {bathymetryListError && <div className="panel-error" role="alert">{t("swe.bathymetryUnavailable")} {bathymetryListError}</div>}
        <label className="swe__check">
          <input
            type="checkbox"
            checked={includeLambWave}
            onChange={(e) => setIncludeLambWave(e.target.checked)}
          />
          <span>{t("swe.includePressureWave")}</span>
        </label>
        {workspaceMode === "advanced" && <label className="swe__check swe__resolution">
          <span>
            {t("swe.resolution")} <strong>{t("swe.cellsPerDegree", { count: formatNumber(cellsPerDeg) })}</strong>
            <em>{fidelityLabel}</em>
          </span>
          <input
            type="range"
            min={3}
            max={12}
            step={1}
            value={cellsPerDeg}
            onChange={(e) => setCellsPerDeg(Number(e.target.value))}
            aria-label={t("swe.gridResolution")}
            title={t("swe.gridResolutionTitle")}
          />
        </label>}
        {workspaceMode === "advanced" && isTauri() && <label className="swe__check swe__bathymetry-source">
          <span>{t("swe.checkpointCadence")}</span>
          <select
            value={checkpointIntervalS}
            onChange={(event) => setCheckpointIntervalS(Number(event.target.value))}
            aria-label={t("swe.checkpointCadence")}
          >
            <option value={30}>{t("swe.every30Seconds")}</option>
            <option value={60}>{t("swe.everyMinute")}</option>
            <option value={300}>{t("swe.every5Minutes")}</option>
          </select>
        </label>}
      </div>}
      {status === "running" && (
        <div className="swe__run-state" role="status" aria-live="polite">
          <span>{t("swe.streamingFrame", { current: formatNumber(streamProgress), total: formatNumber(N_SNAPSHOTS) })}</span>
          <progress
            className="swe__progress"
            aria-label={t("swe.solverProgress")}
            max={N_SNAPSHOTS}
            value={streamProgress}
          />
        </div>
      )}
      {(status === "error" || status === "stale") && (
        <div className="swe__error" role="alert">
          <strong>{status === "stale" ? t("swe.refreshFailed") : t("swe.simulationFailed")}</strong>
          <span>{errMsg ?? t("swe.solverError")}</span>
        </div>
      )}
      {snapshots && snapshots.length > 1 && (
        <>
          <div className="swe__row">
            {playbackTimeS === undefined && <button
              onClick={() => {
                // Pressing Play at the final frame restarts from the top
                // instead of silently no-opping.
                if (!isPlaying && activeIdx >= snapshots.length - 1) {
                  setActiveIdx(0);
                }
                setIsPlaying((p) => !p);
              }}
              disabled={status === "running" || snapshots.length < 2}
              title={t("swe.playPauseTitle")}
              type="button"
            >
              {isPlaying ? (
                <>
                  <UiIcon name="pause" size={14} />
                  {t("swe.pause")}
                </>
              ) : (
                <>
                  <UiIcon name="play" size={14} />
                  {t("swe.play")}
                </>
              )}
            </button>}
            {playbackTimeS === undefined && <select
              className="swe__speed"
              value={speedIdx}
              onChange={(e) => setSpeedIdx(Number(e.target.value))}
              aria-label={t("swe.playbackSpeed")}
              title={t("swe.playbackSpeed")}
            >
              {SPEED_OPTIONS.map((opt, i) => (
                <option key={opt.label} value={i}>{opt.label}</option>
              ))}
            </select>}
            {playbackTimeS === undefined && (
              <input
                type="range"
                min={0}
                max={snapshots.length - 1}
                step={1}
                value={activeIdx}
                onChange={(e) => {
                  setIsPlaying(false);
                  const next = Number(e.target.value);
                  setActiveIdx(next);
                  onPlaybackTimeChange?.(snapshots[next].time_s);
                }}
                aria-label={t("swe.timelineScrubber")}
              />
            )}
          </div>
          {workspaceMode !== "simple" && <div className="swe__readout">
            <span>{t("swe.frameReadout", { current: formatNumber(activeIdx + 1), total: formatNumber(snapshots.length) })}</span>
            <span>{t("swe.minutesShort", { value: formatNumber(snapshots[activeIdx].time_s / 60, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}</span>
            <span>|<GlossaryTip term="eta">η</GlossaryTip>|max {quantityText(formatLength(snapshots[activeIdx].eta_abs_max_m, formatNumber, unitSystem))}</span>
          </div>}
          {workspaceMode === "advanced" && diag && (
            <div className="swe__readout swe__readout--muted">
              <span>Δt = {formatNumber(diag.dt_s, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s</span>
              <span>{t("swe.grid", { nx: formatNumber(diag.nx), ny: formatNumber(diag.ny) })}</span>
              <span>{t("swe.cells", { count: formatNumber(diag.nx * diag.ny) })}</span>
              <span>{diag.used_gpu ? "GPU (wgpu)" : "CPU (rayon)"}</span>
              <span>
                {t("swe.qualityReadout", {
                  status: qualityStatus,
                  cfl: formatNumber(diag.quality.cfl_number, { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
                  mass: formatNumber(diag.quality.mass_drift_pct, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                  energy: formatNumber(diag.quality.energy_drift_pct, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                })}
              </span>
            </div>
          )}
          {diag?.quality.warnings.filter((warning) => isTauri() || warning !== BROWSER_PREVIEW_FIELD_WARNING).map((warning) => (
            <p className="swe__hint" role="status" key={warning}>{localizeSolverWarning(warning, t)}</p>
          ))}
          {workspaceMode !== "simple" && maxField && (
            <div className="swe__overlay-row" role="group" aria-label={t("swe.resultOverlay")}>
              <span className="swe__overlay-label">{t("swe.overlay")}</span>
              {OVERLAY_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className="swe__overlay-btn"
                  data-active={overlay === opt.id || undefined}
                  aria-pressed={overlay === opt.id}
                  title={t(opt.titleKey)}
                  onClick={() => {
                    setIsPlaying(false);
                    setOverlay(opt.id);
                  }}
                >
                  {t(opt.labelKey)}
                </button>
              ))}
              <button
                type="button"
                className="swe__overlay-btn swe__overlay-btn--toggle"
                data-active={showArrivals || undefined}
                aria-pressed={showArrivals}
                title={t("swe.arrivalsTitle")}
                onClick={() => setShowArrivals((v) => !v)}
                disabled={maxField.isochrones.length === 0}
              >
                {t("swe.arrivals")}
              </button>
              {overlay !== "wave" && (
                <span className="swe__overlay-hint">
                  {overlay === "peak"
                    ? t("swe.peakHint", { value: quantityText(formatLength(maxField.peak_abs_max_m, formatNumber, unitSystem)) })
                    : overlay === "t_of_max"
                      ? t("swe.tMaxHint")
                      : t("swe.energyHint")}
                </span>
              )}
            </div>
          )}
        </>
      )}
      {workspaceMode === "advanced" && !isTauri() && (
        <div className="swe__notice">{t("swe.browserNotice")}</div>
      )}

      {workspaceMode === "advanced" && <div className="swe__gauges">
        <div className="section__title">
          <span>{t("swe.gauges")}</span>
          <span className="section__badge">{formatNumber(gauges.length)}</span>
        </div>
        <div className="swe__gauge-add">
          <input
            type="text"
            placeholder={t("swe.name")}
            value={gaugeNameInput}
            onChange={(e) => setGaugeNameInput(e.target.value)}
            aria-label={t("swe.gaugeName")}
            className="swe__gauge-input swe__gauge-input--name"
          />
          <input
            type="number"
            placeholder={t("swe.lat")}
            value={gaugeLatInput}
            onChange={(e) => setGaugeLatInput(e.target.value)}
            aria-label={t("swe.gaugeLatitude")}
            aria-invalid={gaugeLatError !== null}
            aria-errormessage={gaugeLatError ? `${gaugeEntryId}-latitude-error` : undefined}
            aria-describedby={gaugeLatError ? `${gaugeEntryId}-latitude-error` : undefined}
            min={-90}
            max={90}
            step="any"
            className="swe__gauge-input"
          />
          <input
            type="number"
            placeholder={t("swe.lon")}
            value={gaugeLonInput}
            onChange={(e) => setGaugeLonInput(e.target.value)}
            aria-label={t("swe.gaugeLongitude")}
            aria-invalid={gaugeLonError !== null}
            aria-errormessage={gaugeLonError ? `${gaugeEntryId}-longitude-error` : undefined}
            aria-describedby={gaugeLonError ? `${gaugeEntryId}-longitude-error` : undefined}
            min={-180}
            max={180}
            step="any"
            className="swe__gauge-input"
          />
          <button
            type="button"
            onClick={addGauge}
            disabled={!gaugeCoordinatesValid}
            title={t("swe.addGaugeTitle")}
          >
            {t("swe.add")}
          </button>
          {(gaugeLatError || gaugeLonError) && (
            <div className="swe__gauge-errors">
              {gaugeLatError && <span id={`${gaugeEntryId}-latitude-error`} role="alert">{gaugeLatError}</span>}
              {gaugeLonError && <span id={`${gaugeEntryId}-longitude-error`} role="alert">{gaugeLonError}</span>}
            </div>
          )}
        </div>
        {gauges.length > 0 && (
          <div className="swe__gauge-list" role="list">
            {gauges.map((g) => {
              const series = gaugeSeries.find((s) => s.gauge.id === g.id);
              return (
                <div key={g.id} className="swe__gauge-item" role="listitem">
                  <div className="swe__gauge-header">
                    <strong>{g.name}</strong>
                    <span className="swe__gauge-coords">
                      {g.lat_deg.toFixed(2)}°, {g.lon_deg.toFixed(2)}°
                    </span>
                    <button
                      type="button"
                      onClick={() => removeGauge(g.id)}
                      className="swe__gauge-remove"
                      aria-label={t("swe.removeGaugeAria", { name: g.name })}
                      title={t("swe.removeGaugeTitle")}
                    >
                      <UiIcon name="close" size={12} />
                    </button>
                  </div>
                  {series && series.samples.length > 0 && (
                    <GaugeSparkline
                      name={g.name}
                      samples={series.samples}
                      activeTimeS={snapshots?.[activeIdx]?.time_s ?? playbackTimeS ?? series.samples.at(-1)?.time_s ?? 0}
                       provenance={isTauri() ? t("swe.gaugeProvenanceRust") : t("swe.gaugeProvenanceBrowser")}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
        {gaugeSeries.length > 0 && (
          <>
            <button
              type="button"
              onClick={handleGaugeCsvExport}
              className="swe__gauge-export"
              title={t("swe.exportGaugesTitle")}
            >
              <UiIcon name="download" size={14} />
              {t("swe.exportGauges")}
            </button>
            {gaugeExportFailure && (
              <div className="panel-error" role="alert">
                <span>{exportFailureLabel(gaugeExportFailure.code)}: {gaugeExportFailure.message}</span>
                {gaugeExportFailure.retryable && <button type="button" onClick={handleGaugeCsvExport}>{t("swe.retry")}</button>}
              </div>
            )}
          </>
        )}
      </div>}
    </div>
  );
}

export function GaugeSparkline({
  name,
  samples,
  activeTimeS,
  provenance,
}: {
  name: string;
  samples: import("../types/scenario").GaugeSample[];
  activeTimeS: number;
  provenance: string;
}) {
  const { t, formatNumber } = useI18n();
  const unitSystem = useUnits();
  const semanticId = useId();
  if (samples.length < 2) return null;
  const maxEta = Math.max(...samples.map((s) => Math.abs(s.eta_m)), 0.01);
  const w = 200;
  const h = 40;
  const pad = 2;
  const points = samples
    .map((s, i) => {
      const x = pad + (i / (samples.length - 1)) * (w - pad * 2);
      const y = h / 2 - (s.eta_m / maxEta) * (h / 2 - pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const peakEta = Math.max(...samples.map((s) => s.eta_m));
  const troughEta = Math.min(...samples.map((s) => s.eta_m));
  const peakIndex = samples.findIndex((sample) => sample.eta_m === peakEta);
  const troughIndex = samples.findIndex((sample) => sample.eta_m === troughEta);
  const activeIndex = samples.reduce(
    (nearest, sample, index) => Math.abs(sample.time_s - activeTimeS) < Math.abs(samples[nearest].time_s - activeTimeS) ? index : nearest,
    0,
  );
  const semanticRows: SemanticDataRow[] = [
    ...samples.map((sample, index) => {
      const markers = [
        index === peakIndex ? t("swe.maximum") : null,
        index === troughIndex ? t("swe.minimum") : null,
        index === activeIndex ? t("swe.nearestSelection") : null,
      ].filter(Boolean).join("; ") || t("swe.sample");
      return {
        series: t("swe.surfaceElevation", { name }),
        selection: t("swe.timeSeconds", { value: formatNumber(sample.time_s, { maximumFractionDigits: 0 }) }),
        value: formatLength(sample.eta_m, formatNumber, unitSystem).value,
        unit: formatLength(sample.eta_m, formatNumber, unitSystem).unit,
        significance: markers,
        confidence: t("swe.illustrativeResult"),
        provenance,
      };
    }),
    {
      series: t("swe.stillWaterDatum"),
      selection: t("swe.referenceThreshold"),
      value: 0,
      unit: formatLength(0, formatNumber, unitSystem).unit,
      significance: t("swe.zeroCrossing"),
      confidence: t("swe.modelDatumNote"),
      provenance,
    },
  ];
  const active = samples[activeIndex];
  const semanticSummary = t("swe.gaugeSummary", {
    name,
    count: formatNumber(samples.length),
    provenance,
    start: formatNumber(samples[0].time_s, { maximumFractionDigits: 0 }),
    end: formatNumber(samples.at(-1)!.time_s, { maximumFractionDigits: 0 }),
    maximum: quantityText(formatLength(peakEta, formatNumber, unitSystem)),
    minimum: quantityText(formatLength(troughEta, formatNumber, unitSystem)),
    selection: formatNumber(activeTimeS, { maximumFractionDigits: 0 }),
    active: quantityText(formatLength(active.eta_m, formatNumber, unitSystem)),
    activeTime: formatNumber(active.time_s, { maximumFractionDigits: 0 }),
  });
  return (
    <div className="swe__gauge-spark">
      <div className="swe__gauge-visual">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className="swe__gauge-svg"
          role="img"
          aria-label={t("swe.gaugeAria", { name })}
          aria-describedby={`${semanticId}-summary`}
        >
          <line x1={pad} y1={h / 2} x2={w - pad} y2={h / 2} stroke="var(--surface1)" strokeWidth="1" />
          <polyline
            points={points}
            fill="none"
            stroke="var(--pink)"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
        <span className="swe__gauge-peak">{t("swe.gaugePeak", { value: quantityText(formatLength(peakEta, formatNumber, unitSystem)) })}</span>
      </div>
      <SemanticDataTable
        id={semanticId}
        title={t("swe.gaugeTitle", { name })}
        summary={semanticSummary}
        columns={[
          { key: "series", label: t("swe.series") },
          { key: "selection", label: t("swe.timeOrSelection") },
          { key: "value", label: t("swe.value"), dataType: "number" },
          { key: "unit", label: t("swe.unit") },
          { key: "significance", label: t("swe.extremaState") },
          { key: "confidence", label: t("swe.confidence") },
          { key: "provenance", label: t("swe.provenance") },
        ]}
        rows={semanticRows}
        filename={`cataclysm-gauge-${name}.csv`}
      />
    </div>
  );
}
