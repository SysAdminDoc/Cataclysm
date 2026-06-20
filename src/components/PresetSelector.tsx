import { useMemo, useState } from "react";
import { UiIcon } from "./UiIcon";
import { TimelineView } from "./TimelineView";
import type { Preset } from "../types/scenario";

type Props = {
  presets: Preset[];
  activeId: string | null;
  onSelect: (id: string) => void;
  busyId?: string | null;
};

type ViewMode = "cards" | "timeline";

function sortKey(p: Preset): number {
  return p.is_speculative ? 1 : 0;
}

export function PresetSelector({ presets, activeId, onSelect, busyId }: Props) {
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const sorted = useMemo(() => [...presets].sort((a, b) => sortKey(a) - sortKey(b)), [presets]);
  const normalizedQuery = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      normalizedQuery
        ? sorted.filter((p) =>
            [p.name, p.date, p.blurb, p.reference, p.source.kind]
              .join(" ")
              .toLowerCase()
              .includes(normalizedQuery),
          )
        : sorted,
    [normalizedQuery, sorted],
  );
  if (sorted.length === 0) {
    return (
      <div className="section">
        <div className="section__title">Historical presets</div>
        <div className="empty-state" role="status" aria-live="polite">
          <span className="empty-state__icon" aria-hidden />
          <div>
            <strong>Loading source library</strong>
            <p>Curated historical events and peer-reviewed source models are being prepared.</p>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="section">
      <div className="section__title">
        <span>Historical presets</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div className="preset-view-toggle" role="group" aria-label="View mode">
            <button
              type="button"
              aria-pressed={viewMode === "cards"}
              onClick={() => setViewMode("cards")}
            >
              Cards
            </button>
            <button
              type="button"
              aria-pressed={viewMode === "timeline"}
              onClick={() => setViewMode("timeline")}
            >
              Timeline
            </button>
          </div>
          <span className="section__count">{visible.length}/{sorted.length}</span>
        </div>
      </div>

      {viewMode === "timeline" ? (
        <TimelineView presets={sorted} activeId={activeId} onSelect={onSelect} />
      ) : (
        <>
          <label className="preset-search">
            <span className="sr-only">Search presets</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search events, dates, or source type"
              type="search"
            />
          </label>
          <div className="preset-list">
            {visible.length === 0 && (
              <div className="empty-state empty-state--compact" role="status">
                <span className="empty-state__icon" aria-hidden />
                <div>
                  <strong>No matching presets</strong>
                  <p>Try a source type, date, event name, or citation keyword.</p>
                </div>
              </div>
            )}
            {visible.map((p) => {
              const isBusy = busyId === p.id;
              return (
                <button
                  key={p.id}
                  className="preset-card"
                  data-active={activeId === p.id ? "true" : "false"}
                  data-speculative={p.is_speculative ? "true" : "false"}
                  aria-pressed={activeId === p.id}
                  onClick={() => onSelect(p.id)}
                  disabled={isBusy}
                  title={p.controversy_note ?? p.reference}
                  type="button"
                >
                  <div className="preset-card__name">
                    {p.is_speculative && (
                      <span className="preset-card__warning" aria-label="Hypothetical or contested">Speculative</span>
                    )}
                    <span>{p.name}</span>
                    {activeId === p.id && (
                      <span className="preset-card__active" aria-label="Selected">
                        <UiIcon name="check" size={13} />
                      </span>
                    )}
                    {isBusy && <span className="preset-card__busy" aria-label="Loading">...</span>}
                  </div>
                  <div className="preset-card__meta">
                    <span>{p.date}</span>
                    <span>{p.source.kind}</span>
                  </div>
                  <div className="preset-card__blurb">{p.blurb}</div>
                  {p.is_speculative && p.controversy_note && (
                    <div className="preset-card__warn-note">{p.controversy_note}</div>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
