import { describe, expect, it } from "vitest";
import {
  estimatePopulationDensity,
  NUKEMAP_CITIES,
  NUKEMAP_TARGETS,
  searchNukemapLocations,
} from "../nukemap-data";
import { WEAPON_PRESETS } from "../../hazards/nuclear";

describe("normalized NukeMap location data", () => {
  it("preserves the complete city and target tables", () => {
    expect(NUKEMAP_CITIES).toHaveLength(246);
    expect(NUKEMAP_TARGETS).toHaveLength(459);
    expect(WEAPON_PRESETS).toHaveLength(38);
    expect(WEAPON_PRESETS.find((weapon) => weapon.id === "hiroshima")).toMatchObject({
      yieldKt: 15,
      burstType: "airburst",
    });
  });

  it("preserves NukeMap's population and distance density bands", () => {
    expect(estimatePopulationDensity(40.7128, -74.006)).toMatchObject({
      peoplePerKm2: 15_000,
      nearestCity: "New York, NY",
      population: 8_336_817,
    });
    expect(estimatePopulationDensity(0, -140).peoplePerKm2).toBe(40);
  });

  it("finds cities, strategic targets, ZIP centroids, and pasted coordinates offline", async () => {
    await expect(searchNukemapLocations("New York, NY", 1)).resolves.toMatchObject([
      { kind: "city", name: "New York, NY", lat: 40.7128, lon: -74.006 },
    ]);
    await expect(searchNukemapLocations("Kozelsk", 1)).resolves.toMatchObject([
      { kind: "target", name: expect.stringContaining("Kozelsk") },
    ]);
    await expect(searchNukemapLocations("02134", 1)).resolves.toMatchObject([
      { kind: "zip", name: expect.stringContaining("02134"), lat: 42.357, lon: -71.113 },
    ]);
    await expect(searchNukemapLocations("35.68, 139.76")).resolves.toMatchObject([
      { kind: "coordinate", lat: 35.68, lon: 139.76 },
    ]);
  });
});
