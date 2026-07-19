import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeE2eArtifactProvenance } from "./e2e-artifact-contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const record = writeE2eArtifactProvenance(repoRoot);
console.log(
  `Recorded deterministic E2E build provenance (${record.inputCount} inputs, ${record.sourceDigest.slice(0, 12)}).`,
);
