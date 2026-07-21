#!/usr/bin/env node
/**
 * Emit an SLSA build-provenance attestation for the local release build.
 *
 * Reads the release build manifest and the CycloneDX SBOMs produced earlier in
 * the release flow, then writes `artifacts/provenance.json` (an in-toto
 * Statement). Run after `scripts/build-release.mjs` has written its manifest and
 * `scripts/generate-sbom.mjs` has written the SBOMs — or standalone once both
 * exist. Purely local; no remote builder or network access.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildProvenanceStatement } from "./provenance.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactsDir = path.join(repoRoot, "artifacts");
const manifestPath = path.join(
  repoRoot,
  "src-tauri",
  "target",
  "release",
  "bundle",
  "cataclysm-build-manifest.json",
);

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function sbomDescriptor(fileName) {
  const filePath = path.join(artifactsDir, fileName);
  if (!existsSync(filePath)) {
    throw new Error(
      `Missing ${fileName}. Run "npm run generate:sbom" before generating provenance.`,
    );
  }
  return { name: fileName, sha256: sha256(filePath) };
}

function main() {
  if (!existsSync(manifestPath)) {
    throw new Error(
      `Missing build manifest at ${manifestPath}. Run "npm run tauri:build" first.`,
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const sboms = [sbomDescriptor("sbom-npm.json"), sbomDescriptor("sbom-cargo.json")];

  const now = new Date().toISOString();
  const statement = buildProvenanceStatement({
    manifest,
    sboms,
    startedOn: now,
    finishedOn: now,
  });

  if (!existsSync(artifactsDir)) mkdirSync(artifactsDir, { recursive: true });
  const outPath = path.join(artifactsDir, "provenance.json");
  writeFileSync(outPath, `${JSON.stringify(statement, null, 2)}\n`);
  console.log(
    `✓ Wrote SLSA provenance for ${statement.subject.length} artifact(s) to ${path.relative(repoRoot, outPath)}`,
  );
}

try {
  main();
} catch (error) {
  console.error(`Provenance generation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
