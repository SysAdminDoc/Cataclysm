import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { InitialDisplacement } from "../types/scenario";
import { api, isTauri, type RunupAtPointResult } from "../lib/tauri";
import { demoAttenuationCurve } from "../lib/demo";
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
  initial: InitialDisplacement | null;
  isImpact: boolean;
  timeS: number;
  runupResults: RunupAtPointResult[];
  movingPressure?: boolean;
};

const W = 320;
const H = 150;
const PAD_L = 62;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 32;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

type Sample = { range_km: number; amplitude_m: number };

const CURVE_SAMPLES = 80;
const CURVE_MAX_RANGE_M = 10_000_000;

function formatAxis(v: number, formatNumber: ReturnType<typeof useI18n>["formatNumber"]): string {
  if (v >= 1000) return `${formatNumber(v / 1000, { maximumFractionDigits: 0 })}k`;
  if (v >= 1) return formatNumber(v, { minimumFractionDigits: v < 10 ? 1 : 0, maximumFractionDigits: v < 10 ? 1 : 0 });
  return formatNumber(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function AttenuationChart({ initial, isImpact, timeS, runupResults, movingPressure = false }: Props) {
  const { t, formatNumber } = useI18n();
  const [curveResult, setCurveResult] = useState<AsyncResult<Sample[]>>({ status: "idle" });
  const curve = asyncResultValue(curveResult);
  const [retryNonce, setRetryNonce] = useState(0);
  const contextRef = useRef<string | null>(null);
  const semanticId = useId();

  // Decay physics come from the Rust `attenuation_curve` command; the JS
  // Browser preview calls the same Rust curve through the checked-in WASM ABI.
  useEffect(() => {
    if (!initial || movingPressure) {
      contextRef.current = null;
      setCurveResult({ status: "idle" });
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
    setCurveResult((current) => startAsyncResult(current, retainPrevious));
    const alpha = isImpact ? 5 / 6 : 0.5;
    let cancelled = false;
    if (!isTauri()) {
      void demoAttenuationCurve(
          initial.peak_amplitude_m,
          initial.cavity_radius_m,
          alpha,
          CURVE_MAX_RANGE_M,
          CURVE_SAMPLES,
        ).then((samples) => {
          if (cancelled) return;
          const mapped = samples.map((s) => ({ range_km: s.range_m / 1000, amplitude_m: s.amplitude_m }));
          setCurveResult(resolveAsyncResult(mapped, (items) => items.length === 0));
        }).catch((error) => {
          if (!cancelled) setCurveResult((current) => rejectAsyncResult(current, error));
        });
      return () => {
        cancelled = true;
      };
    }
    api
      .attenuationCurve({
        initial_amplitude_m: initial.peak_amplitude_m,
        cavity_radius_m: initial.cavity_radius_m,
        decay_alpha: alpha,
        max_range_m: CURVE_MAX_RANGE_M,
        n_samples: CURVE_SAMPLES,
      })
      .then((samples) => {
        if (cancelled) return;
        const mapped = samples.map((s) => ({ range_km: s.range_m / 1000, amplitude_m: s.amplitude_m }));
        setCurveResult(resolveAsyncResult(mapped, (items) => items.length === 0));
      })
      .catch((error) => {
        if (!cancelled) setCurveResult((current) => rejectAsyncResult(current, error));
      });
    return () => {
      cancelled = true;
    };
  }, [initial, isImpact, movingPressure, retryNonce]);

  const arrivedPoints = useMemo(() => {
    return runupResults
      .filter((r) => r.has_arrived && r.offshore_amplitude_m > 0)
      .map((r) => ({ ...r, range_km: r.range_m / 1000, amplitude_m: r.offshore_amplitude_m }));
  }, [runupResults]);

  if (!initial) {
    return (
      <div className="section">
        <div className="section__title">
          <span>{t("attenuation.title")}</span>
          <span className="section__badge" data-tone="muted">{t("attenuation.waiting")}</span>
        </div>
        <div className="empty-state empty-state--compact">
          <span className="empty-state__icon" aria-hidden />
          <div>
            <strong>{t("attenuation.waitingTitle")}</strong>
            <p>{t("attenuation.waitingBody")}</p>
          </div>
        </div>
      </div>
    );
  }

  if (movingPressure) {
    return (
      <div className="section">
        <div className="section__title">
          <span>{t("attenuation.title")}</span>
          <span className="section__badge" data-tone="muted">{t("attenuation.sweOnly")}</span>
        </div>
        <div className="empty-state empty-state--compact">
          <span className="empty-state__icon" aria-hidden />
          <div>
            <strong>{t("attenuation.radialTitle")}</strong>
            <p>{t("attenuation.radialBody")}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!curve) {
    const failed = curveResult.status === "error";
    const empty = curveResult.status === "empty";
    return (
      <div className="section">
        <div className="section__title">
          <span>{t("attenuation.title")}</span>
          <span className="section__badge" data-tone={failed ? "danger" : "muted"}>
            {failed ? t("attenuation.error") : empty ? t("attenuation.empty") : t("attenuation.loading")}
          </span>
        </div>
        <div className={failed ? "panel-error" : "empty-state empty-state--compact"} role={failed ? "alert" : "status"}>
          {!failed && <span className="empty-state__icon" aria-hidden />}
          <div>
            <strong>{failed ? t("attenuation.computeFailed") : empty ? t("attenuation.noSamples") : t("attenuation.computing")}</strong>
            <p>{failed ? curveResult.error : empty ? t("attenuation.noSamplesBody") : t("attenuation.computingBody")}</p>
            {(failed || empty) && <button type="button" onClick={() => setRetryNonce((value) => value + 1)}>{t("attenuation.retry")}</button>}
          </div>
        </div>
      </div>
    );
  }

  const maxAmp = Math.max(...curve.map((s) => s.amplitude_m), 0.01);
  const maxRange = curve[curve.length - 1].range_km;
  const minRange = curve[0].range_km;
  const logMinR = Math.log10(Math.max(minRange, 0.1));
  const logMaxR = Math.log10(Math.max(maxRange, 1));
  const logMaxA = Math.log10(Math.max(maxAmp, 0.01));
  const logMinA = logMaxA - 4;

  const toX = (rKm: number) =>
    PAD_L + ((Math.log10(Math.max(rKm, 0.1)) - logMinR) / (logMaxR - logMinR)) * PLOT_W;
  const toY = (amp: number) =>
    PAD_T + (1 - (Math.log10(Math.max(amp, 10 ** logMinA)) - logMinA) / (logMaxA - logMinA)) * PLOT_H;

  const pathD = curve
    .map((s, i) => `${i === 0 ? "M" : "L"}${toX(s.range_km).toFixed(1)},${toY(s.amplitude_m).toFixed(1)}`)
    .join(" ");

  const depth = initial.center.depth_m ?? 4000;
  const wavefrontRange = timeS > 0 && depth > 0
    ? (Math.sqrt(9.81 * Math.max(depth, 50)) * timeS) / 1000
    : null;

  const yTicks = [logMaxA, logMaxA - 1, logMaxA - 2, logMaxA - 3].filter((v) => v >= logMinA);
  const xTicks = Array.from(
    { length: Math.min(5, Math.ceil(logMaxR - logMinR) + 1) },
    (_, i) => Math.ceil(logMinR) + i,
  ).filter((v) => v <= logMaxR);
  const nearestWavefrontIndex = wavefrontRange == null
    ? -1
    : curve.reduce((nearest, sample, index) =>
      Math.abs(sample.range_km - wavefrontRange) < Math.abs(curve[nearest].range_km - wavefrontRange)
        ? index
        : nearest, 0);
  const highestArrived = arrivedPoints.reduce<(typeof arrivedPoints)[number] | null>(
    (highest, point) => !highest || point.amplitude_m > highest.amplitude_m ? point : highest,
    null,
  );
  const modelProvenance = isTauri()
    ? t("attenuation.provenanceDesktop")
    : t("attenuation.provenanceBrowser");
  const semanticRows: SemanticDataRow[] = [
    ...curve.map((sample, index) => ({
      series: t("attenuation.modeledDecay"),
      selection: t("attenuation.distance", { value: formatNumber(sample.range_km, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }),
      value: sample.amplitude_m.toPrecision(6),
      unit: t("attenuation.unitAmplitude"),
      significance: index === 0 ? t("attenuation.maximum") : index === curve.length - 1 ? t("attenuation.minimum") : index === nearestWavefrontIndex ? t("attenuation.nearestWavefront") : t("attenuation.sample"),
      confidence: t("attenuation.analyticalConfidence"),
      provenance: modelProvenance,
    })),
    ...(wavefrontRange == null ? [] : [{
      series: t("attenuation.activeWavefront"),
      selection: t("attenuation.time", { value: formatNumber(timeS, { maximumFractionDigits: 0 }) }),
      value: wavefrontRange.toFixed(3),
      unit: t("attenuation.unitDistance"),
      significance: t("attenuation.currentTimeline"),
      confidence: t("attenuation.kinematicConfidence"),
      provenance: t("attenuation.wavefrontFormula", { depth: formatNumber(depth, { maximumFractionDigits: 0 }) }),
    }]),
    {
      series: t("attenuation.coastalThreshold"),
      selection: t("attenuation.arrivedOnly"),
      value: 0,
      unit: t("attenuation.unitOffshore"),
      significance: t("attenuation.strictThreshold"),
      confidence: t("attenuation.displayFilter"),
      provenance: t("attenuation.runupProvenance"),
    },
    ...arrivedPoints.map((point) => ({
      series: t("attenuation.coastalSample", { name: point.name }),
      selection: t("attenuation.distance", { value: formatNumber(point.range_km, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }),
      value: point.amplitude_m.toPrecision(6),
      unit: t("attenuation.unitOffshore"),
      significance: point === highestArrived ? t("attenuation.highestArrived") : t("attenuation.arrivedSample"),
      confidence: t("attenuation.coastalConfidence", { label: point.quantitative_label, confidence: point.quantitative_confidence }),
      provenance: `${point.slope_provenance.source}; ${point.depth_provenance.source}`,
    })),
  ];
  const semanticSummary = [
    t("attenuation.summaryDecay", { maxAmp: formatNumber(maxAmp, { maximumSignificantDigits: 4 }), minRange: formatNumber(minRange, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), endAmp: formatNumber(curve[curve.length - 1].amplitude_m, { maximumSignificantDigits: 4 }), maxRange: formatNumber(maxRange, { maximumFractionDigits: 0 }) }),
    wavefrontRange == null ? t("attenuation.summaryNoWavefront") : t("attenuation.summaryWavefront", { range: formatNumber(wavefrontRange, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), time: formatNumber(timeS, { maximumFractionDigits: 0 }) }),
    highestArrived ? t("attenuation.summaryArrived", { count: arrivedPoints.length, name: highestArrived.name, amplitude: formatNumber(highestArrived.amplitude_m, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }) : t("attenuation.summaryNoArrived"),
  ].join(" ");

  return (
    <div className="section">
      <div className="section__title">
        <span>{t("attenuation.title")}</span>
        <span className="section__badge" data-tone={curveResult.status === "stale" ? "danger" : curveResult.status === "loading" ? "active" : undefined}>
          {curveResult.status === "stale" ? t("attenuation.stale") : curveResult.status === "loading" ? t("attenuation.refreshing") : t("attenuation.arrived", { count: arrivedPoints.length })}
        </span>
      </div>
      {curveResult.status === "stale" && (
        <div className="panel-error" role="alert">
          <span>{t("attenuation.staleBody", { error: curveResult.error })}</span>
          <button type="button" onClick={() => setRetryNonce((value) => value + 1)}>{t("attenuation.retry")}</button>
        </div>
      )}
      <div className="chart-shell">
        <svg viewBox={`0 0 ${W} ${H}`} className="attenuation-chart" role="img" aria-label={t("attenuation.chartAria")} aria-describedby={`${semanticId}-summary`}>
          {yTicks.map((logV) => {
            const y = toY(10 ** logV);
            return (
              <g key={`y-${logV}`}>
                <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="var(--surface1)" strokeWidth={0.5} />
                <text x={PAD_L - 6} y={y + 4} textAnchor="end" fill="var(--overlay0)" fontSize={12}>
                  {formatAxis(10 ** logV, formatNumber)} m
                </text>
              </g>
            );
          })}
          {xTicks.map((logV) => {
            const x = toX(10 ** logV);
            return (
              <text key={`x-${logV}`} x={x} y={H - 6} textAnchor="middle" fill="var(--overlay0)" fontSize={12}>
                {formatAxis(10 ** logV, formatNumber)} km
              </text>
            );
          })}
          <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
          {wavefrontRange && wavefrontRange > minRange && wavefrontRange < maxRange && (
            <line
              x1={toX(wavefrontRange)}
              x2={toX(wavefrontRange)}
              y1={PAD_T}
              y2={PAD_T + PLOT_H}
              stroke="var(--peach)"
              strokeWidth={1}
              strokeDasharray="3,2"
            />
          )}
          {arrivedPoints.slice(0, 12).map((p, i) => (
            <circle
              key={i}
              cx={toX(p.range_km)}
              cy={toY(p.amplitude_m)}
              r={3}
              fill="var(--teal)"
              opacity={0.8}
            >
              <title>{t("attenuation.pointTitle", { name: p.name, amplitude: formatNumber(p.amplitude_m, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), range: formatNumber(p.range_km, { maximumFractionDigits: 0 }) })}</title>
            </circle>
          ))}
        </svg>
        <div className="chart-legend" aria-hidden>
          <span><i data-tone="curve" /> {t("attenuation.modeledDecay")}</span>
          <span><i data-tone="front" /> {t("attenuation.wavefront")}</span>
          <span><i data-tone="coast" /> {t("attenuation.coastSamples")}</span>
        </div>
        <SemanticDataTable
          id={semanticId}
          title={t("attenuation.dataTitle")}
          summary={semanticSummary}
          columns={[
            { key: "series", label: t("attenuation.columnSeries") },
            { key: "selection", label: t("attenuation.columnSelection") },
            { key: "value", label: t("attenuation.columnValue"), dataType: "number" },
            { key: "unit", label: t("attenuation.columnUnit") },
            { key: "significance", label: t("attenuation.columnSignificance") },
            { key: "confidence", label: t("attenuation.columnConfidence") },
            { key: "provenance", label: t("attenuation.columnProvenance") },
          ]}
          rows={semanticRows}
          filename="cataclysm-wave-attenuation.csv"
        />
      </div>
    </div>
  );
}
