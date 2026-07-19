import assert from "node:assert/strict";
import test from "node:test";

import { validateProductTruth } from "./product-truth-contract.mjs";

function sources() {
  const truth = {
    schemaVersion: 1,
    product: { name: "Cataclysm", packageName: "cataclysm", identifier: "com.example.cataclysm", legacyNames: ["OldProduct"] },
    release: {
      version: "1.2.3", supportedSeries: "1.2.x", repositoryUrl: "https://github.com/example/Cataclysm",
      releasesUrl: "https://github.com/example/Cataclysm/releases",
      securityAdvisoryUrl: "https://github.com/example/Cataclysm/security/advisories/new", artifactPolicy: "unsigned-sha256",
    },
    runtimeFloors: { nodeMajor: 20, rust: "1.91", tauriMajor: 2 },
    simulation: { defaultPlaybackFrames: 60, maximumPlaybackFrames: 240 },
    globe: { defaultStyleId: "esri", defaultStyleLabel: "Esri World Imagery", offlineStyleId: "natural", offlineStyleLabel: "Natural Earth II" },
  };
  const currentDocs = {
    "README.md": `Cataclysm Esri World Imagery Natural Earth II ${truth.release.releasesUrl}`,
    "CONTRIBUTING.md": `Cataclysm Node.js ≥ 20 Rust stable ≥ 1.91 ${truth.release.repositoryUrl}`,
    "SECURITY.md": `1.2.x ${truth.release.securityAdvisoryUrl}`,
    "docs/manual/getting-started.md": `${truth.release.releasesUrl} 60 snapshots`,
    "docs/manual/custom-scenarios.md": "60 time snapshots",
    "docs/manual/physics-explainer.md": "Cataclysm",
    "docs/science/VALIDATION.md": "Cataclysm",
    "docs/release/UNSIGNED_RELEASES.md": "Cataclysm intentionally ships unsigned. Verify SHA-256 checksums.",
  };
  return {
    productTruth: JSON.stringify(truth),
    packageJson: JSON.stringify({ name: "cataclysm", version: "1.2.3", repository: { url: truth.release.repositoryUrl } }),
    cargoToml: '[package]\nname = "cataclysm"\nversion = "1.2.3"\nrust-version = "1.91"\n',
    wasmCargoToml: '[package]\nname = "cataclysm-browser-physics"\nversion = "1.2.3"\nrust-version = "1.91"\n',
    tauriConfig: JSON.stringify({ productName: "Cataclysm", version: "1.2.3", identifier: "com.example.cataclysm" }),
    modelProvenance: 'import PRODUCT_TRUTH from "../data/product-truth.json";\nconst APP_VERSION = PRODUCT_TRUTH.release.version;',
    globeStyles: "PRODUCT_TRUTH.globe.defaultStyleId; PRODUCT_TRUTH.globe.offlineStyleId;",
    swePlayback: "PRODUCT_TRUTH.simulation.defaultPlaybackFrames",
    tour: "PRODUCT_TRUTH.simulation.defaultPlaybackFrames",
    i18n: "{frames} {frames} {frames} {frames}",
    currentDocs,
    blockedRoadmap: "A current blocked item with a precise blocker.",
  };
}

test("accepts consistent product, runtime, UI, docs, and ledger facts", () => {
  assert.equal(validateProductTruth(sources()).release.version, "1.2.3");
});

test("reports stale product facts across independent surfaces", () => {
  const fixture = sources();
  fixture.currentDocs["README.md"] += " OldProduct 24 snapshots";
  fixture.blockedRoadmap += "\nF-V06 duplicate";
  assert.throws(
    () => validateProductTruth(fixture),
    /README\.md: stale product name[\s\S]*stale 24-snapshot[\s\S]*retired or duplicate ledger marker remains: F-V06/,
  );
});

test("rejects code-signing instructions under the unsigned release policy", () => {
  const fixture = sources();
  fixture.currentDocs["docs/release/UNSIGNED_RELEASES.md"] += "\nsigntool sign package.msi";
  assert.throws(() => validateProductTruth(fixture), /platform signing guidance is forbidden/);
});
