import { APP_VERSION } from "./model-provenance";
import {
  createScenarioPayload,
  parseScenarioPayload,
  type ScenarioInput,
  type ScenarioMigration,
  type ScenarioPayload,
} from "./scenario-schema";
import { SETTINGS_SCHEMA_VERSION } from "./settings";

export const PORTABLE_SCENARIO_FORMAT = "org.sysadmindoc.cataclysm.scenario-package";
export const PORTABLE_SCENARIO_SCHEMA_VERSION = 1;
export const PORTABLE_SCENARIO_EXTENSION = ".cataclysm";
export const PORTABLE_SCENARIO_MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
export const PORTABLE_SCENARIO_MAX_ENTRY_BYTES = 16 * 1024 * 1024;
export const PORTABLE_SCENARIO_MAX_ENTRIES = 24;

const MANIFEST_PATH = "manifest.json";
const MAX_MANIFEST_BYTES = 256 * 1024;
const ZIP_LOCAL_HEADER_BYTES = 30;
const ZIP_CENTRAL_HEADER_BYTES = 46;
const ZIP_EOCD_BYTES = 22;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE_METHOD = 0;
const CORE_PATHS = {
  scenario: "scenario.json",
  settings: "settings.json",
  solver_settings: "solver-settings.json",
  workspace: "workspace.json",
  citations: "citations.json",
  provenance: "provenance.json",
} as const;

const SAFE_MIME_TYPES = new Set([
  "application/json",
  "application/octet-stream",
  "application/x-netcdf",
  "image/jpeg",
  "image/png",
  "image/tiff",
]);
const EXECUTABLE_EXTENSIONS = new Set([
  "app", "apk", "bat", "bin", "cjs", "cmd", "com", "dll", "dylib", "exe",
  "hta", "htm", "html", "jar", "js", "lnk", "mjs", "msi", "ps1", "scr",
  "sh", "so", "svg", "vbs", "wasm", "wsf",
]);
const ENTRY_ROLES = new Set([
  "scenario",
  "settings",
  "solver_settings",
  "workspace",
  "citations",
  "provenance",
  "results",
  "checkpoints",
  "data_asset",
]);

export type PortableJson = null | boolean | number | string | PortableJson[] | { [key: string]: PortableJson };

export type PortableScenarioWorkspace = {
  layers: PortableJson;
  camera: PortableJson;
};

export type PortableScenarioSolverSettings = {
  schema_version: 1;
  use_spatial_bathymetry: boolean;
  bathymetry_asset_id: string | null;
  cells_per_degree: number;
  resolution_mode: "simple" | "customize" | "advanced";
  duration_s: number;
  frame_count: number;
  include_lamb_wave: boolean;
  boundary_mode: "sponge" | "radiation";
  checkpoint_interval_s: number;
};

export type PortableScenarioCitation = {
  label: string;
  url: string;
  role: string;
};

export type PortableScenarioDataReference = {
  id: string;
  kind: string;
  relative_path: string;
  embedded: boolean;
  sha256?: string;
};

export type PortableScenarioEmbeddedAsset = {
  path: string;
  mime: string;
  bytes: Uint8Array;
  id: string;
  kind: string;
};

export type PortableScenarioCreateInput = {
  scenario: ScenarioInput | ScenarioPayload;
  settings: PortableJson;
  solverSettings: PortableScenarioSolverSettings;
  workspace: PortableScenarioWorkspace;
  citations: PortableScenarioCitation[];
  provenance: PortableJson;
  results?: PortableJson;
  checkpoints?: PortableJson;
  dataReferences?: PortableScenarioDataReference[];
  embeddedAssets?: PortableScenarioEmbeddedAsset[];
  createdUtc?: string;
};

type PortableEntryRole =
  | "scenario"
  | "settings"
  | "solver_settings"
  | "workspace"
  | "citations"
  | "provenance"
  | "results"
  | "checkpoints"
  | "data_asset";

type PortableManifestEntry = {
  path: string;
  role: PortableEntryRole;
  mime: string;
  bytes: number;
  sha256: string;
};

type PortableManifestRoot = {
  scenario: string;
  settings: string;
  solver_settings: string;
  workspace: string;
  citations: string;
  provenance: string;
  results?: string;
  checkpoints?: string;
};

type PortableManifest = {
  format: typeof PORTABLE_SCENARIO_FORMAT;
  schema_version: number;
  created_utc: string;
  app_version: string;
  root: PortableManifestRoot;
  entries: PortableManifestEntry[];
  data_references: PortableScenarioDataReference[];
  migration_history: Array<{ code: string; description: string }>;
};

export type PortablePackageMigration = {
  code: "package-v0-to-v1";
  description: "migrated portable package schema 0 to schema 1 as an in-memory copy";
};

export type PortableScenarioImport = {
  manifest: PortableManifest;
  scenario: ScenarioInput;
  scenarioPayload: ScenarioPayload;
  settings: PortableJson;
  solverSettings: PortableScenarioSolverSettings;
  workspace: PortableScenarioWorkspace;
  citations: PortableScenarioCitation[];
  provenance: PortableJson;
  results: PortableJson | null;
  checkpoints: PortableJson | null;
  dataReferences: PortableScenarioDataReference[];
  embeddedAssets: Array<{ path: string; mime: string; bytes: Uint8Array }>;
  packageMigrations: PortablePackageMigration[];
  scenarioMigrations: readonly ScenarioMigration[];
  warnings: string[];
};

type ArchiveEntry = {
  path: string;
  bytes: Uint8Array;
};

type ParsedZipEntry = ArchiveEntry & {
  crc32: number;
  compressedBytes: number;
  expandedBytes: number;
};

function fail(message: string): never {
  throw new Error(`Portable scenario package rejected: ${message}`);
}

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function readU16(view: DataView, offset: number): number {
  if (offset < 0 || offset + 2 > view.byteLength) fail("truncated ZIP integer");
  return view.getUint16(offset, true);
}

function readU32(view: DataView, offset: number): number {
  if (offset < 0 || offset + 4 > view.byteLength) fail("truncated ZIP integer");
  return view.getUint32(offset, true);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      crcTable[index] = value >>> 0;
    }
  }
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function extension(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

function validatePath(path: unknown, label = "entry path"): string {
  if (typeof path !== "string" || path.length === 0 || path.length > 180) {
    fail(`${label} must be a non-empty UTF-8 path of at most 180 characters`);
  }
  if (path.includes("\\") || path.startsWith("/") || /^[a-zA-Z]:/.test(path)) {
    fail(`${label} must be relative and use forward slashes`);
  }
  if ([...path].some((character) => character.charCodeAt(0) <= 0x1f || character.charCodeAt(0) === 0x7f)) {
    fail(`${label} contains control characters`);
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    fail(`${label} contains an unsafe path segment`);
  }
  if (EXECUTABLE_EXTENSIONS.has(extension(path))) fail(`${label} names executable content`);
  return path;
}

function validateMime(mime: unknown, path: string): string {
  if (typeof mime !== "string" || !SAFE_MIME_TYPES.has(mime)) {
    fail(`entry ${path} uses unsupported MIME type ${String(mime)}`);
  }
  if (extension(path) === "json" && mime !== "application/json") {
    fail(`JSON entry ${path} must use application/json`);
  }
  if (mime === "application/json" && extension(path) !== "json") {
    fail(`JSON MIME entry ${path} must use a .json path`);
  }
  const expectedByExtension: Record<string, string> = {
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    nc: "application/x-netcdf",
    png: "image/png",
    tif: "image/tiff",
    tiff: "image/tiff",
  };
  const expected = expectedByExtension[extension(path)];
  if (expected && mime !== expected) fail(`entry ${path} must use MIME type ${expected}`);
  return mime;
}

function validateAssetMagic(bytes: Uint8Array, mime: string, path: string): void {
  const startsWith = (...signature: number[]) => signature.every((value, index) => bytes[index] === value);
  const valid = mime === "application/octet-stream"
    || (mime === "image/png" && startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
    || (mime === "image/jpeg" && startsWith(0xff, 0xd8, 0xff))
    || (mime === "image/tiff" && (startsWith(0x49, 0x49, 0x2a, 0x00) || startsWith(0x4d, 0x4d, 0x00, 0x2a)))
    || (mime === "application/x-netcdf" && startsWith(0x43, 0x44, 0x46)
      && [0x01, 0x02, 0x05].includes(bytes[3] ?? -1));
  if (!valid) fail(`entry ${path} does not match its declared MIME signature`);
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

function parseJson(bytes: Uint8Array, path: string): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    fail(`${path} is not valid UTF-8 JSON (${error instanceof Error ? error.message : String(error)})`);
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildStoredZip(entries: ArchiveEntry[]): Uint8Array {
  if (entries.length === 0 || entries.length > PORTABLE_SCENARIO_MAX_ENTRIES) {
    fail(`ZIP must contain 1-${PORTABLE_SCENARIO_MAX_ENTRIES} entries`);
  }
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const path = validatePath(entry.path);
    if (entry.bytes.byteLength > PORTABLE_SCENARIO_MAX_ENTRY_BYTES) {
      fail(`entry ${path} exceeds the ${PORTABLE_SCENARIO_MAX_ENTRY_BYTES}-byte limit`);
    }
    const pathBytes = encoder.encode(path);
    const checksum = crc32(entry.bytes);
    const local = new Uint8Array(ZIP_LOCAL_HEADER_BYTES + pathBytes.byteLength);
    const localView = new DataView(local.buffer);
    writeU32(localView, 0, 0x04034b50);
    writeU16(localView, 4, 20);
    writeU16(localView, 6, ZIP_UTF8_FLAG);
    writeU16(localView, 8, ZIP_STORE_METHOD);
    writeU32(localView, 14, checksum);
    writeU32(localView, 18, entry.bytes.byteLength);
    writeU32(localView, 22, entry.bytes.byteLength);
    writeU16(localView, 26, pathBytes.byteLength);
    local.set(pathBytes, ZIP_LOCAL_HEADER_BYTES);
    localParts.push(local, entry.bytes);

    const central = new Uint8Array(ZIP_CENTRAL_HEADER_BYTES + pathBytes.byteLength);
    const centralView = new DataView(central.buffer);
    writeU32(centralView, 0, 0x02014b50);
    writeU16(centralView, 4, 20);
    writeU16(centralView, 6, 20);
    writeU16(centralView, 8, ZIP_UTF8_FLAG);
    writeU16(centralView, 10, ZIP_STORE_METHOD);
    writeU32(centralView, 16, checksum);
    writeU32(centralView, 20, entry.bytes.byteLength);
    writeU32(centralView, 24, entry.bytes.byteLength);
    writeU16(centralView, 28, pathBytes.byteLength);
    writeU32(centralView, 42, localOffset);
    central.set(pathBytes, ZIP_CENTRAL_HEADER_BYTES);
    centralParts.push(central);
    localOffset += local.byteLength + entry.bytes.byteLength;
  }
  const central = concatBytes(centralParts);
  const eocd = new Uint8Array(ZIP_EOCD_BYTES);
  const eocdView = new DataView(eocd.buffer);
  writeU32(eocdView, 0, 0x06054b50);
  writeU16(eocdView, 8, entries.length);
  writeU16(eocdView, 10, entries.length);
  writeU32(eocdView, 12, central.byteLength);
  writeU32(eocdView, 16, localOffset);
  const zip = concatBytes([...localParts, central, eocd]);
  if (zip.byteLength > PORTABLE_SCENARIO_MAX_ARCHIVE_BYTES) {
    fail(`archive exceeds the ${PORTABLE_SCENARIO_MAX_ARCHIVE_BYTES}-byte limit`);
  }
  return zip;
}

function findEocd(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const earliest = Math.max(0, bytes.byteLength - 65_557);
  for (let offset = bytes.byteLength - ZIP_EOCD_BYTES; offset >= earliest; offset -= 1) {
    if (readU32(view, offset) === 0x06054b50) return offset;
  }
  fail("ZIP end-of-central-directory record is missing");
}

function parseStoredZip(input: Uint8Array): Map<string, ParsedZipEntry> {
  const bytes = Uint8Array.from(input);
  if (bytes.byteLength === 0 || bytes.byteLength > PORTABLE_SCENARIO_MAX_ARCHIVE_BYTES) {
    fail(`archive size must be 1-${PORTABLE_SCENARIO_MAX_ARCHIVE_BYTES} bytes`);
  }
  const view = new DataView(bytes.buffer);
  const eocdOffset = findEocd(bytes);
  if (readU16(view, eocdOffset + 20) !== 0 || eocdOffset + ZIP_EOCD_BYTES !== bytes.byteLength) {
    fail("ZIP comments and trailing content are not allowed");
  }
  if (readU16(view, eocdOffset + 4) !== 0 || readU16(view, eocdOffset + 6) !== 0) {
    fail("multi-disk ZIP archives are not allowed");
  }
  const entriesOnDisk = readU16(view, eocdOffset + 8);
  const entryCount = readU16(view, eocdOffset + 10);
  if (entryCount === 0 || entryCount !== entriesOnDisk || entryCount > PORTABLE_SCENARIO_MAX_ENTRIES) {
    fail(`ZIP entry count must be 1-${PORTABLE_SCENARIO_MAX_ENTRIES}`);
  }
  const centralBytes = readU32(view, eocdOffset + 12);
  const centralOffset = readU32(view, eocdOffset + 16);
  if (centralOffset + centralBytes !== eocdOffset) fail("ZIP central-directory bounds are inconsistent");

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const result = new Map<string, ParsedZipEntry>();
  const occupiedRanges: Array<[number, number]> = [];
  let totalExpanded = 0;
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (readU32(view, cursor) !== 0x02014b50) fail("invalid ZIP central-directory signature");
    const flags = readU16(view, cursor + 8);
    const method = readU16(view, cursor + 10);
    const checksum = readU32(view, cursor + 16);
    const compressedBytes = readU32(view, cursor + 20);
    const expandedBytes = readU32(view, cursor + 24);
    const nameBytes = readU16(view, cursor + 28);
    const extraBytes = readU16(view, cursor + 30);
    const commentBytes = readU16(view, cursor + 32);
    const disk = readU16(view, cursor + 34);
    const localOffset = readU32(view, cursor + 42);
    const recordEnd = cursor + ZIP_CENTRAL_HEADER_BYTES + nameBytes + extraBytes + commentBytes;
    if (recordEnd > eocdOffset) fail("truncated ZIP central-directory entry");
    if ((flags & ~ZIP_UTF8_FLAG) !== 0) fail("encrypted or data-descriptor ZIP entries are not allowed");
    if (method !== ZIP_STORE_METHOD) fail("compressed ZIP entries are not allowed; packages use bounded store-only ZIP");
    if (disk !== 0 || compressedBytes !== expandedBytes) fail("invalid store-only ZIP entry metadata");
    if (expandedBytes > PORTABLE_SCENARIO_MAX_ENTRY_BYTES) fail("ZIP entry exceeds expanded-size limit");
    totalExpanded += expandedBytes;
    if (totalExpanded > PORTABLE_SCENARIO_MAX_ARCHIVE_BYTES) fail("ZIP exceeds total expanded-size limit");
    let path: string;
    try {
      path = decoder.decode(bytes.subarray(cursor + ZIP_CENTRAL_HEADER_BYTES, cursor + ZIP_CENTRAL_HEADER_BYTES + nameBytes));
    } catch {
      fail("ZIP entry name is not valid UTF-8");
    }
    validatePath(path);
    if (result.has(path)) fail(`duplicate ZIP entry ${path}`);

    if (readU32(view, localOffset) !== 0x04034b50) fail(`entry ${path} has an invalid local header`);
    const localFlags = readU16(view, localOffset + 6);
    const localMethod = readU16(view, localOffset + 8);
    const localChecksum = readU32(view, localOffset + 14);
    const localCompressed = readU32(view, localOffset + 18);
    const localExpanded = readU32(view, localOffset + 22);
    const localNameBytes = readU16(view, localOffset + 26);
    const localExtraBytes = readU16(view, localOffset + 28);
    const dataOffset = localOffset + ZIP_LOCAL_HEADER_BYTES + localNameBytes + localExtraBytes;
    const dataEnd = dataOffset + compressedBytes;
    if (dataEnd > centralOffset) fail(`entry ${path} exceeds local-data bounds`);
    if (localFlags !== flags || localMethod !== method || localChecksum !== checksum
      || localCompressed !== compressedBytes || localExpanded !== expandedBytes) {
      fail(`entry ${path} local and central metadata disagree`);
    }
    let localPath: string;
    try {
      localPath = decoder.decode(bytes.subarray(localOffset + ZIP_LOCAL_HEADER_BYTES, localOffset + ZIP_LOCAL_HEADER_BYTES + localNameBytes));
    } catch {
      fail(`entry ${path} local name is not valid UTF-8`);
    }
    if (localPath !== path) fail(`entry ${path} local and central names disagree`);
    const payload = bytes.slice(dataOffset, dataEnd);
    if (crc32(payload) !== checksum) fail(`entry ${path} failed CRC-32 verification`);
    occupiedRanges.push([localOffset, dataEnd]);
    result.set(path, { path, bytes: payload, crc32: checksum, compressedBytes, expandedBytes });
    cursor = recordEnd;
  }
  if (cursor !== eocdOffset) fail("ZIP central directory has unparsed content");
  occupiedRanges.sort((left, right) => left[0] - right[0]);
  for (let index = 1; index < occupiedRanges.length; index += 1) {
    if (occupiedRanges[index][0] < occupiedRanges[index - 1][1]) fail("ZIP local entries overlap");
  }
  return result;
}

function parseManifest(raw: unknown): { manifest: PortableManifest; migrations: PortablePackageMigration[] } {
  const source = asRecord(raw, "manifest");
  if (source.format !== PORTABLE_SCENARIO_FORMAT) fail("manifest format identifier is unsupported");
  if (!Number.isInteger(source.schema_version) || (source.schema_version as number) < 0) {
    fail("manifest schema_version must be a non-negative integer");
  }
  if ((source.schema_version as number) > PORTABLE_SCENARIO_SCHEMA_VERSION) {
    fail(`manifest schema ${source.schema_version} is newer than supported schema ${PORTABLE_SCENARIO_SCHEMA_VERSION}`);
  }
  const copy = cloneJson(source) as Record<string, unknown>;
  const migrations: PortablePackageMigration[] = [];
  if (copy.schema_version === 0) {
    copy.schema_version = 1;
    const history = Array.isArray(copy.migration_history) ? copy.migration_history : [];
    copy.migration_history = [
      ...history,
      {
        code: "package-v0-to-v1",
        description: "migrated portable package schema 0 to schema 1 as an in-memory copy",
      },
    ];
    migrations.push({
      code: "package-v0-to-v1",
      description: "migrated portable package schema 0 to schema 1 as an in-memory copy",
    });
  }
  if (typeof copy.created_utc !== "string" || !Number.isFinite(Date.parse(copy.created_utc))) {
    fail("manifest created_utc must be an ISO timestamp");
  }
  if (typeof copy.app_version !== "string" || copy.app_version.length > 64) fail("manifest app_version is invalid");
  const root = asRecord(copy.root, "manifest root");
  for (const [role, expectedPath] of Object.entries(CORE_PATHS)) {
    if (root[role] !== expectedPath) fail(`manifest root ${role} must point to ${expectedPath}`);
  }
  for (const optional of ["results", "checkpoints"] as const) {
    if (root[optional] !== undefined) validatePath(root[optional], `manifest root ${optional}`);
  }
  const rawEntries = asArray(copy.entries, "manifest entries");
  const entries = rawEntries.map((entry, index): PortableManifestEntry => {
    const record = asRecord(entry, `manifest entry ${index}`);
    const path = validatePath(record.path, `manifest entry ${index} path`);
    if (typeof record.role !== "string" || !ENTRY_ROLES.has(record.role)) fail(`manifest entry ${path} has an invalid role`);
    const mime = validateMime(record.mime, path);
    if (!Number.isInteger(record.bytes) || (record.bytes as number) < 0 || (record.bytes as number) > PORTABLE_SCENARIO_MAX_ENTRY_BYTES) {
      fail(`manifest entry ${path} has invalid byte length`);
    }
    if (typeof record.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.sha256)) {
      fail(`manifest entry ${path} has an invalid SHA-256 digest`);
    }
    return { path, role: record.role as PortableEntryRole, mime, bytes: record.bytes as number, sha256: record.sha256 };
  });
  const paths = new Set(entries.map((entry) => entry.path));
  if (paths.size !== entries.length) fail("manifest declares duplicate entry paths");
  const dataReferences = asArray(copy.data_references ?? [], "manifest data_references")
    .map((reference, index): PortableScenarioDataReference => {
      const record = asRecord(reference, `data reference ${index}`);
      if (typeof record.id !== "string" || record.id.length === 0 || record.id.length > 128) fail(`data reference ${index} has an invalid id`);
      if (typeof record.kind !== "string" || record.kind.length === 0 || record.kind.length > 80) fail(`data reference ${index} has an invalid kind`);
      const relativePath = validatePath(record.relative_path, `data reference ${index} relative_path`);
      if (typeof record.embedded !== "boolean") fail(`data reference ${index} embedded must be boolean`);
      if (record.sha256 !== undefined && (typeof record.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.sha256))) {
        fail(`data reference ${index} has an invalid digest`);
      }
      if (record.embedded && !paths.has(relativePath)) fail(`embedded data reference ${record.id} is missing its entry`);
      return {
        id: record.id,
        kind: record.kind,
        relative_path: relativePath,
        embedded: record.embedded,
        ...(typeof record.sha256 === "string" ? { sha256: record.sha256 } : {}),
      };
    });
  const migrationHistory = asArray(copy.migration_history ?? [], "manifest migration_history")
    .map((item, index) => {
      const record = asRecord(item, `migration history ${index}`);
      if (typeof record.code !== "string" || typeof record.description !== "string") fail(`migration history ${index} is invalid`);
      return { code: record.code, description: record.description };
    });
  return {
    manifest: {
      format: PORTABLE_SCENARIO_FORMAT,
      schema_version: PORTABLE_SCENARIO_SCHEMA_VERSION,
      created_utc: copy.created_utc as string,
      app_version: copy.app_version as string,
      root: root as PortableManifestRoot,
      entries,
      data_references: dataReferences,
      migration_history: migrationHistory,
    },
    migrations,
  };
}

function validateCitations(value: unknown): PortableScenarioCitation[] {
  const citations = asArray(value, "citations");
  if (citations.length > 128) fail("package contains too many citations");
  return citations.map((citation, index) => {
    const record = asRecord(citation, `citation ${index}`);
    if (typeof record.label !== "string" || record.label.trim().length === 0 || record.label.length > 240) fail(`citation ${index} has an invalid label`);
    if (typeof record.role !== "string" || record.role.trim().length === 0 || record.role.length > 120) fail(`citation ${index} has an invalid role`);
    if (typeof record.url !== "string" || !record.url.startsWith("https://") || record.url.length > 2048) fail(`citation ${index} must use an HTTPS URL`);
    return { label: record.label, role: record.role, url: record.url };
  });
}

function validateSettings(value: unknown): PortableJson {
  const record = asRecord(value, "settings");
  if ("cesium_token" in record) fail("settings must not contain Cesium credentials");
  if (!Number.isInteger(record._schema_version) || (record._schema_version as number) < 0) {
    fail("settings _schema_version must be a non-negative integer");
  }
  if ((record._schema_version as number) > SETTINGS_SCHEMA_VERSION) {
    fail(`settings schema ${record._schema_version} is newer than supported schema ${SETTINGS_SCHEMA_VERSION}`);
  }
  return cloneJson(record) as PortableJson;
}

function validateWorkspace(value: unknown): PortableScenarioWorkspace {
  const record = asRecord(value, "workspace");
  if (!("layers" in record) || !("camera" in record)) fail("workspace must contain layers and camera");
  const layers = asArray(record.layers, "workspace layers");
  if (layers.length > 32) fail("workspace contains too many layers");
  for (const [index, layer] of layers.entries()) {
    const item = asRecord(layer, `workspace layer ${index}`);
    if (typeof item.id !== "string" || item.id.length === 0 || item.id.length > 80) fail(`workspace layer ${index} has an invalid id`);
    if (typeof item.visible !== "boolean") fail(`workspace layer ${index} visible must be boolean`);
    if (typeof item.opacity !== "number" || !Number.isFinite(item.opacity) || item.opacity < 0 || item.opacity > 1) {
      fail(`workspace layer ${index} opacity must be in [0, 1]`);
    }
    if (!Number.isInteger(item.order) || (item.order as number) < 0 || (item.order as number) > 100) {
      fail(`workspace layer ${index} order is invalid`);
    }
  }
  const camera = asRecord(record.camera, "workspace camera");
  for (const field of ["lat", "lon", "altitude_m", "heading_deg"] as const) {
    if (typeof camera[field] !== "number" || !Number.isFinite(camera[field])) fail(`workspace camera ${field} must be finite`);
  }
  if ((camera.lat as number) < -90 || (camera.lat as number) > 90
    || (camera.lon as number) < -180 || (camera.lon as number) > 180
    || (camera.altitude_m as number) < 1 || (camera.altitude_m as number) > 100_000_000) {
    fail("workspace camera is outside supported bounds");
  }
  if (camera.pitch_deg !== undefined && (typeof camera.pitch_deg !== "number" || !Number.isFinite(camera.pitch_deg))) {
    fail("workspace camera pitch_deg must be finite when present");
  }
  return { layers: cloneJson(record.layers) as PortableJson, camera: cloneJson(record.camera) as PortableJson };
}

function validateSolverSettings(value: unknown): PortableScenarioSolverSettings {
  const record = asRecord(value, "solver settings");
  if (record.schema_version !== 1) fail("solver settings schema_version must be 1");
  if (typeof record.use_spatial_bathymetry !== "boolean") fail("solver setting use_spatial_bathymetry must be boolean");
  if (record.bathymetry_asset_id !== null && (typeof record.bathymetry_asset_id !== "string" || record.bathymetry_asset_id.length > 180)) {
    fail("solver setting bathymetry_asset_id is invalid");
  }
  if (!Number.isInteger(record.cells_per_degree) || (record.cells_per_degree as number) < 3 || (record.cells_per_degree as number) > 12) {
    fail("solver setting cells_per_degree must be in [3, 12]");
  }
  if (!(["simple", "customize", "advanced"] as unknown[]).includes(record.resolution_mode)) fail("solver setting resolution_mode is invalid");
  if (record.duration_s !== 3600) fail("solver setting duration_s must match the current one-hour workflow");
  if (record.frame_count !== 60) fail("solver setting frame_count must match the current 60-frame workflow");
  if (typeof record.include_lamb_wave !== "boolean") fail("solver setting include_lamb_wave must be boolean");
  if (record.boundary_mode !== "sponge" && record.boundary_mode !== "radiation") fail("solver setting boundary_mode is invalid");
  if (![30, 60, 300].includes(record.checkpoint_interval_s as number)) fail("solver setting checkpoint_interval_s is invalid");
  return cloneJson(record) as PortableScenarioSolverSettings;
}

function validateResults(value: unknown): PortableJson {
  const record = asRecord(value, "results");
  if (record.schema_version !== 1) fail("results schema_version must be 1");
  const snapshots = asArray(record.snapshots, "result snapshots");
  if (snapshots.length > 1000) fail("results contain too many snapshots");
  for (const [index, snapshot] of snapshots.entries()) {
    const item = asRecord(snapshot, `result snapshot ${index}`);
    if (typeof item.time_s !== "number" || !Number.isFinite(item.time_s) || item.time_s < 0) fail(`result snapshot ${index} has invalid time_s`);
    if (!Number.isInteger(item.nx) || !Number.isInteger(item.ny) || (item.nx as number) < 1 || (item.ny as number) < 1) {
      fail(`result snapshot ${index} has invalid dimensions`);
    }
    const bbox = asArray(item.bbox, `result snapshot ${index} bbox`);
    if (bbox.length !== 4 || bbox.some((coordinate) => typeof coordinate !== "number" || !Number.isFinite(coordinate))) {
      fail(`result snapshot ${index} has invalid bbox`);
    }
    if (typeof item.eta_png_b64 !== "string" || item.eta_png_b64.length > PORTABLE_SCENARIO_MAX_ENTRY_BYTES
      || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.eta_png_b64)) {
      fail(`result snapshot ${index} has invalid image payload`);
    }
  }
  for (const field of ["gauges", "isochrones"] as const) {
    const items = asArray(record[field], `results ${field}`);
    if (items.length > 10_000) fail(`results contain too many ${field}`);
  }
  if (record.max_field !== null) asRecord(record.max_field, "results max_field");
  if (record.run_quality !== null) asRecord(record.run_quality, "results run_quality");
  return cloneJson(record) as PortableJson;
}

export async function createPortableScenarioPackage(input: PortableScenarioCreateInput): Promise<Uint8Array> {
  const parsedScenario = "schemaVersion" in input.scenario
    ? parseScenarioPayload(input.scenario)
    : createScenarioPayload(input.scenario);
  if (!parsedScenario.ok) fail(`scenario is invalid (${parsedScenario.reason})`);
  const settings = validateSettings(input.settings);
  validateWorkspace(input.workspace);
  validateSolverSettings(input.solverSettings);
  validateCitations(input.citations);
  asRecord(input.provenance, "provenance");
  if (input.results !== undefined) validateResults(input.results);
  const createdUtc = input.createdUtc ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(createdUtc))) fail("createdUtc must be an ISO timestamp");

  const payloads: Array<{ path: string; role: PortableEntryRole; mime: string; bytes: Uint8Array }> = [
    { path: CORE_PATHS.scenario, role: "scenario", mime: "application/json", bytes: jsonBytes(parsedScenario.payload) },
    { path: CORE_PATHS.settings, role: "settings", mime: "application/json", bytes: jsonBytes(settings) },
    { path: CORE_PATHS.solver_settings, role: "solver_settings", mime: "application/json", bytes: jsonBytes(input.solverSettings) },
    { path: CORE_PATHS.workspace, role: "workspace", mime: "application/json", bytes: jsonBytes(input.workspace) },
    { path: CORE_PATHS.citations, role: "citations", mime: "application/json", bytes: jsonBytes(input.citations) },
    { path: CORE_PATHS.provenance, role: "provenance", mime: "application/json", bytes: jsonBytes(input.provenance) },
  ];
  const root: PortableManifestRoot = { ...CORE_PATHS };
  if (input.results !== undefined) {
    root.results = "results.json";
    payloads.push({ path: root.results, role: "results", mime: "application/json", bytes: jsonBytes(input.results) });
  }
  if (input.checkpoints !== undefined) {
    root.checkpoints = "checkpoints.json";
    payloads.push({ path: root.checkpoints, role: "checkpoints", mime: "application/json", bytes: jsonBytes(input.checkpoints) });
  }
  const dataReferences = cloneJson(input.dataReferences ?? []);
  for (const reference of dataReferences) {
    validatePath(reference.relative_path, `data reference ${reference.id} path`);
    if (reference.embedded) fail(`embedded data reference ${reference.id} must be supplied through embeddedAssets`);
  }
  for (const asset of input.embeddedAssets ?? []) {
    const path = validatePath(asset.path, `embedded asset ${asset.id} path`);
    const mime = validateMime(asset.mime, path);
    validateAssetMagic(asset.bytes, mime, path);
    const digest = await sha256(asset.bytes);
    payloads.push({ path, role: "data_asset", mime, bytes: Uint8Array.from(asset.bytes) });
    dataReferences.push({ id: asset.id, kind: asset.kind, relative_path: path, embedded: true, sha256: digest });
  }
  if (payloads.length + 1 > PORTABLE_SCENARIO_MAX_ENTRIES) fail("package has too many entries");
  const manifestEntries: PortableManifestEntry[] = [];
  for (const payload of payloads) {
    if (payload.bytes.byteLength > PORTABLE_SCENARIO_MAX_ENTRY_BYTES) fail(`entry ${payload.path} exceeds the entry-size limit`);
    manifestEntries.push({
      path: payload.path,
      role: payload.role,
      mime: payload.mime,
      bytes: payload.bytes.byteLength,
      sha256: await sha256(payload.bytes),
    });
  }
  const manifest: PortableManifest = {
    format: PORTABLE_SCENARIO_FORMAT,
    schema_version: PORTABLE_SCENARIO_SCHEMA_VERSION,
    created_utc: createdUtc,
    app_version: APP_VERSION,
    root,
    entries: manifestEntries,
    data_references: dataReferences,
    migration_history: [],
  };
  parseManifest(manifest);
  const manifestBytes = jsonBytes(manifest);
  if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) fail("manifest exceeds the size limit");
  return buildStoredZip([{ path: MANIFEST_PATH, bytes: manifestBytes }, ...payloads]);
}

export async function inspectPortableScenarioPackage(input: ArrayBuffer | Uint8Array): Promise<PortableScenarioImport> {
  const archive = parseStoredZip(input instanceof Uint8Array ? input : new Uint8Array(input));
  const manifestEntry = archive.get(MANIFEST_PATH);
  if (!manifestEntry) fail(`${MANIFEST_PATH} is missing`);
  if (manifestEntry.bytes.byteLength > MAX_MANIFEST_BYTES) fail("manifest exceeds the size limit");
  const { manifest, migrations } = parseManifest(parseJson(manifestEntry.bytes, MANIFEST_PATH));
  if (archive.size !== manifest.entries.length + 1) fail("archive contains undeclared entries");

  const declared = new Map(manifest.entries.map((entry) => [entry.path, entry]));
  for (const [path, entry] of archive) {
    if (path === MANIFEST_PATH) continue;
    const declaration = declared.get(path);
    if (!declaration) fail(`archive entry ${path} is not declared by the manifest`);
    validateMime(declaration.mime, path);
    if (entry.bytes.byteLength !== declaration.bytes) fail(`entry ${path} byte length does not match the manifest`);
    if (await sha256(entry.bytes) !== declaration.sha256) fail(`entry ${path} failed SHA-256 verification`);
  }
  for (const declaration of manifest.entries) {
    if (!archive.has(declaration.path)) fail(`declared entry ${declaration.path} is missing`);
  }
  const roleAt = (path: string, role: PortableEntryRole) => {
    const declaration = declared.get(path);
    if (!declaration || declaration.role !== role) fail(`${path} must have role ${role}`);
    return archive.get(path)?.bytes ?? fail(`${path} is missing`);
  };
  const scenarioRaw = parseJson(roleAt(manifest.root.scenario, "scenario"), manifest.root.scenario);
  const scenario = parseScenarioPayload(scenarioRaw);
  if (!scenario.ok) fail(`scenario entry is invalid (${scenario.reason})`);
  const settings = validateSettings(parseJson(roleAt(manifest.root.settings, "settings"), manifest.root.settings));
  const solverSettings = validateSolverSettings(parseJson(roleAt(manifest.root.solver_settings, "solver_settings"), manifest.root.solver_settings));
  const workspace = validateWorkspace(parseJson(roleAt(manifest.root.workspace, "workspace"), manifest.root.workspace));
  const citations = validateCitations(parseJson(roleAt(manifest.root.citations, "citations"), manifest.root.citations));
  const provenance = parseJson(roleAt(manifest.root.provenance, "provenance"), manifest.root.provenance);
  asRecord(provenance, "provenance");
  const results = manifest.root.results
    ? validateResults(parseJson(roleAt(manifest.root.results, "results"), manifest.root.results))
    : null;
  const checkpoints = manifest.root.checkpoints
    ? parseJson(roleAt(manifest.root.checkpoints, "checkpoints"), manifest.root.checkpoints) as PortableJson
    : null;
  const embeddedAssets = manifest.data_references
    .filter((reference) => reference.embedded)
    .map((reference) => {
      const declaration = declared.get(reference.relative_path);
      const entry = archive.get(reference.relative_path);
      if (!declaration || declaration.role !== "data_asset" || !entry) fail(`embedded data reference ${reference.id} is invalid`);
      if (reference.sha256 && reference.sha256 !== declaration.sha256) fail(`embedded data reference ${reference.id} digest disagrees with its entry`);
      validateAssetMagic(entry.bytes, declaration.mime, reference.relative_path);
      return { path: reference.relative_path, mime: declaration.mime, bytes: Uint8Array.from(entry.bytes) };
    });
  const warnings: string[] = [];
  if (manifest.app_version !== APP_VERSION) warnings.push(`Package was created by Cataclysm ${manifest.app_version}; this build is ${APP_VERSION}.`);
  const missingReferences = manifest.data_references.filter((reference) => !reference.embedded);
  if (missingReferences.length > 0) warnings.push(`${missingReferences.length} local data reference(s) must be relinked on this machine.`);
  if (results === null) warnings.push("Package does not embed a result snapshot; reopen and run to recompute results.");

  return {
    manifest,
    scenario: cloneJson(scenario.scenario),
    scenarioPayload: cloneJson(scenario.payload),
    settings,
    solverSettings,
    workspace,
    citations,
    provenance: cloneJson(provenance) as PortableJson,
    results: cloneJson(results),
    checkpoints: cloneJson(checkpoints),
    dataReferences: cloneJson(manifest.data_references),
    embeddedAssets,
    packageMigrations: migrations,
    scenarioMigrations: scenario.migrations,
    warnings,
  };
}
