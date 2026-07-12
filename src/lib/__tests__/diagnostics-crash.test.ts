import { beforeEach, describe, expect, it } from "vitest";
import {
  redactSensitive,
  persistCrashReport,
  readPersistedCrashReport,
  markCrashReportSeen,
  clearPersistedCrashReport,
} from "../diagnosticsLog";

describe("crash evidence store", () => {
  beforeEach(() => localStorage.clear());

  it("redacts tokens, absolute paths, and long hex blobs", () => {
    const token = "eyJhbGciOi.eyJqdGkiOi.QmFzZTY0U2ln";
    expect(redactSensitive(`ion token ${token} used`)).toBe("ion token [redacted-token] used");
    expect(redactSensitive("failed at C:\\Users\\matt\\repos\\app\\x.ts"))
      .toBe("failed at [redacted-path]");
    expect(redactSensitive("home /Users/matt/secret/scenario.json here"))
      .toBe("home [redacted-path] here");
    expect(redactSensitive("digest deadbeefdeadbeefdeadbeefdeadbeef01"))
      .toBe("digest [redacted-hex]");
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
});
