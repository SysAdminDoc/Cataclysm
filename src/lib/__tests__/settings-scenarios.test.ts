import { beforeEach, describe, expect, it } from "vitest";
import { settings } from "../settings";
import { INITIAL_ASTEROID, SCENARIO_SCHEMA_VERSION } from "../scenario-schema";

describe("settings scenario storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists saved scenarios as validated versioned payloads", async () => {
    await settings.saveScenario("Legacy asteroid", {
      kind: "Asteroid",
      source: INITIAL_ASTEROID,
    });

    const scenarios = await settings.getSavedScenarios();
    expect(scenarios).toHaveLength(1);
    expect((scenarios[0].data as { schemaVersion?: number }).schemaVersion).toBe(SCENARIO_SCHEMA_VERSION);
  });

  it("rejects invalid scenario payloads before writing to storage", async () => {
    await expect(settings.saveScenario("Bad asteroid", {
      kind: "Asteroid",
      source: {
        ...INITIAL_ASTEROID,
        diameter_m: 100_000,
      },
    })).rejects.toThrow(/Diameter/);

    expect(await settings.getSavedScenarios()).toEqual([]);
  });
});
