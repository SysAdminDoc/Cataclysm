import { useEffect, useRef, useState } from "react";
import { settings } from "../lib/settings";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { LAUNCH_COMPLETE_EVENT } from "./LaunchExperience";

/** Dispatch to reopen the first-run notice immediately (e.g. from Settings). */
export const REPLAY_DISCLAIMER_EVENT = "cataclysm:replay-disclaimer";

/**
 * Shown once on first launch. After acknowledgement the timestamp is stored
 * in settings so the modal never appears again on subsequent runs.
 */
export function FirstRunDisclaimer() {
  const [open, setOpen] = useState(false);
  const [persistenceUnavailable, setPersistenceUnavailable] = useState(false);
  const [launchReady, setLaunchReady] = useState(
    () => document.documentElement.dataset.launchExperienceActive !== "true",
  );
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

  useEffect(() => {
    if (launchReady) return;
    const onLaunchComplete = () => setLaunchReady(true);
    window.addEventListener(LAUNCH_COMPLETE_EVENT, onLaunchComplete, { once: true });
    return () => window.removeEventListener(LAUNCH_COMPLETE_EVENT, onLaunchComplete);
  }, [launchReady]);

  useEffect(() => {
    if (!launchReady) return;
    let cancelled = false;
    settings.getDisclaimerAcknowledged().then((ack) => {
      if (cancelled) return;
      setPersistenceUnavailable(false);
      setOpen(ack === null);
    }).catch((err: unknown) => {
      console.warn("[disclaimer] could not read acknowledgement", err);
      if (cancelled) return;
      // The safety notice is mandatory. An unavailable settings store must
      // never be interpreted as a prior acknowledgement.
      setPersistenceUnavailable(true);
      setOpen(true);
    });
    return () => {
      cancelled = true;
    };
  }, [launchReady]);

  // Allow Settings to replay the notice immediately, independent of the
  // one-time acknowledgement, so "Replay first-run" opens it now rather than
  // only scheduling it for the next launch.
  useEffect(() => {
    const replay = () => {
      setLaunchReady(true);
      setOpen(true);
    };
    window.addEventListener(REPLAY_DISCLAIMER_EVENT, replay);
    return () => window.removeEventListener(REPLAY_DISCLAIMER_EVENT, replay);
  }, []);

  if (!open) return null;

  async function acknowledge() {
    // Close the modal eagerly so a setting-store failure doesn't trap the
    // user inside the dialog. The acknowledgement write is best-effort —
    // worst case the modal reappears on next launch.
    setOpen(false);
    try {
      await settings.acknowledgeDisclaimer();
    } catch (err) {
      setPersistenceUnavailable(true);
      console.warn("[disclaimer] could not persist acknowledgement", err);
    } finally {
      // Persistence is best-effort; acknowledgement still advances this
      // session so a broken settings store cannot trap the user.
      window.dispatchEvent(new CustomEvent("tsunamisim:disclaimer-acknowledged"));
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal modal--notice" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="first-run-title">
        <header className="modal__header">
          <h2 id="first-run-title">Educational model, not a warning system</h2>
        </header>
        <div className="modal__body">
          <p className="notice-lede">
            Cataclysm is an exploratory simulator for planetary-hazard source
            physics, propagation, and first-order effects. Its outputs are
            model estimates—not observations, forecasts, or official
            warnings—and must not guide evacuation, routing, insurance, or
            operations.
          </p>
          <div className="notice-grid" aria-label="Use guidance">
            <div className="notice-grid__item">
              <strong>Good for</strong>
              <span>Scenario exploration, classroom demonstrations, and model intuition.</span>
            </div>
            <div className="notice-grid__item" data-tone="warning">
              <strong>Not for</strong>
              <span>Forecasts, evacuation timing, route choice, or emergency decisions.</span>
            </div>
            <div className="notice-grid__item">
              <strong>Official sources</strong>
              <span>Use NOAA NTWC/PTWC, JMA, IOC/UNESCO systems, or your local authority.</span>
            </div>
            <div className="notice-grid__item" data-tone="warning">
              <strong>Limits to expect</strong>
              <span>Idealized source physics, coarse bathymetry, simplified atmosphere and runup, and approximate effect geometry.</span>
            </div>
          </div>
          <p className="modal__copy">
            Physics references are available from <em>References</em>. Treat
            every map, overlay, and export as approximate.
          </p>
          <p className="modal__copy modal__copy--muted">
            This notice is shown once. You can show it again from Settings.
          </p>
          {persistenceUnavailable && (
            <p className="notice-persistence-warning" role="status">
              Settings are unavailable, so Cataclysm cannot confirm or save
              this acknowledgement. You can continue for this session, but
              this notice may appear again the next time the app starts.
            </p>
          )}
          <div className="modal__actions">
            <button className="primary" onClick={acknowledge}>I understand</button>
          </div>
        </div>
      </div>
    </div>
  );
}
