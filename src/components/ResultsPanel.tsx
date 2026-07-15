import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import type { InitialDisplacement } from "../types/scenario";
import type { RunupAtPointResult } from "../lib/tauri";
import { exportFailureLabel, exportRunupCsv, type ExportResult } from "../lib/export";
import {
  buildCoastalOutcomeStory,
  formatOutcomeTime,
  type CoastalOutcomePlace,
} from "../lib/result-story";
import { GlossaryTip } from "./GlossaryTip";
import { type AsyncResult } from "../lib/async-result";

/** The four modelled tsunami source families. `null` covers presets/custom
 * scenarios whose discrete kind is not known to the caller. */
export type SourceKind = "Asteroid" | "Nuclear" | "Earthquake" | "Landslide" | null;

type Props = {
  initial: InitialDisplacement | null;
  timeS: number;
  onTimeChange: (s: number) => void;
  showTimeline?: boolean;
  /** Discrete source family, used to label metrics correctly. */
  sourceKind?: SourceKind;
  runupResults?: RunupAtPointResult[];
  runupResult?: AsyncResult<RunupAtPointResult[]>;
  onRetryRunup?: () => void;
  scienceContent?: ReactNode;
  validationContent?: ReactNode;
  onFocusOutcome?: (place: CoastalOutcomePlace) => void;
};

type ResultView = "outcome" | "science" | "validation";
const RESULT_VIEWS: { id: ResultView; label: string }[] = [
  { id: "outcome", label: "Outcome" },
  { id: "science", label: "Science" },
  { id: "validation", label: "Validation" },
];

function cavityLabel(kind: SourceKind): { term: string; text: string } {
  switch (kind) {
    case "Earthquake":
    case "Landslide":
      return { term: "cavity_radius", text: "Source region radius" };
    default:
      return { term: "cavity_radius", text: "Cavity radius" };
  }
}

function describeOutcome(
  initial: InitialDisplacement,
  kind: SourceKind,
): { headline: string; detail: string } {
  const energy = formatEnergy(initial.source_energy_j);
  const energyText = energy.value === "—" ? "an uncertain amount of energy" : `${energy.value} ${energy.unit}`;
  const amp = formatLength(initial.peak_amplitude_m);
  const ampText = amp.value === "—" ? "an uncertain height" : `${amp.value} ${amp.unit}`;
  const mw = formatMagnitude(initial.seismic_mw_equivalent);
  switch (kind) {
    case "Earthquake":
      return {
        headline: `Magnitude ${mw} seafloor earthquake`,
        detail: `Peak seafloor uplift of ${ampText} displaces the water column, radiating a tsunami. Released about ${energyText}.`,
      };
    case "Asteroid":
      return {
        headline: `Asteroid impact releasing ${energyText}`,
        detail: `The impact excavates a water cavity whose ${ampText} rim collapse launches the wave.`,
      };
    case "Nuclear":
      return {
        headline: `Underwater detonation releasing ${energyText}`,
        detail: `The explosion cavity collapse raises a ${ampText} initial water mound (tsunami-equivalent M ${mw}).`,
      };
    case "Landslide":
      return {
        headline: "Landslide-generated wave",
        detail: `The moving mass pushes up a ${ampText} initial wave, releasing about ${energyText} (tsunami-equivalent M ${mw}).`,
      };
    default:
      return {
        headline: initial.label || "Modelled tsunami source",
        detail: `Initial disturbance of ${ampText}, releasing about ${energyText}.`,
      };
  }
}

function formatEnergy(j: number): { value: string; unit: string } {
  if (!Number.isFinite(j)) return { value: "—", unit: "" };
  const mt = j / 4.184e15;
  if (mt >= 1) {
    const value =
      mt >= 10_000
        ? Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(mt)
        : mt.toLocaleString(undefined, { maximumFractionDigits: 1 });
    return { value, unit: "Mt TNT" };
  }
  const kt = j / 4.184e12;
  if (kt >= 1) return { value: kt.toLocaleString(undefined, { maximumFractionDigits: 1 }), unit: "kt TNT" };
  const tons = j / 4.184e9;
  if (tons >= 1) return { value: tons.toLocaleString(undefined, { maximumFractionDigits: 1 }), unit: "t TNT" };
  // Sub-tonne energies: compact notation stays consistent with the rest of the
  // ladder (e.g. "3.1B J") rather than raw exponential ("3.14e+9 J").
  return {
    value: Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 }).format(j),
    unit: "J",
  };
}

function formatLength(m: number): { value: string; unit: string } {
  if (!Number.isFinite(m)) return { value: "—", unit: "" };
  if (m >= 1000) return { value: (m / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 }), unit: "km" };
  return { value: m.toLocaleString(undefined, { maximumFractionDigits: 1 }), unit: "m" };
}

function formatMagnitude(mw: number): string {
  return Number.isFinite(mw) ? mw.toFixed(2) : "—";
}

function formatCoord(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}° ${ns}, ${Math.abs(lon).toFixed(2)}° ${ew}`;
}

function handleTabKeys(
  event: KeyboardEvent<HTMLButtonElement>,
  active: ResultView,
  setActive: (view: ResultView) => void,
) {
  const current = RESULT_VIEWS.findIndex((view) => view.id === active);
  let next = current;
  if (event.key === "ArrowRight") next = (current + 1) % RESULT_VIEWS.length;
  else if (event.key === "ArrowLeft") next = (current - 1 + RESULT_VIEWS.length) % RESULT_VIEWS.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = RESULT_VIEWS.length - 1;
  else return;
  event.preventDefault();
  setActive(RESULT_VIEWS[next].id);
  const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
  tabs?.[next]?.focus();
}

export function ResultsPanel({
  initial,
  timeS,
  onTimeChange,
  showTimeline = true,
  sourceKind = null,
  runupResults = [],
  runupResult,
  onRetryRunup,
  scienceContent,
  validationContent,
  onFocusOutcome,
}: Props) {
  const [view, setView] = useState<ResultView>("outcome");
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [csvExportFailure, setCsvExportFailure] = useState<Extract<ExportResult, { ok: false }> | null>(null);
  const tabsId = useId();
  useEffect(() => {
    setView("outcome");
    setSelectedPlaceId(null);
    setCsvExportFailure(null);
  }, [initial]);

  const handleCsvExport = () => {
    const result = exportRunupCsv(runupResults);
    setCsvExportFailure(result.ok ? null : result);
  };

  if (!initial) {
    return (
      <div className="section">
        <div className="section__title">
          <span>Source metrics</span>
          <span className="section__badge" data-tone="muted">Waiting</span>
        </div>
        <div className="empty-state">
          <span className="empty-state__icon" aria-hidden />
          <div>
            <strong>Choose a source to unlock readouts</strong>
            <p>
              Presets and custom scenarios populate energy, source geometry,
              peak wave amplitude, and equivalent moment magnitude.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const energy = formatEnergy(initial.source_energy_j);
  const cavity = formatLength(initial.cavity_radius_m);
  const amp = formatLength(initial.peak_amplitude_m);
  const wl = initial.dominant_wavelength_m ? formatLength(initial.dominant_wavelength_m) : null;
  const depth = formatLength(initial.center.depth_m ?? 0);
  const totalT = 6 * 3600;
  const safeTimeS = Number.isFinite(timeS) ? Math.max(0, timeS) : 0;
  const progress = Math.max(0, Math.min(1, safeTimeS / totalT));
  const outcome = describeOutcome(initial, sourceKind);
  const cavity_label = cavityLabel(sourceKind);
  const story = buildCoastalOutcomeStory(runupResults, safeTimeS);
  const coastalState: AsyncResult<RunupAtPointResult[]> = runupResult
    ?? (runupResults.length > 0 ? { status: "ready", value: runupResults } : { status: "idle" });
  const coastalResults = [...runupResults]
    .filter((result) => Number.isFinite(result.runup_m) && result.runup_m >= 0.1)
    .sort((left, right) => right.runup_m - left.runup_m)
    .slice(0, 5);
  const panelId = `${tabsId}-${view}`;

  const focusOutcome = (place: CoastalOutcomePlace) => {
    setSelectedPlaceId(place.id);
    onTimeChange(place.arrival_time_s);
    onFocusOutcome?.(place);
  };

  return (
    <>
      <div className="section results__workspace">
        <div className="section__title">
          <span>Results</span>
          <span
            className="section__badge"
            data-tone={story.confidence === "low" ? "muted" : "success"}
          >
            {story.confidence === "unavailable" ? "Source ready" : `${story.confidence} confidence`}
          </span>
        </div>
        <div className="results__tabs" role="tablist" aria-label="Result detail">
          {RESULT_VIEWS.map((resultView) => {
            const active = resultView.id === view;
            return (
              <button
                key={resultView.id}
                id={`${tabsId}-tab-${resultView.id}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`${tabsId}-${resultView.id}`}
                tabIndex={active ? 0 : -1}
                data-active={active}
                onClick={() => setView(resultView.id)}
                onKeyDown={(event) => handleTabKeys(event, view, setView)}
              >
                {resultView.label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={`${tabsId}-tab-${view}`}
        className="results__tabpanel"
      >
        {view === "outcome" && (
          <div className="section">
            <div className="section__title">
              <span>What happened?</span>
              <span className="section__badge" data-tone="success">Ready</span>
            </div>
            <article className="results__outcome">
              <strong className="results__outcome-headline">{outcome.headline}</strong>
              <p className="results__outcome-detail">{outcome.detail}</p>
              {initial.recurrence_note && (
                <p className="results__outcome-recurrence">
                  <strong>How often:</strong> {initial.recurrence_note}
                </p>
              )}
              <span className="results__outcome-note">
                Modelled first-order tsunami source—educational estimate, not a forecast.
              </span>
            </article>

            <div className="results__key-metrics" aria-label="Outcome summary">
              {story.maximum && story.maximum.runup_m >= 0.1 ? (
                <button
                  type="button"
                  className="results__metric-card"
                  data-tone="primary"
                  aria-label={`Maximum sampled coastal effect, approximately ${story.maximum.runup_m.toFixed(1)} metres at ${story.maximum.name}. Focus place and time.`}
                  onClick={() => focusOutcome(story.maximum!)}
                >
                  <span>Max coastal height</span>
                  <strong>~{story.maximum.runup_m.toFixed(1)} <small>m</small></strong>
                  <em>at {story.maximum.name}</em>
                </button>
              ) : (
                <div className="results__metric-card" data-tone="primary">
                  <span>Peak source displacement</span>
                  <strong>{amp.value} <small>{amp.unit}</small></strong>
                  <em>No sampled coast is above 0.1 m</em>
                </div>
              )}
              {story.firstAffected && (
                <button
                  type="button"
                  className="results__metric-card"
                  data-tone="secondary"
                  aria-label={`First affected named coast, ${story.firstAffected.name}, ${formatOutcomeTime(story.firstAffected.arrival_time_s)}. Focus place and time.`}
                  onClick={() => focusOutcome(story.firstAffected!)}
                >
                  <span>First named-coast arrival</span>
                  <strong>{formatOutcomeTime(story.firstAffected.arrival_time_s)}</strong>
                  <em>{story.firstAffected.name}</em>
                </button>
              )}
              {!story.firstAffected && (
                <div className="results__metric-card" data-tone="secondary">
                  <span>First named-coast arrival</span>
                  <strong>Not available</strong>
                  <em>Run coastal screening to estimate arrival</em>
                </div>
              )}
            </div>

            <section className="results__places" aria-labelledby={`${panelId}-places-title`}>
              <div className="results__places-header">
                <div>
                  <span id={`${panelId}-places-title`}>Named places</span>
                  <small>Peak screened coastal height</small>
                </div>
                <span>{coastalResults.length} shown</span>
              </div>
              {coastalResults.length > 0 ? (
                <div className="results__places-list">
                  {coastalResults.map((place) => {
                    const selected = selectedPlaceId === place.id;
                    return (
                      <button
                        key={place.id}
                        type="button"
                        className="results__place"
                        data-selected={selected}
                        aria-pressed={selected}
                        aria-label={`${place.name}, approximately ${place.runup_m.toFixed(1)} metres, ${formatOutcomeTime(place.arrival_time_s)}. Focus place and time.`}
                        onClick={() => focusOutcome(place)}
                      >
                        <span className="results__place-marker" aria-hidden />
                        <span className="results__place-name">
                          <strong>{place.name}</strong>
                          <small>{formatOutcomeTime(place.arrival_time_s)}</small>
                        </span>
                        <span className="results__place-value">
                          <strong>~{place.runup_m.toFixed(1)} m</strong>
                          <small>{selected ? "Focused" : "Focus on globe"}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="results__places-empty">
                  Run coastal screening to add named places, arrival times, and peak heights.
                </p>
              )}
            </section>

            <aside className="results__confidence" data-confidence={story.confidence}>
              <span className="results__confidence-icon" aria-hidden>!</span>
              <div>
                <strong>{story.confidence === "unavailable" ? "Screening limits" : `${story.confidence} confidence`}</strong>
                <p>{story.limitation}</p>
                <small>
                  {story.sampledCount > 0
                    ? `${story.affectedCount} of ${story.sampledCount} named coasts above 0.1 m · ${story.arrivedCount} reached by current time${story.reachM === null ? "" : ` · farthest sampled reach ${(story.reachM / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })} km`}`
                    : "Reach describes named screening points, not a continuous inundation footprint."}
                </small>
              </div>
            </aside>

            {showTimeline && (
              <div className="timeline">
                <input
                  type="range"
                  min={0}
                  max={totalT}
                  step={60}
                  value={safeTimeS}
                  onChange={(event) => onTimeChange(Number(event.target.value))}
                  aria-label="Scenario timeline scrubber"
                  aria-valuetext={`${Math.round(safeTimeS / 60)} minutes after source event`}
                />
                <div className="timeline__bar">
                  <div className="timeline__fill" style={{ transform: `scaleX(${progress})` }} />
                </div>
                <div className="timeline__readout">
                  <span>{(safeTimeS / 60).toFixed(0)} min after source</span>
                  <span>{(safeTimeS / 3600).toFixed(2)} h</span>
                </div>
              </div>
            )}
          </div>
        )}

        {view === "science" && (
          <>
            <div className="section">
              <div className="section__title">
                <span>Source science</span>
                <span className="section__badge">Rust-authoritative</span>
              </div>
              <div className="source-summary" aria-label="Source center">
                <span>{formatCoord(initial.center.lat_deg, initial.center.lon_deg)}</span>
                <span>{depth.value} {depth.unit} depth</span>
              </div>
              <div className="results">
                <div className="results__cell" data-tone="primary">
                  <div className="results__label">Energy</div>
                  <div className="results__value">{energy.value} <span className="results__unit">{energy.unit}</span></div>
                </div>
                <div className="results__cell" data-tone="secondary">
                  <div className="results__label"><GlossaryTip term="mw">Tsunami-equivalent M_w</GlossaryTip></div>
                  <div className="results__value">{formatMagnitude(initial.seismic_mw_equivalent)}</div>
                </div>
                <div className="results__cell">
                  <div className="results__label"><GlossaryTip term={cavity_label.term}>{cavity_label.text}</GlossaryTip></div>
                  <div className="results__value">{cavity.value} <span className="results__unit">{cavity.unit}</span></div>
                </div>
                <div className="results__cell">
                  <div className="results__label">Peak source displacement</div>
                  <div className="results__value">{amp.value} <span className="results__unit">{amp.unit}</span></div>
                </div>
                {wl && (
                  <div className="results__cell results__cell--wide">
                    <div className="results__label">Dominant wavelength</div>
                    <div className="results__value">{wl.value} <span className="results__unit">{wl.unit}</span></div>
                  </div>
                )}
              </div>
            </div>
            {scienceContent}
          </>
        )}

        {view === "validation" && (
          <>
            <div className="section">
              <div className="section__title">
                <span>Coastal screening validation</span>
                <span
                  className="section__badge"
                  data-tone={coastalState.status === "error" || coastalState.status === "stale" ? "danger" : "muted"}
                >
                  {coastalState.status === "loading"
                    ? coastalState.previous ? "Refreshing" : "Loading"
                    : coastalState.status === "error" ? "Error"
                      : coastalState.status === "stale" ? "Stale"
                        : coastalResults.length > 0 ? `${story.confidence} confidence`
                          : coastalState.status === "empty" || coastalState.status === "ready" ? "Complete" : "Waiting"}
                </span>
              </div>
              {(coastalState.status === "error" || coastalState.status === "stale") && (
                <div className="panel-error" role="alert">
                  <span>
                    {coastalState.status === "stale" ? "Showing the last valid coastal screening: " : "Coastal screening failed: "}
                    {coastalState.error}
                  </span>
                  {onRetryRunup && <button type="button" onClick={onRetryRunup}>Retry coastal screening</button>}
                </div>
              )}
              {coastalState.status === "loading" && !coastalState.previous && (
                <div className="empty-state empty-state--compact" role="status">
                  <span className="empty-state__icon" aria-hidden />
                  <div><strong>Computing coastal screening…</strong><p>Named-place arrivals and provenance are being calculated.</p></div>
                </div>
              )}
              {coastalResults.length > 0 ? (
                <>
                  <p className="results__outcome-note">
                    Illustrative values use nominal or legacy inputs. Expand a point to audit the exact records.
                  </p>
                  <button className="results__export" type="button" onClick={handleCsvExport}>
                    Export coastal CSV with provenance
                  </button>
                  {csvExportFailure && (
                    <div className="panel-error" role="alert">
                      <span>{exportFailureLabel(csvExportFailure.code)}: {csvExportFailure.message}</span>
                      {csvExportFailure.retryable && <button type="button" onClick={handleCsvExport}>Retry</button>}
                    </div>
                  )}
                  {coastalResults.map((result) => (
                    <details className="results__provenance" key={result.id}>
                      <summary>{result.name} · ~{result.runup_m.toFixed(1)} m runup · {formatOutcomeTime(result.arrival_time_s)}</summary>
                      <dl>
                        <dt>Slope</dt><dd>{result.beach_slope_deg}° ± {result.slope_provenance.uncertainty_value ?? "unknown"} {result.slope_provenance.uncertainty_unit}</dd>
                        <dt>Slope record</dt><dd>{result.slope_provenance.sample_id} / {result.slope_provenance.record_id}</dd>
                        <dt>Depth</dt><dd>{result.offshore_depth_m} m ± {result.depth_provenance.uncertainty_value ?? "unknown"} {result.depth_provenance.uncertainty_unit}</dd>
                        <dt>Depth record</dt><dd>{result.depth_provenance.sample_id} / {result.depth_provenance.record_id}</dd>
                        <dt>Source and method</dt><dd>{result.slope_provenance.source}; {result.slope_provenance.method}</dd>
                        <dt>Datum / resolution / date</dt><dd>{result.slope_provenance.datum}; {result.slope_provenance.resolution}; {result.slope_provenance.observed_or_published}</dd>
                      </dl>
                    </details>
                  ))}
                </>
              ) : coastalState.status !== "loading" && coastalState.status !== "error" ? (
                <div className="empty-state empty-state--compact">
                  <span className="empty-state__icon" aria-hidden />
                  <div>
                    <strong>{coastalState.status === "idle" ? "No coastal validation result yet" : "No coastal point exceeded the display threshold"}</strong>
                    <p>{coastalState.status === "idle" ? "Run coastal screening to compare named places, arrival times, and input provenance." : "The screening completed successfully; no named point reached 0.1 m modeled runup at this time."}</p>
                  </div>
                </div>
              ) : null}
            </div>
            {validationContent}
          </>
        )}
      </div>
    </>
  );
}
