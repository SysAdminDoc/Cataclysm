import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";

const MIN_NODE = [20, 0, 0];
const MIN_RUST = [1, 85, 0];

function run(command, args = [], options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    env: process.env,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    shell: false,
  });
}

function runNpm(args = []) {
  if (process.platform === "win32") {
    return run("cmd.exe", ["/d", "/c", ["npm", ...args].join(" ")]);
  }
  return run("npm", args);
}

function commandExists(command) {
  if (process.platform === "win32") {
    return run("where.exe", [command], { stdio: "ignore" }).status === 0;
  }
  return run("sh", ["-c", `command -v ${shellQuote(command)}`], { stdio: "ignore" }).status === 0;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function parseVersion(text) {
  const match = String(text).match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1, 4).map((part) => Number(part)) : null;
}

function compareVersion(actual, minimum) {
  if (!actual) return -1;
  for (let i = 0; i < minimum.length; i += 1) {
    if (actual[i] > minimum[i]) return 1;
    if (actual[i] < minimum[i]) return -1;
  }
  return 0;
}

function versionLabel(version) {
  return version ? version.join(".") : "unknown";
}

function findVsDevCmd(env = process.env) {
  if (process.platform !== "win32") return null;

  const explicit = env.VSDEVCMD;
  if (explicit && existsSync(explicit)) return explicit;

  const programFilesX86 = env["ProgramFiles(x86)"];
  if (!programFilesX86) return null;

  const vswhere = path.join(programFilesX86, "Microsoft Visual Studio", "Installer", "vswhere.exe");
  if (existsSync(vswhere)) {
    const result = run(vswhere, [
      "-latest",
      "-products",
      "*",
      "-requires",
      "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
      "-find",
      "Common7\\Tools\\VsDevCmd.bat",
    ]);
    const candidate = result.stdout?.split(/\r?\n/).find((line) => line.trim());
    if (candidate && existsSync(candidate.trim())) return candidate.trim();
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

function detectWorkspaceRisk(cwd) {
  const normalized = cwd.toLowerCase();
  const risks = [];
  if (normalized.includes("onedrive")) {
    risks.push("OneDrive-synced paths can lock node_modules or Rust target files during builds.");
  }
  if (normalized.includes("dropbox")) {
    risks.push("Dropbox-synced paths can lock generated build artifacts.");
  }
  if (normalized.includes("shared folders") || normalized.startsWith("\\\\")) {
    risks.push("VM/shared-folder paths can slow Vitest, Playwright, and Rust incremental builds.");
  }
  return risks;
}

function checkTauriCli() {
  const result = process.platform === "win32"
    ? run("cmd.exe", ["/d", "/c", "npm exec tauri -- --version"])
    : runNpm(["exec", "tauri", "--", "--version"]);
  if (result.status === 0) {
    return { ok: true, detail: result.stdout.trim() || result.stderr.trim() || "installed" };
  }
  return {
    ok: false,
    detail: "not runnable via npm exec tauri -- --version",
    fix: "Run npm install, then retry npm run doctor.",
  };
}

function makeCheck(level, name, ok, detail, fix) {
  return { level, name, ok, detail, fix };
}

function runChecks(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const checks = [];

  const nodeVersion = parseVersion(process.version);
  checks.push(makeCheck(
    "required",
    "Node.js",
    compareVersion(nodeVersion, MIN_NODE) >= 0,
    `${versionLabel(nodeVersion)} (required >= ${versionLabel(MIN_NODE)})`,
    "Install Node.js 20 LTS or newer.",
  ));

  const npm = runNpm(["--version"]);
  checks.push(makeCheck(
    "required",
    "npm",
    npm.status === 0,
    npm.status === 0 ? npm.stdout.trim() : "not found",
    "Install Node.js with npm, then run npm install.",
  ));

  const rustc = run("rustc", ["--version"]);
  const rustVersion = rustc.status === 0 ? parseVersion(rustc.stdout) : null;
  checks.push(makeCheck(
    "required",
    "Rust rustc",
    rustc.status === 0 && compareVersion(rustVersion, MIN_RUST) >= 0,
    rustc.status === 0
      ? `${rustc.stdout.trim()} (required >= ${versionLabel(MIN_RUST)})`
      : "not found",
    "Install or update Rust with rustup: rustup update stable",
  ));

  const cargo = run("cargo", ["--version"]);
  checks.push(makeCheck(
    "required",
    "Cargo",
    cargo.status === 0,
    cargo.status === 0 ? cargo.stdout.trim() : "not found",
    "Install Rust with rustup so Cargo is available.",
  ));

  const tauri = checkTauriCli();
  checks.push(makeCheck("required", "Tauri CLI", tauri.ok, tauri.detail, tauri.fix));

  if (process.platform === "win32") {
    const linkOnPath = commandExists("link.exe");
    const vsDevCmd = findVsDevCmd();
    checks.push(makeCheck(
      "required",
      "MSVC linker / Visual Studio Build Tools",
      linkOnPath || Boolean(vsDevCmd),
      linkOnPath ? "link.exe is on PATH" : vsDevCmd ? `VsDevCmd.bat found at ${vsDevCmd}` : "not found",
      "Install Visual Studio Build Tools with the Desktop development with C++ workload.",
    ));

    checks.push(makeCheck(
      "optional",
      "signtool",
      commandExists("signtool.exe"),
      commandExists("signtool.exe") ? "installed" : "not found",
      "Install the Windows SDK if you need local installer signature verification.",
    ));
  }

  checks.push(makeCheck(
    "optional",
    "cargo-audit",
    commandExists("cargo-audit") || commandExists("cargo-audit.exe"),
    commandExists("cargo-audit") || commandExists("cargo-audit.exe") ? "installed" : "not found",
    "Install with: cargo install cargo-audit",
  ));

  checks.push(makeCheck(
    "optional",
    "cargo-deny",
    commandExists("cargo-deny") || commandExists("cargo-deny.exe"),
    commandExists("cargo-deny") || commandExists("cargo-deny.exe") ? "installed" : "not found",
    "Install with: cargo install cargo-deny",
  ));

  const risks = detectWorkspaceRisk(cwd);
  checks.push(makeCheck(
    "optional",
    "Workspace path",
    risks.length === 0,
    risks.length === 0 ? cwd : risks.join(" "),
    "Move the checkout to a local non-synced path such as C:\\Users\\--\\repos\\TsunamiSimulator for best results.",
  ));

  checks.push(makeCheck(
    "optional",
    "Vitest VM fallback flags",
    true,
    "If file watching or shared-folder I/O is slow, run tests with CI=1 npm run test:unit.",
  ));

  return checks;
}

function printCheck(check) {
  const mark = check.ok ? "PASS" : check.level === "required" ? "FAIL" : "WARN";
  console.log(`[${mark}] ${check.name}: ${check.detail}`);
  if (!check.ok && check.fix) console.log(`      Fix: ${check.fix}`);
}

function printSummary(checks) {
  const requiredFailures = checks.filter((check) => check.level === "required" && !check.ok);
  const warnings = checks.filter((check) => check.level === "optional" && !check.ok);

  console.log("");
  console.log(`Required failures: ${requiredFailures.length}`);
  console.log(`Optional warnings : ${warnings.length}`);

  if (requiredFailures.length > 0) {
    console.log("Doctor failed. Fix required tools before running npm run verify.");
    return 1;
  }

  console.log("Doctor passed. Optional warnings do not block local development.");
  return 0;
}

function printDoctor() {
  console.log(`TsunamiSimulator toolchain doctor on ${os.platform()} ${os.release()}`);
  console.log(`Workspace: ${process.cwd()}`);
  console.log("");

  const checks = runChecks();
  for (const check of checks) printCheck(check);
  return printSummary(checks);
}

function runSelfTest() {
  const versions = [
    ["v20.0.0", [20, 0, 0]],
    ["rustc 1.85.1 (abc 2026-01-01)", [1, 85, 1]],
    ["npm 11.6.0", [11, 6, 0]],
  ];
  for (const [input, expected] of versions) {
    const actual = parseVersion(input);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`parseVersion(${input}) returned ${actual}, expected ${expected}`);
    }
  }

  if (compareVersion([20, 0, 0], MIN_NODE) !== 0) {
    throw new Error("minimum Node comparison should accept 20.0.0");
  }
  if (compareVersion([19, 9, 9], MIN_NODE) >= 0) {
    throw new Error("minimum Node comparison should reject 19.9.9");
  }
  if (detectWorkspaceRisk("\\\\vmware-host\\Shared Folders\\repos").length === 0) {
    throw new Error("shared-folder risk should be detected");
  }
  console.log("doctor self-test passed");
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  process.exitCode = printDoctor();
}
