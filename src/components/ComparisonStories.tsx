import { useMemo } from "react";
import {
  COMPARISON_STORIES,
  buildComparisonMetrics,
  comparisonStoryForPair,
  type ComparisonStory,
} from "../lib/comparison-stories";
import type { InitialDisplacement, Preset } from "../types/scenario";
import { useI18n } from "../lib/i18n";
import { useUnits } from "../hooks/useUnits";

type Props = {
  presets: Preset[];
  activePresetAId: string | null;
  activePresetBId: string | null;
  initialA: InitialDisplacement | null;
  initialB: InitialDisplacement | null;
  busy: boolean;
  onSelectStory: (story: ComparisonStory) => void;
  onSelectCustomB: (presetId: string | null) => void;
  error?: string | null;
  stale?: boolean;
  onRetry?: () => void;
};

export function ComparisonStories({
  presets,
  activePresetAId,
  activePresetBId,
  initialA,
  initialB,
  busy,
  onSelectStory,
  onSelectCustomB,
  error,
  stale = false,
  onRetry,
}: Props) {
  const { t, formatNumber } = useI18n();
  const unitSystem = useUnits();
  const presetIds = useMemo(() => new Set(presets.map((preset) => preset.id)), [presets]);
  const activeStory = comparisonStoryForPair(activePresetAId, activePresetBId);
  const metrics = buildComparisonMetrics(initialA, initialB, unitSystem);
  const storyCopy = (story: ComparisonStory) => ({
    title: t(`comparison.story.${story.id}.title` as Parameters<typeof t>[0]),
    promise: t(`comparison.story.${story.id}.promise` as Parameters<typeof t>[0]),
    question: t(`comparison.story.${story.id}.question` as Parameters<typeof t>[0]),
  });
  const localizeDifference = (difference: string) => {
    if (difference === "not ratio-comparable") return t("comparison.notComparable");
    if (difference === "within 5%") return t("comparison.withinFive");
    const match = difference.match(/^(.+)× larger in Slot ([AB])$/);
    return match
      ? t("comparison.larger", { value: match[1], slot: match[2] })
      : difference;
  };
  const metricLabel = (label: string) => label === "Peak source amplitude"
    ? t("comparison.peakAmplitude")
    : label === "Source energy"
      ? t("comparison.sourceEnergy")
      : label === "Source radius"
        ? t("comparison.sourceRadius")
        : label;

  return (
    <section className="app__compare-picker" aria-label={t("comparison.title")}>
      <header className="comparison-stories__header">
        <div>
          <span>{t("comparison.title")}</span>
          <strong>{t("comparison.startPair")}</strong>
        </div>
        <p>{t("comparison.sharedView")}</p>
      </header>

      <div className="comparison-stories__list">
        {COMPARISON_STORIES.map((story) => {
          const available = presetIds.has(story.leftPresetId) && presetIds.has(story.rightPresetId);
          const copy = storyCopy(story);
          return (
            <button
              type="button"
              key={story.id}
              className="comparison-story"
              aria-pressed={activeStory?.id === story.id}
              disabled={!available || busy}
              onClick={() => onSelectStory(story)}
            >
              <strong>{copy.title}</strong>
              <span>{copy.promise}</span>
            </button>
          );
        })}
      </div>

      {activeStory && (
        <div className="comparison-story__readout" role="status" aria-live="polite">
          <strong>{storyCopy(activeStory).question}</strong>
          {metrics.length > 0 ? (
            <dl>
              {metrics.map((metric) => (
                <div key={metric.label}>
                  <dt>{metricLabel(metric.label)}</dt>
                  <dd>{t("comparison.slotValues", { a: metric.slotA, b: metric.slotB })}</dd>
                  <dd>{localizeDifference(metric.difference)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p>{busy ? t("comparison.loadingBoth") : t("comparison.chooseStory")}</p>
          )}
          <p>{t("comparison.linked", { minutes: formatNumber(Math.round(activeStory.focusTimeS / 60)) })}</p>
        </div>
      )}

      <div className="comparison-stories__advanced">
        <span>{t("comparison.advanced")}</span>
        <label htmlFor="compare-source-b">{t("comparison.compareAgainst")}</label>
        <select
          id="compare-source-b"
          value={activePresetBId ?? ""}
          onChange={(event) => onSelectCustomB(event.target.value || null)}
          disabled={busy}
        >
          <option value="">{t("comparison.selectSlotB")}</option>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>{preset.name} · {preset.date}</option>
          ))}
        </select>
      </div>
      <small>{busy ? t("comparison.loadingSource") : activeStory ? storyCopy(activeStory).promise : t("comparison.customKeepsA")}</small>

      {error && (
        <div className="panel-error" role="alert">
          <span>{stale ? t("comparison.staleSource", { error }) : t("comparison.failedSource", { error })}</span>
          {onRetry && <button type="button" onClick={onRetry}>{t("comparison.retrySlotB")}</button>}
        </div>
      )}
    </section>
  );
}
