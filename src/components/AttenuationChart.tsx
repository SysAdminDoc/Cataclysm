import { useMemo } from "react";
import type { InitialDisplacement } from "../types/scenario";
import type { RunupAtPointResult } from "../lib/tauri";

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

function computeDecayCurve(
  peakAmp: number,
  cavityR: number,
  isImpact: boolean,
  nSamples: number,
): Sample[] {
  const alpha = isImpact ? 5 / 6 : 0.5;
  const r0 = Math.max(cavityR, 1000);
  const maxRange = 10_000_000;
  const samples: Sample[] = [];
  for (let i = 0; i < nSamples; i++) {
    const frac = i / (nSamples - 1);
    const range = r0 + frac * (maxRange - r0);
    const att = Math.pow(r0 / range, alpha);
    samples.push({ range_km: range / 1000, amplitude_m: peakAmp * att });
  }
  return samples;
}

function formatAxis(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(0)}k`;
  if (v >= 1) return v.toFixed(v < 10 ? 1 : 0);
  return v.toFixed(2);
}

export function AttenuationChart({ initial, isImpact, timeS, runupResults }: Props) {
  const curve = useMemo(() => {
    if (!initial) return null;
    return computeDecayCurve(
      initial.peak_amplitude_m,
      initial.cavity_radius_m,
      isImpact,
      80,
    );
  }, [initial, isImpact]);

  const arrivedPoints = useMemo(() => {
    return runupResults
      .filter((r) => r.has_arrived && r.offshore_amplitude_m > 0)
      .map((r) => ({ range_km: r.range_m / 1000, amplitude_m: r.offshore_amplitude_m, name: r.name }));
  }, [runupResults]);

  if (!curve || !initial) {
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

  return (
    <div className="section">
      <div className="section__title">
        <span>Wave attenuation</span>
        <span className="section__badge">{arrivedPoints.length} arrived</span>
      </div>
      <div className="chart-shell">
        <svg viewBox={`0 0 ${W} ${H}`} className="attenuation-chart" role="img" aria-label="Modeled wave amplitude decay by distance">
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
      </div>
    </div>
  );
}
