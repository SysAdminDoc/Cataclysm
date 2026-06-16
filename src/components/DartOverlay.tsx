import { useMemo, useState } from "react";
import { getDartEvents, getDartBuoysForPreset, PRESET_TO_DART_EVENT } from "../lib/data";
import type { DartBuoy, DartEvent, InitialDisplacement } from "../types/scenario";

type Props = {
  presetId: string | null;
  timeS: number;
  initial?: InitialDisplacement | null;
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

function observedArrivalS(buoy: DartBuoy): number | null {
  const threshold = buoyPeakAbsAmp(buoy) * 0.05;
  if (threshold < 1e-4) return null;
  for (const [t, v] of buoy.observations) {
    if (Math.abs(v) > threshold) return t;
  }
  return null;
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_008.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function modelArrivalS(buoy: DartBuoy, initial: InitialDisplacement | null | undefined): number | null {
  if (!initial) return null;
  const dist = haversineM(initial.center.lat_deg, initial.center.lon_deg, buoy.lat, buoy.lon);
  const depth = initial.center.depth_m ?? 4000;
  const c = Math.sqrt(9.81 * Math.max(depth, 50));
  if (c <= 0) return null;
  return dist / c;
}

/** Sparkline of a buoy's observation series — observed in red, current-time cursor in blue,
 *  with optional model/observed arrival-time comparison markers. */
function Sparkline({ buoy, timeS, initial }: { buoy: DartBuoy; timeS: number; initial?: InitialDisplacement | null }) {
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
  const obsArr = observedArrivalS(buoy);
  const modArr = modelArrivalS(buoy, initial);
  const obsArrX = obsArr != null ? ((obsArr - tMin) / (tMax - tMin || 1)) * w : null;
  const modArrX = modArr != null ? ((modArr - tMin) / (tMax - tMin || 1)) * w : null;
  const arrivalDeltaMin = obsArr != null && modArr != null ? ((modArr - obsArr) / 60) : null;
  return (
    <svg width={w} height={h + 14} viewBox={`0 0 ${w} ${h + 14}`} className="dart__spark">
      <line x1={0} x2={w} y1={h * 0.5} y2={h * 0.5} stroke="var(--surface2)" strokeDasharray="2 4" />
      <path d={d} fill="none" stroke="var(--maroon)" strokeWidth={1.5} />
      {Number.isFinite(cursorX) && cursorX >= 0 && cursorX <= w && (
        <line x1={cursorX} x2={cursorX} y1={0} y2={h} stroke="var(--sapphire)" strokeWidth={1.5} />
      )}
      {obsArrX != null && obsArrX >= 0 && obsArrX <= w && (
        <>
          <line x1={obsArrX} x2={obsArrX} y1={0} y2={h} stroke="var(--green)" strokeWidth={1} strokeDasharray="3 3" />
          <text x={obsArrX + 2} y={h - 2} fontSize="8" fill="var(--green)">obs</text>
        </>
      )}
      {modArrX != null && modArrX >= 0 && modArrX <= w && (
        <>
          <line x1={modArrX} x2={modArrX} y1={0} y2={h} stroke="var(--peach)" strokeWidth={1} strokeDasharray="3 3" />
          <text x={modArrX + 2} y={10} fontSize="8" fill="var(--peach)">model</text>
        </>
      )}
      <text x={4} y={12} fontSize="10" fill="var(--subtext)">
        peak {peak.toFixed(2)} m · t-cursor {cur.toFixed(2)} m · {obs.length} samples
      </text>
      {arrivalDeltaMin != null && (
        <text x={4} y={h + 11} fontSize="9" fill="var(--subtext)">
          arrival Δ {arrivalDeltaMin > 0 ? "+" : ""}{arrivalDeltaMin.toFixed(0)} min (model vs observed)
        </text>
      )}
    </svg>
  );
}

export function DartOverlay({ presetId, timeS, initial }: Props) {
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
              <Sparkline buoy={b} timeS={timeS} initial={initial} />
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
