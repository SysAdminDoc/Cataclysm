const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function parseJson(label, text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function cargoField(text, field) {
  let inPackage = false;
  for (const line of text.split(/\r?\n/)) {
    const section = line.match(/^\s*\[([^\]]+)]\s*$/)?.[1];
    if (section) {
      inPackage = section === "package";
      continue;
    }
    if (!inPackage) continue;
    const value = line.match(new RegExp(`^\\s*${field}\\s*=\\s*"([^"]+)"\\s*$`))?.[1];
    if (value) return value;
  }
  return null;
}

function count(text, fragment) {
  return text.split(fragment).length - 1;
}

export function validateProductTruth(sources) {
  const truth = parseJson("src/data/product-truth.json", sources.productTruth);
  const pkg = parseJson("package.json", sources.packageJson);
  const tauri = parseJson("src-tauri/tauri.conf.json", sources.tauriConfig);
  const failures = [];
  const expect = (label, actual, expected) => {
    if (actual !== expected) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  };
  const requireFragment = (label, text, fragment) => {
    if (!text.includes(fragment)) failures.push(`${label}: missing ${JSON.stringify(fragment)}`);
  };

  expect("schemaVersion", truth.schemaVersion, 1);
  if (!SEMVER_RE.test(truth.release?.version ?? "")) failures.push("release.version must be semantic version syntax");
  if (!Number.isInteger(truth.runtimeFloors?.nodeMajor) || truth.runtimeFloors.nodeMajor < 20) {
    failures.push("runtimeFloors.nodeMajor must be an integer of at least 20");
  }
  if (!/^\d+\.\d+$/.test(truth.runtimeFloors?.rust ?? "")) failures.push("runtimeFloors.rust must be major.minor syntax");
  if (!Number.isInteger(truth.simulation?.defaultPlaybackFrames)
    || truth.simulation.defaultPlaybackFrames < 2
    || truth.simulation.defaultPlaybackFrames > truth.simulation.maximumPlaybackFrames) {
    failures.push("simulation.defaultPlaybackFrames must fit the declared playback bounds");
  }

  expect("package.json name", pkg.name, truth.product?.packageName);
  expect("package.json version", pkg.version, truth.release?.version);
  expect("package.json repository", pkg.repository?.url, truth.release?.repositoryUrl);
  expect("Cargo package name", cargoField(sources.cargoToml, "name"), truth.product?.packageName);
  expect("Cargo package version", cargoField(sources.cargoToml, "version"), truth.release?.version);
  expect("Cargo rust-version", cargoField(sources.cargoToml, "rust-version"), truth.runtimeFloors?.rust);
  expect("browser WASM package version", cargoField(sources.wasmCargoToml, "version"), truth.release?.version);
  expect("browser WASM rust-version", cargoField(sources.wasmCargoToml, "rust-version"), truth.runtimeFloors?.rust);
  expect("Tauri productName", tauri.productName, truth.product?.name);
  expect("Tauri version", tauri.version, truth.release?.version);
  expect("Tauri identifier", tauri.identifier, truth.product?.identifier);

  requireFragment("model provenance", sources.modelProvenance, 'from "../data/product-truth.json"');
  requireFragment("model provenance", sources.modelProvenance, "PRODUCT_TRUTH.release.version");
  requireFragment("globe styles", sources.globeStyles, "PRODUCT_TRUTH.globe.defaultStyleId");
  requireFragment("globe styles", sources.globeStyles, "PRODUCT_TRUTH.globe.offlineStyleId");
  requireFragment("SWE playback", sources.swePlayback, "PRODUCT_TRUTH.simulation.defaultPlaybackFrames");
  requireFragment("onboarding tour", sources.tour, "PRODUCT_TRUTH.simulation.defaultPlaybackFrames");
  if (count(sources.i18n, "{frames}") !== 4) failures.push("i18n: every supported locale must derive the onboarding frame count");

  const currentDocs = sources.currentDocs ?? {};
  for (const [label, text] of Object.entries(currentDocs)) {
    const legacyScanText = text.split(/\r?\n/)
      .filter((line) => !/\bformer(?:ly)?\b/i.test(line))
      .join("\n");
    for (const legacyName of truth.product?.legacyNames ?? []) {
      if (legacyScanText.includes(legacyName)) failures.push(`${label}: stale product name ${JSON.stringify(legacyName)}`);
    }
    if (/SysAdminDoc\/TsunamiSimulator/i.test(text)) failures.push(`${label}: stale repository URL`);
    if (/\b24\s+(?:time\s+)?snapshots?\b/i.test(text)) failures.push(`${label}: stale 24-snapshot product claim`);
  }

  const contributing = currentDocs["CONTRIBUTING.md"] ?? "";
  requireFragment("CONTRIBUTING.md", contributing, truth.product.name);
  requireFragment("CONTRIBUTING.md", contributing, truth.release.repositoryUrl);
  if (!new RegExp(`Node\\.js\\s*[≥>=]+\\s*${truth.runtimeFloors.nodeMajor}\\b`).test(contributing)) {
    failures.push("CONTRIBUTING.md: Node runtime floor does not match product truth");
  }
  if (!new RegExp(`Rust stable\\s*[≥>=]+\\s*${truth.runtimeFloors.rust.replace(".", "\\.")}\\b`).test(contributing)) {
    failures.push("CONTRIBUTING.md: Rust runtime floor does not match product truth");
  }

  const readme = currentDocs["README.md"] ?? "";
  requireFragment("README.md", readme, truth.globe.defaultStyleLabel);
  requireFragment("README.md", readme, truth.globe.offlineStyleLabel);
  requireFragment("README.md", readme, truth.release.releasesUrl);

  const security = currentDocs["SECURITY.md"] ?? "";
  requireFragment("SECURITY.md", security, truth.release.supportedSeries);
  requireFragment("SECURITY.md", security, truth.release.securityAdvisoryUrl);

  const gettingStarted = currentDocs["docs/manual/getting-started.md"] ?? "";
  requireFragment("docs/manual/getting-started.md", gettingStarted, truth.release.releasesUrl);
  requireFragment("docs/manual/getting-started.md", gettingStarted, `${truth.simulation.defaultPlaybackFrames} snapshots`);
  requireFragment("docs/manual/custom-scenarios.md", currentDocs["docs/manual/custom-scenarios.md"] ?? "", `${truth.simulation.defaultPlaybackFrames} time snapshots`);

  if (truth.release?.artifactPolicy !== "unsigned-sha256") failures.push("release.artifactPolicy must remain unsigned-sha256");
  const releaseGuide = currentDocs["docs/release/UNSIGNED_RELEASES.md"] ?? "";
  requireFragment("docs/release/UNSIGNED_RELEASES.md", releaseGuide, "intentionally ships unsigned");
  requireFragment("docs/release/UNSIGNED_RELEASES.md", releaseGuide, "SHA-256");
  if (/signtool\s+sign|codesign\s+--|notarytool|WIN_SIGN_|APPLE_(?:CERTIFICATE|SIGNING|PASSWORD)/i.test(releaseGuide)) {
    failures.push("docs/release/UNSIGNED_RELEASES.md: platform signing guidance is forbidden by release policy");
  }

  const blocked = sources.blockedRoadmap ?? "";
  const retiredLedgerMarkers = [
    "F-V04", "Azure Artifact Signing", "F-V06", "Phase 5 — Boussinesq",
    "Population casualty overlay", "Signed Windows installer", "winget search TsunamiSimulator",
    "tauri-plugin-updater",
  ];
  for (const marker of retiredLedgerMarkers) {
    if (blocked.includes(marker)) failures.push(`Roadmap_Blocked.md: retired or duplicate ledger marker remains: ${marker}`);
  }

  if (failures.length > 0) throw new Error(failures.join("\n"));
  return truth;
}
