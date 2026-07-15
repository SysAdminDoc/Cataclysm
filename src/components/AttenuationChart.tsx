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

type Props = {
  initial: InitialDisplacement | null;
  isImpact: boolean;
  timeS: number;
  runupResults: RunupAtPointResult[];
};

const W = 280;
const H = 120;
const PAD_L = 42;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 24;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

type Sample = { range_km: number; amplitude_m: number };

const CURVE_SAMPLES = 80;
const CURVE_MAX_RANGE_M = 10_000_000;

function formatAxis(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(0)}k`;
  if (v >= 1) return v.toFixed(v < 10 ? 1 : 0);
  return v.toFixed(2);
}

export function AttenuationChart({ initial, isImpact, timeS, runupResults }: Props) {
  const [curveResult, setCurveResult] = useState<AsyncResult<Sample[]>>({ status: "idle" });
  const curve = asyncResultValue(curveResult);
  const [retryNonce, setRetryNonce] = useState(0);
  const contextRef = useRef<string | null>(null);
  const semanticId = useId();

  // Decay physics come from the Rust `attenuation_curve` command; the JS
  // approximation in demo.ts only serves the watermarked browser preview.
  useEffect(() => {
    if (!initial) {
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
    if (!isTauri()) {
      const samples = demoAttenuationCurve(
          initial.peak_amplitude_m,
          initial.cavity_radius_m,
          alpha,
          CURVE_MAX_RANGE_M,
          CURVE_SAMPLES,
        ).map((s) => ({ range_km: s.range_m / 1000, amplitude_m: s.amplitude_m }));
      setCurveResult(resolveAsyncResult(samples, (items) => items.length === 0));
      return;
    }
    let cancelled = false;
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
  }, [initial, isImpact, retryNonce]);

  const arrivedPoints = useMemo(() => {
    return runupResults
      .filter((r) => r.has_arrived && r.offshore_amplitude_m > 0)
      .map((r) => ({ ...r, range_km: r.range_m / 1000, amplitude_m: r.offshore_amplitude_m }));
  }, [runupResults]);

  if (!initial) {
    return (
      <div className="section">
        <div className="section__title">
          <span>Wave attenuation</span>
          <span className="section__badge" data-tone="muted">Waiting</span>
        </div>
        <div className="empty-state empty-state--compact">
          <span className="empty-state__icon" aria-hidden />
          <div>
            <strong>Amplitude curve appears after source selection</strong>
            <p>The chart compares modeled decay, the active wavefront, and arrived coastal samples.</p>
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
          <span>Wave attenuation</span>
          <span className="section__badge" data-tone={failed ? "danger" : "muted"}>
            {failed ? "Error" : empty ? "Empty" : "Loading"}
          </span>
        </div>
        <div className={failed ? "panel-error" : "empty-state empty-state--compact"} role={failed ? "alert" : "status"}>
          {!failed && <span className="empty-state__icon" aria-hidden />}
          <div>
            <strong>{failed ? "Couldn't compute wave attenuation" : empty ? "No attenuation samples returned" : "Computing attenuation curve…"}</strong>
            <p>{failed ? curveResult.error : empty ? "The computation completed successfully but returned no samples." : "The current source remains selected while the analytical curve is prepared."}</p>
            {(failed || empty) && <button type="button" onClick={() => setRetryNonce((value) => value + 1)}>Retry attenuation</button>}
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
    ? "Rust attenuation_curve command"
    : "Browser preview demo attenuation approximation";
  const semanticRows: SemanticDataRow[] = [
    ...curve.map((sample, index) => ({
      series: "Modeled decay",
      selection: `${sample.range_km.toFixed(2)} km from source`,
      value: sample.amplitude_m.toPrecision(6),
      unit: "m surface amplitude",
      significance: index === 0 ? "Maximum" : index === curve.length - 1 ? "Minimum" : index === nearestWavefrontIndex ? "Nearest active wavefront" : "Sample",
      confidence: "Illustrative far-field analytical estimate",
      provenance: modelProvenance,
    })),
    ...(wavefrontRange == null ? [] : [{
      series: "Active wavefront",
      selection: `T+${timeS.toFixed(0)} s`,
      value: wavefrontRange.toFixed(3),
      unit: "km from source",
      significance: "Current timeline selection",
      confidence: "Kinematic shallow-water travel estimate",
      provenance: `sqrt(g × ${depth.toFixed(0)} m depth) × time`,
    }]),
    {
      series: "Coastal inclusion threshold",
      selection: "Arrived samples only",
      value: 0,
      unit: "m offshore amplitude",
      significance: "Strictly greater than threshold",
      confidence: "Display filter, not an alert threshold",
      provenance: "runup_at_points arrival flag and offshore amplitude",
    },
    ...arrivedPoints.map((point) => ({
      series: `Coastal sample — ${point.name}`,
      selection: `${point.range_km.toFixed(2)} km from source`,
      value: point.amplitude_m.toPrecision(6),
      unit: "m offshore amplitude",
      significance: point === highestArrived ? "Highest arrived sample" : "Arrived sample",
      confidence: `${point.quantitative_label}; ${point.quantitative_confidence} confidence`,
      provenance: `${point.slope_provenance.source}; ${point.depth_provenance.source}`,
    })),
  ];
  const semanticSummary = [
    `Modeled decay spans ${maxAmp.toPrecision(4)} m at ${minRange.toFixed(2)} km to ${curve[curve.length - 1].amplitude_m.toPrecision(4)} m at ${maxRange.toFixed(0)} km.`,
    wavefrontRange == null ? "No active wavefront at the source time." : `The active wavefront estimate is ${wavefrontRange.toFixed(1)} km at T+${timeS.toFixed(0)} s.`,
    highestArrived ? `${arrivedPoints.length} coastal samples have arrived; ${highestArrived.name} is highest at ${highestArrived.amplitude_m.toFixed(2)} m offshore amplitude.` : "No positive arrived coastal sample is active.",
  ].join(" ");

  return (
    <div className="section">
      <div className="section__title">
        <span>Wave attenuation</span>
        <span className="section__badge" data-tone={curveResult.status === "stale" ? "danger" : curveResult.status === "loading" ? "active" : undefined}>
          {curveResult.status === "stale" ? "Stale" : curveResult.status === "loading" ? "Refreshing" : `${arrivedPoints.length} arrived`}
        </span>
      </div>
      {curveResult.status === "stale" && (
        <div className="panel-error" role="alert">
          <span>Showing the last valid attenuation curve: {curveResult.error}</span>
          <button type="button" onClick={() => setRetryNonce((value) => value + 1)}>Retry attenuation</button>
        </div>
      )}
      <div className="chart-shell">
        <svg viewBox={`0 0 ${W} ${H}`} className="attenuation-chart" role="img" aria-label="Modeled wave amplitude decay by distance" aria-describedby={`${semanticId}-summary`}>
          {yTicks.map((logV) => {
            const y = toY(10 ** logV);
            return (
              <g key={`y-${logV}`}>
                <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="var(--surface1)" strokeWidth={0.5} />
                <text x={PAD_L - 4} y={y + 3} textAnchor="end" fill="var(--overlay0)" fontSize={8}>
                  {formatAxis(10 ** logV)} m
                </text>
              </g>
            );
          })}
          {xTicks.map((logV) => {
            const x = toX(10 ** logV);
            return (
              <text key={`x-${logV}`} x={x} y={H - 4} textAnchor="middle" fill="var(--overlay0)" fontSize={8}>
                {formatAxis(10 ** logV)} km
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
              <title>{p.name}: {p.amplitude_m.toFixed(2)} m @ {p.range_km.toFixed(0)} km</title>
            </circle>
          ))}
        </svg>
        <div className="chart-legend" aria-hidden>
          <span><i data-tone="curve" /> Modeled decay</span>
          <span><i data-tone="front" /> Wavefront</span>
          <span><i data-tone="coast" /> Coast samples</span>
        </div>
        <SemanticDataTable
          id={semanticId}
          title="wave attenuation"
          summary={semanticSummary}
          columns={[
            { key: "series", label: "Series" },
            { key: "selection", label: "Distance or selection" },
            { key: "value", label: "Value", dataType: "number" },
            { key: "unit", label: "Unit" },
            { key: "significance", label: "Extrema, threshold, or active state" },
            { key: "confidence", label: "Confidence" },
            { key: "provenance", label: "Provenance" },
          ]}
          rows={semanticRows}
          filename="cataclysm-wave-attenuation.csv"
        />
      </div>
    </div>
  );
}
