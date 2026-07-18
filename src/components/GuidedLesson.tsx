import { useEffect, useMemo, useState } from "react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { UiIcon } from "./UiIcon";
import type {
  GuidedLesson as LessonDef,
  GuidedStoryCue,
  GuidedStoryTarget,
} from "../lib/guided-lessons";
import { useI18n } from "../lib/i18n";

type StoryMode = "follow" | "explore";

type Props = {
  lesson: LessonDef;
  onClose: () => void;
  onComplete?: (lessonId: string) => void;
  onCue?: (cue: GuidedStoryCue | null, lessonId: string, stepIndex: number) => void;
};

type StoredProgress = {
  stepIdx: number;
  mode: StoryMode;
};

const PROGRESS_PREFIX = "cataclysm.guided-story.";

function loadProgress(lesson: LessonDef): StoredProgress {
  try {
    const parsed = JSON.parse(localStorage.getItem(`${PROGRESS_PREFIX}${lesson.id}`) ?? "null") as Partial<StoredProgress> | null;
    const stepIdx = Number.isInteger(parsed?.stepIdx)
      ? Math.max(0, Math.min(lesson.steps.length - 1, Number(parsed?.stepIdx)))
      : 0;
    return { stepIdx, mode: parsed?.mode === "explore" ? "explore" : "follow" };
  } catch {
    return { stepIdx: 0, mode: "follow" };
  }
}

function persistProgress(lessonId: string, progress: StoredProgress): void {
  try {
    localStorage.setItem(`${PROGRESS_PREFIX}${lessonId}`, JSON.stringify(progress));
  } catch {
    // Persistence is an enhancement; a locked-down WebView must not block a lesson.
  }
}

export function GuidedLesson({ lesson, onClose, onComplete, onCue }: Props) {
  const { t } = useI18n();
  const initialProgress = useMemo(() => loadProgress(lesson), [lesson]);
  const [stepIdx, setStepIdx] = useState(initialProgress.stepIdx);
  const [mode, setMode] = useState<StoryMode>(initialProgress.mode);
  useEscapeKey(() => {
    onCue?.(null, lesson.id, stepIdx);
    onClose();
  });

  useEffect(() => {
    const restored = loadProgress(lesson);
    setStepIdx(restored.stepIdx);
    setMode(restored.mode);
  }, [lesson]);

  useEffect(() => {
    persistProgress(lesson.id, { stepIdx, mode });
    onCue?.(mode === "follow" ? lesson.story.cues[stepIdx] ?? null : null, lesson.id, stepIdx);
  }, [lesson, mode, onCue, stepIdx]);

  // Classroom handout: flag the body so the print stylesheet swaps the
  // whole app for the worksheet section below, then print.
  const printWorksheet = () => {
    document.body.setAttribute("data-print-worksheet", "true");
    const cleanup = () => {
      document.body.removeAttribute("data-print-worksheet");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    requestAnimationFrame(() => window.print());
  };

  const closeStory = () => {
    onCue?.(null, lesson.id, stepIdx);
    onClose();
  };
  const step = lesson.steps[stepIdx];
  const cue = lesson.story.cues[stepIdx];
  const isLast = stepIdx === lesson.steps.length - 1;
  const targetLabels: Record<GuidedStoryTarget, string> = {
    setup: t("guided.target.setup"),
    solver: t("guided.target.solver"),
    globe: t("guided.target.globe"),
    timeline: t("guided.target.timeline"),
    results: t("guided.target.results"),
    layers: t("guided.target.layers"),
    comparison: t("guided.target.comparison"),
  };
  const targetLabel = cue ? targetLabels[cue.target] : targetLabels.globe;

  return (
    <aside className="lesson-overlay" aria-labelledby="lesson-name lesson-title">
      <div className="lesson-worksheet" aria-hidden>
        <h1>{lesson.title}</h1>
        <p className="lesson-worksheet__meta">{t("guided.worksheetMeta")}</p>
        <p>{lesson.summary}</p>
        <ol>
          {lesson.worksheet.map((q) => (
            <li key={q}>
              <p>{q}</p>
              <div className="lesson-worksheet__lines" />
            </li>
          ))}
        </ol>
        <p className="lesson-worksheet__footer">{t("guided.worksheetFooter")}</p>
      </div>
      <section className="lesson-card" aria-label={t("guided.badge")}>
        <div className="lesson-card__topline">
          <span className="lesson-card__badge">{t("guided.badge")}</span>
          <span className="lesson-card__step">
            {t("guided.step", { current: stepIdx + 1, total: lesson.steps.length })}
          </span>
          <div className="lesson-card__progress" aria-hidden>
            {lesson.steps.map((storyStep, index) => (
              <span
                key={storyStep.title}
                data-active={index === stepIdx ? "true" : "false"}
                data-complete={index < stepIdx ? "true" : "false"}
              />
            ))}
          </div>
        </div>

        <div className="lesson-card__mode" role="group" aria-label={t("guided.modeLabel")}>
          <button
            type="button"
            aria-pressed={mode === "follow"}
            data-active={mode === "follow" ? "true" : "false"}
            onClick={() => setMode("follow")}
          >
            <UiIcon name="mapPin" size={14} />
            {t("guided.follow")}
          </button>
          <button
            type="button"
            aria-pressed={mode === "explore"}
            data-active={mode === "explore" ? "true" : "false"}
            onClick={() => setMode("explore")}
          >
            <UiIcon name="search" size={14} />
            {t("guided.explore")}
          </button>
        </div>

        <h2 id="lesson-name" className="lesson-card__lesson">{lesson.title}</h2>
        <h3 id="lesson-title" className="lesson-card__title">{step.title}</h3>
        <p className="lesson-card__body">{step.body}</p>

        <div className="lesson-card__cue" data-active={mode === "follow" ? "true" : "false"}>
          <span>{t("guided.focusLabel")}</span>
          <strong>{mode === "follow" ? targetLabel : t("guided.exploreHint")}</strong>
        </div>
        <p className="sr-only" role="status" aria-live="polite">
          {mode === "follow"
            ? t("guided.focusNarration", { target: targetLabel })
            : t("guided.exploreNarration")}
        </p>

        <div className="lesson-card__actions">
          <button className="scenario-tab" onClick={closeStory} type="button">
            {t("guided.skip")}
          </button>
          {lesson.worksheet.length > 0 && (
            <button
              className="scenario-tab lesson-card__print"
              onClick={printWorksheet}
              type="button"
              title={t("guided.printTitle")}
            >
              {t("guided.print")}
            </button>
          )}
          <div className="lesson-card__spacer" />
          <button
            className="scenario-tab"
            onClick={() => setStepIdx((index) => Math.max(0, index - 1))}
            disabled={stepIdx === 0}
            type="button"
          >
            <UiIcon name="chevronRight" size={14} className="icon--flip" />
            {t("guided.back")}
          </button>
          <button
            className="primary"
            onClick={() => {
              if (isLast) {
                onComplete?.(lesson.id);
                closeStory();
              } else {
                setStepIdx((index) => index + 1);
              }
            }}
            type="button"
          >
            {isLast ? t("guided.done") : (
              <>
                {t("guided.next")}
                <UiIcon name="chevronRight" size={14} />
              </>
            )}
          </button>
        </div>
      </section>
    </aside>
  );
}
