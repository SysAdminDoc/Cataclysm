# TODO — Working Checklist

Single source of truth for what's left to do, consolidated from `ROADMAP.md` + `RESEARCH_FEATURE_PLAN.md`. Updated as items are completed. Each item links to the originating doc + section.

**Legend:** `[ ]` pending · `[x]` complete · `[~]` partial · `(P0/P1/P2/P3)` priority · `(S/M/L/XL)` complexity.

## Phase 0.1 — v0.1.0 ✅ shipped 2026-05-25

### Quick wins (bundle for fast progress)
- [x] **(P2, S)** I6: Delete dead code (`_suppress_unused_mt_constant`, `matches!` suppressor)
- [x] **(P1, S)** I7: Globe empty-state overlay when `initial === null`
- [x] **(P2, S)** I8: Loading badge while `createWorldBathymetryAsync` resolves
- [x] **(P1, S)** G2: Bounds-check scenario form inputs (negative diameter, etc.)
- [x] **(P0, S)** Fix `mean_depth_m: 4000` hardcoded in `App.tsx:61` → use preset's `water_depth_m`
- [x] **(P2, S)** I11: Add `is_speculative` + `controversy_note` to `Preset` struct + UI badge
- [x] **(P2, S)** I14: In-app citations modal (clickable references → shell-open)
- [x] **(P2, S)** I13: Linear-spaced wavefront samples (front-clustered, not log-spaced)

### Build & release infrastructure (P0)
- [x] **(P0, S)** I1: Generate icon set so `tauri build` succeeds
- [x] **(P0, M)** I2: Add `.github/workflows/{ci,release}.yml` + `dependabot.yml`
- [x] **(P1, S)** I18: `cargo audit` step in CI

### Frontend polish (P1)
- [x] **(P1, M)** F3: Cesium token UX — Settings UI + `app_data_dir` persistence via `tauri-plugin-store`
- [x] **(P1, S)** I10: First-run disclaimer modal (stored ack flag)
- [x] **(P1, S)** I3: Remove duplicated browser-preview mock physics in App.tsx
- [x] **(P1, S-M)** F11: Tabbed scenario builder (asteroid, nuclear, earthquake, landslide)
- [x] **(P1, S)** F12: Click-globe-to-set-location for scenario builder

### Globe rendering improvements (P0-P1)
- [x] **(P0, S)** F1: Wire Globe.tsx to render initial source as 3D cylinder + camera fly-to scale fix
- [x] **(P2, S)** I12: `Globe.tsx` entity diff/in-place mutation (no thrash on time-slider)
- [x] **(P2, S)** I16: Cesium code-splitting (manualChunks) in `vite.config.ts`

### Backend physics + presets (P1-P2)
- [x] **(P1, S)** I4: Add `fault_length_m` + `fault_width_m` to `EarthquakeSource`
- [x] **(P2, S)** I5: Add Krakatoa 1883 preset (was claimed in README, missing in code)

### Quality / hygiene (P2)
- [x] **(P2, S)** I15: Tighten `shell:allow-open` to citation-URL allowlist
- [x] **(P2, S)** I9: Light theme (Catppuccin Latte) + toggle

### Documentation
- [x] **(P2, S)** D2: `CONTRIBUTING.md`
- [x] **(P2, S)** D3: `.github/ISSUE_TEMPLATE/*.yml` + PR template
- [x] **(P2, S)** D4: `SECURITY.md`

## Phase 0.2 — Real propagation (target v0.2.0)

Public surface landed in v0.1.0 release scope; bodies + validation deferred to v0.2.0.

- [~] **(P0, L)** F2: `wgpu` compute SWE solver on regular lat-lon grid
  - [x] `physics::solver::SwGrid` + `TimeStepper` + `GridSnapshot` types
  - [x] `SWE_LEAPFROG_WGSL` kernel source — staggered C-grid leapfrog, Manning friction, zero-flux boundaries
  - [x] `inject_gaussian` IC helper
  - [ ] Add `wgpu = "23"` + `bytemuck` to Cargo.toml
  - [ ] Compile WGSL into ShaderModule, wire ping-pong buffer pair
  - [ ] `simulate_grid(scenario, t_end, dt, n_snapshots) → Vec<GridSnapshot>` Tauri command + PNG-base64 amplitude texture serialization
  - [ ] Validate against Stoker dam-break analytical (±5%)
  - [ ] Validate against Range et al. 2022 Chicxulub 220 km amplitude (±OOM)
  - [ ] Frontend renders snapshots as Cesium SingleTileImageryProvider layer
- [x] **(P0, M)** F6: Synolakis runup overlay — landed in v0.1.0 prep
  - [x] `src/data/coastal_points.json` — 60 named points covering all 11 presets' regions
  - [x] `runup_at_points` Tauri command (Haversine + far-field decay + Synolakis runup)
  - [x] `CoastalRunupOverlay` component + 3D bar rendering in `Globe.tsx`
  - [ ] Once F2 solver is live, swap the analytical far-field decay for grid sampling
  - [ ] Validate: Tōhoku Miyako point runup ∈ [20, 80] m
- [~] **(P1, M)** F5: Okada 1985 dislocation
  - [x] `physics::okada::OkadaFault` + `OkadaDisplacementField` types
  - [x] Gaussian-bump placeholder for `vertical_displacement_field`
  - [ ] Replace placeholder with Okada eqns. (25)-(30) elliptic-integral form
  - [ ] Tanioka–Satake 1996 horizontal-bathymetry-coupling correction
  - [ ] Validate against USGS okada_wrapper Python for Tōhoku central subfault (~7 m peak)
  - [ ] Replace Geist–Dmowska M_w empirical in `earthquake::peak_seafloor_uplift_m`
- [ ] **(P1, L)** F4: Bundle offline bathymetry (SRTM15+ V2.6 or GEBCO 2024 + Natural Earth coastlines)
  - First-run wizard: "Download offline bathymetry (190 MB)? Yes / Skip / Only when needed"
  - Store in `app_data_dir/data/` (gitignored, downloaded on demand)
  - New `physics::data::bathymetry::sample(lat, lon) → f64` reading memory-mapped NetCDF
  - Settings: "Bathymetry source" toggle (Cesium ion / Local GEBCO)
  - Verify: airplane mode → click Chicxulub → globe + wave still works
  - Wire bathymetry into `SwGrid::new()` so the solver sees real depths

## Phase 0.3+ items — see RESEARCH_FEATURE_PLAN.md

- [ ] **(P2, M)** F7: Side-by-side comparison mode (synchronized timelines)
- [ ] **(P2, L)** F9: Hunga Tonga atmospheric Lamb-wave source (depends on F2 solver)
- [ ] **(P2, M)** F8: DART buoy historical overlay for 4 modern presets
- [ ] **(P2, L)** F13: Inundation polygons (depends on F2 + F4)
- [~] **(P2, M-L)** F10: Scenario export
  - [x] PNG screenshot of globe view (canvas.toDataURL + download)
  - [ ] Side-panel composite (html2canvas merge with globe via OffscreenCanvas)
  - [ ] MP4 timeline recording (mp4-muxer + canvas frame capture loop)
  - [ ] CZML deep-link import — `tsunamisimulator://load?...` protocol handler
- [ ] **(P1, M)** Code signing (macOS Gatekeeper, Windows Authenticode)
- [ ] **(P1, M)** `tauri-plugin-updater` (Ed25519-signed manifest)
- [ ] **(P3, L)** F14: Population casualty overlay (opt-in, heavy disclaimer)
- [ ] **(P3, L)** Boussinesq dispersive solver (FUNWAVE-TVD-style)
- [ ] **(P3, XL)** Adaptive Mesh Refinement (GeoClaw-style)

## Per-item conventions

- Boxes ticked **only** when verification passes locally OR is documented as deferred to CI (Rust-only changes today).
- One commit per item or per cohesive batch (per CLAUDE.md auto-continue rule), with brief status line.
- ROADMAP.md is the canonical *phased* plan; this TODO is the *granular* working list.
