import type { BurstType } from "../types";

export interface WeaponPreset {
  id: string;
  name: string;
  yieldKt: number;
  burstType: BurstType;
  note: string;
}

/** Curated historic and modern reference yields for scenario setup. */
export const WEAPON_PRESETS: WeaponPreset[] = [
  { id: "hiroshima", name: "Little Boy (Hiroshima)", yieldKt: 15, burstType: "airburst", note: "1945 · gun-type U-235" },
  { id: "fatman", name: "Fat Man (Nagasaki)", yieldKt: 21, burstType: "airburst", note: "1945 · implosion Pu-239" },
  { id: "w76", name: "W76 (Trident II)", yieldKt: 100, burstType: "airburst", note: "US SLBM primary warhead" },
  { id: "w88", name: "W88 (Trident II)", yieldKt: 455, burstType: "airburst", note: "US SLBM high-yield warhead" },
  { id: "b83", name: "B83", yieldKt: 1200, burstType: "surface", note: "US high-yield gravity bomb" },
  { id: "sarmat", name: "RS-28 Sarmat (per RV)", yieldKt: 800, burstType: "airburst", note: "Russian heavy ICBM MIRV" },
  { id: "ivymike", name: "Ivy Mike", yieldKt: 10400, burstType: "surface", note: "1952 · first thermonuclear test" },
  { id: "castlebravo", name: "Castle Bravo", yieldKt: 15000, burstType: "surface", note: "1954 · largest US test" },
  { id: "tsar", name: "Tsar Bomba", yieldKt: 50000, burstType: "airburst", note: "1961 · largest ever detonated" },
];

export type { BurstType, NuclearInput } from "../types";
