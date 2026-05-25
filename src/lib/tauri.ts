// Typed wrappers over tauri::invoke. One per Rust command in src-tauri/src/commands.rs.

import { invoke } from "@tauri-apps/api/core";
import type {
  AsteroidImpactInput,
  CoastalPoint,
  EarthquakeInput,
  GeoPoint,
  InitialDisplacement,
  LandslideInput,
  NuclearBurstInput,
  Preset,
  RunPresetResponse,
  SimulateGridResponse,
} from "../types/scenario";

export type RunupAtPointResult = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  range_m: number;
  offshore_amplitude_m: number;
  runup_m: number;
  arrival_time_s: number;
  has_arrived: boolean;
  inundation_extent_m: number;
};

export const api = {
  asteroidInitialConditions(input: AsteroidImpactInput) {
    return invoke<InitialDisplacement>("asteroid_initial_conditions", { input });
  },
  nuclearInitialConditions(input: NuclearBurstInput) {
    return invoke<InitialDisplacement>("nuclear_initial_conditions", { input });
  },
  landslideInitialConditions(input: LandslideInput) {
    return invoke<InitialDisplacement>("landslide_initial_conditions", { input });
  },
  earthquakeInitialConditions(input: EarthquakeInput) {
    return invoke<InitialDisplacement>("earthquake_initial_conditions", { input });
  },
  farFieldAmplitude(req: {
    initial_amplitude_m: number;
    cavity_radius_m: number;
    range_m: number;
    mean_depth_m: number;
    decay_alpha: number;
    is_impact: boolean;
  }) {
    return invoke<{ amplitude_m: number; travel_time_s: number }>("far_field_amplitude", { req });
  },
  coastalRunup(req: {
    offshore_amplitude_m: number;
    offshore_depth_m: number;
    beach_slope_deg: number;
  }) {
    return invoke<number>("coastal_runup", { req });
  },
  runupAtPoints(req: {
    source: GeoPoint;
    initial_amplitude_m: number;
    cavity_radius_m: number;
    is_impact: boolean;
    mean_depth_m: number;
    time_s: number;
    points: CoastalPoint[];
  }) {
    return invoke<RunupAtPointResult[]>("runup_at_points", { req });
  },
  listPresets() {
    return invoke<Preset[]>("list_presets");
  },
  runPreset(req: {
    preset_id: string;
    time_s: number;
    /** Pass 0 to let the backend pick from the preset's source water depth. */
    mean_depth_m: number;
    n_samples: number;
  }) {
    return invoke<RunPresetResponse>("run_preset", { req });
  },
  simulateGrid(req: {
    source: GeoPoint;
    initial_amplitude_m: number;
    source_sigma_m: number;
    mean_depth_m: number;
    use_real_bathymetry?: boolean;
    box_half_size_deg: number;
    cells_per_deg: number;
    t_end_s: number;
    n_snapshots: number;
  }) {
    return invoke<SimulateGridResponse>("simulate_grid", { req });
  },
};

/**
 * Detect whether we are running inside Tauri (vs vite-only browser preview).
 * Used to short-circuit IPC calls in the browser preview.
 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
