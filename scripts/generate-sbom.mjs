#!/usr/bin/env node
/**
 * Generate a CycloneDX SBOM covering both npm and Cargo dependency trees.
 * Outputs:
 *   artifacts/sbom-npm.json     — npm dependencies (CycloneDX JSON)
 *   artifacts/sbom-cargo.json   — Cargo dependencies (CycloneDX JSON)
 *
 * Run as part of the local release process: `node scripts/generate-sbom.mjs`
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outDir = path.join(repoRoot, "artifacts");

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

function run(label, command, args) {
  console.log(`\n==> ${label}`);
  console.log(`$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) {
    console.error(`${label} failed: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`${label} exited with code ${result.status}`);
    process.exit(1);
  }
}

run("npm SBOM (CycloneDX)", "npx", [
  "@cyclonedx/cyclonedx-npm",
  "--output-file", path.join(outDir, "sbom-npm.json"),
  "--spec-version", "1.5",
  "--output-reproducible",
]);

run("Cargo SBOM (CycloneDX)", "cargo", [
  "cyclonedx",
  "--manifest-path", path.join(repoRoot, "src-tauri", "Cargo.toml"),
  "--format", "json",
  "--describe", "crate",
]);

// cargo-cyclonedx outputs next to Cargo.toml as <crate-name>.cdx.json
import { renameSync, readdirSync } from "node:fs";
const tauriDir = path.join(repoRoot, "src-tauri");
const cdxFile = readdirSync(tauriDir).find(f => f.endsWith(".cdx.json"));
if (cdxFile) {
  renameSync(path.join(tauriDir, cdxFile), path.join(outDir, "sbom-cargo.json"));
}

console.log("\n✓ SBOMs generated in artifacts/");
