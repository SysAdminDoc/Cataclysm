import { useRef, useState, type FormEvent } from "react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import {
  canImportHistoricalEvent,
  eventValidityLabel,
  historicalEventDate,
  historicalEventImport,
  historicalEventPlace,
  parseHistoricalEventSearch,
  type HazelEventSearchResponse,
  type HistoricalScenarioImport,
} from "../lib/ncei-hazel";
import { api, isTauri } from "../lib/tauri";
import { UiIcon } from "./UiIcon";

type Props = {
  onClose: () => void;
  onLoad: (result: HistoricalScenarioImport) => void;
};

export function HistoricalTsunamiBrowser({ onClose, onLoad }: Props) {
  useEscapeKey(onClose);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);
  const desktop = isTauri();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<HazelEventSearchResponse | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function search(event: FormEvent) {
    event.preventDefault();
    const parsed = parseHistoricalEventSearch(query);
    if (!parsed.ok) {
      setStatus("error");
      setMessage(parsed.reason);
      return;
    }
    if (!desktop) {
      setStatus("error");
      setMessage("Live NOAA search is available in the installed desktop app. The browser preview makes no external data requests.");
      return;
    }
    setStatus("loading");
    setMessage(null);
    try {
      const response = await api.nceiHazelSearch(parsed.request);
      setResult(response);
      setStatus("idle");
      setMessage(response.items.length === 0
        ? "No matching HazEL events were found. Try a broader year or location."
        : `${response.items.length} of ${response.totalItems.toLocaleString()} matching records shown.`);
    } catch (error) {
      console.warn("[ncei-hazel] historical event search failed", error);
      setStatus("error");
      setMessage("NOAA/NCEI HazEL is unavailable. Check the connection and try again; the built-in scenario library remains available offline.");
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
            <h2 id="historical-browser-title">Historical tsunami events</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="modal__close" type="button">
            <UiIcon name="close" size={16} />
          </button>
        </div>
        <div className="modal__body historical-browser__body">
          <p className="modal__intro">
            Search the Global Historical Tsunami Database by year, location, or both. Results are source records, not ready-made fault models.
          </p>
          <form className="historical-browser__search" onSubmit={(event) => void search(event)}>
            <label htmlFor="historical-event-query">Year and location</label>
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
                {status === "loading" ? "Searching…" : "Search NOAA"}
              </button>
            </div>
          </form>

          {!desktop && status === "idle" && (
            <div className="historical-browser__notice" role="status">
              <UiIcon name="info" size={16} />
              <span><strong>Desktop data source</strong> Live lookup is disabled in the browser preview, which remains network-isolated.</span>
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
            <ul className="historical-browser__results" aria-label="Historical tsunami search results">
              {result.items.map((item) => {
                const loadable = canImportHistoricalEvent(item);
                const mapped = loadable ? historicalEventImport(item) : null;
                return (
                  <li key={item.id}>
                    <div className="historical-browser__result-heading">
                      <span>
                        <strong>{historicalEventPlace(item)}</strong>
                        <small>{historicalEventDate(item)} · Record {item.id}</small>
                      </span>
                      <span className="historical-browser__validity" data-level={item.eventValidity ?? 0}>
                        {eventValidityLabel(item.eventValidity)}
                      </span>
                    </div>
                    <dl>
                      <div><dt>Magnitude</dt><dd>{Number.isFinite(item.eqMagnitude) ? `M_w ${item.eqMagnitude!.toFixed(1)}` : "Not recorded"}</dd></div>
                      <div><dt>Epicentre</dt><dd>{Number.isFinite(item.latitude) && Number.isFinite(item.longitude) ? `${item.latitude!.toFixed(3)}°, ${item.longitude!.toFixed(3)}°` : "Not recorded"}</dd></div>
                      <div><dt>Observed runups</dt><dd>{item.numRunups?.toLocaleString() ?? "Not recorded"}</dd></div>
                    </dl>
                    <div className="historical-browser__result-action">
                      <small>{loadable
                        ? "Imports magnitude and epicentre; review every remaining fault input."
                        : item.causeCode !== 1
                          ? "This non-earthquake source cannot be mapped to the earthquake builder."
                          : "Magnitude or epicentre is missing or outside supported bounds."}</small>
                      <button type="button" disabled={!mapped} onClick={() => mapped && onLoad(mapped)}>
                        Load into builder
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="historical-browser__source">
            Source: NOAA National Centers for Environmental Information, Global Historical Tsunami Database, doi:10.7289/V5PN93H7. Records may contain location, datum, transcription, or classification uncertainty.
          </p>
        </div>
      </div>
    </div>
  );
}
