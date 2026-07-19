import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectE2eArtifact } from "./e2e-artifact-contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, env: process.env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

let artifact = inspectE2eArtifact(repoRoot);
if (!artifact.ok) {
  console.log("E2E production artifact is missing or stale; rebuilding before preview.");
  for (const failure of artifact.failures) console.log(`- ${failure}`);
  if (process.env.npm_execpath) {
    run(process.execPath, [process.env.npm_execpath, "run", "build"]);
  } else if (process.platform === "win32") {
    run("cmd.exe", ["/d", "/c", "npm run build"]);
  } else {
    run("npm", ["run", "build"]);
  }
  artifact = inspectE2eArtifact(repoRoot);
  if (!artifact.ok) {
    throw new Error(`Build completed without a fresh E2E artifact:\n${artifact.failures.join("\n")}`);
  }
} else {
  console.log(`E2E production artifact matches source digest ${artifact.expectedDigest.slice(0, 12)}.`);
}

const playwrightCli = path.join(repoRoot, "node_modules", "@playwright", "test", "cli.js");
run(process.execPath, [playwrightCli, "test", ...process.argv.slice(2)]);
