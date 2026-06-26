import { useRef } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { isTauri } from "../lib/tauri";
import type { Preset } from "../types/scenario";
import { UiIcon } from "./UiIcon";

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
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);
  const speculativeCount = presets.filter((p) => p.is_speculative).length;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" ref={dialogRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="citations-title">
        <header className="modal__header">
          <h2 id="citations-title">Citations & references</h2>
          <button onClick={onClose} aria-label="Close" className="modal__close" type="button">
            <UiIcon name="close" size={16} />
          </button>
        </header>
        <div className="modal__body">
          <p className="modal__intro">
            Every preset keeps its citation visible. References open externally
            so the model assumptions can be checked against the source material.
          </p>
          <div className="citations__summary" aria-label="Citation summary">
            <span><strong>{presets.length}</strong> preset references</span>
            <span><strong>{speculativeCount}</strong> speculative cases flagged</span>
          </div>
          <ul className="citations">
            {presets.map((p) => (
              <li key={p.id} className="citations__row">
                <div className="citations__name">
                  {p.is_speculative && <span className="citations__tag">Speculative</span>}
                  <span>{p.name}</span>
                  <span className="citations__date">{p.date}</span>
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
                      <span>{p.reference}</span>
                      <span className="citations__open">Open</span>
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
