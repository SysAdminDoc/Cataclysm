import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useI18n } from "../lib/i18n";
import {
  loadRecentUsgsEarthquakes,
  loadUsgsEarthquakeDetail,
  recentEarthquakeImport,
  type RecentEarthquakeImport,
  type UsgsEarthquakeEvent,
  type UsgsRecentFeed,
} from "../lib/usgs-earthquakes";
import { UiIcon } from "./UiIcon";

type Props = {
  onClose: () => void;
  onLoad: (result: RecentEarthquakeImport) => void;
};

type Filter = "all" | "tsunami" | "products";

export function RecentEarthquakeBrowser({ onClose, onLoad }: Props) {
  const { t, formatNumber, languageTag } = useI18n();
  useEscapeKey(onClose);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);
  const [feed, setFeed] = useState<UsgsRecentFeed | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setStatus("loading");
    setMessage(null);
    const result = await loadRecentUsgsEarthquakes();
    setFeed(result);
    setStatus(result.status === "unavailable" ? "error" : "ready");
    setMessage(result.notice ? t(`usgs.notice.${result.notice}`) : null);
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const events = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(languageTag);
    return (feed?.events ?? []).filter((event) => {
      if (filter === "tsunami" && !event.tsunamiFlag) return false;
      if (filter === "products" && !event.hasShakemap && !event.hasPager) return false;
      return !normalized
        || event.title.toLocaleLowerCase(languageTag).includes(normalized)
        || event.id.includes(normalized);
    });
  }, [feed?.events, filter, languageTag, query]);

  async function load(event: UsgsEarthquakeEvent) {
    setLoadingId(event.id);
    setMessage(null);
    try {
      const { detail, stale } = await loadUsgsEarthquakeDetail(event.id);
      const result = recentEarthquakeImport(detail, stale);
      if (!result) {
        setMessage(t("usgs.importUnavailable"));
        return;
      }
      onLoad(result);
    } catch (error) {
      console.warn("[usgs] earthquake detail failed", error);
      setMessage(t("usgs.detailUnavailable"));
    } finally {
      setLoadingId(null);
    }
  }

  const generated = feed?.generatedAtMs
    ? new Intl.DateTimeFormat(languageTag, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date(feed.generatedAtMs))
    : null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal historical-browser recent-earthquake-browser"
        ref={dialogRef}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="recent-earthquake-title"
      >
        <div className="modal__header">
          <div>
            <span className="historical-browser__eyebrow">USGS ComCat</span>
            <h2 id="recent-earthquake-title">{t("usgs.title")}</h2>
          </div>
          <button onClick={onClose} aria-label={t("usgs.close")} className="modal__close" type="button">
            <UiIcon name="close" size={16} />
          </button>
        </div>
        <div className="modal__body historical-browser__body">
          <div className="recent-earthquake-browser__brief">
            <p>{t("usgs.intro")}</p>
            <strong>{t("usgs.notWarning")}</strong>
          </div>

          <div className="recent-earthquake-browser__toolbar">
            <label>
              <span className="sr-only">{t("usgs.searchLabel")}</span>
              <UiIcon name="search" size={13} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                type="search"
                placeholder={t("usgs.searchPlaceholder")}
                aria-label={t("usgs.searchLabel")}
              />
            </label>
            <div role="group" aria-label={t("usgs.filterLabel")}>
              {(["all", "products", "tsunami"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {t(value === "all" ? "usgs.filterAll" : value === "products" ? "usgs.filterProducts" : "usgs.filterTsunami")}
                </button>
              ))}
            </div>
            <button type="button" className="recent-earthquake-browser__refresh" disabled={status === "loading"} onClick={() => void refresh()}>
              <UiIcon name="refresh" size={13} />
              {status === "loading" ? t("usgs.loading") : t("usgs.refresh")}
            </button>
          </div>

          {(status === "loading" || message) && (
            <div
              className="historical-browser__notice"
              data-tone={status === "error" ? "error" : "info"}
              role={status === "error" ? "alert" : "status"}
              aria-live="polite"
            >
              <UiIcon name={status === "error" ? "alert" : "info"} size={16} />
              <span>{status === "loading" ? t("usgs.loading") : message}</span>
            </div>
          )}

          {feed && feed.status !== "unavailable" && (
            <div className="recent-earthquake-browser__source-state" data-stale={feed.stale ? "true" : "false"}>
              <span>{feed.stale ? t("usgs.cached") : t("usgs.live")}</span>
              <small>{generated ? t("usgs.generated", { date: generated }) : t("usgs.generatedUnknown")}</small>
            </div>
          )}

          {status !== "loading" && events.length === 0 && (
            <p className="recent-earthquake-browser__empty">{t("usgs.noMatches")}</p>
          )}

          {events.length > 0 && (
            <ul className="historical-browser__results recent-earthquake-browser__results" aria-label={t("usgs.resultsLabel")}>
              {events.map((event) => {
                const date = new Intl.DateTimeFormat(languageTag, {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "UTC",
                }).format(new Date(event.timeMs));
                const geometryAvailable = event.hasFiniteFault || event.hasMomentTensor;
                const depthSupported = event.depthKm <= 100;
                const officialProducts = [
                  event.hasFiniteFault ? t("usgs.finiteFault") : event.hasMomentTensor ? t("usgs.momentTensor") : null,
                  event.hasShakemap ? "ShakeMap" : null,
                  event.hasPager ? "PAGER" : null,
                ].filter((value): value is string => Boolean(value)).join(" · ");
                return (
                  <li key={event.id}>
                    <div className="historical-browser__result-heading">
                      <span>
                        <strong>{event.title}</strong>
                        <small>{date} UTC · {event.id}</small>
                      </span>
                      {event.alertLevel && (
                        <span className="recent-earthquake-browser__alert" data-level={event.alertLevel}>
                          {t("usgs.pagerAlert", { level: event.alertLevel.toUpperCase() })}
                        </span>
                      )}
                    </div>
                    <dl>
                      <div><dt>{t("usgs.magnitude")}</dt><dd>M {formatNumber(event.magnitude, { maximumFractionDigits: 1 })}</dd></div>
                      <div><dt>{t("usgs.depth")}</dt><dd>{formatNumber(event.depthKm, { maximumFractionDigits: 1 })} km</dd></div>
                      <div><dt>{t("usgs.products")}</dt><dd>{officialProducts || t("usgs.catalogOnly")}</dd></div>
                    </dl>
                    <div className="historical-browser__result-action">
                      <small>{!geometryAvailable
                        ? t("usgs.noGeometry")
                        : !depthSupported
                          ? t("usgs.depthUnsupported")
                          : event.hasShakemap || event.hasPager
                            ? t("usgs.importWithComparison")
                            : t("usgs.importSourceOnly")}</small>
                      <span className="recent-earthquake-browser__actions">
                        <a href={event.eventUrl} target="_blank" rel="noreferrer">{t("usgs.openEvent")}</a>
                        <button
                          type="button"
                          disabled={!geometryAvailable || !depthSupported || loadingId !== null}
                          onClick={() => void load(event)}
                        >
                          {loadingId === event.id ? t("usgs.loadingDetail") : t("usgs.load")}
                        </button>
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="historical-browser__source">{t("usgs.source")}</p>
        </div>
      </div>
    </div>
  );
}
