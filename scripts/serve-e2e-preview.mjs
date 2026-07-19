import path from "node:path";
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import { assertFreshE2eArtifact } from "./e2e-artifact-contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  const artifact = assertFreshE2eArtifact(repoRoot);
  console.log(`Previewing proven E2E artifact ${artifact.expectedDigest.slice(0, 12)}.`);
  const server = await preview({
    root: repoRoot,
    preview: { host: "127.0.0.1", port: 4187, strictPort: true },
  });
  const close = async () => {
    await server.close();
    process.exit(0);
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
