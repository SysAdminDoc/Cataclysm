import { useEffect, useId, useState } from "react";
import { searchNukemapLocations } from "../lib/nukemap-data";
import type { NukemapLocationResult } from "../types/nukemap-data";

export function LocationSearch({ onSelect }: { onSelect: (result: NukemapLocationResult) => void }) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NukemapLocationResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("Searches stay on this device.");

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
          setNotice(next.length ? `${next.length} offline matches.` : "No packaged location matched that search.");
        })
        .catch(() => {
          if (!cancelled) setNotice("The packaged location index could not be read.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [query]);

  return (
    <div className="location-search">
      <label htmlFor={inputId}>Offline location search</label>
      <input
        id={inputId}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="City, ZIP, target, or coordinates"
        autoComplete="off"
      />
      <small aria-live="polite">{loading ? "Searching packaged data…" : notice}</small>
      {results.length > 0 && (
        <div className="location-search__results" aria-label="Location search results">
          {results.map((result) => (
            <button
              key={result.id}
              type="button"
              onClick={() => {
                onSelect(result);
                setQuery(result.name);
                setResults([]);
                setNotice(
                  `Selected ${result.name}; estimated ${result.density.peoplePerKm2.toLocaleString()} people/km²` +
                    (result.density.nearestCity ? ` from ${result.density.nearestCity}.` : "."),
                );
              }}
            >
              <strong>{result.name}</strong>
              <span>{result.context}</span>
              <small>{result.lat.toFixed(3)}°, {result.lon.toFixed(3)}° · {result.density.peoplePerKm2.toLocaleString()} people/km²</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
