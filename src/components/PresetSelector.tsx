import { useId, useMemo, useState } from "react";
import { UiIcon } from "./UiIcon";
import { TimelineView } from "./TimelineView";
import { getGuidedLessons, type GuidedLesson } from "../lib/guided-lessons";
import type { DirectScenarioTemplate } from "../lib/scenario-library";
import {
  buildScenarioCatalog,
  deterministicSurprise,
  presentationForDirectScenario,
  presentationForPreset,
  presetLibraryId,
  SCENARIO_PACKS,
  scenarioMatchesPack,
  type ScenarioPackId,
  type ScenarioPresentation,
} from "../lib/scenario-presentation";
import { buildDirectScenarioEvidence, buildSourceEvidence } from "../lib/trust-evidence";
import type { Preset } from "../types/scenario";
import { TrustDisclosure } from "./TrustDisclosure";
import { useI18n } from "../lib/i18n";
import { LocationSearch } from "./LocationSearch";
import type { NukemapLocationResult } from "../types/nukemap-data";
import { PlanetaryDefensePanel } from "./PlanetaryDefensePanel";
import type { HypotheticalImpactDraft } from "../types/jpl";
import { useUnits } from "../hooks/useUnits";
import { formatEmbeddedLengthValues } from "../lib/units";

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
  onSelectFamiliarPlace?: (place: NukemapLocationResult) => void;
  onTryHypotheticalImpact?: (draft: HypotheticalImpactDraft) => void;
  /**
   * Simple-first default: hide the discovery surfaces (scenario packs, surprise,
   * "near a place", planetary-defense, guided training) so new users see just a
   * clean scenario list plus a manual "Create my own" entry. Nothing is deleted —
   * switch to Customize/Advanced to bring these back.
   */
  simplified?: boolean;
};

type ViewMode = "cards" | "timeline";
type LibraryFilter = "all" | "historical" | "hypothetical" | "recent" | "favorites";

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

function directSourceKind(scenario: DirectScenarioTemplate): Preset["source"]["kind"] {
  return scenario.domain === "asteroid" ? "Asteroid" : "Nuclear";
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

function ScenarioCard({
  id,
  name,
  date,
  presentation,
  sourceKind,
  selected,
  busy = false,
  speculative = false,
  favorite,
  onSelect,
  onToggleFavorite,
  selectedLabel,
  loadingLabel,
  whatIfLabel,
  previewLabel,
  favoriteLabel,
  removeFavoriteLabel,
  formatQuantityText,
}: {
  id: string;
  name: string;
  date: string;
  presentation: ScenarioPresentation;
  sourceKind: Preset["source"]["kind"];
  selected: boolean;
  busy?: boolean;
  speculative?: boolean;
  favorite: boolean;
  onSelect: () => void;
  onToggleFavorite?: (id: string) => void;
  selectedLabel: string;
  loadingLabel: string;
  whatIfLabel: string;
  previewLabel: string;
  favoriteLabel: string;
  removeFavoriteLabel: string;
  formatQuantityText: (value: string) => string;
}) {
  return (
    <div className="preset-card-shell" data-active={selected ? "true" : "false"} data-speculative={speculative ? "true" : "false"}>
      <button
        className="preset-card"
        data-active={selected ? "true" : "false"}
        data-speculative={speculative ? "true" : "false"}
        aria-pressed={selected}
        aria-busy={busy}
        aria-description={presentation.thumbnail.limitation}
        onClick={onSelect}
        disabled={busy}
        type="button"
      >
        <span className="preset-card__visual" title={presentation.thumbnail.limitation}>
          <img src={presentation.thumbnail.src} alt="" width="360" height="210" loading="lazy" />
          <SourceGlyph kind={sourceKind} />
          <span>{previewLabel}</span>
        </span>
        <span className="preset-card__content">
          <span className="preset-card__name">
            <span>{name}</span>
            {selected && (
              <span className="preset-card__active" aria-label={selectedLabel}>
                <UiIcon name="check" size={13} />
              </span>
            )}
            {busy && <span className="preset-card__busy" aria-label={loadingLabel}>{loadingLabel}</span>}
          </span>
          <span className="preset-card__facts">
            <span>{presentation.hazard}</span>
            <span>{formatQuantityText(presentation.scale)}</span>
            <span>{presentation.runtime}</span>
          </span>
          <span className="preset-card__confidence">{date} · {presentation.confidence}</span>
          <span className="preset-card__promise">{formatQuantityText(presentation.promise)}</span>
          {speculative && <span className="preset-card__warning">{whatIfLabel}</span>}
        </span>
      </button>
      {onToggleFavorite && (
        <button
          className="preset-card__favorite"
          type="button"
          aria-label={favorite ? removeFavoriteLabel : favoriteLabel}
          aria-pressed={favorite}
          onClick={() => onToggleFavorite(id)}
        >
          {favorite ? "★" : "☆"}
        </button>
      )}
    </div>
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
  onSelectFamiliarPlace,
  onTryHypotheticalImpact,
  simplified = false,
}: Props) {
  const { locale, t, formatNumber } = useI18n();
  const unitSystem = useUnits();
  const displayQuantities = (value: string) => formatEmbeddedLengthValues(value, formatNumber, unitSystem);
  const instanceId = useId();
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [selectedPack, setSelectedPack] = useState<ScenarioPackId | null>(null);
  const [surpriseCursor, setSurpriseCursor] = useState(0);
  const [surpriseResultId, setSurpriseResultId] = useState<string | null>(null);
  const [lessonsOpen, setLessonsOpen] = useState(false);
  const [placeSearchOpen, setPlaceSearchOpen] = useState(false);
  const [planetaryDefenseOpen, setPlanetaryDefenseOpen] = useState(false);
  const guidedLessons = useMemo(() => getGuidedLessons(locale), [locale]);
  const sorted = useMemo(() => [...presets].sort((a, b) => sortKey(a) - sortKey(b)), [presets]);
  const catalog = useMemo(() => buildScenarioCatalog(sorted, directScenarios), [directScenarios, sorted]);
  const catalogById = useMemo(() => new Map(catalog.map((entry) => [entry.id, entry])), [catalog]);
  const totalCount = sorted.length + directScenarios.length;
  const activeLibraryId = activeDirectId ?? (activeId ? presetLibraryId(activeId) : null);
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(
    () => sorted.filter((preset) => {
      const id = presetLibraryId(preset.id);
      const entry = catalogById.get(id);
      if (selectedPack && (!entry || !scenarioMatchesPack(entry, selectedPack))) return false;
      if (filter === "historical") return !preset.is_speculative;
      if (filter === "hypothetical") return Boolean(preset.is_speculative);
      if (filter === "recent") return recentIds.includes(id);
      if (filter === "favorites") return favoriteIds.includes(id);
      return true;
    }).sort((left, right) => filter === "recent"
      ? recentIds.indexOf(presetLibraryId(left.id)) - recentIds.indexOf(presetLibraryId(right.id))
      : 0),
    [catalogById, favoriteIds, filter, recentIds, selectedPack, sorted],
  );
  const filteredDirect = useMemo(
    () => directScenarios.filter((scenario) => {
      const entry = catalogById.get(scenario.id);
      if (selectedPack && (!entry || !scenarioMatchesPack(entry, selectedPack))) return false;
      if (filter === "historical") return scenario.classification === "recorded";
      if (filter === "hypothetical") return scenario.classification === "what-if";
      if (filter === "recent") return recentIds.includes(scenario.id);
      if (filter === "favorites") return favoriteIds.includes(scenario.id);
      return true;
    }).sort((left, right) => filter === "recent"
      ? recentIds.indexOf(left.id) - recentIds.indexOf(right.id)
      : 0),
    [catalogById, directScenarios, favoriteIds, filter, recentIds, selectedPack],
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
  const recentId = recentIds.find((id) =>
    id.startsWith("preset:")
      ? sorted.some((preset) => presetLibraryId(preset.id) === id)
      : directScenarios.some((scenario) => scenario.id === id),
  ) ?? null;
  const selectedPreset = activeId ? sorted.find((preset) => preset.id === activeId) ?? null : null;
  const selectedDirect = activeDirectId
    ? directScenarios.find((scenario) => scenario.id === activeDirectId) ?? null
    : null;
  const surprisePool = selectedPack
    ? catalog.filter((entry) => scenarioMatchesPack(entry, selectedPack))
    : catalog;
  const surpriseResult = surpriseResultId ? catalogById.get(surpriseResultId) ?? null : null;
  const surpriseAvailable = deterministicSurprise(surprisePool, 0) !== null;
  const packName = (id: ScenarioPackId) => t(`scenario.pack.${id}.name` as Parameters<typeof t>[0]);
  const chooseSurprise = () => {
    const entry = deterministicSurprise(surprisePool, surpriseCursor);
    if (!entry) return;
    setSurpriseResultId(entry.id);
    setSurpriseCursor((cursor) => cursor + 1);
    if (entry.kind === "preset") onSelect(entry.preset.id);
    else onSelectDirect?.(entry.scenario);
  };
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
          <span className="section__count" aria-label={t("scenario.shown", { visible: visibleCount, total: totalCount })}>{visibleCount}/{totalCount}</span>
        </div>
      </div>

      {simplified && onCreateScenario && (
        <div className="scenario-discovery scenario-discovery--simple">
          <button type="button" className="scenario-discovery__manual" onClick={onCreateScenario}>
            <UiIcon name="reset" size={13} />
            {t("scenario.createOwn")}
          </button>
        </div>
      )}
      {!simplified && (
      <section className="scenario-discovery" aria-labelledby={`${instanceId}-scenario-packs-title`}>
        <div className="scenario-discovery__header">
          <span>
            <small>{t("scenario.discoveryEyebrow")}</small>
            <strong id={`${instanceId}-scenario-packs-title`}>{t("scenario.discoveryTitle")}</strong>
          </span>
          <button type="button" disabled={!surpriseAvailable} onClick={chooseSurprise}>
            <UiIcon name="refresh" size={13} />
            {t("scenario.surpriseMe")}
          </button>
        </div>
        <div className="scenario-pack-strip" role="group" aria-label={t("scenario.packFilterLabel")}>
          {SCENARIO_PACKS.map((pack) => {
            const count = catalog.filter((entry) => scenarioMatchesPack(entry, pack.id)).length;
            return (
              <button
                type="button"
                key={pack.id}
                aria-pressed={selectedPack === pack.id}
                disabled={count === 0}
                onClick={() => {
                  setSelectedPack((current) => current === pack.id ? null : pack.id);
                  setViewMode("cards");
                  setFilter("all");
                  setQuery("");
                  setSurpriseResultId(null);
                }}
              >
                <img src={`/scenario-thumbnails/${pack.thumbnail}.webp`} alt="" width="360" height="210" />
                <span><strong>{packName(pack.id)}</strong><small>{t("scenario.packCount", { count })}</small></span>
              </button>
            );
          })}
        </div>
        <div className="scenario-discovery__tools">
          <button type="button" disabled={!onCreateScenario} onClick={onCreateScenario}>
            <UiIcon name="reset" size={13} />
            {t("scenario.createOwn")}
          </button>
          <button
            type="button"
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
            <UiIcon name="play" size={12} />
            {t("scenario.continueRecent")}
          </button>
          <button
            type="button"
            disabled={!onSelectFamiliarPlace}
            aria-expanded={placeSearchOpen}
            aria-controls={`${instanceId}-familiar-place-search`}
            onClick={() => setPlaceSearchOpen((open) => !open)}
          >
            <UiIcon name="mapPin" size={13} />
            {t("location.nearLabel")}
          </button>
          <button
            type="button"
            disabled={!onTryHypotheticalImpact}
            aria-label={t("pd.title")}
            aria-expanded={planetaryDefenseOpen}
            aria-controls={`${instanceId}-planetary-defense`}
            onClick={() => setPlanetaryDefenseOpen((open) => !open)}
          >
            <UiIcon name="info" size={13} />
            {t("pd.launch")}
          </button>
        </div>
        {placeSearchOpen && onSelectFamiliarPlace && (
          <div id={`${instanceId}-familiar-place-search`} className="scenario-discovery__place-search">
            <LocationSearch onSelect={onSelectFamiliarPlace} purpose="near" />
          </div>
        )}
        {planetaryDefenseOpen && onTryHypotheticalImpact && (
          <div id={`${instanceId}-planetary-defense`}>
            <PlanetaryDefensePanel onTryHypotheticalImpact={onTryHypotheticalImpact} />
          </div>
        )}
        {surpriseResult && (
          <div className="scenario-surprise" role="status" aria-live="polite">
            <strong>{surpriseResult.kind === "preset" ? surpriseResult.preset.name : surpriseResult.scenario.name}</strong>
            <span>{t("scenario.surpriseReason", {
              pack: selectedPack ? packName(selectedPack) : t("scenario.allPacks"),
              promise: displayQuantities(surpriseResult.presentation.promise),
            })}</span>
          </div>
        )}
      </section>
      )}

      {activeLibraryId && onRunActive && (
        <section className="preset-active-action" aria-label={t("scenario.selected")}>
          <small className="preset-active-action__eyebrow">{t("scenario.selected")}</small>
          <div className="preset-active-action__body">
            <span className="preset-active-action__visual" data-kind={selectedPreset?.source.kind ?? (selectedDirect ? directSourceKind(selectedDirect) : undefined)}>
              <SourceGlyph kind={selectedPreset?.source.kind ?? (selectedDirect ? directSourceKind(selectedDirect) : "Earthquake")} />
            </span>
            <span className="preset-active-action__copy">
              <strong>{selectedDirect?.name ?? selectedPreset?.name ?? t("scenario.referenceEvent")}</strong>
              <span>{displayQuantities(selectedDirect?.detail ?? (selectedPreset ? `${presentationForPreset(selectedPreset).scale} · ${selectedPreset.date}` : t("scenario.readyConfigure")))}</span>
              <small>{displayQuantities(selectedDirect?.blurb ?? selectedPreset?.blurb ?? t("scenario.reviewSetup"))}</small>
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
        {(["all", "historical", "hypothetical", "recent", "favorites"] as const).map((item) => {
          const label = item === "all" ? t("scenario.all") : item === "historical" ? t("scenario.recorded") : item === "hypothetical" ? t("scenario.whatIf") : item === "recent" ? t("scenario.recent") : t("scenario.favorites");
          const shortLabel = item === "historical" ? t("scenario.past") : item === "favorites" ? t("scenario.saved") : label;
          return (
            <button
              type="button"
              key={item}
              aria-label={label}
              aria-pressed={filter === item}
              data-active={filter === item ? "true" : "false"}
              onClick={() => setFilter(item)}
            >
              {shortLabel}
            </button>
          );
        })}
      </div>
      {(filter === "recent" || filter === "favorites") && (
        <small className="preset-library__local-note">{t("scenario.localStateNote")}</small>
      )}

      {viewMode === "timeline" ? (
        timelinePresets.length > 0 ? (
          <TimelineView presets={timelinePresets} activeId={activeId} onSelect={onSelect} busyId={busyId} />
        ) : (
          <div className="empty-state empty-state--compact" role="status">
            <span className="empty-state__icon" aria-hidden />
            <div>
              <strong>{t("scenario.noDated")}</strong>
              <p>{t("scenario.noDatedBody")}</p>
              <button className="empty-state__action" type="button" onClick={() => { setQuery(""); setFilter("all"); setSelectedPack(null); }}>
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
                  <button className="empty-state__action" type="button" onClick={() => { setQuery(""); setFilter("all"); setSelectedPack(null); }}>
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
                      <ScenarioCard
                        key={p.id}
                        id={presetLibraryId(p.id)}
                        name={p.name}
                        date={p.date}
                        presentation={presentationForPreset(p)}
                        sourceKind={p.source.kind}
                        selected={activeId === p.id}
                        busy={isBusy}
                        speculative={Boolean(p.is_speculative)}
                        favorite={favoriteIds.includes(presetLibraryId(p.id))}
                        onSelect={() => onSelect(p.id)}
                        onToggleFavorite={onToggleFavorite}
                        selectedLabel={t("scenario.selectedState")}
                        loadingLabel={t("scenario.loading")}
                        whatIfLabel={t("scenario.whatIf")}
                        previewLabel={t("scenario.globalPreview")}
                        favoriteLabel={t("scenario.favoriteNamed", { name: p.name })}
                        removeFavoriteLabel={t("scenario.removeFavoriteNamed", { name: p.name })}
                        formatQuantityText={displayQuantities}
                      />
                    );
                  })}
                  {group.directScenarios.map((scenario) => (
                    <ScenarioCard
                      key={scenario.id}
                      id={scenario.id}
                      name={scenario.name}
                      date={scenario.date}
                      presentation={presentationForDirectScenario(scenario)}
                      sourceKind={directSourceKind(scenario)}
                      selected={activeDirectId === scenario.id}
                      speculative={scenario.classification === "what-if"}
                      favorite={favoriteIds.includes(scenario.id)}
                      onSelect={() => onSelectDirect?.(scenario)}
                      onToggleFavorite={onToggleFavorite}
                      selectedLabel={t("scenario.selectedState")}
                      loadingLabel={t("scenario.loading")}
                      whatIfLabel={t("scenario.whatIf")}
                      previewLabel={t("scenario.globalPreview")}
                      favoriteLabel={t("scenario.favoriteNamed", { name: scenario.name })}
                      removeFavoriteLabel={t("scenario.removeFavoriteNamed", { name: scenario.name })}
                      formatQuantityText={displayQuantities}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      {!simplified && onStartLesson && (
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
                title={displayQuantities(lesson.summary)}
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
