import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("desktop installer and runtime declare one bounded Cataclysm deep-link route", async () => {
  const [tauriConfig, capability, cargoManifest, packageManifest, rustEntry] = await Promise.all([
    readFile(new URL("src-tauri/tauri.conf.json", root), "utf8").then(JSON.parse),
    readFile(new URL("src-tauri/capabilities/default.json", root), "utf8").then(JSON.parse),
    readFile(new URL("src-tauri/Cargo.toml", root), "utf8"),
    readFile(new URL("package.json", root), "utf8").then(JSON.parse),
    readFile(new URL("src-tauri/src/lib.rs", root), "utf8"),
  ]);

  assert.deepEqual(tauriConfig.plugins?.["deep-link"]?.desktop?.schemes, ["cataclysm"]);
  assert.ok(capability.permissions.includes("deep-link:default"));
  assert.match(cargoManifest, /tauri-plugin-deep-link\s*=\s*"2\.4\.9"/);
  assert.match(cargoManifest, /tauri-plugin-single-instance\s*=\s*\{[^}]*features\s*=\s*\["deep-link"\]/);
  assert.equal(packageManifest.dependencies["@tauri-apps/plugin-deep-link"], "^2.4.9");

  const singleInstanceIndex = rustEntry.indexOf("tauri_plugin_single_instance::init");
  const deepLinkIndex = rustEntry.indexOf("tauri_plugin_deep_link::init");
  assert.ok(singleInstanceIndex >= 0 && deepLinkIndex > singleInstanceIndex, "single-instance must register before deep-link");
  assert.doesNotMatch(rustEntry, /set_focus\s*\(/, "deep-link routing must not steal desktop focus");
});
