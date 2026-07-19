import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateSupportCodeContract } from "./support-code-contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("tests, scripts, configs, and fresh E2E output remain inside the static gate", () => {
  const result = validateSupportCodeContract(repoRoot);
  assert.equal(result.ok, true, result.failures.join("\n"));
});

test("narrowing lint back to application source is rejected", (context) => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "cataclysm-support-contract-"));
  context.after(() => rmSync(fixture, { recursive: true, force: true }));
  for (const file of ["package.json", "tsconfig.support.json", "playwright.config.ts", "eslint.config.js"]) {
    writeFileSync(path.join(fixture, file), readFileSync(path.join(repoRoot, file)));
  }
  const packageJson = JSON.parse(readFileSync(path.join(fixture, "package.json"), "utf8"));
  packageJson.scripts.lint = "eslint src";
  writeFileSync(path.join(fixture, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);

  const result = validateSupportCodeContract(fixture);
  assert.equal(result.ok, false);
  assert.match(result.failures.join("\n"), /lint does not cover tests/);
});
