import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { isTauri } from "../lib/tauri";
import type { Preset } from "../types/scenario";

type Props = {
  presets: Preset[];
  onClose: () => void;
};

function openUrl(url: string) {
  if (isTauri()) {
    openExternal(url).catch((err) => console.error("shell open failed", err));
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export function CitationsModal({ presets, onClose }: Props) {
  useEscapeKey(onClose);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="citations-title">
        <header className="modal__header">
          <h2 id="citations-title">Citations & references</h2>
          <button onClick={onClose} aria-label="Close" className="modal__close">×</button>
        </header>
        <div className="modal__body">
          <p className="modal__intro">
            Every preset cites a peer-reviewed paper. Click a reference to open
            the publisher page in your browser.
          </p>
          <ul className="citations">
            {presets.map((p) => (
              <li key={p.id} className="citations__row">
                <div className="citations__name">
                  {p.is_speculative && <span className="citations__tag">Speculative</span>}
                  {p.name} <span className="citations__date">— {p.date}</span>
                </div>
                <div className="citations__ref">
                  {p.reference_url ? (
                    <a
                      href={p.reference_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => {
                        e.preventDefault();
                        openUrl(p.reference_url!);
                      }}
                    >
                      {p.reference}
                    </a>
                  ) : (
                    p.reference
                  )}
                </div>
                {p.controversy_note && (
                  <div className="citations__note">{p.controversy_note}</div>
                )}
              </li>
            ))}
          </ul>
          <hr className="modal__sep" />
          <p className="modal__footnote">
            Full BibTeX in <code>docs/science/REFERENCES.bib</code>. Source-code
            formulas live under <code>src-tauri/src/physics/</code> with
            per-module citation blocks.
          </p>
        </div>
      </div>
    </div>
  );
}
