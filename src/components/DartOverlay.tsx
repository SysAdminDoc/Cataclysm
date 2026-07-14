import { useEffect, useMemo, useState } from "react";
import { getDartEvents, PRESET_TO_DART_EVENT } from "../lib/data";
import { api, isTauri, type DartRmseResult } from "../lib/tauri";
import type { DartBuoy, DartEvent, GridSnapshot } from "../types/scenario";
import { UiIcon } from "./UiIcon";

type Props = {
  presetId: string | null;
  timeS: number;
  /** Completed SWE snapshots (slot A). When they carry `dart-<id>` gauge
   * samples, all model-vs-observed metrics are derived by Rust IPC. */
  sweSnapshots?: GridSnapshot[] | null;
};

type BuoyFit =
  | { kind: "ok"; result: DartRmseResult }
  | { kind: "no-overlap"; result: DartRmseResult }
  | { kind: "error" };

/** Model eta series at a buoy from the hidden `dart-<id>` gauge samples. */
function modelSeriesForBuoy(buoyId: string | number, snapshots: GridSnapshot[]): [number, number][] {
  const id = `dart-${buoyId}`;
  return snapshots.flatMap((snap) => {
    const sample = snap.gauge_samples?.find((s) => s.id === id);
    return sample && Number.isFinite(sample.eta_m)
      ? [[snap.time_s, sample.eta_m] as [number, number]]
      : [];
  });
}

const db = getDartEvents();

function sampleSeries(series: [number, number][], timeS: number): number | null {
  if (series.length === 0 || timeS < series[0][0] || timeS > series[series.length - 1][0]) {
    return null;
  }
  for (let i = 1; i < series.length; i++) {
    const [t1, v1] = series[i];
    if (t1 >= timeS) {
      const [t0, v0] = series[i - 1];
      const u = (timeS - t0) / (t1 - t0 || 1);
      return v0 + (v1 - v0) * u;
    }
  }
  return series[series.length - 1][1];
}

function peakAbsAmp(series: [number, number][]): number {
  return series.reduce((peak, [, value]) => Math.max(peak, Math.abs(value)), 0);
}

function formatElapsed(seconds: number): string {
  const minutes = seconds / 60;
  if (Math.abs(minutes) >= 120) {
    return `${(minutes / 60).toFixed(1)} h`;
  }
  return `${minutes.toFixed(Math.abs(minutes) < 10 && minutes % 1 !== 0 ? 1 : 0)} min`;
}

function arrivalSummary(result: DartRmseResult): string {
  const observed = result.observed_arrival_s == null
    ? "observed not detected"
    : `observed ${formatElapsed(result.observed_arrival_s)}`;
  const model = result.model_arrival_s == null
    ? "model not detected"
    : `model ${formatElapsed(result.model_arrival_s)}`;
  const residual = result.arrival_residual_s == null
    ? "residual unavailable"
    : `residual ${result.arrival_residual_s >= 0 ? "+" : ""}${formatElapsed(result.arrival_residual_s)} (model − observed)`;
  return `${observed} · ${model} · ${residual}`;
}

function formatOrigin(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace("T", " ").slice(0, 16);
}

/** Actual observation and SWE gauge series with a shared timeline cursor. */
function Sparkline({
  buoy,
  timeS,
  modelSeries,
  result,
}: {
  buoy: DartBuoy;
  timeS: number;
  modelSeries: [number, number][];
  result?: DartRmseResult;
}) {
  const w = 280;
  const h = 60;
  const plotTop = 16;
  const plotBottom = h - 2;
  const plotHeight = plotBottom - plotTop;
  const plotCenter = plotTop + plotHeight * 0.5;
  const obs = buoy.observations;
  if (obs.length < 2) return null;
  const allSeries = modelSeries.length > 0 ? [...obs, ...modelSeries] : obs;
  const tMin = Math.min(...allSeries.map(([time]) => time));
  const tMax = Math.max(...allSeries.map(([time]) => time));
  const observedPeak = result?.observed_peak_m ?? peakAbsAmp(obs);
  const modelPeak = result?.model_peak_m ?? peakAbsAmp(modelSeries);
  const scalePeak = Math.max(observedPeak, modelPeak, 1e-6);
  const pathFor = (series: [number, number][]) => series
    .map(([time, value], index) => {
      const x = ((time - tMin) / (tMax - tMin || 1)) * w;
      const y = plotCenter - (value / scalePeak) * plotHeight * 0.45;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const observedPath = pathFor(obs);
  const modelPath = pathFor(modelSeries);
  const cursorX = ((timeS - tMin) / (tMax - tMin || 1)) * w;
  const observedCursor = sampleSeries(obs, timeS);
  const modelCursor = sampleSeries(modelSeries, timeS);
  const obsArr = result?.observed_arrival_s ?? null;
  const modArr = result?.model_arrival_s ?? null;
  const obsArrX = obsArr != null ? ((obsArr - tMin) / (tMax - tMin || 1)) * w : null;
  const modArrX = modArr != null ? ((modArr - tMin) / (tMax - tMin || 1)) * w : null;
  const durationMin = Math.round((tMax - tMin) / 60);
  const ariaParts = [
    `${buoy.name} DART water level`,
    `observed peak ${observedPeak.toFixed(2)} m over ${durationMin} min`,
  ];
  if (modelSeries.length > 0) ariaParts.push(`model peak ${modelPeak.toFixed(2)} m`);
  if (observedCursor != null) ariaParts.push(`observed ${observedCursor.toFixed(2)} m at the timeline cursor`);
  if (modelCursor != null) ariaParts.push(`model ${modelCursor.toFixed(2)} m at the timeline cursor`);
  if (result) {
    ariaParts.push(arrivalSummary(result));
    ariaParts.push(`arrival threshold ${(result.arrival_threshold_m * 100).toFixed(0)} cm; ${result.arrival_method}`);
  }
  return (
    <svg
      width={w}
      height={h + 14}
      viewBox={`0 0 ${w} ${h + 14}`}
      className="dart__spark"
      role="img"
      aria-label={ariaParts.join("; ")}
    >
      <line x1={0} x2={w} y1={plotCenter} y2={plotCenter} stroke="var(--surface2)" strokeDasharray="2 4" />
      <path d={observedPath} fill="none" stroke="var(--maroon)" strokeWidth={1.5} />
      {modelPath && <path d={modelPath} fill="none" stroke="var(--peach)" strokeWidth={1.5} />}
      {Number.isFinite(cursorX) && cursorX >= 0 && cursorX <= w && (
        <line x1={cursorX} x2={cursorX} y1={plotTop} y2={plotBottom} stroke="var(--sapphire)" strokeWidth={1.5} />
      )}
      {obsArrX != null && obsArrX >= 0 && obsArrX <= w && (
        <>
          <line x1={obsArrX} x2={obsArrX} y1={plotTop} y2={plotBottom} stroke="var(--green)" strokeWidth={1} strokeDasharray="3 3" />
          <text x={obsArrX + 2} y={plotBottom - 2} fontSize="8" fill="var(--green)">observed</text>
        </>
      )}
      {modArrX != null && modArrX >= 0 && modArrX <= w && (
        <>
          <line x1={modArrX} x2={modArrX} y1={plotTop} y2={plotBottom} stroke="var(--peach)" strokeWidth={1} strokeDasharray="3 3" />
          <text x={modArrX + 2} y={plotTop + 8} fontSize="8" fill="var(--peach)">model</text>
        </>
      )}
      <text x={4} y={12} fontSize="10" fill="var(--subtext)">
        observed peak {observedPeak.toFixed(2)} m{modelSeries.length > 0 ? ` · model peak ${modelPeak.toFixed(2)} m` : ` · ${obs.length} samples`}
      </text>
      <text x={4} y={h + 11} fontSize="9" fill="var(--subtext)">
        cursor: observed {observedCursor == null ? "—" : `${observedCursor.toFixed(2)} m`}
        {modelSeries.length > 0 ? ` · model ${modelCursor == null ? "—" : `${modelCursor.toFixed(2)} m`}` : ""}
      </text>
    </svg>
  );
}

export function DartOverlay({ presetId, timeS, sweSnapshots }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [fits, setFits] = useState<Record<string, BuoyFit>>({});
  const eventKey = presetId ? PRESET_TO_DART_EVENT[presetId] : null;
  const event: DartEvent | null = useMemo(
    () => (eventKey ? db.events[eventKey] ?? null : null),
    [eventKey],
  );
  const hasModelEvidence = Boolean(sweSnapshots?.some((snapshot) =>
    snapshot.gauge_samples?.some((sample) => sample.id.startsWith("dart-") && sample.eta_m != null),
  ));
  const hasArrivalEvidence = Object.values(fits).some((fit) =>
    (fit.kind === "ok" || fit.kind === "no-overlap")
      && (fit.result.observed_arrival_s != null || fit.result.model_arrival_s != null),
  );

  // RMSE per buoy from the Rust dart_buoy_rmse command whenever a completed
  // SWE run carries model samples at the buoy positions. Desktop-only: the
  // browser preview's demo frames are approximate by design.
  useEffect(() => {
    if (!event || !sweSnapshots || sweSnapshots.length < 2 || !isTauri()) {
      setFits({});
      return;
    }
    let cancelled = false;
    (async () => {
      const next: Record<string, BuoyFit> = {};
      for (const buoy of event.buoys) {
        const model = modelSeriesForBuoy(buoy.id, sweSnapshots);
        if (model.length < 2) continue;
        try {
          const result = await api.dartBuoyRmse({
            buoy_lat: buoy.lat,
            buoy_lon: buoy.lon,
            observations: buoy.observations,
            model_samples: model,
          });
          next[buoy.id] = result.rmse_m == null || result.n_samples === 0
            ? { kind: "no-overlap", result }
            : { kind: "ok", result };
        } catch (err) {
          console.error(`dartBuoyRmse failed for ${buoy.id}`, err);
          next[buoy.id] = { kind: "error" };
        }
      }
      if (!cancelled) setFits(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [event, sweSnapshots]);

  if (!event) return null;

  return (
    <div className="section">
      <div className="section__title">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="dart__toggle"
          aria-expanded={expanded}
          type="button"
        >
          <UiIcon name={expanded ? "chevronDown" : "chevronRight"} size={13} />
          DART buoy observations
        </button>
        <span className="section__badge">{event.buoys.length} buoys</span>
      </div>
      {expanded && (
        <>
          <div className="dart__source">
            <span>Origin {formatOrigin(event.event_origin_utc)} UTC</span>
            <span>{event.epicenter.lat.toFixed(2)}°, {event.epicenter.lon.toFixed(2)}°</span>
          </div>
          <p className="swe__hint">
            Observed water-surface elevation from NOAA DART buoys for this
            event. When an SWE run is available, the peach series and all fit
            metrics come from its buoy gauge samples; blue is the timeline cursor.
          </p>
          <div className="chart-legend chart-legend--dart" aria-hidden>
            <span><i data-tone="observed" /> Observed</span>
            {hasModelEvidence && <span><i data-tone="model" /> SWE model</span>}
            <span><i data-tone="cursor" /> Timeline</span>
            {hasArrivalEvidence && <span><i data-tone="coast" /> Arrival markers</span>}
          </div>
          {event.buoys.map((b) => {
            const fit = fits[b.id];
            const modelSeries = sweSnapshots ? modelSeriesForBuoy(b.id, sweSnapshots) : [];
            const fitResult = fit?.kind === "ok" || fit?.kind === "no-overlap" ? fit.result : undefined;
            return (
              <div key={b.id} className="dart__buoy">
                <div className="dart__name">{b.name}</div>
                <div className="dart__meta">
                  {b.lat.toFixed(2)}°, {b.lon.toFixed(2)}° · {b.depth_m} m deep
                </div>
                <Sparkline buoy={b} timeS={timeS} modelSeries={modelSeries} result={fitResult} />
                {fit?.kind === "ok" && (
                  <div className="dart__rmse" role="note">
                    <span className="dart__rmse-value">
                      RMSE {fit.result.rmse_m?.toFixed(2)} m
                    </span>
                    <span>
                      overlap {formatElapsed(fit.result.overlap_start_s ?? 0)}–{formatElapsed(fit.result.overlap_end_s ?? 0)} · {fit.result.n_samples} paired samples
                    </span>
                    <span>observed peak {fit.result.observed_peak_m.toFixed(2)} m · model peak {fit.result.model_peak_m.toFixed(2)} m</span>
                    <span>arrival: {arrivalSummary(fit.result)}</span>
                    <span>
                      method: {fit.result.arrival_method}; threshold {(fit.result.arrival_threshold_m * 100).toFixed(0)} cm;
                      noise: {fit.result.noise_method}
                    </span>
                  </div>
                )}
                {fit?.kind === "no-overlap" && (
                  <div className="dart__rmse dart__rmse--muted" role="note">
                    <span>No shared observation/model time window — RMSE unavailable.</span>
                    <span>arrival: {arrivalSummary(fit.result)}</span>
                    <span>
                      method: {fit.result.arrival_method}; threshold {(fit.result.arrival_threshold_m * 100).toFixed(0)} cm;
                      noise: {fit.result.noise_method}
                    </span>
                  </div>
                )}
                {fit?.kind === "error" && (
                  <div className="dart__rmse dart__rmse--muted" role="note">
                    Couldn't compute RMSE for this buoy — see the diagnostics log.
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
