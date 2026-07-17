import { useMemo, useState } from "react";
import {
  buildWw3ExchangePlan,
  formatWw3Number,
  WW3_SCENARIOS,
  WW3_SIDE_COLORS,
  WW3_SIDE_LABELS,
  type Ww3ExchangePlan,
  type Ww3Side,
  type Ww3Targeting,
} from "../lib/ww3";

export type Ww3ExchangeSession = Readonly<{
  plan: Ww3ExchangePlan;
  visibleStrikeCount: number;
  speed: number;
  state: "running" | "paused" | "complete";
}>;

export function WW3ExchangePanel({
  session,
  onStart,
  onPause,
  onResume,
  onStop,
}: {
  session: Ww3ExchangeSession | null;
  onStart: (plan: Ww3ExchangePlan, speed: number) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}) {
  const [scenarioId, setScenarioId] = useState("global");
  const [targeting, setTargeting] = useState<Ww3Targeting>("all");
  const [speed, setSpeed] = useState(5);
  const preview = useMemo(() => buildWw3ExchangePlan(scenarioId, targeting), [scenarioId, targeting]);
  const selectedScenario = preview.scenario;
  const activeThisPlan = session?.plan.id === preview.id;

  return (
    <section className="section ww3" aria-labelledby="ww3-title">
      <div className="section__title">
        <span id="ww3-title">Global exchange lab</span>
        <span className="section__badge" data-tone={session ? "warning" : "muted"}>
          {session ? session.state : "Idle"}
        </span>
      </div>
      <p className="ww3__intro">
        Explore the preserved seven-scenario NukeMap exchange dataset with deterministic, illustrative Cesium arcs. This is not a prediction or current force assessment.
      </p>
      <label className="ww3__field">
        <span>Scenario</span>
        <select value={scenarioId} onChange={(event) => setScenarioId(event.target.value)}>
          {WW3_SCENARIOS.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.name}</option>)}
        </select>
      </label>
      <label className="ww3__field">
        <span>Target class</span>
        <select value={targeting} onChange={(event) => setTargeting(event.target.value as Ww3Targeting)}>
          <option value="all">Scenario definition</option>
          <option value="counterforce">Military and command only</option>
          <option value="countervalue">Cities and infrastructure only</option>
        </select>
      </label>
      <label className="ww3__field">
        <span>Playback compression</span>
        <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
          <option value={1}>1×</option>
          <option value={2}>2×</option>
          <option value={5}>5×</option>
          <option value={10}>10×</option>
        </select>
      </label>
      <div className="ww3__scenario-card">
        <strong>{selectedScenario.name}</strong>
        <p>{selectedScenario.description}</p>
        <dl>
          <div><dt>Target records</dt><dd>{preview.targetRecordCount.toLocaleString()}</dd></div>
          <div><dt>Warheads</dt><dd>{preview.strikes.length.toLocaleString()}</dd></div>
          <div><dt>Total yield</dt><dd>{(preview.totalYieldKt / 1_000).toFixed(0)} MT</dd></div>
          <div><dt>Phases</dt><dd>{selectedScenario.phases.length}</dd></div>
        </dl>
      </div>
      <div className="ww3__actions">
        {!activeThisPlan && <button type="button" className="hazard__detonate" onClick={() => onStart(preview, speed)}>Run illustrative exchange</button>}
        {activeThisPlan && session?.state === "running" && <button type="button" onClick={onPause}>Pause</button>}
        {activeThisPlan && session?.state === "paused" && <button type="button" onClick={onResume}>Resume</button>}
        {session && <button type="button" onClick={onStop}>Clear exchange</button>}
      </div>
      <details className="ww3__method">
        <summary>Model limits and provenance</summary>
        <ul>{preview.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
        <p>Source: <code>legacy/nukemap/js/ww3.js</code>. Cataclysm packages 427 target records and 712 assigned warheads across the full global scenario.</p>
      </details>
    </section>
  );
}

export function WW3ExchangeHud({ session }: { session: Ww3ExchangeSession }) {
  const visible = Math.min(session.visibleStrikeCount, session.plan.strikes.length);
  const current = useMemo(() => {
    const strikes = session.plan.strikes.slice(0, visible);
    return {
      yieldKt: strikes.reduce((sum, strike) => sum + strike.yieldKt, 0),
      deaths: strikes.reduce((sum, strike) => sum + strike.estimatedDeaths, 0),
      injuries: strikes.reduce((sum, strike) => sum + strike.estimatedInjuries, 0),
      phase: strikes.at(-1)?.phaseName ?? "Awaiting first launch",
    };
  }, [session.plan.strikes, visible]);
  const activeSides = Object.keys(session.plan.scenario.launchSets) as Ww3Side[];
  const progress = session.plan.strikes.length === 0 ? 1 : visible / session.plan.strikes.length;
  return (
    <aside className="ww3-hud" aria-label="Illustrative global exchange status">
      <div className="ww3-hud__heading">
        <span>Illustrative exchange</span>
        <strong>{session.plan.scenario.name}</strong>
        <small>{current.phase}</small>
      </div>
      <div className="ww3-hud__metrics">
        <div><strong>{visible}<small> / {session.plan.strikes.length}</small></strong><span>Warheads</span></div>
        <div><strong>{(current.yieldKt / 1_000).toFixed(0)} MT</strong><span>Yield</span></div>
        <div><strong>{formatWw3Number(current.deaths)}</strong><span>Est. fatalities</span></div>
        <div><strong>{formatWw3Number(current.injuries)}</strong><span>Est. injuries</span></div>
      </div>
      <progress max={1} value={progress} aria-label={`${Math.round(progress * 100)} percent complete`} />
      <div className="ww3-hud__legend" aria-label="Missile arc sides">
        {activeSides.map((side) => (
          <span key={side}><i data-side={side} aria-hidden />{WW3_SIDE_LABELS[side]}</span>
        ))}
      </div>
      <p>Legacy screening estimate · no overlap deduplication · not a forecast</p>
      <span className="sr-only">Arc colors: {activeSides.map((side) => `${WW3_SIDE_LABELS[side]} ${WW3_SIDE_COLORS[side]}`).join(", ")}</span>
    </aside>
  );
}
