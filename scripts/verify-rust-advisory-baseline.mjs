#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateAdvisoryBaseline, warningEntries } from "./rust-advisory-policy.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cargoRoot = path.join(repoRoot, "src-tauri");
const baseline = JSON.parse(
  readFileSync(path.join(repoRoot, "scripts", "rust-advisory-baseline.json"), "utf8"),
);

function runJson(command, args) {
  const result = spawnSync(command, args, {
    cwd: cargoRoot,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.error?.message}`);
  }
  return JSON.parse(result.stdout);
}

const report = runJson("cargo", ["audit", "--json", "--no-fetch"]);
const metadata = runJson("cargo", ["metadata", "--format-version", "1", "--locked"]);
const currentDate = process.env.CATACLYSM_ADVISORY_DATE ?? new Date().toISOString().slice(0, 10);
const failures = validateAdvisoryBaseline(baseline, report, metadata, currentDate);
if (failures.length > 0) {
  console.error("Rust advisory warning baseline failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Rust advisory baseline: ${warningEntries(report).length} reviewed warning(s), `
    + `next review by ${baseline.exceptions.map((entry) => entry.review_by).sort()[0]}.`,
);
