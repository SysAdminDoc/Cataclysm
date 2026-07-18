import { useEffect, useId, useState } from "react";
import { searchNukemapLocations } from "../lib/nukemap-data";
import type { NukemapLocationResult } from "../types/nukemap-data";
import { useI18n } from "../lib/i18n";
import type { MessageKey } from "../lib/i18n-core";

type SearchNotice = { key: MessageKey; values?: Record<string, string | number> };

export function LocationSearch({ onSelect }: { onSelect: (result: NukemapLocationResult) => void }) {
  const { t, formatNumber } = useI18n();
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NukemapLocationResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<SearchNotice>({ key: "location.initial" });

  useEffect(() => {
    let cancelled = false;
    if (query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return () => { cancelled = true; };
    }
    setLoading(true);
    const timeout = window.setTimeout(() => {
      void searchNukemapLocations(query)
        .then((next) => {
          if (cancelled) return;
          setResults(next);
          setNotice(next.length
            ? { key: "location.matches", values: { count: formatNumber(next.length) } }
            : { key: "location.none" });
        })
        .catch(() => {
          if (!cancelled) setNotice({ key: "location.unreadable" });
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [formatNumber, query]);

  return (
    <div className="location-search">
      <label htmlFor={inputId}>{t("location.label")}</label>
      <input
        id={inputId}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("location.placeholder")}
        autoComplete="off"
      />
      <small aria-live="polite">{loading ? t("location.searching") : t(notice.key, notice.values)}</small>
      {results.length > 0 && (
        <div className="location-search__results" aria-label={t("location.results")}>
          {results.map((result) => (
            <button
              key={result.id}
              type="button"
              onClick={() => {
                onSelect(result);
                setQuery(result.name);
                setResults([]);
                setNotice(result.density.nearestCity
                  ? {
                      key: "location.selectedFrom",
                      values: {
                        name: result.name,
                        density: formatNumber(result.density.peoplePerKm2),
                        city: result.density.nearestCity,
                      },
                    }
                  : {
                      key: "location.selected",
                      values: { name: result.name, density: formatNumber(result.density.peoplePerKm2) },
                    });
              }}
            >
              <strong>{result.name}</strong>
              <span>{result.context}</span>
              <small>{t("location.resultMeta", {
                lat: formatNumber(result.lat, { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
                lon: formatNumber(result.lon, { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
                density: formatNumber(result.density.peoplePerKm2),
              })}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
