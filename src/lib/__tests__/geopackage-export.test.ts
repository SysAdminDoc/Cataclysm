import { describe, expect, it } from "vitest";
import { buildGeoPackageRequest } from "../geopackage-export";
import type { ScreenshotMeta } from "../export";
import type { HazardResult } from "../../hazards/types";

const meta: ScreenshotMeta = {
  generatedAt: "2026-08-12T00:00:00.000Z",
  scenarioName: "Fault fixture",
  scenarioKind: "Earthquake",
  solverMode: "SWE fixture",
  citationReference: "Fixture source",
  citationUrl: "https://example.test/source",
  unitSystem: "metric",
  timeS: 600,
  initial: {
    center: { lat_deg: 35, lon_deg: 140 },
    cavity_radius_m: 1_000,
    peak_amplitude_m: 2,
    source_energy_j: 3e12,
    seismic_mw_equivalent: 7,
    label: "Fault fixture",
    source_geometry: {
      kind: "okada",
      fault: {
        center_lat: 35,
        center_lon: 140,
        depth_m: 12_000,
        length_m: 80_000,
        width_m: 30_000,
        strike_deg: 90,
        dip_deg: 30,
        rake_deg: 90,
        slip_m: 4,
      },
    },
  },
  evidenceIds: ["fixture:source"],
};

describe("GeoPackage export request builder", () => {
  it("retains source, fault, gauges, runup, and arrival geometry with digests", async () => {
    const request = await buildGeoPackageRequest({
      meta,
      gauges: [{ id: "gauge-1", name: "Fixture gauge", lat_deg: 36, lon_deg: 141 }],
      runupPoints: [{
        id: "coast-1",
        name: "Fixture coast",
        lat: 36.5,
        lon: 141.5,
        runup_m: 3.2,
        arrival_time_s: 900,
        inundation_extent_m: 120,
        offshore_amplitude_m: 1.4,
        beach_slope_deg: 5,
        offshore_depth_m: 60,
        slope_provenance: { record_id: "slope", sample_id: "sample", source: "fixture", source_url: null, method: "fixture", datum: "fixture", resolution: "fixture", observed_or_published: "published", confidence: "low", uncertainty_value: null, uncertainty_unit: "unknown", uncertainty_basis: "fixture", placeholder: false },
        depth_provenance: { record_id: "depth", sample_id: "sample", source: "fixture", source_url: null, method: "fixture", datum: "fixture", resolution: "fixture", observed_or_published: "published", confidence: "low", uncertainty_value: null, uncertainty_unit: "unknown", uncertainty_basis: "fixture", placeholder: false },
        quantitative_confidence: "low",
        quantitative_label: "screening_estimate",
      }],
      isochrones: [{ time_s: 900, lines: [[[140, 35], [141, 36]]] }],
    });

    expect(request.schemaVersion).toBe(1);
    expect(request.metadata.horizontalCrs).toBe("EPSG:4326");
    expect(request.metadata.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(request.metadata.dataDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(request.layers.map((layer) => layer.tableName)).toEqual([
      "source_geometry",
      "fault_geometry",
      "gauges",
      "runup",
      "arrival_isochrones",
    ]);
    const fault = request.layers.find((layer) => layer.tableName === "fault_geometry")?.features[0];
    expect(fault?.geometry.type).toBe("Polygon");
    if (fault?.geometry.type === "Polygon") {
      expect(fault.geometry.coordinates[0][0]).toEqual(fault.geometry.coordinates[0].at(-1));
    }
  });

  it("adds the direct-effect origin and polygons without requiring SWE output", async () => {
    const direct: HazardResult = {
      kind: "nuclear",
      authority: "rust",
      modelVersion: "fixture-direct",
      center: { lat: 40, lon: -74 },
      rings: [{ label: "Blast", radiusM: 2_000, color: "#f38ba8", category: "blast" }],
      readout: [],
      detail: {} as never,
    };
    const request = await buildGeoPackageRequest({
      meta: { ...meta, initial: null, scenarioName: "Direct fixture" },
      directHazard: {
        result: direct,
        polygons: [{ label: "Fallout", color: "#f38ba8", points: [{ lat: 40, lon: -74 }, { lat: 40.1, lon: -73.9 }, { lat: 39.9, lon: -73.8 }, { lat: 40, lon: -74 }] }],
      },
    });

    expect(request.layers.map((layer) => layer.tableName)).toEqual(["source_geometry", "direct_effect_polygons"]);
    expect(request.layers[1].features).toHaveLength(2);
    expect(request.metadata.qualityStatus).toBe("not_applicable");
  });
});
