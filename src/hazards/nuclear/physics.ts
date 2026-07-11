// Nuclear weapon effects — ported from NukeMap v3.8.0 (js/physics.js) to
// typed, pure TypeScript. Radii are in KILOMETERS unless noted (matching the
// Glasstone & Dolan / NWFAQ scaling literature the coefficients come from).
//
// Sources: G&D = "The Effects of Nuclear Weapons" 3rd ed. (1977);
//          NWFAQ = Nuclear Weapon Archive FAQ §5; HSAJ; OTA (1979);
//          Harney 2009 (casualties); BEIR VII (2006, latent cancer).

export type BurstType = "airburst" | "surface" | "custom" | "hemp" | "water";
export type BlastModelKey = "nwfaq" | "freeair" | "soviet";

export interface BlastModel {
  psi200: number;
  psi20: number;
  psi5: number;
  psi3: number;
  psi1: number;
  label: string;
}

export const BLAST_MODELS: Record<BlastModelKey, BlastModel> = {
  nwfaq: { psi200: 0.13, psi20: 0.28, psi5: 0.71, psi3: 0.95, psi1: 2.2, label: "NWFAQ Optimum Burst" },
  freeair: { psi200: 0.11, psi20: 0.24, psi5: 0.59, psi3: 0.79, psi1: 1.93, label: "G&D Free-Air" },
  soviet: { psi200: 0.14, psi20: 0.3, psi5: 0.76, psi3: 1.02, psi1: 2.4, label: "Soviet Military Manual" },
};

export interface FalloutPlume {
  heavy: { length: number; width: number };
  light: { length: number; width: number };
}

/** All radii in km unless the field name says otherwise. */
export interface NuclearEffects {
  fireball: number;
  psi200: number;
  psi20: number;
  psi5: number;
  psi3: number;
  psi1: number;
  thermal3: number;
  thermal2: number;
  thermal1: number;
  radiation: number;
  neutronRad: number;
  gammaRad: number;
  emp: number;
  craterR: number;
  craterDepth: number;
  cloudTopH: number;
  fallout: FalloutPlume | null;
  flashBlindDay: number;
  flashBlindNight: number;
  firestormR: number;
  burstHeight: number; // meters
  optimalHeight: number; // meters
  isSurface: boolean;
  isWater: boolean;
  yieldKt: number;
  baseSurge: number;
  baseSurgeH: number;
  waveHeight: number; // meters at 1 km (water bursts)
}

const thermalAtten = (Y: number): number =>
  Y > 1000 ? Math.max(0.7, 1 - (Math.log10(Y) - 3) * 0.15) : 1;

/**
 * Core effects model. Y = yield in kilotons. Faithful port of
 * NM.calcEffects; verified against the NukeMap physics regression suite.
 */
export function calcEffects(
  yieldKt: number,
  burstType: BurstType,
  heightM?: number,
  fissionPct = 50,
  popDensity?: number,
  model: BlastModelKey = "nwfaq",
): NuclearEffects {
  const Y = Number.isFinite(yieldKt) ? Math.max(yieldKt, 0.001) : 0.001;
  const fissionFrac = (Number.isFinite(fissionPct) ? fissionPct : 50) / 100;
  const isWater = burstType === "water";
  const isSurface = burstType === "surface" || isWater;
  const optH = 0.22 * Math.pow(Y, 1 / 3) * 1000; // G&D Ch.3 §3.73
  const h = burstType === "airburst" ? optH : heightM ?? 0;
  const hf = isSurface ? 0.8 : 1.0; // NWFAQ §5.2 surface factor
  const bm = BLAST_MODELS[model] ?? BLAST_MODELS.nwfaq;
  const atten = thermalAtten(Y);

  const surfaceFallout =
    isSurface || (heightM !== undefined && heightM < (isSurface ? 0.05 : 0.066) * Math.pow(Y, 0.4) * 1000);

  return {
    fireball: isSurface ? 0.05 * Math.pow(Y, 0.4) : 0.066 * Math.pow(Y, 0.4),
    psi200: hf * bm.psi200 * Math.pow(Y, 1 / 3),
    psi20: hf * bm.psi20 * Math.pow(Y, 1 / 3),
    psi5: hf * bm.psi5 * Math.pow(Y, 1 / 3),
    psi3: hf * bm.psi3 * Math.pow(Y, 1 / 3),
    psi1: hf * bm.psi1 * Math.pow(Y, 1 / 3),
    thermal3: 0.67 * Math.pow(Y, 0.41) * atten,
    thermal2: 0.87 * Math.pow(Y, 0.4) * atten,
    thermal1: 1.2 * Math.pow(Y, 0.38) * atten,
    radiation: 1.15 * Math.pow(Y, 0.19),
    neutronRad: Math.min(2.5, 0.7 * Math.pow(Y, 0.19)),
    gammaRad: Math.min(3.0, 1.0 * Math.pow(Y, 0.19)),
    emp: Math.min(2.5 * Math.pow(Y, 0.33), 40),
    craterR: isSurface ? 0.038 * Math.pow(Y, 1 / 3.4) : 0,
    craterDepth: isSurface ? 0.013 * Math.pow(Y, 1 / 3.4) : 0,
    cloudTopH: (isSurface ? 0.24 : 0.29) * Math.pow(Y, 0.42),
    fallout: surfaceFallout
      ? {
          heavy: { length: 1.3 * Math.pow(Y * fissionFrac, 0.45), width: 0.39 * Math.pow(Y * fissionFrac, 0.35) },
          light: { length: 4.6 * Math.pow(Y * fissionFrac, 0.45), width: 1.1 * Math.pow(Y * fissionFrac, 0.35) },
        }
      : null,
    flashBlindDay: 2.1 * Math.pow(Y, 0.4),
    flashBlindNight: 55 * Math.pow(Y, 0.25),
    firestormR:
      isWater
        ? 0
        : 0.67 *
          Math.pow(Y, 0.41) *
          0.85 *
          (popDensity == null ? 1.0 : popDensity > 5000 ? 1.0 : popDensity > 1000 ? 0.8 : popDensity > 200 ? 0.5 : 0.15),
    burstHeight: h,
    optimalHeight: optH,
    isSurface,
    isWater,
    yieldKt: Y,
    baseSurge: isWater ? 0.34 * Math.pow(Y, 0.4) : 0,
    baseSurgeH: isWater ? 0.06 * Math.pow(Y, 0.4) : 0,
    waveHeight: isWater ? 10 * Math.pow(Y, 0.54) : 0,
  };
}

interface Zone {
  name: string;
  r: number;
  color: string;
  pB: number;
  pT: number;
  pR: number;
  pInjB: number;
  pInjT: number;
}

export function zoneProbs(e: NuclearEffects): Zone[] {
  return [
    { name: "Fireball", r: e.fireball, color: "#f5e0dc", pB: 1.0, pT: 1.0, pR: 1.0, pInjB: 0, pInjT: 0 },
    { name: "200 psi", r: e.psi200 || 0, color: "#89dceb", pB: 0.98, pT: 0.9, pR: 0.8, pInjB: 0.02, pInjT: 0.05 },
    { name: "20 psi", r: e.psi20, color: "#89b4fa", pB: 0.85, pT: 0.6, pR: 0.3, pInjB: 0.12, pInjT: 0.15 },
    { name: "5 psi", r: e.psi5, color: "#cba6f7", pB: 0.4, pT: 0.3, pR: 0.05, pInjB: 0.45, pInjT: 0.2 },
    { name: "3rd° Burns", r: Math.max(e.thermal3, e.psi3), color: "#fab387", pB: 0.15, pT: 0.25, pR: 0.02, pInjB: 0.35, pInjT: 0.3 },
    { name: "1 psi", r: e.psi1, color: "#f9e2af", pB: 0.02, pT: 0.05, pR: 0.0, pInjB: 0.2, pInjT: 0.15 },
    { name: "1st° Burns", r: e.thermal1, color: "#f5c2e7", pB: 0.0, pT: 0.01, pR: 0.0, pInjB: 0.05, pInjT: 0.1 },
  ];
}

export interface ZoneMortality {
  deaths: number;
  injuries: number;
}

/** Bayesian combined mortality (Harney 2009). density = people/km^2. */
export function calcZoneMortality(e: NuclearEffects, density: number): ZoneMortality {
  const shieldF = density > 5000 ? 0.65 : density > 1000 ? 0.75 : density > 200 ? 0.85 : 1.0;
  const indoorFrac = 0.8;
  const indoorPF = 0.4;
  let deaths = 0;
  let injuries = 0;
  let prevA = 0;
  for (const z of zoneProbs(e)) {
    if (z.r < 0.001) continue;
    const a = Math.PI * z.r * z.r;
    const ring = Math.max(0, a - prevA);
    const pop = ring * density;
    const outPop = pop * (1 - indoorFrac);
    const outDeath = 1 - (1 - z.pB) * (1 - z.pT) * (1 - z.pR);
    const outInj = Math.min(1 - outDeath, z.pInjB + z.pInjT);
    const inPop = pop * indoorFrac;
    const inDeath = 1 - (1 - z.pB) * (1 - z.pT * indoorPF) * (1 - z.pR * indoorPF);
    const inInj = Math.min(1 - inDeath, z.pInjB + z.pInjT * indoorPF);
    deaths += Math.round((outPop * outDeath + inPop * inDeath) * shieldF);
    injuries += Math.round((outPop * outInj + inPop * inInj) * shieldF);
    prevA = a;
  }
  return { deaths, injuries };
}

// Formatting helpers (subset of NM.fmt*).
export const fmtYield = (kt: number): string => {
  if (!Number.isFinite(kt)) return "--";
  if (kt < 0.001) return `${(kt * 1e6).toFixed(0)} g`;
  if (kt < 1) return `${kt < 0.01 ? (kt * 1000).toFixed(1) : (kt * 1000).toFixed(0)} tons`;
  if (kt < 1000) return `${kt >= 100 ? kt.toFixed(0) : kt.toFixed(1)} kT`;
  return `${(kt / 1000).toFixed(kt >= 10000 ? 0 : 1)} MT`;
};

export const fmtR = (km: number): string => {
  if (!Number.isFinite(km)) return "--";
  if (km < 0.01) return `${Math.round(km * 1000)} m`;
  if (km < 1) return `${(km * 1000).toFixed(0)} m`;
  if (km < 10) return `${km.toFixed(2)} km`;
  if (km < 100) return `${km.toFixed(1)} km`;
  return `${km.toFixed(0)} km`;
};
