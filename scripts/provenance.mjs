// SLSA build-provenance for Cataclysm's local (no-CI) release builds.
//
// The release is produced on a developer workstation, not a hosted builder, so
// the attestation states that plainly: an in-toto Statement whose subjects are
// the signed-off release artifacts and whose SLSA predicate records the local
// build type, the Cargo feature set, the git commit, the toolchain, and the
// CycloneDX SBOMs as resolved dependencies. It is not a hosted/hermetic SLSA L3
// claim — it is a reproducible, machine-readable record of what this machine
// built, from which inputs.

export const PROVENANCE_STATEMENT_TYPE = "https://in-toto.io/Statement/v1";
export const SLSA_PREDICATE_TYPE = "https://slsa.dev/provenance/v1";
export const LOCAL_BUILD_TYPE =
  "https://github.com/SysAdminDoc/Cataclysm/local-tauri-build/v1";
export const LOCAL_BUILDER_ID =
  "https://github.com/SysAdminDoc/Cataclysm/local-builder";
export const REPO_URI = "https://github.com/SysAdminDoc/Cataclysm";

const SHA256_HEX = /^[0-9a-f]{64}$/;

function requireField(object, field, context) {
  const value = object?.[field];
  if (value === undefined || value === null || value === "") {
    throw new Error(`provenance: build manifest is missing "${field}" (${context})`);
  }
  return value;
}

/**
 * Build an in-toto Statement carrying an SLSA v1 provenance predicate from a
 * `cataclysm-build-manifest.json` object and the release SBOM descriptors.
 *
 * @param {object} args
 * @param {object} args.manifest      Parsed build manifest (schema_version >= 2).
 * @param {Array<{name: string, sha256: string, mediaType?: string}>} [args.sboms]
 * @param {string} args.startedOn     ISO-8601 build start.
 * @param {string} args.finishedOn    ISO-8601 build finish.
 * @returns {object} in-toto Statement (SLSA provenance).
 */
export function buildProvenanceStatement({ manifest, sboms = [], startedOn, finishedOn }) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("provenance: a parsed build manifest is required");
  }
  const artifacts = requireField(manifest, "artifacts", "subjects");
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new Error("provenance: the build manifest lists no artifacts to attest");
  }
  for (const time of [startedOn, finishedOn]) {
    if (typeof time !== "string" || Number.isNaN(Date.parse(time))) {
      throw new Error(`provenance: startedOn/finishedOn must be ISO-8601 (got "${time}")`);
    }
  }

  const gitCommit = requireField(manifest, "git_commit", "materials");
  const version = requireField(manifest, "version", "external parameters");
  const product = requireField(manifest, "product", "external parameters");
  const cargoFeatures = requireField(manifest, "cargo_features", "external parameters");
  const rustHost = requireField(manifest, "rust_host", "builder");

  const subject = artifacts.map((artifact) => {
    const name = requireField(artifact, "path", "artifact subject");
    const sha256 = requireField(artifact, "sha256", `artifact subject "${name}"`);
    if (!SHA256_HEX.test(sha256)) {
      throw new Error(`provenance: artifact "${name}" has a non-sha256 digest`);
    }
    return { name, digest: { sha256 } };
  });

  const resolvedDependencies = [
    {
      uri: `git+${REPO_URI}@${gitCommit}`,
      digest: { gitCommit },
    },
    ...sboms.map((sbom) => {
      const name = requireField(sbom, "name", "SBOM dependency");
      const sha256 = requireField(sbom, "sha256", `SBOM dependency "${name}"`);
      if (!SHA256_HEX.test(sha256)) {
        throw new Error(`provenance: SBOM "${name}" has a non-sha256 digest`);
      }
      return {
        name,
        digest: { sha256 },
        mediaType: sbom.mediaType ?? "application/vnd.cyclonedx+json",
      };
    }),
  ];

  return {
    _type: PROVENANCE_STATEMENT_TYPE,
    subject,
    predicateType: SLSA_PREDICATE_TYPE,
    predicate: {
      buildDefinition: {
        buildType: LOCAL_BUILD_TYPE,
        externalParameters: {
          product,
          version,
          cargoFeatures,
          bundler: "tauri",
        },
        internalParameters: {
          rustHost,
          hosted: false,
        },
        resolvedDependencies,
      },
      runDetails: {
        builder: {
          id: LOCAL_BUILDER_ID,
          builderDependencies: [{ name: "rustc", version: rustHost }],
        },
        metadata: {
          invocationId: gitCommit,
          startedOn,
          finishedOn,
        },
      },
    },
  };
}
