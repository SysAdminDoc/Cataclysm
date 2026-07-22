import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  assertInstalledSmokeHost,
  runInstalledReleaseSmoke,
} from "./installed-release-smoke.mjs";
import { selectReleaseArtifactFiles } from "./release-artifact-contract.mjs";
import { RELEASE_CARGO_FEATURES } from "./release-contract.mjs";
import {
  assertWindowsInstallerMatrix,
  classifyWindowsInstaller,
  formatWindowsInstallerChecksums,
  offlineInstallerName,
  validateWindowsInstallerConfigs,
} from "./windows-installer-contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleRoot = path.join(repoRoot, "src-tauri", "target", "release", "bundle");
const manifestPath = path.join(bundleRoot, "cataclysm-build-manifest.json");
const artifactsDir = path.join(repoRoot, "artifacts");
const tauriConfigPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");
const offlineTauriConfigPath = path.join(repoRoot, "src-tauri", "tauri.offline.conf.json");
const installerChecksumsPath = path.join(bundleRoot, "checksums-sha256.txt");

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

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function installerArtifacts() {
  return listFiles(bundleRoot)
    .map((file) => ({
      file,
      path: path.relative(bundleRoot, file).replaceAll("\\", "/"),
      bytes: statSync(file).size,
    }))
    .filter((artifact) => classifyWindowsInstaller(artifact.path));
}

function labelOfflineInstallers() {
  const generated = installerArtifacts();
  if (generated.length !== 2 || generated.some((artifact) => classifyWindowsInstaller(artifact.path)?.variant !== "standard")) {
    throw new Error(`Offline Tauri build must emit exactly one default-named MSI and NSIS; found ${generated.length} installer(s).`);
  }
  for (const artifact of generated) {
    const destination = path.join(path.dirname(artifact.file), offlineInstallerName(artifact.file));
    renameSync(artifact.file, destination);
  }
}

function tauriBuild(tauriCli, configPath = null) {
  const args = [
    tauriCli,
    "build",
    "--ci",
    "--no-sign",
    "--features",
    RELEASE_CARGO_FEATURES.join(","),
  ];
  if (configPath) args.push("--config", configPath);
  run(process.execPath, args);
}

function writeInstallerChecksums(installers) {
  const withDigests = installers.map((installer) => ({
    ...installer,
    sha256: sha256(installer.file),
  }));
  writeFileSync(installerChecksumsPath, formatWindowsInstallerChecksums(withDigests));
  return withDigests;
}

function runNodeScript(label, scriptRelPath) {
  console.log(`\n==> ${label}`);
  run(process.execPath, [path.join(repoRoot, "scripts", scriptRelPath)]);
}

// CycloneDX SBOMs (npm + Cargo) are the resolved-dependency evidence the SLSA
// provenance points at. Read their digests so the build manifest records the
// supply-chain artifacts alongside the installers.
function supplyChainSection() {
  const entries = [
    { key: "sbom_npm", file: "sbom-npm.json" },
    { key: "sbom_cargo", file: "sbom-cargo.json" },
    { key: "provenance", file: "provenance.json" },
  ];
  const section = {};
  for (const { key, file } of entries) {
    const filePath = path.join(artifactsDir, file);
    section[key] = existsSync(filePath)
      ? { file: `artifacts/${file}`, sha256: sha256(filePath) }
      : { file: `artifacts/${file}`, sha256: null };
  }
  return section;
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

function buildManifest(probe, installedSmoke) {
  const tauriConfig = readJson(tauriConfigPath);
  const offlineTauriConfig = readJson(offlineTauriConfigPath);
  const webviewConfig = validateWindowsInstallerConfigs(tauriConfig, offlineTauriConfig);
  const artifactFiles = selectReleaseArtifactFiles(listFiles(bundleRoot), bundleRoot);
  if (artifactFiles.length === 0) throw new Error("Tauri produced no bundle artifacts.");
  const windowsInstallers = assertWindowsInstallerMatrix(installerArtifacts());

  const rustVersion = run("rustc", ["-Vv"], { capture: true });
  const rustHost = rustVersion.match(/^host:\s+(.+)$/m)?.[1] ?? "unknown";
  const gitCommit = run("git", ["rev-parse", "HEAD"], { capture: true });
  const advisoryBaselinePath = path.join(repoRoot, "scripts", "rust-advisory-baseline.json");
  const advisoryBaseline = JSON.parse(readFileSync(advisoryBaselinePath, "utf8"));
  const manifest = {
    schema_version: 3,
    product: tauriConfig.productName,
    version: tauriConfig.version,
    git_commit: gitCommit,
    rust_host: rustHost,
    cargo_features: RELEASE_CARGO_FEATURES,
    rust_advisory_baseline: {
      sha256: sha256(advisoryBaselinePath),
      exception_count: advisoryBaseline.exceptions.length,
      next_review_by: advisoryBaseline.exceptions.map((entry) => entry.review_by).sort()[0],
    },
    capability_probe: probe,
    installed_smoke: installedSmoke,
    windows_installers: {
      ...webviewConfig,
      variants: windowsInstallers.map((installer) => ({
        path: installer.path,
        format: installer.format,
        variant: installer.variant,
        webview_install_mode: installer.webview_install_mode,
        requires_network_for_missing_runtime: installer.requires_network_for_missing_runtime,
        runtime_servicing: installer.runtime_servicing,
        bytes: installer.bytes,
        sha256: sha256(installer.file),
      })),
    },
    installer_checksums: {
      path: path.relative(bundleRoot, installerChecksumsPath).replaceAll("\\", "/"),
      sha256: sha256(installerChecksumsPath),
    },
    supply_chain: supplyChainSection(),
    artifacts: artifactFiles.map((file) => {
      const relativePath = path.relative(bundleRoot, file).replaceAll("\\", "/");
      const installer = classifyWindowsInstaller(relativePath);
      return {
        path: relativePath,
        bytes: statSync(file).size,
        sha256: sha256(file),
        ...(installer ? { windows_installer: installer } : {}),
      };
    }),
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function main() {
  console.log("==> Installed-package host preflight");
  assertInstalledSmokeHost();

  console.log("==> Cataclysm strict release verification");
  runNpm(["run", "verify:release"]);

  const tauriConfig = readJson(tauriConfigPath);
  const offlineTauriConfig = readJson(offlineTauriConfigPath);
  validateWindowsInstallerConfigs(tauriConfig, offlineTauriConfig);

  console.log("\n==> Clean GPU-enabled offline Windows packages");
  rmSync(bundleRoot, { recursive: true, force: true });
  const tauriCli = path.join(repoRoot, "node_modules", "@tauri-apps", "cli", "tauri.js");
  tauriBuild(tauriCli, offlineTauriConfigPath);
  labelOfflineInstallers();

  console.log("\n==> Small GPU-enabled standard Windows packages");
  tauriBuild(tauriCli);

  mkdirSync(bundleRoot, { recursive: true });
  const installerMatrix = assertWindowsInstallerMatrix(installerArtifacts());
  writeInstallerChecksums(installerMatrix);
  console.log(`Verified ${installerMatrix.length} standard/offline Windows installer variants.`);
  console.log("\n==> Packaged-binary capability smoke");
  const probe = probeReleaseBinary();
  console.log("\n==> Installed MSI/NSIS desktop journey");
  const installedSmoke = await runInstalledReleaseSmoke({
    bundleRoot,
    expectedVersion: tauriConfig.version,
  });

  // Supply-chain evidence: CycloneDX SBOMs (npm + Cargo) feed the SLSA build
  // provenance, and both ship on the GitHub Release. SBOMs are generated before
  // the manifest so their digests are recorded in it; provenance is generated
  // afterward because it attests the manifest's artifact subjects.
  runNodeScript("CycloneDX SBOMs (npm + Cargo)", "generate-sbom.mjs");
  const manifest = buildManifest(probe, installedSmoke);
  runNodeScript("SLSA build provenance", "generate-provenance.mjs");

  console.log(
    `GPU release ready: ${probe.gpu_status}; ${installedSmoke.packages.length} installed package journey(s); ` +
      `${manifest.artifacts.length} artifact(s); SBOM + SLSA provenance in artifacts/; ${manifestPath}`,
  );
}

main().catch((error) => {
  console.error(`\nRelease build failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
