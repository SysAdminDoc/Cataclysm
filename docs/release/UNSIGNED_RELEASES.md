# Unsigned releases and artifact integrity

Cataclysm intentionally ships unsigned. Release artifacts are built locally,
never sent to a remote build service, and published with SHA-256 digests so a
download can be checked byte-for-byte against the maintainer's release record.
Windows and macOS may show an unknown-publisher warning; that is expected and is
not treated as a missing release step.

## Build the release

From the repository root:

```bash
npm run tauri:build
```

The command runs the strict verification gate, clears stale bundle output,
checks the supported Rust feature matrix, builds with GPU support, smoke-tests
the packaged application, and writes
`src-tauri/target/release/bundle/cataclysm-build-manifest.json`. The manifest
records the enabled Cargo features, runtime GPU probe, artifact paths, sizes,
and SHA-256 digests.

## Verify a downloaded artifact

Every published release includes `checksums-sha256.txt`. Compare the downloaded
file's digest with the matching line in that release asset.

PowerShell:

```powershell
(Get-FileHash .\Cataclysm_0.12.0_x64_en-US.msi -Algorithm SHA256).Hash
```

Command Prompt:

```cmd
certutil -hashfile Cataclysm_0.12.0_x64_en-US.msi SHA256
```

macOS or Linux:

```bash
shasum -a 256 Cataclysm_0.12.0_amd64.AppImage
```

A matching digest proves that the downloaded bytes match the published release
asset. It does not create an operating-system publisher identity; Cataclysm's
release policy deliberately relies on transparent source, local reproducible
builds, the generated build manifest, and published checksums.

## Maintainer release checklist

1. Reconcile product facts with `src/data/product-truth.json` and run
   `npm run verify:product-truth`.
2. Run `npm run tauri:build` on the target platform.
3. Confirm `cataclysm-build-manifest.json` reports the intended Cargo features,
   runtime GPU probe, and SHA-256 digest for every artifact.
4. Produce `checksums-sha256.txt` from those manifest digests.
5. Smoke-test the packaged application on a clean machine or VM.
6. Create the GitHub Release manually and attach the local artifacts, build
   manifest, and checksum file.

Do not add platform credentials, private keys, remote release workflows, or a
publisher-identity step to this process.
