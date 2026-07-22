import { describe, expect, it } from "vitest";
import priorSettings from "./fixtures/settings-prior-schemas.json";
import legacyScenarios from "./fixtures/saved-scenarios-v0.json";
import legacyRunArchive from "./fixtures/run-archive-v0.json";
import {
  USER_DATA_MIGRATIONS,
  UserDataMigrationError,
  currentUserDataSchemaVersion,
  migrateRunArchiveData,
  migrateSavedScenariosData,
  migrateSettingsData,
} from "../user-data-migrations";

describe("user-data migration registry", () => {
  it.each(priorSettings)(
    "upgrades settings schema $schemaVersion without losing existing values",
    ({ schemaVersion, data }) => {
      const original = structuredClone(data) as Record<string, unknown>;
      const result = migrateSettingsData(schemaVersion, data);

      expect(result.schemaVersion).toBe(currentUserDataSchemaVersion("settings"));
      expect(result.data).toMatchObject(original);
      expect(data).toEqual(original);
      expect(result.data).toMatchObject({
        renderer_quality: expect.any(String),
        renderer_auto_quality: expect.any(Boolean),
        launch_experience_policy: expect.any(String),
        workspace_mode: expect.any(String),
        locale: expect.any(String),
        units: expect.any(String),
      });

      const repeated = migrateSettingsData(result.schemaVersion, result.data);
      expect(repeated.data).toEqual(result.data);
      expect(repeated.migrations).toEqual([]);
    },
  );

  it("upgrades legacy saved scenarios and run records from golden fixtures", () => {
    const scenarioOriginal = structuredClone(legacyScenarios);
    const scenarioResult = migrateSavedScenariosData(legacyScenarios);
    expect(scenarioResult).toMatchObject({
      schemaVersion: 1,
      data: { items: scenarioOriginal },
    });
    expect(legacyScenarios).toEqual(scenarioOriginal);

    const archiveOriginal = structuredClone(legacyRunArchive);
    const archiveResult = migrateRunArchiveData(legacyRunArchive);
    expect(archiveResult).toMatchObject({
      schemaVersion: 1,
      data: { records: archiveOriginal },
    });
    expect(legacyRunArchive).toEqual(archiveOriginal);
  });

  it("keeps every registry step contiguous and described", () => {
    expect(USER_DATA_MIGRATIONS.length).toBeGreaterThan(0);
    for (const migration of USER_DATA_MIGRATIONS) {
      expect(migration.toVersion).toBe(migration.fromVersion + 1);
      expect(migration.description.trim()).not.toBe("");
    }
  });

  it.each(["settings", "savedScenarios", "runArchive"] as const)(
    "fails closed for future %s data without mutating it",
    (domain) => {
      const current = currentUserDataSchemaVersion(domain);
      const action = domain === "settings"
        ? () => migrateSettingsData(current + 1, { preserved: true })
        : domain === "savedScenarios"
          ? () => migrateSavedScenariosData({ schemaVersion: current + 1, items: [{ preserved: true }] })
          : () => migrateRunArchiveData({ schemaVersion: current + 1, records: [{ preserved: true }] });

      expect(action).toThrow(UserDataMigrationError);
      expect(action).toThrow(/original data was left unchanged/i);
    },
  );
});
