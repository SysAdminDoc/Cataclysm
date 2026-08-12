import { sourceBound, sourceNumericDefault } from "./scenario-schema";
import { browserAsteroidDeflection } from "./browser-physics";
import { api, isTauri } from "./tauri";
import type {
  AsteroidDeflectionEstimate,
  AsteroidDeflectionInput,
  AsteroidImpactInput,
} from "../types/scenario";

export const INITIAL_ASTEROID_DEFLECTION: Pick<AsteroidDeflectionInput, "impulse_n_s" | "lead_time_days"> = {
  impulse_n_s: sourceNumericDefault("AsteroidDeflection", "impulse_n_s"),
  lead_time_days: sourceNumericDefault("AsteroidDeflection", "lead_time_days"),
};

export const ASTEROID_DEFLECTION_BOUNDS = {
  impulse_n_s: sourceBound("AsteroidDeflection", "impulse_n_s"),
  lead_time_days: sourceBound("AsteroidDeflection", "lead_time_days"),
};

/**
 * Runs the same Rust model in the desktop command or the browser WASM ABI.
 * The deflection state is intentionally separate from the saved impact input.
 */
export function estimateAsteroidDeflection(
  asteroid: AsteroidImpactInput,
  deflection: Pick<AsteroidDeflectionInput, "impulse_n_s" | "lead_time_days">,
): Promise<AsteroidDeflectionEstimate> {
  const input: AsteroidDeflectionInput = {
    diameter_m: asteroid.diameter_m,
    density_kg_m3: asteroid.density_kg_m3,
    ...deflection,
  };
  return isTauri()
    ? api.asteroidDeflectionEstimate(input)
    : browserAsteroidDeflection(input);
}
