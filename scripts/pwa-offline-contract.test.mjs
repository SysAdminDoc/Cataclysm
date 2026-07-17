import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

test("production PWA precaches the complete local application surface", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(dist, "manifest.webmanifest"), "utf8"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ["128x128", "256x256"]);
  for (const icon of manifest.icons) assert.ok(fs.existsSync(path.join(dist, icon.src.slice(1))), icon.src);

  const worker = fs.readFileSync(path.join(dist, "sw.js"), "utf8");
  const match = /const PRECACHE_URLS = (\[[\s\S]*?\]);/.exec(worker);
  assert.ok(match, "generated service worker contains a precache URL array");
  const precache = JSON.parse(match[1]);
  const expected = walk(dist)
    .filter((file) => path.basename(file) !== "sw.js" && !file.endsWith(".map"))
    .map((file) => `/${path.relative(dist, file).replaceAll(path.sep, "/")}`)
    .sort();
  assert.deepEqual([...precache].sort(), expected);
  for (const required of ["/index.html", "/manifest.webmanifest", "/theme-bootstrap.js", "/pwa/icon-128.png", "/pwa/icon-256.png"]) {
    assert.ok(precache.includes(required), `${required} is precached`);
  }
  assert.match(worker, /caches\.match\("\/index\.html"/);
  assert.match(worker, /ignoreVary: true/);
});
