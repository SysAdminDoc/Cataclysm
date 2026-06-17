import { getDartBuoysForPreset } from "./data";
import type { DartBuoy } from "../types/scenario";

export function dartPinsForPreset(presetId: string | null): DartBuoy[] {
  return [...getDartBuoysForPreset(presetId)];
}
