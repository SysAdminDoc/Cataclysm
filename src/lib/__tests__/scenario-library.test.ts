import { beforeEach, describe, expect, it } from "vitest";
import {
  DIRECT_SCENARIOS,
  loadScenarioLibraryPreferences,
  recordRecentScenario,
  saveScenarioLibraryPreferences,
  toggleFavoriteScenario,
} from "../scenario-library";

describe("scenario library", () => {
  beforeEach(() => localStorage.clear());

  it("keeps every direct preset complete and domain-specific", () => {
    expect(DIRECT_SCENARIOS).toHaveLength(21);
    expect(new Set(DIRECT_SCENARIOS.map((scenario) => scenario.id)).size).toBe(DIRECT_SCENARIOS.length);
    for (const scenario of DIRECT_SCENARIOS) {
      expect(scenario.center.lat).toBeGreaterThanOrEqual(-90);
      expect(scenario.center.lat).toBeLessThanOrEqual(90);
      expect(scenario.center.lon).toBeGreaterThanOrEqual(-180);
      expect(scenario.center.lon).toBeLessThanOrEqual(180);
      expect(scenario.expectedHighlights.length).toBeGreaterThanOrEqual(3);
      expect(scenario.domain === "asteroid" ? scenario.asteroid : scenario.nuclear).toBeDefined();
    }
    const recorded = DIRECT_SCENARIOS.filter((scenario) => scenario.classification === "recorded");
    expect(recorded).toHaveLength(16);
    expect(recorded.filter((scenario) => scenario.domain === "nuclear")).toHaveLength(10);
    expect(recorded.filter((scenario) => scenario.domain === "asteroid")).toHaveLength(6);
    expect(recorded.find((scenario) => scenario.name === "Starfish Prime")?.nuclear).toMatchObject({
      yieldKt: 1_400,
      burstType: "hemp",
      heightM: 400_000,
    });
    expect(recorded.find((scenario) => scenario.name === "Chelyabinsk")?.asteroid).toMatchObject({
      diameterM: 19,
      velocityKmS: 19,
      angleDeg: 18,
    });
  });

  it("persists bounded recent and favorite scenario state", () => {
    let preferences = loadScenarioLibraryPreferences();
    preferences = recordRecentScenario(preferences, "preset:tohoku_2011");
    preferences = recordRecentScenario(preferences, "direct:nuclear-tokyo");
    preferences = recordRecentScenario(preferences, "preset:tohoku_2011");
    preferences = toggleFavoriteScenario(preferences, "preset:tohoku_2011");
    saveScenarioLibraryPreferences(preferences);

    expect(loadScenarioLibraryPreferences()).toEqual({
      recentIds: ["preset:tohoku_2011", "direct:nuclear-tokyo"],
      favoriteIds: ["preset:tohoku_2011"],
    });
  });
});
