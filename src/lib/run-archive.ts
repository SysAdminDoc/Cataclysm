import { SCENARIO_SCHEMA_VERSION, type ScenarioInput } from "./scenario-schema";
import type { PortableJson, PortableScenarioSolverSettings } from "./portable-scenario-package";
import type {
  Gauge,
  GridSnapshot,
  Isochrone,
  MaxFieldProduct,
  RunQualityRecord,
  ScientificExportDescriptor,
} from "../types/scenario";
import type { LogEntry } from "./diagnosticsLog";
import { redactSensitive } from "./diagnosticsLog";
import {
  UserDataMigrationError,
  currentUserDataSchemaVersion,
  migrateRunArchiveData,
} from "./user-data-migrations";

const DB_NAME = "cataclysm-user-data";
const DB_VERSION = 1;
const STORE_NAME = "run-archive";
const STATE_KEY = "state";
export const RUN_ARCHIVE_CHANGED_EVENT = "cataclysm:run-archive-changed";
export const DEFAULT_RUN_ARCHIVE_QUOTA_BYTES = 128 * 1024 * 1024;
export const MIN_RUN_ARCHIVE_QUOTA_BYTES = 16 * 1024 * 1024;
export const MAX_RUN_ARCHIVE_QUOTA_BYTES = 512 * 1024 * 1024;
const MAX_TRASH_RECORDS = 20;
const MAX_LOG_TAIL = 30;

export type ArchivedRunResults = {
  snapshots: GridSnapshot[];
  maxField: MaxFieldProduct | null;
  gauges: Gauge[];
  runQuality: RunQualityRecord;
  isochrones: Isochrone[];
};

export type RunArchiveRecord = {
  id: string;
  parentRunId: string | null;
  createdAt: string;
  lastAccessedAt: string;
  pinned: boolean;
  label: string;
  presetId: string | null;
  scenarioKind: ScenarioInput["kind"];
  inputs: {
    scenario: ScenarioInput;
    solverSettings: PortableScenarioSolverSettings;
  };
  identity: {
    appVersion: string;
    solverVersion: string;
    scenarioSchemaVersion: number;
    archiveSchemaVersion: number;
    scenarioSha256: string;
    settingsSha256: string;
    dataSha256: string;
    renderProtocolVersion: string | null;
  };
  summary: {
    durationS: number;
    frameCount: number;
    grid: { nx: number; ny: number } | null;
    peakAbsMaxM: number;
    gaugeCount: number;
    gaugeSampleCount: number;
  };
  quality: RunQualityRecord;
  provenance: PortableJson;
  scientificExport: ScientificExportDescriptor | null;
  logTail: LogEntry[];
  results: ArchivedRunResults;
  sizeBytes: number;
};

type RunArchiveEnvelope = {
  schemaVersion: number;
  records: unknown[];
  trash: unknown[];
  quotaBytes: number;
};

export type RunArchiveQuarantine = {
  area: "records" | "trash";
  index: number;
  reason: string;
};

export type RunArchiveSnapshot = {
  records: RunArchiveRecord[];
  trash: RunArchiveRecord[];
  quarantine: RunArchiveQuarantine[];
  quotaBytes: number;
  usedBytes: number;
};

export type RunArchiveWritePreview = {
  recordId: string;
  quotaBytes: number;
  usedBytes: number;
  projectedBytes: number;
  evictionIds: string[];
  evictionBytes: number;
  fits: boolean;
};

export class RunArchiveQuotaError extends Error {
  readonly preview: RunArchiveWritePreview;

  constructor(preview: RunArchiveWritePreview) {
    super(
      preview.fits
        ? `Archiving this run requires confirmation before evicting ${preview.evictionIds.length} older run(s).`
        : "The archive quota cannot fit this run without removing pinned history.",
    );
    this.name = "RunArchiveQuotaError";
    this.preview = preview;
  }
}

export interface RunArchiveBackend {
  read(): Promise<unknown | null>;
  write(value: unknown): Promise<void>;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

class IndexedDbRunArchiveBackend implements RunArchiveBackend {
  private database: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") {
      return Promise.reject(new Error("Run history storage is unavailable in this environment."));
    }
    if (!this.database) {
      this.database = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE_NAME)) {
            request.result.createObjectStore(STORE_NAME);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Run history database could not be opened."));
      });
    }
    return this.database;
  }

  async read(): Promise<unknown | null> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, "readonly");
    const value = await requestResult(transaction.objectStore(STORE_NAME).get(STATE_KEY));
    return value ?? null;
  }

  async write(value: unknown): Promise<void> {
    const database = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(structuredClone(value), STATE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Run history transaction failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Run history transaction was aborted."));
    });
  }
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function validateRunRecord(raw: unknown): RunArchiveRecord {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("record is not an object");
  const record = raw as Partial<RunArchiveRecord>;
  if (typeof record.id !== "string" || !/^run-[A-Za-z0-9-]{1,120}$/.test(record.id)) throw new Error("record id is invalid");
  if (typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt))) throw new Error("completion time is invalid");
  if (typeof record.lastAccessedAt !== "string" || !Number.isFinite(Date.parse(record.lastAccessedAt))) throw new Error("access time is invalid");
  if (typeof record.pinned !== "boolean" || typeof record.label !== "string" || record.label.length === 0 || record.label.length > 200) throw new Error("record metadata is invalid");
  if (!record.inputs || typeof record.inputs !== "object" || !record.identity || typeof record.identity !== "object") throw new Error("record identity is missing");
  if (!record.summary || typeof record.summary !== "object" || !record.quality || typeof record.quality !== "object") throw new Error("record summary is missing");
  if (!record.results || typeof record.results !== "object" || !Array.isArray(record.results.snapshots)) throw new Error("record results are missing");
  const identity = record.identity;
  if (
    typeof identity.appVersion !== "string"
    || typeof identity.solverVersion !== "string"
    || !Number.isInteger(identity.scenarioSchemaVersion)
    || !Number.isInteger(identity.archiveSchemaVersion)
    || !isSha256(identity.scenarioSha256)
    || !isSha256(identity.settingsSha256)
    || !isSha256(identity.dataSha256)
    || (identity.renderProtocolVersion !== null && typeof identity.renderProtocolVersion !== "string")
  ) throw new Error("record identity is invalid");
  const summary = record.summary;
  if (
    !isFiniteNumber(summary.durationS)
    || !Number.isInteger(summary.frameCount)
    || !isFiniteNumber(summary.peakAbsMaxM)
    || !Number.isInteger(summary.gaugeCount)
    || !Number.isInteger(summary.gaugeSampleCount)
  ) throw new Error("record summary is invalid");
  if (record.quality.status !== "pass" && record.quality.status !== "warning") {
    throw new Error("only accepted runs can be archived");
  }
  if (!isFiniteNumber(record.sizeBytes) || record.sizeBytes <= 0) throw new Error("record size is invalid");
  return structuredClone(record as RunArchiveRecord);
}

type LoadedArchive = RunArchiveSnapshot & {
  rawRecords: unknown[];
  rawTrash: unknown[];
};

function decodeRecords(raw: unknown[], area: RunArchiveQuarantine["area"]): {
  valid: RunArchiveRecord[];
  quarantine: RunArchiveQuarantine[];
} {
  const valid: RunArchiveRecord[] = [];
  const quarantine: RunArchiveQuarantine[] = [];
  raw.forEach((candidate, index) => {
    try {
      valid.push(validateRunRecord(candidate));
    } catch (error) {
      quarantine.push({ area, index, reason: error instanceof Error ? error.message : String(error) });
    }
  });
  return { valid, quarantine };
}

function decodeArchive(raw: unknown | null): LoadedArchive {
  if (raw === null) {
    return {
      records: [],
      trash: [],
      quarantine: [],
      quotaBytes: DEFAULT_RUN_ARCHIVE_QUOTA_BYTES,
      usedBytes: 0,
      rawRecords: [],
      rawTrash: [],
    };
  }
  const migration = migrateRunArchiveData(raw);
  const rawRecords = Array.isArray(migration.data.records) ? migration.data.records : [];
  const rawTrash = Array.isArray(migration.data.trash) ? migration.data.trash : [];
  const quotaCandidate = migration.data.quotaBytes;
  const quotaBytes = isFiniteNumber(quotaCandidate)
    ? Math.max(MIN_RUN_ARCHIVE_QUOTA_BYTES, Math.min(MAX_RUN_ARCHIVE_QUOTA_BYTES, Math.floor(quotaCandidate)))
    : DEFAULT_RUN_ARCHIVE_QUOTA_BYTES;
  const records = decodeRecords(rawRecords, "records");
  const trash = decodeRecords(rawTrash, "trash");
  return {
    records: records.valid.sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    trash: trash.valid.sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    quarantine: [...records.quarantine, ...trash.quarantine],
    quotaBytes,
    usedBytes: rawRecords.reduce((sum, candidate) => sum + jsonBytes(candidate), 0),
    rawRecords: structuredClone(rawRecords),
    rawTrash: structuredClone(rawTrash),
  };
}

function envelope(state: Pick<LoadedArchive, "rawRecords" | "rawTrash" | "quotaBytes">): RunArchiveEnvelope {
  return {
    schemaVersion: currentUserDataSchemaVersion("runArchive"),
    records: structuredClone(state.rawRecords),
    trash: structuredClone(state.rawTrash),
    quotaBytes: state.quotaBytes,
  };
}

export function previewRunArchiveWrite(
  record: RunArchiveRecord,
  state: Pick<RunArchiveSnapshot, "records" | "quotaBytes" | "usedBytes">,
  quotaBytes = state.quotaBytes,
): RunArchiveWritePreview {
  const projectedBytes = state.usedBytes + record.sizeBytes;
  let remaining = Math.max(0, projectedBytes - quotaBytes);
  const evictionIds: string[] = [];
  let evictionBytes = 0;
  const candidates = state.records
    .filter((candidate) => !candidate.pinned)
    .sort((left, right) => left.lastAccessedAt.localeCompare(right.lastAccessedAt));
  for (const candidate of candidates) {
    if (remaining <= 0) break;
    evictionIds.push(candidate.id);
    evictionBytes += candidate.sizeBytes;
    remaining -= candidate.sizeBytes;
  }
  return {
    recordId: record.id,
    quotaBytes,
    usedBytes: state.usedBytes,
    projectedBytes,
    evictionIds,
    evictionBytes,
    fits: remaining <= 0,
  };
}

function previewQuotaChange(state: LoadedArchive, quotaBytes: number): RunArchiveWritePreview {
  let remaining = Math.max(0, state.usedBytes - quotaBytes);
  const evictionIds: string[] = [];
  let evictionBytes = 0;
  const candidates = state.records
    .filter((candidate) => !candidate.pinned)
    .sort((left, right) => left.lastAccessedAt.localeCompare(right.lastAccessedAt));
  for (const candidate of candidates) {
    if (remaining <= 0) break;
    evictionIds.push(candidate.id);
    evictionBytes += candidate.sizeBytes;
    remaining -= candidate.sizeBytes;
  }
  return {
    recordId: "quota-change",
    quotaBytes,
    usedBytes: state.usedBytes,
    projectedBytes: state.usedBytes,
    evictionIds,
    evictionBytes,
    fits: remaining <= 0,
  };
}

function replaceValidRecord(raw: unknown[], id: string, update: (record: RunArchiveRecord) => RunArchiveRecord | null): unknown[] {
  return raw.flatMap((candidate) => {
    try {
      const record = validateRunRecord(candidate);
      if (record.id !== id) return [candidate];
      const updated = update(record);
      return updated ? [updated] : [];
    } catch {
      return [candidate];
    }
  });
}

function notifyChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(RUN_ARCHIVE_CHANGED_EVENT));
}

export function createRunArchiveStore(backend: RunArchiveBackend) {
  let mutationTail: Promise<void> = Promise.resolve();

  async function readLoaded(): Promise<LoadedArchive> {
    return decodeArchive(await backend.read());
  }

  function mutate<T>(action: () => Promise<T>): Promise<T> {
    const pending = mutationTail.then(action);
    mutationTail = pending.then(() => {}, () => {});
    return pending;
  }

  return {
    async list(): Promise<RunArchiveSnapshot> {
      const state = await readLoaded();
      return {
        records: state.records,
        trash: state.trash,
        quarantine: state.quarantine,
        quotaBytes: state.quotaBytes,
        usedBytes: state.usedBytes,
      };
    },
    async preview(record: RunArchiveRecord): Promise<RunArchiveWritePreview> {
      return previewRunArchiveWrite(validateRunRecord(record), await readLoaded());
    },
    add(record: RunArchiveRecord, confirmedEvictionIds: readonly string[] = []): Promise<void> {
      return mutate(async () => {
        const clean = validateRunRecord(record);
        const state = await readLoaded();
        if (state.records.some((candidate) => candidate.id === clean.id)) return;
        const preview = previewRunArchiveWrite(clean, state);
        if (!preview.fits || preview.evictionIds.some((id) => !confirmedEvictionIds.includes(id))) {
          throw new RunArchiveQuotaError(preview);
        }
        const evictions = new Set(preview.evictionIds);
        state.rawRecords = state.rawRecords.filter((candidate) => {
          try {
            return !evictions.has(validateRunRecord(candidate).id);
          } catch {
            return true;
          }
        });
        state.rawRecords.unshift(structuredClone(clean));
        await backend.write(envelope(state));
        notifyChanged();
      });
    },
    setPinned(id: string, pinned: boolean): Promise<void> {
      return mutate(async () => {
        const state = await readLoaded();
        state.rawRecords = replaceValidRecord(state.rawRecords, id, (record) => ({ ...record, pinned }));
        await backend.write(envelope(state));
        notifyChanged();
      });
    },
    touch(id: string): Promise<void> {
      return mutate(async () => {
        const state = await readLoaded();
        const now = new Date().toISOString();
        state.rawRecords = replaceValidRecord(state.rawRecords, id, (record) => ({ ...record, lastAccessedAt: now }));
        await backend.write(envelope(state));
        notifyChanged();
      });
    },
    remove(id: string): Promise<void> {
      return mutate(async () => {
        const state = await readLoaded();
        const record = state.records.find((candidate) => candidate.id === id);
        if (!record) return;
        state.rawRecords = replaceValidRecord(state.rawRecords, id, () => null);
        state.rawTrash = [record, ...state.rawTrash].slice(0, MAX_TRASH_RECORDS);
        await backend.write(envelope(state));
        notifyChanged();
      });
    },
    restore(id: string): Promise<void> {
      return mutate(async () => {
        const state = await readLoaded();
        const record = state.trash.find((candidate) => candidate.id === id);
        if (!record) return;
        const preview = previewRunArchiveWrite(record, state);
        if (!preview.fits || preview.evictionIds.length > 0) throw new RunArchiveQuotaError(preview);
        state.rawTrash = replaceValidRecord(state.rawTrash, id, () => null);
        state.rawRecords.unshift(record);
        await backend.write(envelope(state));
        notifyChanged();
      });
    },
    setQuota(quotaBytes: number, confirmedEvictionIds: readonly string[] = []): Promise<RunArchiveWritePreview> {
      return mutate(async () => {
        if (!isFiniteNumber(quotaBytes) || quotaBytes < MIN_RUN_ARCHIVE_QUOTA_BYTES || quotaBytes > MAX_RUN_ARCHIVE_QUOTA_BYTES) {
          throw new RangeError("Run archive quota is outside the supported range.");
        }
        const state = await readLoaded();
        const preview = previewQuotaChange(state, quotaBytes);
        if (!preview.fits || preview.evictionIds.some((id) => !confirmedEvictionIds.includes(id))) {
          throw new RunArchiveQuotaError(preview);
        }
        const evictions = new Set(preview.evictionIds);
        state.rawRecords = state.rawRecords.filter((candidate) => {
          try { return !evictions.has(validateRunRecord(candidate).id); } catch { return true; }
        });
        state.quotaBytes = Math.floor(quotaBytes);
        await backend.write(envelope(state));
        notifyChanged();
        return preview;
      });
    },
  };
}

export const runArchiveStore = createRunArchiveStore(new IndexedDbRunArchiveBackend());

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export async function sha256Json(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildRunArchiveRecord(input: {
  parentRunId?: string | null;
  label: string;
  presetId: string | null;
  scenario: ScenarioInput;
  solverSettings: PortableScenarioSolverSettings;
  appVersion: string;
  renderProtocolVersion: string | null;
  renderScenarioSha256: string | null;
  provenance: PortableJson;
  scientificExport: ScientificExportDescriptor | null;
  logTail: LogEntry[];
  results: ArchivedRunResults;
}): Promise<RunArchiveRecord> {
  const createdAt = new Date().toISOString();
  const scenarioSha256 = input.renderScenarioSha256 ?? await sha256Json(input.scenario);
  const settingsSha256 = await sha256Json(input.solverSettings);
  const dataSha256 = await sha256Json({
    bathymetryAssetId: input.solverSettings.bathymetry_asset_id,
    scientificExport: input.scientificExport,
  });
  const snapshots = structuredClone(input.results.snapshots);
  const maxFrameAbs = snapshots.reduce((maximum, frame) => Math.max(maximum, frame.eta_abs_max_m), 0);
  const gaugeSampleCount = snapshots.reduce((total, frame) => total + (frame.gauge_samples?.length ?? 0), 0);
  const recordWithoutSize: Omit<RunArchiveRecord, "sizeBytes"> = {
    id: `run-${crypto.randomUUID()}`,
    parentRunId: input.parentRunId ?? null,
    createdAt,
    lastAccessedAt: createdAt,
    pinned: false,
    label: input.label.slice(0, 200),
    presetId: input.presetId,
    scenarioKind: input.scenario.kind,
    inputs: {
      scenario: structuredClone(input.scenario),
      solverSettings: structuredClone(input.solverSettings),
    },
    identity: {
      appVersion: input.appVersion,
      solverVersion: input.appVersion,
      scenarioSchemaVersion: SCENARIO_SCHEMA_VERSION,
      archiveSchemaVersion: currentUserDataSchemaVersion("runArchive"),
      scenarioSha256,
      settingsSha256,
      dataSha256,
      renderProtocolVersion: input.renderProtocolVersion,
    },
    summary: {
      durationS: snapshots.at(-1)?.time_s ?? input.solverSettings.duration_s,
      frameCount: snapshots.length,
      grid: snapshots[0] ? { nx: snapshots[0].nx, ny: snapshots[0].ny } : null,
      peakAbsMaxM: input.results.maxField?.peak_abs_max_m ?? maxFrameAbs,
      gaugeCount: input.results.gauges.length,
      gaugeSampleCount,
    },
    quality: structuredClone(input.results.runQuality),
    provenance: structuredClone(input.provenance),
    scientificExport: structuredClone(input.scientificExport),
    logTail: input.logTail.slice(-MAX_LOG_TAIL).map((entry) => ({
      ...entry,
      message: redactSensitive(entry.message),
    })),
    results: {
      snapshots,
      maxField: structuredClone(input.results.maxField),
      gauges: structuredClone(input.results.gauges),
      runQuality: structuredClone(input.results.runQuality),
      isochrones: structuredClone(input.results.isochrones),
    },
  };
  const record = { ...recordWithoutSize, sizeBytes: jsonBytes(recordWithoutSize) };
  return validateRunRecord(record);
}

export function exportRunArchiveRecord(record: RunArchiveRecord): string {
  const clean = validateRunRecord(record);
  return JSON.stringify({
    schemaVersion: currentUserDataSchemaVersion("runArchive"),
    exportedAt: new Date().toISOString(),
    record: clean,
  }, null, 2);
}

export { UserDataMigrationError };
