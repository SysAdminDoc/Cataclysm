import { useEffect, useRef, useState } from "react";
import { settings } from "../lib/settings";
import { useFocusTrap } from "../hooks/useFocusTrap";

/**
 * Shown once on first launch. After acknowledgement the timestamp is stored
 * in settings so the modal never appears again on subsequent runs.
 */
export function FirstRunDisclaimer() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

  useEffect(() => {
    settings.getDisclaimerAcknowledged().then((ack) => {
      setOpen(ack === null);
    });
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
      console.warn("[disclaimer] could not persist acknowledgement", err);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal modal--notice" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="first-run-title">
        <header className="modal__header">
          <h2 id="first-run-title">Welcome to TsunamiSimulator</h2>
        </header>
        <div className="modal__body">
          <p className="modal__copy">
            <strong>TsunamiSimulator is an educational physics-visualization tool.</strong>
            {" "}
            It is <strong>NOT</strong> for evacuation planning, hazard
            forecasting, or any operational decision-making.
          </p>
          <p className="modal__copy">
            For real tsunami warnings, contact your national tsunami warning
            centre — for example,{" "}
            <strong>NOAA NTWC (Atlantic) / PTWC (Pacific)</strong>,{" "}
            <strong>JMA (Japan)</strong>, or{" "}
            <strong>IOC/UNESCO ICG-NEAMTWS (Mediterranean & NE Atlantic)</strong>.
          </p>
          <p className="modal__copy">
            All physics in this app comes from peer-reviewed literature
            (Ward & Asphaug 2000, Synolakis 1987, Okada 1985, Glasstone & Dolan
            1977, and others). See <em>Citations</em> in the header at any
            time.
          </p>
          <p className="modal__copy">
            Solver bathymetry uses a coarse basin-mean plus shelf-taper
            approximation, and inundation overlays are first-order discs from
            runup/slope estimates. Treat every map and export as approximate.
          </p>
          <div className="notice-grid" aria-label="Use guidance">
            <div className="notice-grid__item">
              <strong>Educational model</strong>
              <span>Useful for scenario exploration, classroom demos, and model intuition.</span>
            </div>
            <div className="notice-grid__item" data-tone="warning">
              <strong>Not a warning tool</strong>
              <span>Forecasting and evacuation guidance must come from official warning centres.</span>
            </div>
          </div>
          <p className="modal__copy modal__copy--muted">
            This notice is shown once. You can show it again from Settings.
          </p>
          <div className="modal__actions">
            <button className="primary" onClick={acknowledge}>I understand</button>
          </div>
        </div>
      </div>
    </div>
  );
}
