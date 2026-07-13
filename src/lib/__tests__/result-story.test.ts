import { describe, expect, it } from "vitest";
import type { RunupAtPointResult } from "../tauri";
import { buildCoastalOutcomeStory, formatOutcomeTime } from "../result-story";

function place(overrides: Partial<RunupAtPointResult>): RunupAtPointResult {
  return {
    id: "a",
    name: "Alpha",
    lat: 10,
    lon: 20,
    beach_slope_deg: 1,
    offshore_depth_m: 50,
    slope_provenance: {} as RunupAtPointResult["slope_provenance"],
    depth_provenance: {} as RunupAtPointResult["depth_provenance"],
    quantitative_confidence: "high",
    quantitative_label: "quantitative",
    range_m: 100_000,
    offshore_amplitude_m: 1,
    runup_m: 4,
    arrival_time_s: 600,
    has_arrived: true,
    inundation_extent_m: 100,
    ...overrides,
  };
}

describe("coastal outcome story", () => {
  it("separates maximum, first, nearest, reach, and current arrival count", () => {
    const story = buildCoastalOutcomeStory([
      place({ id: "max", name: "Maximum", runup_m: 12, arrival_time_s: 1_800, range_m: 300_000 }),
      place({ id: "first", name: "First", runup_m: 3, arrival_time_s: 300, range_m: 150_000 }),
      place({ id: "near", name: "Nearest", runup_m: 2, arrival_time_s: 900, range_m: 50_000 }),
    ], 1_000);
    expect(story.maximum?.id).toBe("max");
    expect(story.firstAffected?.id).toBe("first");
    expect(story.nearest?.id).toBe("near");
    expect(story.reachM).toBe(300_000);
    expect(story.arrivedCount).toBe(2);
    expect(story.affectedCount).toBe(3);
    expect(story.sampledCount).toBe(3);
  });

  it("fails to unavailable instead of narrating invalid numeric places", () => {
    const story = buildCoastalOutcomeStory([
      place({ range_m: Number.NaN }),
    ], 0);
    expect(story.sampledCount).toBe(0);
    expect(story.confidence).toBe("unavailable");
    expect(story.maximum).toBeNull();
  });

  it("does not call zero-effect registry points affected geographic reach", () => {
    const story = buildCoastalOutcomeStory([
      place({ id: "zero", runup_m: 0, range_m: 900_000 }),
      place({ id: "affected", runup_m: 0.2, range_m: 80_000 }),
    ], 10_000);
    expect(story.reachM).toBe(80_000);
    expect(story.firstAffected?.id).toBe("affected");
    expect(story.affectedCount).toBe(1);
    expect(story.sampledCount).toBe(2);
  });

  it("uses the lowest coastal confidence and formats relative time", () => {
    const story = buildCoastalOutcomeStory([
      place({ quantitative_confidence: "high" }),
      place({ id: "low", quantitative_confidence: "low" }),
    ], 0);
    expect(story.confidence).toBe("low");
    expect(story.limitation).toMatch(/illustrative/i);
    expect(formatOutcomeTime(5_700)).toBe("T+1 h 35 min");
  });

  it("breaks equal facts by stable id and treats negative time as no arrivals", () => {
    const story = buildCoastalOutcomeStory([
      place({ id: "z", name: "Zulu", runup_m: 5, range_m: 20_000, arrival_time_s: 200 }),
      place({ id: "a", name: "Alpha", runup_m: 5, range_m: 20_000, arrival_time_s: 200 }),
    ], -1);
    expect(story.maximum?.id).toBe("a");
    expect(story.firstAffected?.id).toBe("a");
    expect(story.nearest?.id).toBe("a");
    expect(story.arrivedCount).toBe(0);
  });

  it("rejects unnamed records from narration", () => {
    const story = buildCoastalOutcomeStory([
      place({ id: "", name: "" }),
    ], 1_000);
    expect(story.sampledCount).toBe(0);
  });
});
