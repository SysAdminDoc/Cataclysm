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
    expect(all.globe_style).toBe("esri-world-imagery");
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

  it("round-trips settings through export/import", async () => {
    await settings.setTheme("latte");
    await settings.setColormap("viridis");
    await settings.setGlobeStyle("osm");
    await settings.setRendererQuality("Cinematic");
    await settings.setRendererAutoQuality(false);

    const json = await settings.exportSettings();
    const parsed = JSON.parse(json);
    expect(parsed.theme).toBe("latte");
    expect(parsed.colormap).toBe("viridis");
    expect(parsed.globe_style).toBe("osm");
    expect(parsed.renderer_quality).toBe("Cinematic");
    expect(parsed.renderer_auto_quality).toBe(false);
    expect(parsed.cesium_token).toBeUndefined();

    await settings.resetAll();
    expect(await settings.getTheme()).toBe("mocha");

    const result = await settings.importSettings(json);
    expect(result.applied).toBeGreaterThanOrEqual(3);
    expect(await settings.getTheme()).toBe("latte");
    expect(await settings.getColormap()).toBe("viridis");
    expect(await settings.getGlobeStyle()).toBe("osm");
    expect(await settings.getRendererQuality()).toBe("Cinematic");
    expect(await settings.getRendererAutoQuality()).toBe(false);
  });

  it("fails closed to safe renderer defaults for invalid quality values", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.setItem(LS_PREFIX + "renderer_quality", JSON.stringify("Ultra"));
    localStorage.setItem(LS_PREFIX + "renderer_auto_quality", JSON.stringify("yes"));
    expect(await settings.getRendererQuality()).toBe("High");
    expect(await settings.getRendererAutoQuality()).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("import skips unknown keys with warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await settings.importSettings(
      JSON.stringify({ _schema_version: 1, theme: "latte", unknown_key: "value" }),
    );
    expect(result.applied).toBe(1);
    expect(result.skipped).toContain("unknown_key");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("import rejects non-object JSON", async () => {
    await expect(settings.importSettings('"just a string"')).rejects.toThrow(
      "Settings file must contain a JSON object.",
    );
    await expect(settings.importSettings("[1,2,3]")).rejects.toThrow(
      "Settings file must contain a JSON object.",
    );
  });

  it("import ignores prototype pollution keys", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await settings.importSettings(
      JSON.stringify({ __proto__: { polluted: true }, theme: "latte" }),
    );
    expect(result.applied).toBe(1);
    expect(Object.prototype).not.toHaveProperty("polluted");
    warnSpy.mockRestore();
  });
});
