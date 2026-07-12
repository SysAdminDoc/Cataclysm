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
    expect(DIRECT_SCENARIOS.length).toBeGreaterThanOrEqual(5);
    expect(new Set(DIRECT_SCENARIOS.map((scenario) => scenario.id)).size).toBe(DIRECT_SCENARIOS.length);
    for (const scenario of DIRECT_SCENARIOS) {
      expect(scenario.center.lat).toBeGreaterThanOrEqual(-90);
      expect(scenario.center.lat).toBeLessThanOrEqual(90);
      expect(scenario.center.lon).toBeGreaterThanOrEqual(-180);
      expect(scenario.center.lon).toBeLessThanOrEqual(180);
      expect(scenario.expectedHighlights.length).toBeGreaterThanOrEqual(3);
      expect(scenario.domain === "asteroid" ? scenario.asteroid : scenario.nuclear).toBeDefined();
    }
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
