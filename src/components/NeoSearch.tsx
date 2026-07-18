import { useState } from "react";
import { searchNeo } from "../lib/jpl";
import type { NeoLookupResult } from "../types/jpl";
import { useI18n } from "../lib/i18n";
import type { MessageKey } from "../lib/i18n-core";

const LOOKUP_ERROR_KEYS: Record<string, MessageKey> = {
  "Enter at least two characters.": "neo.error.min",
  "Live NASA/JPL lookup is available in the desktop app.": "neo.error.desktop",
  "NASA/JPL returned an invalid response.": "neo.error.invalid",
  "Multiple objects matched; enter a more specific designation.": "neo.error.multiple",
  "No matching object found.": "neo.error.none",
};

function formatProbability(probability: number, formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string): string {
  if (!Number.isFinite(probability) || probability <= 0) return "0";
  return probability >= 0.001
    ? `${formatNumber(probability * 100, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}%`
    : probability.toExponential(2);
}

export function NeoSearch({ onSelect }: { onSelect: (result: NeoLookupResult) => void }) {
  const { t, formatNumber } = useI18n();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<NeoLookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await searchNeo(query));
    } catch (reason) {
      if (reason instanceof Error) {
        const localizedKey = LOOKUP_ERROR_KEYS[reason.message];
        setError(localizedKey ? t(localizedKey) : reason.message);
      } else {
        setError(t("neo.failure"));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="neo-search" onSubmit={submit} aria-label={t("neo.aria")}>
      <label htmlFor="neo-search-input">{t("neo.label")}</label>
      <div className="neo-search__input-row">
        <input
          id="neo-search-input"
          type="search"
          value={query}
          minLength={2}
          maxLength={80}
          placeholder={t("neo.placeholder")}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="submit" disabled={loading || query.trim().length < 2}>
          {loading ? t("neo.searching") : t("neo.search")}
        </button>
      </div>
      <p className="neo-search__hint">{t("neo.hint")}</p>
      {error ? <p className="neo-search__status" role="alert">{error}</p> : null}
      {result ? (
        <button className="neo-search__result" type="button" onClick={() => onSelect(result)}>
          <strong>{result.fullname}</strong>
          <span>
            {t("neo.metrics", {
              diameter: result.diameterM >= 1_000
                ? `${formatNumber(result.diameterM / 1_000, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`
                : `${formatNumber(result.diameterM, { maximumFractionDigits: 0 })} m`,
              velocity: formatNumber(result.velocityMps / 1_000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
              density: formatNumber(result.densityKgM3),
            })}
          </span>
          {result.risk ? (
            <span className="neo-search__risk">
              {t(result.risk.impactCount === 1 ? "neo.risk.one" : "neo.risk.many", {
                probability: formatProbability(result.risk.impactProbability, formatNumber),
                palermo: result.risk.palermoScale,
                torino: result.risk.torinoScale,
                count: formatNumber(result.risk.impactCount),
                years: result.risk.yearRange,
              })}
            </span>
          ) : null}
          <span className="neo-search__source">{t("neo.apply", {
            source: result.source === "Built-in fallback" ? t("neo.sourceFallback") : result.source,
          })}</span>
          <span className="sr-only">. {result.assumptions.join(" ")}</span>
        </button>
      ) : null}
    </form>
  );
}
