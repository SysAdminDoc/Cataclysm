import { useEffect } from "react";

/**
 * Calls `onEscape` whenever the user presses the Escape key. Used to give
 * every modal a consistent close-on-Esc behaviour without each component
 * having to wire it up.
 */
export function useEscapeKey(onEscape: () => void, enabled: boolean = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onEscape();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, onEscape]);
}
