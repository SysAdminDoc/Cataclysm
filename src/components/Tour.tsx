import { useEffect, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { UiIcon } from "./UiIcon";

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
  title: string;
  body: string;
  /** Where to position the card relative to the viewport. */
  pos: "top-left" | "top-right" | "top-center" | "bottom-left" | "bottom-right" | "center";
};

const STEPS: TourStep[] = [
  {
    title: "Welcome to Cataclysm",
    body:
      "Explore scientifically grounded tsunami source models, propagation, and coastal runup. Educational only — not for evacuation planning.",
    pos: "center",
  },
  {
    title: "1 · Pick a historical event",
    body:
      "Choose a curated preset to render the source on the globe with its geometry, energy, and citation trail.",
    pos: "top-left",
  },
  {
    title: "2 · Read the results",
    body:
      "Use the readout and timeline to inspect energy, equivalent magnitude, source scale, and wavefront timing.",
    pos: "top-right",
  },
  {
    title: "3 · Run the live SWE solver",
    body:
      "Run a 24-frame shallow-water simulation, then scrub or play the resulting propagation layer on the globe.",
    pos: "bottom-right",
  },
  {
    title: "4 · Inspect any coast",
    body:
      "Turn on Inspect, click the globe, and read arrival, offshore amplitude, runup, and inundation at that point.",
    pos: "top-center",
  },
  {
    title: "5 · Build your own scenario",
    body:
      "Create asteroid, nuclear, earthquake, or landslide scenarios, pick a location on the globe, and compare two runs side by side.",
    pos: "bottom-right",
  },
];

type Props = {
  open: boolean;
  onClose: () => void;
};

export function Tour({ open, onClose }: Props) {
  const [idx, setIdx] = useState(0);
  const step = useMemo(() => STEPS[idx], [idx]);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

  useEffect(() => {
    if (open) setIdx(0);
  }, [open]);

  if (!open) return null;

  const isLast = idx === STEPS.length - 1;

  return (
    <div className="tour-overlay" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div className={`tour-card tour-card--${step.pos}`} ref={dialogRef} tabIndex={-1}>
        <div className="tour-card__topline">
          <span className="tour-card__step">Step {idx + 1} of {STEPS.length}</span>
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
          {step.title}
        </h3>
        <p className="tour-card__body">{step.body}</p>
        <div className="tour-card__actions">
          <button className="scenario-tab" onClick={onClose} type="button">
            Close tour
          </button>
          <div className="tour-card__spacer" />
          <button
            className="scenario-tab"
            onClick={() => setIdx((i) => (i > 0 ? i - 1 : 0))}
            disabled={idx === 0}
            type="button"
          >
            <UiIcon name="chevronRight" size={14} className="icon--flip" />
            Back
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
              "Done"
            ) : (
              <>
                Next
                <UiIcon name="chevronRight" size={14} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
