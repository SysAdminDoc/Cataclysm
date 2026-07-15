import assert from "node:assert/strict";
import test from "node:test";

import { validateAdvisoryBaseline } from "./rust-advisory-policy.mjs";

const metadata = {
  packages: [
    { id: "root", name: "cataclysm", version: "1.0.0" },
    { id: "framework", name: "framework", version: "2.0.0" },
    { id: "affected", name: "affected", version: "3.0.0" },
  ],
  resolve: {
    root: "root",
    nodes: [
      { id: "root", deps: [{ pkg: "framework" }] },
      { id: "framework", deps: [{ pkg: "affected" }] },
      { id: "affected", deps: [] },
    ],
  },
};
const warning = {
  kind: "unmaintained",
  advisory: "RUSTSEC-2099-0001",
  package: "affected",
  version: "3.0.0",
};
const report = {
  vulnerabilities: { found: false, count: 0 },
  warnings: {
    unmaintained: [{ advisory: { id: warning.advisory }, package: { name: warning.package, version: warning.version } }],
  },
};
const exception = {
  ...warning,
  affected_targets: ["linux"],
  dependency_path: ["cataclysm", "framework", "affected"],
  rationale: "Inherited platform dependency pending an upstream replacement.",
  upstream_issue: "https://example.com/upstream/1",
  owner: "maintainer",
  review_by: "2099-04-01",
};

test("accepts a current exact warning and dependency path", () => {
  assert.deepEqual(
    validateAdvisoryBaseline({ schema_version: 1, exceptions: [exception] }, report, metadata, "2099-03-01"),
    [],
  );
});

test("rejects new warnings, stale exceptions, expiry, and dependency-path drift", () => {
  assert.match(
    validateAdvisoryBaseline({ schema_version: 1, exceptions: [] }, report, metadata, "2099-03-01").join("\n"),
    /new warning/,
  );
  const changedReport = { ...report, warnings: {} };
  assert.match(
    validateAdvisoryBaseline({ schema_version: 1, exceptions: [exception] }, changedReport, metadata, "2099-04-02").join("\n"),
    /expired[\s\S]*stale exception/,
  );
  const drifted = { ...exception, dependency_path: ["cataclysm", "affected"] };
  assert.match(
    validateAdvisoryBaseline({ schema_version: 1, exceptions: [drifted] }, report, metadata, "2099-03-01").join("\n"),
    /dependency_path no longer exists/,
  );
});
