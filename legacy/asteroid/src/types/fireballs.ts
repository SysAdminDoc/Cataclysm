export interface FireballEvent {
  id: string;
  date: string;
  lat: number;
  lon: number;
  energyKt: number;
  impactEnergyKt: number;
  altitudeKm: number | null;
  velocityKmS: number | null;
}
