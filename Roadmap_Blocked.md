# TsunamiSimulator — Blocked Roadmap Items

Items moved here from ROADMAP.md because they depend on external
resources, secrets, or decisions that only the maintainer can provide.
Return them to ROADMAP.md once the blocker is resolved.

---

## Phase 3 — Trust / release / supply chain

- **F-V04 P0** — Code signing (Win Authenticode + macOS notarisation).
  *Workflow scaffolded conditional on `WIN_SIGN_CERT_BASE64` / `APPLE_*` secrets being present (no-op when missing); `docs/release/CODESIGNING.md` documents the 8 secret slots.*
  **Blocker:** Needs maintainer EV cert + Apple Developer enrollment.

- **F-V07 P1** — `tauri-plugin-updater` Ed25519-signed channel.
  *Release workflow now emits `latest.json` updater manifest conditional on `TAURI_SIGNING_PRIVATE_KEY` being present.*
  **Blocker:** Needs maintainer to run `npx tauri signer generate`, paste private key as GH secret, paste public key into `tauri.conf.json`, and register the plugin in `src-tauri/src/lib.rs` (steps documented in `docs/release/CODESIGNING.md`).

- **I-V04 P1** — Cesium token via OS keychain (Win Credential Manager / macOS Keychain / Linux Secret Service).
  **Blocker:** Needs `keyring`-crate-equivalent that is Tauri-2 compatible; the `tauri-plugin-keyring` ecosystem is still emerging.

## Phase 3 — Science-frontier

- **F-V06 P1** — Real GEBCO 2024 bathymetry via first-run download wizard.
  **Blocker:** Needs decision on distribution channel (GitHub Release vs Cloudflare R2) and a built `gebco_2024_30s.zstd` artifact (~440 MB).

## Phase 4

- **F4-04 P1** — Real flood polygons (marching-squares on `h + η > 0`) as GeoJSON overlays.
  **Blocker:** Depends on F-V06 GEBCO. First-order inundation discs (I-V02) shipped in v0.3.0.

## Phase 5 — Boussinesq + AMR (v0.5.0)

**DoD**: Chicxulub simulation matches Range et al. 2022 AGU Advances wave heights to within 25% at the named coastal sample points.

- Boussinesq dispersive terms — critical for impact-tsunami short wavelengths where `ω √(h/g) > 0.3`.
  **Blocker:** Research-grade implementation; requires significant solver architecture work.

- Adaptive mesh refinement (AMR) — coarse far-field, fine coastal patches.
  **Blocker:** Research-grade implementation; requires solver restructuring.

- Validation harness comparing to published peer-reviewed simulations (extends F-V01).
  **Blocker:** Depends on Boussinesq solver.

## Phase 6 — Release

- Signed Windows installer + macOS .dmg + Linux AppImage via GitHub Actions (replaces F-V04).
  **Blocker:** Depends on F-V04 code signing activation.

## Research-Driven — P1 Reliability

- **P1** — GEBCO 2024 progressive bathymetry loader (XL).
  **Blocker:** Same as F-V06; needs distribution channel decision + artifact.

## Research-Driven — P3 Future

- **P3** — NTHMP benchmark suite integration (XL).
  **Blocker:** Research-grade; requires NTHMP benchmark data acquisition + significant solver work.

- **P3** — Volcanic caldera collapse source model (L).
  **Blocker:** Requires Maeno & Imamura 2011 implementation + Krakatoa preset conversion. Significant physics research needed.

- **P3** — NetCDF output export for interoperability (M).
  **Blocker:** Requires `netcdf` crate which depends on `netcdf-sys` → `libnetcdf` (C library) + CMake at build time. The C dependency complicates cross-platform CI and local builds. Consider a pure-Rust alternative or bundling libnetcdf as a static lib.
