// Renderer contracts for Rust-authoritative direct hazard products. This
// module intentionally contains no formulas or engine interface: browser code
// can describe inputs and render backend responses, but cannot run physics.

export type HazardKind = "asteroid" | "nuclear" | "earthquake" | "landslide" | "tsunami";
export type BurstType = "airburst" | "surface" | "custom" | "hemp" | "water";
export type TargetType = "sedimentary_rock" | "crystalline_rock" | "water";

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface AsteroidInput {
  diameterM: number;
  densityKgM3: number;
  velocityKmS: number;
  angleDeg: number;
  targetType: TargetType;
  waterDepthM?: number;
  beachSlopeRad?: number;
}

export interface NuclearInput {
  yieldKt: number;
  burstType: BurstType;
  heightM?: number;
  fissionPct?: number;
  populationDensity?: number;
}

export interface EffectRing {
  label: string;
  radiusM: number;
  color: string;
  category: string;
  description?: string;
}

export interface ReadoutItem {
  label: string;
  value: string;
  hint?: string;
}

export interface CasualtyEstimate {
  deaths: number;
  injuries: number;
  populationDensity: number;
}

export interface FalloutZone {
  length: number;
  width: number;
}

export interface FalloutPlume {
  heavy: FalloutZone;
  light: FalloutZone;
}

export interface TimelineEvent {
  time: string;
  description: string;
  category: string;
}

export interface NuclearDetail {
  yieldKt: number;
  isSurface: boolean;
  isWater: boolean;
  fireball: number;
  psi20: number;
  psi5: number;
  psi1: number;
  thermal3: number;
  thermal1: number;
  radiation: number;
  neutronRad: number;
  gammaRad: number;
  craterR: number;
  cloudTopH: number;
  optimalHeight: number;
  waveHeight: number;
  fallout: FalloutPlume | null;
  timeline: TimelineEvent[];
}

export interface AsteroidDetail {
  kineticEnergyJ: number;
  megatons: number;
  impactorMassKg: number;
  atmosphericEntry: {
    reachesGround: boolean;
    airburstAltitude: number;
    airburstEnergy: number;
    impactVelocity: number;
    breakupAltitude: number;
  };
  crater: { finalDiameter: number; craterDepth: number; isComplex: boolean } | null;
  seismicMagnitude: number;
  fireballRadiusM: number;
  radiusWindowBreakageM: number;
  radiusSevereDamageM: number;
  radiusTotalDestructionM: number;
  thermalRadiusFirstDegreeM: number;
  thermalRadiusThirdDegreeM: number;
  tsunami: {
    applies: boolean;
    cavityDiameter: number;
    cavityDepth: number;
    initialAmplitude: number;
    amplitudeAtDistance: number;
    runupHeight: number;
    arrivalTime: number;
  };
}

export interface HazardResult {
  kind: HazardKind;
  center: GeoPoint;
  rings: EffectRing[];
  readout: ReadoutItem[];
  casualties?: CasualtyEstimate | null;
  detail: AsteroidDetail | NuclearDetail;
  authority: "rust";
  modelVersion: string;
}
