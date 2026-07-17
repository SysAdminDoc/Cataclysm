import { useState, useRef, useEffect, useCallback, useId, type ReactNode } from "react";
import { getGlossaryEntry } from "../lib/glossary";

type Props = {
  term: string;
  children: ReactNode;
};

export function GlossaryTip({ term, children }: Props) {
  const entry = getGlossaryEntry(term);
  const tooltipId = `${useId()}-glossary-tooltip`;
  const [open, setOpen] = useState(false);
  const [horizontal, setHorizontal] = useState<"center" | "left" | "right">("center");
  const [vertical, setVertical] = useState<"above" | "below">("above");
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
    const anchor = ref.current;
    if (!popup || !anchor) return;
    const anchorRect = anchor.getBoundingClientRect();
    const centeredLeft = anchorRect.left + anchorRect.width / 2 - popup.offsetWidth / 2;
    const centeredRight = centeredLeft + popup.offsetWidth;
    setHorizontal(centeredLeft < 4 ? "left" : centeredRight > window.innerWidth - 4 ? "right" : "center");
    setVertical(anchorRect.top - popup.offsetHeight - 6 < 4 ? "below" : "above");
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
      aria-describedby={open ? tooltipId : undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      <span className="glossary-tip__indicator" aria-hidden>?</span>
      {open && (
        <span
          ref={popupRef}
          className="glossary-tip__popup"
          data-horizontal={horizontal}
          data-vertical={vertical}
          id={tooltipId}
          role="tooltip"
        >
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
