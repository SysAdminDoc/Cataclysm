import type {
  AsteroidImpactInput,
  EarthquakeInput,
  GeoPoint,
  InitialDisplacement,
  LandslideInput,
  MeteotsunamiInput,
  NuclearBurstInput,
  PropagationSnapshot,
} from "../types/scenario";
import type { BurstType, HazardResult, TargetType } from "../hazards";

/** Snake-case direct asteroid request, matching the Rust `AsteroidHazardRequest`. */
export type BrowserAsteroidHazardRequest = {
  center: { lat: number; lon: number };
  diameter_m: number;
  density_kg_m3: number;
  velocity_km_s: number;
  angle_deg: number;
  target_type: TargetType;
  water_depth_m: number;
  beach_slope_rad: number;
};

/** Snake-case direct nuclear request, matching the Rust `NuclearHazardRequest`. */
export type BrowserNuclearHazardRequest = {
  center: { lat: number; lon: number };
  yield_kt: number;
  burst_type: BurstType;
  height_m?: number;
  fission_pct: number;
  population_density: number;
};

type BrowserPhysicsExports = WebAssembly.Exports & {
  memory: WebAssembly.Memory;
  cataclysm_alloc: (len: number) => number;
  cataclysm_dealloc: (pointer: number, capacity: number) => void;
  cataclysm_compute: (pointer: number, len: number) => number;
  cataclysm_result_ptr: () => number;
  cataclysm_result_len: () => number;
};

type PhysicsResponse<T> =
  | { ok: true; value: T }
  | { ok: false; error?: string };

export type BrowserSourceInput =
  | { kind: "Asteroid"; source: AsteroidImpactInput }
  | { kind: "Nuclear"; source: NuclearBurstInput }
  | { kind: "Earthquake"; source: EarthquakeInput }
  | { kind: "Landslide"; source: LandslideInput }
  | { kind: "Meteotsunami"; source: MeteotsunamiInput };

export type BrowserScreeningResult = {
  range_m: number;
  offshore_amplitude_m: number;
  runup_m: number;
  arrival_time_s: number;
  has_arrived: boolean;
  inundation_extent_m: number;
};

let exportsPromise: Promise<BrowserPhysicsExports> | null = null;

async function loadExports(): Promise<BrowserPhysicsExports> {
  if (!exportsPromise) {
    exportsPromise = (async () => {
      const moduleUrl = new URL(
        `${import.meta.env.BASE_URL}physics/cataclysm_browser_physics.wasm`,
        window.location.origin,
      );
      const response = await fetch(moduleUrl);
      if (!response.ok) {
        throw new Error(`browser physics module returned HTTP ${response.status}`);
      }
      const bytes = await response.arrayBuffer();
      const instance = await WebAssembly.instantiate(bytes, {});
      const wasm = instance.instance.exports as BrowserPhysicsExports;
      if (
        !(wasm.memory instanceof WebAssembly.Memory) ||
        typeof wasm.cataclysm_alloc !== "function" ||
        typeof wasm.cataclysm_compute !== "function"
      ) {
        throw new Error("browser physics module has an incompatible ABI");
      }
      return wasm;
    })().catch((error) => {
      exportsPromise = null;
      throw error;
    });
  }
  return exportsPromise;
}

async function compute<T>(request: object): Promise<T> {
  const wasm = await loadExports();
  const input = new TextEncoder().encode(JSON.stringify(request));
  const pointer = wasm.cataclysm_alloc(input.byteLength);
  try {
    new Uint8Array(wasm.memory.buffer, pointer, input.byteLength).set(input);
    wasm.cataclysm_compute(pointer, input.byteLength);
    const resultPointer = wasm.cataclysm_result_ptr();
    const resultLength = wasm.cataclysm_result_len();
    const resultBytes = new Uint8Array(wasm.memory.buffer, resultPointer, resultLength).slice();
    const response = JSON.parse(new TextDecoder().decode(resultBytes)) as PhysicsResponse<T>;
    if (!response.ok) {
      throw new Error(response.error || "browser physics computation failed");
    }
    return response.value;
  } finally {
    wasm.cataclysm_dealloc(pointer, input.byteLength);
  }
}

export function browserInitial(input: BrowserSourceInput): Promise<InitialDisplacement> {
  return compute({ operation: "initial", input });
}

export function browserWavefront(request: {
  initial_amplitude_m: number;
  cavity_radius_m: number;
  decay_alpha: number;
  mean_depth_m: number;
  time_s: number;
  n_samples: number;
}): Promise<PropagationSnapshot> {
  return compute({ operation: "wavefront", ...request });
}

export function browserAttenuation(request: {
  initial_amplitude_m: number;
  cavity_radius_m: number;
  decay_alpha: number;
  max_range_m: number;
  n_samples: number;
}): Promise<Array<{ range_m: number; amplitude_m: number }>> {
  return compute({ operation: "attenuation", ...request });
}

export function browserRunup(request: {
  source: GeoPoint;
  initial_amplitude_m: number;
  cavity_radius_m: number;
  is_impact: boolean;
  mean_depth_m: number;
  time_s: number;
  points: Array<{
    lat: number;
    lon: number;
    beach_slope_deg: number;
    offshore_depth_m: number;
  }>;
}): Promise<BrowserScreeningResult[]> {
  return compute({ operation: "runup", ...request });
}

export function browserInspect(request: {
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
}): Promise<BrowserScreeningResult> {
  return compute({ operation: "inspect", ...request });
}

/**
 * Full Rust-authoritative asteroid impact effects, computed by the same
 * `physics::direct_hazard::simulate_asteroid_hazard` model the desktop app
 * runs — no JS reimplementation. Lets the browser preview render rings,
 * crater, thermal/blast radii, and coupled tsunami instead of gating them off.
 */
export function browserAsteroidHazard(
  request: BrowserAsteroidHazardRequest,
): Promise<HazardResult> {
  return compute({ operation: "asteroid_hazard", request });
}

/**
 * Full Rust-authoritative nuclear detonation effects (fireball, blast/thermal
 * rings, fallout, casualties), computed by the shared
 * `physics::direct_hazard::simulate_nuclear_hazard` model.
 */
export function browserNuclearHazard(
  request: BrowserNuclearHazardRequest,
): Promise<HazardResult> {
  return compute({ operation: "nuclear_hazard", request });
}
