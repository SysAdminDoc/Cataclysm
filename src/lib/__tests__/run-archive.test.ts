import { describe, expect, it } from "vitest";
import { INITIAL_ASTEROID } from "../scenario-schema";
import type { RunQualityRecord } from "../../types/scenario";
import {
  DEFAULT_RUN_ARCHIVE_QUOTA_BYTES,
  RunArchiveQuotaError,
  buildRunArchiveRecord,
  createRunArchiveStore,
  exportRunArchiveRecord,
  previewRunArchiveWrite,
  type RunArchiveBackend,
  type RunArchiveRecord,
} from "../run-archive";

class MemoryBackend implements RunArchiveBackend {
  value: unknown | null;

  constructor(value: unknown | null = null) {
    this.value = structuredClone(value);
  }

  async read(): Promise<unknown | null> {
    return structuredClone(this.value);
  }

  async write(value: unknown): Promise<void> {
    this.value = structuredClone(value);
  }
}

const QUALITY: RunQualityRecord = {
  status: "pass",
  finite_fields: true,
  minimum_total_depth_m: 5,
  cfl_number: 0.4,
  cfl_margin: 0.6,
  accepted_steps: 100,
  rejected_steps: 0,
  mass_drift_pct: 0.01,
  energy_drift_pct: 0.02,
  sponge_width_cells: 8,
  warnings: [],
  failure: null,
};

async function record(label = "Archived asteroid"): Promise<RunArchiveRecord> {
  return buildRunArchiveRecord({
    label,
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
    appVersion: "0.14.0-test",
    renderProtocolVersion: "1.0",
    renderScenarioSha256: null,
    provenance: { fixture: true },
    scientificExport: null,
    logTail: [{ id: 1, level: "info", timestamp: 1, message: "api_key=secret-value C:\\private\\run.txt" }],
    results: {
      snapshots: [],
      maxField: null,
      gauges: [],
      runQuality: QUALITY,
      isochrones: [],
    },
  });
}

describe("bounded immutable run archive", () => {
  it("atomically adds, lists, pins, removes, and restores a validated record", async () => {
    const backend = new MemoryBackend();
    const store = createRunArchiveStore(backend);
    const original = await record();
    await store.add(original);

    original.label = "mutated after write";
    let snapshot = await store.list();
    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.records[0].label).toBe("Archived asteroid");
    expect(snapshot.records[0].logTail[0].message).not.toContain("secret-value");
    expect(snapshot.records[0].logTail[0].message).not.toContain("private");

    await store.setPinned(snapshot.records[0].id, true);
    snapshot = await store.list();
    expect(snapshot.records[0].pinned).toBe(true);

    await store.remove(snapshot.records[0].id);
    snapshot = await store.list();
    expect(snapshot.records).toEqual([]);
    expect(snapshot.trash).toHaveLength(1);

    await store.restore(snapshot.trash[0].id);
    snapshot = await store.list();
    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.trash).toEqual([]);
  });

  it("keeps corrupt records quarantined and byte-for-byte present across valid writes", async () => {
    const corrupt = { id: "unsafe", privateEvidence: "preserve exactly" };
    const backend = new MemoryBackend({
      schemaVersion: 1,
      records: [corrupt],
      trash: [],
      quotaBytes: DEFAULT_RUN_ARCHIVE_QUOTA_BYTES,
    });
    const store = createRunArchiveStore(backend);
    expect((await store.list()).quarantine).toEqual([
      expect.objectContaining({ area: "records", index: 0 }),
    ]);

    await store.add(await record("Valid"));
    const persisted = backend.value as { records: unknown[] };
    expect(persisted.records).toContainEqual(corrupt);
    expect((await store.list()).records).toHaveLength(1);
  });

  it("fails closed on future archive data without rewriting the original", async () => {
    const future = { schemaVersion: 99, records: [{ preserved: true }] };
    const backend = new MemoryBackend(future);
    const store = createRunArchiveStore(backend);

    await expect(store.list()).rejects.toThrow(/newer than supported.*original data was left unchanged/i);
    expect(backend.value).toEqual(future);
  });

  it("previews deterministic LRU eviction and requires explicit confirmation", async () => {
    const oldest = { ...(await record("Oldest")), id: "run-oldest", lastAccessedAt: "2026-07-01T00:00:00.000Z", sizeBytes: 6_000_000 };
    const newest = { ...(await record("Newest")), id: "run-newest", lastAccessedAt: "2026-07-02T00:00:00.000Z", sizeBytes: 6_000_000 };
    const candidate = { ...(await record("Candidate")), id: "run-candidate", sizeBytes: 8_000_000 };
    const preview = previewRunArchiveWrite(candidate, {
      records: [newest, oldest],
      quotaBytes: 16_000_000,
      usedBytes: 12_000_000,
    });
    expect(preview).toMatchObject({ fits: true, evictionIds: ["run-oldest"] });

    const backend = new MemoryBackend({
      schemaVersion: 1,
      records: [],
      trash: [],
      quotaBytes: 16 * 1024 * 1024,
    });
    const store = createRunArchiveStore(backend);
    const oversized = { ...(await record("Oversized")), sizeBytes: 20 * 1024 * 1024 };
    await expect(store.add(oversized)).rejects.toBeInstanceOf(RunArchiveQuotaError);
    expect((await store.list()).records).toEqual([]);
  });

  it("exports a versioned deterministic data-only record", async () => {
    const archived = await record();
    const exported = JSON.parse(exportRunArchiveRecord(archived));
    expect(exported.schemaVersion).toBe(1);
    expect(exported.record.identity).toMatchObject({
      appVersion: "0.14.0-test",
      scenarioSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      settingsSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      dataSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });
});
