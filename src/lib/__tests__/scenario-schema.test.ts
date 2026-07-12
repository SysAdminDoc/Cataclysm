import { describe, expect, it } from "vitest";
import {
  INITIAL_ASTEROID,
  INITIAL_EARTHQUAKE,
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
    const parsed = parseScenarioPayload({
      schemaVersion: 99,
      kind: "Asteroid",
      source: INITIAL_ASTEROID,
    });

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toMatch(/version 99/i);
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

  it("returns none for malformed base64 in ?scenario=", () => {
    expect(scenarioFromUrl("?scenario=not-valid-base64!!!")).toEqual({ type: "none" });
  });

  it("returns none for valid base64 but invalid scenario JSON", () => {
    const encoded = btoa('{"kind":"Unknown","source":{}}');
    expect(scenarioFromUrl(`?scenario=${encoded}`)).toEqual({ type: "none" });
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
    expect(scenarioFromUrl(huge)).toEqual({ type: "none" });
  });
});
