import { describe, expect, it } from "vitest";
import { INITIAL_ASTEROID } from "../scenario-schema";
import {
  PORTABLE_SCENARIO_MAX_ARCHIVE_BYTES,
  createPortableScenarioPackage,
  inspectPortableScenarioPackage,
  type PortableScenarioCreateInput,
} from "../portable-scenario-package";

const FIXTURE: PortableScenarioCreateInput = {
  scenario: { kind: "Asteroid", source: INITIAL_ASTEROID },
  settings: { _schema_version: 6, theme: "mocha" },
  solverSettings: {
    schema_version: 1,
    cells_per_degree: 8,
    use_spatial_bathymetry: true,
    bathymetry_asset_id: "gebco-local",
    resolution_mode: "advanced",
    duration_s: 3600,
    boundary_mode: "sponge",
    frame_count: 60,
    include_lamb_wave: false,
    checkpoint_interval_s: 60,
  },
  workspace: {
    layers: [{ id: "source", visible: true, opacity: 1, order: 0 }],
    camera: { lat: 1, lon: 2, altitude_m: 300_000, heading_deg: 20, pitch_deg: -55 },
  },
  citations: [{ label: "Ward and Asphaug", url: "https://example.test/paper", role: "source model" }],
  provenance: { app_version: "test", source: "unit fixture" },
  results: {
    schema_version: 1,
    snapshots: [],
    max_field: null,
    gauges: [],
    run_quality: { status: "pass" },
    isochrones: [],
  },
  checkpoints: [{ run_id: "run-1", time_s: 300 }],
  dataReferences: [{
    id: "gebco-local",
    kind: "bathymetry",
    relative_path: "data/gebco-local.tif",
    embedded: false,
  }],
  embeddedAssets: [{
    id: "preview",
    kind: "preview",
    path: "assets/preview.png",
    mime: "image/png",
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  }],
  createdUtc: "2026-07-21T00:00:00.000Z",
};

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function eocdOffset(bytes: Uint8Array): number {
  for (let offset = bytes.byteLength - 22; offset >= 0; offset -= 1) {
    if (new DataView(bytes.buffer).getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error("EOCD not found");
}

function centralEntries(bytes: Uint8Array): Array<{ path: string; offset: number; localOffset: number }> {
  const view = new DataView(bytes.buffer);
  const eocd = eocdOffset(bytes);
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const nameBytes = view.getUint16(offset + 28, true);
    const extraBytes = view.getUint16(offset + 30, true);
    const commentBytes = view.getUint16(offset + 32, true);
    entries.push({
      path: new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameBytes)),
      offset,
      localOffset: view.getUint32(offset + 42, true),
    });
    offset += 46 + nameBytes + extraBytes + commentBytes;
  }
  return entries;
}

function rewriteStoredEntry(bytes: Uint8Array, path: string, rewrite: (text: string) => string): Uint8Array {
  const copy = Uint8Array.from(bytes);
  const view = new DataView(copy.buffer);
  const central = centralEntries(copy).find((entry) => entry.path === path);
  if (!central) throw new Error(`${path} missing`);
  const localNameBytes = view.getUint16(central.localOffset + 26, true);
  const localExtraBytes = view.getUint16(central.localOffset + 28, true);
  const dataOffset = central.localOffset + 30 + localNameBytes + localExtraBytes;
  const size = view.getUint32(central.offset + 24, true);
  const current = new TextDecoder().decode(copy.subarray(dataOffset, dataOffset + size));
  const replacement = new TextEncoder().encode(rewrite(current));
  if (replacement.byteLength !== size) throw new Error("replacement must keep entry length");
  copy.set(replacement, dataOffset);
  const checksum = crc32(replacement);
  view.setUint32(central.localOffset + 14, checksum, true);
  view.setUint32(central.offset + 16, checksum, true);
  return copy;
}

describe("portable scenario packages", () => {
  it("round-trips the complete portable context with deterministic bytes", async () => {
    const first = await createPortableScenarioPackage(FIXTURE);
    const repeated = await createPortableScenarioPackage(FIXTURE);
    expect(first).toEqual(repeated);
    expect(first.byteLength).toBeLessThan(PORTABLE_SCENARIO_MAX_ARCHIVE_BYTES);

    const before = Uint8Array.from(first);
    const imported = await inspectPortableScenarioPackage(first);
    expect(first).toEqual(before);
    expect(imported.scenario).toEqual(FIXTURE.scenario);
    expect(imported.settings).toMatchObject({ _schema_version: 6, theme: "mocha" });
    expect(imported.solverSettings).toEqual(FIXTURE.solverSettings);
    expect(imported.workspace).toEqual(FIXTURE.workspace);
    expect(imported.citations).toEqual(FIXTURE.citations);
    expect(imported.results).toEqual(FIXTURE.results);
    expect(imported.checkpoints).toEqual(FIXTURE.checkpoints);
    expect(imported.embeddedAssets[0]).toMatchObject({ path: "assets/preview.png", mime: "image/png" });
    expect(imported.embeddedAssets[0].bytes).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(imported.warnings).toContain("1 local data reference(s) must be relinked on this machine.");
  });

  it("migrates schema zero as a copy and rejects future schemas before returning data", async () => {
    const current = await createPortableScenarioPackage(FIXTURE);
    const legacy = rewriteStoredEntry(current, "manifest.json", (text) => text.replace('"schema_version": 1', '"schema_version": 0'));
    const imported = await inspectPortableScenarioPackage(legacy);
    expect(imported.manifest.schema_version).toBe(1);
    expect(imported.packageMigrations).toEqual([{
      code: "package-v0-to-v1",
      description: "migrated portable package schema 0 to schema 1 as an in-memory copy",
    }]);
    expect(legacy).not.toEqual(current);

    const future = rewriteStoredEntry(current, "manifest.json", (text) => text.replace('"schema_version": 1', '"schema_version": 9'));
    await expect(inspectPortableScenarioPackage(future)).rejects.toThrow(/newer than supported schema/i);
  });

  it("rejects digest tampering even when the ZIP CRC is repaired", async () => {
    const current = await createPortableScenarioPackage(FIXTURE);
    const tampered = rewriteStoredEntry(current, "scenario.json", (text) => text.replace('"diameter_m": 500', '"diameter_m": 501'));
    await expect(inspectPortableScenarioPackage(tampered)).rejects.toThrow(/SHA-256 verification/i);
  });

  it("rejects traversal paths, executable assets, unsupported MIME, and oversize archives", async () => {
    const current = await createPortableScenarioPackage(FIXTURE);
    const traversal = Uint8Array.from(current);
    const manifest = centralEntries(traversal).find((entry) => entry.path === "manifest.json");
    if (!manifest) throw new Error("manifest missing");
    const unsafe = new TextEncoder().encode("../evil.jsonx");
    traversal.set(unsafe, manifest.localOffset + 30);
    traversal.set(unsafe, manifest.offset + 46);
    await expect(inspectPortableScenarioPackage(traversal)).rejects.toThrow(/unsafe path segment/i);

    await expect(createPortableScenarioPackage({
      ...FIXTURE,
      embeddedAssets: [{ id: "bad", kind: "asset", path: "assets/run.exe", mime: "application/octet-stream", bytes: new Uint8Array([1]) }],
    })).rejects.toThrow(/executable content/i);
    await expect(createPortableScenarioPackage({
      ...FIXTURE,
      embeddedAssets: [{ id: "bad", kind: "asset", path: "assets/data.dat", mime: "text/html", bytes: new Uint8Array([1]) }],
    })).rejects.toThrow(/unsupported MIME/i);
    await expect(createPortableScenarioPackage({
      ...FIXTURE,
      embeddedAssets: [{ id: "bad", kind: "asset", path: "assets/spoof.png", mime: "image/png", bytes: new Uint8Array([0x4d, 0x5a]) }],
    })).rejects.toThrow(/MIME signature/i);
    await expect(createPortableScenarioPackage({
      ...FIXTURE,
      settings: { _schema_version: 6, cesium_token: "must-not-leak" },
    })).rejects.toThrow(/must not contain Cesium credentials/i);
    await expect(createPortableScenarioPackage({
      ...FIXTURE,
      settings: { _schema_version: 999 },
    })).rejects.toThrow(/newer than supported/i);

    const oversizedEntry = Uint8Array.from(current);
    const oversizedView = new DataView(oversizedEntry.buffer);
    const oversizedManifest = centralEntries(oversizedEntry).find((entry) => entry.path === "manifest.json");
    if (!oversizedManifest) throw new Error("manifest missing");
    for (const offset of [oversizedManifest.offset + 20, oversizedManifest.offset + 24,
      oversizedManifest.localOffset + 18, oversizedManifest.localOffset + 22]) {
      oversizedView.setUint32(offset, 17 * 1024 * 1024, true);
    }
    await expect(inspectPortableScenarioPackage(oversizedEntry)).rejects.toThrow(/expanded-size limit/i);
    await expect(inspectPortableScenarioPackage(new Uint8Array(PORTABLE_SCENARIO_MAX_ARCHIVE_BYTES + 1))).rejects.toThrow(/archive size/i);
  });
});
