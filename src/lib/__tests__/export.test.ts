import { afterEach, describe, it, expect, vi } from "vitest";
import { buildDirectHazardCzml, buildDirectHazardGeoJson, buildDirectHazardKml, captureGlobePng, copyExportText, downloadBlob, downloadDataUrl, encodeSpreadsheetSafeCsvText, exportCzml, exportGaugeCsv, exportGeoJson, exportGlobeVideo, exportKml, exportRunupCsv, preflightRunQuality, suggestedFilename, type DirectHazardExportData, type ScreenshotMeta, type RunupPoint } from "../export";
import type { GaugeTimeSeries } from "../../types/scenario";
import type { HazardResult } from "../../hazards/types";
import { IDEALIZED_SEA_SURFACE_HEIGHT_FIELD } from "../geodesy";
import { getCoastalPoints } from "../data";
import { APP_VERSION } from "../model-provenance";

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
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

describe("direct-hazard GIS exports", () => {
  const result: HazardResult = {
    resultId: "result:test",
    kind: "nuclear",
    authority: "rust",
    modelVersion: "nuclear-direct-test",
    center: { lat: 40, lon: -74 },
    rings: [
      { label: "Fireball", radiusM: 500, color: "#f5e0dc", category: "fireball", description: "Everything within is vaporized." },
      { label: "5 psi", radiusM: 5_000, color: "#cba6f7", category: "blast" },
    ],
    readout: [{ label: "Yield", value: "100 kT" }],
    casualties: { deaths: 1_000, injuries: 2_000, childDeaths: 250, childInjuries: 500, populationDensity: 5_000 },
    detail: {
      yieldKt: 100,
      isSurface: true,
      isWater: false,
      fireball: 0.5,
      psi20: 1,
      psi5: 5,
      psi1: 10,
      thermal3: 7,
      thermal1: 12,
      radiation: 2,
      neutronRad: 1,
      gammaRad: 1,
      craterR: 0.4,
      cloudTopH: 12,
      optimalHeight: 0,
      waveHeight: 0,
      fallout: null,
      timeline: [],
      latentCancer: null,
    },
  };
  const meta: ScreenshotMeta = {
    unitSystem: "imperial",
    timeS: 30,
    fileId: "nuclear-test",
    scenarioName: "Nuclear <test>",
    scenarioKind: "Nuclear",
    solverMode: "Rust-authoritative direct hazard",
    citationReference: "Test reference",
    generatedAt: "2026-07-17T00:00:00.000Z",
  };
  const direct: DirectHazardExportData = {
    result,
    polygons: [{
      label: "Heavy fallout",
      color: "#f38ba8",
      points: [{ lat: 40, lon: -74 }, { lat: 40.1, lon: -73.9 }, { lat: 39.9, lon: -73.8 }, { lat: 40, lon: -74 }],
    }],
  };

  it("builds provenance-bearing GeoJSON effect and fallout polygons", () => {
    const geojson = buildDirectHazardGeoJson(meta, direct);
    expect(geojson.features).toHaveLength(4);
    expect(geojson.properties).toMatchObject({ authority: "rust", model_version: "nuclear-direct-test", display_unit_system: "imperial" });
    expect(geojson.features[1].geometry.type).toBe("Polygon");
    expect(geojson.features[1].geometry.coordinates[0]).toHaveLength(73);
    expect(geojson.features[3].properties.kind).toBe("hazard_polygon");
  });

  it("builds static CZML ellipses and supplied hazard polygons", () => {
    const czml = buildDirectHazardCzml(meta, direct);
    expect(czml).toHaveLength(5);
    expect(czml[0]).toMatchObject({ id: "document", version: "1.0" });
    expect(czml[2]).toMatchObject({ id: "effect-ring-1", ellipse: { semiMajorAxis: 500, semiMinorAxis: 500 } });
    expect(czml[4]).toMatchObject({ id: "hazard-polygon-1" });
  });

  it("builds escaped KML with effect and hazard folders", () => {
    const kml = buildDirectHazardKml(meta, direct);
    expect(kml).toContain("Cataclysm — Nuclear &lt;test&gt;");
    expect(kml).toContain("<name>Effect thresholds</name>");
    expect(kml).toContain("<name>Hazard polygons</name>");
    expect(kml).toContain("<value>5000</value>");
    expect(kml).toContain("<value>imperial</value>");
    expect(kml).toContain("Radius: 0.3 mi");
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

function mountGlobeCanvas(): HTMLCanvasElement {
  const host = document.createElement("div");
  host.className = "cesium-widget";
  const canvas = document.createElement("canvas");
  host.appendChild(canvas);
  document.body.appendChild(host);
  return canvas;
}

describe("typed export failures and cleanup", () => {
  it("removes the temporary anchor and revokes the object URL after a successful Blob download", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:cleanup-success");
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    expect(downloadBlob(new Blob(["ok"]), "result.txt")).toEqual({ ok: true });
    expect(document.querySelector("a[download]")).toBeNull();
    expect(revoke).toHaveBeenCalledWith("blob:cleanup-success");
  });

  it("returns a download failure and still releases resources when the browser click throws", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:cleanup-failure");
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw new Error("downloads denied");
    });

    expect(downloadBlob(new Blob(["no"]), "result.txt")).toMatchObject({
      ok: false,
      code: "download",
      retryable: true,
    });
    expect(document.querySelector("a[download]")).toBeNull();
    expect(revoke).toHaveBeenCalledWith("blob:cleanup-failure");
  });

  it("returns a download failure when object URL allocation throws", () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      throw new Error("object URLs unavailable");
    });
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    expect(downloadBlob(new Blob(["no"]), "result.txt")).toMatchObject({ ok: false, code: "download" });
    expect(revoke).not.toHaveBeenCalled();
  });

  it("reports a typed download failure when an explicit data-URL download throws", () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw new Error("download blocked");
    });

    expect(downloadDataUrl("data:text/plain,hello", "hello.txt")).toMatchObject({
      ok: false,
      code: "download",
    });
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("classifies canvas serialization failures without throwing", () => {
    const canvas = mountGlobeCanvas();
    vi.spyOn(canvas, "toDataURL").mockImplementation(() => {
      throw new DOMException("tainted", "SecurityError");
    });

    expect(captureGlobePng()).toMatchObject({ ok: false, code: "canvas", retryable: true });
  });

  it("classifies clipboard rejection and cancellation without unhandled promises", async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const writeText = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("permission denied"))
      .mockRejectedValueOnce(new DOMException("cancelled", "AbortError"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    try {
      await expect(copyExportText("first")).resolves.toMatchObject({ ok: false, code: "clipboard" });
      await expect(copyExportText("second")).resolves.toMatchObject({ ok: false, code: "cancelled" });
    } finally {
      if (original) Object.defineProperty(navigator, "clipboard", original);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("classifies captureStream failures as canvas failures", async () => {
    const canvas = mountGlobeCanvas();
    Object.defineProperty(canvas, "captureStream", {
      configurable: true,
      value: vi.fn(() => {
        throw new Error("capture unavailable");
      }),
    });
    class SupportedRecorder {
      static isTypeSupported() { return true; }
    }
    vi.stubGlobal("MediaRecorder", SupportedRecorder);

    await expect(exportGlobeVideo({ timeS: 0 }, { durationMs: 1_000 })).resolves.toMatchObject({
      ok: false,
      code: "canvas",
    });
  });

  it("returns a non-retryable codec failure when MediaRecorder is unavailable", async () => {
    mountGlobeCanvas();
    vi.stubGlobal("MediaRecorder", undefined);

    await expect(exportGlobeVideo({ timeS: 0 })).resolves.toMatchObject({
      ok: false,
      code: "codec",
      retryable: false,
    });
  });

  it("stops tracks and clears both timers when recording succeeds", async () => {
    vi.useFakeTimers();
    const canvas = mountGlobeCanvas();
    const stopTrack = vi.fn();
    Object.defineProperty(canvas, "captureStream", {
      configurable: true,
      value: vi.fn(() => ({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream)),
    });
    class SuccessfulRecorder {
      static isTypeSupported() { return true; }
      state: RecordingState = "inactive";
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      start() { this.state = "recording"; }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["video"]) } as BlobEvent);
        this.onstop?.();
      }
    }
    vi.stubGlobal("MediaRecorder", SuccessfulRecorder);
    mockDownload();

    const pending = exportGlobeVideo({ timeS: 0 }, { durationMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toMatchObject({ ok: true, ext: "webm" });
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops tracks and clears watchdogs when the recorder start call throws", async () => {
    vi.useFakeTimers();
    const canvas = mountGlobeCanvas();
    const stopTrack = vi.fn();
    Object.defineProperty(canvas, "captureStream", {
      configurable: true,
      value: vi.fn(() => ({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream)),
    });
    class ThrowingRecorder {
      static isTypeSupported() { return true; }
      state: RecordingState = "inactive";
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      start() { throw new DOMException("unsupported", "NotSupportedError"); }
      stop() { this.state = "inactive"; }
    }
    vi.stubGlobal("MediaRecorder", ThrowingRecorder);

    await expect(exportGlobeVideo({ timeS: 0 }, { durationMs: 1_000 })).resolves.toMatchObject({
      ok: false,
      code: "codec",
      retryable: false,
    });
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("handles an immediate recorder error without leaking timers, tracks, or a rejection", async () => {
    vi.useFakeTimers();
    const canvas = mountGlobeCanvas();
    const stopTrack = vi.fn();
    Object.defineProperty(canvas, "captureStream", {
      configurable: true,
      value: vi.fn(() => ({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream)),
    });
    class ErroringRecorder {
      static isTypeSupported() { return true; }
      state: RecordingState = "inactive";
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      start() {
        this.state = "recording";
        this.onerror?.();
      }
      stop() {
        this.state = "inactive";
        this.onstop?.();
      }
    }
    vi.stubGlobal("MediaRecorder", ErroringRecorder);

    await expect(exportGlobeVideo({ timeS: 0 }, { durationMs: 1_000 })).resolves.toMatchObject({
      ok: false,
      code: "codec",
      retryable: true,
    });
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

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
  unitSystem: "imperial",
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
  evidenceIds: ["scenario:preset:chicxulub", "result:preset:chicxulub:outcome"],
  layerState: [
    { id: "swe-field", visible: true, opacityPct: 65, order: 0 },
    { id: "arrival-isochrones", visible: false, opacityPct: 100, order: 1 },
  ],
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

    expect(ok.ok).toBe(true);
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

    expect(ok.ok).toBe(true);
    const fc = JSON.parse(await getBlob()!.text()) as { properties: Record<string, unknown> };
    expect(fc.properties.app_version).toBe(APP_VERSION);
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
    expect(fc.properties.layer_state).toEqual(PROVENANCE_META.layerState);
    expect(fc.properties.display_unit_system).toBe("imperial");
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

    expect(ok.ok).toBe(true);
    const czml = JSON.parse(await getBlob()!.text()) as Array<{
      description?: string;
      id: string;
      properties?: Record<string, unknown>;
    }>;
    expect(czml[0].description).toContain("Scenario type: Asteroid");
    expect(czml[1].properties?.appVersion).toBe(APP_VERSION);
    expect(czml[1].properties?.solverMode).toBe("SWE snapshot playback");
    expect(czml[1].properties?.citationUrl).toBe("https://doi.org/10.1029/2021AV000627");
    expect(czml[1].properties?.layerState).toEqual(PROVENANCE_META.layerState);
    expect(czml[1].properties?.displayUnitSystem).toBe("imperial");
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

  it("exports wrapped fields as complete non-duplicated CZML tiles", async () => {
    const getBlob = mockDownload();
    const tiled = (time_s: number, suffix: string) => ({
      bbox: [174, -2, 184, 2] as [number, number, number, number],
      eta_abs_max_m: 1,
      eta_max_m: 1,
      eta_min_m: -1,
      eta_png_b64: "",
      nx: 4,
      ny: 2,
      height_field: IDEALIZED_SEA_SURFACE_HEIGHT_FIELD,
      time_s,
      field_tiles: [
        { column_offset: 0, column_count: 2, bbox: [174, -2, 180, 2] as [number, number, number, number], eta_png_b64: `east-${suffix}` },
        { column_offset: 2, column_count: 2, bbox: [-180, -2, -176, 2] as [number, number, number, number], eta_png_b64: `west-${suffix}` },
      ],
    });

    expect(exportCzml(PROVENANCE_META, [tiled(0, "a"), tiled(60, "b")]).ok).toBe(true);
    const czml = JSON.parse(await getBlob()!.text()) as Array<{
      id: string;
      rectangle?: { material?: { image?: { image?: Array<{ image: string }> } } };
    }>;
    expect(czml.map((packet) => packet.id)).toEqual(["document", "wave-field", "wave-field-2"]);
    expect(czml[1].rectangle?.material?.image?.image?.map((item) => item.image)).toEqual([
      "data:image/png;base64,east-a",
      "data:image/png;base64,east-b",
    ]);
    expect(czml[2].rectangle?.material?.image?.image?.map((item) => item.image)).toEqual([
      "data:image/png;base64,west-a",
      "data:image/png;base64,west-b",
    ]);
  });

  it("rejects CZML when a tiled frame drops part of the field", () => {
    const snapshot = {
      bbox: [174, -2, 184, 2] as [number, number, number, number],
      eta_abs_max_m: 1,
      eta_max_m: 1,
      eta_min_m: -1,
      eta_png_b64: "",
      nx: 4,
      ny: 2,
      height_field: IDEALIZED_SEA_SURFACE_HEIGHT_FIELD,
      time_s: 0,
      field_tiles: [
        { column_offset: 0, column_count: 2, bbox: [174, -2, 180, 2] as [number, number, number, number], eta_png_b64: "partial" },
      ],
    };
    expect(exportCzml(PROVENANCE_META, [snapshot])).toMatchObject({
      ok: false,
      code: "data",
      retryable: true,
    });
  });
});

describe("exportKml", () => {
  it("returns false when no source and no runup points", () => {
    expect(exportKml({ timeS: 0 }, [])).toMatchObject({ ok: false, code: "data", retryable: true });
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
    expect(ok.ok).toBe(true);
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
    expect(kml).toContain(`Cataclysm v${APP_VERSION}`);
    expect(kml).toContain("Scenario type: Asteroid");
    expect(kml).toContain("Solver mode: SWE snapshot playback");
    expect(kml).toContain("https://doi.org/10.1029/2021AV000627");
    expect(kml).toContain("scenario:preset:chicxulub");
    expect(kml).toContain("result:preset:chicxulub:outcome");
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
    expect(exportRunupCsv([SAMPLE_POINT]).ok).toBe(true);
    const csv = await getBlob()!.text();
    expect(csv).toContain("slope_sample_id,slope_record_id");
    expect(csv).toContain("miyako_jp:slope,slope:legacy-curated-v1");
    expect(csv).toContain("miyako_jp:depth,depth:nominal-isobath-v1");
  });

  it("records the active display unit system without changing canonical SI columns", async () => {
    const getBlob = mockDownload();
    expect(exportRunupCsv([SAMPLE_POINT], "imperial").ok).toBe(true);
    const csv = await getBlob()!.text();
    expect(csv).toContain("runup_m");
    expect(csv).toContain(",5.2,");
    expect(csv.trim()).toMatch(/,imperial$/);
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
    expect(ok.ok).toBe(true);

    const csv = await getBlob()!.text();
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("gauge_name,lat_deg,lon_deg,time_s,eta_m,solver_mode,bathymetry_source,horizontal_crs,vertical_datum,vertical_axis,run_quality,cfl_number,mass_drift_pct,energy_drift_pct,display_unit_system");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain("Tokyo Bay");
    expect(lines[1]).toContain("35.65");
    expect(lines[1]).toContain("139.77");
    expect(lines[2]).toContain("1.2340");
    expect(lines[2]).toContain("EPSG:4326,idealized_mean_sea_level,positive_up");
    expect(lines[2]).toMatch(/,metric$/);
  });

  it("returns false for empty series", () => {
    const ok = exportGaugeCsv([], "test", "test");
    expect(ok).toMatchObject({ ok: false, code: "data", retryable: true });
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
