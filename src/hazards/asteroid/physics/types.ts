export type TargetType = 'sedimentary_rock' | 'crystalline_rock' | 'water';

export type CompositionType = 'ice' | 'porous_rock' | 'dense_rock' | 'stony' | 'iron';

export interface ImpactParams {
  diameter: number;       // meters
  density: number;        // kg/m^3
  velocity: number;       // m/s (NOT km/s — convert at input boundary)
  angle: number;          // degrees from horizontal (1-90)
  targetType: TargetType;
  waterDepth: number;     // meters (only used when targetType === 'water')
  beachSlope: number;     // radians (typical continental shelf ~0.02)
  distance: number;       // observer distance in meters from impact
}

export interface EnergyResult {
  kineticEnergy: number;       // joules
  megatons: number;            // Mt TNT equivalent
  kilotons: number;            // kt TNT equivalent
  impactorMass: number;        // kg
}

export interface AtmosphericEntryResult {
  reachesGround: boolean;
  airburstAltitude: number;    // meters (0 if reaches ground)
  airburstEnergy: number;      // joules (energy at burst/impact)
  impactVelocity: number;      // m/s (velocity at ground or burst altitude)
  breakupAltitude: number;     // meters (where fragmentation begins, -1 if none)
  trajectory: TrajectoryPoint[];
}

export interface TrajectoryPoint {
  altitude: number;       // m
  velocity: number;       // m/s
  mass: number;           // kg
  radius: number;         // m (effective radius after spreading)
  groundDistance: number;  // m
  time: number;           // s
}

export interface CraterResult {
  transientDiameter: number;   // m
  finalDiameter: number;       // m
  craterDepth: number;         // m
  isComplex: boolean;
  rimHeight: number;           // m
  meltVolume: number;          // m^3
  brecciaVolume: number;       // m^3
}

export interface ThermalResult {
  fireballRadius: number;              // m
  fireballDuration: number;            // seconds
  thermalExposure: number;             // J/m^2 at observer distance
  thermalRadiusThirdDegree: number;    // m
  thermalRadiusSecondDegree: number;   // m
  thermalRadiusFirstDegree: number;    // m
  thermalRadiusIgnition: number;       // m (dry wood ignition)
}

export interface SeismicResult {
  magnitude: number;          // Richter equivalent
  mercalliIntensity: number;  // at observer distance (1-12)
  mercalliDescription: string;
  arrivalTime: number;        // seconds to observer
}

export interface AirblastResult {
  overpressure: number;              // Pa at observer distance
  windVelocity: number;             // m/s at observer distance
  soundIntensity: number;           // dB at observer distance
  damageDescription: string;
  arrivalTime: number;              // seconds to observer
  radiusWindowBreakage: number;     // m (1 psi)
  radiusMinorDamage: number;        // m (2 psi)
  radiusModerateDamage: number;     // m (4 psi)
  radiusSevereDamage: number;       // m (7 psi)
  radiusTotalDestruction: number;   // m (20 psi)
}

export interface EjectaResult {
  ejectaThickness: number;      // m at observer distance
  ejectaArrivalTime: number;    // seconds to observer
  maxEjectaRange: number;       // m
  rimThickness: number;         // m
}

export interface TsunamiResult {
  applies: boolean;                  // false if land impact
  cavityDiameter: number;           // m
  cavityDepth: number;              // m
  initialAmplitude: number;         // m
  amplitudeAtDistance: number;      // m at observer distance
  runupHeight: number;              // m (coastal)
  arrivalTime: number;             // seconds to observer
}

export interface ImpactEffects {
  params: ImpactParams;
  energy: EnergyResult;
  atmosphericEntry: AtmosphericEntryResult;
  crater: CraterResult | null;     // null for airbursts that don't reach ground
  thermal: ThermalResult;
  seismic: SeismicResult;
  airblast: AirblastResult;
  ejecta: EjectaResult | null;     // null for airbursts
  tsunami: TsunamiResult;
}

export interface EffectRing {
  label: string;
  radius: number;     // meters
  color: string;       // hex or rgba
  category: string;
}
