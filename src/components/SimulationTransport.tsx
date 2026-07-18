import { UiIcon } from "./UiIcon";
import { useI18n } from "../lib/i18n";

const DEFAULT_TOTAL_TIME_S = 6 * 3600;

type Props = {
  timeS: number;
  onTimeChange: (timeS: number) => void;
  playing: boolean;
  onTogglePlaying: () => void;
  rate: number;
  onRateChange: (rate: number) => void;
  hasSource: boolean;
  sourceLabel: string;
  solverReady: boolean;
  domain: "tsunami" | "asteroid" | "nuclear";
  frameCount?: number;
  durationS?: number;
  onOpenDetails: () => void;
};

function formatClock(timeS: number, durationS = DEFAULT_TOTAL_TIME_S): string {
  const safe = Math.max(0, Math.min(durationS, Number.isFinite(timeS) ? timeS : 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60);
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

export function SimulationTransport({
  timeS,
  onTimeChange,
  playing,
  onTogglePlaying,
  rate,
  onRateChange,
  hasSource,
  sourceLabel,
  solverReady,
  domain,
  frameCount = 0,
  durationS = DEFAULT_TOTAL_TIME_S,
  onOpenDetails,
}: Props) {
  const { t } = useI18n();
  const safeDurationS = Number.isFinite(durationS) && durationS > 0 ? durationS : DEFAULT_TOTAL_TIME_S;
  const safeTimeS = Math.max(0, Math.min(safeDurationS, Number.isFinite(timeS) ? timeS : 0));
  if (domain !== "tsunami") {
    const label = domain === "asteroid" ? t("transport.impactEffects") : t("transport.nuclearEffects");
    return (
      <section className="simulation-transport simulation-transport--effect" aria-label={t("transport.playbackStatus", { label })}>
        <div className="simulation-transport__effect-icon" aria-hidden>
          <UiIcon name="play" size={18} />
        </div>
        <div className="simulation-transport__effect-copy">
          <span>{t("transport.effectRenderer")}</span>
          <strong>{hasSource ? t("transport.ready", { label }) : t("transport.configure", { label })}</strong>
          <small>{hasSource ? t("transport.runStaged") : t("transport.chooseTarget")}</small>
        </div>
        <div className="simulation-transport__effect-model">
          <span>{t("transport.activeModel")}</span>
          <strong>{sourceLabel}</strong>
        </div>
        <button type="button" className="simulation-transport__details" onClick={onOpenDetails}>{t("transport.openSetup")}</button>
      </section>
    );
  }
  const frameIndex = solverReady && frameCount > 0
    ? Math.min(frameCount, Math.max(1, Math.round((safeTimeS / safeDurationS) * (frameCount - 1)) + 1))
    : 0;
  return (
    <section className="simulation-transport" aria-label={t("transport.controls")}>
      <div className="simulation-transport__controls">
        <button
          type="button"
          className="simulation-transport__play"
          onClick={() => {
            if (!playing && safeTimeS >= safeDurationS) onTimeChange(0);
            onTogglePlaying();
          }}
          disabled={!hasSource}
          aria-label={playing ? t("transport.pause") : t("transport.play")}
          title={hasSource ? t("transport.playTitle") : t("transport.selectSource")}
        >
          <UiIcon name={playing ? "pause" : "play"} size={16} />
        </button>
        <button
          type="button"
          className="simulation-transport__reset"
          onClick={() => onTimeChange(0)}
          disabled={!hasSource || safeTimeS === 0}
          aria-label={t("transport.reset")}
          title={t("transport.resetTitle")}
        >
          <UiIcon name="reset" size={15} />
        </button>
      </div>
      <div className="simulation-transport__clock" aria-label={t("transport.time", { time: formatClock(safeTimeS, safeDurationS) })}>
        <strong>{formatClock(safeTimeS, safeDurationS)}</strong>
        <span>{t("transport.timeLabel")}</span>
      </div>
      <div className="simulation-transport__track">
        <div className="simulation-transport__meta">
          <span>{sourceLabel}</span>
          <span>{t("transport.minutes", { current: Math.round(safeTimeS / 60), total: Math.round(safeDurationS / 60) })}</span>
        </div>
        <input
          type="range"
          min={0}
          max={safeDurationS}
          step={60}
          value={safeTimeS}
          onChange={(event) => onTimeChange(Number(event.target.value))}
          disabled={!hasSource}
          aria-label={t("transport.scrubber")}
          aria-valuetext={t("transport.afterSource", { count: Math.round(safeTimeS / 60) })}
        />
        <div className="simulation-transport__ticks" aria-hidden>
          {Array.from({ length: 7 }, (_, index) => (
            <span key={index}>{index === 0 ? "0" : `${Math.round((safeDurationS / 360) * index)} m`}</span>
          ))}
        </div>
      </div>
      <label className="simulation-transport__speed">
        <span>{t("transport.speed")}</span>
        <select value={rate} onChange={(event) => onRateChange(Number(event.target.value))} disabled={!hasSource}>
          <option value={1}>1x</option>
          <option value={4}>4x</option>
          <option value={12}>12x</option>
        </select>
      </label>
      <div className="simulation-transport__frame">
        <span>{t("transport.frame")}</span>
        <strong>{solverReady ? `${frameIndex} / ${frameCount}` : "— / —"}</strong>
      </div>
      <div className="simulation-transport__solver" data-ready={solverReady ? "true" : "false"}>
        <span className="status-dot" aria-hidden />
        <div>
          <span>{t("transport.solverStatus")}</span>
          <strong>{solverReady ? t("transport.framesReady", { count: frameCount }) : t("transport.notRun")}</strong>
        </div>
      </div>
      <button type="button" className="simulation-transport__details" onClick={onOpenDetails}>{t("transport.details")}</button>
    </section>
  );
}
