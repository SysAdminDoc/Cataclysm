import { useRef, useState, type FormEvent } from "react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import {
  canImportHistoricalEvent,
  historicalEventDate,
  historicalEventImport,
  historicalEventPlace,
  parseHistoricalEventSearch,
  type HazelEventSearchResponse,
  type HistoricalScenarioImport,
} from "../lib/ncei-hazel";
import { api, isTauri } from "../lib/tauri";
import { UiIcon } from "./UiIcon";
import { useI18n } from "../lib/i18n";

type Props = {
  onClose: () => void;
  onLoad: (result: HistoricalScenarioImport) => void;
};

export function HistoricalTsunamiBrowser({ onClose, onLoad }: Props) {
  const { t, formatNumber } = useI18n();
  useEscapeKey(onClose);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);
  const desktop = isTauri();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<HazelEventSearchResponse | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const searchError = (reason: string) => reason === "Enter a year, location, or both."
    ? t("historical.error.empty")
    : reason === "Search text must be 65 printable characters or fewer."
      ? t("historical.error.length")
      : reason === "Search year must be between 0001 and 2100."
        ? t("historical.error.year")
        : reason === "Location text must contain at least two characters."
          ? t("historical.error.location")
          : reason;
  const validityLabel = (value: number | null | undefined) => value === 4
    ? t("historical.validity.definite")
    : value === 3
      ? t("historical.validity.probable")
      : value === 2
        ? t("historical.validity.questionable")
        : value === 1
          ? t("historical.validity.doubtful")
          : t("historical.validity.unrated");

  async function search(event: FormEvent) {
    event.preventDefault();
    const parsed = parseHistoricalEventSearch(query);
    if (!parsed.ok) {
      setStatus("error");
      setMessage(searchError(parsed.reason));
      return;
    }
    if (!desktop) {
      setStatus("error");
      setMessage(t("historical.browserOnly"));
      return;
    }
    setStatus("loading");
    setMessage(null);
    try {
      const response = await api.nceiHazelSearch(parsed.request);
      setResult(response);
      setStatus("idle");
      setMessage(response.items.length === 0
        ? t("historical.noMatches")
        : t(response.items.length === 1 ? "historical.matchesOne" : "historical.matchesMany", { shown: formatNumber(response.items.length), total: formatNumber(response.totalItems) }));
    } catch (error) {
      console.warn("[ncei-hazel] historical event search failed", error);
      setStatus("error");
      setMessage(t("historical.unavailable"));
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal historical-browser"
        ref={dialogRef}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="historical-browser-title"
      >
        <div className="modal__header">
          <div>
            <span className="historical-browser__eyebrow">NOAA/NCEI HazEL</span>
            <h2 id="historical-browser-title">{t("historical.title")}</h2>
          </div>
          <button onClick={onClose} aria-label={t("historical.close")} className="modal__close" type="button">
            <UiIcon name="close" size={16} />
          </button>
        </div>
        <div className="modal__body historical-browser__body">
          <p className="modal__intro">
            {t("historical.intro")}
          </p>
          <form className="historical-browser__search" onSubmit={(event) => void search(event)}>
            <label htmlFor="historical-event-query">{t("historical.queryLabel")}</label>
            <div>
              <input
                id="historical-event-query"
                type="search"
                value={query}
                maxLength={65}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="1960 Chile"
                autoComplete="off"
              />
              <button type="submit" disabled={status === "loading"}>
                <UiIcon name="search" size={14} />
                {status === "loading" ? t("historical.searching") : t("historical.search")}
              </button>
            </div>
          </form>

          {!desktop && status === "idle" && (
            <div className="historical-browser__notice" role="status">
              <UiIcon name="info" size={16} />
              <span><strong>{t("historical.desktopSource")}</strong> {t("historical.desktopNotice")}</span>
            </div>
          )}
          {message && (
            <div
              className="historical-browser__notice"
              data-tone={status === "error" ? "error" : "info"}
              role={status === "error" ? "alert" : "status"}
              aria-live="polite"
            >
              <UiIcon name={status === "error" ? "alert" : "info"} size={16} />
              <span>{message}</span>
            </div>
          )}

          {result && result.items.length > 0 && (
            <ul className="historical-browser__results" aria-label={t("historical.resultsLabel")}>
              {result.items.map((item) => {
                const loadable = canImportHistoricalEvent(item);
                const mapped = loadable ? historicalEventImport(item) : null;
                return (
                  <li key={item.id}>
                    <div className="historical-browser__result-heading">
                      <span>
                        <strong>{historicalEventPlace(item) === "Unnamed location" ? t("historical.unnamed") : historicalEventPlace(item)}</strong>
                        <small>{historicalEventDate(item)} · {t("historical.record", { id: formatNumber(item.id) })}</small>
                      </span>
                      <span className="historical-browser__validity" data-level={item.eventValidity ?? 0}>
                        {validityLabel(item.eventValidity)}
                      </span>
                    </div>
                    <dl>
                      <div><dt>{t("historical.magnitude")}</dt><dd>{Number.isFinite(item.eqMagnitude) ? `M_w ${formatNumber(item.eqMagnitude!, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}` : t("historical.notRecorded")}</dd></div>
                      <div><dt>{t("historical.epicentre")}</dt><dd>{Number.isFinite(item.latitude) && Number.isFinite(item.longitude) ? `${formatNumber(item.latitude!, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}°, ${formatNumber(item.longitude!, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}°` : t("historical.notRecorded")}</dd></div>
                      <div><dt>{t("historical.observedRunups")}</dt><dd>{item.numRunups == null ? t("historical.notRecorded") : formatNumber(item.numRunups)}</dd></div>
                    </dl>
                    <div className="historical-browser__result-action">
                      <small>{loadable
                        ? t("historical.importReview")
                        : item.causeCode !== 1
                          ? t("historical.nonEarthquake")
                          : t("historical.missingInputs")}</small>
                      <button type="button" disabled={!mapped} onClick={() => mapped && onLoad(mapped)}>
                        {t("historical.load")}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="historical-browser__source">
            {t("historical.source")}
          </p>
        </div>
      </div>
    </div>
  );
}
