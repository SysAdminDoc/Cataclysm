import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { searchNukemapLocations } from "../lib/nukemap-data";
import type { NukemapLocationResult } from "../types/nukemap-data";
import { useI18n } from "../lib/i18n";
import type { MessageKey } from "../lib/i18n-core";
import { useUnits } from "../hooks/useUnits";
import { formatPopulationDensity, quantityText } from "../lib/units";

type SearchNotice = { key: MessageKey; values?: Record<string, string | number> };

type LocationSearchPurpose = "default" | "near" | "target";

export function LocationSearch({
  onSelect,
  purpose = "default",
}: {
  onSelect: (result: NukemapLocationResult) => void;
  purpose?: LocationSearchPurpose;
}) {
  const { t, formatNumber } = useI18n();
  const unitSystem = useUnits();
  const inputId = useId();
  const resultsId = useId();
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NukemapLocationResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<SearchNotice>({ key: "location.initial" });

  useEffect(() => {
    let cancelled = false;
    if (query.trim().length < 2) {
      setResults([]);
      setActiveIndex(-1);
      setLoading(false);
      return () => { cancelled = true; };
    }
    setLoading(true);
    const timeout = window.setTimeout(() => {
      void searchNukemapLocations(query)
        .then((next) => {
          if (cancelled) return;
          setResults(next);
          setActiveIndex(-1);
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

  const selectResult = (result: NukemapLocationResult) => {
    onSelect(result);
    setQuery(result.name);
    setResults([]);
    setActiveIndex(-1);
    setNotice(result.density.nearestCity
      ? {
          key: "location.selectedFrom",
          values: {
            name: result.name,
            density: quantityText(formatPopulationDensity(result.density.peoplePerKm2, formatNumber, unitSystem)),
            city: result.density.nearestCity,
          },
        }
      : {
          key: "location.selected",
          values: { name: result.name, density: quantityText(formatPopulationDensity(result.density.peoplePerKm2, formatNumber, unitSystem)) },
        });
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const next = activeIndex < 0
        ? direction > 0 ? 0 : results.length - 1
        : (activeIndex + direction + results.length) % results.length;
      setActiveIndex(next);
      optionRefs.current[next]?.focus();
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      selectResult(results[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setResults([]);
      setActiveIndex(-1);
    }
  };

  const label = purpose === "near"
    ? t("location.nearLabel")
    : purpose === "target"
      ? t("location.targetLabel")
      : t("location.label");

  return (
    <div className="location-search">
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("location.placeholder")}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={results.length > 0}
        aria-controls={resultsId}
        aria-activedescendant={activeIndex >= 0 ? `${resultsId}-${activeIndex}` : undefined}
        onKeyDown={handleInputKeyDown}
      />
      <small aria-live="polite">{loading ? t("location.searching") : t(notice.key, notice.values)}</small>
      {results.length > 0 && (
        <div id={resultsId} className="location-search__results" role="listbox" aria-label={t("location.results")}>
          {results.map((result, index) => (
            <button
              id={`${resultsId}-${index}`}
              key={result.id}
              type="button"
              role="option"
              aria-selected={activeIndex === index}
              ref={(element) => { optionRefs.current[index] = element; }}
              onFocus={() => setActiveIndex(index)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const direction = event.key === "ArrowDown" ? 1 : -1;
                  const next = (index + direction + results.length) % results.length;
                  setActiveIndex(next);
                  optionRefs.current[next]?.focus();
                } else if (event.key === "Home" || event.key === "End") {
                  event.preventDefault();
                  const next = event.key === "Home" ? 0 : results.length - 1;
                  setActiveIndex(next);
                  optionRefs.current[next]?.focus();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setResults([]);
                  setActiveIndex(-1);
                  document.getElementById(inputId)?.focus();
                }
              }}
              onClick={() => selectResult(result)}
            >
              <strong>{result.name}</strong>
              <span>{result.context}</span>
              <small>{t("location.resultMeta", {
                lat: formatNumber(result.lat, { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
                lon: formatNumber(result.lon, { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
                density: quantityText(formatPopulationDensity(result.density.peoplePerKm2, formatNumber, unitSystem)),
              })}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
