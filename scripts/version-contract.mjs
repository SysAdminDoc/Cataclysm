const SEMVER_PATTERN = "[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?";
const SEMVER_RE = new RegExp(`^${SEMVER_PATTERN}$`);

function parseJsonVersion(label, text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error(`${label} does not declare a string version.`);
  }
  return parsed.version;
}

function parseCargoPackageVersion(text) {
  let inPackage = false;
  for (const line of text.split(/\r?\n/)) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*$/)?.[1];
    if (section) {
      inPackage = section === "package";
      continue;
    }
    if (!inPackage) continue;
    const version = line.match(/^\s*version\s*=\s*"([^"]+)"\s*$/)?.[1];
    if (version) return version;
  }
  throw new Error("src-tauri/Cargo.toml does not declare [package].version.");
}

function requireCapture(label, text, expression) {
  const value = text.match(expression)?.[1];
  if (!value) throw new Error(`${label} version marker is missing.`);
  return value;
}

export function validateVersionContract(sources, options = {}) {
  const versions = {
    "package.json": parseJsonVersion("package.json", sources.packageJson),
    "src-tauri/Cargo.toml": parseCargoPackageVersion(sources.cargoToml),
    "src-tauri/tauri.conf.json": parseJsonVersion(
      "src-tauri/tauri.conf.json",
      sources.tauriConfig,
    ),
    "src/lib/model-provenance.ts": requireCapture(
      "src/lib/model-provenance.ts APP_VERSION",
      sources.modelProvenance,
      new RegExp(`\\bAPP_VERSION\\s*=\\s*["'](${SEMVER_PATTERN})["']`),
    ),
    "README.md version badge": requireCapture(
      "README.md version badge",
      sources.readme,
      new RegExp(`img\\.shields\\.io/badge/version-(${SEMVER_PATTERN})-`),
    ),
    "README.md migration status": requireCapture(
      "README.md migration status",
      sources.readme,
      new RegExp(`\\*\\*Migration status \\(v(${SEMVER_PATTERN})\\):\\*\\*`),
    ),
  };

  const canonical = versions["package.json"];
  if (!SEMVER_RE.test(canonical)) {
    throw new Error(`package.json version is not valid semantic version syntax: ${canonical}`);
  }
  const mismatches = Object.entries(versions)
    .filter(([, version]) => version !== canonical)
    .map(([label, version]) => `${label}=${version}`);
  if (mismatches.length > 0) {
    throw new Error(
      `Version contract mismatch; expected ${canonical} from package.json: ${mismatches.join(", ")}`,
    );
  }

  const gitRefName = options.gitRefName?.trim();
  const gitRefType = options.gitRefType?.trim();
  const isVersionTag = gitRefType === "tag" || /^v[0-9]+\.[0-9]+\.[0-9]+/.test(gitRefName ?? "");
  if (isVersionTag && gitRefName !== `v${canonical}`) {
    throw new Error(
      `Tag/version mismatch; GITHUB_REF_NAME=${gitRefName || "<missing>"}, expected v${canonical}.`,
    );
  }

  return { version: canonical, versions, tag: isVersionTag ? gitRefName : null };
}
