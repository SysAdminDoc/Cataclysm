import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const heroReference = "![Cataclysm planetary hazard simulator showing a Tohoku tsunami result on an interactive globe](./assets/marketing/cataclysm-hero.png)";
const gallery = [
  "assets/screenshots/simulator-workspace-dark.png",
  "assets/screenshots/asteroid-results-dark.png",
  "assets/screenshots/nuclear-results-dark.png",
  "assets/screenshots/science-evidence-dark.png",
];

test("README opens with one version-free marketing hero", () => {
  const readme = read("README.md").toString("utf8");
  assert.equal(readme.trimStart().split(/\r?\n/, 1)[0], heroReference);
  assert.equal(readme.split("./assets/marketing/cataclysm-hero.png").length - 1, 1);
  assert.doesNotMatch(path.basename("assets/marketing/cataclysm-hero.png"), /\d+\.\d+\.\d+/);
  assert.doesNotMatch(read("scripts/generate-marketing-hero.mjs").toString("utf8"), /\bv?\d+\.\d+\.\d+\b/);
  assert.doesNotMatch(readme, /branding:start|v0\.10\.4|—|–/);
});

test("published hero has the approved dimensions", async () => {
  const metadata = await sharp(read("assets/marketing/cataclysm-hero.png")).metadata();
  assert.equal(metadata.width, 1600);
  assert.equal(metadata.height, 900);
  assert.equal(metadata.format, "png");
});

test("README gallery uses distinct current product captures", async () => {
  const readme = read("README.md").toString("utf8");
  const hashes = new Set();
  for (const relativePath of gallery) {
    assert.ok(existsSync(path.join(root, relativePath)), `${relativePath} is missing`);
    assert.equal(readme.split(`./${relativePath}`).length - 1, 1, `${relativePath} must appear once in README.md`);
    const file = read(relativePath);
    hashes.add(sha256(file));
    const metadata = await sharp(file).metadata();
    assert.equal(metadata.width, 1600, `${relativePath} width drifted`);
    assert.equal(metadata.height, 1000, `${relativePath} height drifted`);
  }
  assert.equal(hashes.size, gallery.length, "README screenshots must show distinct product states");
});

test("selected logo and published logo source are identical", () => {
  const selected = read("concepts/marketing/2026-09-13/selected/cataclysm-logo.svg");
  const published = read("assets/branding/logo.svg");
  assert.equal(sha256(selected), sha256(published));
});
