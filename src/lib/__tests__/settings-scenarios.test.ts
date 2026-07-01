import { beforeEach, describe, expect, it, vi } from "vitest";
import { settings, SETTINGS_SCHEMA_VERSION } from "../settings";
import { INITIAL_ASTEROID, SCENARIO_SCHEMA_VERSION } from "../scenario-schema";

const LS_PREFIX = "tsunamisim.";
const SCHEMA_VERSION_KEY = "_settings_schema_version";

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

describe("settings schema versioning", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stamps schema version on first read from unversioned localStorage", async () => {
    localStorage.setItem(LS_PREFIX + "theme", JSON.stringify("latte"));
    expect(localStorage.getItem(LS_PREFIX + SCHEMA_VERSION_KEY)).toBeNull();

    const theme = await settings.getTheme();
    expect(theme).toBe("latte");
    expect(JSON.parse(localStorage.getItem(LS_PREFIX + SCHEMA_VERSION_KEY)!)).toBe(
      SETTINGS_SCHEMA_VERSION,
    );
  });

  it("migrates legacy unversioned settings preserving existing values", async () => {
    localStorage.setItem(LS_PREFIX + "theme", JSON.stringify("latte"));
    localStorage.setItem(LS_PREFIX + "colormap", JSON.stringify("cividis"));

    const all = await settings.loadAll();
    expect(all.theme).toBe("latte");
    expect(all.colormap).toBe("cividis");
    expect(all.globe_style).toBe("natural-earth-2");
    expect(JSON.parse(localStorage.getItem(LS_PREFIX + SCHEMA_VERSION_KEY)!)).toBe(
      SETTINGS_SCHEMA_VERSION,
    );
  });

  it("falls back to defaults for unrecognised values with diagnostics", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.setItem(LS_PREFIX + "theme", JSON.stringify("neon-pink"));

    const theme = await settings.getTheme();
    expect(theme).toBe("mocha");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("unrecognised value"),
    );
    warnSpy.mockRestore();
  });

  it("preserves schema version after resetAll", async () => {
    await settings.setTheme("latte");
    expect(JSON.parse(localStorage.getItem(LS_PREFIX + SCHEMA_VERSION_KEY)!)).toBe(
      SETTINGS_SCHEMA_VERSION,
    );

    await settings.resetAll();
    expect(localStorage.getItem(LS_PREFIX + "theme")).toBeNull();
    expect(JSON.parse(localStorage.getItem(LS_PREFIX + SCHEMA_VERSION_KEY)!)).toBe(
      SETTINGS_SCHEMA_VERSION,
    );
  });

  it("persists guided lesson completion timestamps", async () => {
    await settings.markLessonCompleted("chicxulub-extinction", "2026-07-01T00:00:00.000Z");

    expect(await settings.getLessonCompletions()).toEqual({
      "chicxulub-extinction": "2026-07-01T00:00:00.000Z",
    });
    expect(JSON.parse(localStorage.getItem(LS_PREFIX + "lessons_completed")!)).toEqual({
      "chicxulub-extinction": "2026-07-01T00:00:00.000Z",
    });
  });

  it("does not re-migrate when version already matches", async () => {
    localStorage.setItem(
      LS_PREFIX + SCHEMA_VERSION_KEY,
      JSON.stringify(SETTINGS_SCHEMA_VERSION),
    );
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    await settings.getTheme();
    expect(infoSpy).not.toHaveBeenCalled();
    infoSpy.mockRestore();
  });
});
