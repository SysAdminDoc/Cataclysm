import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import type { InitialDisplacement, Preset } from "../types/scenario";
import type { RunupAtPointResult } from "../lib/tauri";
import { exportFailureLabel, exportRunupCsv, type ExportResult } from "../lib/export";
import {
  buildCoastalOutcomeStory,
  type CoastalOutcomePlace,
} from "../lib/result-story";
import { GlossaryTip } from "./GlossaryTip";
import { type AsyncResult } from "../lib/async-result";
import { buildOutcomeEvidence } from "../lib/trust-evidence";
import { TrustDisclosure } from "./TrustDisclosure";
import { useI18n } from "../lib/i18n";

/** The modelled tsunami source families. `null` covers presets/custom
 * scenarios whose discrete kind is not known to the caller. */
export type SourceKind = "Asteroid" | "Nuclear" | "Earthquake" | "Landslide" | "Meteotsunami" | null;

type Props = {
  initial: InitialDisplacement | null;
  timeS: number;
  onTimeChange: (s: number) => void;
  showTimeline?: boolean;
  /** Discrete source family, used to label metrics correctly. */
  sourceKind?: SourceKind;
  preset?: Preset | null;
  runupResults?: RunupAtPointResult[];
  runupResult?: AsyncResult<RunupAtPointResult[]>;
  onRetryRunup?: () => void;
  scienceContent?: ReactNode;
  validationContent?: ReactNode;
  onFocusOutcome?: (place: CoastalOutcomePlace) => void;
};

type ResultView = "outcome" | "science" | "validation";
const RESULT_VIEWS = [
  { id: "outcome", labelKey: "results.outcome" },
  { id: "science", labelKey: "results.science" },
  { id: "validation", labelKey: "results.validation" },
] as const;
type Translate = ReturnType<typeof useI18n>["t"];
type FormatNumber = ReturnType<typeof useI18n>["formatNumber"];

function cavityLabel(kind: SourceKind, t: Translate): { term: string; text: string } {
  switch (kind) {
    case "Earthquake":
    case "Landslide":
      return { term: "cavity_radius", text: t("results.sourceRegionRadius") };
    case "Meteotsunami":
      return { term: "cavity_radius", text: t("results.pressureFootprintRadius") };
    default:
      return { term: "cavity_radius", text: t("results.cavityRadius") };
  }
}

function describeOutcome(
  initial: InitialDisplacement,
  kind: SourceKind,
  t: Translate,
  formatNumber: FormatNumber,
): { headline: string; detail: string } {
  const energy = formatEnergy(initial.source_energy_j, formatNumber);
  const energyText = energy.value === "—" ? t("results.uncertainEnergy") : `${energy.value} ${energy.unit}`;
  const amp = formatLength(initial.peak_amplitude_m, formatNumber);
  const ampText = amp.value === "—" ? t("results.uncertainHeight") : `${amp.value} ${amp.unit}`;
  const mw = formatMagnitude(initial.seismic_mw_equivalent);
  switch (kind) {
    case "Earthquake":
      return {
        headline: t("results.earthquakeHeadline", { magnitude: mw }),
        detail: t("results.earthquakeDetail", { amplitude: ampText, energy: energyText }),
      };
    case "Asteroid":
      return {
        headline: t("results.asteroidHeadline", { energy: energyText }),
        detail: t("results.asteroidDetail", { amplitude: ampText }),
      };
    case "Nuclear":
      return {
        headline: t("results.nuclearHeadline", { energy: energyText }),
        detail: t("results.nuclearDetail", { amplitude: ampText, magnitude: mw }),
      };
    case "Landslide":
      return {
        headline: t("results.landslideHeadline"),
        detail: t("results.landslideDetail", { amplitude: ampText, energy: energyText, magnitude: mw }),
      };
    case "Meteotsunami":
      return {
        headline: t("results.meteotsunamiHeadline"),
        detail: t("results.meteotsunamiDetail", { amplitude: ampText }),
      };
    default:
      return {
        headline: initial.label || t("results.modelledSource"),
        detail: t("results.defaultDetail", { amplitude: ampText, energy: energyText }),
      };
  }
}

function formatEnergy(j: number, formatNumber: FormatNumber): { value: string; unit: string } {
  if (!Number.isFinite(j)) return { value: "—", unit: "" };
  const mt = j / 4.184e15;
  if (mt >= 1) {
    const value =
      mt >= 10_000
        ? formatNumber(mt, { notation: "compact", maximumFractionDigits: 1 })
        : formatNumber(mt, { maximumFractionDigits: 1 });
    return { value, unit: "Mt TNT" };
  }
  const kt = j / 4.184e12;
  if (kt >= 1) return { value: formatNumber(kt, { maximumFractionDigits: 1 }), unit: "kt TNT" };
  const tons = j / 4.184e9;
  if (tons >= 1) return { value: formatNumber(tons, { maximumFractionDigits: 1 }), unit: "t TNT" };
  // Sub-tonne energies: compact notation stays consistent with the rest of the
  // ladder (e.g. "3.1B J") rather than raw exponential ("3.14e+9 J").
  return {
    value: formatNumber(j, { notation: "compact", maximumFractionDigits: 2 }),
    unit: "J",
  };
}

function formatLength(m: number, formatNumber: FormatNumber): { value: string; unit: string } {
  if (!Number.isFinite(m)) return { value: "—", unit: "" };
  if (m >= 1000) return { value: formatNumber(m / 1000, { maximumFractionDigits: 1 }), unit: "km" };
  return { value: formatNumber(m, { maximumFractionDigits: 1 }), unit: "m" };
}

function formatResultTime(seconds: number, t: Translate, formatNumber: FormatNumber): string {
  if (!Number.isFinite(seconds) || seconds < 0) return t("results.timeUnavailable");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t("results.timeMinutes", { minutes: formatNumber(minutes) });
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining === 0
    ? t("results.timeHours", { hours: formatNumber(hours) })
    : t("results.timeHoursMinutes", { hours: formatNumber(hours), minutes: formatNumber(remaining) });
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
  preset = null,
  runupResults = [],
  runupResult,
  onRetryRunup,
  scienceContent,
  validationContent,
  onFocusOutcome,
}: Props) {
  const { t, formatNumber } = useI18n();
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
          <span>{t("results.sourceMetrics")}</span>
          <span className="section__badge" data-tone="muted">{t("results.waiting")}</span>
        </div>
        <div className="empty-state">
          <span className="empty-state__icon" aria-hidden />
          <div>
            <strong>{t("results.chooseSource")}</strong>
            <p>{t("results.chooseSourceBody")}</p>
          </div>
        </div>
      </div>
    );
  }

  const energy = formatEnergy(initial.source_energy_j, formatNumber);
  const cavity = formatLength(initial.cavity_radius_m, formatNumber);
  const amp = formatLength(initial.peak_amplitude_m, formatNumber);
  const wl = initial.dominant_wavelength_m ? formatLength(initial.dominant_wavelength_m, formatNumber) : null;
  const depth = formatLength(initial.center.depth_m ?? 0, formatNumber);
  const totalT = 6 * 3600;
  const safeTimeS = Number.isFinite(timeS) ? Math.max(0, timeS) : 0;
  const progress = Math.max(0, Math.min(1, safeTimeS / totalT));
  const outcome = describeOutcome(initial, sourceKind, t, formatNumber);
  const evidence = buildOutcomeEvidence(preset, initial, sourceKind);
  const cavity_label = cavityLabel(sourceKind, t);
  const story = buildCoastalOutcomeStory(runupResults, safeTimeS);
  const coastalState: AsyncResult<RunupAtPointResult[]> = runupResult
    ?? (runupResults.length > 0 ? { status: "ready", value: runupResults } : { status: "idle" });
  const coastalResults = [...runupResults]
    .filter((result) => Number.isFinite(result.runup_m) && result.runup_m >= 0.1)
    .sort((left, right) => right.runup_m - left.runup_m)
    .slice(0, 5);
  const panelId = `${tabsId}-${view}`;
  const confidenceLevel = story.confidence === "low"
    ? t("results.confidenceLow")
    : story.confidence === "medium"
      ? t("results.confidenceMedium")
      : t("results.confidenceHigh");
  const confidenceLabel = story.confidence === "unavailable"
    ? t("results.sourceReady")
    : t("results.confidence", { level: confidenceLevel });
  const storyLimitation = story.sampledCount === 0
    ? t("results.limitNoScreening")
    : story.affectedCount === 0
      ? t("results.limitNoAffected")
      : story.confidence === "high"
        ? t("results.limitHigh")
        : story.confidence === "medium"
          ? t("results.limitMedium")
          : t("results.limitLow");

  const focusOutcome = (place: CoastalOutcomePlace) => {
    setSelectedPlaceId(place.id);
    onTimeChange(place.arrival_time_s);
    onFocusOutcome?.(place);
  };

  return (
    <>
      <div className="section results__workspace">
        <div className="section__title">
          <span>{t("results.title")}</span>
          <span
            className="section__badge"
            data-tone={story.confidence === "low" ? "muted" : "success"}
          >
            {confidenceLabel}
          </span>
        </div>
        <div className="results__tabs" role="tablist" aria-label={t("results.detail")}>
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
                {t(resultView.labelKey)}
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
              <span>{t("results.whatHappened")}</span>
              <span className="section__badge" data-tone="success">{t("results.ready")}</span>
            </div>
            <article className="results__outcome">
              <strong className="results__outcome-headline">{outcome.headline}</strong>
              <p className="results__outcome-detail">{outcome.detail}</p>
              {initial.recurrence_note && (
                <p className="results__outcome-recurrence">
                  <strong>{t("results.howOften")}</strong> {initial.recurrence_note}
                </p>
              )}
              <span className="results__outcome-note">
                {t("results.educationalNote")}
              </span>
            </article>
            <TrustDisclosure evidence={evidence} />

            <div className="results__key-metrics" aria-label={t("results.outcomeSummary")}>
              {story.maximum && story.maximum.runup_m >= 0.1 ? (
                <button
                  type="button"
                  className="results__metric-card"
                  data-tone="primary"
                  aria-label={t("results.maximumAria", { value: formatNumber(story.maximum.runup_m, { maximumFractionDigits: 1 }), place: story.maximum.name })}
                  onClick={() => focusOutcome(story.maximum!)}
                >
                  <span>{t("results.maxCoastalHeight")}</span>
                  <strong>~{formatNumber(story.maximum.runup_m, { maximumFractionDigits: 1 })} <small>m</small></strong>
                  <em>{t("results.atPlace", { place: story.maximum.name })}</em>
                </button>
              ) : (
                <div className="results__metric-card" data-tone="primary">
                  <span>{t("results.peakSourceDisplacement")}</span>
                  <strong>{amp.value} <small>{amp.unit}</small></strong>
                  <em>{t("results.noCoastAbove")}</em>
                </div>
              )}
              {story.firstAffected && (
                <button
                  type="button"
                  className="results__metric-card"
                  data-tone="secondary"
                  aria-label={t("results.firstAffectedAria", { place: story.firstAffected.name, time: formatResultTime(story.firstAffected.arrival_time_s, t, formatNumber) })}
                  onClick={() => focusOutcome(story.firstAffected!)}
                >
                  <span>{t("results.firstArrival")}</span>
                  <strong>{formatResultTime(story.firstAffected.arrival_time_s, t, formatNumber)}</strong>
                  <em>{story.firstAffected.name}</em>
                </button>
              )}
              {!story.firstAffected && (
                <div className="results__metric-card" data-tone="secondary">
                  <span>{t("results.firstArrival")}</span>
                  <strong>{t("results.notAvailable")}</strong>
                  <em>{t("results.runScreeningArrival")}</em>
                </div>
              )}
            </div>

            <section className="results__places" aria-labelledby={`${panelId}-places-title`}>
              <div className="results__places-header">
                <div>
                  <span id={`${panelId}-places-title`}>{t("results.namedPlaces")}</span>
                  <small>{t("results.screenedHeight")}</small>
                </div>
                <span>{t("results.shown", { count: formatNumber(coastalResults.length) })}</span>
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
                        aria-label={t("results.placeAria", { place: place.name, value: formatNumber(place.runup_m, { maximumFractionDigits: 1 }), time: formatResultTime(place.arrival_time_s, t, formatNumber) })}
                        onClick={() => focusOutcome(place)}
                      >
                        <span className="results__place-marker" aria-hidden />
                        <span className="results__place-name">
                          <strong>{place.name}</strong>
                          <small>{formatResultTime(place.arrival_time_s, t, formatNumber)}</small>
                        </span>
                        <span className="results__place-value">
                          <strong>~{formatNumber(place.runup_m, { maximumFractionDigits: 1 })} m</strong>
                          <small>{selected ? t("results.focused") : t("results.focusOnGlobe")}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="results__places-empty">
                  {t("results.runScreeningPlaces")}
                </p>
              )}
            </section>

            <aside className="results__confidence" data-confidence={story.confidence}>
              <span className="results__confidence-icon" aria-hidden>!</span>
              <div>
                <strong>{story.confidence === "unavailable" ? t("results.screeningLimits") : confidenceLabel}</strong>
                <p>{storyLimitation}</p>
                <small>
                  {story.sampledCount > 0
                    ? t(story.reachM === null ? "results.screeningCounts" : "results.screeningCountsReach", {
                        affected: formatNumber(story.affectedCount),
                        sampled: formatNumber(story.sampledCount),
                        arrived: formatNumber(story.arrivedCount),
                        reach: story.reachM === null ? "" : formatNumber(story.reachM / 1000, { maximumFractionDigits: 0 }),
                      })
                    : t("results.reachNote")}
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
                  aria-label={t("results.timelineScrubber")}
                  aria-valuetext={t("results.minutesAfterEvent", { minutes: formatNumber(Math.round(safeTimeS / 60)) })}
                />
                <progress className="timeline__bar" max={1} value={progress} aria-hidden />
                <div className="timeline__readout">
                  <span>{t("results.minutesAfterSource", { minutes: formatNumber(safeTimeS / 60, { maximumFractionDigits: 0 }) })}</span>
                  <span>{t("results.hoursShort", { hours: formatNumber(safeTimeS / 3600, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {view === "science" && (
          <>
            <div className="section">
              <div className="section__title">
                <span>{t("results.sourceScience")}</span>
                <span className="section__badge">{t("results.rustAuthoritative")}</span>
              </div>
              <div className="source-summary" aria-label={t("results.sourceCenter")}>
                <span>{formatCoord(initial.center.lat_deg, initial.center.lon_deg)}</span>
                <span>{t("results.depthValue", { value: depth.value, unit: depth.unit })}</span>
              </div>
              <div className="results">
                <div className="results__cell" data-tone="primary">
                  <div className="results__label">{t("results.energy")}</div>
                  <div className="results__value">{energy.value} <span className="results__unit">{energy.unit}</span></div>
                </div>
                <div className="results__cell" data-tone="secondary">
                  <div className="results__label"><GlossaryTip term="mw">{t("results.equivalentMagnitude")}</GlossaryTip></div>
                  <div className="results__value">{formatMagnitude(initial.seismic_mw_equivalent)}</div>
                </div>
                <div className="results__cell">
                  <div className="results__label"><GlossaryTip term={cavity_label.term}>{cavity_label.text}</GlossaryTip></div>
                  <div className="results__value">{cavity.value} <span className="results__unit">{cavity.unit}</span></div>
                </div>
                <div className="results__cell">
                  <div className="results__label">{t("results.peakSourceDisplacement")}</div>
                  <div className="results__value">{amp.value} <span className="results__unit">{amp.unit}</span></div>
                </div>
                {wl && (
                  <div className="results__cell results__cell--wide">
                    <div className="results__label">{t("results.dominantWavelength")}</div>
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
                <span>{t("results.coastalValidation")}</span>
                <span
                  className="section__badge"
                  data-tone={coastalState.status === "error" || coastalState.status === "stale" ? "danger" : "muted"}
                >
                  {coastalState.status === "loading"
                    ? coastalState.previous ? t("results.refreshing") : t("results.loading")
                    : coastalState.status === "error" ? t("results.error")
                      : coastalState.status === "stale" ? t("results.stale")
                        : coastalResults.length > 0 ? confidenceLabel
                          : coastalState.status === "empty" || coastalState.status === "ready" ? t("results.complete") : t("results.waiting")}
                </span>
              </div>
              {(coastalState.status === "error" || coastalState.status === "stale") && (
                <div className="panel-error" role="alert">
                  <span>
                    {coastalState.status === "stale" ? t("results.showingLastScreening") : t("results.screeningFailed")}
                    {coastalState.error}
                  </span>
                  {onRetryRunup && <button type="button" onClick={onRetryRunup}>{t("results.retryScreening")}</button>}
                </div>
              )}
              {coastalState.status === "loading" && !coastalState.previous && (
                <div className="empty-state empty-state--compact" role="status">
                  <span className="empty-state__icon" aria-hidden />
                  <div><strong>{t("results.computingScreening")}</strong><p>{t("results.computingScreeningBody")}</p></div>
                </div>
              )}
              {coastalResults.length > 0 ? (
                <>
                  <p className="results__outcome-note">
                    {t("results.illustrativeValues")}
                  </p>
                  <button className="results__export" type="button" onClick={handleCsvExport}>
                    {t("results.exportCsv")}
                  </button>
                  {csvExportFailure && (
                    <div className="panel-error" role="alert">
                      <span>{exportFailureLabel(csvExportFailure.code)}: {csvExportFailure.message}</span>
                      {csvExportFailure.retryable && <button type="button" onClick={handleCsvExport}>{t("results.retry")}</button>}
                    </div>
                  )}
                  {coastalResults.map((result) => (
                    <details className="results__provenance" key={result.id}>
                      <summary>{t("results.provenanceSummary", { place: result.name, value: formatNumber(result.runup_m, { maximumFractionDigits: 1 }), time: formatResultTime(result.arrival_time_s, t, formatNumber) })}</summary>
                      <dl>
                        <dt>{t("results.slope")}</dt><dd>{result.beach_slope_deg}° ± {result.slope_provenance.uncertainty_value ?? t("results.unknown")} {result.slope_provenance.uncertainty_unit}</dd>
                        <dt>{t("results.slopeRecord")}</dt><dd>{result.slope_provenance.sample_id} / {result.slope_provenance.record_id}</dd>
                        <dt>{t("results.depth")}</dt><dd>{result.offshore_depth_m} m ± {result.depth_provenance.uncertainty_value ?? t("results.unknown")} {result.depth_provenance.uncertainty_unit}</dd>
                        <dt>{t("results.depthRecord")}</dt><dd>{result.depth_provenance.sample_id} / {result.depth_provenance.record_id}</dd>
                        <dt>{t("results.sourceMethod")}</dt><dd>{result.slope_provenance.source}; {result.slope_provenance.method}</dd>
                        <dt>{t("results.datumResolutionDate")}</dt><dd>{result.slope_provenance.datum}; {result.slope_provenance.resolution}; {result.slope_provenance.observed_or_published}</dd>
                      </dl>
                    </details>
                  ))}
                </>
              ) : coastalState.status !== "loading" && coastalState.status !== "error" ? (
                <div className="empty-state empty-state--compact">
                  <span className="empty-state__icon" aria-hidden />
                  <div>
                    <strong>{coastalState.status === "idle" ? t("results.noValidation") : t("results.noPointExceeded")}</strong>
                    <p>{coastalState.status === "idle" ? t("results.noValidationBody") : t("results.noPointExceededBody")}</p>
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
