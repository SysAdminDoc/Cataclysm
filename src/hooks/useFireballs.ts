import { useEffect, useState } from "react";
import type { FireballEvent } from "../types/jpl";
import { loadFireballs } from "../lib/jpl";

export function useFireballs(enabled: boolean) {
  const [events, setEvents] = useState<FireballEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || events.length) return;
    let cancelled = false;
    setLoading(true);
    setNotice(null);
    void loadFireballs()
      .then((result) => {
        if (cancelled) return;
        setEvents(result.events);
        setNotice(result.notice);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, events.length]);

  return { events, loading, notice };
}
