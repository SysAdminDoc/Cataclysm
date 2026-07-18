import { useEffect, useState } from "react";
import { settings } from "../lib/settings";
import type { UnitSystem } from "../lib/units";

export function useUnits(): UnitSystem {
  const [units, setUnits] = useState<UnitSystem>("metric");

  useEffect(() => {
    let cancelled = false;
    settings.getUnits().then((v) => {
      if (!cancelled) setUnits(v);
    });
    return () => { cancelled = true; };
  }, []);

  return units;
}
