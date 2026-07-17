import { useCallback, useEffect, useRef, useState } from "react";
import cataclysmLogoUrl from "../../assets/branding/logo.svg";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { settings, type LaunchExperiencePolicy } from "../lib/settings";

export const LAUNCH_COMPLETE_EVENT = "cataclysm:launch-complete";

function readLocalSetting<T>(key: string): T | null {
  try {
    const value = localStorage.getItem(`tsunamisim.${key}`);
    return value === null ? null : JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function initialVisibility(): boolean {
  const params = new URLSearchParams(window.location.search);
  if (params.get("referenceCapture") === "1") return false;
  if (params.get("launchExperience") === "1") return true;
  if (params.get("launchExperience") === "0") return false;
  const policy = readLocalSetting<LaunchExperiencePolicy>("launch_experience_policy") ?? "first";
  if (policy === "never") return false;
  if (policy === "always") return true;
  const seen = readLocalSetting<string>("launch_experience_seen_at");
  const migratedFirstRun = readLocalSetting<string>("disclaimer_acknowledged_at");
  return seen === null && migratedFirstRun === null;
}

type Props = {
  durationMs?: number;
};

export function LaunchExperience({ durationMs = 4_800 }: Props) {
  const [open, setOpen] = useState(() => {
    const visible = initialVisibility();
    if (visible) document.documentElement.dataset.launchExperienceActive = "true";
    return visible;
  });
  const [leaving, setLeaving] = useState(false);
  const completedRef = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const motionOverride = new URLSearchParams(window.location.search).get("launchMotion");
  const reducedMotion = motionOverride === "reduce"
    || (motionOverride !== "full" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true);
  useFocusTrap(dialogRef, open && !leaving);

  const complete = useCallback((reason: "finished" | "skipped" | "disabled") => {
    if (completedRef.current) return;
    completedRef.current = true;
    setLeaving(true);
    const closeDelay = reducedMotion ? 20 : 360;
    window.setTimeout(() => {
      setOpen(false);
      delete document.documentElement.dataset.launchExperienceActive;
      void settings.markLaunchExperienceSeen().catch((error) => {
        console.warn("[launch] could not persist launch completion", error);
      });
      window.dispatchEvent(new CustomEvent(LAUNCH_COMPLETE_EVENT, { detail: { reason } }));
    }, closeDelay);
  }, [reducedMotion]);

  useEffect(() => {
    if (!open) {
      window.dispatchEvent(new CustomEvent(LAUNCH_COMPLETE_EVENT, { detail: { reason: "disabled" } }));
      return;
    }
    document.documentElement.dataset.launchExperienceActive = "true";
    let cancelled = false;
    void Promise.all([
      settings.getLaunchExperiencePolicy(),
      settings.getLaunchExperienceSeen(),
      settings.getDisclaimerAcknowledged(),
    ]).then(([policy, seen, disclaimer]) => {
      if (cancelled) return;
      const forcedPreview = new URLSearchParams(window.location.search).get("launchExperience") === "1";
      if (!forcedPreview && (policy === "never" || (policy === "first" && (seen !== null || disclaimer !== null)))) {
        complete("disabled");
      }
    }).catch((error) => console.warn("[launch] could not load launch preference", error));
    const holdForCapture = new URLSearchParams(window.location.search).get("launchHold") === "1";
    const timer = window.setTimeout(
      () => complete("finished"),
      holdForCapture ? 60_000 : reducedMotion ? 900 : durationMs,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      delete document.documentElement.dataset.launchExperienceActive;
    };
  }, [complete, durationMs, open, reducedMotion]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") complete("skipped");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [complete, open]);

  useEffect(() => {
    const preview = () => {
      completedRef.current = false;
      setLeaving(false);
      document.documentElement.dataset.launchExperienceActive = "true";
      setOpen(true);
    };
    window.addEventListener("cataclysm:preview-launch", preview);
    return () => window.removeEventListener("cataclysm:preview-launch", preview);
  }, []);

  if (!open) return null;

  return (
    <section
      className="launch-experience"
      data-leaving={leaving ? "true" : "false"}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      role="dialog"
      aria-modal="true"
      aria-labelledby="launch-title"
      ref={dialogRef}
      tabIndex={-1}
      onPointerDown={(event) => {
        const target = event.target;
        if (!(target instanceof Element) || target.closest("button") === null) complete("skipped");
      }}
    >
      <div className="launch-experience__stars" aria-hidden="true" />
      <div className="launch-experience__earth" aria-hidden="true">
        <span className="launch-experience__atmosphere" />
        <span className="launch-experience__ocean" />
        <span className="launch-experience__wave" />
        <span className="launch-experience__impact" />
        <span className="launch-experience__blast" />
      </div>
      <div className="launch-experience__identity">
        <img className="launch-experience__logo" src={cataclysmLogoUrl} alt="" aria-hidden="true" />
        <span className="launch-experience__eyebrow">Planetary hazard simulator</span>
        <h1 id="launch-title">Cataclysm</h1>
        <p>Earth systems. Extreme events. One living world.</p>
        <div className="launch-experience__domains" aria-hidden="true">
          <span>Ocean dynamics</span>
          <span>Impact physics</span>
          <span>Nuclear effects</span>
        </div>
      </div>
      <div className="launch-experience__status" role="status" aria-live="polite">
        <span className="launch-experience__status-mark" aria-hidden="true" />
        Preparing the live Earth
      </div>
      <button
        className="launch-experience__skip"
        type="button"
        onClick={() => complete("skipped")}
      >
        Skip intro
      </button>
    </section>
  );
}
