import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCAL_BUILDER_ID,
  LOCAL_BUILD_TYPE,
  PROVENANCE_STATEMENT_TYPE,
  SLSA_PREDICATE_TYPE,
  buildProvenanceStatement,
} from "./provenance.mjs";

const MANIFEST = Object.freeze({
  schema_version: 2,
  product: "Cataclysm",
  version: "0.14.0",
  git_commit: "0123456789abcdef0123456789abcdef01234567",
  rust_host: "x86_64-pc-windows-msvc",
  cargo_features: ["gpu"],
  artifacts: [
    { path: "msi/Cataclysm_0.14.0_x64_en-US.msi", bytes: 1024, sha256: "a".repeat(64) },
    { path: "nsis/Cataclysm_0.14.0_x64-setup.exe", bytes: 2048, sha256: "b".repeat(64) },
  ],
});

const SBOMS = Object.freeze([
  { name: "sbom-npm.json", sha256: "c".repeat(64) },
  { name: "sbom-cargo.json", sha256: "d".repeat(64) },
]);

const TIMES = { startedOn: "2026-07-21T00:00:00.000Z", finishedOn: "2026-07-21T00:05:00.000Z" };

test("provenance statement is a valid SLSA in-toto statement over every artifact", () => {
  const statement = buildProvenanceStatement({ manifest: MANIFEST, sboms: SBOMS, ...TIMES });

  assert.equal(statement._type, PROVENANCE_STATEMENT_TYPE);
  assert.equal(statement.predicateType, SLSA_PREDICATE_TYPE);
  assert.equal(statement.predicate.buildDefinition.buildType, LOCAL_BUILD_TYPE);
  assert.equal(statement.predicate.runDetails.builder.id, LOCAL_BUILDER_ID);

  // Every release artifact appears as a subject with its sha256 digest.
  assert.deepEqual(
    statement.subject.map((s) => s.name),
    MANIFEST.artifacts.map((a) => a.path),
  );
  for (const subject of statement.subject) {
    assert.match(subject.digest.sha256, /^[0-9a-f]{64}$/);
  }

  // The git commit and both SBOMs are recorded as resolved dependencies.
  const deps = statement.predicate.buildDefinition.resolvedDependencies;
  assert.ok(deps.some((d) => d.uri?.includes(MANIFEST.git_commit)));
  for (const sbom of SBOMS) {
    const match = deps.find((d) => d.name === sbom.name);
    assert.ok(match, `missing SBOM dependency ${sbom.name}`);
    assert.equal(match.mediaType, "application/vnd.cyclonedx+json");
  }

  // Local-build posture is explicit.
  assert.equal(statement.predicate.buildDefinition.internalParameters.hosted, false);
  assert.deepEqual(statement.predicate.buildDefinition.externalParameters.cargoFeatures, ["gpu"]);
});

test("provenance rejects a manifest with no artifacts", () => {
  assert.throws(
    () => buildProvenanceStatement({ manifest: { ...MANIFEST, artifacts: [] }, sboms: SBOMS, ...TIMES }),
    /no artifacts/,
  );
});

test("provenance rejects a non-sha256 artifact digest", () => {
  const bad = { ...MANIFEST, artifacts: [{ path: "msi/x.msi", sha256: "not-a-hash" }] };
  assert.throws(() => buildProvenanceStatement({ manifest: bad, sboms: SBOMS, ...TIMES }), /non-sha256/);
});

test("provenance rejects invalid timestamps", () => {
  assert.throws(
    () => buildProvenanceStatement({ manifest: MANIFEST, sboms: SBOMS, startedOn: "yesterday", finishedOn: TIMES.finishedOn }),
    /ISO-8601/,
  );
});
