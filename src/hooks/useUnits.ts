import { useEffect, useState } from "react";
import { settings } from "../lib/settings";
import type { UnitSystem } from "../lib/units";

export function useUnits(): UnitSystem {
  const [units, setUnits] = useState<UnitSystem>("metric");

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      let nextUnits: UnitSystem = "metric";
      try {
        if (typeof settings.getUnits === "function") {
          nextUnits = await settings.getUnits();
        }
      } catch {
        // Persisted settings are optional UI state; retain the safe metric default.
      }
      if (!cancelled) setUnits(nextUnits);
    };
    void refresh();
    const handleSettingsSaved = () => { void refresh(); };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === "tsunamisim.units") void refresh();
    };
    window.addEventListener("tsunamisim:settings-saved", handleSettingsSaved);
    window.addEventListener("storage", handleStorage);
    return () => {
      cancelled = true;
      window.removeEventListener("tsunamisim:settings-saved", handleSettingsSaved);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  return units;
}
