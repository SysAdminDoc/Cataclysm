import { afterEach, describe, it, expect, vi } from "vitest";
import { encodeSpreadsheetSafeCsvText, exportCzml, exportGaugeCsv, exportGeoJson, exportKml, exportRunupCsv, preflightRunQuality, suggestedFilename, type ScreenshotMeta, type RunupPoint } from "../export";
import type { GaugeTimeSeries } from "../../types/scenario";
import { IDEALIZED_SEA_SURFACE_HEIGHT_FIELD } from "../geodesy";
import { getCoastalPoints } from "../data";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("run-quality export preflight", () => {
  it("blocks invalid runs while allowing warning-stamped output", () => {
    const quality = {
      status: "warning" as const,
      finite_fields: true,
      minimum_total_depth_m: 1,
      cfl_number: 0.8,
      cfl_margin: 0.2,
      accepted_steps: 10,
      rejected_steps: 0,
      mass_drift_pct: 6,
      energy_drift_pct: -2,
      sponge_width_cells: 10,
      warnings: ["mass drift"],
      failure: null,
    };
    expect(preflightRunQuality({ runQuality: quality })).toEqual({ ok: true });
    expect(preflightRunQuality({ runQuality: { ...quality, status: "failed", failure: "non-finite field" } })).toEqual({
      ok: false,
      reason: "non-finite field",
    });
  });
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

const COASTAL = getCoastalPoints()[0];
const SAMPLE_POINT: RunupPoint = {
  id: "tokyo",
  name: "Tokyo Bay",
  lat: 35.65,
  lon: 139.77,
  runup_m: 5.2,
  arrival_time_s: 3600,
  inundation_extent_m: 800,
  offshore_amplitude_m: 1.5,
  beach_slope_deg: COASTAL.beach_slope_deg,
  offshore_depth_m: COASTAL.offshore_depth_m,
  slope_provenance: COASTAL.slope_provenance,
  depth_provenance: COASTAL.depth_provenance,
  quantitative_confidence: "low",
  quantitative_label: "illustrative",
};

const PROVENANCE_META: ScreenshotMeta = {
  generatedAt: "2026-06-28T00:00:00.000Z",
  initial: {
    center: { lat_deg: 21.4, lon_deg: -89.5, depth_m: 1500 },
    cavity_radius_m: 50_000,
    label: "Chicxulub",
    peak_amplitude_m: 1500,
    seismic_mw_equivalent: 12.5,
    source_energy_j: 4.2e23,
  },
  preset: {
    date: "66 Ma",
    id: "chicxulub",
    name: "Chicxulub Impact",
    reference: "Range 2022",
    reference_url: "https://doi.org/10.1029/2021AV000627",
    source: { kind: "Asteroid", source: {} },
  } as never,
  scenarioKind: "Asteroid",
  solverMode: "SWE snapshot playback",
  timeS: 900,
};

describe("suggestedFilename", () => {
  it("generates a filename with preset id", () => {
    const meta: ScreenshotMeta = {
      preset: { id: "chicxulub", name: "Chicxulub" } as never,
      timeS: 900,
    };
    const name = suggestedFilename(meta, "png");
    expect(name).toMatch(/^cataclysm-chicxulub-t15min-.*\.png$/);
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
        ...SAMPLE_POINT,
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

  it("writes shared provenance into GeoJSON feature collections", async () => {
    const getBlob = mockDownload();

    const ok = exportGeoJson([SAMPLE_POINT], PROVENANCE_META);

    expect(ok).toBe(true);
    const fc = JSON.parse(await getBlob()!.text()) as { properties: Record<string, string | number | null> };
    expect(fc.properties.app_version).toBe("0.10.2");
    expect(fc.properties.generated_at).toBe("2026-06-28T00:00:00.000Z");
    expect(fc.properties.scenario_type).toBe("Asteroid");
    expect(fc.properties.solver_mode).toBe("SWE snapshot playback");
    const featureCollection = JSON.parse(await getBlob()!.text()) as { features: Array<{ properties: Record<string, unknown> }> };
    expect(featureCollection.features[0].properties.slope_record_id).toBe("slope:legacy-curated-v1");
    expect(featureCollection.features[0].properties.depth_record_id).toBe("depth:nominal-isobath-v1");
    expect(fc.properties.citation_url).toBe("https://doi.org/10.1029/2021AV000627");
    expect(fc.properties.bathymetry_source).toContain("Low-confidence coarse basin/shelf approximation");
    expect(fc.properties.bathymetry_source).toContain("GEBCO_2026/TID raster sampling is not bundled");
    expect(fc.properties.model_notice).toContain("Educational model only");
  });
});

describe("exportCzml", () => {
  it("writes shared provenance into the document and wave-field packets", async () => {
    const getBlob = mockDownload();

    const ok = exportCzml(PROVENANCE_META, [
      {
        bbox: [-90, 20, -88, 22],
        eta_abs_max_m: 1,
        eta_max_m: 1,
        eta_min_m: -1,
        eta_png_b64: "abc",
        nx: 2,
        ny: 2,
        height_field: IDEALIZED_SEA_SURFACE_HEIGHT_FIELD,
        time_s: 0,
      },
    ]);

    expect(ok).toBe(true);
    const czml = JSON.parse(await getBlob()!.text()) as Array<{
      description?: string;
      id: string;
      properties?: Record<string, string | null>;
    }>;
    expect(czml[0].description).toContain("Scenario type: Asteroid");
    expect(czml[1].properties?.appVersion).toBe("0.10.2");
    expect(czml[1].properties?.solverMode).toBe("SWE snapshot playback");
    expect(czml[1].properties?.citationUrl).toBe("https://doi.org/10.1029/2021AV000627");
  });

  it("emits a spec-correct time-tagged image material with transparency", async () => {
    const getBlob = mockDownload();
    exportCzml(PROVENANCE_META, [
      { bbox: [-90, 20, -88, 22], eta_abs_max_m: 1, eta_max_m: 1, eta_min_m: -1, eta_png_b64: "a", nx: 2, ny: 2, height_field: IDEALIZED_SEA_SURFACE_HEIGHT_FIELD, time_s: 0 },
      { bbox: [-90, 20, -88, 22], eta_abs_max_m: 1, eta_max_m: 1, eta_min_m: -1, eta_png_b64: "b", nx: 2, ny: 2, height_field: IDEALIZED_SEA_SURFACE_HEIGHT_FIELD, time_s: 60 },
    ]);
    const czml = JSON.parse(await getBlob()!.text()) as Array<{
      id: string;
      rectangle?: { material?: { image?: { image?: Array<Record<string, unknown>>; repeat?: unknown; color?: unknown; transparent?: boolean } } };
    }>;
    const image = czml[1].rectangle?.material?.image;
    // repeat/color/transparent live at the ImageMaterial level, not inside intervals.
    expect(image?.transparent).toBe(true);
    expect(image?.repeat).toBeDefined();
    expect(image?.color).toBeDefined();
    // The time-tagged image property is an array of { interval, image } only.
    expect(Array.isArray(image?.image)).toBe(true);
    expect(image?.image).toHaveLength(2);
    expect(Object.keys(image!.image![0]).sort()).toEqual(["image", "interval"]);
    expect(image?.image?.[0].image).toContain("data:image/png;base64,a");
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
    expect(kml).toContain("Runup: ~5.2 m");
    expect(kml).toContain("slope:legacy-curated-v1");
    expect(kml).toContain("depth:nominal-isobath-v1");
    expect(kml).toContain("Test &amp; &quot;Quotes&quot;");
    expect(kml).not.toContain("&\"");
  });

  it("writes shared provenance into KML descriptions", async () => {
    const getBlob = mockDownload();

    exportKml(PROVENANCE_META, [SAMPLE_POINT]);

    const kml = await getBlob()!.text();
    expect(kml).toContain("Cataclysm v0.10.2");
    expect(kml).toContain("Scenario type: Asteroid");
    expect(kml).toContain("Solver mode: SWE snapshot playback");
    expect(kml).toContain("https://doi.org/10.1029/2021AV000627");
    expect(kml).toContain("Educational model only");
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

describe("exportRunupCsv", () => {
  it("preserves exact slope and depth record identifiers", async () => {
    const getBlob = mockDownload();
    expect(exportRunupCsv([SAMPLE_POINT])).toBe(true);
    const csv = await getBlob()!.text();
    expect(csv).toContain("slope_sample_id,slope_record_id");
    expect(csv).toContain("miyako_jp:slope,slope:legacy-curated-v1");
    expect(csv).toContain("miyako_jp:depth,depth:nominal-isobath-v1");
  });
});

describe("exportGaugeCsv", () => {
  it.each([
    ["=1+1", "'=1+1"],
    ["+SUM(1,1)", "\"'+SUM(1,1)\""],
    ["-2+3", "'-2+3"],
    ["@SUM(A1:A2)", "'@SUM(A1:A2)"],
    ["\t=1+1", "\"'\t=1+1\""],
    ["\r=1+1", "\"'\r=1+1\""],
    ["\n=1+1", "\"'\n=1+1\""],
    ["＝1+1", "'＝1+1"],
    ["＋SUM(A1:A2)", "'＋SUM(A1:A2)"],
    ["－2+3", "'－2+3"],
    ["＠SUM(A1:A2)", "'＠SUM(A1:A2)"],
  ])("neutralizes spreadsheet formula initiator %j", (input, expected) => {
    expect(encodeSpreadsheetSafeCsvText(input)).toBe(expected);
  });

  it("leaves ordinary text and numeric-looking text unchanged", () => {
    expect(encodeSpreadsheetSafeCsvText("Tokyo Bay")).toBe("Tokyo Bay");
    expect(encodeSpreadsheetSafeCsvText("12.5")).toBe("12.5");
  });

  it("exports CSV with correct headers and row format", async () => {
    const getBlob = mockDownload();
    const series: GaugeTimeSeries[] = [
      {
        gauge: { id: "g1", name: "Tokyo Bay", lat_deg: 35.65, lon_deg: 139.77 },
        samples: [
          { time_s: 0, eta_m: 0 },
          { time_s: 150, eta_m: 1.234 },
          { time_s: 300, eta_m: 0.5678 },
        ],
      },
    ];

    const ok = exportGaugeCsv(series, "Browser preview", "Coarse basin/shelf");
    expect(ok).toBe(true);

    const csv = await getBlob()!.text();
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("gauge_name,lat_deg,lon_deg,time_s,eta_m,solver_mode,bathymetry_source,horizontal_crs,vertical_datum,vertical_axis,run_quality,cfl_number,mass_drift_pct,energy_drift_pct");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain("Tokyo Bay");
    expect(lines[1]).toContain("35.65");
    expect(lines[1]).toContain("139.77");
    expect(lines[2]).toContain("1.2340");
    expect(lines[2]).toContain("EPSG:4326,idealized_mean_sea_level,positive_up");
  });

  it("returns false for empty series", () => {
    const ok = exportGaugeCsv([], "test", "test");
    expect(ok).toBe(false);
  });

  it("escapes commas in gauge names", async () => {
    const getBlob = mockDownload();
    const series: GaugeTimeSeries[] = [
      {
        gauge: { id: "g1", name: "Port, East Side", lat_deg: 0, lon_deg: 0 },
        samples: [{ time_s: 0, eta_m: 0 }],
      },
    ];

    exportGaugeCsv(series, "test", "test");
    const csv = await getBlob()!.text();
    expect(csv).toContain('"Port, East Side"');
  });

  it("neutralizes malicious gauge names and provenance text in the exported file", async () => {
    const getBlob = mockDownload();
    const series: GaugeTimeSeries[] = [
      {
        gauge: { id: "g1", name: "=HYPERLINK(\"https://invalid.example\")", lat_deg: -1, lon_deg: 2 },
        samples: [{ time_s: 0, eta_m: -0.25 }],
      },
    ];

    exportGaugeCsv(series, "+CMD", "＠external");
    const csv = await getBlob()!.text();
    expect(csv).toContain("\"'=HYPERLINK(\"\"https://invalid.example\"\")\"");
    expect(csv).toContain("'+CMD,'＠external");
    expect(csv).toContain(",-1,2,0.0,-0.2500,");
  });

  it("includes multiple gauges in a single CSV", async () => {
    const getBlob = mockDownload();
    const series: GaugeTimeSeries[] = [
      {
        gauge: { id: "g1", name: "Alpha", lat_deg: 10, lon_deg: 20 },
        samples: [{ time_s: 0, eta_m: 1 }],
      },
      {
        gauge: { id: "g2", name: "Bravo", lat_deg: 30, lon_deg: 40 },
        samples: [{ time_s: 0, eta_m: 2 }],
      },
      {
        gauge: { id: "g3", name: "Charlie", lat_deg: 50, lon_deg: 60 },
        samples: [{ time_s: 0, eta_m: 3 }],
      },
    ];

    exportGaugeCsv(series, "test", "test");
    const csv = await getBlob()!.text();
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain("Alpha");
    expect(lines[2]).toContain("Bravo");
    expect(lines[3]).toContain("Charlie");
  });
});
