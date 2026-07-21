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
  /** Approximate children (under 15) among the fatalities/injuries, assuming the
   *  affected population mirrors the global age structure (UN WPP 2024, ~25%).
   *  A demographic slice, not a differential-vulnerability model. */
  childDeaths: number;
  childInjuries: number;
  populationDensity: number;
}

export type CasualtyModelKind = "combined_effects" | "blast_proxy";

export interface CasualtyCitation {
  label: string;
  url: string;
}

export interface CasualtyModelEstimate {
  id: CasualtyModelKind;
  label: string;
  version: string;
  summary: string;
  assumptions: string[];
  citations: CasualtyCitation[];
  estimate: CasualtyEstimate;
}

export interface CasualtySpread {
  deathsMin: number;
  deathsMax: number;
  injuriesMin: number;
  injuriesMax: number;
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

export interface LatentCancerEstimate {
  exposed: number;
  cancers10yr: number;
  cancers30yr: number;
  geneticEffects: number;
}

export interface ShelterAssessment {
  shelterType: string;
  survivalPct: number;
  blastOk: boolean;
}

export interface ShelterZoneAssessment {
  label: string;
  distanceKm: number;
  overpressurePsi: number;
  thermalCalCm2: number;
  shelters: ShelterAssessment[];
}

export interface NuclearShelterReport {
  resultId: string;
  model: string;
  zones: ShelterZoneAssessment[];
  limitations: string[];
}

export interface FalloutDoseInput {
  yieldKt: number;
  fissionFraction: number;
  downwindKm: number;
  crosswindKm: number;
  windSpeedKmh: number;
  selectedTimeH: number;
}

export interface FalloutCitation {
  label: string;
  url: string;
}

export interface FalloutDoseSample {
  timeH: number;
  doseRateSvH: number;
  doseRateMinSvH: number;
  doseRateMaxSvH: number;
  cumulativeDoseSv: number;
  cumulativeDoseMinSv: number;
  cumulativeDoseMaxSv: number;
}

export interface FalloutShelterCurve {
  shelterType: string;
  exposureFraction: number;
  selected: FalloutDoseSample;
  points: FalloutDoseSample[];
}

export interface FalloutDoseReport {
  model: string;
  fieldClass: string;
  downwindKm: number;
  crosswindKm: number;
  windSpeedKmh: number;
  windShearMphPerKft: number;
  arrivalTimeH: number;
  hPlus1DoseRateSvH: number;
  selectedTimeH: number;
  shelterCurves: FalloutShelterCurve[];
  citations: FalloutCitation[];
  assumptions: string[];
  uncertainty: string[];
  disclaimer: string;
}

export interface AsteroidTrajectoryPoint {
  altitude: number;
  velocity: number;
  groundDistance: number;
  time: number;
}

export interface AsteroidCraterVisual {
  finalDiameter: number;
  craterDepth: number;
  rimHeight: number;
  isComplex: boolean;
}

export interface AsteroidVisualReport {
  resultId: string;
  model: string;
  trajectory: AsteroidTrajectoryPoint[];
  crater: AsteroidCraterVisual | null;
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
  latentCancer: LatentCancerEstimate | null;
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
  secondaryEffects?: AsteroidSecondaryEffects;
}

export interface SecondaryEffectCitation {
  label: string;
  url: string;
}

export interface SecondaryEffectEvent {
  id: string;
  onsetSeconds: number;
  timeLabel: string;
  title: string;
  summary: string;
  metricLabel: string;
  metricValue: string;
  category: "seismic" | "ejecta" | "thermal" | "climate" | "ecosystem";
  confidence: "quantitative_screening" | "qualitative_scenario";
  uncertainty: string;
  citations: SecondaryEffectCitation[];
}

export interface AsteroidSecondaryEffects {
  classification: string;
  summary: string;
  durationSeconds: number;
  seismicMagnitude: number;
  ejectaReferenceDistanceM?: number;
  ejectaThicknessM?: number;
  events: SecondaryEffectEvent[];
}

export interface HazardResult {
  /** Present for live Rust results; capture fixtures predate result registration. */
  resultId?: string;
  kind: HazardKind;
  center: GeoPoint;
  rings: EffectRing[];
  readout: ReadoutItem[];
  casualties?: CasualtyEstimate | null;
  /** Optional because older frozen capture fixtures predate model comparison. */
  casualtyModels?: CasualtyModelEstimate[];
  casualtySpread?: CasualtySpread | null;
  detail: AsteroidDetail | NuclearDetail;
  authority: "rust";
  modelVersion: string;
}

export interface DirectHazardProbeEffect {
  label: string;
  category: string;
  description?: string | null;
  threshold_value?: number | null;
  threshold_unit?: string | null;
  value_qualifier?: "at_least" | null;
  arrival_time_s?: number | null;
}

export interface DirectHazardProbeResult {
  result_id: string;
  kind: "asteroid" | "nuclear";
  click_lat: number;
  click_lon: number;
  range_m: number;
  status: "threshold_exceeded" | "no_displayed_threshold";
  effects: DirectHazardProbeEffect[];
  governing_model: string;
  citations: string[];
  assumptions: string[];
  confidence: "screening_estimate";
  unknowns: string[];
}
