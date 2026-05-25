import { useEffect, useState } from "react";
import { settings } from "../lib/settings";

/**
 * Shown once on first launch. After acknowledgement the timestamp is stored
 * in settings so the modal never appears again on subsequent runs.
 */
export function FirstRunDisclaimer() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    settings.getDisclaimerAcknowledged().then((ack) => {
      setOpen(ack === null);
    });
  }, []);

  if (!open) return null;

  async function acknowledge() {
    await settings.acknowledgeDisclaimer();
    setOpen(false);
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <header className="modal__header">
          <h2>Welcome to TsunamiSimulator</h2>
        </header>
        <div className="modal__body">
          <p>
            <strong>TsunamiSimulator is an educational physics-visualization tool.</strong>
            {" "}
            It is <strong>NOT</strong> for evacuation planning, hazard
            forecasting, or any operational decision-making.
          </p>
          <p style={{ marginTop: 12 }}>
            For real tsunami warnings, contact your national tsunami warning
            centre — for example,{" "}
            <strong>NOAA NTWC (Atlantic) / PTWC (Pacific)</strong>,{" "}
            <strong>JMA (Japan)</strong>, or{" "}
            <strong>IOC/UNESCO ICG-NEAMTWS (Mediterranean & NE Atlantic)</strong>.
          </p>
          <p style={{ marginTop: 12 }}>
            All physics in this app comes from peer-reviewed literature
            (Ward & Asphaug 2000, Synolakis 1987, Okada 1985, Glasstone & Dolan
            1977, and others). See <em>Citations</em> in the header at any
            time. Inevitably this means accepting limitations: linear-long-wave
            approximations, simplified runup, no atmospheric coupling (yet).
          </p>
          <p style={{ marginTop: 14, fontSize: 12, color: "var(--subtext)" }}>
            This notice is shown once. Click <em>Got it</em> below to continue.
          </p>
          <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end" }}>
            <button className="primary" onClick={acknowledge}>Got it</button>
          </div>
        </div>
      </div>
    </div>
  );
}
