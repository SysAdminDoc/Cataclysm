import { afterEach, describe, it, expect, vi } from "vitest";
import { exportGeoJson, exportKml, suggestedFilename, type ScreenshotMeta, type RunupPoint } from "../export";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockDownload() {
  let captured: Blob | null = null;
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    captured = blob as Blob;
    return "blob:tsunamisim-test";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  return () => captured;
}

const SAMPLE_POINT: RunupPoint = {
  id: "tokyo",
  name: "Tokyo Bay",
  lat: 35.65,
  lon: 139.77,
  runup_m: 5.2,
  arrival_time_s: 3600,
  inundation_extent_m: 800,
  offshore_amplitude_m: 1.5,
};

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
    const getBlob = mockDownload();

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
    const captured = getBlob();
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

describe("exportKml", () => {
  it("returns false when no source and no runup points", () => {
    expect(exportKml({ timeS: 0 }, [])).toBe(false);
  });

  it("exports source placemark without cavity when radius is small", async () => {
    const getBlob = mockDownload();
    const meta: ScreenshotMeta = {
      preset: { id: "test", name: "Test Event", reference: "Ref 2024" } as never,
      initial: {
        center: { lat_deg: 21.4, lon_deg: -89.5 },
        cavity_radius_m: 200,
        peak_amplitude_m: 10,
      } as never,
      timeS: 0,
    };

    const ok = exportKml(meta, []);
    expect(ok).toBe(true);
    const kml = await getBlob()!.text();
    expect(kml).toContain("<?xml");
    expect(kml).toContain("Test Event");
    expect(kml).toContain("-89.5,21.4,0");
    expect(kml).not.toContain("Source cavity");
  });

  it("includes cavity polygon when radius exceeds 500 m", async () => {
    const getBlob = mockDownload();
    const meta: ScreenshotMeta = {
      preset: { id: "big", name: "Big Impact", reference: "" } as never,
      initial: {
        center: { lat_deg: 0, lon_deg: 0 },
        cavity_radius_m: 5000,
        peak_amplitude_m: 100,
      } as never,
      timeS: 0,
    };

    exportKml(meta, []);
    const kml = await getBlob()!.text();
    expect(kml).toContain("Source cavity");
    expect(kml).toContain("r=5 km");
  });

  it("includes runup points and escapes XML special characters", async () => {
    const getBlob = mockDownload();
    const meta: ScreenshotMeta = {
      preset: { id: "test", name: 'Test & "Quotes"', reference: "" } as never,
      initial: {
        center: { lat_deg: 0, lon_deg: 0 },
        cavity_radius_m: 100,
        peak_amplitude_m: 1,
      } as never,
      timeS: 600,
    };

    exportKml(meta, [SAMPLE_POINT]);
    const kml = await getBlob()!.text();
    expect(kml).toContain("Tokyo Bay");
    expect(kml).toContain("Runup: 5.2 m");
    expect(kml).toContain("Test &amp; &quot;Quotes&quot;");
    expect(kml).not.toContain("&\"");
  });

  it("skips runup points with non-finite or zero runup", () => {
    const getBlob = mockDownload();
    const meta: ScreenshotMeta = {
      initial: {
        center: { lat_deg: 0, lon_deg: 0 },
        cavity_radius_m: 100,
        peak_amplitude_m: 1,
      } as never,
      timeS: 0,
    };

    exportKml(meta, [
      { ...SAMPLE_POINT, runup_m: 0 },
      { ...SAMPLE_POINT, id: "nan", name: "NaN", runup_m: NaN },
      { ...SAMPLE_POINT, id: "inf", name: "Inf", runup_m: Infinity },
    ]);
    const blob = getBlob();
    expect(blob).not.toBeNull();
  });
});
