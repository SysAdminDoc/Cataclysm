// Types that mirror the Rust serde structs in src-tauri/src/physics + presets.
import type { HeightFieldMetadata } from "../lib/geodesy";

export type GeoPoint = {
  lat_deg: number;
  lon_deg: number;
  depth_m?: number;
};

export type CameraView = {
  heading_deg: number;
  pitch_deg: number;
  range_m: number;
};

export type InitialSourceGeometry =
  | { kind: "cavity_ring"; rim_radius_m: number; rim_width_m: number }
  | {
    kind: "landslide";
    axis_azimuth_deg: number;
    longitudinal_sigma_m: number;
    transverse_sigma_m: number;
  }
  | {
    kind: "okada";
    fault: {
      center_lat: number;
      center_lon: number;
      depth_m: number;
      length_m: number;
      width_m: number;
      strike_deg: number;
      dip_deg: number;
      rake_deg: number;
      slip_m: number;
    };
  };

export type InitialDisplacement = {
  center: GeoPoint;
  cavity_radius_m: number;
  peak_amplitude_m: number;
  source_energy_j: number;
  seismic_mw_equivalent: number;
  dominant_wavelength_m?: number | null;
  label: string;
  /** Optional order-of-magnitude "how often" context for the source (e.g. a
   * Gutenberg–Richter recurrence estimate for a tectonic earthquake). */
  recurrence_note?: string | null;
  /** Optional curated camera framing populated by `run_preset` for
   * historical presets. Custom scenarios leave this `null`/undefined and
   * the frontend falls back to its heuristic auto-clamp. */
  camera_view?: CameraView | null;
  /** Source-specific t=0 geometry consumed by the SWE solver. Older saved
   * responses omit it and retain the circular-Gaussian fallback. */
  source_geometry?: InitialSourceGeometry | null;
  /** Time-dependent atmospheric-pressure source applied by the SWE solver. */
  meteotsunami_forcing?: MeteotsunamiInput | null;
};

export type AsteroidImpactInput = {
  diameter_m: number;
  density_kg_m3: number;
  velocity_m_s: number;
  angle_deg: number;
  water_depth_m: number;
  location: GeoPoint;
};

export type NuclearBurstInput = {
  yield_kt: number;
  burst_mode: "Surface" | "Shallow" | "DeepOptimal" | "Abyssal";
  burst_depth_m: number;
  water_depth_m: number;
  location: GeoPoint;
};

export type LandslideKind = "Subaerial" | "Submarine";

export type LandslideInput = {
  kind: LandslideKind;
  volume_m3: number;
  density_kg_m3: number;
  drop_height_m: number;
  slope_deg: number;
  water_depth_m: number;
  water_body_width_m: number;
  location: GeoPoint;
};

export type EarthquakeInput = {
  mw: number;
  depth_m: number;
  strike_deg: number;
  dip_deg: number;
  rake_deg: number;
  slip_m: number;
  /** Pass 0 to derive from Wells–Coppersmith 1994 scaling. */
  fault_length_m?: number;
  /** Pass 0 to derive from Wells–Coppersmith 1994 scaling. */
  fault_width_m?: number;
  water_depth_m: number;
  location: GeoPoint;
};

export type MeteotsunamiInput = {
  peak_pressure_pa: number;
  speed_m_s: number;
  heading_deg: number;
  along_track_sigma_m: number;
  cross_track_sigma_m: number;
  track_length_m: number;
  water_depth_m: number;
  location: GeoPoint;
};

export type PresetSource =
  | { kind: "Asteroid"; source: AsteroidImpactInput }
  | { kind: "Nuclear"; source: NuclearBurstInput }
  | { kind: "Landslide"; source: LandslideInput }
  | { kind: "Earthquake"; source: EarthquakeInput }
  | { kind: "Meteotsunami"; source: MeteotsunamiInput };

export type Preset = {
  id: string;
  name: string;
  date: string;
  blurb: string;
  reference: string;
  reference_url?: string | null;
  is_speculative?: boolean;
  controversy_note?: string | null;
  camera_view?: CameraView | null;
  source: PresetSource;
};

export type PropagationSnapshot = {
  time_s: number;
  ranges_m: number[];
  amplitudes_m: number[];
};

export type RunPresetResponse = {
  preset: Preset;
  initial: InitialDisplacement;
  wavefront: PropagationSnapshot;
};

/** One snapshot of the SWE simulation field. A non-wrapping field uses
 * `eta_png_b64`; wrapped/polar fields use `field_tiles` without duplicating
 * the complete raster. */
export type GridSnapshotTile = {
  column_offset: number;
  column_count: number;
  bbox: [number, number, number, number];
  eta_png_b64: string;
};

export type GridSnapshot = {
  time_s: number;
  bbox: [number, number, number, number];
  nx: number;
  ny: number;
  bathymetry_asset_id?: string | null;
  height_field: HeightFieldMetadata;
  eta_min_m: number;
  eta_max_m: number;
  eta_abs_max_m: number;
  eta_png_b64: string;
  field_tiles?: GridSnapshotTile[];
  gauge_samples?: Array<{ id: string; eta_m: number | null }>;
};

/** One first-arrival contour set at a fixed travel time. */
export type Isochrone = {
  time_s: number;
  /** Polylines as [lon_deg, lat_deg] vertex lists. */
  lines: Array<Array<[number, number]>>;
};

/** Max-field products (fgmax-style) accumulated across a solver run. */
export type MaxFieldProduct = {
  bbox: [number, number, number, number];
  nx: number;
  ny: number;
  peak_height_field: HeightFieldMetadata;
  peak_abs_max_m: number;
  t_end_s: number;
  arrival_threshold_m: number;
  peak_png_b64: string;
  t_of_max_png_b64: string;
  energy_png_b64: string;
  field_tiles?: Array<{
    column_offset: number;
    column_count: number;
    bbox: [number, number, number, number];
    peak_png_b64: string;
    t_of_max_png_b64: string;
    energy_png_b64: string;
  }>;
  isochrones: Isochrone[];
};

export type RunQualityRecord = {
  status: "pass" | "warning" | "failed";
  finite_fields: boolean;
  minimum_total_depth_m: number;
  cfl_number: number;
  cfl_margin: number;
  accepted_steps: number;
  rejected_steps: number;
  mass_drift_pct: number;
  energy_drift_pct: number;
  sponge_width_cells: number;
  warnings: string[];
  failure: string | null;
};

export type ScientificExportDescriptor = {
  export_id: string;
  suggested_filename: string;
  bytes: number;
  format: "NetCDF-3 Classic";
  conventions: "CF-1.12";
  zarr: {
    suggested_directory: string;
    bytes: number;
    files: number;
    format: "Zarr v3";
    conventions: "Zarr 3.1 + CF-1.12 metadata";
  } | null;
  zarr_error: string | null;
};

export type ResolutionFeature = {
  id: string;
  size_m: number;
  cells_across: number;
};

export type ResolutionPreflight = {
  schema_version: number;
  requested_cells_per_deg: number;
  recommended_cells_per_deg: number;
  selected_cells_per_deg: number;
  simple_auto_selected: boolean;
  advanced_override: boolean;
  dx_m: number;
  dy_m: number;
  estimated_dt_s: number;
  nx: number;
  ny: number;
  estimated_steps: number;
  estimated_cell_steps: number;
  estimated_memory_bytes: number;
  estimated_runtime_s: number;
  features: ResolutionFeature[];
  shortest_feature_id: string;
  minimum_cells_across_feature: number;
  numerical_grade: "gci_fine_range" | "gci_refined_range" | "gci_baseline_range" | "under_resolved";
  limitations: string[];
};

export type SimulateGridResponse = {
  run_id: string;
  lifecycle: "completed" | "cancelled";
  emitted_snapshots: number;
  cancelled: boolean;
  snapshots: GridSnapshot[];
  dt_s: number;
  nx: number;
  ny: number;
  resolution_preflight?: ResolutionPreflight | null;
  /** F4-01 — true when the SWE leapfrog ran on the wgpu GPU path.
   *  Always false on builds compiled without `--features gpu`. */
  used_gpu?: boolean;
  max_field?: MaxFieldProduct | null;
  scientific_export?: ScientificExportDescriptor | null;
  scientific_export_error?: string | null;
  run_quality: RunQualityRecord;
};

export type Gauge = {
  id: string;
  name: string;
  lat_deg: number;
  lon_deg: number;
};

export type GaugeSample = {
  time_s: number;
  eta_m: number;
};

export type GaugeTimeSeries = {
  gauge: Gauge;
  samples: GaugeSample[];
};

export type CoastalProvenanceConfidence = "low" | "medium" | "high";

/** Auditable lineage for one slope or depth value at a coastal point. */
export type CoastalMeasurementProvenance = {
  record_id: string;
  sample_id: string;
  source: string;
  source_url: string | null;
  method: string;
  datum: string;
  resolution: string;
  observed_or_published: string;
  confidence: CoastalProvenanceConfidence;
  uncertainty_value: number | null;
  uncertainty_unit: string;
  uncertainty_basis: string;
  placeholder: boolean;
};

export type CoastalMeasurementProvenanceRecord = Omit<CoastalMeasurementProvenance, "sample_id">;

/** A named coastal point used for Synolakis runup sampling. */
export type CoastalPoint = {
  id: string;
  name: string;
  region: string;
  lat: number;
  lon: number;
  beach_slope_deg: number;
  offshore_depth_m: number;
  slope_provenance: CoastalMeasurementProvenance;
  depth_provenance: CoastalMeasurementProvenance;
  notable?: string;
};

export type CoastalPointRecord = Omit<CoastalPoint, "slope_provenance" | "depth_provenance"> & {
  role: "runup" | "deep_water_reference";
  slope_provenance_id: string;
  depth_provenance_id: string;
};

export type CoastalPointDatabase = {
  _meta: {
    version: number;
    description: string;
    sources: string[];
    regions: string[];
    provenance_records: Record<string, CoastalMeasurementProvenanceRecord>;
  };
  points: CoastalPointRecord[];
};

export type DartBuoy = {
  id: number;
  name: string;
  lat: number;
  lon: number;
  depth_m: number;
  /** `[t_s_since_event, eta_m]` samples, ordered by t. */
  observations: [number, number][];
};

export type DartEvent = {
  event_origin_utc: string;
  epicenter: { lat: number; lon: number };
  buoys: DartBuoy[];
};

export type DartDatabase = {
  _meta: Record<string, unknown>;
  events: Record<string, DartEvent>;
};
