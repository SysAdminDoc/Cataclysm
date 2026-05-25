import { useEffect, useMemo, useState } from "react";

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
    title: "Welcome to TsunamiSimulator",
    body:
      "A scientifically grounded simulator for tsunami generation, propagation, and coastal runup from asteroid impacts, nuclear detonations, earthquakes, and landslides. Educational only — not for evacuation planning.",
    pos: "center",
  },
  {
    title: "1 · Pick a historical event",
    body:
      "The left panel lists 11 peer-reviewed presets (Tōhoku 2011, Chicxulub 66 Ma, Lituya Bay 1958, and more). Click one to see the source render on the globe with its cavity geometry and computed energy.",
    pos: "top-left",
  },
  {
    title: "2 · Read the results",
    body:
      "The right panel shows source energy, equivalent moment magnitude, cavity radius, peak amplitude, and a 0 → 6 h timeline scrubber for the analytical wavefront ring.",
    pos: "top-right",
  },
  {
    title: "3 · Run the live SWE solver",
    body:
      "Scroll the right panel to find 'Live SWE Solver'. Click 'Run simulation' to compute a 24-frame shallow-water-equation propagation; the PNG sequence overlays on the globe and you can scrub or Play it back.",
    pos: "bottom-right",
  },
  {
    title: "4 · Inspect any coast",
    body:
      "Toggle '🔍 Inspect' in the header, then click anywhere on the globe to read the arrival time, offshore amplitude, Synolakis runup, and inundation extent at that point. Esc exits.",
    pos: "top-center",
  },
  {
    title: "5 · Build your own scenario",
    body:
      "The right panel's 'Custom Scenario Builder' lets you dial in asteroid / nuclear / earthquake / landslide parameters, click-globe-to-pick a location, and run any what-if. Use 'Compare' in the header for side-by-side runs.",
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

  useEffect(() => {
    if (!open) return;
    setIdx(0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "Enter" || e.key === "ArrowRight") {
        setIdx((i) => (i + 1 < STEPS.length ? i + 1 : i));
      } else if (e.key === "ArrowLeft") {
        setIdx((i) => (i > 0 ? i - 1 : 0));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const isLast = idx === STEPS.length - 1;

  return (
    <div className="tour-overlay" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div className={`tour-card tour-card--${step.pos}`}>
        <div className="tour-card__step">
          Step {idx + 1} of {STEPS.length}
        </div>
        <h3 id="tour-title" className="tour-card__title">
          {step.title}
        </h3>
        <p className="tour-card__body">{step.body}</p>
        <div className="tour-card__actions">
          <button className="scenario-tab" onClick={onClose}>
            Skip
          </button>
          <div style={{ flex: 1 }} />
          <button
            className="scenario-tab"
            onClick={() => setIdx((i) => (i > 0 ? i - 1 : 0))}
            disabled={idx === 0}
          >
            ← Back
          </button>
          <button
            className="primary"
            onClick={() => {
              if (isLast) onClose();
              else setIdx((i) => i + 1);
            }}
          >
            {isLast ? "Done" : "Next →"}
          </button>
        </div>
      </div>
    </div>
  );
}
