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
