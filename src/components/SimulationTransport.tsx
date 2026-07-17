import { UiIcon } from "./UiIcon";

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
  const safeDurationS = Number.isFinite(durationS) && durationS > 0 ? durationS : DEFAULT_TOTAL_TIME_S;
  const safeTimeS = Math.max(0, Math.min(safeDurationS, Number.isFinite(timeS) ? timeS : 0));
  if (domain !== "tsunami") {
    const label = domain === "asteroid" ? "Impact effects" : "Nuclear effects";
    return (
      <section className="simulation-transport simulation-transport--effect" aria-label={`${label} playback status`}>
        <div className="simulation-transport__effect-icon" aria-hidden>
          <UiIcon name="play" size={18} />
        </div>
        <div className="simulation-transport__effect-copy">
          <span>Effect renderer</span>
          <strong>{hasSource ? `${label} ready` : `Configure ${label.toLowerCase()}`}</strong>
          <small>{hasSource ? "Run the staged animation from the Setup panel." : "Choose a target location and source parameters to continue."}</small>
        </div>
        <div className="simulation-transport__effect-model">
          <span>Active model</span>
          <strong>{sourceLabel}</strong>
        </div>
        <button type="button" className="simulation-transport__details" onClick={onOpenDetails}>Open setup</button>
      </section>
    );
  }
  const frameIndex = solverReady && frameCount > 0
    ? Math.min(frameCount, Math.max(1, Math.round((safeTimeS / safeDurationS) * (frameCount - 1)) + 1))
    : 0;
  return (
    <section className="simulation-transport" aria-label="Scenario playback controls">
      <div className="simulation-transport__controls">
        <button
          type="button"
          className="simulation-transport__play"
          onClick={() => {
            if (!playing && safeTimeS >= safeDurationS) onTimeChange(0);
            onTogglePlaying();
          }}
          disabled={!hasSource}
          aria-label={playing ? "Pause scenario timeline" : "Play scenario timeline"}
          title={hasSource ? "Play or pause the analytical scenario timeline" : "Select a source first"}
        >
          <UiIcon name={playing ? "pause" : "play"} size={16} />
        </button>
        <button
          type="button"
          className="simulation-transport__reset"
          onClick={() => onTimeChange(0)}
          disabled={!hasSource || safeTimeS === 0}
          aria-label="Reset scenario timeline"
          title="Return the scenario timeline to source time"
        >
          <UiIcon name="reset" size={15} />
        </button>
      </div>
      <div className="simulation-transport__clock" aria-label={`Scenario time ${formatClock(safeTimeS, safeDurationS)}`}>
        <strong>{formatClock(safeTimeS, safeDurationS)}</strong>
        <span>scenario time</span>
      </div>
      <div className="simulation-transport__track">
        <div className="simulation-transport__meta">
          <span>{sourceLabel}</span>
          <span>{Math.round(safeTimeS / 60)} min / {Math.round(safeDurationS / 60)} min</span>
        </div>
        <input
          type="range"
          min={0}
          max={safeDurationS}
          step={60}
          value={safeTimeS}
          onChange={(event) => onTimeChange(Number(event.target.value))}
          disabled={!hasSource}
          aria-label="Scenario timeline scrubber"
          aria-valuetext={`${Math.round(safeTimeS / 60)} minutes after the source event`}
        />
        <div className="simulation-transport__ticks" aria-hidden>
          {Array.from({ length: 7 }, (_, index) => (
            <span key={index}>{index === 0 ? "0" : `${Math.round((safeDurationS / 360) * index)} m`}</span>
          ))}
        </div>
      </div>
      <label className="simulation-transport__speed">
        <span>Speed</span>
        <select value={rate} onChange={(event) => onRateChange(Number(event.target.value))} disabled={!hasSource}>
          <option value={1}>1x</option>
          <option value={4}>4x</option>
          <option value={12}>12x</option>
        </select>
      </label>
      <div className="simulation-transport__frame">
        <span>Frame</span>
        <strong>{solverReady ? `${frameIndex} / ${frameCount}` : "— / —"}</strong>
      </div>
      <div className="simulation-transport__solver" data-ready={solverReady ? "true" : "false"}>
        <span className="status-dot" aria-hidden />
        <div>
          <span>Solver status</span>
          <strong>{solverReady ? `${frameCount} frames ready` : "Propagation not run"}</strong>
        </div>
      </div>
      <button type="button" className="simulation-transport__details" onClick={onOpenDetails}>Details</button>
    </section>
  );
}
