import { useMemo, useState } from "react";
import { UiIcon } from "./UiIcon";
import { TimelineView } from "./TimelineView";
import { GUIDED_LESSONS, type GuidedLesson } from "../lib/guided-lessons";
import type { Preset } from "../types/scenario";

type Props = {
  presets: Preset[];
  activeId: string | null;
  onSelect: (id: string) => void;
  busyId?: string | null;
  onStartLesson?: (lesson: GuidedLesson) => void;
};

type ViewMode = "cards" | "timeline";

function sortKey(p: Preset): number {
  return p.is_speculative ? 1 : 0;
}

export function PresetSelector({ presets, activeId, onSelect, busyId, onStartLesson }: Props) {
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
        <div className="section__title-actions">
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

      {onStartLesson && (
        <div className="lesson-launcher">
          <div className="lesson-launcher__title">Guided lessons</div>
          <div className="lesson-launcher__list">
            {GUIDED_LESSONS.map((lesson) => (
              <button
                key={lesson.id}
                className="lesson-launcher__item"
                type="button"
                onClick={() => {
                  onSelect(lesson.presetId);
                  onStartLesson(lesson);
                }}
                title={lesson.summary}
              >
                <span className="lesson-launcher__name">{lesson.title}</span>
                <UiIcon name="chevronRight" size={13} />
              </button>
            ))}
          </div>
        </div>
      )}

      {viewMode === "timeline" ? (
        <TimelineView presets={sorted} activeId={activeId} onSelect={onSelect} busyId={busyId} />
      ) : (
        <>
          <div className="preset-search">
            <UiIcon name="search" size={14} className="preset-search__icon" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search events, dates, or source type"
              aria-label="Search presets"
              type="search"
            />
            {query && (
              <button
                className="preset-search__clear"
                type="button"
                aria-label="Clear preset search"
                onClick={() => setQuery("")}
              >
                <UiIcon name="close" size={13} />
              </button>
            )}
          </div>
          <div className="preset-list">
            {visible.length === 0 && (
              <div className="empty-state empty-state--compact" role="status">
                <span className="empty-state__icon" aria-hidden />
                <div>
                  <strong>No matching presets</strong>
                  <p>Try a source type, date, event name, or citation keyword.</p>
                  <button className="empty-state__action" type="button" onClick={() => setQuery("")}>
                    Clear search
                  </button>
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
                  aria-busy={isBusy}
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
                    {isBusy && <span className="preset-card__busy" aria-label="Loading">Loading</span>}
                  </div>
                  <div className="preset-card__meta">
                    <span className="preset-card__date">{p.date}</span>
                    <span className="preset-card__source" data-kind={p.source.kind}>{p.source.kind}</span>
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
