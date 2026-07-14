import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertCleanMachineState,
  assertInstalledSmokeHost,
  findWindowsInstallers,
  parseRegistryOutput,
  runtimeErrorLines,
  sanitizeLog,
} from "./installed-release-smoke.mjs";

test("registry output accepts empty, singleton, and array payloads", () => {
  assert.deepEqual(parseRegistryOutput(""), []);
  assert.deepEqual(parseRegistryOutput("[]"), []);
  assert.deepEqual(parseRegistryOutput('{"DisplayName":"Cataclysm"}'), [
    { DisplayName: "Cataclysm" },
  ]);
  assert.deepEqual(parseRegistryOutput('[{"DisplayName":"Cataclysm"}]'), [
    { DisplayName: "Cataclysm" },
  ]);
});

test("installed smoke refuses non-isolated or occupied Windows hosts", () => {
  assert.deepEqual(assertInstalledSmokeHost({ platform: "linux" }), {
    required: false,
    reason: "Windows installers are not emitted on this platform.",
  });
  assert.throws(
    () => assertInstalledSmokeHost({
      platform: "win32",
      env: {},
      entries: [],
      processRunning: false,
    }),
    /CATACLYSM_INSTALL_SMOKE_ISOLATED=1/,
  );
  assert.throws(
    () => assertCleanMachineState({
      entries: [{ DisplayName: "Cataclysm" }],
      processRunning: true,
      knownInstallPaths: [],
    }),
    /clean disposable Windows host/,
  );
  assert.deepEqual(assertInstalledSmokeHost({
    platform: "win32",
    env: { CATACLYSM_INSTALL_SMOKE_ISOLATED: "1" },
    entries: [],
    processRunning: false,
  }), { required: true });
});

test("installer discovery requires one MSI and one NSIS package", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "cataclysm-installer-fixture-"));
  try {
    mkdirSync(path.join(root, "msi"));
    mkdirSync(path.join(root, "nsis"));
    const msi = path.join(root, "msi", "Cataclysm_1.2.3_x64_en-US.msi");
    const nsis = path.join(root, "nsis", "Cataclysm_1.2.3_x64-setup.exe");
    writeFileSync(msi, "msi");
    writeFileSync(nsis, "nsis");
    assert.deepEqual(findWindowsInstallers(root), [
      { kind: "msi", installerPath: msi },
      { kind: "nsis", installerPath: nsis },
    ]);
    writeFileSync(path.join(root, "msi", "duplicate.msi"), "msi");
    assert.throws(() => findWindowsInstallers(root), /exactly one MSI installer, found 2/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release logs redact machine paths and URL credentials", () => {
  const value = String.raw`C:\Users\alice\repo\Cataclysm https://user:secret@example.test/path`;
  const sanitized = sanitizeLog(value, String.raw`C:\Users\alice`);
  assert.doesNotMatch(sanitized, /alice|secret/);
  assert.match(sanitized, /<home>/);
  assert.match(sanitized, /<credentials>/);
});

test("runtime error scan is narrow to renderer and protocol failures", () => {
  assert.deepEqual(runtimeErrorLines([
    "Renderer CesiumJS ready",
    "IPC request completed",
    "WebDriver listening",
  ]), []);
  assert.deepEqual(runtimeErrorLines([
    "[ERROR] renderer process crashed",
    "unknown error: net::ERR_FAILED",
    "channel closed while dispatching IPC",
  ]), [
    "[ERROR] renderer process crashed",
    "unknown error: net::ERR_FAILED",
    "channel closed while dispatching IPC",
  ]);
});
