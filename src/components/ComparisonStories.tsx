import { useMemo } from "react";
import {
  COMPARISON_STORIES,
  buildComparisonMetrics,
  comparisonStoryForPair,
  type ComparisonStory,
} from "../lib/comparison-stories";
import type { InitialDisplacement, Preset } from "../types/scenario";

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
  const presetIds = useMemo(() => new Set(presets.map((preset) => preset.id)), [presets]);
  const activeStory = comparisonStoryForPair(activePresetAId, activePresetBId);
  const metrics = buildComparisonMetrics(initialA, initialB);

  return (
    <section className="app__compare-picker" aria-label="Comparison stories">
      <header className="comparison-stories__header">
        <div>
          <span>Comparison stories</span>
          <strong>Start with a meaningful pair</strong>
        </div>
        <p>Both panes use the same model time and map scale.</p>
      </header>

      <div className="comparison-stories__list">
        {COMPARISON_STORIES.map((story) => {
          const available = presetIds.has(story.leftPresetId) && presetIds.has(story.rightPresetId);
          return (
            <button
              type="button"
              key={story.id}
              className="comparison-story"
              aria-pressed={activeStory?.id === story.id}
              disabled={!available || busy}
              onClick={() => onSelectStory(story)}
            >
              <strong>{story.title}</strong>
              <span>{story.promise}</span>
            </button>
          );
        })}
      </div>

      {activeStory && (
        <div className="comparison-story__readout" role="status" aria-live="polite">
          <strong>{activeStory.question}</strong>
          {metrics.length > 0 ? (
            <dl>
              {metrics.map((metric) => (
                <div key={metric.label}>
                  <dt>{metric.label}</dt>
                  <dd>A {metric.slotA} · B {metric.slotB}</dd>
                  <dd>{metric.difference}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p>{busy ? "Loading both source models…" : "Choose the story to load both source models."}</p>
          )}
          <p>Linked at T+{Math.round(activeStory.focusTimeS / 60)} min · equal camera range</p>
        </div>
      )}

      <div className="comparison-stories__advanced">
        <span>Advanced</span>
        <label htmlFor="compare-source-b">Compare against</label>
        <select
          id="compare-source-b"
          value={activePresetBId ?? ""}
          onChange={(event) => onSelectCustomB(event.target.value || null)}
          disabled={busy}
        >
          <option value="">Select Slot B source…</option>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>{preset.name} · {preset.date}</option>
          ))}
        </select>
      </div>
      <small>{busy ? "Loading comparison source…" : activeStory?.promise ?? "Custom Slot B keeps Slot A unchanged."}</small>

      {error && (
        <div className="panel-error" role="alert">
          <span>{stale ? "Slot B is showing its last valid source: " : "Slot B source failed: "}{error}</span>
          {onRetry && <button type="button" onClick={onRetry}>Retry Slot B</button>}
        </div>
      )}
    </section>
  );
}
