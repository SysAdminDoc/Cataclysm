import { describe, expect, it } from "vitest";
import {
  INITIAL_ASTEROID,
  INITIAL_EARTHQUAKE,
  INITIAL_LANDSLIDE,
  INITIAL_NUCLEAR,
  SCENARIO_SCHEMA_VERSION,
  parseScenarioPayload,
  scenarioFromUrl,
  scenarioToUrlParams,
  sourceNumericDefault,
  validateSourceNumber,
  type ScientificSourceKind,
} from "../scenario-schema";
import sourceInputContract from "../../data/source-input-contract.json";

describe("scenario schema", () => {
  it("enforces every scientific input contract boundary and default", () => {
    expect(sourceInputContract.contractVersion).toBe(1);
    expect(sourceInputContract.scenarioSchemaVersion).toBe(SCENARIO_SCHEMA_VERSION);
    for (const [source, sourceDefinition] of Object.entries(sourceInputContract.sources)) {
      for (const [field, definition] of Object.entries(sourceDefinition.fields)) {
        expect(definition.label).not.toBe("");
        expect(definition.units).toBeDefined();
        if ("values" in definition) {
          expect(definition.values).toContain(definition.default);
          continue;
        }
        const sourceKind = source as ScientificSourceKind;
        expect(validateSourceNumber(sourceKind, field, definition.minimum)).toBeNull();
        expect(validateSourceNumber(sourceKind, field, definition.maximum)).toBeNull();
        expect(validateSourceNumber(sourceKind, field, Number.NaN)).not.toBeNull();
        expect(validateSourceNumber(sourceKind, field, definition.minimum - Math.max(1, Math.abs(definition.maximum - definition.minimum)) * Number.EPSILON * 8)).not.toBeNull();
        expect(validateSourceNumber(sourceKind, field, definition.maximum + Math.max(1, Math.abs(definition.maximum - definition.minimum)) * Number.EPSILON * 8)).not.toBeNull();
        expect(validateSourceNumber(sourceKind, field, sourceNumericDefault(sourceKind, field))).toBeNull();
      }
    }
  });

  it("migrates legacy unversioned scenario payloads", () => {
    const parsed = parseScenarioPayload({
      kind: "Nuclear",
      source: INITIAL_NUCLEAR,
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.migrated).toBe(true);
    expect(parsed.migrations).toEqual([{
      code: "schema-version-added",
      description: `added schemaVersion ${SCENARIO_SCHEMA_VERSION}`,
    }]);
    expect(parsed.payload.schemaVersion).toBe(SCENARIO_SCHEMA_VERSION);
    expect(parsed.scenario.kind).toBe("Nuclear");
  });

  it("defaults legacy earthquake fault dimensions when they are absent", () => {
    const earthquake = { ...INITIAL_EARTHQUAKE };
    delete earthquake.fault_length_m;
    delete earthquake.fault_width_m;
    const parsed = parseScenarioPayload({
      kind: "Earthquake",
      source: earthquake,
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.scenario.kind).toBe("Earthquake");
    if (parsed.scenario.kind !== "Earthquake") return;
    expect(parsed.scenario.source.fault_length_m).toBe(0);
    expect(parsed.scenario.source.fault_width_m).toBe(0);
  });

  it("rejects unsupported schema versions", () => {
    const payload = {
      schemaVersion: 99,
      kind: "Asteroid",
      source: structuredClone(INITIAL_ASTEROID),
    };
    const before = structuredClone(payload);
    const parsed = parseScenarioPayload(payload);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toMatch(/version 99/i);
    expect(payload).toEqual(before);
  });

  it("canonicalizes a matching version alias and reports the exact migration", () => {
    const parsed = parseScenarioPayload({
      version: SCENARIO_SCHEMA_VERSION,
      kind: "Asteroid",
      source: INITIAL_ASTEROID,
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload).not.toHaveProperty("version");
    expect(parsed.migrations).toEqual([{
      code: "version-alias-canonicalized",
      description: "canonicalized version to schemaVersion",
    }]);
  });

  it("removes a redundant matching version alias", () => {
    const parsed = parseScenarioPayload({
      schemaVersion: SCENARIO_SCHEMA_VERSION,
      version: SCENARIO_SCHEMA_VERSION,
      kind: "Nuclear",
      source: INITIAL_NUCLEAR,
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload).not.toHaveProperty("version");
    expect(parsed.migrations.map((migration) => migration.code)).toEqual([
      "version-alias-canonicalized",
    ]);
  });

  it("rejects conflicting version aliases without mutating the payload", () => {
    const payload = {
      schemaVersion: SCENARIO_SCHEMA_VERSION,
      version: SCENARIO_SCHEMA_VERSION + 1,
      kind: "Asteroid",
      source: structuredClone(INITIAL_ASTEROID),
    };
    const before = structuredClone(payload);
    const parsed = parseScenarioPayload(payload);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toMatch(/schemaVersion.*version.*conflict/i);
    expect(payload).toEqual(before);
  });

  it("rejects conflicting duplicate water depths", () => {
    const parsed = parseScenarioPayload({
      schemaVersion: SCENARIO_SCHEMA_VERSION,
      kind: "Asteroid",
      source: {
        ...INITIAL_ASTEROID,
        location: { ...INITIAL_ASTEROID.location, depth_m: INITIAL_ASTEROID.water_depth_m + 1 },
      },
    });

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toMatch(/water_depth_m.*conflicts.*location\.depth_m/i);
  });

  it.each([
    ["Asteroid", INITIAL_ASTEROID],
    ["Nuclear", INITIAL_NUCLEAR],
    ["Earthquake", INITIAL_EARTHQUAKE],
    ["Landslide", INITIAL_LANDSLIDE],
  ] as const)("round-trips %s payloads canonically", (kind, source) => {
    const parsed = parseScenarioPayload(JSON.parse(JSON.stringify({
      schemaVersion: SCENARIO_SCHEMA_VERSION,
      kind,
      source,
    })));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.migrated).toBe(false);
    expect(parsed.migrations).toEqual([]);
    expect(parsed.payload).toEqual({ schemaVersion: SCENARIO_SCHEMA_VERSION, kind, source });
  });

  it("rejects non-finite or out-of-range numeric payloads", () => {
    const parsed = parseScenarioPayload({
      kind: "Asteroid",
      source: {
        ...INITIAL_ASTEROID,
        diameter_m: 100_000,
      },
    });

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toMatch(/Diameter.*50,000/);
  });

  it("rejects invalid enum values", () => {
    const parsed = parseScenarioPayload({
      kind: "Nuclear",
      source: {
        ...INITIAL_NUCLEAR,
        burst_mode: "Unknown",
      },
    });

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toMatch(/Burst geometry/);
  });
});

describe("scenarioToUrlParams", () => {
  it("encodes preset id as ?preset=", () => {
    const result = scenarioToUrlParams("chicxulub", null);
    expect(result).toBe("?preset=chicxulub");
  });

  it("URL-encodes preset ids with special characters", () => {
    const result = scenarioToUrlParams("test & preset", null);
    expect(result).toBe("?preset=test%20%26%20preset");
  });

  it("returns empty string when no preset and no scenario", () => {
    expect(scenarioToUrlParams(null, null)).toBe("");
  });

  it("encodes a custom scenario as base64 ?scenario=", () => {
    const scenario = { kind: "Asteroid" as const, source: INITIAL_ASTEROID };
    const result = scenarioToUrlParams(null, scenario);
    expect(result).toMatch(/^\?scenario=/);
    const encoded = result.replace("?scenario=", "");
    const decoded = JSON.parse(atob(decodeURIComponent(encoded)));
    expect(decoded.kind).toBe("Asteroid");
    expect(decoded.schemaVersion).toBe(SCENARIO_SCHEMA_VERSION);
  });

  it("prefers preset over scenario when both provided", () => {
    const scenario = { kind: "Asteroid" as const, source: INITIAL_ASTEROID };
    const result = scenarioToUrlParams("chicxulub", scenario);
    expect(result).toBe("?preset=chicxulub");
  });
});

describe("scenarioFromUrl", () => {
  it("returns preset type for ?preset= param", () => {
    const result = scenarioFromUrl("?preset=tohoku");
    expect(result).toEqual({ type: "preset", presetId: "tohoku" });
  });

  it("returns none when no params", () => {
    expect(scenarioFromUrl("")).toEqual({ type: "none" });
    expect(scenarioFromUrl("?unrelated=true")).toEqual({ type: "none" });
  });

  it("decodes a valid ?scenario= param", () => {
    const scenario = { kind: "Nuclear" as const, source: INITIAL_NUCLEAR };
    const params = scenarioToUrlParams(null, scenario);
    const result = scenarioFromUrl(params);
    expect(result.type).toBe("scenario");
    if (result.type !== "scenario") return;
    expect(result.scenario.kind).toBe("Nuclear");
  });

  it("returns an actionable error for malformed base64 in ?scenario=", () => {
    expect(scenarioFromUrl("?scenario=not-valid-base64!!!")).toEqual({
      type: "invalid",
      reason: "The shared scenario link is malformed or corrupted.",
    });
  });

  it("returns an actionable error for valid base64 with invalid scenario JSON", () => {
    const encoded = btoa('{"kind":"Unknown","source":{}}');
    expect(scenarioFromUrl(`?scenario=${encoded}`)).toMatchObject({ type: "invalid" });
  });

  it("round-trips an asteroid scenario through URL encoding", () => {
    const original = { kind: "Asteroid" as const, source: INITIAL_ASTEROID };
    const params = scenarioToUrlParams(null, original);
    const restored = scenarioFromUrl(params);
    expect(restored.type).toBe("scenario");
    if (restored.type !== "scenario") return;
    expect(restored.scenario.kind).toBe("Asteroid");
    expect(restored.scenario.source).toEqual(INITIAL_ASTEROID);
  });

  it("rejects oversized scenario URL params", () => {
    const huge = "?scenario=" + "A".repeat(15_000);
    expect(scenarioFromUrl(huge)).toEqual({
      type: "invalid",
      reason: "The shared scenario is larger than the supported URL limit.",
    });
  });
});
