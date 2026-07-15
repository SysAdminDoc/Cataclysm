const AUDIT_SEVERITIES = Object.freeze([
  "info",
  "low",
  "moderate",
  "high",
  "critical",
  "total",
]);

function auditErrorDetail(payload) {
  const error = payload?.error;
  if (!error || typeof error !== "object") return "";
  return [error.code, error.summary, error.detail]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join(": ");
}

export function parseNpmAuditResult(result) {
  if (!result || typeof result !== "object") {
    throw new Error("npm audit did not return a process result.");
  }
  if (result.error) {
    throw new Error(`npm audit failed to start: ${result.error.message ?? String(result.error)}`);
  }

  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
  if (!stdout) {
    throw new Error(
      `npm audit returned no JSON output${result.status === null ? " and did not exit normally" : ""}.`,
    );
  }

  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`npm audit returned malformed JSON: ${error.message}`);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("npm audit returned an unexpected JSON payload.");
  }

  const errorDetail = auditErrorDetail(payload);
  if (Object.hasOwn(payload, "error")) {
    throw new Error(
      `npm audit returned a registry/tool error payload${errorDetail ? `: ${errorDetail}` : "."}`,
    );
  }

  const vulnerabilities = payload.metadata?.vulnerabilities;
  if (!vulnerabilities || typeof vulnerabilities !== "object" || Array.isArray(vulnerabilities)) {
    throw new Error("npm audit output is missing metadata.vulnerabilities.");
  }

  const normalized = {};
  for (const severity of AUDIT_SEVERITIES) {
    const value = vulnerabilities[severity];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`npm audit reported an invalid ${severity} vulnerability count.`);
    }
    normalized[severity] = value;
  }
  const severityTotal = normalized.info + normalized.low + normalized.moderate +
    normalized.high + normalized.critical;
  if (normalized.total !== severityTotal) {
    throw new Error(
      `npm audit vulnerability totals are inconsistent (${normalized.total} total versus ${severityTotal} by severity).`,
    );
  }

  if (!Number.isInteger(result.status)) {
    throw new Error("npm audit did not exit normally.");
  }
  if (result.status !== 0) {
    const summary = `${normalized.total} total; ${normalized.critical} critical, ` +
      `${normalized.high} high, ${normalized.moderate} moderate, ${normalized.low} low`;
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    throw new Error(
      `npm audit exited with code ${result.status} (${summary})${stderr ? `: ${stderr}` : "."}`,
    );
  }
  if (normalized.total > 0) {
    throw new Error(
      `npm audit reported ${normalized.total} vulnerabilities despite a successful process status.`,
    );
  }

  return normalized;
}
