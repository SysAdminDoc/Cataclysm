import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { validateCitationFile } from "./citation-contract.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REAL_CFF = join(ROOT, "CITATION.cff");
const REAL_PKG = join(ROOT, "package.json");

const VALID_CFF = `cff-version: 1.2.0
message: "cite it"
title: "Test"
type: software
version: 9.9.9
repository-code: "https://github.com/SysAdminDoc/Cataclysm"
license: MIT
authors:
  - name: "SysAdminDoc"
preferred-citation:
  type: software
  title: "Test"
  version: 9.9.9
  authors:
    - name: "SysAdminDoc"
`;

const PKG = JSON.stringify({ version: "9.9.9", license: "MIT" });

function withTemp(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), "cff-"));
  try {
    const paths = {};
    for (const [name, contents] of Object.entries(files)) {
      const p = join(dir, name);
      writeFileSync(p, contents);
      paths[name] = p;
    }
    return fn(paths);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the shipped CITATION.cff matches package.json", () => {
  const { ok, failures } = validateCitationFile(REAL_CFF, REAL_PKG);
  assert.deepEqual(failures, []);
  assert.equal(ok, true);
});

test("a well-formed fixture passes", () => {
  withTemp({ "CITATION.cff": VALID_CFF, "package.json": PKG }, (p) => {
    const { ok } = validateCitationFile(p["CITATION.cff"], p["package.json"]);
    assert.equal(ok, true);
  });
});

test("version drift against package.json fails", () => {
  withTemp(
    { "CITATION.cff": VALID_CFF, "package.json": JSON.stringify({ version: "1.0.0", license: "MIT" }) },
    (p) => {
      const { ok, failures } = validateCitationFile(p["CITATION.cff"], p["package.json"]);
      assert.equal(ok, false);
      assert.ok(failures.some((f) => f.includes("version")));
    },
  );
});

test("license drift fails", () => {
  withTemp(
    { "CITATION.cff": VALID_CFF, "package.json": JSON.stringify({ version: "9.9.9", license: "GPL-3.0" }) },
    (p) => {
      const { failures } = validateCitationFile(p["CITATION.cff"], p["package.json"]);
      assert.ok(failures.some((f) => f.includes("license")));
    },
  );
});

test("missing preferred-citation fails", () => {
  const stripped = VALID_CFF.replace(/preferred-citation:[\s\S]*/, "");
  withTemp({ "CITATION.cff": stripped, "package.json": PKG }, (p) => {
    const { failures } = validateCitationFile(p["CITATION.cff"], p["package.json"]);
    assert.ok(failures.some((f) => f.includes("preferred-citation")));
  });
});

test("malformed date-released is rejected", () => {
  const withBadDate = VALID_CFF.replace("license: MIT\n", "license: MIT\ndate-released: 2026/07/16\n");
  withTemp({ "CITATION.cff": withBadDate, "package.json": PKG }, (p) => {
    const { failures } = validateCitationFile(p["CITATION.cff"], p["package.json"]);
    assert.ok(failures.some((f) => f.includes("date-released")));
  });
});

test("a missing file is reported", () => {
  const { ok, failures } = validateCitationFile(join(ROOT, "nope.cff"), REAL_PKG);
  assert.equal(ok, false);
  assert.ok(failures[0].includes("missing"));
});
