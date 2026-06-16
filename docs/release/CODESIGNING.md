# Code signing + auto-updater secrets

This document describes the GitHub Actions secrets that unlock the
conditional signing + auto-updater paths added to
[`release.yml`](../../.github/workflows/release.yml) in v0.4.0. Until
the maintainer adds these secrets, the release workflow ships
**unsigned** installers (which prompt SmartScreen on Windows and
Gatekeeper on macOS) and does **not** publish a Tauri update manifest.

All secret slots are documented here so the next person to land the
maintainer-side work has everything in one place.

## Windows Authenticode (F-V04)

| Secret name | What it holds | How to produce |
|-------------|---------------|----------------|
| `WIN_SIGN_CERT_BASE64` | Base64-encoded PKCS#12 (`.pfx`) bundle containing the cert + private key. | Obtain a Code Signing Cert from DigiCert / Sectigo / SSL.com. Export as PFX with key (`certutil -p <password> -export ...`). Encode: `base64 -w0 cert.pfx`. Paste the single-line output into the secret. |
| `WIN_SIGN_PASSWORD` | Password unlocking the PFX. | The password you set during PFX export. |

The release workflow signs every `.msi` and `.exe` produced by the
Windows bundle with `signtool sign /fd SHA256 /tr
http://timestamp.digicert.com /td SHA256`. The timestamp server is
documented by Microsoft; alternative timestamp URLs (Sectigo, GlobalSign,
Apple) work too.

Verify post-release: `signtool verify /pa /v <path-to-msi>`.

## macOS Notarisation (F-V04)

| Secret name | What it holds | How to produce |
|-------------|---------------|----------------|
| `APPLE_CERTIFICATE_BASE64` | Base64-encoded Developer ID Application `.p12`. | Export the Developer ID Application cert from Keychain Access as a `.p12` (with private key). `base64 -i cert.p12 -o cert.p12.b64` and paste. |
| `APPLE_CERTIFICATE_PASSWORD` | Password unlocking the `.p12`. | Set during export. |
| `APPLE_SIGNING_IDENTITY` | Identity string `codesign` recognises, e.g. `Developer ID Application: SysAdminDoc (TEAM12345)`. | Run `security find-identity -v -p codesigning` on a Mac with the cert installed. |
| `APPLE_ID` | Apple ID that owns the Developer Account. | Maintainer's Apple ID email. |
| `APPLE_PASSWORD` | App-specific password (not the Apple ID password). | Generate at https://appleid.apple.com → Sign-In → App-Specific Passwords. |
| `APPLE_TEAM_ID` | Apple Developer Team ID. | https://developer.apple.com/account → Membership → Team ID. |

The release workflow:
1. Imports the cert into a temporary keychain.
2. `codesign --force --options runtime --timestamp` each `.dmg`.
3. `xcrun notarytool submit ... --wait` (typically completes in 2–10 min).
4. `xcrun stapler staple` the notarisation ticket.
5. Deletes the temporary keychain.

Verify post-release: `spctl --assess --type execute --verbose <path-to-app>`.

## Tauri auto-updater Ed25519 signing (F-V07)

| Secret name | What it holds | How to produce |
|-------------|---------------|----------------|
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri 2 update-manifest signer's private key. | `npx tauri signer generate -w ~/.tauri/myapp.key`. Paste the contents of `~/.tauri/myapp.key` into the secret. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password protecting the private key. | Set during `tauri signer generate`. |

After generating the keypair, the **public** key (from
`~/.tauri/myapp.key.pub`) must be pasted into `tauri.conf.json` at
`plugins.updater.pubkey` and the plugin must be registered in
`src-tauri/src/lib.rs`:

```rust
.plugin(tauri_plugin_updater::Builder::new().build())
```

…with `tauri-plugin-updater` in `src-tauri/Cargo.toml`. The
`release.yml` `TAURI_SIGNING_PRIVATE_KEY` env-var is consumed
automatically by `tauri build` when set, which then emits a `.sig`
file alongside each installer. A separate post-release step builds
`latest.json` referencing the signatures + the release URLs — see
the Tauri 2 docs: https://v2.tauri.app/plugin/updater/

## Operational notes

- **None of these secrets are required** for the release workflow to
  complete. Each signing block is gated by `if: env.X != ''` so the
  unsigned path keeps working until the secrets land.
- **Test on a feature branch first.** Sign a v0.4.0-test release,
  install on a clean Win 11 + macOS 13 VM, confirm no warnings.
- **Rotation cadence**: EV cert renews annually. Apple Developer
  membership renews annually. Tauri Ed25519 key can stay indefinite
  (rotate only on compromise).
- **Secret leak response**: revoke the cert with the issuer; generate
  a new Tauri Ed25519 keypair + bump the `pubkey` in
  `tauri.conf.json`; cut a new patch release.
