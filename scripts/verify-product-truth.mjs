import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateProductTruth } from "./product-truth-contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");
const currentDocPaths = [
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "docs/manual/getting-started.md",
  "docs/manual/custom-scenarios.md",
  "docs/manual/physics-explainer.md",
  "docs/science/VALIDATION.md",
  "docs/release/UNSIGNED_RELEASES.md",
];

try {
  const truth = validateProductTruth({
    productTruth: read("src/data/product-truth.json"),
    packageJson: read("package.json"),
    cargoToml: read("src-tauri/Cargo.toml"),
    wasmCargoToml: read("src-tauri/wasm/Cargo.toml"),
    tauriConfig: read("src-tauri/tauri.conf.json"),
    modelProvenance: read("src/lib/model-provenance.ts"),
    globeStyles: read("src/lib/globe-styles.ts"),
    swePlayback: read("src/components/SwePlayback.tsx"),
    tour: read("src/components/Tour.tsx"),
    i18n: read("src/lib/i18n-core.ts"),
    currentDocs: Object.fromEntries(currentDocPaths.map((doc) => [doc, read(doc)])),
    blockedRoadmap: read("Roadmap_Blocked.md"),
  });
  console.log(
    `Product truth v${truth.schemaVersion}: ${truth.product.name} ${truth.release.version}, `
    + `${truth.simulation.defaultPlaybackFrames} frames, ${truth.globe.defaultStyleLabel} default, `
    + `${truth.release.artifactPolicy}.`,
  );
} catch (error) {
  console.error(`Product truth contract failed:\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
