import { useEffect, useMemo, useRef, useState } from "react";

import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import {
  buildHighlightStory,
  buildHighlightStoryUrl,
  HIGHLIGHT_STORY_DURATIONS,
  saveHighlightStory,
  type HighlightMomentLabels,
  type HighlightStoryBuildInput,
  type HighlightStoryDuration,
  type HighlightStoryOptions,
  type HighlightStoryVariant,
} from "../lib/highlight-story";
import { copyExportText } from "../lib/export";
import { useI18n } from "../lib/i18n";
import { UiIcon } from "./UiIcon";

export type HighlightStorySource = Omit<HighlightStoryBuildInput, "options" | "labels" | "scenarioUrl"> & {
  baseScenarioUrl: string;
};

type Props = {
  source: HighlightStorySource;
  initialOptions?: HighlightStoryOptions;
  onSeek: (sourceTimeS: number) => void;
  onClose: () => void;
};

const DEFAULT_OPTIONS: HighlightStoryOptions = {
  durationS: 30,
  variant: "analytical",
  captions: true,
};

export function HighlightStoryDialog({ source, initialOptions = DEFAULT_OPTIONS, onSeek, onClose }: Props) {
  const { t, formatNumber } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  useEscapeKey(onClose);
  useFocusTrap(dialogRef);
  const [options, setOptions] = useState(initialOptions);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [actionState, setActionState] = useState<{ kind: "save" | "copy"; message: string; failed: boolean } | null>(null);
  const labels = useMemo<HighlightMomentLabels>(() => ({
    title: { title: t("story.moment.title"), caption: t("story.moment.titleCaption") },
    source: { title: t("story.moment.source"), caption: t("story.moment.sourceCaption") },
    development: { title: t("story.moment.development"), caption: t("story.moment.developmentCaption") },
    peak: { title: t("story.moment.peak"), caption: t("story.moment.peakCaption") },
    outcome: { title: t("story.moment.outcome"), caption: t("story.moment.outcomeCaption") },
    provenance: { title: t("story.moment.provenance"), caption: t("story.moment.provenanceCaption") },
  }), [t]);
  const storyUrl = useMemo(
    () => buildHighlightStoryUrl(source.baseScenarioUrl, options),
    [options, source.baseScenarioUrl],
  );
  const manifest = useMemo(() => buildHighlightStory({
    ...source,
    options,
    labels,
    scenarioUrl: storyUrl,
  }), [labels, options, source, storyUrl]);

  useEffect(() => {
    if (previewIndex === null) return;
    const moment = manifest.moments[previewIndex];
    if (!moment) {
      setPreviewIndex(null);
      return;
    }
    onSeek(moment.sourceTimeS);
    const timer = window.setTimeout(() => {
      setPreviewIndex((current) => current === null || current >= manifest.moments.length - 1 ? null : current + 1);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [manifest, onSeek, previewIndex]);

  function updateOptions(update: Partial<HighlightStoryOptions>) {
    setOptions((current) => ({ ...current, ...update }));
    setPreviewIndex(null);
    setActionState(null);
  }

  function save() {
    const result = saveHighlightStory(manifest);
    setActionState(result.ok
      ? { kind: "save", message: t("story.saved", { filename: result.filename }), failed: false }
      : { kind: "save", message: result.message, failed: true });
  }

  async function copyLink() {
    const result = await copyExportText(manifest.scenarioUrl);
    setActionState(result.ok
      ? { kind: "copy", message: t("story.linkCopied"), failed: false }
      : { kind: "copy", message: result.message, failed: true });
  }

  const activeMoment = previewIndex === null ? null : manifest.moments[previewIndex];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal highlight-story" ref={dialogRef} tabIndex={-1} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="highlight-story-title">
        <div className="modal__header">
          <div>
            <small>{t("story.eyebrow")}</small>
            <h2 id="highlight-story-title">{t("story.title")}</h2>
          </div>
          <button onClick={onClose} aria-label={t("story.close")} className="modal__close" type="button">
            <UiIcon name="close" size={16} />
          </button>
        </div>
        <div className="modal__body highlight-story__body">
          <div className="highlight-story__scenario">
            <span><small>{t("story.scenario")}</small><strong>{manifest.scenario.title}</strong></span>
            <span><small>{t("story.replaySource")}</small><strong>{t("story.cachedFrames", { count: manifest.replay.frameCount })}</strong></span>
          </div>

          <div className="highlight-story__controls">
            <fieldset>
              <legend>{t("story.duration")}</legend>
              <div role="group" aria-label={t("story.duration")}>
                {HIGHLIGHT_STORY_DURATIONS.map((duration) => (
                  <button key={duration} type="button" aria-pressed={options.durationS === duration} onClick={() => updateOptions({ durationS: duration as HighlightStoryDuration })}>
                    {t("story.seconds", { value: duration })}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>{t("story.view")}</legend>
              <div role="group" aria-label={t("story.view")}>
                {(["clean_cinematic", "analytical"] as HighlightStoryVariant[]).map((variant) => (
                  <button key={variant} type="button" aria-pressed={options.variant === variant} onClick={() => updateOptions({ variant })}>
                    {t(variant === "clean_cinematic" ? "story.view.clean" : "story.view.analytical")}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="highlight-story__captions">
              <input type="checkbox" checked={options.captions} onChange={(event) => updateOptions({ captions: event.target.checked })} />
              <span><strong>{t("story.captions")}</strong><small>{t("story.captionsDescription")}</small></span>
            </label>
          </div>

          <section className="highlight-story__preview" aria-labelledby="highlight-story-preview-heading">
            <header>
              <span><small>{t("story.preview")}</small><h3 id="highlight-story-preview-heading">{manifest.scenario.title}</h3></span>
              <button type="button" onClick={() => setPreviewIndex(0)} disabled={previewIndex !== null}>
                <UiIcon name={previewIndex === null ? "play" : "refresh"} size={13} />
                {previewIndex === null ? t("story.previewMoments") : t("story.previewing")}
              </button>
            </header>
            <div className="highlight-story__trust">
              <span>{t(options.variant === "clean_cinematic" ? "story.cleanBoundary" : "story.analyticalBoundary")}</span>
              <span>{manifest.educationalLabel}</span>
            </div>
            <ol className="highlight-story__moments">
              {manifest.moments.map((moment, index) => (
                <li key={moment.id} data-active={previewIndex === index ? "true" : undefined}>
                  <button type="button" onClick={() => { setPreviewIndex(null); onSeek(moment.sourceTimeS); }}>
                    <time>{t("story.atSecond", { value: formatNumber(moment.storyTimeS, { maximumFractionDigits: 1 }) })}</time>
                    <strong>{moment.title}</strong>
                    <span>{moment.caption}</span>
                    <small>{t("story.sourceTime", { value: formatNumber(moment.sourceTimeS, { maximumFractionDigits: 1 }) })}</small>
                  </button>
                </li>
              ))}
            </ol>
            {activeMoment && <p className="highlight-story__live" role="status">{t("story.showing", { title: activeMoment.title })}</p>}
            <dl className="highlight-story__evidence">
              <div><dt>{t("story.scaleAnchors")}</dt><dd>{manifest.scaleAnchors.join(" · ") || t("story.notSupplied")}</dd></div>
              <div><dt>{t("story.uncertainty")}</dt><dd>{manifest.uncertaintyLabel}</dd></div>
              <div><dt>{t("story.attribution")}</dt><dd>{manifest.rendererAttribution} · {manifest.sourceAttribution}</dd></div>
              <div><dt>{t("story.replayFingerprint")}</dt><dd><code>{manifest.replay.fingerprint}</code></dd></div>
            </dl>
          </section>

          {actionState && (
            <div className="highlight-story__action-state" role={actionState.failed ? "alert" : "status"} data-failed={actionState.failed ? "true" : undefined}>
              <span>{actionState.message}</span>
              {actionState.failed && <button type="button" onClick={() => actionState.kind === "save" ? save() : void copyLink()}>{t("story.retry")}</button>}
            </div>
          )}
        </div>
        <div className="modal__footer highlight-story__footer">
          <span>{t("story.noRecompute")}</span>
          <button className="secondary" type="button" onClick={() => void copyLink()}><UiIcon name="copy" size={13} /> {t("story.copyLink")}</button>
          <button className="primary" type="button" onClick={save}><UiIcon name="save" size={13} /> {t("story.saveFile")}</button>
        </div>
      </div>
    </div>
  );
}
