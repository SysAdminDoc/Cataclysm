// Typed wrappers over tauri::invoke. One per Rust command in src-tauri/src/commands.rs.

import { invoke, Channel } from "@tauri-apps/api/core";
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
import type { ColormapId } from "./settings";

export type InspectAtPointResult = {
  range_m: number;
  offshore_amplitude_m: number;
  runup_m: number;
  arrival_time_s: number;
  has_arrived: boolean;
  inundation_extent_m: number;
};

export type DartRmseResult = {
  rmse_m: number;
  n_samples: number;
  observed_peak_m: number;
  model_peak_m: number;
};

export type LambWaveSampleResult = {
  range_m: number;
  arrival_time_s: number;
  pressure_pa: number;
  surface_depression_m: number;
  proudman_resonance_depth_m: number;
  lamb_wave_speed_m_s: number;
};

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
  }) {
    return invoke<{ amplitude_m: number; travel_time_s: number }>("far_field_amplitude", { req });
  },
  attenuationCurve(req: {
    initial_amplitude_m: number;
    cavity_radius_m: number;
    decay_alpha: number;
    max_range_m: number;
    n_samples: number;
  }) {
    return invoke<Array<{ range_m: number; amplitude_m: number }>>("attenuation_curve", { req });
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
  dartBuoyRmse(req: {
    buoy_lat: number;
    buoy_lon: number;
    observations: [number, number][];
    model_samples: [number, number][];
  }) {
    return invoke<DartRmseResult>("dart_buoy_rmse", { req });
  },
  lambWaveSample(req: {
    source: GeoPoint;
    lat: number;
    lon: number;
    time_s: number;
    peak_pressure_pa?: number;
    source_radius_m?: number;
  }) {
    return invoke<LambWaveSampleResult>("lamb_wave_sample", { req });
  },
  inspectAtPoint(req: {
    source: GeoPoint;
    initial_amplitude_m: number;
    cavity_radius_m: number;
    is_impact: boolean;
    mean_depth_m: number;
    time_s: number;
    click_lat: number;
    click_lon: number;
    beach_slope_deg: number;
    offshore_depth_m: number;
  }) {
    return invoke<InspectAtPointResult>("inspect_at_point", { req });
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
    include_lamb_wave?: boolean;
    lamb_wave_peak_pressure_pa?: number;
    lamb_wave_source_radius_m?: number;
    colormap?: ColormapId;
    gauge_points?: Array<{ id: string; lat_deg: number; lon_deg: number }>;
  }) {
    return invoke<SimulateGridResponse>("simulate_grid", { req });
  },
  /** F4-01 — Lightweight GPU-availability probe. Returns one of:
   *  "available", "no-adapter", or "feature-off". See the Rust
   *  `gpu_probe` command for full semantics. */
  gpuProbe(): Promise<"available" | "no-adapter" | "feature-off"> {
    return invoke<"available" | "no-adapter" | "feature-off">("gpu_probe");
  },
  diagnosticsBundle(): Promise<{
    app_version: string;
    os: string;
    arch: string;
    gpu_status: string;
    gpu_adapter: string | null;
    solver: string;
  }> {
    return invoke("diagnostics_bundle");
  },
  simulateGridStreaming(
    req: {
      source: GeoPoint;
      initial_amplitude_m: number;
      source_sigma_m: number;
      mean_depth_m: number;
      use_real_bathymetry?: boolean;
      box_half_size_deg: number;
      cells_per_deg: number;
      t_end_s: number;
      n_snapshots: number;
      include_lamb_wave?: boolean;
      lamb_wave_peak_pressure_pa?: number;
      lamb_wave_source_radius_m?: number;
      colormap?: ColormapId;
      gauge_points?: Array<{ id: string; lat_deg: number; lon_deg: number }>;
    },
    onSnapshot: (snap: import("../types/scenario").GridSnapshot) => void,
  ): Promise<{
    dt_s: number;
    nx: number;
    ny: number;
    used_gpu: boolean;
    n_snapshots: number;
    max_field?: import("../types/scenario").MaxFieldProduct | null;
  }> {
    const channel = new Channel<import("../types/scenario").GridSnapshot>();
    channel.onmessage = onSnapshot;
    return invoke("simulate_grid_streaming", { req, onSnapshot: channel });
  },
  cancelSimulation() {
    return invoke<void>("cancel_simulation");
  },
};

/**
 * Detect whether we are running inside Tauri (vs vite-only browser preview).
 * Used to short-circuit IPC calls in the browser preview.
 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
