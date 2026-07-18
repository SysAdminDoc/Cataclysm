import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { UiIcon } from "./UiIcon";
import type { GuidedLesson as LessonDef } from "../lib/guided-lessons";
import { useI18n } from "../lib/i18n";

type Props = {
  lesson: LessonDef;
  onClose: () => void;
  onComplete?: (lessonId: string) => void;
};

export function GuidedLesson({ lesson, onClose, onComplete }: Props) {
  const { t } = useI18n();
  const [stepIdx, setStepIdx] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true);
  useEscapeKey(onClose);

  useEffect(() => {
    setStepIdx(0);
  }, [lesson.id]);

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

  const step = lesson.steps[stepIdx];
  const isLast = stepIdx === lesson.steps.length - 1;

  return (
    <div className="lesson-overlay" role="dialog" aria-modal="true" aria-labelledby="lesson-name lesson-title">
      <div className="lesson-worksheet" aria-hidden>
        <h1>{lesson.title}</h1>
        <p className="lesson-worksheet__meta">
          {t("guided.worksheetMeta")}
        </p>
        <p>{lesson.summary}</p>
        <ol>
          {lesson.worksheet.map((q) => (
            <li key={q}>
              <p>{q}</p>
              <div className="lesson-worksheet__lines" />
            </li>
          ))}
        </ol>
        <p className="lesson-worksheet__footer">
          {t("guided.worksheetFooter")}
        </p>
      </div>
      <div className="lesson-card" ref={dialogRef} tabIndex={-1}>
        <div className="lesson-card__topline">
          <span className="lesson-card__badge">{t("guided.badge")}</span>
          <span className="lesson-card__step">
            {t("guided.step", { current: stepIdx + 1, total: lesson.steps.length })}
          </span>
          <div className="lesson-card__progress" aria-hidden>
            {lesson.steps.map((s, i) => (
              <span
                key={s.title}
                data-active={i === stepIdx ? "true" : "false"}
                data-complete={i < stepIdx ? "true" : "false"}
              />
            ))}
          </div>
        </div>
        <h2 id="lesson-name" className="lesson-card__lesson">{lesson.title}</h2>
        <h3 id="lesson-title" className="lesson-card__title">{step.title}</h3>
        <p className="lesson-card__body">{step.body}</p>
        <div className="lesson-card__actions">
          <button className="scenario-tab" onClick={onClose} type="button">
            {t("guided.close")}
          </button>
          {lesson.worksheet.length > 0 && (
            <button
              className="scenario-tab"
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
            onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
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
                onClose();
              } else {
                setStepIdx((i) => i + 1);
              }
            }}
            type="button"
          >
            {isLast ? (
              t("guided.done")
            ) : (
              <>
                {t("guided.next")}
                <UiIcon name="chevronRight" size={14} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
