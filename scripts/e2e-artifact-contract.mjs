import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export const E2E_ARTIFACT_SCHEMA_VERSION = 1;
export const E2E_PROVENANCE_PATH = "dist/build-provenance.json";
export const E2E_REQUIRED_OUTPUTS = [
  "dist/index.html",
  "dist/manifest.webmanifest",
  "dist/sw.js",
];

const EXACT_INPUTS = [
  "index.html",
  "package.json",
  "package-lock.json",
  "playwright.config.ts",
  "tsconfig.json",
  "tsconfig.node.json",
  "tsconfig.support.json",
  "vite.config.ts",
];
const INPUT_DIRECTORIES = ["assets/earth", "public", "scripts", "src", "src-tauri/icons", "src-tauri/wasm"];
const SKIPPED_DIRECTORIES = new Set(["dist", "node_modules", "target"]);

function normalizeRelativePath(value) {
  return value.replaceAll(path.sep, "/");
}

function walkFiles(root, directory) {
  const absolute = path.join(root, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) return [];
      return walkFiles(root, relative);
    }
    return entry.isFile() ? [normalizeRelativePath(relative)] : [];
  });
}

export function discoverE2eBuildInputs(root) {
  const exact = EXACT_INPUTS.filter((relative) => existsSync(path.join(root, relative)));
  const nested = INPUT_DIRECTORIES.flatMap((directory) => walkFiles(root, directory));
  return [...new Set([...exact, ...nested])].sort();
}

export function computeE2eBuildDigest(root, inputFiles = discoverE2eBuildInputs(root)) {
  const digest = createHash("sha256");
  digest.update(`cataclysm-e2e-artifact-v${E2E_ARTIFACT_SCHEMA_VERSION}\0`);
  for (const relative of [...inputFiles].map(normalizeRelativePath).sort()) {
    const absolute = path.join(root, relative);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      throw new Error(`E2E build input is missing: ${relative}`);
    }
    const content = readFileSync(absolute);
    digest.update(relative);
    digest.update("\0");
    digest.update(String(content.byteLength));
    digest.update("\0");
    digest.update(content);
    digest.update("\0");
  }
  return digest.digest("hex");
}

export function writeE2eArtifactProvenance(root, options = {}) {
  const inputFiles = options.inputFiles ?? discoverE2eBuildInputs(root);
  const provenancePath = options.provenancePath ?? E2E_PROVENANCE_PATH;
  const record = {
    schemaVersion: E2E_ARTIFACT_SCHEMA_VERSION,
    sourceDigest: computeE2eBuildDigest(root, inputFiles),
    inputCount: inputFiles.length,
  };
  writeFileSync(path.join(root, provenancePath), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return record;
}

export function inspectE2eArtifact(root, options = {}) {
  const inputFiles = options.inputFiles ?? discoverE2eBuildInputs(root);
  const provenancePath = options.provenancePath ?? E2E_PROVENANCE_PATH;
  const requiredOutputs = options.requiredOutputs ?? E2E_REQUIRED_OUTPUTS;
  const failures = [];
  const absoluteProvenance = path.join(root, provenancePath);
  let record;

  if (!existsSync(absoluteProvenance)) {
    failures.push(`${provenancePath} is missing`);
  } else {
    try {
      record = JSON.parse(readFileSync(absoluteProvenance, "utf8"));
    } catch (error) {
      failures.push(`${provenancePath} is invalid JSON (${error.message})`);
    }
  }

  const expectedDigest = computeE2eBuildDigest(root, inputFiles);
  if (record) {
    if (record.schemaVersion !== E2E_ARTIFACT_SCHEMA_VERSION) {
      failures.push(
        `${provenancePath} schema ${String(record.schemaVersion)} does not match ${E2E_ARTIFACT_SCHEMA_VERSION}`,
      );
    }
    if (record.sourceDigest !== expectedDigest) {
      failures.push(`${provenancePath} is stale for the current source digest`);
    }
    if (record.inputCount !== inputFiles.length) {
      failures.push(`${provenancePath} input count does not match the current build inputs`);
    }
  }

  for (const relative of requiredOutputs) {
    if (!existsSync(path.join(root, relative))) failures.push(`${relative} is missing`);
  }

  return { ok: failures.length === 0, failures, expectedDigest, record };
}

export function assertFreshE2eArtifact(root, options = {}) {
  const result = inspectE2eArtifact(root, options);
  if (!result.ok) {
    throw new Error(`E2E artifact is not fresh:\n${result.failures.map((failure) => `- ${failure}`).join("\n")}`);
  }
  return result;
}
