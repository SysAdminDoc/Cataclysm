import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateVersionContract } from "./version-contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

try {
  const result = validateVersionContract(
    {
      packageJson: read("package.json"),
      cargoToml: read("src-tauri/Cargo.toml"),
      tauriConfig: read("src-tauri/tauri.conf.json"),
      modelProvenance: read("src/lib/model-provenance.ts"),
      readme: read("README.md"),
    },
    {
      gitRefName: process.env.GITHUB_REF_NAME,
      gitRefType: process.env.GITHUB_REF_TYPE,
    },
  );
  console.log(
    `Version contract verified: ${result.version}` +
      `${result.tag ? ` (${result.tag})` : ""}.`,
  );
} catch (error) {
  console.error(`Version contract failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
