import type { BurstType } from "../types";
import weaponsJson from "../../data/nukemap/weapons.json";
import type { NukemapDataFile, NukemapWeapon } from "../../types/nukemap-data";

export interface WeaponPreset {
  id: string;
  name: string;
  yieldKt: number;
  burstType: BurstType;
  note: string;
}

const weaponsFile = weaponsJson as NukemapDataFile<NukemapWeapon[]>;
if (weaponsFile.schemaVersion !== 1 || weaponsFile.count !== 39 || weaponsFile.items.length !== 39) {
  throw new Error("Bundled NukeMap weapon data failed its count or schema check.");
}

/** Complete NukeMap reference-yield table, normalized into the direct-hazard setup contract. */
export const WEAPON_PRESETS: WeaponPreset[] = weaponsFile.items
  .filter((weapon) => weapon.id !== "custom")
  .map((weapon) => ({
    id: weapon.id,
    name: weapon.name,
    yieldKt: weapon.yieldKt,
    burstType: weapon.burstType,
    note: [weapon.year, weapon.country, weapon.description].filter(Boolean).join(" · "),
  }));

export type { BurstType, NuclearInput } from "../types";
