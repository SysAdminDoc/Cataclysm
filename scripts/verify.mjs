import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  RELEASE_CARGO_FEATURES,
  RUST_RELEASE_FEATURE_MATRIX,
  cargoFeatureArgs,
} from "./release-contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcTauriRoot = path.join(repoRoot, "src-tauri");
const strictRustPolicy =
  process.argv.includes("--strict") ||
  process.env.TSUNAMI_VERIFY_STRICT === "1" ||
  process.env.VERIFY_STRICT === "1";
const docsOnly = process.argv.includes("--docs-only");

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

async function assertPortAvailable(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", (error) => reject(error));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }).catch((error) => {
    console.error(
      `\nBrowser verification requires a clean preview port, but 127.0.0.1:${port} is unavailable (${error.code ?? error.message}).`,
    );
    console.error("Stop the stale preview process and rerun verification; attaching to an unknown build is forbidden.");
    process.exit(1);
  });
}

function quoteCmdArg(arg) {
  return `"${arg.replace(/"/g, '\\"')}"`;
}

function docsTruthGate() {
  const docs = ["README.md", "CONTRIBUTING.md", "CHANGELOG.md", "docs/release/CODESIGNING.md"];
  const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const scripts = new Set(Object.keys(packageJson.scripts ?? {}));
  const failures = [];

  const trackedCache = new Map();
  const isTrackedPath = (relativePath) => {
    const clean = relativePath.replace(/\\/g, "/").replace(/\/+$/, "");
    if (trackedCache.has(clean)) return trackedCache.get(clean);
    const exact = spawnSync("git", ["ls-files", "--error-unmatch", "--", clean], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    const tracked =
      exact.status === 0 ||
      spawnSync("git", ["ls-files", "--", `${clean}/`], {
        cwd: repoRoot,
        encoding: "utf8",
      }).stdout.trim().length > 0;
    trackedCache.set(clean, tracked);
    return tracked;
  };

  const shouldSkipLink = (target) =>
    target.startsWith("#") ||
    /^[a-z][a-z0-9+.-]*:/i.test(target) ||
    target.startsWith("mailto:");

  for (const doc of docs) {
    const docPath = path.join(repoRoot, doc);
    if (!existsSync(docPath)) continue;
    const text = readFileSync(docPath, "utf8");
    for (const match of text.matchAll(/\bnpm\s+run\s+([A-Za-z0-9:_-]+)/g)) {
      const scriptName = match[1];
      if (!scripts.has(scriptName)) {
        failures.push(`${doc}: references missing npm script "${scriptName}"`);
      }
    }
    for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const rawTarget = match[1].trim();
      if (!rawTarget || shouldSkipLink(rawTarget)) continue;
      const targetNoAnchor = rawTarget.split("#", 1)[0];
      if (!targetNoAnchor) continue;
      const decoded = decodeURIComponent(targetNoAnchor);
      const resolved = path
        .normalize(path.join(path.dirname(doc), decoded))
        .replace(/\\/g, "/")
        .replace(/^\.\//, "");
      if (resolved.startsWith("../") || path.isAbsolute(resolved)) {
        failures.push(`${doc}: link escapes repo (${rawTarget})`);
        continue;
      }
      if (!existsSync(path.join(repoRoot, resolved))) {
        failures.push(`${doc}: link target missing (${rawTarget})`);
        continue;
      }
      if (!isTrackedPath(resolved)) {
        failures.push(`${doc}: link target is not tracked (${rawTarget})`);
      }
    }
  }

  if (failures.length > 0) {
    console.error("\nDocs/script truth gate failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }
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

console.log(`Cataclysm local verification on ${os.platform()} ${os.release()}`);
if (needsVsEnv) {
  console.log(`MSVC linker is not on PATH; using ${vsDevCmd ?? "no Visual Studio environment found"}.`);
}
if (strictRustPolicy) {
  console.log(
    "Strict release verification is enabled; the Rust feature matrix and policy tools are required.",
  );
}

// -- CSP allowlist gate --
// Documented Cesium-required CSP exceptions. Any change to this allowlist
// must include a rationale comment for reviewers.
const CSP_ALLOWLIST = {
  "default-src": ["'self'", "tauri:"],
  "script-src": [
    "'self'",
    // Cesium ships WASM tile decoders that use eval() at runtime.
    "'unsafe-eval'",
    "tauri:",
  ],
  "style-src": [
    "'self'",
    // Cesium injects inline styles on its widget container and child
    // elements; there is no upstream opt-out (tracked by Cesium).
    "'unsafe-inline'",
  ],
  "img-src": [
    "'self'",
    "data:",
    "blob:",
    // Cesium ion tile/imagery endpoints.
    "https://*.cesium.com",
    "https://*.ion.cesium.com",
    // OpenStreetMap tile sources (no-token fallback globe style).
    "https://*.openstreetmap.org",
    "https://tile.openstreetmap.org",
    // Esri World Imagery globe style.
    "https://*.arcgisonline.com",
    "https://server.arcgisonline.com",
  ],
  "connect-src": [
    "'self'",
    "tauri:",
    "ipc:",
    // Cesium ion API + streaming terrain/imagery.
    "https://*.cesium.com",
    "https://*.ion.cesium.com",
    // OSM tile fetch.
    "https://*.openstreetmap.org",
    "https://tile.openstreetmap.org",
    // Esri tile fetch.
    "https://*.arcgisonline.com",
    "https://server.arcgisonline.com",
  ],
  "worker-src": ["'self'", "blob:"],
  "child-src": ["'self'", "blob:"],
  "font-src": ["'self'", "data:"],
};

function cspAllowlistGate() {
  const confPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");
  const conf = JSON.parse(readFileSync(confPath, "utf8"));
  const cspRaw = conf?.app?.security?.csp;
  if (!cspRaw || typeof cspRaw !== "string") {
    console.error("CSP allowlist gate failed: no string CSP found in tauri.conf.json");
    process.exit(1);
  }

  const failures = [];
  const directives = new Map();
  for (const part of cspRaw.split(";")) {
    const tokens = part.trim().split(/\s+/);
    if (tokens.length < 2) continue;
    const name = tokens[0];
    const values = tokens.slice(1);
    directives.set(name, values);
  }

  for (const [directive, allowed] of Object.entries(CSP_ALLOWLIST)) {
    const actual = directives.get(directive);
    if (!actual) {
      failures.push(`${directive}: missing from CSP (expected: ${allowed.join(" ")})`);
      continue;
    }
    const allowedSet = new Set(allowed);
    for (const v of actual) {
      if (!allowedSet.has(v)) {
        failures.push(
          `${directive}: unexpected value "${v}" not in allowlist. ` +
            "Add it to CSP_ALLOWLIST in scripts/verify.mjs with a rationale comment if intentional.",
        );
      }
    }
    directives.delete(directive);
  }

  for (const [directive, values] of directives) {
    failures.push(
      `Unexpected CSP directive "${directive}" (values: ${values.join(" ")}). ` +
        "Add it to CSP_ALLOWLIST in scripts/verify.mjs with a rationale comment if intentional.",
    );
  }

  if (failures.length > 0) {
    console.error("\nCSP allowlist gate failed:");
    for (const f of failures) console.error(`- ${f}`);
    process.exit(1);
  }
}

// -- DOMPurify floor gate --
// Four sanitizer bypasses shipped in the 12 months before 2026-07; the
// last (CVE-2026-49978, IN_PLACE shadow-root bypass) is fixed in 3.4.7.
// The package.json override must never regress below this floor.
const DOMPURIFY_FLOOR = [3, 4, 7];

function dompurifyFloorGate() {
  const lock = JSON.parse(readFileSync(path.join(repoRoot, "package-lock.json"), "utf8"));
  const entries = Object.entries(lock.packages ?? {}).filter(([key]) =>
    key === "node_modules/dompurify" || key.endsWith("/node_modules/dompurify"),
  );
  if (entries.length === 0) {
    console.error("DOMPurify floor gate failed: dompurify not found in package-lock.json");
    process.exit(1);
  }
  const failures = [];
  for (const [key, meta] of entries) {
    const version = meta.version ?? "";
    const parts = version.split(".").map((n) => Number.parseInt(n, 10));
    const belowFloor =
      parts.length < 3 ||
      parts.some((n) => Number.isNaN(n)) ||
      parts[0] < DOMPURIFY_FLOOR[0] ||
      (parts[0] === DOMPURIFY_FLOOR[0] &&
        (parts[1] < DOMPURIFY_FLOOR[1] ||
          (parts[1] === DOMPURIFY_FLOOR[1] && parts[2] < DOMPURIFY_FLOOR[2])));
    if (belowFloor) {
      failures.push(`${key}: resolved dompurify ${version} is below the ${DOMPURIFY_FLOOR.join(".")} security floor`);
    }
  }
  if (failures.length > 0) {
    console.error("\nDOMPurify floor gate failed (CVE-2026-49978 and older bypasses):");
    for (const f of failures) console.error(`- ${f}`);
    console.error('Fix the "overrides" entry in package.json and re-run npm install.');
    process.exit(1);
  }
}

console.log("\n==> DOMPurify floor gate");
dompurifyFloorGate();

console.log("\n==> CSP allowlist gate");
cspAllowlistGate();

console.log("\n==> Docs/script truth gate");
docsTruthGate();
if (docsOnly) {
  console.log("\nDocs/script truth gate completed.");
  process.exit(0);
}
runNpm("Earth asset provenance and rights gate", ["run", "validate:earth-assets"]);
runNpm("Reference perceptual-quality unit gate", ["run", "test:reference-quality"]);
runNpm("HR-00 reference baseline contract", ["run", "verify:reference-locks"]);
runNpm("HR-01 renderer protocol conformance", ["run", "verify:render-protocol"]);
runNpm("TypeScript typecheck", ["run", "typecheck"]);
runNpm("ESLint", ["run", "lint"]);
runNpm("Vitest unit suite", ["run", "test:unit"]);
runNpm("Production web build", ["run", "build"]);
if (strictRustPolicy) {
  runNpm("HR-00 deterministic 1440p/4K capture matrix", ["run", "verify:references"]);
}
runNpm("npm audit", ["audit", "--audit-level=moderate"]);
console.log("\n==> Browser preview ownership gate");
await assertPortAvailable(4187);
runNpm("Playwright browser preview suite", ["run", "test:e2e"]);

const rustMatrix = strictRustPolicy
  ? RUST_RELEASE_FEATURE_MATRIX
  : [{ label: "default", features: [] }];

if (strictRustPolicy && !RELEASE_CARGO_FEATURES.includes("gpu")) {
  console.error("Strict release verification failed: desktop packages must enable the gpu feature.");
  process.exit(1);
}

for (const variant of rustMatrix) {
  const featureArgs = cargoFeatureArgs(variant.features);
  runCargo(`Rust cargo check (${variant.label})`, [
    "check",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    ...featureArgs,
  ]);
  runCargo(`Rust release tests (${variant.label})`, [
    "test",
    "--release",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    ...featureArgs,
  ]);
  runCargo(`Rust clippy (${variant.label})`, [
    "clippy",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--all-targets",
    ...featureArgs,
    "--",
    "-D",
    "warnings",
  ]);
}

function handleMissingRustPolicyTool(name, installCommand) {
  const message = `${name} is not installed. Install with: ${installCommand}`;
  if (strictRustPolicy) {
    console.error(`\nStrict release verification failed: ${message}`);
    process.exit(1);
  }
  console.warn(`\nSkipping ${name}: ${message}`);
}

if (commandExists("cargo-audit.exe") || commandExists("cargo-audit")) {
  runCargo("Rust advisory audit", ["audit"], { cwd: srcTauriRoot });
} else {
  handleMissingRustPolicyTool("Rust advisory audit", "cargo install cargo-audit");
}

if (commandExists("cargo-deny.exe") || commandExists("cargo-deny")) {
  runCargo("Rust license/advisory policy", ["deny", "check"], { cwd: srcTauriRoot });
} else {
  handleMissingRustPolicyTool("Rust license/advisory policy", "cargo install cargo-deny");
}

console.log("\nLocal verification completed.");
