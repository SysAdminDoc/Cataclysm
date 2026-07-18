export interface FireballEvent {
  id: string;
  date: string;
  lat: number;
  lon: number;
  radiatedEnergy10J: number;
  impactEnergyKt: number;
  altitudeKm: number | null;
  velocityKmS: number | null;
  source: "NASA/JPL CNEOS" | "Built-in fallback";
}

export interface SentryRisk {
  impactProbability: number;
  palermoScale: string;
  torinoScale: string;
  impactCount: number;
  yearRange: string;
}

export interface NeoLookupResult {
  fullname: string;
  designation: string | null;
  diameterM: number;
  velocityMps: number;
  densityKgM3: number;
  risk?: SentryRisk;
  source: "NASA/JPL SBDB" | "Built-in fallback";
  assumptions: string[];
}

export interface NeoCloseApproach {
  id: string;
  designation: string;
  fullname: string;
  approachAtIso: string;
  nominalDistanceAu: number;
  minimumDistanceAu: number;
  maximumDistanceAu: number;
  relativeVelocityKmS: number;
  infinityVelocityKmS: number;
  timeUncertainty: string;
  absoluteMagnitude: number | null;
  diameterMinM: number;
  diameterMaxM: number;
  diameterBasis: "measured" | "estimated_from_h" | "unknown";
  source: "NASA/JPL SBDB Close Approach Data API" | "Built-in reference";
}

export interface NeoApproachFeed {
  approaches: NeoCloseApproach[];
  fetchedAtIso: string;
  status: "live" | "cached" | "reference";
  stale: boolean;
  notice: string | null;
}

export interface HypotheticalImpactDraft {
  object: NeoCloseApproach;
  diameterM: number;
  velocityMps: number;
  densityKgM3: number;
  assumptions: string[];
}
