# Changelog

All notable changes to TsunamiSimulator. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added since v0.1.0 (Phase 0.2 prep — will ship as v0.2.0-alpha or rolled into v0.2.0)
- **F6**: Synolakis runup overlay — `runup_at_points` Tauri batch command; 60-point coastal database in `src/data/coastal_points.json` covering all 11 presets' affected regions; CoastalRunupOverlay component renders 3D bars colour-ramped by runup magnitude (green <2m / yellow 2-10m / red >10m).
- **F5 scaffold**: `physics::okada` module with OkadaFault + OkadaDisplacementField types; Gaussian-bump placeholder until full elliptic-integral form lands.
- **F2 scaffold**: `physics::solver` module with SwGrid + TimeStepper + GridSnapshot types + WGSL leapfrog kernel embedded as a string constant. `wgpu` integration deferred.
- **F10 partial**: PNG export of globe view via canvas.toDataURL + `<a download>`. Cesium viewer now enables `preserveDrawingBuffer` for capture.

### Planned for v0.2.0
- Wire the `wgpu` compute pipeline + ping-pong buffers (build on the F2 scaffold)
- Implement full Okada 1985 elliptic integrals (build on the F5 scaffold)
- Bundle offline bathymetry (SRTM15+ or GEBCO 2024 + Natural Earth coastlines)
- Tanioka–Satake 1996 horizontal-bathymetry-coupling correction for the Okada source
- Validate against Stoker dam-break analytical case + Range 2022 Chicxulub far-field

### Planned for v0.3.0
- Side-by-side comparison mode (synchronized timelines)
- Hunga Tonga atmospheric Lamb-wave source
- DART buoy historical overlay for 2011 Tōhoku / 2004 Sumatra / 2022 Hunga Tonga
- Inundation polygons (wetting/drying SWE)
- Scenario export (PNG/MP4/CZML deep-link)

### Planned for v1.0.0
- Boussinesq dispersive solver (FUNWAVE-TVD-style)
- Adaptive Mesh Refinement (GeoClaw-style)
- Code signing (macOS Gatekeeper, Windows Authenticode)
- `tauri-plugin-updater` auto-update channel
- Population casualty overlay (opt-in)

---

## [0.1.0] - 2026-05-25 — Phase 0.1

First release with a buildable installer. Globe + presets work end-to-end; physics is point-source only (real propagation lands in v0.2.0).

### Added — Backend (Rust)
- `EarthquakeSource` now carries `fault_length_m` / `fault_width_m` with Wells–Coppersmith 1994 fallback scaling. Tōhoku + Sumatra presets pre-fill with Fujii–Satake 2013 / Lay 2005 finite-fault values.
- **Krakatoa 1883** preset (Choi 2003 / Maeno–Imamura 2011 caldera collapse), fixing the README/code drift.
- `Preset` struct carries `reference_url`, `is_speculative`, `controversy_note`.
- `tauri-plugin-store` wired for persistent app-data settings.
- Capabilities `shell:allow-open` tightened to an explicit citation-host allowlist (cesium.com, doi.org, agupubs, science, nature, sciencedirect, researchgate, forbes, tsunamisociety, lanl, nuclearsecrecy, NOAA, GEBCO, OpenTopography, Natural Earth, Clawpack, and the repo).

### Changed — Backend
- `physics::shallow_water::sample_wavefront` switched from log-spaced to front-clustered linear sampling (80% of samples on the leading edge band).
- `commands::run_preset` derives propagation depth from the preset's source water depth when caller passes `mean_depth_m: 0`; eliminates the hardcoded 4000 m bug that broke Lituya Bay arrival times.

### Removed — Backend
- `_suppress_unused_mt_constant` dead-code function in `nuclear.rs`.
- Vestigial `matches!(..)` dead-code suppressor in `commands.rs`.

### Added — Frontend (React + TypeScript)
- **Tabbed scenario builder** (Asteroid / Nuclear / Earthquake / Landslide) — all four IPC commands are now exposed in the UI with bounds-checked inputs.
- **Click-globe-to-set-location** — Pick on Globe button toggles pick mode; the Cesium screen-space click handler reports cartographic coords, Esc cancels.
- **Settings modal** — Cesium ion token paste field, theme toggle, store-backed persistence in `app_data_dir/settings.json`.
- **First-run disclaimer modal** — not-for-evacuation notice shown exactly once; ack timestamp persisted.
- **Citations modal** — full peer-reviewed reference list with click-through (rejected if outside `shell:allow-open` allowlist).
- **Catppuccin Latte light theme** alongside Mocha dark default, toggleable in Settings.
- Speculative presets sort below historical and display a ⚠ icon + amber left-border + controversy note tooltip.
- Globe `cylinder` entity renders the impact cavity in 3D (height = cavity_depth/2.83 per Ward–Asphaug parabola); fly-to range clamped 0.5 Mm – 8 Mm.
- Globe wavefront entities updated **in-place** on time-scrub (no add/remove thrash).
- Empty-state hint when no preset is active; loading badge while Cesium World Bathymetry tileset streams; error badge on tile-load failure; NaN guard on amplitude=0 case.

### Changed — Frontend
- App.tsx no longer duplicates Schmidt–Holsapple math in JavaScript — custom scenarios route through Tauri IPC, browser preview surfaces a console warning instead.
- `vite.config.ts` `rollupOptions.manualChunks` splits Cesium (4.1 MB) and React (194 KB) into separate chunks. App shell minified to 26 KB.
- `Globe.tsx` lazy-loaded via `React.lazy` + `Suspense`.

### Added — Build & Release Infrastructure
- `assets/branding/logo.svg` master + generated `src-tauri/icons/*` (PNG, ICO, ICNS, iOS, Android variants).
- `.github/workflows/ci.yml` — PR + push + dispatch triggers; frontend job (tsc + vite); Rust job 3-OS matrix (ubuntu/windows/macos) with cargo check + test --release + clippy -D warnings; audit job with cargo-audit.
- `.github/workflows/release.yml` — workflow_dispatch with tag + prerelease inputs; 3-OS matrix; auto-uploads msi/exe/dmg/deb/AppImage/rpm/zip/tar.gz; macOS universal-apple-darwin target.
- `.github/dependabot.yml` — weekly npm + cargo, monthly GH Actions, grouped tauri/cesium/react updates.
- `.github/ISSUE_TEMPLATE/{bug,preset-request,physics,config}.yml` + PR template.
- `CONTRIBUTING.md` and `SECURITY.md`.

---

## [0.0.1] - 2026-05-24 — Scaffold

Initial repo scaffold with all source-physics formulas encoded but no propagation solver yet. Details in v0.0.1 git history.
