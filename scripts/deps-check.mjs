import { spawnSync } from "node:child_process";
import os from "node:os";
import { parseNpmAuditResult } from "./deps-check-contract.mjs";

function run(command, args, options = {}) {
  if (process.platform === "win32") {
    const line = [command, ...args].join(" ");
    return spawnSync("cmd.exe", ["/d", "/c", line], {
      encoding: "utf8",
      stdio: options.stdio ?? "pipe",
      cwd: options.cwd,
    });
  }
  return spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    cwd: options.cwd,
  });
}

function commandExists(command) {
  if (process.platform === "win32") {
    const result = spawnSync("where.exe", [command], { stdio: "ignore" });
    return result.status === 0;
  }
  const result = spawnSync("sh", ["-c", `command -v ${command}`], {
    stdio: "ignore",
  });
  return result.status === 0;
}

console.log(`\nDependency refresh check — ${new Date().toISOString()}`);
console.log(`Platform: ${os.platform()} ${os.release()}\n`);

const strictRustPolicy = process.argv.includes("--strict");
let issues = 0;
let missingRustPolicyTools = 0;
let auditFailed = false;

// --- npm outdated ---
console.log("==> npm outdated");
const npmResult = run("npm", ["outdated", "--json"]);
if (npmResult.stdout && npmResult.stdout.trim() !== "{}") {
  try {
    const outdated = JSON.parse(npmResult.stdout);
    const entries = Object.entries(outdated);
    if (entries.length > 0) {
      issues += entries.length;
      console.log(`  ${entries.length} outdated package(s):\n`);
      console.log(
        "  " +
          ["Package", "Current", "Wanted", "Latest"]
            .map((h) => h.padEnd(30))
            .join(""),
      );
      console.log("  " + "-".repeat(120));
      for (const [name, info] of entries) {
        console.log(
          "  " +
            [name, info.current ?? "—", info.wanted ?? "—", info.latest ?? "—"]
              .map((v) => String(v).padEnd(30))
              .join(""),
        );
      }
      console.log();
    }
  } catch {
    console.log("  (could not parse npm outdated output)\n");
  }
} else {
  console.log("  All npm packages are up to date.\n");
}

// --- npm audit ---
console.log("==> npm audit");
const auditResult = run("npm", ["audit", "--json"]);
try {
  const vulnerabilities = parseNpmAuditResult(auditResult);
  console.log(`  No known vulnerabilities (${vulnerabilities.total} reported).\n`);
} catch (error) {
  auditFailed = true;
  issues++;
  console.error(`  FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
}

// --- Cargo tools ---
console.log("==> Rust ecosystem tools");

const cargoAvailable = commandExists("cargo");
if (!cargoAvailable) {
  console.log("  cargo is not installed — skipping Rust checks.\n");
} else {
  const cargoVersion = run("cargo", ["--version"]);
  console.log(`  cargo: ${cargoVersion.stdout?.trim() ?? "unknown"}`);

  if (commandExists("cargo-audit") || commandExists("cargo-audit.exe")) {
    console.log("  cargo-audit: installed");
  } else {
    console.log("  cargo-audit: NOT installed (install with: cargo install cargo-audit)");
    issues++;
    missingRustPolicyTools++;
  }

  if (commandExists("cargo-deny") || commandExists("cargo-deny.exe")) {
    console.log("  cargo-deny: installed");
  } else {
    console.log("  cargo-deny: NOT installed (install with: cargo install cargo-deny)");
    issues++;
    missingRustPolicyTools++;
  }
  console.log();
}

// --- Summary ---
console.log("─".repeat(60));
if (issues > 0) {
  console.log(
    `${issues} item(s) need attention. Run refreshes per the cadence below.`,
  );
} else {
  console.log("All dependencies look current.");
}

console.log(`
Recommended refresh cadence (no Dependabot):
  Weekly  : npm audit
  Monthly : npm outdated → npm update → commit lockfile
  Monthly : cargo update → cargo audit → cargo deny check (when tools installed)
  Quarterly: major version bumps (review changelogs before upgrading)
`);

if (auditFailed) {
  console.error("Dependency check failed: npm audit did not complete cleanly.");
  process.exitCode = 1;
}
if (strictRustPolicy && missingRustPolicyTools > 0) {
  console.error("Strict dependency check failed: install cargo-audit and cargo-deny before release verification.");
  process.exitCode = 1;
}
