import { useEffect, useId, useMemo, useRef, useState } from "react";
import { getDartEvents, PRESET_TO_DART_EVENT } from "../lib/data";
import { api, isTauri, type DartRmseResult } from "../lib/tauri";
import type { DartBuoy, DartEvent, GridSnapshot } from "../types/scenario";
import { UiIcon } from "./UiIcon";
import { SemanticDataTable, type SemanticDataRow } from "./SemanticDataTable";
import {
  asyncResultValue,
  rejectAsyncResult,
  resolveAsyncResult,
  startAsyncResult,
  type AsyncResult,
} from "../lib/async-result";
import { useI18n } from "../lib/i18n";

type Props = {
  presetId: string | null;
  timeS: number;
  /** Completed SWE snapshots (slot A). When they carry `dart-<id>` gauge
   * samples, all model-vs-observed metrics are derived by Rust IPC. */
  sweSnapshots?: GridSnapshot[] | null;
};

type BuoyFit =
  | { kind: "ok"; result: DartRmseResult }
  | { kind: "no-overlap"; result: DartRmseResult };

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

function formatElapsed(
  seconds: number,
  formatNumber: ReturnType<typeof useI18n>["formatNumber"],
  t: ReturnType<typeof useI18n>["t"],
): string {
  const minutes = seconds / 60;
  if (Math.abs(minutes) >= 120) {
    return t("dart.hours", { value: formatNumber(minutes / 60, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
  }
  const digits = Math.abs(minutes) < 10 && minutes % 1 !== 0 ? 1 : 0;
  return t("dart.minutes", { value: formatNumber(minutes, { minimumFractionDigits: digits, maximumFractionDigits: digits }) });
}

function arrivalSummary(
  result: DartRmseResult,
  t: ReturnType<typeof useI18n>["t"],
  formatNumber: ReturnType<typeof useI18n>["formatNumber"],
): string {
  const observed = result.observed_arrival_s == null
    ? t("dart.arrivalObservedMissing")
    : t("dart.arrivalObserved", { value: formatElapsed(result.observed_arrival_s, formatNumber, t) });
  const model = result.model_arrival_s == null
    ? t("dart.arrivalModelMissing")
    : t("dart.arrivalModel", { value: formatElapsed(result.model_arrival_s, formatNumber, t) });
  const residual = result.arrival_residual_s == null
    ? t("dart.arrivalResidualMissing")
    : t("dart.arrivalResidual", { sign: result.arrival_residual_s >= 0 ? "+" : "", value: formatElapsed(result.arrival_residual_s, formatNumber, t) });
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
  eventOriginUtc,
}: {
  buoy: DartBuoy;
  timeS: number;
  modelSeries: [number, number][];
  result?: DartRmseResult;
  eventOriginUtc: string;
}) {
  const { t, formatNumber } = useI18n();
  const semanticId = useId();
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
    t("dart.waterLevel", { name: buoy.name }),
    t("dart.observedPeakDuration", { peak: formatNumber(observedPeak, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), duration: formatNumber(durationMin) }),
  ];
  if (modelSeries.length > 0) ariaParts.push(t("dart.modelPeak", { value: formatNumber(modelPeak, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }));
  if (observedCursor != null) ariaParts.push(t("dart.observedAtCursor", { value: formatNumber(observedCursor, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }));
  if (modelCursor != null) ariaParts.push(t("dart.modelAtCursor", { value: formatNumber(modelCursor, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }));
  if (result) {
    ariaParts.push(arrivalSummary(result, t, formatNumber));
    ariaParts.push(t("dart.arrivalThresholdMethod", { value: formatNumber(result.arrival_threshold_m * 100, { maximumFractionDigits: 0 }), method: result.arrival_method }));
  }
  const observationPeakIndex = obs.reduce(
    (peakIndex, [, value], index) => Math.abs(value) > Math.abs(obs[peakIndex][1]) ? index : peakIndex,
    0,
  );
  const modelPeakIndex = modelSeries.length === 0 ? -1 : modelSeries.reduce(
    (peakIndex, [, value], index) => Math.abs(value) > Math.abs(modelSeries[peakIndex][1]) ? index : peakIndex,
    0,
  );
  const semanticRows: SemanticDataRow[] = [
    ...obs.map(([sampleTime, value], index) => ({
      series: t("dart.observedSeries"),
      selection: t("dart.time", { value: formatNumber(sampleTime, { maximumFractionDigits: 0 }) }),
      value: value.toPrecision(6),
      unit: t("dart.unitElevation"),
      significance: index === observationPeakIndex ? t("dart.observedPeakMagnitude") : t("dart.observationSample"),
      confidence: t("dart.observationConfidence"),
      provenance: t("dart.observationProvenance", { origin: eventOriginUtc }),
    })),
    ...modelSeries.map(([sampleTime, value], index) => ({
      series: t("dart.modelSeries"),
      selection: t("dart.time", { value: formatNumber(sampleTime, { maximumFractionDigits: 0 }) }),
      value: value.toPrecision(6),
      unit: t("dart.unitElevation"),
      significance: index === modelPeakIndex ? t("dart.modelPeakMagnitude") : t("dart.modelSample"),
      confidence: t("dart.modelConfidence"),
      provenance: t("dart.modelProvenance"),
    })),
    ...(observedCursor == null ? [] : [{
      series: t("dart.observedSelection"),
      selection: t("dart.time", { value: formatNumber(timeS, { maximumFractionDigits: 0 }) }),
      value: observedCursor.toPrecision(6),
      unit: t("dart.unitElevation"),
      significance: t("dart.currentInterpolated"),
      confidence: t("dart.observationConfidence"),
      provenance: t("dart.observedSelectionProvenance"),
    }]),
    ...(modelCursor == null ? [] : [{
      series: t("dart.modelSelection"),
      selection: t("dart.time", { value: formatNumber(timeS, { maximumFractionDigits: 0 }) }),
      value: modelCursor.toPrecision(6),
      unit: t("dart.unitElevation"),
      significance: t("dart.currentInterpolated"),
      confidence: t("dart.modelConfidence"),
      provenance: t("dart.modelSelectionProvenance"),
    }]),
    ...(result ? [{
      series: t("dart.detectionThreshold"),
      selection: result.arrival_method,
      value: result.arrival_threshold_m.toPrecision(6),
      unit: t("dart.unitAbsoluteElevation"),
      significance: t("dart.detectionThreshold"),
      confidence: t("dart.noiseMethod", { method: result.noise_method }),
      provenance: t("dart.rmseProvenance"),
    }] : []),
  ];
  const semanticSummary = `${ariaParts.join("; ")}. ${t("dart.semanticSummary")}`;
  return (
    <>
      <svg
        width={w}
        height={h + 14}
        viewBox={`0 0 ${w} ${h + 14}`}
        className="dart__spark"
        role="img"
        aria-label={ariaParts.join("; ")}
        aria-describedby={`${semanticId}-summary`}
      >
        <line x1={0} x2={w} y1={plotCenter} y2={plotCenter} stroke="var(--surface2)" strokeDasharray="2 4" />
        <path data-series="observed" d={observedPath} fill="none" stroke="var(--maroon)" strokeWidth={1.5} />
        {modelPath && (
          <path
            data-series="model"
            d={modelPath}
            fill="none"
            stroke="var(--peach)"
            strokeWidth={1.5}
            strokeDasharray="5 3"
          />
        )}
        {Number.isFinite(cursorX) && cursorX >= 0 && cursorX <= w && (
          <line x1={cursorX} x2={cursorX} y1={plotTop} y2={plotBottom} stroke="var(--sapphire)" strokeWidth={1.5} />
        )}
        {obsArrX != null && obsArrX >= 0 && obsArrX <= w && (
          <>
            <line x1={obsArrX} x2={obsArrX} y1={plotTop} y2={plotBottom} stroke="var(--green)" strokeWidth={1} strokeDasharray="3 3" />
            <text x={obsArrX + 2} y={plotBottom - 2} fontSize="12" fill="var(--green)">{t("dart.observed")}</text>
          </>
        )}
        {modArrX != null && modArrX >= 0 && modArrX <= w && (
          <>
            <line x1={modArrX} x2={modArrX} y1={plotTop} y2={plotBottom} stroke="var(--peach)" strokeWidth={1} strokeDasharray="3 3" />
            <text x={modArrX + 2} y={plotTop + 10} fontSize="12" fill="var(--peach)">{t("dart.model")}</text>
          </>
        )}
        <text x={4} y={12} fontSize="12" fill="var(--subtext)">
          {t("dart.observedPeak", { value: formatNumber(observedPeak, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}{modelSeries.length > 0 ? ` · ${t("dart.modelPeak", { value: formatNumber(modelPeak, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}` : ` · ${t("dart.samples", { count: obs.length })}`}
        </text>
        <text x={4} y={h + 11} fontSize="12" fill="var(--subtext)">
          {t("dart.cursorObserved", { value: observedCursor == null ? "—" : `${formatNumber(observedCursor, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m` })}
          {modelSeries.length > 0 ? ` · ${t("dart.cursorModel", { value: modelCursor == null ? "—" : `${formatNumber(modelCursor, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m` })}` : ""}
        </text>
      </svg>
      <SemanticDataTable
        id={semanticId}
        title={t("dart.comparisonTitle", { name: buoy.name })}
        summary={semanticSummary}
        columns={[
          { key: "series", label: t("dart.columnSeries") },
          { key: "selection", label: t("dart.columnSelection") },
          { key: "value", label: t("dart.columnValue"), dataType: "number" },
          { key: "unit", label: t("dart.columnUnit") },
          { key: "significance", label: t("dart.columnSignificance") },
          { key: "confidence", label: t("dart.columnConfidence") },
          { key: "provenance", label: t("dart.columnProvenance") },
        ]}
        rows={semanticRows}
        filename={`cataclysm-dart-${buoy.id}.csv`}
      />
    </>
  );
}

export function DartOverlay({ presetId, timeS, sweSnapshots }: Props) {
  const { t, formatNumber } = useI18n();
  const [expanded, setExpanded] = useState(true);
  const [fitResult, setFitResult] = useState<AsyncResult<Record<string, BuoyFit>>>({ status: "idle" });
  const fits = asyncResultValue(fitResult) ?? {};
  const [fitFailures, setFitFailures] = useState<string[]>([]);
  const [retryNonce, setRetryNonce] = useState(0);
  const contextRef = useRef<string | null>(null);
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
      contextRef.current = null;
      setFitResult({ status: "idle" });
      setFitFailures([]);
      return;
    }
    const retainPrevious = contextRef.current === eventKey;
    contextRef.current = eventKey;
    setFitResult((current) => startAsyncResult(current, retainPrevious));
    if (!retainPrevious) setFitFailures([]);
    let cancelled = false;
    (async () => {
      const next: Record<string, BuoyFit> = {};
      const failures: string[] = [];
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
          failures.push(`${buoy.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (cancelled) return;
      setFitFailures(failures);
      if (failures.length > 0 && Object.keys(next).length === 0) {
        setFitResult((current) => rejectAsyncResult(current, `Comparison failed for ${failures.join("; ")}`));
      } else {
        setFitResult(resolveAsyncResult(next, (items) => Object.keys(items).length === 0));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [event, eventKey, sweSnapshots, retryNonce]);

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
          {t("dart.title")}
        </button>
        <span
          className="section__badge"
          data-tone={fitResult.status === "error" || fitResult.status === "stale" ? "danger" : fitFailures.length > 0 ? "warning" : fitResult.status === "loading" ? "active" : undefined}
        >
          {fitResult.status === "loading" ? fitResult.previous ? t("dart.refreshing") : t("dart.comparing")
            : fitResult.status === "stale" ? t("dart.stale")
              : fitResult.status === "error" ? t("dart.error")
                : fitFailures.length > 0 ? t("dart.partial")
                : t("dart.buoys", { count: event.buoys.length })}
        </span>
      </div>
      {expanded && (
        <>
          <div className="dart__source">
            <span>{t("dart.origin", { value: formatOrigin(event.event_origin_utc) })}</span>
            <span>{formatNumber(event.epicenter.lat, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}°, {formatNumber(event.epicenter.lon, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}°</span>
          </div>
          <p className="swe__hint">
            {t("dart.description")}
          </p>
          {fitResult.status === "loading" && !fitResult.previous && (
            <div className="empty-state empty-state--compact" role="status">
              <span className="empty-state__icon" aria-hidden />
              <div><strong>{t("dart.comparingTitle")}</strong><p>{t("dart.comparingBody")}</p></div>
            </div>
          )}
          {(fitResult.status === "error" || fitResult.status === "stale") && (
            <div className="panel-error" role="alert">
              <span>{fitResult.status === "stale" ? t("dart.staleBody", { error: fitResult.error }) : t("dart.failedBody", { error: fitResult.error })}</span>
              <button type="button" onClick={() => setRetryNonce((value) => value + 1)}>{t("dart.retry")}</button>
            </div>
          )}
          {fitResult.status !== "error" && fitResult.status !== "stale" && fitFailures.length > 0 && (
            <div className="panel-error" role="alert">
              <span>{t("dart.partialBody", { errors: fitFailures.join("; ") })}</span>
              <button type="button" onClick={() => setRetryNonce((value) => value + 1)}>{t("dart.retryFailed")}</button>
            </div>
          )}
          {fitResult.status === "empty" && (
            <div className="empty-state empty-state--compact" role="status">
              <span className="empty-state__icon" aria-hidden />
              <div><strong>{t("dart.emptyTitle")}</strong><p>{t("dart.emptyBody")}</p></div>
            </div>
          )}
          <div className="chart-legend chart-legend--dart" aria-hidden>
            <span><i data-tone="observed" /> {t("dart.observed")}</span>
            {hasModelEvidence && <span><i data-tone="model" /> {t("dart.sweModel")}</span>}
            <span><i data-tone="cursor" /> {t("dart.timeline")}</span>
            {hasArrivalEvidence && <span><i data-tone="coast" /> {t("dart.arrivalMarkers")}</span>}
          </div>
          {event.buoys.map((b) => {
            const fit = fits[b.id];
            const modelSeries = sweSnapshots ? modelSeriesForBuoy(b.id, sweSnapshots) : [];
            const fitResult = fit?.kind === "ok" || fit?.kind === "no-overlap" ? fit.result : undefined;
            return (
              <div key={b.id} className="dart__buoy">
                <div className="dart__name">{b.name}</div>
                <div className="dart__meta">
                  {formatNumber(b.lat, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}°, {formatNumber(b.lon, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}° · {t("dart.depth", { value: formatNumber(b.depth_m) })}
                </div>
                <Sparkline buoy={b} timeS={timeS} modelSeries={modelSeries} result={fitResult} eventOriginUtc={event.event_origin_utc} />
                {fit?.kind === "ok" && (
                  <div className="dart__rmse" role="note">
                    <span className="dart__rmse-value">
                      {t("dart.rmse", { value: formatNumber(fit.result.rmse_m ?? 0, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}
                    </span>
                    <span>
                      {t("dart.overlap", { start: formatElapsed(fit.result.overlap_start_s ?? 0, formatNumber, t), end: formatElapsed(fit.result.overlap_end_s ?? 0, formatNumber, t), count: fit.result.n_samples })}
                    </span>
                    <span>{t("dart.peakComparison", { observed: formatNumber(fit.result.observed_peak_m, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), model: formatNumber(fit.result.model_peak_m, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}</span>
                    <span>{t("dart.arrival", { value: arrivalSummary(fit.result, t, formatNumber) })}</span>
                    <span>
                      {t("dart.methodThresholdNoise", { method: fit.result.arrival_method, threshold: formatNumber(fit.result.arrival_threshold_m * 100, { maximumFractionDigits: 0 }), noise: fit.result.noise_method })}
                    </span>
                  </div>
                )}
                {fit?.kind === "no-overlap" && (
                  <div className="dart__rmse dart__rmse--muted" role="note">
                    <span>{t("dart.noOverlap")}</span>
                    <span>{t("dart.arrival", { value: arrivalSummary(fit.result, t, formatNumber) })}</span>
                    <span>
                      {t("dart.methodThresholdNoise", { method: fit.result.arrival_method, threshold: formatNumber(fit.result.arrival_threshold_m * 100, { maximumFractionDigits: 0 }), noise: fit.result.noise_method })}
                    </span>
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
