import { useState, useRef, useEffect, type ReactNode } from "react";
import { getGlossaryEntry } from "../lib/glossary";

type Props = {
  term: string;
  children: ReactNode;
};

export function GlossaryTip({ term, children }: Props) {
  const entry = getGlossaryEntry(term);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!entry) return <>{children}</>;

  return (
    <span
      ref={ref}
      className="glossary-tip"
      tabIndex={0}
      role="button"
      aria-describedby={open ? `glossary-${term}` : undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      <span className="glossary-tip__indicator" aria-hidden>?</span>
      {open && (
        <span className="glossary-tip__popup" id={`glossary-${term}`} role="tooltip">
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
