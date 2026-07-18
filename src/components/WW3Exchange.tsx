import { useMemo, useState } from "react";
import {
  buildWw3ExchangePlan,
  WW3_SCENARIOS,
  WW3_SIDE_COLORS,
  type Ww3ExchangePlan,
  type Ww3Side,
  type Ww3Targeting,
} from "../lib/ww3";
import { useI18n } from "../lib/i18n";

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
  const { t, formatNumber } = useI18n();
  const [scenarioId, setScenarioId] = useState("global");
  const [targeting, setTargeting] = useState<Ww3Targeting>("all");
  const [speed, setSpeed] = useState(5);
  const preview = useMemo(() => buildWw3ExchangePlan(scenarioId, targeting), [scenarioId, targeting]);
  const selectedScenario = preview.scenario;
  const activeThisPlan = session?.plan.id === preview.id;
  const scenarioName = (id: string) => t(`ww3.scenario.${id}.name` as Parameters<typeof t>[0]);
  const scenarioDescription = (id: string) => t(`ww3.scenario.${id}.description` as Parameters<typeof t>[0]);

  return (
    <section className="section ww3" aria-labelledby="ww3-title">
      <div className="section__title">
        <span id="ww3-title">{t("ww3.title")}</span>
        <span className="section__badge" data-tone={session ? "warning" : "muted"}>
          {session ? t(`ww3.state.${session.state}` as Parameters<typeof t>[0]) : t("ww3.state.idle")}
        </span>
      </div>
      <p className="ww3__intro">
        {t("ww3.intro")}
      </p>
      <label className="ww3__field">
        <span>{t("ww3.scenario")}</span>
        <select value={scenarioId} onChange={(event) => setScenarioId(event.target.value)}>
          {WW3_SCENARIOS.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenarioName(scenario.id)}</option>)}
        </select>
      </label>
      <label className="ww3__field">
        <span>{t("ww3.targetClass")}</span>
        <select value={targeting} onChange={(event) => setTargeting(event.target.value as Ww3Targeting)}>
          <option value="all">{t("ww3.targetAll")}</option>
          <option value="counterforce">{t("ww3.targetCounterforce")}</option>
          <option value="countervalue">{t("ww3.targetCountervalue")}</option>
        </select>
      </label>
      <label className="ww3__field">
        <span>{t("ww3.playback")}</span>
        <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
          <option value={1}>1×</option>
          <option value={2}>2×</option>
          <option value={5}>5×</option>
          <option value={10}>10×</option>
        </select>
      </label>
      <div className="ww3__scenario-card">
        <strong>{scenarioName(selectedScenario.id)}</strong>
        <p>{scenarioDescription(selectedScenario.id)}</p>
        <dl>
          <div><dt>{t("ww3.targetRecords")}</dt><dd>{formatNumber(preview.targetRecordCount)}</dd></div>
          <div><dt>{t("ww3.warheads")}</dt><dd>{formatNumber(preview.strikes.length)}</dd></div>
          <div><dt>{t("ww3.totalYield")}</dt><dd>{formatNumber(preview.totalYieldKt / 1_000, { maximumFractionDigits: 0 })} MT</dd></div>
          <div><dt>{t("ww3.phases")}</dt><dd>{formatNumber(selectedScenario.phases.length)}</dd></div>
        </dl>
      </div>
      <div className="ww3__actions">
        {!activeThisPlan && <button type="button" className="hazard__detonate" onClick={() => onStart(preview, speed)}>{t("ww3.run")}</button>}
        {activeThisPlan && session?.state === "running" && <button type="button" onClick={onPause}>{t("ww3.pause")}</button>}
        {activeThisPlan && session?.state === "paused" && <button type="button" onClick={onResume}>{t("ww3.resume")}</button>}
        {session && <button type="button" onClick={onStop}>{t("ww3.clear")}</button>}
      </div>
      <details className="ww3__method">
        <summary>{t("ww3.limits")}</summary>
        <ul>{preview.limitations.map((limitation, index) => <li key={limitation}>{t(`ww3.limitation.${index + 1}` as Parameters<typeof t>[0])}</li>)}</ul>
        <p>{t("ww3.sourceBefore")} <code>legacy/nukemap/js/ww3.js</code>. {t("ww3.sourceAfter")}</p>
      </details>
    </section>
  );
}

export function WW3ExchangeHud({ session }: { session: Ww3ExchangeSession }) {
  const { t, formatNumber } = useI18n();
  const visible = Math.min(session.visibleStrikeCount, session.plan.strikes.length);
  const current = useMemo(() => {
    const strikes = session.plan.strikes.slice(0, visible);
    return {
      yieldKt: strikes.reduce((sum, strike) => sum + strike.yieldKt, 0),
      deaths: strikes.reduce((sum, strike) => sum + strike.estimatedDeaths, 0),
      injuries: strikes.reduce((sum, strike) => sum + strike.estimatedInjuries, 0),
      phase: strikes.at(-1)?.phaseName ?? null,
    };
  }, [session.plan.strikes, visible]);
  const activeSides = Object.keys(session.plan.scenario.launchSets) as Ww3Side[];
  const progress = session.plan.strikes.length === 0 ? 1 : visible / session.plan.strikes.length;
  const scenarioName = t(`ww3.scenario.${session.plan.scenario.id}.name` as Parameters<typeof t>[0]);
  const phaseLabel = current.phase
    ? t(`ww3.phase.${current.phase}` as Parameters<typeof t>[0])
    : t("ww3.awaitingLaunch");
  const sideLabel = (side: Ww3Side) => t(`ww3.side.${side}` as Parameters<typeof t>[0]);
  const compact = (value: number) => formatNumber(value, { notation: "compact", maximumFractionDigits: 1 });
  return (
    <aside className="ww3-hud" aria-label={t("ww3.hudLabel")}>
      <div className="ww3-hud__heading">
        <span>{t("ww3.illustrative")}</span>
        <strong>{scenarioName}</strong>
        <small>{phaseLabel}</small>
      </div>
      <div className="ww3-hud__metrics">
        <div><strong>{formatNumber(visible)}<small> / {formatNumber(session.plan.strikes.length)}</small></strong><span>{t("ww3.warheads")}</span></div>
        <div><strong>{formatNumber(current.yieldKt / 1_000, { maximumFractionDigits: 0 })} MT</strong><span>{t("ww3.yield")}</span></div>
        <div><strong>{compact(current.deaths)}</strong><span>{t("ww3.fatalities")}</span></div>
        <div><strong>{compact(current.injuries)}</strong><span>{t("ww3.injuries")}</span></div>
      </div>
      <progress max={1} value={progress} aria-label={t("ww3.percentComplete", { value: formatNumber(Math.round(progress * 100)) })} />
      <div className="ww3-hud__legend" aria-label={t("ww3.arcSides")}>
        {activeSides.map((side) => (
          <span key={side}><i data-side={side} aria-hidden />{sideLabel(side)}</span>
        ))}
      </div>
      <p>{t("ww3.hudCaveat")}</p>
      <span className="sr-only">{t("ww3.arcColors", { values: activeSides.map((side) => `${sideLabel(side)} ${WW3_SIDE_COLORS[side]}`).join(", ") })}</span>
    </aside>
  );
}
