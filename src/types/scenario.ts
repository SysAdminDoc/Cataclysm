// Types that mirror the Rust serde structs in src-tauri/src/physics + presets.

export type GeoPoint = {
  lat_deg: number;
  lon_deg: number;
  depth_m?: number;
};

export type InitialDisplacement = {
  center: GeoPoint;
  cavity_radius_m: number;
  peak_amplitude_m: number;
  source_energy_j: number;
  seismic_mw_equivalent: number;
  dominant_wavelength_m?: number | null;
  label: string;
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
  water_depth_m: number;
  location: GeoPoint;
};

export type PresetSource =
  | { kind: "Asteroid"; source: AsteroidImpactInput }
  | { kind: "Nuclear"; source: NuclearBurstInput }
  | { kind: "Landslide"; source: LandslideInput }
  | { kind: "Earthquake"; source: EarthquakeInput };

export type Preset = {
  id: string;
  name: string;
  date: string;
  blurb: string;
  reference: string;
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
