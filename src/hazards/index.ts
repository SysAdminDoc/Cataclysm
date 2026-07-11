// Cataclysm hazard registry. New standalone hazard engines (client-side,
// non-tsunami) register here so the UI can enumerate them. Tsunami sources
// remain routed through the Rust SWE backend via the existing scenario path.

export * from "./types";
export { asteroidEngine } from "./asteroid";
export type { AsteroidInput } from "./asteroid";
export { nuclearEngine, WEAPON_PRESETS } from "./nuclear";
export type { NuclearInput, WeaponPreset } from "./nuclear";

import { asteroidEngine } from "./asteroid";
import { nuclearEngine } from "./nuclear";
import type { HazardEngine } from "./types";

/** Standalone (client-side physics) hazard engines. */
export const HAZARD_ENGINES = {
  asteroid: asteroidEngine,
  nuclear: nuclearEngine,
} satisfies Record<string, HazardEngine<never>>;
