import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcTauriRoot = path.join(repoRoot, "src-tauri");

function formatCommand(command, args) {
  return [command, ...args].join(" ");
}

function run(label, command, args, options = {}) {
  console.log(`\n==> ${label}`);
  console.log(`$ ${formatCommand(command, args)}`);

  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    console.error(`\n${label} failed to start: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`\n${label} failed with exit code ${result.status}.`);
    process.exit(result.status ?? 1);
  }
}

function commandExists(command) {
  const lookup = process.platform === "win32" ? "where.exe" : "command";
  const args = process.platform === "win32" ? [command] : ["-v", command];
  const result = spawnSync(lookup, args, { stdio: "ignore", shell: process.platform !== "win32" });
  return result.status === 0;
}

function quoteCmdArg(arg) {
  return `"${arg.replace(/"/g, '\\"')}"`;
}

function runNpm(label, args) {
  if (process.platform === "win32") {
    const npmLine = ["npm", ...args].join(" ");
    run(label, "cmd.exe", ["/d", "/c", npmLine]);
    return;
  }

  run(label, "npm", args);
}

function findVsDevCmd() {
  if (process.platform !== "win32") {
    return null;
  }

  const explicit = process.env.VSDEVCMD;
  if (explicit && existsSync(explicit)) {
    return explicit;
  }

  const programFilesX86 = process.env["ProgramFiles(x86)"];
  if (!programFilesX86) {
    return null;
  }

  const vswhere = path.join(programFilesX86, "Microsoft Visual Studio", "Installer", "vswhere.exe");
  if (existsSync(vswhere)) {
    const result = spawnSync(
      vswhere,
      [
        "-latest",
        "-products",
        "*",
        "-requires",
        "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
        "-find",
        "Common7\\Tools\\VsDevCmd.bat",
      ],
      { encoding: "utf8" },
    );

    const candidate = result.stdout?.split(/\r?\n/).find((line) => line.trim());
    if (candidate && existsSync(candidate.trim())) {
      return candidate.trim();
    }
  }

  const fallback = path.join(
    programFilesX86,
    "Microsoft Visual Studio",
    "2022",
    "BuildTools",
    "Common7",
    "Tools",
    "VsDevCmd.bat",
  );
  return existsSync(fallback) ? fallback : null;
}

const vsDevCmd = findVsDevCmd();
const needsVsEnv = process.platform === "win32" && !commandExists("link.exe");

function runCargo(label, args, options = {}) {
  if (needsVsEnv) {
    if (!vsDevCmd) {
      console.error(
        "\nRust verification needs MSVC link.exe, but no Visual Studio Build Tools environment was found.",
      );
      process.exit(1);
    }

    const cargoLine = ["cargo", ...args].map(quoteCmdArg).join(" ");
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "tsunamisim-verify-"));
    const batchFile = path.join(tempDir, "cargo-with-msvc.bat");
    writeFileSync(
      batchFile,
      [
        "@echo off",
        `call "${vsDevCmd}" -arch=x64 -host_arch=x64 >nul`,
        "if errorlevel 1 exit /b %errorlevel%",
        cargoLine,
        "exit /b %errorlevel%",
      ].join("\r\n"),
    );
    try {
      run(label, "cmd.exe", ["/d", "/c", batchFile], options);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
    return;
  }

  run(label, "cargo", args, options);
}

console.log(`TsunamiSimulator local verification on ${os.platform()} ${os.release()}`);
if (needsVsEnv) {
  console.log(`MSVC linker is not on PATH; using ${vsDevCmd ?? "no Visual Studio environment found"}.`);
}

runNpm("TypeScript typecheck", ["run", "typecheck"]);
runNpm("ESLint", ["run", "lint"]);
runNpm("Vitest unit suite", ["run", "test:unit"]);
runNpm("Production web build", ["run", "build"]);
runNpm("npm audit", ["audit", "--audit-level=moderate"]);
runNpm("Playwright browser preview suite", ["run", "test:e2e"]);

runCargo("Rust cargo check", ["check", "--manifest-path", "src-tauri/Cargo.toml"]);
runCargo("Rust release tests", ["test", "--release", "--manifest-path", "src-tauri/Cargo.toml"]);
runCargo("Rust clippy", [
  "clippy",
  "--manifest-path",
  "src-tauri/Cargo.toml",
  "--all-targets",
  "--",
  "-D",
  "warnings",
]);

if (commandExists("cargo-audit.exe") || commandExists("cargo-audit")) {
  runCargo("Rust advisory audit", ["audit"], { cwd: srcTauriRoot });
} else {
  console.warn("\nSkipping Rust advisory audit: cargo-audit is not installed.");
}

if (commandExists("cargo-deny.exe") || commandExists("cargo-deny")) {
  runCargo("Rust license/advisory policy", ["deny", "check"], { cwd: srcTauriRoot });
} else {
  console.warn("Skipping Rust license/advisory policy: cargo-deny is not installed.");
}

console.log("\nLocal verification completed.");
