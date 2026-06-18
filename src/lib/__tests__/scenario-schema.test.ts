import { describe, expect, it } from "vitest";
import {
  INITIAL_ASTEROID,
  INITIAL_EARTHQUAKE,
  INITIAL_NUCLEAR,
  SCENARIO_SCHEMA_VERSION,
  parseScenarioPayload,
} from "../scenario-schema";

describe("scenario schema", () => {
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
