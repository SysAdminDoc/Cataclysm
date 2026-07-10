# Code signing and local release packaging

TsunamiSimulator uses local release builds. GitHub Actions release workflows
were intentionally removed, so signing secrets are not configured in GitHub and
there is no remote release job to trigger.

Before packaging a release, run the local gate from the repo root:

```bash
npm run verify:release
```

Then build the platform bundle locally:

```bash
npm run tauri:build
```

Unsigned bundles remain valid for testing, but Windows SmartScreen and macOS
Gatekeeper may warn. Public release assets should be signed when the maintainer
has the platform credentials available.

## Windows Authenticode

Required local inputs:

| Name | What it holds | How to produce |
|------|---------------|----------------|
| `WIN_SIGN_CERT_BASE64` | Base64-encoded PKCS#12 (`.pfx`) bundle containing the cert and private key. | Obtain a code-signing cert from DigiCert, Sectigo, SSL.com, or equivalent. Export as PFX with key, then encode it as one line. |
| `WIN_SIGN_PASSWORD` | Password unlocking the PFX. | The password set during PFX export. |

After `npm run tauri:build`, sign each generated `.msi` and `.exe` with
`signtool`:

```powershell
signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /a path\to\TsunamiSimulator.msi
signtool verify /pa /v path\to\TsunamiSimulator.msi
```

## macOS notarization

Required local inputs:

| Name | What it holds | How to produce |
|------|---------------|----------------|
| `APPLE_CERTIFICATE_BASE64` | Base64-encoded Developer ID Application `.p12`. | Export the Developer ID Application cert from Keychain Access as a `.p12`, then base64 encode it. |
| `APPLE_CERTIFICATE_PASSWORD` | Password unlocking the `.p12`. | Set during export. |
| `APPLE_SIGNING_IDENTITY` | Identity string recognized by `codesign`, such as `Developer ID Application: SysAdminDoc (TEAM12345)`. | Run `security find-identity -v -p codesigning` on the signing Mac. |
| `APPLE_ID` | Apple ID that owns the Developer Account. | Maintainer's Apple ID email. |
| `APPLE_PASSWORD` | App-specific password. | Generate at https://appleid.apple.com. |
| `APPLE_TEAM_ID` | Apple Developer Team ID. | Apple Developer account membership page. |

Local macOS release flow:

1. Import the certificate into a temporary keychain.
2. Run `npm run tauri:build`.
3. `codesign --force --options runtime --timestamp` each `.app` / `.dmg`.
4. `xcrun notarytool submit ... --wait`.
5. `xcrun stapler staple` the notarized artifact.
6. Delete the temporary keychain.

Verify the result:

```bash
spctl --assess --type execute --verbose path/to/TsunamiSimulator.app
```

## Tauri auto-updater signing

Auto-updater support is not currently shipped. If it is reintroduced, generate a
Tauri 2 Ed25519 signing key locally:

```bash
npx tauri signer generate -w ~/.tauri/tsunami-simulator.key
```

The public key must be committed in `tauri.conf.json` under the updater plugin
configuration, and the private key/password must stay outside the repo. A
release packager can then pass `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in the local environment so `tauri build`
emits `.sig` files beside installers.

## Verifying unsigned installers (SHA256)

Until code-signing certificates are configured, all release installers are
unsigned. Users can verify download integrity against the SHA256 checksums
published on the GitHub Release page.

### Generating checksums (maintainer)

After building, generate a checksum file alongside the installers:

```powershell
# Windows (PowerShell)
Get-FileHash .\TsunamiSimulator_*_x64_en-US.msi, .\TsunamiSimulator_*_x64-setup.exe -Algorithm SHA256 |
    ForEach-Object { "$($_.Hash)  $(Split-Path $_.Path -Leaf)" } |
    Set-Content checksums-sha256.txt
```

Attach `checksums-sha256.txt` to the GitHub Release alongside the installers.

### Verifying checksums (user)

**Windows (PowerShell):**
```powershell
(Get-FileHash .\TsunamiSimulator_0.5.0_x64_en-US.msi -Algorithm SHA256).Hash
# Compare the output to the SHA256 value in checksums-sha256.txt on the release page
```

**Windows (Command Prompt):**
```cmd
certutil -hashfile TsunamiSimulator_0.5.0_x64_en-US.msi SHA256
```

**macOS / Linux:**
```bash
shasum -a 256 TsunamiSimulator_0.5.0_x64_en-US.msi
```

If the hash matches the value on the release page, the file was not tampered
with in transit. This does not prove who built it — only that what you
downloaded matches what the maintainer uploaded. Code signing (above) is the
proper chain-of-trust mechanism once certificates are available.

## Release checklist

1. Confirm version strings match across `package.json`, `src-tauri/Cargo.toml`,
   `src-tauri/tauri.conf.json`, README badge, app chrome, and CHANGELOG.
2. Run `npm run verify:release`.
3. Delete stale bundle outputs under `src-tauri/target/release/bundle/`.
4. Run `npm run tauri:build`.
5. Generate SHA256 checksums for the platform artifacts (see above).
6. Sign the generated platform artifacts when certificates are available.
7. Verify signatures on a clean machine or VM.
8. Create the GitHub Release manually with `gh release create` and attach the
   local artifacts plus `checksums-sha256.txt`.

## Secret leak response

- Revoke the affected platform certificate with the issuer.
- Generate a new Tauri Ed25519 keypair if updater signing is affected.
- Remove leaked material from the local machine, shell history, and release
  assets.
- Cut a new patch release with replacement signatures.
