import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  readWorkflowFiles,
  workflowSupplyChainFailures,
} from "./workflow-supply-chain-contract.mjs";

const fullSha = "0123456789abcdef0123456789abcdef01234567";

test("workflow contract accepts immutable action and cargo tool pins", () => {
  const workflow = `
steps:
  - uses: actions/checkout@${fullSha} # v4
  - run: cargo install cargo-audit --version 0.22.2 --locked
  - run: cargo install cargo-deny@0.20.2 --locked
  - run: cargo install --git https://example.test/tool --rev ${fullSha}
  - run: cargo install --path ./local-tool
`;
  assert.deepEqual(workflowSupplyChainFailures({ "valid.yml": workflow }), []);
});

test("workflow contract treats an empty uses value as an invalid action pin", () => {
  assert.match(
    workflowSupplyChainFailures({ "empty.yml": "steps:\n  - uses:\n" }).join("\n"),
    /empty\.yml:2: uses must be pinned to a full 40-hex commit SHA/,
  );
});

test("workflow contract rejects mutable actions and unpinned cargo installs", () => {
  const workflow = `
steps:
  - uses: actions/checkout@v4
  - run: cargo install cargo-audit --locked
  - run: cargo install --git https://example.test/tool
  - run: cargo install --git https://example.test/tool --rev 0123456
`;
  const failures = workflowSupplyChainFailures({ "invalid.yml": workflow }).join("\n");
  assert.match(failures, /invalid\.yml:3: uses must be pinned to a full 40-hex commit SHA/);
  assert.match(failures, /invalid\.yml:4: cargo install must use an exact --version/);
  assert.match(failures, /invalid\.yml:5: cargo --git install must use --rev/);
  assert.match(failures, /invalid\.yml:6: cargo --git install must use --rev/);
});

test("all live GitHub workflows satisfy the supply-chain contract", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const workflows = readWorkflowFiles(path.join(repoRoot, ".github", "workflows"));
  assert.ok(Object.keys(workflows).length > 0, "expected at least one GitHub workflow");
  assert.deepEqual(workflowSupplyChainFailures(workflows), []);
});
