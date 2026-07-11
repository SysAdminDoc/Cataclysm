import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { RELEASE_CARGO_FEATURES } from "./release-contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleRoot = path.join(repoRoot, "src-tauri", "target", "release", "bundle");
const manifestPath = path.join(bundleRoot, "cataclysm-build-manifest.json");

function run(command, args, options = {}) {
  console.log(`$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: options.capture ? "utf8" : undefined,
    stdio: options.capture ? "pipe" : "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stderr || result.stdout || ""}` : "";
    throw new Error(`${command} exited with code ${result.status}.${detail}`);
  }
  return options.capture ? result.stdout.trim() : "";
}

function runNpm(args) {
  if (process.platform === "win32") {
    return run("cmd.exe", ["/d", "/c", "npm", ...args]);
  }
  return run("npm", args);
}

function listFiles(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    return entry.isDirectory() ? listFiles(absolute) : [absolute];
  });
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function executablePath() {
  const name = process.platform === "win32" ? "cataclysm.exe" : "cataclysm";
  return path.join(repoRoot, "src-tauri", "target", "release", name);
}

function probeReleaseBinary() {
  const binary = executablePath();
  if (!existsSync(binary)) throw new Error(`Release binary is missing: ${binary}`);
  const probePath = path.join(bundleRoot, ".release-capabilities.json");
  run(binary, ["--release-probe", probePath]);
  if (!existsSync(probePath)) throw new Error("Release binary did not write its capability probe.");
  const probe = JSON.parse(readFileSync(probePath, "utf8"));
  unlinkSync(probePath);
  if (!probe.gpu_feature || probe.gpu_status === "feature-off") {
    throw new Error(`Release binary was built without GPU support (${probe.gpu_status}).`);
  }
  if (!["available", "no-adapter"].includes(probe.gpu_status)) {
    throw new Error(`Release binary returned an unknown GPU state: ${probe.gpu_status}`);
  }
  return probe;
}

function buildManifest(probe) {
  const tauriConfig = JSON.parse(
    readFileSync(path.join(repoRoot, "src-tauri", "tauri.conf.json"), "utf8"),
  );
  const artifactFiles = listFiles(bundleRoot).filter((file) => file !== manifestPath);
  if (artifactFiles.length === 0) throw new Error("Tauri produced no bundle artifacts.");

  const rustVersion = run("rustc", ["-Vv"], { capture: true });
  const rustHost = rustVersion.match(/^host:\s+(.+)$/m)?.[1] ?? "unknown";
  const gitCommit = run("git", ["rev-parse", "HEAD"], { capture: true });
  const manifest = {
    schema_version: 1,
    product: tauriConfig.productName,
    version: tauriConfig.version,
    git_commit: gitCommit,
    rust_host: rustHost,
    cargo_features: RELEASE_CARGO_FEATURES,
    capability_probe: probe,
    artifacts: artifactFiles.map((file) => ({
      path: path.relative(bundleRoot, file).replaceAll("\\", "/"),
      bytes: statSync(file).size,
      sha256: sha256(file),
    })),
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function main() {
  console.log("==> Cataclysm strict release verification");
  runNpm(["run", "verify:release"]);

  console.log("\n==> Clean GPU-enabled desktop package");
  rmSync(bundleRoot, { recursive: true, force: true });
  const tauriCli = path.join(repoRoot, "node_modules", "@tauri-apps", "cli", "tauri.js");
  run(process.execPath, [
    tauriCli,
    "build",
    "--ci",
    "--features",
    RELEASE_CARGO_FEATURES.join(","),
  ]);

  mkdirSync(bundleRoot, { recursive: true });
  console.log("\n==> Packaged-binary capability smoke");
  const probe = probeReleaseBinary();
  const manifest = buildManifest(probe);
  console.log(
    `GPU release ready: ${probe.gpu_status}; ${manifest.artifacts.length} artifact(s); ${manifestPath}`,
  );
}

try {
  main();
} catch (error) {
  console.error(`\nRelease build failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
