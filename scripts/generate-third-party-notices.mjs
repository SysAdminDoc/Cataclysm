#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import generateLicenseFile from "generate-license-file";

const { getProjectLicenses } = generateLicenseFile;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactPath = path.join(repoRoot, "THIRD_PARTY_NOTICES.txt");
const packageJsonPath = path.join(repoRoot, "package.json");
const packageLockPath = path.join(repoRoot, "package-lock.json");
const cargoLockPath = path.join(repoRoot, "src-tauri", "Cargo.lock");
const aboutConfigPath = path.join(repoRoot, "src-tauri", "about.toml");
const glfConfigPath = path.join(repoRoot, ".generatelicensefile.json");
const overrideManifestPath = path.join(repoRoot, "scripts", "third-party-notice-overrides.json");
const EXPECTED_CARGO_ABOUT_VERSION = "0.9.1";
const EXPECTED_GLF_VERSION = "4.2.1";
const UNKNOWN_LICENSE = /(?:^|\b)(?:unknown|unlicensed|noassertion)(?:\b|$)/i;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fileSha256(file) {
  return sha256(readFileSync(file));
}

function normalizedText(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd();
}

function normalizedRepository(repository, fallback) {
  let value = typeof repository === "string" ? repository : repository?.url;
  value = String(value || fallback || "").trim();
  value = value
    .replace(/^git\+/, "")
    .replace(/^github:/, "https://github.com/")
    .replace(/^git:\/\/github\.com\//, "https://github.com/")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "");
  if (!/^https?:\/\//.test(value)) value = String(fallback || "").trim();
  return value;
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function npmProductionEntries(packageLock) {
  return Object.entries(packageLock.packages ?? {})
    .filter(([lockPath, metadata]) => lockPath && metadata.dev !== true)
    .map(([lockPath, metadata]) => {
      const directory = path.join(repoRoot, lockPath);
      const manifestPath = path.join(directory, "package.json");
      invariant(existsSync(manifestPath), `production npm package is not installed: ${lockPath}`);
      const manifest = readJson(manifestPath);
      invariant(manifest.name && metadata.version, `invalid npm lock entry: ${lockPath}`);
      const id = `${manifest.name}@${metadata.version}`;
      const license = String(metadata.license ?? manifest.license ?? "").trim();
      invariant(license && !UNKNOWN_LICENSE.test(license), `${id} has a missing or unknown license`);
      const source = normalizedRepository(manifest.repository, manifest.homepage || metadata.resolved);
      invariant(/^https?:\/\//.test(source), `${id} has no reviewable source link`);
      return { id, license, source, integrity: metadata.integrity ?? "", lockPath, metadata };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function validateOverrides(entries, glfConfig, overrideManifest) {
  invariant(overrideManifest.schema_version === 1, "unsupported third-party override schema");
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const replacementKeys = Object.keys(glfConfig.replace ?? {}).sort();
  const manifestKeys = Object.keys(overrideManifest.overrides ?? {}).sort();
  invariant(
    JSON.stringify(replacementKeys) === JSON.stringify(manifestKeys),
    "generate-license-file replacements and digest-pinned overrides differ",
  );

  for (const id of manifestKeys) {
    const entry = byId.get(id);
    const override = overrideManifest.overrides[id];
    invariant(entry, `override targets a non-production or missing package: ${id}`);
    invariant(entry.license === override.declared_spdx, `${id} declared SPDX drifted from its override`);
    invariant(entry.integrity === override.package_integrity, `${id} package integrity drifted from its override`);
    invariant(override.resolved_spdx && !UNKNOWN_LICENSE.test(override.resolved_spdx), `${id} override has no resolved SPDX expression`);
    invariant(glfConfig.replace[id] === `./${override.replacement}`, `${id} replacement path differs between configs`);
    const replacementPath = path.join(repoRoot, override.replacement);
    invariant(existsSync(replacementPath), `${id} replacement file is missing`);
    invariant(fileSha256(replacementPath) === override.replacement_sha256, `${id} replacement digest drifted`);
    if (override.evidence) {
      const evidencePath = path.join(repoRoot, override.evidence);
      invariant(existsSync(evidencePath), `${id} override evidence is missing`);
      invariant(fileSha256(evidencePath) === override.evidence_sha256, `${id} evidence digest drifted`);
    }
  }
}

function cargoAboutJson(tempRoot) {
  const version = spawnSync("cargo", ["about", "--version"], { encoding: "utf8", windowsHide: true });
  invariant(!version.error && version.status === 0, "cargo-about is required; install cargo-about 0.9.1 with the cli feature");
  invariant(
    normalizedText(version.stdout) === `cargo-about ${EXPECTED_CARGO_ABOUT_VERSION}`,
    `cargo-about ${EXPECTED_CARGO_ABOUT_VERSION} is required; found ${normalizedText(version.stdout) || "unknown"}`,
  );
  const output = path.join(tempRoot, "cargo-about.json");
  const result = spawnSync("cargo", [
    "about",
    "generate",
    "--manifest-path", path.join(repoRoot, "src-tauri", "Cargo.toml"),
    "--config", aboutConfigPath,
    "--features", "gpu",
    "--target", "x86_64-pc-windows-msvc",
    "--offline",
    "--locked",
    "--fail",
    "--format", "json",
    "--output-file", output,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  invariant(
    !result.error && result.status === 0,
    `cargo-about failed offline: ${normalizedText(result.stderr || result.error?.message)}`,
  );
  return readJson(output);
}

function renderInventory(title, entries, overrides = {}) {
  const lines = [title, "=".repeat(title.length), ""];
  for (const entry of entries) {
    lines.push(entry.id);
    lines.push(`Declared SPDX: ${entry.license}`);
    if (overrides[entry.id]) {
      lines.push(`Resolved SPDX: ${overrides[entry.id].resolved_spdx}`);
      lines.push(`Override text SHA-256: ${overrides[entry.id].replacement_sha256}`);
    }
    lines.push(`Source: ${entry.source}`);
    if (entry.integrity) lines.push(`Lock integrity: ${entry.integrity}`);
    lines.push("");
  }
  return lines.join("\n");
}

function renderNpmLicenses(licenses) {
  const sorted = [...licenses].sort((left, right) => {
    const leftKey = sortedUnique(left.dependencies).join("\0");
    const rightKey = sortedUnique(right.dependencies).join("\0");
    return leftKey.localeCompare(rightKey) || normalizedText(left.content).localeCompare(normalizedText(right.content));
  });
  const lines = ["NPM LICENSE TEXTS", "=================", ""];
  for (const license of sorted) {
    const dependencies = sortedUnique(license.dependencies);
    invariant(dependencies.length > 0, "generate-license-file emitted an empty dependency group");
    const content = normalizedText(license.content);
    invariant(content && !UNKNOWN_LICENSE.test(content), `npm license text is missing for ${dependencies.join(", ")}`);
    lines.push(`Applies to: ${dependencies.join(", ")}`);
    lines.push(`Text SHA-256: ${sha256(content)}`);
    lines.push("");
    lines.push(content);
    for (const notice of license.notices ?? []) {
      lines.push("");
      lines.push(normalizedText(notice));
    }
    lines.push("", "-".repeat(79), "");
  }
  return lines.join("\n");
}

function rustEntries(about) {
  const entries = about.crates.map(({ package: metadata, license }) => {
    const expression = String(license || metadata.license || "").trim();
    invariant(expression && !UNKNOWN_LICENSE.test(expression), `${metadata.name}@${metadata.version} has an unknown Rust license`);
    const source = normalizedRepository(
      metadata.repository,
      metadata.homepage || `https://crates.io/crates/${encodeURIComponent(metadata.name)}/${encodeURIComponent(metadata.version)}`,
    );
    invariant(/^https?:\/\//.test(source), `${metadata.name}@${metadata.version} has no reviewable source link`);
    return { id: `${metadata.name}@${metadata.version}`, license: expression, source, integrity: "" };
  }).sort((left, right) => left.id.localeCompare(right.id));
  invariant(entries.some((entry) => entry.id.startsWith("wgpu@")), "GPU production dependency graph omitted wgpu");
  invariant(!entries.some((entry) => entry.id.startsWith("proptest@") || entry.id.startsWith("tauri-build@")),
    "Rust notice graph included dev/build-only packages");
  return entries;
}

function renderRustLicenses(about) {
  const groups = about.licenses.map((license) => {
    const text = normalizedText(license.text);
    invariant(text, `cargo-about emitted no text for ${license.id}`);
    const dependencies = sortedUnique((license.used_by ?? []).map(({ crate }) => `${crate.name}@${crate.version}`));
    invariant(dependencies.length > 0, `cargo-about emitted no package owners for ${license.id}`);
    return { ...license, text, dependencies, digest: sha256(text) };
  }).sort((left, right) => left.id.localeCompare(right.id) || left.digest.localeCompare(right.digest));
  const lines = ["RUST LICENSE TEXTS", "==================", ""];
  for (const group of groups) {
    lines.push(`${group.name} (${group.id})`);
    lines.push(`Applies to: ${group.dependencies.join(", ")}`);
    lines.push(`Text SHA-256: ${group.digest}`);
    lines.push("", group.text, "", "-".repeat(79), "");
  }
  return lines.join("\n");
}

async function generateArtifact() {
  const packageLock = readJson(packageLockPath);
  invariant(packageLock.lockfileVersion === 3, "unsupported package-lock format");
  const packageManifest = readJson(packageJsonPath);
  const glfVersion = readJson(path.join(repoRoot, "node_modules", "generate-license-file", "package.json")).version;
  invariant(glfVersion === EXPECTED_GLF_VERSION, `generate-license-file ${EXPECTED_GLF_VERSION} is required; found ${glfVersion}`);
  const npmEntries = npmProductionEntries(packageLock);
  const glfConfig = readJson(glfConfigPath);
  const overrideManifest = readJson(overrideManifestPath);
  validateOverrides(npmEntries, glfConfig, overrideManifest);

  const npmLicenses = await getProjectLicenses(packageJsonPath, { replace: glfConfig.replace });
  const generatedNpmIds = sortedUnique(npmLicenses.flatMap((license) => license.dependencies));
  invariant(
    JSON.stringify(generatedNpmIds) === JSON.stringify(npmEntries.map((entry) => entry.id)),
    "npm notice graph differs from the production-only lockfile graph",
  );
  for (const override of Object.values(overrideManifest.overrides)) {
    const expected = normalizedText(readFileSync(path.join(repoRoot, override.replacement), "utf8"));
    invariant(
      npmLicenses.some((license) => normalizedText(license.content) === expected),
      `override text was not consumed: ${override.replacement}`,
    );
  }

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "cataclysm-third-party-notices-"));
  try {
    const about = cargoAboutJson(tempRoot);
    const rust = rustEntries(about);
    const header = [
      "CATACLYSM THIRD-PARTY NOTICES",
      "=============================",
      "",
      "Generated deterministically from package-lock.json and src-tauri/Cargo.lock.",
      "Do not edit this artifact directly; run npm run generate:notices.",
      "Scope: production npm dependencies and Windows x86_64 GPU Rust runtime dependencies.",
      "Development-only and build-only packages are excluded.",
      `Application version: ${packageManifest.version}`,
      `Generators: cargo-about ${EXPECTED_CARGO_ABOUT_VERSION}; generate-license-file ${EXPECTED_GLF_VERSION}`,
      `package-lock.json SHA-256: ${fileSha256(packageLockPath)}`,
      `src-tauri/Cargo.lock SHA-256: ${fileSha256(cargoLockPath)}`,
      `Production components: ${npmEntries.length} npm; ${rust.length} Rust`,
      "",
    ].join("\n");
    const artifact = [
      header,
      renderInventory("NPM PRODUCTION INVENTORY", npmEntries, overrideManifest.overrides),
      renderInventory("RUST PRODUCTION INVENTORY", rust),
      renderNpmLicenses(npmLicenses),
      renderRustLicenses(about),
    ].join("\n\n").replace(/\n{4,}/g, "\n\n\n") + "\n";
    invariant(!artifact.includes(repoRoot), "notice artifact exposed the local repository path");
    invariant(Buffer.byteLength(artifact) < 8 * 1024 * 1024, "notice artifact exceeds the 8 MiB bundle limit");
    return artifact;
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

const check = process.argv.includes("--check");
try {
  const artifact = await generateArtifact();
  if (check) {
    invariant(existsSync(artifactPath), "THIRD_PARTY_NOTICES.txt is missing; run npm run generate:notices");
    invariant(readFileSync(artifactPath, "utf8") === artifact, "THIRD_PARTY_NOTICES.txt drifted; run npm run generate:notices");
    console.log(`Third-party notices verified (${Buffer.byteLength(artifact)} bytes).`);
  } else {
    writeFileSync(artifactPath, artifact, "utf8");
    console.log(`Wrote ${path.relative(repoRoot, artifactPath)} (${Buffer.byteLength(artifact)} bytes).`);
  }
} catch (error) {
  console.error(`Third-party notice generation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
