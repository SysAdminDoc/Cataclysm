import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "public", "physics", "manifest.json");
const wasmPath = path.join(root, "public", "physics", "cataclysm_browser_physics.wasm");
const builtWasmPath = path.join(
  root,
  "src-tauri",
  "wasm",
  "target",
  "wasm32-unknown-unknown",
  "release",
  "cataclysm_browser_physics.wasm",
);
const sourcePaths = [
  "src-tauri/wasm/Cargo.toml",
  "src-tauri/wasm/Cargo.lock",
  "src-tauri/wasm/src/lib.rs",
  "src-tauri/src/physics/mod.rs",
  "src-tauri/src/physics/constants.rs",
  "src-tauri/src/physics/asteroid.rs",
  "src-tauri/src/physics/nuclear.rs",
  "src-tauri/src/physics/landslide.rs",
  "src-tauri/src/physics/earthquake.rs",
  "src-tauri/src/physics/okada.rs",
  "src-tauri/src/physics/screening.rs",
  "src-tauri/src/physics/shallow_water.rs",
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sourceDigest() {
  const hash = createHash("sha256");
  for (const relativePath of sourcePaths) {
    hash.update(`${relativePath}\0`);
    hash.update(readFileSync(path.join(root, relativePath)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function inspectWasm() {
  const bytes = readFileSync(wasmPath);
  if (!bytes.subarray(0, 4).equals(Buffer.from([0x00, 0x61, 0x73, 0x6d]))) {
    throw new Error("browser physics asset does not have the WebAssembly magic header");
  }
  return {
    wasm_sha256: sha256(bytes),
    wasm_bytes: bytes.byteLength,
  };
}

function build() {
  const cargo = process.env.CARGO || "cargo";
  const result = spawnSync(
    cargo,
    [
      "build",
      "--manifest-path",
      "src-tauri/wasm/Cargo.toml",
      "--target",
      "wasm32-unknown-unknown",
      "--release",
      "--locked",
    ],
    { cwd: root, encoding: "utf8", stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  mkdirSync(path.dirname(wasmPath), { recursive: true });
  copyFileSync(builtWasmPath, wasmPath);
  const manifest = {
    schema_version: 1,
    abi_version: 1,
    rust_version: "1.96.0",
    source_sha256: sourceDigest(),
    ...inspectWasm(),
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function check() {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const expectedSource = sourceDigest();
  const actualWasm = inspectWasm();
  if (manifest.schema_version !== 1 || manifest.abi_version !== 1) {
    throw new Error("browser physics manifest uses an unsupported schema or ABI");
  }
  if (manifest.source_sha256 !== expectedSource) {
    throw new Error(
      "browser physics source changed without rebuilding the WASM asset; run npm run build:physics",
    );
  }
  if (
    manifest.wasm_sha256 !== actualWasm.wasm_sha256 ||
    manifest.wasm_bytes !== actualWasm.wasm_bytes
  ) {
    throw new Error("browser physics WASM does not match its checked-in manifest");
  }
  console.log(
    `Browser physics WASM verified (${actualWasm.wasm_bytes} bytes, ${actualWasm.wasm_sha256.slice(0, 12)}…).`,
  );
}

if (process.argv.includes("--build")) build();
check();
