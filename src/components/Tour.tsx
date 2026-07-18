import { useEffect, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { UiIcon } from "./UiIcon";
import { useI18n } from "../lib/i18n";
import type { MessageKey } from "../lib/i18n-core";

/**
 * Lightweight 5-step onboarding tour. In-house implementation rather
 * than pulling in react-joyride / shepherd.js (both ~30 KB gzipped) —
 * the app layout is simple enough that hand-positioning relative to
 * fixed CSS-grid regions is more reliable than DOM-anchored libraries.
 *
 * Triggered automatically on first launch (after the disclaimer is
 * acknowledged) and re-runnable from Settings → Advanced.
 */

export type TourStep = {
  title: MessageKey;
  body: MessageKey;
  /** Where to position the card relative to the viewport. */
  pos: "top-left" | "top-right" | "top-center" | "bottom-left" | "bottom-right" | "center";
};

const STEPS: TourStep[] = [
  {
    title: "tour.welcome.title",
    body: "tour.welcome.body",
    pos: "center",
  },
  {
    title: "tour.preset.title",
    body: "tour.preset.body",
    pos: "top-left",
  },
  {
    title: "tour.results.title",
    body: "tour.results.body",
    pos: "top-right",
  },
  {
    title: "tour.propagation.title",
    body: "tour.propagation.body",
    pos: "bottom-right",
  },
  {
    title: "tour.coast.title",
    body: "tour.coast.body",
    pos: "top-center",
  },
  {
    title: "tour.custom.title",
    body: "tour.custom.body",
    pos: "bottom-right",
  },
];

type Props = {
  open: boolean;
  onClose: () => void;
};

export function Tour({ open, onClose }: Props) {
  const { t, formatNumber } = useI18n();
  const [idx, setIdx] = useState(0);
  const step = useMemo(() => STEPS[idx], [idx]);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);
  useEscapeKey(onClose, open);

  useEffect(() => {
    if (open) setIdx(0);
  }, [open]);

  if (!open) return null;

  const isLast = idx === STEPS.length - 1;

  return (
    <div className="tour-overlay" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div className={`tour-card tour-card--${step.pos}`} ref={dialogRef} tabIndex={-1}>
        <div className="tour-card__topline">
          <span className="tour-card__step">{t("tour.step", { current: formatNumber(idx + 1), total: formatNumber(STEPS.length) })}</span>
          <div className="tour-card__progress" aria-hidden>
            {STEPS.map((item, stepIdx) => (
              <span
                key={item.title}
                data-active={stepIdx === idx ? "true" : "false"}
                data-complete={stepIdx < idx ? "true" : "false"}
              />
            ))}
          </div>
        </div>
        <h3 id="tour-title" className="tour-card__title">
          {t(step.title)}
        </h3>
        <p className="tour-card__body">{t(step.body)}</p>
        <div className="tour-card__actions">
          <button className="scenario-tab" onClick={onClose} type="button">
            {t("tour.close")}
          </button>
          <div className="tour-card__spacer" />
          <button
            className="scenario-tab"
            onClick={() => setIdx((i) => (i > 0 ? i - 1 : 0))}
            disabled={idx === 0}
            type="button"
          >
            <UiIcon name="chevronRight" size={14} className="icon--flip" />
            {t("tour.back")}
          </button>
          <button
            className="primary"
            onClick={() => {
              if (isLast) onClose();
              else setIdx((i) => i + 1);
            }}
            type="button"
          >
            {isLast ? (
              t("tour.done")
            ) : (
              <>
                {t("tour.next")}
                <UiIcon name="chevronRight" size={14} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
