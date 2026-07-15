import assert from "node:assert/strict";
import test from "node:test";

import { validateVersionContract } from "./version-contract.mjs";

function sources(version = "1.2.3") {
  return {
    packageJson: JSON.stringify({ version }),
    cargoToml: `[package]\nname = "cataclysm"\nversion = "${version}"\n\n[dependencies]\n`,
    tauriConfig: JSON.stringify({ productName: "Cataclysm", version }),
    modelProvenance: `export const APP_VERSION = "${version}";`,
    readme:
      `[![Version](https://img.shields.io/badge/version-${version}-blue.svg)](./CHANGELOG.md)\n` +
      `> **Migration status (v${version}):** Current source capabilities.\n`,
  };
}

test("version contract accepts matching manifests, runtime, and README markers", () => {
  const result = validateVersionContract(sources());
  assert.equal(result.version, "1.2.3");
  assert.equal(result.tag, null);
  assert.equal(Object.keys(result.versions).length, 6);
});

test("version contract reports source mismatches against package.json", () => {
  const fixture = sources();
  fixture.modelProvenance = 'export const APP_VERSION = "1.2.4";';
  assert.throws(
    () => validateVersionContract(fixture),
    /Version contract mismatch; expected 1\.2\.3[\s\S]*model-provenance\.ts=1\.2\.4/,
  );
});

test("version contract requires both README current-source markers", () => {
  const fixture = sources();
  fixture.readme = fixture.readme.split("\n")[0];
  assert.throws(
    () => validateVersionContract(fixture),
    /README\.md migration status version marker is missing/,
  );
});

test("version contract enforces version tags but ignores branch refs", () => {
  assert.equal(
    validateVersionContract(sources(), { gitRefName: "v1.2.3", gitRefType: "tag" }).tag,
    "v1.2.3",
  );
  assert.throws(
    () => validateVersionContract(sources(), { gitRefName: "v1.2.2", gitRefType: "tag" }),
    /Tag\/version mismatch[\s\S]*expected v1\.2\.3/,
  );
  assert.equal(
    validateVersionContract(sources(), { gitRefName: "main", gitRefType: "branch" }).tag,
    null,
  );
});

test("version contract rejects malformed and incomplete sources", () => {
  assert.throws(
    () => validateVersionContract({ ...sources(), packageJson: "not-json" }),
    /package\.json is not valid JSON/,
  );
  assert.throws(
    () => validateVersionContract({ ...sources(), cargoToml: "[dependencies]\nfoo = '1'" }),
    /does not declare \[package\]\.version/,
  );
});
