import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import { getGlossaryEntry } from "../lib/glossary";

type Props = {
  term: string;
  children: ReactNode;
};

export function GlossaryTip({ term, children }: Props) {
  const entry = getGlossaryEntry(term);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const popupRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const clampPopup = useCallback(() => {
    const popup = popupRef.current;
    if (!popup) return;
    const rect = popup.getBoundingClientRect();
    if (rect.left < 4) {
      popup.style.left = "0";
      popup.style.transform = "none";
    } else if (rect.right > window.innerWidth - 4) {
      popup.style.left = "auto";
      popup.style.right = "0";
      popup.style.transform = "none";
    }
    if (rect.top < 4) {
      popup.style.bottom = "auto";
      popup.style.top = "calc(100% + 6px)";
    }
  }, []);

  useEffect(() => {
    if (open) clampPopup();
  }, [open, clampPopup]);

  if (!entry) return <>{children}</>;

  return (
    <span
      ref={ref}
      className="glossary-tip"
      tabIndex={0}
      aria-describedby={open ? `glossary-${term}` : undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      <span className="glossary-tip__indicator" aria-hidden>?</span>
      {open && (
        <span ref={popupRef} className="glossary-tip__popup" id={`glossary-${term}`} role="tooltip">
          <strong className="glossary-tip__term">{entry.term}</strong>
          <span className="glossary-tip__def">{entry.definition}</span>
          {entry.citation && (
            <span className="glossary-tip__cite">{entry.citation}</span>
          )}
        </span>
      )}
    </span>
  );
}
