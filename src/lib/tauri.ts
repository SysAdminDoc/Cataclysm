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
import type { SurfaceProbe } from "./surface";
import type { BurstType, HazardResult, TargetType } from "../hazards";
import {
  RENDER_PROTOCOL_MAJOR,
  RENDER_PROTOCOL_MINOR,
  RenderReplayAdapter,
  ingestRenderRecording,
  type DecodedRenderPacket,
} from "../rendering/protocol";

export type RenderProtocolCapabilities = {
  protocol: { major: number; minor: number };
  minimum_reader_minor: number;
  features: string[];
  codecs: string[];
  maximum_header_bytes: number;
  maximum_payload_bytes: number;
  maximum_fields: number;
  maximum_cells: number;
};

function decodeRenderProtocolCapabilities(value: unknown): RenderProtocolCapabilities {
  if (!value || typeof value !== "object") throw new Error("invalid render protocol capabilities");
  const record = value as Record<string, unknown>;
  const protocol = record.protocol as Record<string, unknown> | undefined;
  if (
    protocol?.major !== RENDER_PROTOCOL_MAJOR ||
    typeof protocol.minor !== "number" ||
    protocol.minor < RENDER_PROTOCOL_MINOR ||
    !Array.isArray(record.features) ||
    !record.features.every((entry) => typeof entry === "string") ||
    !Array.isArray(record.codecs) ||
    !record.codecs.every((entry) => typeof entry === "string")
  ) throw new Error("backend returned incompatible render protocol capabilities");
  for (const key of [
    "minimum_reader_minor",
    "maximum_header_bytes",
    "maximum_payload_bytes",
    "maximum_fields",
    "maximum_cells",
  ]) {
    if (!Number.isSafeInteger(record[key]) || (record[key] as number) < 0) {
      throw new Error(`backend returned invalid render protocol capability ${key}`);
    }
  }
  return {
    protocol: { major: protocol.major as number, minor: protocol.minor },
    minimum_reader_minor: record.minimum_reader_minor as number,
    features: [...record.features] as string[],
    codecs: [...record.codecs] as string[],
    maximum_header_bytes: record.maximum_header_bytes as number,
    maximum_payload_bytes: record.maximum_payload_bytes as number,
    maximum_fields: record.maximum_fields as number,
    maximum_cells: record.maximum_cells as number,
  };
}

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
  simulateAsteroidHazard(req: {
    center: { lat: number; lon: number };
    diameter_m: number;
    density_kg_m3: number;
    velocity_km_s: number;
    angle_deg: number;
    target_type: TargetType;
    water_depth_m: number;
    beach_slope_rad: number;
  }) {
    return invoke<HazardResult>("simulate_asteroid_hazard", { req });
  },
  async simulateAsteroidHazardRender(req: {
    center: { lat: number; lon: number };
    diameter_m: number;
    density_kg_m3: number;
    velocity_km_s: number;
    angle_deg: number;
    target_type: TargetType;
    water_depth_m: number;
    beach_slope_rad: number;
  }): Promise<RenderReplayAdapter> {
    return ingestRenderRecording(await invoke<ArrayBuffer>("simulate_asteroid_hazard_render", { req }));
  },
  simulateNuclearHazard(req: {
    center: { lat: number; lon: number };
    yield_kt: number;
    burst_type: BurstType;
    height_m?: number;
    fission_pct: number;
    population_density: number;
  }) {
    return invoke<HazardResult>("simulate_nuclear_hazard", { req });
  },
  async simulateNuclearHazardRender(req: {
    center: { lat: number; lon: number };
    yield_kt: number;
    burst_type: BurstType;
    height_m?: number;
    fission_pct: number;
    population_density: number;
  }): Promise<RenderReplayAdapter> {
    return ingestRenderRecording(await invoke<ArrayBuffer>("simulate_nuclear_hazard_render", { req }));
  },
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
  async renderProtocolCapabilities(): Promise<RenderProtocolCapabilities> {
    return decodeRenderProtocolCapabilities(await invoke<unknown>("render_protocol_capabilities"));
  },
  surfaceProbe(req: { lat_deg: number; lon_deg: number }): Promise<SurfaceProbe> {
    return invoke<SurfaceProbe>("surface_probe", { req });
  },
  /** Cesium ion token in the OS keychain. `null` = no token stored. */
  keychainGetToken(): Promise<string | null> {
    return invoke<string | null>("keychain_get_token");
  },
  /** Empty string deletes the keychain entry. */
  keychainSetToken(token: string): Promise<void> {
    return invoke<void>("keychain_set_token", { token });
  },
  diagnosticsBundle(): Promise<{
    app_version: string;
    os: string;
    arch: string;
    gpu_status: string;
    gpu_adapter: string | null;
    solver: string;
    geodesy: Record<string, unknown>;
    surface_mask: Record<string, unknown>;
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
    onRenderPacket?: (packet: DecodedRenderPacket, replay: RenderReplayAdapter) => void,
  ): Promise<{
    dt_s: number;
    nx: number;
    ny: number;
    used_gpu: boolean;
    n_snapshots: number;
    max_field?: import("../types/scenario").MaxFieldProduct | null;
    render_scenario_id: string | null;
    render_frame_count: number;
    render_replay: RenderReplayAdapter;
  }> {
    const channel = new Channel<import("../types/scenario").GridSnapshot>();
    channel.onmessage = onSnapshot;
    const renderChannel = new Channel<ArrayBuffer>();
    const replay = new RenderReplayAdapter();
    let decodeChain = Promise.resolve();
    let decodeError: unknown = null;
    renderChannel.onmessage = (bytes) => {
      decodeChain = decodeChain
        .then(async () => {
          const packet = await replay.ingest(bytes);
          onRenderPacket?.(packet, replay);
        })
        .catch((error) => {
          decodeError ??= error;
        });
    };
    return invoke<{
      dt_s: number;
      nx: number;
      ny: number;
      used_gpu: boolean;
      n_snapshots: number;
      max_field?: import("../types/scenario").MaxFieldProduct | null;
      render_scenario_id: string | null;
      render_frame_count: number;
    }>("simulate_grid_streaming", { req, onSnapshot: channel, onRenderPacket: renderChannel })
      .then(async (meta) => {
        await decodeChain;
        if (decodeError) throw decodeError;
        if (!replay.complete || replay.frame_count !== meta.render_frame_count) {
          throw new Error("backend render stream ended without a complete matching replay");
        }
        return { ...meta, render_replay: replay };
      });
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
