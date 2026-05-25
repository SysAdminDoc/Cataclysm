import { useMemo, useState } from "react";
import { getDartEvents, getDartBuoysForPreset, PRESET_TO_DART_EVENT } from "../lib/data";
import type { DartBuoy, DartEvent } from "../types/scenario";

type Props = {
  presetId: string | null;
  timeS: number;
};

const db = getDartEvents();

function sampleEta(buoy: DartBuoy, t_s: number): number {
  const obs = buoy.observations;
  if (obs.length === 0) return 0;
  if (t_s <= obs[0][0]) return obs[0][1];
  if (t_s >= obs[obs.length - 1][0]) return obs[obs.length - 1][1];
  for (let i = 1; i < obs.length; i++) {
    const [t1, v1] = obs[i];
    if (t1 >= t_s) {
      const [t0, v0] = obs[i - 1];
      const u = (t_s - t0) / (t1 - t0 || 1);
      return v0 + (v1 - v0) * u;
    }
  }
  return 0;
}

function buoyPeakAbsAmp(buoy: DartBuoy): number {
  return buoy.observations.reduce((m, [, v]) => Math.max(m, Math.abs(v)), 0);
}

/** Sparkline of a buoy's observation series — observed in red, current-time cursor in blue. */
function Sparkline({ buoy, timeS }: { buoy: DartBuoy; timeS: number }) {
  const w = 280;
  const h = 60;
  const obs = buoy.observations;
  if (obs.length < 2) return null;
  const tMin = obs[0][0];
  const tMax = obs[obs.length - 1][0];
  const peak = buoyPeakAbsAmp(buoy) || 1;
  const xs = obs.map(([t]) => ((t - tMin) / (tMax - tMin || 1)) * w);
  const ys = obs.map(([, v]) => h * 0.5 - (v / peak) * h * 0.45);
  const d = xs.map((x, i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(" ");
  const cursorX = ((timeS - tMin) / (tMax - tMin || 1)) * w;
  const cur = sampleEta(buoy, timeS);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="dart__spark">
      <line x1={0} x2={w} y1={h * 0.5} y2={h * 0.5} stroke="var(--surface2)" strokeDasharray="2 4" />
      <path d={d} fill="none" stroke="var(--maroon)" strokeWidth={1.5} />
      {Number.isFinite(cursorX) && cursorX >= 0 && cursorX <= w && (
        <line x1={cursorX} x2={cursorX} y1={0} y2={h} stroke="var(--sapphire)" strokeWidth={1.5} />
      )}
      <text x={4} y={12} fontSize="10" fill="var(--subtext)">
        peak {peak.toFixed(2)} m · t-cursor {cur.toFixed(2)} m
      </text>
    </svg>
  );
}

export function DartOverlay({ presetId, timeS }: Props) {
  const [expanded, setExpanded] = useState(true);
  const eventKey = presetId ? PRESET_TO_DART_EVENT[presetId] : null;
  const event: DartEvent | null = useMemo(
    () => (eventKey ? db.events[eventKey] ?? null : null),
    [eventKey],
  );

  if (!event) return null;

  return (
    <div className="section">
      <div className="section__title">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="dart__toggle"
          aria-expanded={expanded}
        >
          {expanded ? "▼" : "▶"} DART buoy observations
        </button>
      </div>
      {expanded && (
        <>
          <p className="swe__hint">
            Observed water-surface elevation from NOAA DART buoys for this
            event. Compare model vs. data: the blue cursor tracks the
            timeline scrubber.
          </p>
          {event.buoys.map((b) => (
            <div key={b.id} className="dart__buoy">
              <div className="dart__name">{b.name}</div>
              <div className="dart__meta">
                {b.lat.toFixed(2)}°, {b.lon.toFixed(2)}° · {b.depth_m} m deep
              </div>
              <Sparkline buoy={b} timeS={timeS} />
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/** Helper for the Globe component: list DART pins to render for an event. */
export function dartPinsForPreset(presetId: string | null): DartBuoy[] {
  return [...getDartBuoysForPreset(presetId)];
}
