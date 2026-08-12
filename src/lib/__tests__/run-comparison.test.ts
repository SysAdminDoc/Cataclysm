import { describe, expect, it } from "vitest";
import type { GridSnapshot, RunQualityRecord } from "../../types/scenario";
import { INITIAL_ASTEROID } from "../scenario-schema";
import { buildRunArchiveRecord, type RunArchiveRecord } from "../run-archive";
import {
  buildNormalizedRerunPreflight,
  compareArchivedRuns,
  exportRunDeltaReport,
} from "../run-comparison";

const QUALITY: RunQualityRecord = {
  status: "pass",
  finite_fields: true,
  minimum_total_depth_m: 1,
  cfl_number: 0.4,
  cfl_margin: 0.6,
  accepted_steps: 10,
  rejected_steps: 0,
  mass_drift_pct: 0,
  energy_drift_pct: 0,
  sponge_width_cells: 8,
  warnings: [],
  failure: null,
};

function frame(time: number, peak: number, gauge: number): GridSnapshot {
  return {
    time_s: time,
    bbox: [-1, -1, 1, 1],
    nx: 2,
    ny: 2,
    height_field: {
      horizontal_crs: "EPSG:4326",
      vertical_datum: "idealized_mean_sea_level",
      vertical_axis: "positive_up",
      unit: "metre",
      declared_vertical_error_m: 4000,
    },
    eta_min_m: -peak,
    eta_max_m: peak,
    eta_abs_max_m: peak,
    eta_png_b64: "",
    gauge_samples: [{ id: "g-1", eta_m: gauge }],
  };
}

async function archived(input: {
  id: string;
  appVersion: string;
  parentRunId?: string | null;
  peak: number;
  gauge: number;
  directRadius: number;
}): Promise<RunArchiveRecord> {
  const snapshots = [frame(0, input.peak / 2, input.gauge / 2), frame(3600, input.peak, input.gauge)];
  return buildRunArchiveRecord({
    id: input.id,
    parentRunId: input.parentRunId,
    label: input.id,
    presetId: null,
    scenario: { kind: "Asteroid", source: INITIAL_ASTEROID },
    solverSettings: {
      schema_version: 1,
      use_spatial_bathymetry: true,
      bathymetry_asset_id: null,
      cells_per_degree: 8,
      resolution_mode: "advanced",
      duration_s: 3600,
      frame_count: 60,
      include_lamb_wave: false,
      boundary_mode: "sponge",
      checkpoint_interval_s: 60,
    },
    appVersion: input.appVersion,
    renderProtocolVersion: "1.0",
    renderScenarioSha256: "a".repeat(64),
    provenance: {},
    scientificExport: null,
    logTail: [],
    results: {
      snapshots,
      maxField: null,
      gauges: [{ id: "g-1", name: "Gauge one", lat_deg: 0, lon_deg: 0 }],
      runQuality: QUALITY,
      isochrones: [],
      directEffects: { blast: { radius_m: input.directRadius } },
    },
  });
}

describe("historical result normalization", () => {
  it("lists every versioned preflight category while preserving the artifact", async () => {
    const historical = await archived({
      id: "run-historical",
      appVersion: "0.12.0",
      peak: 2,
      gauge: 1,
      directRadius: 100,
    });
    const before = structuredClone(historical);

    const preflight = await buildNormalizedRerunPreflight(historical);

    expect(preflight.historicalRunId).toBe("run-historical");
    expect(new Set(preflight.differences.map((item) => item.category))).toEqual(
      new Set(["solver", "schema", "source", "settings", "data"]),
    );
    expect(preflight.differences.find((item) => item.id === "solver-version")).toMatchObject({
      historical: "0.12.0",
      changed: true,
    });
    expect(preflight.differences.find((item) => item.id === "source-digest")?.changed).toBe(false);
    expect(preflight.differences.find((item) => item.id === "settings-digest")?.changed).toBe(false);
    expect(historical).toEqual(before);
  });

  it("attributes linked field, gauge, and direct-effect deltas and exports them", async () => {
    const historical = await archived({
      id: "run-historical",
      appVersion: "0.12.0",
      peak: 2,
      gauge: 1,
      directRadius: 100,
    });
    const current = await archived({
      id: "run-current",
      appVersion: "0.14.1",
      parentRunId: historical.id,
      peak: 3,
      gauge: 2,
      directRadius: 125,
    });
    const beforeHistorical = structuredClone(historical);
    const beforeCurrent = structuredClone(current);

    const report = compareArchivedRuns(historical, current);

    expect(report.linkedNormalizedRerun).toBe(true);
    expect(report.field.peakAbsMaxM.delta).toBe(1);
    expect(report.field.matchedFrames).toBe(2);
    expect(report.gauges).toEqual([
      expect.objectContaining({ id: "g-1", matchedSamples: 2, peakAbsDeltaM: 1 }),
    ]);
    expect(report.directEffects).toEqual([
      { path: "blast.radius_m", historical: 100, current: 125, delta: 25 },
    ]);
    expect(report.attributedTo).toContain("solver");

    const exported = JSON.parse(exportRunDeltaReport(
      historical,
      current,
      "2026-07-29T12:00:00.000Z",
    ));
    expect(exported).toMatchObject({
      schemaVersion: 1,
      exportedAt: "2026-07-29T12:00:00.000Z",
      report: { historicalRunId: "run-historical", currentRunId: "run-current" },
    });
    expect(historical).toEqual(beforeHistorical);
    expect(current).toEqual(beforeCurrent);
  });
});
