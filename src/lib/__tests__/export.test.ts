import { afterEach, describe, it, expect, vi } from "vitest";
import { exportGeoJson, suggestedFilename, type ScreenshotMeta } from "../export";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("suggestedFilename", () => {
  it("generates a filename with preset id", () => {
    const meta: ScreenshotMeta = {
      preset: { id: "chicxulub", name: "Chicxulub" } as never,
      timeS: 900,
    };
    const name = suggestedFilename(meta, "png");
    expect(name).toMatch(/^tsunamisim-chicxulub-t15min-.*\.png$/);
  });

  it("uses 'custom-scenario' when no preset", () => {
    const meta: ScreenshotMeta = { timeS: 1800 };
    const name = suggestedFilename(meta);
    expect(name).toContain("custom-scenario");
    expect(name).toContain("t30min");
    expect(name).toMatch(/\.png$/);
  });

  it("sanitizes unsafe characters in preset id", () => {
    const meta: ScreenshotMeta = {
      preset: { id: 'test<>:"/\\|?*name', name: "Test" } as never,
      timeS: 0,
    };
    const name = suggestedFilename(meta);
    expect(name).not.toMatch(/[<>:"/\\|?*]/);
  });

  it("handles Windows reserved device names", () => {
    const meta: ScreenshotMeta = {
      preset: { id: "CON", name: "CON" } as never,
      timeS: 0,
    };
    const name = suggestedFilename(meta);
    expect(name).toContain("_CON");
  });

  it("supports different extensions", () => {
    const meta: ScreenshotMeta = { timeS: 0 };
    expect(suggestedFilename(meta, "webm")).toMatch(/\.webm$/);
    expect(suggestedFilename(meta, "mp4")).toMatch(/\.mp4$/);
  });

  it("keeps exported GeoJSON coordinates finite near the poles", async () => {
    let captured: Blob | null = null;
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      captured = blob as Blob;
      return "blob:tsunamisim-test";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const ok = exportGeoJson(
      [{
        id: "north-pole",
        name: "North Pole",
        lat: 90,
        lon: 180,
        runup_m: Number.POSITIVE_INFINITY,
        arrival_time_s: Number.NaN,
        inundation_extent_m: Number.POSITIVE_INFINITY,
        offshore_amplitude_m: Number.NaN,
      }],
      { timeS: 0 },
    );

    expect(ok).toBe(true);
    expect(captured).not.toBeNull();
    const fc = JSON.parse(await captured!.text()) as {
      features: Array<{ geometry: { coordinates: number[][][] }; properties: Record<string, number | string> }>;
    };
    const coords = fc.features[0].geometry.coordinates[0];
    expect(coords.length).toBeGreaterThan(4);
    for (const [lon, lat] of coords) {
      expect(Number.isFinite(lon)).toBe(true);
      expect(Number.isFinite(lat)).toBe(true);
      expect(lon).toBeGreaterThanOrEqual(-180);
      expect(lon).toBeLessThanOrEqual(180);
      expect(lat).toBeGreaterThanOrEqual(-90);
      expect(lat).toBeLessThanOrEqual(90);
    }
    expect(fc.features[0].properties.runup_m).toBe(0);
    expect(fc.features[0].properties.arrival_time_s).toBe(0);
  });
});
