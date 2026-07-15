import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  redactSensitive,
  persistCrashReport,
  readPersistedCrashReport,
  markCrashReportSeen,
  clearPersistedCrashReport,
  importNativePanicReport,
  installGlobalCrashHandlers,
  serializeRedactedDiagnostics,
} from "../diagnosticsLog";

describe("crash evidence store", () => {
  let cleanupGlobalHandlers: (() => void) | undefined;
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    cleanupGlobalHandlers?.();
    cleanupGlobalHandlers = undefined;
    vi.restoreAllMocks();
  });

  it("redacts tokens, absolute paths, and long hex blobs", () => {
    const token = "eyJhbGciOi.eyJqdGkiOi.QmFzZTY0U2ln";
    expect(redactSensitive(`ion token ${token} used`)).toBe("ion token [redacted-token] used");
    expect(redactSensitive("failed at C:\\Users\\matt\\repos\\app\\x.ts"))
      .toBe("failed at [redacted-path]");
    expect(redactSensitive("failed at C:/Users/matt/repos/app/x.ts"))
      .toBe("failed at [redacted-path]");
    expect(redactSensitive("home /Users/matt/secret/scenario.json here"))
      .toBe("home [redacted-path] here");
    expect(redactSensitive("digest deadbeefdeadbeefdeadbeefdeadbeef01"))
      .toBe("digest [redacted-long-value]");
    expect(redactSensitive("GET https://host.test/x?access_token=super-secret-value&ok=1"))
      .toBe("GET https://host.test/x?access_token=[redacted]&ok=1");
    expect(redactSensitive("Authorization: Bearer abcdefghijklmnop123456"))
      .toBe("Authorization: Bearer [redacted-token]");
    expect(redactSensitive("api_key=abcdefghijklmnopqrstuvwxyz1234567890"))
      .toBe("api_key=[redacted]");
    expect(redactSensitive("UNC \\\\server\\private-share\\scenario.json"))
      .toBe("UNC [redacted-path]");
    expect(redactSensitive("tmp /var/tmp/cataclysm/scenario.json here"))
      .toBe("tmp [redacted-path] here");
    expect(redactSensitive("workspace /workspace/cataclysm/output.log here"))
      .toBe("workspace [redacted-path] here");
  });

  it("persists a redacted report and reads it back", () => {
    persistCrashReport({
      name: "TypeError",
      message: "boom at C:\\Users\\matt\\app.ts",
      componentStack: "at Globe (/home/matt/src/Globe.tsx)",
    });
    const report = readPersistedCrashReport();
    expect(report).not.toBeNull();
    expect(report?.name).toBe("TypeError");
    expect(report?.message).toBe("boom at [redacted-path]");
    expect(report?.componentStack).toBe("at Globe ([redacted-path])");
    expect(report?.seen).toBe(false);
    const raw = localStorage.getItem("tsunamisim.last_crash") ?? "";
    expect(raw).not.toContain("C:\\Users\\matt");
    expect(raw).not.toContain("/home/matt");
  });

  it("redacts every nested string before diagnostics serialization", () => {
    const serialized = serializeRedactedDiagnostics({
      backend: { error: "failed at C:\\Users\\matt\\repo\\app.exe" },
      logs: ["https://host.test/?token=secret-query-value"],
      auth: "Bearer abcdefghijklmnop123456",
    });
    expect(serialized).not.toContain("matt");
    expect(serialized).not.toContain("secret-query-value");
    expect(serialized).not.toContain("abcdefghijklmnop123456");
    expect(serialized).toContain("[redacted-path]");
  });

  it("persists redacted window errors for inspection after reload", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    cleanupGlobalHandlers = installGlobalCrashHandlers(window);
    window.dispatchEvent(new ErrorEvent("error", {
      error: new Error("failure at C:\\Users\\private\\app.ts?access_token=raw-secret"),
      message: "window failed",
    }));

    const report = readPersistedCrashReport();
    expect(report).toMatchObject({ source: "window-error", seen: false });
    const raw = localStorage.getItem("tsunamisim.last_crash") ?? "";
    expect(raw).not.toContain("C:\\Users\\private");
    expect(raw).not.toContain("raw-secret");
  });

  it("persists redacted unhandled rejections for inspection after reload", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    cleanupGlobalHandlers = installGlobalCrashHandlers(window);
    const event = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(event, "reason", {
      value: new Error("rejected /home/private/scenario.json with api_key=raw-api-key"),
    });
    window.dispatchEvent(event);

    const report = readPersistedCrashReport();
    expect(report).toMatchObject({ source: "unhandled-rejection", seen: false });
    const raw = localStorage.getItem("tsunamisim.last_crash") ?? "";
    expect(raw).not.toContain("/home/private");
    expect(raw).not.toContain("raw-api-key");
  });

  it("marks the report seen without deleting it", () => {
    persistCrashReport({ name: "Error", message: "x" });
    markCrashReportSeen();
    const report = readPersistedCrashReport();
    expect(report).not.toBeNull();
    expect(report?.seen).toBe(true);
  });

  it("returns null after an explicit clear", () => {
    persistCrashReport({ name: "Error", message: "x" });
    clearPersistedCrashReport();
    expect(readPersistedCrashReport()).toBeNull();
  });

  it("imports a validated native panic into the existing recovery store", async () => {
    await expect(importNativePanicReport(async () => ({
      schema_version: 1,
      id: "record-1720000000000-42-0",
      app_version: "0.10.4",
      timestamp_ms: 1_720_000_000_000,
      message: "native panic ([redacted-message])",
      location: { file: "solver.rs", line: 42, column: 7 },
    }))).resolves.toBe(true);

    expect(readPersistedCrashReport()).toMatchObject({
      at: 1_720_000_000_000,
      source: "native-panic",
      name: "RustPanic",
      message: "native panic ([redacted-message])",
      componentStack: "solver.rs:42:7",
      seen: false,
      nativeRecordId: "record-1720000000000-42-0",
      nativeAppVersion: "0.10.4",
    });
  });

  it("does not overwrite unseen evidence or reset an already reviewed native record", async () => {
    const nativeRecord = {
      schema_version: 1,
      id: "record-1720000000000-42-0",
      app_version: "0.10.4",
      timestamp_ms: 1_720_000_000_000,
      message: "native panic",
      location: null,
    } as const;
    persistCrashReport({ source: "window-error", name: "Error", message: "keep me" });
    await expect(importNativePanicReport(async () => nativeRecord)).resolves.toBe(false);
    expect(readPersistedCrashReport()).toMatchObject({ source: "window-error", message: "keep me" });

    clearPersistedCrashReport();
    await importNativePanicReport(async () => nativeRecord);
    markCrashReportSeen();
    await expect(importNativePanicReport(async () => nativeRecord)).resolves.toBe(false);
    expect(readPersistedCrashReport()).toMatchObject({ source: "native-panic", seen: true });
  });

  it("rejects malformed or future native panic records", async () => {
    await expect(importNativePanicReport(async () => ({
      schema_version: 2,
      id: "record-1-1-0",
      app_version: "0.10.4",
      timestamp_ms: 1,
      message: "future",
      location: null,
    }))).resolves.toBe(false);
    expect(readPersistedCrashReport()).toBeNull();
  });
});
