// Nuclear hazard engine — wraps the ported physics into the unified
// HazardResult contract the Cesium globe renders.

import type { EffectRing, GeoPoint, HazardEngine, HazardResult, ReadoutItem } from "../types";
import {
  type BurstType,
  type NuclearEffects,
  calcEffects,
  calcZoneMortality,
  fmtR,
  fmtYield,
} from "./physics";

export interface NuclearInput {
  yieldKt: number;
  burstType: BurstType;
  heightM?: number;
  fissionPct?: number;
  /** Assumed population density (people/km^2) for casualty estimate. */
  populationDensity?: number;
}

export interface WeaponPreset {
  id: string;
  name: string;
  yieldKt: number;
  burstType: BurstType;
  note: string;
}

/** Curated subset of NukeMap's 38-weapon table (historic + modern). */
export const WEAPON_PRESETS: WeaponPreset[] = [
  { id: "hiroshima", name: "Little Boy (Hiroshima)", yieldKt: 15, burstType: "airburst", note: "1945 · gun-type U-235" },
  { id: "fatman", name: "Fat Man (Nagasaki)", yieldKt: 21, burstType: "airburst", note: "1945 · implosion Pu-239" },
  { id: "w76", name: "W76 (Trident II)", yieldKt: 100, burstType: "airburst", note: "US SLBM primary warhead" },
  { id: "w88", name: "W88 (Trident II)", yieldKt: 455, burstType: "airburst", note: "US SLBM high-yield warhead" },
  { id: "b83", name: "B83", yieldKt: 1200, burstType: "surface", note: "US highest-yield weapon in service" },
  { id: "sarmat", name: "RS-28 Sarmat (per RV)", yieldKt: 800, burstType: "airburst", note: "Russian heavy ICBM MIRV" },
  { id: "ivymike", name: "Ivy Mike", yieldKt: 10400, burstType: "surface", note: "1952 · first thermonuclear test" },
  { id: "castlebravo", name: "Castle Bravo", yieldKt: 15000, burstType: "surface", note: "1954 · largest US test" },
  { id: "tsar", name: "Tsar Bomba", yieldKt: 50000, burstType: "airburst", note: "1961 · largest ever detonated" },
];

function rings(e: NuclearEffects): EffectRing[] {
  // km -> m, largest first. Only include zones with a real radius.
  const defs: Array<[string, number, string, string, string]> = [
    ["Light fallout (heavy zone shown)", e.fallout?.heavy.length ?? 0, "#a6e3a1", "fallout", "Downwind heavy-fallout reach (idealized plume length)."],
    ["1st° burns", e.thermal1, "#f5c2e7", "thermal", "≥2.5 cal/cm² — first-degree burns to exposed skin."],
    ["1 psi — window breakage", e.psi1, "#f9e2af", "blast", "Glass shatters into shrapnel; light injuries widespread."],
    ["3rd° burns", e.thermal3, "#fab387", "thermal", "≥8 cal/cm² — third-degree burns; ignition of many materials."],
    ["5 psi — buildings destroyed", e.psi5, "#cba6f7", "blast", "Most residential buildings collapse; ~160 mph winds."],
    ["500 rem radiation", e.radiation, "#94e2d5", "radiation", "Acute lethal dose to unsheltered survivors of blast/thermal."],
    ["20 psi — heavy destruction", e.psi20, "#89b4fa", "blast", "Reinforced structures destroyed; near-total fatalities."],
    ["Fireball", e.fireball, "#f5e0dc", "fireball", "Everything within is vaporized."],
  ];
  return defs
    .filter(([, km]) => km > 0.0005)
    .map(([label, km, color, category, description]) => ({ label, radiusM: km * 1000, color, category, description }))
    .sort((a, b) => b.radiusM - a.radiusM);
}

function readout(e: NuclearEffects): ReadoutItem[] {
  const items: ReadoutItem[] = [
    { label: "Yield", value: fmtYield(e.yieldKt) },
    { label: "Burst", value: e.isWater ? "Water" : e.isSurface ? "Surface" : "Air", hint: `optimal air-burst height ${fmtR(e.optimalHeight / 1000)}` },
    { label: "Fireball radius", value: fmtR(e.fireball) },
    { label: "5 psi radius", value: fmtR(e.psi5), hint: "residential destruction" },
    { label: "3rd° burn radius", value: fmtR(e.thermal3) },
    { label: "500 rem radius", value: fmtR(e.radiation) },
    { label: "Mushroom cloud top", value: fmtR(e.cloudTopH) },
  ];
  if (e.craterR > 0) items.push({ label: "Crater radius", value: fmtR(e.craterR) });
  if (e.isWater) items.push({ label: "Wave height @1 km", value: `${e.waveHeight.toFixed(0)} m` });
  return items;
}

export const nuclearEngine: HazardEngine<NuclearInput> = {
  kind: "nuclear",
  label: "Nuclear detonation",
  run(input: NuclearInput, center: GeoPoint): HazardResult {
    const e = calcEffects(input.yieldKt, input.burstType, input.heightM, input.fissionPct ?? 50, input.populationDensity);
    const density = input.populationDensity ?? 0;
    const result: HazardResult = {
      kind: "nuclear",
      center,
      rings: rings(e),
      readout: readout(e),
      detail: e,
    };
    if (density > 0) {
      const m = calcZoneMortality(e, density);
      result.casualties = { deaths: m.deaths, injuries: m.injuries, populationDensity: density };
    }
    return result;
  },
};
