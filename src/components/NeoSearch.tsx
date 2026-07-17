import { useState } from "react";
import { searchNeo } from "../lib/jpl";
import type { NeoLookupResult } from "../types/jpl";

function formatProbability(probability: number): string {
  if (!Number.isFinite(probability) || probability <= 0) return "0";
  return probability >= 0.001 ? `${(probability * 100).toFixed(3)}%` : probability.toExponential(2);
}

export function NeoSearch({ onSelect }: { onSelect: (result: NeoLookupResult) => void }) {
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
      setError(reason instanceof Error ? reason.message : "NASA/JPL lookup failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="neo-search" onSubmit={submit} aria-label="NASA near-Earth object lookup">
      <label htmlFor="neo-search-input">NASA NEO lookup</label>
      <div className="neo-search__input-row">
        <input
          id="neo-search-input"
          type="search"
          value={query}
          minLength={2}
          maxLength={80}
          placeholder="Apophis, Bennu, 2024 YR4…"
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="submit" disabled={loading || query.trim().length < 2}>
          {loading ? "Searching…" : "Search"}
        </button>
      </div>
      <p className="neo-search__hint">One request at a time · live desktop lookup with offline reference fallback</p>
      {error ? <p className="neo-search__status" role="alert">{error}</p> : null}
      {result ? (
        <button className="neo-search__result" type="button" onClick={() => onSelect(result)}>
          <strong>{result.fullname}</strong>
          <span>
            {result.diameterM >= 1_000 ? `${(result.diameterM / 1_000).toFixed(1)} km` : `${result.diameterM.toFixed(0)} m`}
            {" diameter · "}{(result.velocityMps / 1_000).toFixed(1)} km/s · {result.densityKgM3.toLocaleString()} kg/m³
          </span>
          {result.risk ? (
            <span className="neo-search__risk">
              Sentry: {formatProbability(result.risk.impactProbability)} · Palermo {result.risk.palermoScale} · Torino {result.risk.torinoScale} · {result.risk.impactCount} corridor{result.risk.impactCount === 1 ? "" : "s"} ({result.risk.yearRange})
            </span>
          ) : null}
          <span className="neo-search__source">{result.source} · Apply as impact inputs</span>
          <span className="sr-only">. {result.assumptions.join(" ")}</span>
        </button>
      ) : null}
    </form>
  );
}
