import assert from "node:assert/strict";
import test from "node:test";

import { parseNpmAuditResult } from "./deps-check-contract.mjs";

const cleanAudit = JSON.stringify({
  metadata: {
    vulnerabilities: {
      info: 0,
      low: 0,
      moderate: 0,
      high: 0,
      critical: 0,
      total: 0,
    },
  },
});

test("npm audit parser accepts a successful complete audit payload", () => {
  assert.deepEqual(parseNpmAuditResult({ status: 0, stdout: cleanAudit, stderr: "" }), {
    info: 0,
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
    total: 0,
  });
});

test("npm audit parser fails closed on a nonzero process status", () => {
  const vulnerableAudit = JSON.stringify({
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 1,
        high: 0,
        critical: 0,
        total: 1,
      },
    },
  });
  assert.throws(
    () => parseNpmAuditResult({ status: 1, stdout: vulnerableAudit, stderr: "" }),
    /exited with code 1 \(1 total/,
  );
  assert.throws(
    () => parseNpmAuditResult({ status: 0, stdout: vulnerableAudit, stderr: "" }),
    /reported 1 vulnerabilities despite a successful process status/,
  );
});

test("npm audit parser rejects malformed JSON and incomplete schemas", () => {
  assert.throws(
    () => parseNpmAuditResult({ status: 0, stdout: "{not-json", stderr: "" }),
    /malformed JSON/,
  );
  assert.throws(
    () => parseNpmAuditResult({ status: 0, stdout: '{"metadata":{}}', stderr: "" }),
    /missing metadata\.vulnerabilities/,
  );
  const inconsistentAudit = JSON.stringify({
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 0,
        critical: 0,
        total: 1,
      },
    },
  });
  assert.throws(
    () => parseNpmAuditResult({ status: 0, stdout: inconsistentAudit, stderr: "" }),
    /totals are inconsistent/,
  );
});

test("npm audit parser rejects registry error payloads even when JSON is valid", () => {
  const registryError = JSON.stringify({
    error: {
      code: "ECONNREFUSED",
      summary: "request to registry failed",
      detail: "connect ECONNREFUSED 127.0.0.1:9",
    },
  });
  assert.throws(
    () => parseNpmAuditResult({ status: 1, stdout: registryError, stderr: "" }),
    /registry\/tool error payload: ECONNREFUSED/,
  );
});

test("npm audit parser rejects spawn failures and abnormal termination", () => {
  assert.throws(
    () => parseNpmAuditResult({ status: null, stdout: "", error: new Error("ENOENT") }),
    /failed to start: ENOENT/,
  );
  assert.throws(
    () => parseNpmAuditResult({ status: null, stdout: cleanAudit, stderr: "" }),
    /did not exit normally/,
  );
});
