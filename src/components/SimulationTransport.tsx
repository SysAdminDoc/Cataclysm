import { UiIcon } from "./UiIcon";

const TOTAL_TIME_S = 6 * 3600;

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
};

function formatClock(timeS: number): string {
  const safe = Math.max(0, Math.min(TOTAL_TIME_S, Number.isFinite(timeS) ? timeS : 0));
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
}: Props) {
  const safeTimeS = Math.max(0, Math.min(TOTAL_TIME_S, Number.isFinite(timeS) ? timeS : 0));
  return (
    <section className="simulation-transport" aria-label="Scenario playback controls">
      <div className="simulation-transport__controls">
        <button
          type="button"
          className="simulation-transport__play"
          onClick={onTogglePlaying}
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
      <div className="simulation-transport__clock" aria-label={`Scenario time ${formatClock(safeTimeS)}`}>
        <strong>{formatClock(safeTimeS)}</strong>
        <span>scenario time</span>
      </div>
      <div className="simulation-transport__track">
        <div className="simulation-transport__meta">
          <span>{sourceLabel}</span>
          <span>{Math.round(safeTimeS / 60)} min / 6 h</span>
        </div>
        <input
          type="range"
          min={0}
          max={TOTAL_TIME_S}
          step={60}
          value={safeTimeS}
          onChange={(event) => onTimeChange(Number(event.target.value))}
          disabled={!hasSource}
          aria-label="Scenario timeline scrubber"
          aria-valuetext={`${Math.round(safeTimeS / 60)} minutes after the source event`}
        />
        <div className="simulation-transport__ticks" aria-hidden>
          <span>0</span><span>1 h</span><span>2 h</span><span>3 h</span><span>4 h</span><span>5 h</span><span>6 h</span>
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
      <div className="simulation-transport__solver" data-ready={solverReady ? "true" : "false"}>
        <span className="status-dot" aria-hidden />
        <div>
          <span>Solver status</span>
          <strong>{solverReady ? "Playback ready" : "Analytical model"}</strong>
        </div>
      </div>
    </section>
  );
}
