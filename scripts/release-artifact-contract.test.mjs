import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  isReleaseArtifactPath,
  selectReleaseArtifactFiles,
} from "./release-artifact-contract.mjs";

test("release artifact classifier accepts supported Tauri installers and packages", () => {
  for (const artifact of [
    "msi/Cataclysm_0.10.4_x64_en-US.msi",
    "nsis/Cataclysm_0.10.4_x64-setup.exe",
    "deb/Cataclysm_0.10.4_amd64.deb",
    "rpm/Cataclysm-0.10.4-1.x86_64.rpm",
    "appimage/Cataclysm_0.10.4_amd64.AppImage",
    "appimage/Cataclysm_0.10.4_amd64.AppImage.tar.gz",
    "dmg/Cataclysm_0.10.4_aarch64.dmg",
    "macos/Cataclysm.app.tar.gz",
    "nsis/Cataclysm_0.10.4_x64.nsis.zip",
  ]) {
    assert.equal(isReleaseArtifactPath(artifact), true, artifact);
  }
});

test("release artifact classifier excludes smoke evidence and package internals", () => {
  for (const evidence of [
    "installed-smoke/msi/report.json",
    "installed-smoke/nsis/tohoku-60-of-60.png",
    "installed-smoke/nsis/webdriver.log",
    "cataclysm-build-manifest.json",
    ".release-capabilities.json",
    "macos/Cataclysm.app/Contents/MacOS/cataclysm",
    "nsis/debug.log",
    "msi/checksums.json",
    "../outside.msi",
  ]) {
    assert.equal(isReleaseArtifactPath(evidence), false, evidence);
  }
});

test("release artifact selection filters outside files and sorts deterministically", () => {
  const bundleRoot = path.resolve("fixture-bundle");
  const msi = path.join(bundleRoot, "msi", "Cataclysm.msi");
  const nsis = path.join(bundleRoot, "nsis", "Cataclysm-setup.exe");
  const files = [
    nsis,
    path.join(bundleRoot, "installed-smoke", "nsis", "report.json"),
    path.resolve(bundleRoot, "..", "outside", "Unexpected.msi"),
    msi,
  ];

  assert.deepEqual(selectReleaseArtifactFiles(files, bundleRoot), [msi, nsis]);
});
