// Typed wrappers over tauri::invoke. One per Rust command in src-tauri/src/commands.rs.

import { invoke, Channel } from "@tauri-apps/api/core";
import type {
  AsteroidImpactInput,
  CoastalMeasurementProvenance,
  EarthquakeInput,
  GeoPoint,
  InitialDisplacement,
  InitialSourceGeometry,
  LandslideInput,
  MeteotsunamiInput,
  NuclearBurstInput,
  Preset,
  PropagationSnapshot,
  RunPresetResponse,
  SimulateGridResponse,
} from "../types/scenario";
import type { HazelEventSearchRequest, HazelEventSearchResponse } from "./ncei-hazel";
import type { ColormapId } from "./settings";
import type { SurfaceProbe } from "./surface";
import type {
  AsteroidVisualReport,
  BurstType,
  DirectHazardProbeResult,
  HazardResult,
  NuclearShelterReport,
  TargetType,
} from "../hazards";
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

export type NativePanicRecord = {
  schema_version: number;
  id: string;
  app_version: string;
  timestamp_ms: number;
  message: string;
  location: {
    file: string;
    line: number;
    column: number;
  } | null;
};

export type BathymetrySampleSemantics = "depth_positive_down" | "elevation_positive_up";

export type BathymetryPreflight = {
  format: "geo_tiff" | "net_cdf";
  file_name: string;
  file_size_bytes: number;
  sha256: string;
  source_label: string;
  rights_statement: string;
  variable: string;
  width: number;
  height: number;
  bounds_wgs84: [number, number, number, number];
  resolution_deg: [number, number];
  horizontal_crs: "EPSG:4326";
  vertical_datum: string;
  units: "m";
  sample_semantics: BathymetrySampleSemantics;
  nodata: number | null;
  valid_cell_count: number;
  nodata_cell_count: number;
  wet_cell_count: number;
  dry_cell_count: number;
  min_depth_m: number;
  max_depth_m: number;
  warnings: string[];
};

export type BathymetryPreflightRequest = {
  path: string;
  variable?: string | null;
  source_label: string;
  rights_statement: string;
  sample_semantics: BathymetrySampleSemantics;
};

export type ImportedBathymetryAsset = {
  schema_version: number;
  asset_id: string;
  imported_at_ms: number;
  cache_file: string;
  report: BathymetryPreflight;
};

export type SolverCheckpointSummary = {
  run_id: string;
  scenario_sha256: string;
  solver_version: string;
  created_at_ms: number;
  time_s: number;
  t_end_s: number;
  step_index: number;
};

export type RecoveredGaugeHistoryFrame = {
  time_s: number;
  gauge_samples: Array<{ id: string; eta_m: number | null }>;
};

let simulationRunSequence = 0;

type RenderReplayCompletion = Pick<RenderReplayAdapter, "complete" | "frame_count">;

export async function waitForRenderReplay(
  replay: RenderReplayCompletion,
  expectedFrameCount: number,
  currentDecode: () => Promise<void>,
  currentError: () => unknown,
  timeoutMs = 120_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    // Channel delivery and packet decoding may enqueue a newer chain while the
    // Rust command result is already resolving. Re-read it on every turn.
    await currentDecode();
    const error = currentError();
    if (error) throw error;
    if (replay.complete) {
      if (replay.frame_count !== expectedFrameCount) {
        throw new Error(
          `backend render stream completed with ${replay.frame_count} frames; expected ${expectedFrameCount}`,
        );
      }
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error("timed out waiting for the backend render stream to complete");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 8));
  }
}

export function createSimulationRunId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `run-${crypto.randomUUID()}`;
  }
  simulationRunSequence += 1;
  return `run-${Date.now()}-${simulationRunSequence}`;
}

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
  governing_model?: string;
  citations?: string[];
  assumptions?: string[];
  confidence?: "illustrative" | "screening_estimate" | "quantitative";
  unknowns?: string[];
};

export type DartRmseResult = {
  rmse_m: number | null;
  n_samples: number;
  overlap_start_s: number | null;
  overlap_end_s: number | null;
  observed_peak_m: number;
  model_peak_m: number;
  noise_floor_m: number;
  noise_method: string;
  arrival_threshold_m: number;
  arrival_method: string;
  observed_arrival_s: number | null;
  model_arrival_s: number | null;
  arrival_residual_s: number | null;
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
  beach_slope_deg: number;
  offshore_depth_m: number;
  slope_provenance: CoastalMeasurementProvenance;
  depth_provenance: CoastalMeasurementProvenance;
  quantitative_confidence: "low" | "medium" | "high";
  quantitative_label: "illustrative" | "screening_estimate" | "quantitative";
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
  meteotsunamiInitialConditions(input: MeteotsunamiInput) {
    return invoke<InitialDisplacement>("meteotsunami_initial_conditions", { input });
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
    point_ids: string[];
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
  samplePresetWavefront(presetId: string, timeS: number, nSamples: number) {
    return invoke<PropagationSnapshot>("sample_preset_wavefront", {
      preset_id: presetId, time_s: timeS, n_samples: nSamples,
    });
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
  probeDirectHazard(req: {
    result_id: string;
    click_lat: number;
    click_lon: number;
  }) {
    return invoke<DirectHazardProbeResult>("probe_direct_hazard", { req });
  },
  nuclearShelterAdvisor(resultId: string) {
    return invoke<NuclearShelterReport>("nuclear_shelter_advisor", { resultId });
  },
  asteroidResultVisuals(resultId: string) {
    return invoke<AsteroidVisualReport>("asteroid_result_visuals", { resultId });
  },
  jplApiRequest(endpoint: "fireball" | "sbdb" | "sentry" | "cad", params: Record<string, string>) {
    return invoke<unknown>("jpl_api_request", { req: { endpoint, params } });
  },
  nceiHazelSearch(req: HazelEventSearchRequest) {
    return invoke<HazelEventSearchResponse>("ncei_hazel_search", { req });
  },
  simulateGrid(req: {
    source: GeoPoint;
    initial_amplitude_m: number;
    source_sigma_m: number;
    source_geometry?: InitialSourceGeometry | null;
    mean_depth_m: number;
    use_real_bathymetry?: boolean;
    bathymetry_asset_id?: string | null;
    box_half_size_deg: number;
    cells_per_deg: number;
    t_end_s: number;
    n_snapshots: number;
    include_lamb_wave?: boolean;
    lamb_wave_peak_pressure_pa?: number;
    lamb_wave_source_radius_m?: number;
    meteotsunami_forcing?: MeteotsunamiInput | null;
    colormap?: ColormapId;
    gauge_points?: Array<{ id: string; lat_deg: number; lon_deg: number }>;
    boundary_mode?: "sponge" | "radiation" | "zero_flux";
  }, runId: string = createSimulationRunId()) {
    // Thread a caller-supplied runId so this non-streaming path is cancellable
    // via cancelSimulation(runId); previously the id was generated inline and
    // discarded, leaving the registered cancel token unreachable.
    return invoke<SimulateGridResponse>("simulate_grid", { runId, req });
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
  preflightBathymetryImport(req: BathymetryPreflightRequest): Promise<BathymetryPreflight> {
    return invoke<BathymetryPreflight>("preflight_bathymetry_import", { req });
  },
  importBathymetry(
    req: BathymetryPreflightRequest,
    expectedSha256: string,
  ): Promise<ImportedBathymetryAsset> {
    return invoke<ImportedBathymetryAsset>("import_bathymetry", {
      req,
      expectedSha256,
    });
  },
  listImportedBathymetry(): Promise<ImportedBathymetryAsset[]> {
    return invoke<ImportedBathymetryAsset[]>("list_imported_bathymetry");
  },
  removeImportedBathymetry(assetId: string): Promise<void> {
    return invoke<void>("remove_imported_bathymetry", { assetId });
  },
  restoreImportedBathymetry(assetId: string): Promise<ImportedBathymetryAsset> {
    return invoke<ImportedBathymetryAsset>("restore_imported_bathymetry", { assetId });
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
    last_run_quality: import("../types/scenario").RunQualityRecord | null;
    active_solver_runs: number;
    solver_reserved_memory_bytes: number;
    solver_memory_budget_bytes: number;
  }> {
    return invoke("diagnostics_bundle");
  },
  nativePanicRecord(): Promise<NativePanicRecord | null> {
    return invoke<NativePanicRecord | null>("native_panic_record");
  },
  acknowledgeNativePanicRecord(recordId: string): Promise<void> {
    return invoke<void>("acknowledge_native_panic_record", { recordId });
  },
  thirdPartyNotices(): Promise<string> {
    return invoke<string>("third_party_notices");
  },
  simulateGridStreaming(
    runId: string,
    req: {
      source: GeoPoint;
      initial_amplitude_m: number;
      source_sigma_m: number;
      source_geometry?: InitialSourceGeometry | null;
      mean_depth_m: number;
      use_real_bathymetry?: boolean;
      bathymetry_asset_id?: string | null;
      box_half_size_deg: number;
      cells_per_deg: number;
      t_end_s: number;
      n_snapshots: number;
      include_lamb_wave?: boolean;
      lamb_wave_peak_pressure_pa?: number;
      lamb_wave_source_radius_m?: number;
      meteotsunami_forcing?: MeteotsunamiInput | null;
      colormap?: ColormapId;
      gauge_points?: Array<{ id: string; lat_deg: number; lon_deg: number }>;
      boundary_mode?: "sponge" | "radiation" | "zero_flux";
    },
    onSnapshot: (snap: import("../types/scenario").GridSnapshot) => void,
    onRenderPacket?: (packet: DecodedRenderPacket, replay: RenderReplayAdapter) => void,
    resumeRunId: string | null = null,
    checkpointIntervalSeconds = 60,
  ): Promise<{
    run_id: string;
    lifecycle: "completed" | "cancelled";
    dt_s: number;
    nx: number;
    ny: number;
    bathymetry_asset_id?: string | null;
    used_gpu: boolean;
    n_snapshots: number;
    cancelled: boolean;
    max_field?: import("../types/scenario").MaxFieldProduct | null;
    scientific_export?: import("../types/scenario").ScientificExportDescriptor | null;
    scientific_export_error?: string | null;
    run_quality: import("../types/scenario").RunQualityRecord;
    render_scenario_id: string | null;
    render_frame_count: number;
    recovered_gauge_history: RecoveredGaugeHistoryFrame[];
    render_replay: RenderReplayAdapter;
  }> {
    const channel = new Channel<import("../types/scenario").GridSnapshot>();
    channel.onmessage = onSnapshot;
    const renderChannel = new Channel<ArrayBuffer | Uint8Array | number[]>();
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
      run_id: string;
      lifecycle: "completed" | "cancelled";
      dt_s: number;
      nx: number;
      ny: number;
      bathymetry_asset_id?: string | null;
      used_gpu: boolean;
      n_snapshots: number;
      cancelled: boolean;
      max_field?: import("../types/scenario").MaxFieldProduct | null;
      scientific_export?: import("../types/scenario").ScientificExportDescriptor | null;
      scientific_export_error?: string | null;
      run_quality: import("../types/scenario").RunQualityRecord;
      render_scenario_id: string | null;
      render_frame_count: number;
      recovered_gauge_history: RecoveredGaugeHistoryFrame[];
    }>("simulate_grid_streaming", {
      runId,
      resumeRunId,
      checkpointIntervalS: checkpointIntervalSeconds,
      req,
      onSnapshot: channel,
      onRenderPacket: renderChannel,
    })
      .then(async (meta) => {
        if (meta.cancelled) {
          // A cancelled run may have counted a frame the channel never
          // delivered; drain any in-flight decode and return promptly instead of
          // busy-polling to the 120 s deadline on a frame-count mismatch.
          await decodeChain.catch(() => {});
          return { ...meta, render_replay: replay };
        }
        await waitForRenderReplay(
          replay,
          meta.render_frame_count,
          () => decodeChain,
          () => decodeError,
        );
        return { ...meta, render_replay: replay };
      });
  },
  cancelSimulation(runId: string) {
    return invoke<boolean>("cancel_simulation", { runId });
  },
  listSolverCheckpoints() {
    return invoke<SolverCheckpointSummary[]>("list_solver_checkpoints");
  },
  removeSolverCheckpoint(runId: string) {
    return invoke<boolean>("remove_solver_checkpoint", { runId });
  },
  saveScientificExport(exportId: string, destination: string, exportKind: "netcdf" | "zarr" = "netcdf") {
    return invoke<number>("save_scientific_export", { exportId, destination, exportKind });
  },
};

/**
 * Detect whether we are running inside Tauri (vs vite-only browser preview).
 * Used to short-circuit IPC calls in the browser preview.
 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
