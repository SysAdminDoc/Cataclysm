import type { BurstType } from "../hazards/types";

export interface NukemapDataFile<T> {
  schemaVersion: 1;
  source: string;
  count: number;
  items: T;
}

export interface NukemapWeapon {
  id: string;
  name: string;
  yieldKt: number;
  country: string | null;
  year: number | null;
  description: string;
  burstType: BurstType;
}

export interface NukemapCity {
  id: string;
  name: string;
  state: string;
  lat: number;
  lon: number;
  population: number;
  zipCodes: string[];
}

export interface NukemapTarget {
  id: string;
  name: string;
  lat: number;
  lon: number;
  category: string;
  region: string;
  country: string | null;
  population: number | null;
  description: string;
  sourceFile: string;
}

export type NukemapZipRecord = [lat: number, lon: number, city: string, state: string];

export interface PopulationDensityEstimate {
  peoplePerKm2: number;
  nearestCity: string | null;
  distanceKm: number | null;
  population: number | null;
}

export interface NukemapLocationResult {
  id: string;
  kind: "coordinate" | "city" | "zip" | "target";
  name: string;
  context: string;
  lat: number;
  lon: number;
  density: PopulationDensityEstimate;
}
