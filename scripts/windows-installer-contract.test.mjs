import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MIN_OFFLINE_INSTALLER_OVERHEAD_BYTES,
  assertWindowsInstallerMatrix,
  classifyWindowsInstaller,
  formatWindowsInstallerChecksums,
  offlineInstallerName,
  validateWindowsInstallerConfigs,
} from "./windows-installer-contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("installer configs keep the small default and an Evergreen offline variant", () => {
  const standardConfig = JSON.parse(readFileSync(path.join(repoRoot, "src-tauri", "tauri.conf.json"), "utf8"));
  const offlineConfig = JSON.parse(readFileSync(path.join(repoRoot, "src-tauri", "tauri.offline.conf.json"), "utf8"));
  assert.deepEqual(validateWindowsInstallerConfigs(standardConfig, offlineConfig), {
    standard: "downloadBootstrapper",
    offline: "offlineInstaller",
    runtime_servicing: "evergreen",
  });
  assert.deepEqual(validateWindowsInstallerConfigs(
    { bundle: { windows: { webviewInstallMode: { type: "downloadBootstrapper" } } } },
    { bundle: { windows: { webviewInstallMode: { type: "offlineInstaller" } } } },
  ), {
    standard: "downloadBootstrapper",
    offline: "offlineInstaller",
    runtime_servicing: "evergreen",
  });
  assert.throws(
    () => validateWindowsInstallerConfigs(
      { bundle: { windows: { webviewInstallMode: { type: "downloadBootstrapper" } } } },
      { bundle: { windows: { webviewInstallMode: { type: "fixedRuntime", path: "runtime" } } } },
    ),
    /offlineInstaller/,
  );
  const cargoManifest = readFileSync(path.join(repoRoot, "src-tauri", "Cargo.toml"), "utf8");
  assert.match(cargoManifest, /^default-run\s*=\s*"cataclysm"$/m);
  const releaseBuilder = readFileSync(path.join(repoRoot, "scripts", "build-release.mjs"), "utf8");
  assert.match(releaseBuilder, /"--no-sign"/);
  assert.match(releaseBuilder, /tauri\.offline\.conf\.json/);
  assert.match(releaseBuilder, /assertWindowsInstallerMatrix/);
});

test("installer names and metadata distinguish standard from offline", () => {
  assert.deepEqual(classifyWindowsInstaller("msi/Cataclysm_1.2.3_x64_en-US.msi"), {
    format: "msi",
    variant: "standard",
    webview_install_mode: "downloadBootstrapper",
    requires_network_for_missing_runtime: true,
    runtime_servicing: "evergreen",
  });
  assert.deepEqual(classifyWindowsInstaller("nsis/Cataclysm_1.2.3_x64_offline-setup.exe"), {
    format: "nsis",
    variant: "offline",
    webview_install_mode: "offlineInstaller",
    requires_network_for_missing_runtime: false,
    runtime_servicing: "evergreen",
  });
  assert.equal(offlineInstallerName("Cataclysm_1.2.3_x64_en-US.msi"), "Cataclysm_1.2.3_x64_en-US_offline.msi");
  assert.equal(offlineInstallerName("Cataclysm_1.2.3_x64-setup.exe"), "Cataclysm_1.2.3_x64_offline-setup.exe");
});

test("installer matrix requires both formats and a substantial embedded payload", () => {
  const base = 20 * 1024 * 1024;
  const matrix = assertWindowsInstallerMatrix([
    { path: "msi/Cataclysm.msi", bytes: base },
    { path: "msi/Cataclysm_offline.msi", bytes: base + MIN_OFFLINE_INSTALLER_OVERHEAD_BYTES },
    { path: "nsis/Cataclysm-setup.exe", bytes: base },
    { path: "nsis/Cataclysm_offline-setup.exe", bytes: base + MIN_OFFLINE_INSTALLER_OVERHEAD_BYTES + 1 },
  ]);
  assert.deepEqual(matrix.map(({ format, variant }) => `${format}:${variant}`), [
    "msi:standard",
    "msi:offline",
    "nsis:standard",
    "nsis:offline",
  ]);
  assert.throws(
    () => assertWindowsInstallerMatrix(matrix.filter((entry) => entry.variant !== "offline")),
    /Missing Windows installer variant/,
  );
  assert.throws(
    () => assertWindowsInstallerMatrix([
      { path: "msi/Cataclysm.msi", bytes: base },
      { path: "msi/Cataclysm_offline.msi", bytes: base + 1 },
      { path: "nsis/Cataclysm-setup.exe", bytes: base },
      { path: "nsis/Cataclysm_offline-setup.exe", bytes: base + 1 },
    ]),
    /embedded Evergreen payload/,
  );
});

test("checksum file covers every labelled installer deterministically", () => {
  const checksum = formatWindowsInstallerChecksums([
    { path: "nsis/Cataclysm_offline-setup.exe", sha256: "b".repeat(64) },
    { path: "msi/Cataclysm.msi", sha256: "a".repeat(64) },
  ]);
  assert.equal(checksum, `${"a".repeat(64)}  msi/Cataclysm.msi\n${"b".repeat(64)}  nsis/Cataclysm_offline-setup.exe\n`);
  assert.throws(
    () => formatWindowsInstallerChecksums([{ path: "../escape.msi", sha256: "a".repeat(64) }]),
    /unsafe/,
  );
});
