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
  validateNativePanicRecord,
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

test("installer discovery requires the standard/offline MSI and NSIS matrix", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "cataclysm-installer-fixture-"));
  try {
    mkdirSync(path.join(root, "msi"));
    mkdirSync(path.join(root, "nsis"));
    const msi = path.join(root, "msi", "Cataclysm_1.2.3_x64_en-US.msi");
    const offlineMsi = path.join(root, "msi", "Cataclysm_1.2.3_x64_en-US_offline.msi");
    const nsis = path.join(root, "nsis", "Cataclysm_1.2.3_x64-setup.exe");
    const offlineNsis = path.join(root, "nsis", "Cataclysm_1.2.3_x64_offline-setup.exe");
    writeFileSync(msi, "msi");
    writeFileSync(offlineMsi, "offline msi");
    writeFileSync(nsis, "nsis");
    writeFileSync(offlineNsis, "offline nsis");
    assert.deepEqual(findWindowsInstallers(root), [
      { kind: "msi", variant: "standard", installerPath: msi },
      { kind: "msi", variant: "offline", installerPath: offlineMsi },
      { kind: "nsis", variant: "standard", installerPath: nsis },
      { kind: "nsis", variant: "offline", installerPath: offlineNsis },
    ]);
    writeFileSync(path.join(root, "msi", "duplicate.msi"), "msi");
    assert.throws(() => findWindowsInstallers(root), /exactly one standard MSI installer, found 2/);
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

test("native panic records are bounded, versioned, and path-free", () => {
  const valid = {
    schema_version: 1,
    id: "record-1720000000000-42-0",
    app_version: "0.10.4",
    timestamp_ms: 1_720_000_000_000,
    message: "native panic ([redacted-message])",
    location: { file: "solver.rs", line: 42, column: 7 },
  };
  assert.equal(validateNativePanicRecord(valid, "0.10.4"), valid);
  assert.throws(
    () => validateNativePanicRecord({ ...valid, schema_version: 2 }, "0.10.4"),
    /schema/,
  );
  assert.throws(
    () => validateNativePanicRecord({ ...valid, message: String.raw`panic at C:\Users\private\scenario.json` }, "0.10.4"),
    /sensitive/,
  );
  assert.throws(
    () => validateNativePanicRecord({ ...valid, location: { file: "src/solver.rs", line: 1, column: 1 } }, "0.10.4"),
    /location/,
  );
});
