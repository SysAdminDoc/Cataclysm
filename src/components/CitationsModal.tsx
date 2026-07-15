import { useRef, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { validateCitationUrl, type ExternalUrlValidation } from "../lib/external-links";
import { api, isTauri } from "../lib/tauri";
import type { Preset } from "../types/scenario";
import { UiIcon } from "./UiIcon";

type Props = {
  presets: Preset[];
  onClose: () => void;
};

function validationMessage(validation: ExternalUrlValidation) {
  return validation.ok ? undefined : `Blocked citation link. ${validation.reason}`;
}

function openUrl(url: string, onBlocked: (message: string) => void) {
  const validation = validateCitationUrl(url);
  if (!validation.ok) {
    onBlocked(validationMessage(validation) ?? "Blocked citation link.");
    return;
  }

  if (isTauri()) {
    openExternal(validation.url).catch((err) => {
      console.error("shell open failed", err);
      onBlocked("Citation link could not be opened by the desktop shell policy.");
    });
  } else {
    window.open(validation.url, "_blank", "noopener,noreferrer");
  }
}

export function CitationsModal({ presets, onClose }: Props) {
  useEscapeKey(onClose);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);
  const [linkAlert, setLinkAlert] = useState<string | null>(null);
  const [notices, setNotices] = useState<string | null>(null);
  const [noticesError, setNoticesError] = useState<string | null>(null);
  const [noticesLoading, setNoticesLoading] = useState(false);
  const speculativeCount = presets.filter((p) => p.is_speculative).length;

  async function showThirdPartyNotices() {
    if (!isTauri()) return;
    setNoticesLoading(true);
    setNoticesError(null);
    try {
      setNotices(await api.thirdPartyNotices());
    } catch (error) {
      console.error("third-party notices could not be loaded", error);
      setNoticesError("The bundled third-party notices could not be read. Reinstall Cataclysm and try again.");
    } finally {
      setNoticesLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" ref={dialogRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="citations-title">
        <header className="modal__header">
          <h2 id="citations-title">
            {notices ? "Third-party dependency notices" : "References & provenance"}
          </h2>
          <button onClick={onClose} aria-label="Close" className="modal__close" type="button">
            <UiIcon name="close" size={16} />
          </button>
        </header>
        <div className="modal__body">
          {notices ? (
            <>
              <div className="citations__notice-actions">
                <button className="secondary" type="button" onClick={() => setNotices(null)}>
                  Back to references
                </button>
                <span>Bundled with this installed Cataclysm package</span>
              </div>
              <pre className="citations__notices" tabIndex={0}>{notices}</pre>
            </>
          ) : (
          <>
          <p className="modal__intro">
            Every preset keeps its citation visible. References open externally
            so the model assumptions can be checked against the source material.
          </p>
          <div className="citations__summary" aria-label="Citation summary">
            <span><strong>{presets.length}</strong> preset references</span>
            <span><strong>{speculativeCount}</strong> speculative cases flagged</span>
          </div>
          {linkAlert && (
            <div className="citations__alert" role="alert">
              {linkAlert}
            </div>
          )}
          <ul className="citations">
            {presets.map((p) => {
              const validation = validateCitationUrl(p.reference_url);
              return (
                <li key={p.id} className="citations__row">
                  <div className="citations__name">
                    {p.is_speculative && <span className="citations__tag">Speculative</span>}
                    <span>{p.name}</span>
                    <span className="citations__date">{p.date}</span>
                  </div>
                  <div className="citations__ref">
                    {p.reference_url && validation.ok ? (
                      <a
                        href={validation.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => {
                          e.preventDefault();
                          openUrl(validation.url, setLinkAlert);
                        }}
                      >
                        <span>{p.reference}</span>
                        {validation.legacyHttp && <span className="citations__legacy">Legacy HTTP</span>}
                        <span className="citations__open">Open</span>
                      </a>
                    ) : p.reference_url ? (
                      <button
                        className="citations__blocked"
                        type="button"
                        onClick={() => setLinkAlert(validationMessage(validation) ?? "Blocked citation link.")}
                      >
                        <span>{p.reference}</span>
                        <span className="citations__open" data-tone="blocked">Blocked</span>
                      </button>
                    ) : (
                      p.reference
                    )}
                  </div>
                  {p.controversy_note && (
                    <div className="citations__note">{p.controversy_note}</div>
                  )}
                </li>
              );
            })}
          </ul>
          <hr className="modal__sep" />
          <p className="modal__footnote">
            Full BibTeX in <code>docs/science/REFERENCES.bib</code>. Source-code
            formulas live under <code>src-tauri/src/physics/</code> with
            per-module citation blocks.
          </p>
          <div className="citations__notice-entry">
            <div>
              <strong>Third-party dependency notices</strong>
              <span>
                Exact production dependency versions, SPDX identifiers, source links, and required license texts.
              </span>
            </div>
            <button
              className="secondary"
              type="button"
              disabled={!isTauri() || noticesLoading}
              onClick={() => void showThirdPartyNotices()}
            >
              {noticesLoading ? "Loading notices…" : "View third-party notices"}
            </button>
          </div>
          {!isTauri() && (
            <p className="citations__notice-help">Notices are available in installed desktop packages.</p>
          )}
          {noticesError && <div className="citations__alert" role="alert">{noticesError}</div>}
          </>
          )}
        </div>
      </div>
    </div>
  );
}
