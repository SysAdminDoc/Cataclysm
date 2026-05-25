# Changelog

All notable changes to TsunamiSimulator. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Hardening (post-0.2.0)
- IPC commands now enforce explicit bounds: `runup_at_points` returns
  `Result` with a 2 000-point cap; `simulate_grid` rejects non-finite
  `source_sigma_m` / `mean_depth_m` / `n_snapshots == 0`; `run_preset`
  clamps `n_samples` to `[2, 2 000]` and validates `time_s` / `mean_depth_m`.
- New `presets.rs` test suite verifies preset ID uniqueness, non-empty
  metadata, controversy-note presence on speculative entries, and finite
  initial-displacement outputs across every built-in preset.
- All external citation links use `target="_blank" + rel="noopener
  noreferrer"` so middle- or right-click cannot navigate the Tauri
  WebView off the React app.
- `ResultsPanel` timeline progress clamps to ≥ 0 to defeat negative
  `scaleX` rendering bugs.
- Removed dead `forceRender()` no-op from `lib/export.ts` and the unused
  `zustand` dependency from `package.json`.
- Fixed `clippy::manual_saturating_arithmetic` on the SWE grid-size
  pre-allocation gate.

### Planned for v0.3.0
- `wgpu` compute SWE solver — port the working CPU leapfrog kernel to WGSL
- Full Okada 1985 I-term half-space correction (replaces leading-order form)
- Tanioka–Satake 1996 horizontal-bathymetry-coupling correction
- Validation against Stoker dam-break analytical + Range 2022 Chicxulub far-field
- Boussinesq dispersive solver as opt-in alternative
- Adaptive Mesh Refinement (GeoClaw-style)
- Real GEBCO 2024 bathymetry via first-run download wizard

---

## [0.2.0] - 2026-05-25 — Phase 0.2

Working SWE physics, runup overlay, DART overlay, side-by-side comparison, multi-globe selection, no-token-required default.

### Added — Backend (Rust)
- **F2 working CPU SWE solver** (`physics::solver`) — leapfrog with `rayon` row-parallel updates via `par_chunks_mut`. Continuity + linearised momentum + Manning bottom friction + zero-flux boundaries. CFL-safe `recommended_dt_s()` based on max √(gh). Snapshots are PNG-base64 with a diverging blue↔red colormap, ready for Cesium `SingleTileImageryProvider`. `run_simulation(grid, stepper, t_end, n_snapshots)` end-to-end driver.
- **F5 leading-order Okada 1985** (`physics::okada`) — Chinnery-notation surface integral over the four fault corners. Strike-slip + dip-slip + tensile vertical components. Rake decomposition. `From<&EarthquakeSource>` adapter. The full half-space I-term correction is deferred to v0.3.0; the leading-order form over-predicts magnitudes by ~10× but has correct sign / lobe shape.
- **F4 offline bathymetry** (`data::bathymetry`) — coarse basin-mean depth (Pacific 4280 m, Atlantic 3646 m, Indian 3741 m, Southern 3270 m, Arctic 1205 m, Mediterranean 1500 m, Caribbean 2400 m per Charette & Smith 2010) + continental-shelf taper within 5° of land. Zero for land. Wired into `simulate_grid` via the new `use_real_bathymetry` toggle.
- **F6 runup batch command** (`commands::runup_at_points`) — Haversine + far-field decay + Synolakis 1987 closed-form. Returns `RunupAtPoint { id, name, lat, lon, range, offshore_amp, runup_m, arrival_time, has_arrived }`.
- New Tauri command `simulate_grid` exposing the SWE solver to the frontend with bounded grid-size guard (4 M cells max).

### Added — Frontend (React + TS)
- **SwePlayback** component — runs the SWE solver, scrubs through 24 snapshots, paints each as an imagery layer over the globe. Toggle for coarse offline bathymetry.
- **DartOverlay** component — sparkline charts of observed water-surface elevation at 6 DART buoys across Tohoku 2011 / Indian Ocean 2004 / Hunga Tonga 2022. Cursor synced to the timeline scrubber.
- **Side-by-side comparison mode** (F7) — header `⇆ Compare` toggle splits the central column into two stacked globes with two preset selectors. Both share `timeS` but otherwise run independently. Slot tags colour-coded sapphire/pink.
- **Multi-globe-style selector** — 5 imagery options:
  - OpenStreetMap (default, no token)
  - Esri World Imagery satellite (no token)
  - Natural Earth II (bundled with Cesium, no network)
  - Cesium World Imagery (token required)
  - Cesium World Bathymetry terrain (token required)
- **PNG export** of globe view (F10 first slice).
- 60-point coastal database (`src/data/coastal_points.json`) covering all 12 preset regions.
- DART buoy database (`src/data/dart_buoys.json`) covering 3 modern events.

### Changed
- App is now **usable without any Cesium ion token** — OpenStreetMap is the default base layer.
- Settings storage hardened: every write mirrors to `localStorage` so a future `tauri-plugin-store` regression cannot silently lose user data.
- Capability `store:default` alias expanded to explicit `allow-load/get/set/save/has/keys/entries/clear/delete/reload` permissions to fix token-not-persisting bug on some platforms.
- CSP `connect-src` + `img-src` extended to allow `tile.openstreetmap.org` and `*.arcgisonline.com`.

### Fixed
- Token entered via Settings dialog now persists across restart.
- `Globe.tsx` no longer hides itself when a token is missing.
- v0.1.0 macOS release-workflow bash 3.2 `globstar` regression (carried over).
- Several internal CI-only Rust lifetime / move-closure issues.

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
