import { useId, useMemo, useState } from "react";
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
  completedLessons?: Record<string, string>;
};

type ViewMode = "cards" | "timeline";
type LibraryFilter = "all" | "historical" | "hypothetical";

type PresetGroup = {
  id: "recorded" | "what-if";
  label: string;
  description: string;
  presets: Preset[];
};

function sortKey(p: Preset): number {
  return p.is_speculative ? 1 : 0;
}

function hasTimelineDate(preset: Preset): boolean {
  return /^(?:[\d.]+\s*Ma|~?\d+\s*BP|\d{4})/i.test(preset.date);
}

function formatCompact(value: number, divisor: number, suffix: string): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const scaled = value / divisor;
  return `${scaled.toLocaleString(undefined, { maximumFractionDigits: scaled >= 10 ? 0 : 1 })} ${suffix}`;
}

function sourceDetail(preset: Preset): string {
  switch (preset.source.kind) {
    case "Asteroid":
      return preset.source.source.diameter_m >= 1_000
        ? formatCompact(preset.source.source.diameter_m, 1_000, "km body") ?? "Impact model"
        : formatCompact(preset.source.source.diameter_m, 1, "m body") ?? "Impact model";
    case "Earthquake":
      return Number.isFinite(preset.source.source.mw) ? `M_w ${preset.source.source.mw.toFixed(1)}` : "Fault model";
    case "Nuclear":
      return preset.source.source.yield_kt >= 1_000
        ? formatCompact(preset.source.source.yield_kt, 1_000, "Mt yield") ?? "Burst model"
        : formatCompact(preset.source.source.yield_kt, 1, "kt yield") ?? "Burst model";
    case "Landslide":
      return formatCompact(preset.source.source.volume_m3, 1_000_000, "Mm³ slide") ?? "Slide model";
  }
}

function SourceGlyph({ kind }: { kind: Preset["source"]["kind"] }) {
  return (
    <span className="preset-card__glyph" data-kind={kind} aria-hidden>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {kind === "Asteroid" && <>
          <circle cx="14.5" cy="9.5" r="4.5" />
          <path d="m3 18 6-6M5 12l3-3M10 20l3-3" />
        </>}
        {kind === "Earthquake" && <>
          <path d="M2 13h4l2-7 4 13 3-9 2 3h5" />
          <path d="M4 21h16" />
        </>}
        {kind === "Nuclear" && <>
          <circle cx="12" cy="12" r="2" />
          <path d="M12 10 8.4 4.3A8.8 8.8 0 0 1 15.6 4.3L12 10ZM10.3 13 3.7 14.2A8.8 8.8 0 0 0 7.3 20.4L10.3 13ZM13.7 13l3 7.4a8.8 8.8 0 0 0 3.6-6.2L13.7 13Z" />
        </>}
        {kind === "Landslide" && <>
          <path d="M3 19 10 7l4 7 2-3 5 8H3Z" />
          <circle cx="15.5" cy="6.5" r="1.7" />
          <path d="m18 9 2 2" />
        </>}
      </svg>
    </span>
  );
}

export function PresetSelector({
  presets,
  activeId,
  onSelect,
  busyId,
  onStartLesson,
  completedLessons = {},
}: Props) {
  const instanceId = useId();
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [lessonsOpen, setLessonsOpen] = useState(false);
  const sorted = useMemo(() => [...presets].sort((a, b) => sortKey(a) - sortKey(b)), [presets]);
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(
    () => sorted.filter((preset) => filter === "all" || (filter === "historical" ? !preset.is_speculative : preset.is_speculative)),
    [filter, sorted],
  );
  const visible = useMemo(
    () =>
      normalizedQuery
        ? filtered.filter((p) =>
            [p.name, p.date, p.blurb, p.reference, p.source.kind]
              .join(" ")
              .toLowerCase()
              .includes(normalizedQuery),
          )
        : filtered,
    [filtered, normalizedQuery],
  );
  const groups = useMemo<PresetGroup[]>(() => {
    const recorded = visible.filter((preset) => !preset.is_speculative);
    const whatIf = visible.filter((preset) => preset.is_speculative);
    return [
      {
        id: "recorded",
        label: "Recorded events",
        description: "Historical and observed scenarios",
        presets: recorded,
      },
      {
        id: "what-if",
        label: "What-if studies",
        description: "Hypothetical or contested scenarios",
        presets: whatIf,
      },
    ].filter((group) => group.presets.length > 0) as PresetGroup[];
  }, [visible]);
  const timelinePresets = useMemo(() => visible.filter(hasTimelineDate), [visible]);
  if (sorted.length === 0) {
    return (
      <div className="section">
        <div className="section__title">Scenario library</div>
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
    <div className="section preset-library">
      <div className="preset-library__header">
        <div className="preset-library__identity">
          <span>Scenario library</span>
          <strong>Reference events</strong>
        </div>
        <div className="preset-library__actions">
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
          <span className="section__count" aria-label={`${visible.length} of ${sorted.length} scenarios shown`}>{visible.length}/{sorted.length}</span>
        </div>
      </div>

      <div className="preset-search">
        <UiIcon name="search" size={14} className="preset-search__icon" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search scenarios..."
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

      <div className="preset-library-tabs" role="group" aria-label="Scenario library filter">
        {(["all", "historical", "hypothetical"] as const).map((item) => (
          <button
            type="button"
            key={item}
            aria-pressed={filter === item}
            data-active={filter === item ? "true" : "false"}
            onClick={() => setFilter(item)}
          >
            {item === "all" ? "All" : item === "historical" ? "Recorded" : "What-if"}
          </button>
        ))}
      </div>

      {onStartLesson && (
        <div className="lesson-launcher" data-open={lessonsOpen ? "true" : "false"}>
          <button className="lesson-launcher__toggle" type="button" aria-expanded={lessonsOpen} onClick={() => setLessonsOpen((open) => !open)}>
            <span><strong>Guided training</strong><small>{GUIDED_LESSONS.length} model walkthroughs</small></span>
            <UiIcon name={lessonsOpen ? "chevronDown" : "chevronRight"} size={14} />
          </button>
          {lessonsOpen && <div className="lesson-launcher__list">
            {GUIDED_LESSONS.map((lesson) => (
              <button
                key={lesson.id}
                className="lesson-launcher__item"
                data-complete={completedLessons[lesson.id] ? "true" : "false"}
                type="button"
                onClick={() => {
                  onSelect(lesson.presetId);
                  onStartLesson(lesson);
                }}
                title={lesson.summary}
              >
                <span className="lesson-launcher__name">{lesson.title}</span>
                {completedLessons[lesson.id] && (
                  <span className="lesson-launcher__complete" aria-label="Lesson completed">
                    Done
                  </span>
                )}
                <UiIcon name="chevronRight" size={13} />
              </button>
            ))}
          </div>}
        </div>
      )}

      {viewMode === "timeline" ? (
        timelinePresets.length > 0 ? (
          <TimelineView presets={timelinePresets} activeId={activeId} onSelect={onSelect} busyId={busyId} />
        ) : (
          <div className="empty-state empty-state--compact" role="status">
            <span className="empty-state__icon" aria-hidden />
            <div>
              <strong>No dated timeline events</strong>
              <p>These scenarios do not have a calendar or geologic date to plot.</p>
              <button className="empty-state__action" type="button" onClick={() => { setQuery(""); setFilter("all"); }}>
                Show all scenarios
              </button>
            </div>
          </div>
        )
      ) : (
        <>
          <div className="preset-groups">
            {visible.length === 0 && (
              <div className="empty-state empty-state--compact" role="status">
                <span className="empty-state__icon" aria-hidden />
                <div>
                  <strong>No matching presets</strong>
                  <p>Try a source type, date, event name, or citation keyword.</p>
                  <button className="empty-state__action" type="button" onClick={() => { setQuery(""); setFilter("all"); }}>
                    Show all scenarios
                  </button>
                </div>
              </div>
            )}
            {groups.map((group) => (
              <section className="preset-group" key={group.id} aria-labelledby={`${instanceId}-preset-group-${group.id}`}>
                <header className="preset-group__header">
                  <span>
                    <h3 id={`${instanceId}-preset-group-${group.id}`}>{group.label}</h3>
                    <small>{group.description}</small>
                  </span>
                  <b aria-label={`${group.presets.length} ${group.presets.length === 1 ? "scenario" : "scenarios"}`}>{group.presets.length}</b>
                </header>
                <div className="preset-list">
                  {group.presets.map((p) => {
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
                        <SourceGlyph kind={p.source.kind} />
                        <span className="preset-card__content">
                          <span className="preset-card__name">
                            <span>{p.name}</span>
                            {activeId === p.id && (
                              <span className="preset-card__active" aria-label="Selected">
                                <UiIcon name="check" size={13} />
                              </span>
                            )}
                            {isBusy && <span className="preset-card__busy" aria-label="Loading">Loading</span>}
                          </span>
                          <span className="preset-card__meta">
                            <span className="preset-card__date">{p.date}</span>
                            <span aria-hidden>·</span>
                            <span className="preset-card__source" data-kind={p.source.kind}>{p.source.kind}</span>
                            <span aria-hidden>·</span>
                            <span className="preset-card__detail">{sourceDetail(p)}</span>
                          </span>
                          <span className="preset-card__blurb">{p.blurb}</span>
                          {p.is_speculative && (
                            <span className="preset-card__warning" aria-label="Hypothetical or contested">What-if</span>
                          )}
                          {p.is_speculative && p.controversy_note && (
                            <span className="preset-card__warn-note">{p.controversy_note}</span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
