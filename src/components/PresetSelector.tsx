import { useId, useMemo, useState } from "react";
import { UiIcon } from "./UiIcon";
import { TimelineView } from "./TimelineView";
import { getGuidedLessons, type GuidedLesson } from "../lib/guided-lessons";
import type { DirectScenarioTemplate } from "../lib/scenario-library";
import { buildDirectScenarioEvidence, buildSourceEvidence } from "../lib/trust-evidence";
import type { Preset } from "../types/scenario";
import { TrustDisclosure } from "./TrustDisclosure";
import { useI18n } from "../lib/i18n";

type Props = {
  presets: Preset[];
  activeId: string | null;
  onSelect: (id: string) => void;
  busyId?: string | null;
  onStartLesson?: (lesson: GuidedLesson) => void;
  completedLessons?: Record<string, string>;
  directScenarios?: readonly DirectScenarioTemplate[];
  activeDirectId?: string | null;
  onSelectDirect?: (scenario: DirectScenarioTemplate) => void;
  onCreateScenario?: () => void;
  onBrowseHistorical?: () => void;
  onRunActive?: () => void;
  recentIds?: string[];
  favoriteIds?: string[];
  onToggleFavorite?: (id: string) => void;
};

type ViewMode = "cards" | "timeline";
type LibraryFilter = "all" | "historical" | "hypothetical" | "favorites";

type PresetGroup = {
  id: "recorded" | "what-if";
  label: string;
  description: string;
  presets: Preset[];
  directScenarios: readonly DirectScenarioTemplate[];
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
    case "Meteotsunami":
      return `${preset.source.source.peak_pressure_pa.toLocaleString()} Pa · ${preset.source.source.speed_m_s.toFixed(1)} m/s`;
  }
}

function presetLibraryId(presetId: string): string {
  return `preset:${presetId}`;
}

function directSourceKind(scenario: DirectScenarioTemplate): Preset["source"]["kind"] {
  return scenario.domain === "asteroid" ? "Asteroid" : "Nuclear";
}

function presetHighlights(preset: Preset): string[] {
  switch (preset.source.kind) {
    case "Earthquake": return ["Fault uplift", "Ocean propagation", "Coastal arrival"];
    case "Landslide": return ["Slide source", "Confined wave", "Runup estimate"];
    case "Asteroid": return ["Impact source", "Basin propagation", "Coastal runup"];
    case "Nuclear": return ["Underwater source", "Wave attenuation", "Coastal arrival"];
    case "Meteotsunami": return ["Moving pressure", "Proudman resonance", "Coastal response"];
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
        {kind === "Meteotsunami" && <>
          <path d="M3 9c3-3 5 3 8 0s5-3 10 0" />
          <path d="M3 15c3-3 5 3 8 0s5-3 10 0" />
          <path d="m17 4 3 2-3 2" />
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
  directScenarios = [],
  activeDirectId = null,
  onSelectDirect,
  onCreateScenario,
  onBrowseHistorical,
  onRunActive,
  recentIds = [],
  favoriteIds = [],
  onToggleFavorite,
}: Props) {
  const { locale, t } = useI18n();
  const instanceId = useId();
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [lessonsOpen, setLessonsOpen] = useState(false);
  const guidedLessons = useMemo(() => getGuidedLessons(locale), [locale]);
  const sorted = useMemo(() => [...presets].sort((a, b) => sortKey(a) - sortKey(b)), [presets]);
  const totalCount = sorted.length + directScenarios.length;
  const activeLibraryId = activeDirectId ?? (activeId ? presetLibraryId(activeId) : null);
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(
    () => sorted.filter((preset) => {
      if (filter === "all") return true;
      if (filter === "historical") return !preset.is_speculative;
      if (filter === "hypothetical") return preset.is_speculative;
      return favoriteIds.includes(presetLibraryId(preset.id));
    }),
    [favoriteIds, filter, sorted],
  );
  const filteredDirect = useMemo(
    () => directScenarios.filter((scenario) => {
      if (filter === "historical") return scenario.classification === "recorded";
      if (filter === "hypothetical") return scenario.classification === "what-if";
      if (filter === "favorites") return favoriteIds.includes(scenario.id);
      return true;
    }),
    [directScenarios, favoriteIds, filter],
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
    const visibleDirect = normalizedQuery
      ? filteredDirect.filter((scenario) =>
          [scenario.name, scenario.date, scenario.blurb, scenario.detail, scenario.reference, scenario.domain, scenario.historicalContext, scenario.physicsContext]
            .join(" ")
            .toLowerCase()
            .includes(normalizedQuery),
        )
      : filteredDirect;
    return [
      {
        id: "recorded",
        label: t("scenario.recordedEvents"),
        description: t("scenario.recordedDescription"),
        presets: recorded,
        directScenarios: visibleDirect.filter((scenario) => scenario.classification === "recorded"),
      },
      {
        id: "what-if",
        label: t("scenario.whatIfStudies"),
        description: t("scenario.whatIfDescription"),
        presets: whatIf,
        directScenarios: visibleDirect.filter((scenario) => scenario.classification === "what-if"),
      },
    ].filter((group) => group.presets.length + group.directScenarios.length > 0) as PresetGroup[];
  }, [filteredDirect, normalizedQuery, t, visible]);
  const visibleCount = groups.reduce((count, group) => count + group.presets.length + group.directScenarios.length, 0);
  const timelinePresets = useMemo(() => visible.filter(hasTimelineDate), [visible]);
  const famousPreset = sorted.find((preset) => preset.id === "tohoku_2011")
    ?? sorted.find((preset) => !preset.is_speculative)
    ?? null;
  const whatIfScenario = directScenarios.find((scenario) => scenario.id === "direct:asteroid-tokyo")
    ?? directScenarios[0]
    ?? null;
  const recentId = recentIds.find((id) =>
    id.startsWith("preset:")
      ? sorted.some((preset) => presetLibraryId(preset.id) === id)
      : directScenarios.some((scenario) => scenario.id === id),
  ) ?? null;
  const selectedPreset = activeId ? sorted.find((preset) => preset.id === activeId) ?? null : null;
  const selectedDirect = activeDirectId
    ? directScenarios.find((scenario) => scenario.id === activeDirectId) ?? null
    : null;
  if (totalCount === 0) {
    return (
      <div className="section">
        <div className="section__title">{t("scenario.library")}</div>
        <div className="empty-state" role="status" aria-live="polite">
          <span className="empty-state__icon" aria-hidden />
          <div>
            <strong>{t("scenario.loadingTitle")}</strong>
            <p>{t("scenario.loadingBody")}</p>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="section preset-library">
      <div className="preset-library__header">
        <div className="preset-library__identity">
          <strong>{t("scenario.heading")}</strong>
        </div>
        <div className="preset-library__actions">
          <div className="preset-view-toggle" role="group" aria-label={t("scenario.viewMode")}>
            <button
              type="button"
              aria-pressed={viewMode === "cards"}
              onClick={() => setViewMode("cards")}
            >
              {t("scenario.cards")}
            </button>
            <button
              type="button"
              aria-pressed={viewMode === "timeline"}
              onClick={() => setViewMode("timeline")}
            >
              {t("scenario.timeline")}
            </button>
          </div>
          {onBrowseHistorical && (
            <button
              className="preset-library__historical"
              type="button"
              aria-label={t("scenario.searchHistorical")}
              title={t("scenario.searchHistoricalTitle")}
              onClick={onBrowseHistorical}
            >
              <UiIcon name="search" size={15} />
            </button>
          )}
          {onToggleFavorite && (
            <button
              className="preset-library__favorite"
              type="button"
              disabled={!activeLibraryId}
              aria-label={activeLibraryId && favoriteIds.includes(activeLibraryId) ? t("scenario.removeFavorite") : t("scenario.addFavorite")}
              aria-pressed={Boolean(activeLibraryId && favoriteIds.includes(activeLibraryId))}
              onClick={() => activeLibraryId && onToggleFavorite(activeLibraryId)}
              title={activeLibraryId ? t("scenario.toggleFavorite") : t("scenario.selectToFavorite")}
            >
              {activeLibraryId && favoriteIds.includes(activeLibraryId) ? "★" : "☆"}
            </button>
          )}
          <span className="section__count" aria-label={t("scenario.shown", { visible: visibleCount, total: totalCount })}>{visibleCount}/{totalCount}</span>
        </div>
      </div>

      <section className="quick-start" aria-labelledby={`${instanceId}-quick-start-title`}>
        <div className="quick-start__heading">
          <span>{t("scenario.quickStart")}</span>
          <strong id={`${instanceId}-quick-start-title`}>{t("scenario.quickStartTitle")}</strong>
        </div>
        <div className="quick-start__grid">
          <button
            type="button"
            data-intent="famous"
            disabled={!famousPreset}
            onClick={() => famousPreset && onSelect(famousPreset.id)}
          >
            <UiIcon name="play" size={15} />
            <span><strong>{t("scenario.watchFamous")}</strong><small>{t("scenario.curatedHistorical")}</small></span>
          </button>
          <button
            type="button"
            data-intent="what-if"
            disabled={!whatIfScenario || !onSelectDirect}
            onClick={() => whatIfScenario && onSelectDirect?.(whatIfScenario)}
          >
            <UiIcon name="mapPin" size={15} />
            <span><strong>{t("scenario.exploreWhatIf")}</strong><small>{t("scenario.directStudy")}</small></span>
          </button>
          <button type="button" data-intent="custom" disabled={!onCreateScenario} onClick={onCreateScenario}>
            <UiIcon name="reset" size={15} />
            <span><strong>{t("scenario.createOwn")}</strong><small>{t("scenario.customSource")}</small></span>
          </button>
          <button
            type="button"
            data-intent="recent"
            disabled={!recentId}
            onClick={() => {
              if (!recentId) return;
              if (recentId.startsWith("preset:")) onSelect(recentId.slice("preset:".length));
              else {
                const direct = directScenarios.find((scenario) => scenario.id === recentId);
                if (direct) onSelectDirect?.(direct);
              }
            }}
          >
            <UiIcon name="refresh" size={15} />
            <span><strong>{t("scenario.continueRecent")}</strong><small>{recentId ? t("scenario.returnLast") : t("scenario.noRecent")}</small></span>
          </button>
        </div>
      </section>

      {activeLibraryId && onRunActive && (
        <section className="preset-active-action" aria-label={t("scenario.selected")}>
          <small className="preset-active-action__eyebrow">{t("scenario.selected")}</small>
          <div className="preset-active-action__body">
            <span className="preset-active-action__visual" data-kind={selectedPreset?.source.kind ?? (selectedDirect ? directSourceKind(selectedDirect) : undefined)}>
              <SourceGlyph kind={selectedPreset?.source.kind ?? (selectedDirect ? directSourceKind(selectedDirect) : "Earthquake")} />
            </span>
            <span className="preset-active-action__copy">
              <strong>{selectedDirect?.name ?? selectedPreset?.name ?? t("scenario.referenceEvent")}</strong>
              <span>{selectedDirect?.detail ?? (selectedPreset ? `${sourceDetail(selectedPreset)} · ${selectedPreset.date}` : t("scenario.readyConfigure"))}</span>
              <small>{selectedDirect?.blurb ?? selectedPreset?.blurb ?? t("scenario.reviewSetup")}</small>
            </span>
          </div>
          {selectedPreset && <TrustDisclosure evidence={buildSourceEvidence(selectedPreset)} compact />}
          {selectedDirect && <TrustDisclosure evidence={buildDirectScenarioEvidence(selectedDirect)} compact />}
          <button type="button" onClick={onRunActive}>
            <UiIcon name="play" size={14} />
            {t("scenario.runWatch")}
          </button>
        </section>
      )}

      <div className="preset-search">
        <UiIcon name="search" size={14} className="preset-search__icon" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("scenario.searchPlaceholder")}
          aria-label={t("scenario.searchLabel")}
          type="search"
        />
        {query && (
          <button
            className="preset-search__clear"
            type="button"
            aria-label={t("scenario.clearSearch")}
            onClick={() => setQuery("")}
          >
            <UiIcon name="close" size={13} />
          </button>
        )}
      </div>

      <div className="preset-library-tabs" role="group" aria-label={t("scenario.filterLabel")}>
        {(["all", "historical", "hypothetical", "favorites"] as const).map((item) => (
          <button
            type="button"
            key={item}
            aria-pressed={filter === item}
            data-active={filter === item ? "true" : "false"}
            onClick={() => setFilter(item)}
          >
            {item === "all" ? t("scenario.all") : item === "historical" ? t("scenario.recorded") : item === "hypothetical" ? t("scenario.whatIf") : t("scenario.favorites")}
          </button>
        ))}
      </div>

      {viewMode === "timeline" ? (
        timelinePresets.length > 0 ? (
          <TimelineView presets={timelinePresets} activeId={activeId} onSelect={onSelect} busyId={busyId} />
        ) : (
          <div className="empty-state empty-state--compact" role="status">
            <span className="empty-state__icon" aria-hidden />
            <div>
              <strong>{t("scenario.noDated")}</strong>
              <p>{t("scenario.noDatedBody")}</p>
              <button className="empty-state__action" type="button" onClick={() => { setQuery(""); setFilter("all"); }}>
                {t("scenario.showAll")}
              </button>
            </div>
          </div>
        )
      ) : (
        <>
          <div className="preset-groups">
            {visibleCount === 0 && (
              <div className="empty-state empty-state--compact" role="status">
                <span className="empty-state__icon" aria-hidden />
                <div>
                  <strong>{t("scenario.noMatches")}</strong>
                  <p>{t("scenario.noMatchesBody")}</p>
                  <button className="empty-state__action" type="button" onClick={() => { setQuery(""); setFilter("all"); }}>
                    {t("scenario.showAll")}
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
                  <b aria-label={group.presets.length + group.directScenarios.length === 1 ? t("scenario.countOne") : t("scenario.countMany", { count: group.presets.length + group.directScenarios.length })}>{group.presets.length + group.directScenarios.length}</b>
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
                              <span className="preset-card__active" aria-label={t("scenario.selectedState")}>
                                <UiIcon name="check" size={13} />
                              </span>
                            )}
                            {isBusy && <span className="preset-card__busy" aria-label={t("scenario.loading")}>{t("scenario.loading")}</span>}
                          </span>
                          <span className="preset-card__meta">
                            <span className="preset-card__date">{p.date}</span>
                            <span aria-hidden>·</span>
                            <span className="preset-card__source" data-kind={p.source.kind}>{p.source.kind}</span>
                            <span aria-hidden>·</span>
                            <span className="preset-card__detail">{sourceDetail(p)}</span>
                          </span>
                          <span className="preset-card__blurb">{p.blurb}</span>
                          <span className="preset-card__highlights">
                            {p.is_speculative ? t("scenario.exploratory") : t("scenario.reference")} · {presetHighlights(p).join(" → ")}
                          </span>
                          {p.is_speculative && (
                            <span className="preset-card__warning" aria-label={t("scenario.hypothetical")}>{t("scenario.whatIf")}</span>
                          )}
                          {p.is_speculative && p.controversy_note && (
                            <span className="preset-card__warn-note">{p.controversy_note}</span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                  {group.directScenarios.map((scenario) => (
                    <button
                      key={scenario.id}
                      className="preset-card"
                      data-active={activeDirectId === scenario.id ? "true" : "false"}
                      data-speculative={scenario.classification === "what-if" ? "true" : "false"}
                      aria-pressed={activeDirectId === scenario.id}
                      onClick={() => onSelectDirect?.(scenario)}
                      title={scenario.reference}
                      type="button"
                    >
                      <SourceGlyph kind={directSourceKind(scenario)} />
                      <span className="preset-card__content">
                        <span className="preset-card__name">
                          <span>{scenario.name}</span>
                          {activeDirectId === scenario.id && (
                            <span className="preset-card__active" aria-label={t("scenario.selectedState")}>
                              <UiIcon name="check" size={13} />
                            </span>
                          )}
                        </span>
                        <span className="preset-card__meta">
                          <span className="preset-card__date">{scenario.date}</span>
                          <span aria-hidden>·</span>
                          <span className="preset-card__source">{scenario.domain === "asteroid" ? t("scenario.impact") : t("scenario.nuclear")}</span>
                          <span aria-hidden>·</span>
                          <span className="preset-card__detail">{scenario.detail}</span>
                        </span>
                        <span className="preset-card__blurb">{scenario.blurb}</span>
                        <span className="preset-card__highlights">
                          {scenario.confidence} · {scenario.durationS < 60 ? `${scenario.durationS} s` : `${Math.round(scenario.durationS / 60)} min`} · {scenario.expectedHighlights.join(" · ")}
                        </span>
                        {scenario.classification === "what-if" && (
                          <span className="preset-card__warning" aria-label={t("scenario.hypothetical")}>{t("scenario.whatIf")}</span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      {onStartLesson && (
        <div className="lesson-launcher" data-open={lessonsOpen ? "true" : "false"}>
          <button className="lesson-launcher__toggle" type="button" aria-expanded={lessonsOpen} onClick={() => setLessonsOpen((open) => !open)}>
            <span>
              <strong>{t("guided.training")}</strong>
              <small>{t("guided.walkthroughs", { count: guidedLessons.length })}</small>
            </span>
            <UiIcon name={lessonsOpen ? "chevronDown" : "chevronRight"} size={14} />
          </button>
          {lessonsOpen && <div className="lesson-launcher__list">
            {guidedLessons.map((lesson) => (
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
                  <span className="lesson-launcher__complete" aria-label={t("guided.completed")}>
                    {t("guided.done")}
                  </span>
                )}
                <UiIcon name="chevronRight" size={13} />
              </button>
            ))}
          </div>}
        </div>
      )}
    </div>
  );
}
