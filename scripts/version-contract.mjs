const SEMVER_PATTERN = "[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?";
const SEMVER_RE = new RegExp(`^${SEMVER_PATTERN}$`);

function parseJsonDocument(label, text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
  return parsed;
}

function parseJsonVersion(label, text) {
  const parsed = parseJsonDocument(label, text);
  if (typeof parsed?.version !== "string" || parsed.version.length === 0) {
    throw new Error(`${label} does not declare a string version.`);
  }
  return parsed.version;
}

function parsePackageLockVersions(text) {
  const parsed = parseJsonDocument("package-lock.json", text);
  const root = parsed?.version;
  const workspace = parsed?.packages?.[""]?.version;
  if (typeof root !== "string" || root.length === 0) {
    throw new Error("package-lock.json does not declare a root version.");
  }
  if (typeof workspace !== "string" || workspace.length === 0) {
    throw new Error('package-lock.json does not declare packages[""].version.');
  }
  return {
    "package-lock.json root": root,
    'package-lock.json packages[""]': workspace,
  };
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

function parseCargoLockVersion(text) {
  const matchingPackages = [];
  let current = null;
  const finishPackage = () => {
    if (current?.name === "cataclysm") matchingPackages.push(current);
  };

  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\[\[package\]\]\s*$/.test(line)) {
      finishPackage();
      current = {};
      continue;
    }
    if (!current) continue;
    const field = line.match(/^\s*(name|version)\s*=\s*"([^"]+)"\s*$/);
    if (field) current[field[1]] = field[2];
  }
  finishPackage();

  if (matchingPackages.length !== 1 || typeof matchingPackages[0]?.version !== "string") {
    throw new Error(
      `src-tauri/Cargo.lock must contain exactly one versioned package named cataclysm; found ${matchingPackages.length}.`,
    );
  }
  return matchingPackages[0].version;
}

function requireCapture(label, text, expression) {
  const value = text.match(expression)?.[1];
  if (!value) throw new Error(`${label} version marker is missing.`);
  return value;
}

function parseNoticeVersions(text) {
  const versions = {
    "THIRD_PARTY_NOTICES.txt application": requireCapture(
      "THIRD_PARTY_NOTICES.txt Application version",
      text,
      /^Application version:\s*(\S+)\s*$/m,
    ),
  };
  const catalogMatches = [...text.matchAll(/\bcataclysm@([0-9A-Za-z.+-]+)/gi)];
  if (catalogMatches.length === 0) {
    throw new Error("THIRD_PARTY_NOTICES.txt cataclysm catalog version marker is missing.");
  }
  catalogMatches.forEach((match, index) => {
    versions[`THIRD_PARTY_NOTICES.txt cataclysm catalog marker ${index + 1}`] = match[1];
  });
  return versions;
}

function parseEarthAssetVersions(text) {
  const parsed = parseJsonDocument("src/data/earth-assets.json", text);
  if (!Array.isArray(parsed?.assets)) {
    throw new Error("src/data/earth-assets.json does not declare an assets array.");
  }

  const versions = {};
  parsed.assets.forEach((asset, index) => {
    const marker = asset?.version?.package;
    if (typeof marker !== "string" || !/^cataclysm/i.test(marker)) return;
    const match = marker.match(/^cataclysm@(.+)$/i);
    const assetLabel = typeof asset.id === "string" ? asset.id : `assets[${index}]`;
    if (!match) {
      throw new Error(
        `src/data/earth-assets.json ${assetLabel} has a malformed cataclysm package marker: ${marker}`,
      );
    }
    versions[`src/data/earth-assets.json ${assetLabel}`] = match[1];
  });
  if (Object.keys(versions).length === 0) {
    throw new Error("src/data/earth-assets.json has no cataclysm package version markers.");
  }
  return versions;
}

function parseReadmeInstallerVersions(text) {
  const versions = {
    "README.md Windows installer version": requireCapture(
      "README.md Windows installer",
      text,
      new RegExp(`\\bThe v(${SEMVER_PATTERN}) Windows installers\\b`),
    ),
  };
  const examples = [
    ...text.matchAll(new RegExp(`\\bCataclysm_(${SEMVER_PATTERN})_x64_en-US\\.msi\\b`, "g")),
  ];
  if (examples.length === 0) {
    throw new Error("README.md MSI verification example version marker is missing.");
  }
  examples.forEach((match, index) => {
    versions[`README.md MSI verification example ${index + 1}`] = match[1];
  });
  return versions;
}

export function validateVersionContract(sources, options = {}) {
  const versions = {
    "package.json": parseJsonVersion("package.json", sources.packageJson),
    ...parsePackageLockVersions(sources.packageLock),
    "src-tauri/Cargo.toml": parseCargoPackageVersion(sources.cargoToml),
    "src-tauri/Cargo.lock cataclysm package": parseCargoLockVersion(sources.cargoLock),
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
    ...parseReadmeInstallerVersions(sources.readme),
    ...parseNoticeVersions(sources.thirdPartyNotices),
    ...parseEarthAssetVersions(sources.earthAssets),
  };

  const canonical = versions["package.json"];
  if (!SEMVER_RE.test(canonical)) {
    throw new Error(`package.json version is not valid semantic version syntax: ${canonical}`);
  }
  const invalidVersions = Object.entries(versions)
    .filter(([, version]) => !SEMVER_RE.test(version))
    .map(([label, version]) => `${label}=${version}`);
  if (invalidVersions.length > 0) {
    throw new Error(`Version contract contains invalid semantic versions: ${invalidVersions.join(", ")}`);
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
