// Citation metadata contract gate.
//
// Validates that CITATION.cff is a well-formed CFF 1.2 record whose version and
// license stay in lock-step with package.json, so the "Cite this repository"
// control GitHub renders never drifts from the shipped product. `date-released`
// is optional and, when present, must be a real release date (ISO `YYYY-MM-DD`);
// the strict release path additionally requires a matching `v<version>` git tag.
//
// Usage:
//   node scripts/citation-contract.mjs [--check] [--strict] [path/to/CITATION.cff]

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO_SLUG = "SysAdminDoc/Cataclysm";
const REQUIRED_SCALARS = ["message", "title", "version", "repository-code", "license", "type"];

/** Read a top-level (non-indented) scalar field from a CFF document. */
function readScalar(text, key) {
  const match = text.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m"));
  if (!match) return null;
  return match[1].replace(/^["']|["']$/g, "").trim();
}

/**
 * Validate a CITATION.cff against package.json. Returns { ok, failures }.
 * `git` is only consulted in strict mode to cross-check date-released.
 */
export function validateCitationFile(cffPath, pkgPath, { strict = false } = {}) {
  const failures = [];
  if (!existsSync(cffPath)) {
    return { ok: false, failures: [`${cffPath} is missing`] };
  }
  if (!existsSync(pkgPath)) {
    return { ok: false, failures: [`${pkgPath} is missing`] };
  }
  const text = readFileSync(cffPath, "utf8");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

  const cffVersion = readScalar(text, "cff-version");
  if (!cffVersion || !cffVersion.startsWith("1.2")) {
    failures.push(`cff-version must be 1.2.x (got ${cffVersion ?? "none"})`);
  }
  for (const key of REQUIRED_SCALARS) {
    if (!readScalar(text, key)) failures.push(`missing required field: ${key}`);
  }
  if (!/^authors:/m.test(text)) failures.push("missing authors list");
  if (!/^preferred-citation:/m.test(text)) failures.push("missing preferred-citation block");

  const version = readScalar(text, "version");
  if (version && version !== pkg.version) {
    failures.push(`version ${version} does not match package.json ${pkg.version}`);
  }
  const license = readScalar(text, "license");
  if (license && pkg.license && license !== pkg.license) {
    failures.push(`license ${license} does not match package.json ${pkg.license}`);
  }
  const repo = readScalar(text, "repository-code");
  if (repo && !repo.includes(REPO_SLUG)) {
    failures.push(`repository-code ${repo} does not reference ${REPO_SLUG}`);
  }

  const dateReleased = readScalar(text, "date-released");
  if (dateReleased) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateReleased)) {
      failures.push(`date-released ${dateReleased} is not an ISO YYYY-MM-DD date`);
    } else if (strict && version) {
      const tag = `v${version}`;
      const tagDate = spawnSync("git", ["log", "-1", "--format=%cs", tag], {
        cwd: dirname(cffPath),
        encoding: "utf8",
      });
      if (tagDate.status !== 0) {
        failures.push(`date-released is set but no release tag ${tag} exists`);
      } else if (tagDate.stdout.trim() !== dateReleased) {
        failures.push(
          `date-released ${dateReleased} does not match tag ${tag} date ${tagDate.stdout.trim()}`,
        );
      }
    }
  }

  return { ok: failures.length === 0, failures };
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("citation-contract.mjs");
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const pathArg = args.find((a) => !a.startsWith("--"));
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const cffPath = pathArg ?? join(root, "CITATION.cff");
  const pkgPath = join(root, "package.json");
  const { ok, failures } = validateCitationFile(cffPath, pkgPath, { strict });
  if (!ok) {
    console.error("CITATION.cff contract failed:");
    for (const f of failures) console.error(`- ${f}`);
    process.exit(1);
  }
  console.log("CITATION.cff contract OK.");
}
