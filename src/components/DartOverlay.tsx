import { useEffect, useMemo, useState } from "react";
import { getDartEvents, PRESET_TO_DART_EVENT } from "../lib/data";
import { api, isTauri, type DartRmseResult } from "../lib/tauri";
import type { DartBuoy, DartEvent, GridSnapshot, InitialDisplacement } from "../types/scenario";
import { UiIcon } from "./UiIcon";

type Props = {
  presetId: string | null;
  timeS: number;
  initial?: InitialDisplacement | null;
  /** Completed SWE snapshots (slot A). When they carry `dart-<id>` gauge
   *  samples, model-vs-observed RMSE is computed per buoy via Rust IPC. */
  sweSnapshots?: GridSnapshot[] | null;
};

type BuoyFit =
  | { kind: "ok"; result: DartRmseResult }
  | { kind: "no-overlap" }
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

function formatOrigin(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace("T", " ").slice(0, 16);
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
    <svg
      width={w}
      height={h + 14}
      viewBox={`0 0 ${w} ${h + 14}`}
      className="dart__spark"
      role="img"
      aria-label={`${buoy.name} observed DART water level sparkline`}
    >
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

export function DartOverlay({ presetId, timeS, initial, sweSnapshots }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [fits, setFits] = useState<Record<string, BuoyFit>>({});
  const eventKey = presetId ? PRESET_TO_DART_EVENT[presetId] : null;
  const event: DartEvent | null = useMemo(
    () => (eventKey ? db.events[eventKey] ?? null : null),
    [eventKey],
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
          next[buoy.id] = { kind: "ok", result };
        } catch (err) {
          // The solver window (60 min) can end before the wave reaches a
          // distant buoy — the IPC rejects series with no time overlap. Only
          // that documented case is "no-overlap"; any other rejection is a real
          // failure that must not masquerade as a benign no-comparison state.
          if (/overlap/i.test(String(err))) {
            next[buoy.id] = { kind: "no-overlap" };
          } else {
            console.error(`dartBuoyRmse failed for ${buoy.id}`, err);
            next[buoy.id] = { kind: "error" };
          }
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
            event. Compare model vs. data: the blue cursor tracks the
            timeline scrubber.
          </p>
          <div className="chart-legend chart-legend--dart" aria-hidden>
            <span><i data-tone="observed" /> Observed</span>
            <span><i data-tone="cursor" /> Timeline</span>
            <span><i data-tone="coast" /> Arrival markers</span>
          </div>
          {event.buoys.map((b) => {
            const fit = fits[b.id];
            return (
              <div key={b.id} className="dart__buoy">
                <div className="dart__name">{b.name}</div>
                <div className="dart__meta">
                  {b.lat.toFixed(2)}°, {b.lon.toFixed(2)}° · {b.depth_m} m deep
                </div>
                <Sparkline buoy={b} timeS={timeS} initial={initial} />
                {fit?.kind === "ok" && (
                  <div className="dart__rmse" role="note">
                    <span className="dart__rmse-value">
                      RMSE {fit.result.rmse_m.toFixed(2)} m
                    </span>
                    <span>
                      model peak {fit.result.model_peak_m.toFixed(2)} m vs observed{" "}
                      {fit.result.observed_peak_m.toFixed(2)} m · {fit.result.n_samples} samples
                    </span>
                  </div>
                )}
                {fit?.kind === "no-overlap" && (
                  <div className="dart__rmse dart__rmse--muted" role="note">
                    Solver window ends before this buoy's observations — no RMSE.
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
