import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  inspectE2eArtifact,
  writeE2eArtifactProvenance,
} from "./e2e-artifact-contract.mjs";

const INPUTS = ["package.json", "src/app.ts"];
const OUTPUTS = ["dist/index.html", "dist/manifest.webmanifest", "dist/sw.js"];

function createFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "cataclysm-e2e-artifact-"));
  mkdirSync(path.join(root, "src"), { recursive: true });
  mkdirSync(path.join(root, "dist"), { recursive: true });
  writeFileSync(path.join(root, "package.json"), '{"name":"fixture"}\n');
  writeFileSync(path.join(root, "src", "app.ts"), 'export const version = "fresh";\n');
  for (const output of OUTPUTS) writeFileSync(path.join(root, output), output);
  return root;
}

test("a production artifact with a matching deterministic source digest is accepted", (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeE2eArtifactProvenance(root, { inputFiles: INPUTS });

  const result = inspectE2eArtifact(root, { inputFiles: INPUTS, requiredOutputs: OUTPUTS });
  assert.equal(result.ok, true, result.failures.join("\n"));
});

test("an intentionally stale dist fixture is rejected before Playwright preview", (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeE2eArtifactProvenance(root, { inputFiles: INPUTS });
  writeFileSync(path.join(root, "src", "app.ts"), 'export const version = "changed";\n');

  const result = inspectE2eArtifact(root, { inputFiles: INPUTS, requiredOutputs: OUTPUTS });
  assert.equal(result.ok, false);
  assert.match(result.failures.join("\n"), /stale for the current source digest/);
});

test("a digest match cannot hide a missing production output", (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeE2eArtifactProvenance(root, { inputFiles: INPUTS });
  rmSync(path.join(root, "dist", "sw.js"));

  const result = inspectE2eArtifact(root, { inputFiles: INPUTS, requiredOutputs: OUTPUTS });
  assert.equal(result.ok, false);
  assert.match(result.failures.join("\n"), /dist\/sw\.js is missing/);
});
