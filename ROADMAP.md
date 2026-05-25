# TsunamiSimulator Roadmap

Single source of truth for delivery. Phased plan; each phase ends with a working, demoable artifact. Items checked off here are *verified shipped* (in code, in tests, in CI). For evidence-backed prioritisation rationale, file paths, acceptance criteria, and verification commands per item, see [`RESEARCH_FEATURE_PLAN_v0.3.0.md`](./RESEARCH_FEATURE_PLAN_v0.3.0.md). The earlier [`RESEARCH_FEATURE_PLAN.md`](./RESEARCH_FEATURE_PLAN.md) (v0.0.1 baseline) retains the competitive-landscape research.

---

## Phase 0 — Scaffold ✅ (v0.0.1 — 2026-05-24)

- [x] Repo skeleton, LICENSE, README, CHANGELOG, ROADMAP
- [x] Tauri 2 + React 19 + Vite + TypeScript frontend boots
- [x] Rust backend compiles with physics modules numerically correct
- [x] Preset registry populated with peer-reviewed parameters
- [x] Catppuccin Mocha theme tokens
- [x] Cesium ion token plumbing via `.env`

## Phase 1 — Globe + Initial Conditions ✅ (v0.1.0 — 2026-05-25)

- [x] CesiumJS globe mounted in React with terrain provider
- [x] Camera fly-to on preset / scenario coordinates (range clamped 0.5 Mm – 8 Mm)
- [x] Initial water-surface displacement rendered as 3D cylinder + surface ring
- [x] `physics::*::initial_conditions()` invoked from frontend via `tauri::invoke`
- [x] Scenario builder: tabbed Asteroid / Nuclear / Earthquake / Landslide; click-globe-to-pick
- [x] Preset selector with 11 events (incl. Krakatoa); speculative ⚠ flag
- [x] Results panel: cavity radius, energy (J + Mt TNT), seismic-equivalent Mw, peak amplitude
- [x] Settings modal: Cesium ion token + theme; first-run disclaimer; citations modal
- [x] CI/CD pipeline (3-OS matrix); release workflow with `workflow_dispatch`; Dependabot; `cargo-audit`

## Phase 2 — Linear Long-Wave Propagation ✅ (v0.2.0 — 2026-05-25)

- [x] Regular lat-lon grid in Rust with `rayon::par_chunks_mut` leapfrog
- [x] Linear long-wave dispersion `c = √(gh)` using local bathymetry `h`
- [x] CFL-safe Δt via `recommended_dt_s(cfl)`
- [x] Snapshot fields serialised as base64 PNG + bbox; rendered as Cesium imagery layer
- [x] Per-snapshot scrubber in `SwePlayback` (Play/Pause + diagnostics readout)
- [x] Coastal-runup overlay (F6) computes Synolakis 1987 runup at 60+ named coastal points
- [x] DART buoy historical overlay (F8) compares model vs. observed
- [x] Side-by-side comparison mode (F7) runs two scenarios with synchronised timeline
- [x] Multi-globe-style selector — OSM default no-token, Esri Imagery, Natural Earth, Cesium World Imagery + Bathymetry
- [x] App fully usable without any Cesium ion token

## Phase 2.1 — Hot-fix + hardening ✅ (v0.2.1 — 2026-05-25)

- [x] **CRITICAL** — fix blank-globe on Run simulation (Cesium 1.124 `SingleTileImageryProvider.fromUrl` async factory)
- [x] IPC validation: every `*_initial_conditions` returns `Result`, finite + range guards
- [x] NaN-safe `synolakis_runup_m`; finite guard on `solver::run_simulation`
- [x] Defensive Cesium Rectangle clamp + surgical base-layer removal so overlays survive style swaps
- [x] External anchors carry `target=_blank rel=noopener noreferrer`
- [x] Tests: presets uniqueness + finite outputs; commands validation guards + haversine edges
- [x] Accessibility: global `:focus-visible` ring; `:disabled` button treatment; `<noscript>` fallback
- [x] No-FOUC theme bootstrap in `index.html`
- [x] Drop unused deps: `zustand`, `@types/cesium`, `ndarray`
- [x] Docs sync: README v0.2.x, SECURITY supported-versions, CONTRIBUTING no-token default

---

## Phase 3 — Credibility + reach (v0.3.0)

**DoD**: solver passes Stoker dam-break ±5% + Carrier-Greenspan ±10% + Range 2022 Chicxulub OOM; Tōhoku/Sumatra Okada within 50% of observed; signed installers; in-app updater; MP4 export.

### Quick wins (S, low-risk)

- [x] **I-V03 P1** — `cargo audit` fail-on-vuln (drop `|| true` from `ci.yml`).
- [x] **I-V05 P2** — Bump CI/release Actions to v5 (`checkout`/`setup-node`/`upload-artifact`/`download-artifact`) + Node 22.
- [x] **I-V06 P2** — `@media (prefers-reduced-motion: reduce)` overrides; Cesium flyTo duration tunable.
- [x] **I-V07 P2** — `role="status" aria-live="polite"` regions on SwePlayback error + runup transitions.
- [x] **I-V09 P3** — Runup-bar hover labels: arrival + amplitude.
- [x] **I-V10 P3** — Settings: Reset-to-defaults + Show-first-run-again.
- [x] **F-V13 P3** — Per-preset curated camera views (heading/pitch/range).

### Solver fidelity (M-L)

- [x] **I-V01 P1** — Wet/dry land cell handling in SWE solver (no more "halo" on continental land).
- [x] **F-V01 P0** — Validation harness: Stoker dam-break + Carrier-Greenspan plane-beach runup + Range 2022 Chicxulub. `[features] validation` Cargo flag.
- [x] **F-V02 P0** — Full Okada 1985 I-term half-space correction; re-enable two `#[ignore]`d Tohoku/Sumatra validation tests; wire `OkadaFault` into `earthquake_initial_conditions`.
- [x] **F-V10 P2** — Radiation / sponge-layer boundary conditions (replace zero-flux walls).
- [x] **I-V02 P1** — Inundation polygons (first-order discs from `runup_m / tan(slope)`; full flood polygons deferred to v0.4.0).

### Power-user UX (M)

- [x] **F-V08 P1** — MP4 / WebM timeline export (extends shipped PNG export).
- [x] **F-V11 P2** — Click-on-globe inspect overlay (point-readout for amplitude + arrival + runup).
- [x] **F-V12 P3** — Onboarding tour (5-step tooltip pass).

### Trust / release / supply chain (M)

- [ ] **F-V03 P0** — README screenshots + animated demo. *Blocked: needs GUI capture from a Windows host.*
- [ ] **F-V04 P0** — Code signing (Win Authenticode + macOS notarisation). *Blocked: needs maintainer EV cert + Apple Developer enrollment.*
- [ ] **F-V07 P1** — `tauri-plugin-updater` Ed25519-signed channel. *Blocked: needs maintainer-generated Ed25519 keypair stored as GH secret.*
- [ ] **I-V04 P1** — Cesium token via OS keychain (Win Credential Manager / macOS Keychain / Linux Secret Service). Deferred: needs `keyring`-crate-equivalent that is Tauri-2 compatible; the `tauri-plugin-keyring` ecosystem is still emerging.

### Science-frontier (M)

- [ ] **F-V06 P1** — Real GEBCO 2024 bathymetry via first-run download wizard. *Blocked: needs decision on distribution channel (GitHub Release vs Cloudflare R2) and a built `gebco_2024_30s.zstd` artifact (~440 MB).*
- [x] **F-V09 P2** — Hunga Tonga atmospheric Lamb-wave source (closed-form module + `lamb_wave_sample` IPC; SWE-solver integration deferred to v0.4.0).

---

## Phase 4 — GPU + Nonlinear (v0.4.0)

**DoD**: 10× the grid resolution at 60 FPS playback. NSWE shows wave steepening and breaking near coasts.

- [ ] **F-V05 P1** — `wgpu` compute pipeline for SWE solver (D3D12/Vulkan/Metal/WebGPU). WGSL kernel already in `physics/solver/kernels.rs`. Behind `--features gpu`.
- [ ] Nonlinear shallow-water equations with Manning bottom friction `n=0.025`
- [ ] Wet/dry cell handling for inundation
- [ ] Inundation polygons as GeoJSON overlays on Cesium

## Phase 5 — Boussinesq + AMR (v0.5.0)

**DoD**: Chicxulub simulation matches Range et al. 2022 AGU Advances wave heights to within 25% at the named coastal sample points.

- [ ] Boussinesq dispersive terms — critical for impact-tsunami short wavelengths where `ω √(h/g) > 0.3`
- [ ] Adaptive mesh refinement (AMR) — coarse far-field, fine coastal patches
- [ ] Validation harness comparing to published peer-reviewed simulations (extends F-V01)

## Phase 6 — UX Polish + Release (v1.0.0)

**DoD**: A non-expert can pick "Chicxulub" from the menu, hit play, and understand what they're seeing without reading the manual.

- [ ] PNG/MP4/WebM share-card export with metadata overlay
- [ ] Signed Windows installer + macOS .dmg + Linux AppImage via GitHub Actions (replaces F-V04)
- [ ] User manual under `docs/`
- [ ] `assets/screenshots/` regenerated and embedded in README (replaces F-V03)

## Future / Stretch

- **Population casualty overlay** (opt-in, heavy disclaimer)
- **Multi-event scenarios** — Chicxulub debris re-entry secondary impacts, Tōhoku aftershock tsunamis
- **Comparison overlay** with NOAA DART buoy real arrival times for the four modern presets
- **Multi-language** UI (en/ja first — Tōhoku audience)
- **In-app log viewer + diagnostics copy-to-clipboard** (I-V08, P3)
