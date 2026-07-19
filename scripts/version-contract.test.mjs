import assert from "node:assert/strict";
import test from "node:test";

import { validateVersionContract } from "./version-contract.mjs";

function sources(version = "1.2.3") {
  return {
    packageJson: JSON.stringify({ version }),
    packageLock: JSON.stringify({
      name: "cataclysm",
      version,
      packages: { "": { name: "cataclysm", version } },
    }),
    cargoToml: `[package]\nname = "cataclysm"\nversion = "${version}"\n\n[dependencies]\n`,
    cargoLock:
      `[[package]]\nname = "cataclysm"\nversion = "${version}"\n\n` +
      `[[package]]\nname = "dependency"\nversion = "9.9.9"\n`,
    wasmCargoToml: `[package]\nname = "cataclysm-browser-physics"\nversion = "${version}"\n`,
    wasmCargoLock: `[[package]]\nname = "cataclysm-browser-physics"\nversion = "${version}"\n`,
    tauriConfig: JSON.stringify({ productName: "Cataclysm", version }),
    productTruth: JSON.stringify({ release: { version } }),
    modelProvenance:
      'import PRODUCT_TRUTH from "../data/product-truth.json";\n' +
      "export const APP_VERSION = PRODUCT_TRUTH.release.version;",
    readme:
      `[![Version](https://img.shields.io/badge/version-${version}-blue.svg)](./CHANGELOG.md)\n` +
      `> **Migration status (v${version}):** Current source capabilities.\n` +
      `The v${version} Windows installers are unsigned.\n` +
      `Get-FileHash .\\Cataclysm_${version}_x64_en-US.msi\n` +
      `certutil -hashfile Cataclysm_${version}_x64_en-US.msi SHA256\n`,
    thirdPartyNotices:
      `Application version: ${version}\n\ncataclysm@${version}\n\n` +
      `Applies to: cataclysm@${version}, dependency@9.9.9\n`,
    earthAssets: JSON.stringify({
      assets: [
        { id: "generated-depth", version: { package: `cataclysm@${version}` } },
        { id: "generated-mask", version: { package: `cataclysm@${version}` } },
        { id: "upstream", version: { package: "cesium@9.9.9" } },
      ],
    }),
  };
}

test("version contract accepts matching manifests, runtime, and README markers", () => {
  const result = validateVersionContract(sources());
  assert.equal(result.version, "1.2.3");
  assert.equal(result.tag, null);
  assert.equal(result.versions['package-lock.json packages[""]'], "1.2.3");
  assert.equal(result.versions["src-tauri/Cargo.lock cataclysm package"], "1.2.3");
  assert.equal(result.versions["src/data/earth-assets.json generated-mask"], "1.2.3");
});

test("version contract reports source mismatches against package.json", () => {
  const fixture = sources();
  fixture.productTruth = JSON.stringify({ release: { version: "1.2.4" } });
  assert.throws(
    () => validateVersionContract(fixture),
    /Version contract mismatch; expected 1\.2\.3[\s\S]*product-truth\.json=1\.2\.4/,
  );
});

test("version contract requires runtime provenance to derive from product truth", () => {
  const fixture = sources();
  fixture.modelProvenance = 'export const APP_VERSION = "1.2.3";';
  assert.throws(
    () => validateVersionContract(fixture),
    /model-provenance\.ts must derive APP_VERSION from src\/data\/product-truth\.json/,
  );
});

test("version contract requires both README current-source markers", () => {
  const fixture = sources();
  fixture.readme = fixture.readme.replace(/^> \*\*Migration status.*\n/m, "");
  assert.throws(
    () => validateVersionContract(fixture),
    /README\.md migration status version marker is missing/,
  );
});

test("version contract catches every app-owned release mirror", () => {
  const cases = [
    [
      "package-lock root",
      (fixture) => { fixture.packageLock = fixture.packageLock.replace('"version":"1.2.3"', '"version":"1.2.4"'); },
      /package-lock\.json root=1\.2\.4/,
    ],
    [
      "package-lock workspace",
      (fixture) => {
        const lock = JSON.parse(fixture.packageLock);
        lock.packages[""].version = "1.2.4";
        fixture.packageLock = JSON.stringify(lock);
      },
      /package-lock\.json packages\[""\]=1\.2\.4/,
    ],
    [
      "Cargo.lock application package",
      (fixture) => { fixture.cargoLock = fixture.cargoLock.replace('version = "1.2.3"', 'version = "1.2.4"'); },
      /Cargo\.lock cataclysm package=1\.2\.4/,
    ],
    [
      "browser WASM Cargo.lock application package",
      (fixture) => { fixture.wasmCargoLock = fixture.wasmCargoLock.replace('version = "1.2.3"', 'version = "1.2.4"'); },
      /wasm\/Cargo\.lock browser package=1\.2\.4/,
    ],
    [
      "notices application header",
      (fixture) => { fixture.thirdPartyNotices = fixture.thirdPartyNotices.replace("Application version: 1.2.3", "Application version: 1.2.4"); },
      /THIRD_PARTY_NOTICES\.txt application=1\.2\.4/,
    ],
    [
      "notices catalog",
      (fixture) => { fixture.thirdPartyNotices = fixture.thirdPartyNotices.replace("cataclysm@1.2.3", "cataclysm@1.2.4"); },
      /THIRD_PARTY_NOTICES\.txt cataclysm catalog marker 1=1\.2\.4/,
    ],
    [
      "earth asset marker",
      (fixture) => {
        const assets = JSON.parse(fixture.earthAssets);
        assets.assets[1].version.package = "cataclysm@1.2.4";
        fixture.earthAssets = JSON.stringify(assets);
      },
      /src\/data\/earth-assets\.json generated-mask=1\.2\.4/,
    ],
    [
      "README installer availability",
      (fixture) => { fixture.readme = fixture.readme.replace("The v1.2.3 Windows", "The v1.2.4 Windows"); },
      /README\.md Windows installer version=1\.2\.4/,
    ],
    [
      "README verification example",
      (fixture) => { fixture.readme = fixture.readme.replace("Cataclysm_1.2.3", "Cataclysm_1.2.4"); },
      /README\.md MSI verification example 1=1\.2\.4/,
    ],
  ];

  for (const [label, mutate, expected] of cases) {
    const fixture = sources();
    mutate(fixture);
    assert.throws(() => validateVersionContract(fixture), expected, label);
  }
});

test("version contract enforces version tags but ignores branch refs", () => {
  assert.equal(
    validateVersionContract(sources(), { gitRefName: "v1.2.3", gitRefType: "tag" }).tag,
    "v1.2.3",
  );
  assert.throws(
    () => validateVersionContract(sources(), { gitRefName: "v1.2.2", gitRefType: "tag" }),
    /Tag\/version mismatch[\s\S]*expected v1\.2\.3/,
  );
  assert.equal(
    validateVersionContract(sources(), { gitRefName: "main", gitRefType: "branch" }).tag,
    null,
  );
});

test("version contract rejects malformed and incomplete sources", () => {
  assert.throws(
    () => validateVersionContract({ ...sources(), packageJson: "not-json" }),
    /package\.json is not valid JSON/,
  );
  assert.throws(
    () => validateVersionContract({ ...sources(), cargoToml: "[dependencies]\nfoo = '1'" }),
    /does not declare \[package\]\.version/,
  );
});
