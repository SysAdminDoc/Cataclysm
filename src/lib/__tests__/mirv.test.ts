import { describe, expect, it } from "vitest";
import { buildMirvPreview, generateMirvPattern, MIRV_PRESETS, mirvSpreadCircle, type MirvPreset } from "../mirv";

describe("MIRV pattern generation", () => {
  it("imports all preserved presets", () => {
    expect(MIRV_PRESETS).toHaveLength(8);
    expect(MIRV_PRESETS.map((preset) => preset.name)).toContain("RS-28 Sarmat");
  });

  it("matches the preserved Trident circle geometry and timing", () => {
    const preset = MIRV_PRESETS.find((candidate) => candidate.id === "trident-ii-w76")!;
    const points = generateMirvPattern({ lat: 0, lon: 0 }, preset);
    expect(points).toHaveLength(8);
    expect(points[0].lat).toBeCloseTo(-0.035972864, 8);
    expect(points[0].lon).toBeCloseTo(0, 10);
    expect(points.map((point) => point.delayMs)).toEqual([0, 200, 400, 600, 800, 1_000, 1_200, 1_400]);
  });

  it("preserves triangle, grid, and cross layout limits", () => {
    const base = { id: "test", name: "Test", spreadKm: 6, yieldKt: 100, description: "Test" };
    const pattern = (kind: MirvPreset["pattern"], warheads: number) => generateMirvPattern(
      { lat: 40, lon: -74 },
      { ...base, pattern: kind, warheads },
    );
    expect(pattern("triangle", 10)).toHaveLength(3);
    expect(pattern("grid", 7)).toHaveLength(7);
    expect(pattern("cross", 10)).toHaveLength(5);
    expect(pattern("cross", 5)[0]).toMatchObject({ lat: 40, lon: -74, delayMs: 0 });
  });

  it("builds a closed spread-circle preview and rejects unsafe polar centers", () => {
    const preview = buildMirvPreview({ lat: 40, lon: -74 }, MIRV_PRESETS[0]);
    const circle = mirvSpreadCircle(preview);
    expect(circle).toHaveLength(73);
    expect(circle[0]).toEqual(circle.at(-1));
    expect(() => buildMirvPreview({ lat: 89.5, lon: 0 }, MIRV_PRESETS[0])).toThrow(/±89° latitude/);
  });
});
