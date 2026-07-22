import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  settings,
  SETTINGS_SCHEMA_VERSION,
  SettingsTransactionError,
  type Settings,
} from "../settings";
import { INITIAL_ASTEROID, SCENARIO_SCHEMA_VERSION } from "../scenario-schema";

const LS_PREFIX = "tsunamisim.";
const SCHEMA_VERSION_KEY = "_settings_schema_version";

const TRANSACTION_BASELINE: Settings = {
  cesium_token: "old-token",
  theme: "mocha",
  locale: "en",
  units: "metric",
  globe_style: "osm",
  colormap: "cividis",
  renderer_quality: "Low",
  renderer_auto_quality: true,
  workspace_mode: "advanced",
  launch_experience_policy: "first",
  launch_experience_seen_at: "2026-07-01T00:00:00.000Z",
  disclaimer_acknowledged_at: "2026-07-02T00:00:00.000Z",
  tour_completed_at: "2026-07-03T00:00:00.000Z",
  lessons_completed: { baseline: "2026-07-04T00:00:00.000Z" },
  token_banner_dismissed_at: "2026-07-05T00:00:00.000Z",
  classroom_locked: true,
};

const APPLY_PATCH: Partial<Settings> = {
  cesium_token: "new-token",
  theme: "latte",
  locale: "ja",
  globe_style: "esri-world-imagery",
  colormap: "viridis",
  renderer_quality: "Cinematic",
  renderer_auto_quality: false,
  launch_experience_policy: "never",
};

async function expectCompleteRollback(action: () => Promise<void>): Promise<void> {
  let failure: unknown;
  try {
    await action();
  } catch (err) {
    failure = err;
  }
  expect(failure).toBeInstanceOf(SettingsTransactionError);
  expect(failure).toMatchObject({ rollbackStatus: "complete" });
  expect((failure as Error).message).toContain("All persisted values were restored.");
}

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

  it("deletes the correct saved scenario by stable id, not array position", async () => {
    await settings.saveScenario("First", { kind: "Asteroid", source: INITIAL_ASTEROID });
    await settings.saveScenario("Second", { kind: "Asteroid", source: INITIAL_ASTEROID });
    const before = await settings.getSavedScenarios();
    expect(before).toHaveLength(2);
    // Every saved scenario has a stable id.
    expect(before.every((s) => typeof s.id === "string" && s.id.length > 0)).toBe(true);
    // Delete the most-recent ("Second", index 0) by id; "First" must remain.
    const target = before.find((s) => s.name === "Second")!;
    await settings.deleteScenario(target.id);
    const after = await settings.getSavedScenarios();
    expect(after).toHaveLength(1);
    expect(after[0].name).toBe("First");
    // Ids are stable across reads (legacy backfill is deterministic).
    const reread = await settings.getSavedScenarios();
    expect(reread[0].id).toBe(after[0].id);
  });

  it("rolls a saved-scenario deletion back when persistence rejects", async () => {
    await settings.saveScenario("Keep me", { kind: "Asteroid", source: INITIAL_ASTEROID });
    const [scenario] = await settings.getSavedScenarios();
    const storageSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new Error("injected delete failure");
    });
    try {
      await expectCompleteRollback(() => settings.deleteScenario(scenario.id));
    } finally {
      storageSpy.mockRestore();
    }
    expect(await settings.getSavedScenarios()).toEqual([scenario]);
  });

  it("serializes delete, undo, and newer saves without losing identity or order", async () => {
    await settings.saveScenario("First", { kind: "Asteroid", source: INITIAL_ASTEROID });
    await settings.saveScenario("Second", { kind: "Asteroid", source: INITIAL_ASTEROID });
    const before = await settings.getSavedScenarios();
    const target = before[0];

    await Promise.all([
      settings.deleteScenario(target.id),
      settings.saveScenario("Newer", { kind: "Asteroid", source: INITIAL_ASTEROID }),
      settings.restoreScenario(target, { index: 0, afterId: before[1].id }),
    ]);

    const after = await settings.getSavedScenarios();
    expect(after.map((scenario) => scenario.name)).toEqual(["Newer", "Second", "First"]);
    expect(after[1]).toEqual(target);
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

  it("rejects conflicting duplicate physical fields before persistence", async () => {
    await expect(settings.saveScenario("Ambiguous asteroid", {
      schemaVersion: SCENARIO_SCHEMA_VERSION,
      kind: "Asteroid",
      source: {
        ...INITIAL_ASTEROID,
        location: { ...INITIAL_ASTEROID.location, depth_m: INITIAL_ASTEROID.water_depth_m + 1 },
      },
    })).rejects.toThrow(/water_depth_m.*conflicts.*location\.depth_m/i);

    expect(await settings.getSavedScenarios()).toEqual([]);
  });

  it("drops corrupted or unvalidated records on read", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.setItem(
      LS_PREFIX + "saved_scenarios",
      JSON.stringify([
        { name: "Good", savedAt: "2026-07-12T00:00:00.000Z", data: { schemaVersion: SCENARIO_SCHEMA_VERSION, kind: "Asteroid", source: INITIAL_ASTEROID } },
        { name: "Tampered", savedAt: "2026-07-12T00:00:00.000Z", data: { kind: "Asteroid", source: { ...INITIAL_ASTEROID, diameter_m: 100_000 } } },
        { name: "", savedAt: "2026-07-12T00:00:00.000Z", data: null },
        "not-an-object",
      ]),
    );

    const scenarios = await settings.getSavedScenarios();
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0].name).toBe("Good");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("dropped 3 invalid"));
    warnSpy.mockRestore();
  });

  it("upgrades the legacy saved-scenario array to a versioned envelope", async () => {
    localStorage.setItem(
      LS_PREFIX + "saved_scenarios",
      JSON.stringify([
        { name: "Legacy", savedAt: "2026-06-16T00:00:00.000Z", data: { kind: "Asteroid", source: INITIAL_ASTEROID } },
      ]),
    );

    const scenarios = await settings.getSavedScenarios();
    expect(scenarios).toHaveLength(1);
    const persisted = JSON.parse(localStorage.getItem(LS_PREFIX + "saved_scenarios")!);
    expect(persisted).toMatchObject({
      schemaVersion: 1,
      items: [{ name: "Legacy", id: expect.any(String) }],
    });
  });

  it("leaves a future saved-scenario envelope untouched and reports recovery", async () => {
    const future = JSON.stringify({ schemaVersion: 99, items: [{ preserved: true }] });
    localStorage.setItem(LS_PREFIX + "saved_scenarios", future);

    await expect(settings.getSavedScenarios()).rejects.toThrow(/newer than supported.*original data was left unchanged/i);
    expect(localStorage.getItem(LS_PREFIX + "saved_scenarios")).toBe(future);
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
    await settings.setLocale("id");
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

  it("fails closed without stamping a future settings schema down", async () => {
    localStorage.setItem(LS_PREFIX + SCHEMA_VERSION_KEY, JSON.stringify(99));
    localStorage.setItem(LS_PREFIX + "theme", JSON.stringify("latte"));

    await expect(settings.getTheme()).rejects.toThrow(/newer than supported.*original data was left unchanged/i);
    expect(JSON.parse(localStorage.getItem(LS_PREFIX + SCHEMA_VERSION_KEY)!)).toBe(99);
    expect(JSON.parse(localStorage.getItem(LS_PREFIX + "theme")!)).toBe("latte");
  });

  it("round-trips settings through export/import", async () => {
    await settings.setTheme("latte");
    await settings.setLocale("id");
    await settings.setColormap("viridis");
    await settings.setGlobeStyle("osm");
    await settings.setRendererQuality("Cinematic");
    await settings.setRendererAutoQuality(false);
    await settings.setWorkspaceMode("advanced");

    const json = await settings.exportSettings();
    const parsed = JSON.parse(json);
    expect(parsed.theme).toBe("latte");
    expect(parsed.locale).toBe("id");
    expect(parsed.colormap).toBe("viridis");
    expect(parsed.globe_style).toBe("osm");
    expect(parsed.renderer_quality).toBe("Cinematic");
    expect(parsed.renderer_auto_quality).toBe(false);
    expect(parsed.workspace_mode).toBe("advanced");
    expect(parsed.cesium_token).toBeUndefined();

    await settings.resetAll();
    expect(await settings.getTheme()).toBe("mocha");

    const result = await settings.importSettings(json);
    expect(result.applied).toBeGreaterThanOrEqual(3);
    expect(await settings.getTheme()).toBe("latte");
    expect(await settings.getLocale()).toBe("id");
    expect(await settings.getColormap()).toBe("viridis");
    expect(await settings.getGlobeStyle()).toBe("osm");
    expect(await settings.getRendererQuality()).toBe("Cinematic");
    expect(await settings.getRendererAutoQuality()).toBe(false);
    expect(await settings.getWorkspaceMode()).toBe("advanced");
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
    expect(result.applied).toBeGreaterThan(1);
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

  it("rejects future and oversized settings imports before applying values", async () => {
    await expect(settings.importSettings(JSON.stringify({
      _schema_version: SETTINGS_SCHEMA_VERSION + 1,
      theme: "latte",
    }))).rejects.toThrow(/newer than supported/);
    expect(await settings.getTheme()).toBe("mocha");

    await expect(settings.importSettings(JSON.stringify({
      theme: "latte",
      padding: "x".repeat(256 * 1024),
    }))).rejects.toThrow(/256 KB/);
    expect(await settings.getTheme()).toBe("mocha");
  });

  it("import ignores prototype pollution keys", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await settings.importSettings(
      JSON.stringify({ __proto__: { polluted: true }, theme: "latte" }),
    );
    expect(result.applied).toBeGreaterThan(1);
    expect(Object.prototype).not.toHaveProperty("polluted");
    warnSpy.mockRestore();
  });
});

describe("settings browser transactions", () => {
  beforeEach(async () => {
    localStorage.clear();
    await settings.apply(TRANSACTION_BASELINE);
  });

  it.each(Object.keys(APPLY_PATCH))(
    "rolls back every value when Apply fails while writing %s",
    async (failedKey) => {
      const originalSetItem = Storage.prototype.setItem;
      const setSpy = vi.spyOn(Storage.prototype, "setItem");
      const failedIndex = Object.keys(APPLY_PATCH).indexOf(failedKey);
      for (let index = 0; index < failedIndex; index += 1) {
        setSpy.mockImplementationOnce(originalSetItem);
      }
      setSpy.mockImplementationOnce(() => {
        throw new Error(`injected ${failedKey} write failure`);
      });

      try {
        await expectCompleteRollback(() => settings.apply(APPLY_PATCH));
      } finally {
        setSpy.mockRestore();
      }
      expect(await settings.loadAll()).toEqual(TRANSACTION_BASELINE);
    },
  );

  it.each([...Object.keys(TRANSACTION_BASELINE), SCHEMA_VERSION_KEY])(
    "rolls back reset when clearing %s fails",
    async (failedKey) => {
      const isSchemaWrite = failedKey === SCHEMA_VERSION_KEY;
      if (isSchemaWrite) {
        const storageSpy = vi.spyOn(Storage.prototype, "setItem");
        storageSpy.mockImplementationOnce(() => {
          throw new Error(`injected ${failedKey} reset failure`);
        });
        try {
          await expectCompleteRollback(() => settings.resetAll());
        } finally {
          storageSpy.mockRestore();
        }
      } else {
        const originalRemoveItem = Storage.prototype.removeItem;
        const storageSpy = vi.spyOn(Storage.prototype, "removeItem");
        const failedIndex = Object.keys(TRANSACTION_BASELINE).indexOf(failedKey);
        for (let index = 0; index < failedIndex; index += 1) {
          storageSpy.mockImplementationOnce(originalRemoveItem);
        }
        storageSpy.mockImplementationOnce(() => {
          throw new Error(`injected ${failedKey} reset failure`);
        });
        try {
          await expectCompleteRollback(() => settings.resetAll());
        } finally {
          storageSpy.mockRestore();
        }
      }
      expect(await settings.loadAll()).toEqual(TRANSACTION_BASELINE);
    },
  );

  it("reports an incomplete rollback instead of claiming recovery", async () => {
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    storageSpy
      .mockImplementationOnce(() => {
        throw new Error("injected primary write failure");
      })
      .mockImplementationOnce(() => {
        throw new Error("injected rollback failure");
      });

    let failure: unknown;
    try {
      await settings.apply(APPLY_PATCH);
    } catch (err) {
      failure = err;
    } finally {
      storageSpy.mockRestore();
    }
    expect(failure).toBeInstanceOf(SettingsTransactionError);
    expect(failure).toMatchObject({ rollbackStatus: "failed" });
    expect((failure as Error).message).toContain("Rollback failed in 1 storage operation");
  });
});
