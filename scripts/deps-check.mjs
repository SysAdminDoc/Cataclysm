import { spawnSync } from "node:child_process";
import os from "node:os";

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

let issues = 0;

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
if (auditResult.stdout) {
  try {
    const audit = JSON.parse(auditResult.stdout);
    const total = audit.metadata?.vulnerabilities?.total ?? 0;
    if (total > 0) {
      issues += total;
      const v = audit.metadata.vulnerabilities;
      console.log(
        `  ${total} vulnerabilit${total === 1 ? "y" : "ies"}: ` +
          `${v.critical ?? 0} critical, ${v.high ?? 0} high, ` +
          `${v.moderate ?? 0} moderate, ${v.low ?? 0} low\n`,
      );
    } else {
      console.log("  No known vulnerabilities.\n");
    }
  } catch {
    console.log("  (could not parse npm audit output)\n");
  }
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
  }

  if (commandExists("cargo-deny") || commandExists("cargo-deny.exe")) {
    console.log("  cargo-deny: installed");
  } else {
    console.log("  cargo-deny: NOT installed (install with: cargo install cargo-deny)");
    issues++;
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
