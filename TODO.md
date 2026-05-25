# TODO — Working Checklist

Single source of truth for what's left to do, consolidated from `ROADMAP.md` + `RESEARCH_FEATURE_PLAN.md`. Updated as items are completed. Each item links to the originating doc + section.

**Legend:** `[ ]` pending · `[x]` complete · `[~]` partial · `(P0/P1/P2/P3)` priority · `(S/M/L/XL)` complexity.

## Phase 0.1 — Get something runnable (target v0.1.0)

### Quick wins (bundle for fast progress)
- [ ] **(P2, S)** I6: Delete dead code (`_suppress_unused_mt_constant`, `matches!` suppressor)
- [ ] **(P1, S)** I7: Globe empty-state overlay when `initial === null`
- [ ] **(P2, S)** I8: Loading badge while `createWorldBathymetryAsync` resolves
- [ ] **(P1, S)** G2: Bounds-check scenario form inputs (negative diameter, etc.)
- [ ] **(P0, S)** Fix `mean_depth_m: 4000` hardcoded in `App.tsx:61` → use preset's `water_depth_m`
- [ ] **(P2, S)** I11: Add `is_speculative` + `controversy_note` to `Preset` struct + UI badge
- [ ] **(P2, S)** I14: In-app citations modal (clickable references → shell-open)
- [ ] **(P2, S)** I13: Linear-spaced wavefront samples (front-clustered, not log-spaced)

### Build & release infrastructure (P0)
- [ ] **(P0, S)** I1: Generate icon set so `tauri build` succeeds
- [ ] **(P0, M)** I2: Add `.github/workflows/{ci,release}.yml` + `dependabot.yml`
- [ ] **(P1, S)** I18: `cargo audit` step in CI

### Frontend polish (P1)
- [ ] **(P1, M)** F3: Cesium token UX — Settings UI + `app_data_dir` persistence via `tauri-plugin-store`
- [ ] **(P1, S)** I10: First-run disclaimer modal (stored ack flag)
- [ ] **(P1, S)** I3: Remove duplicated browser-preview mock physics in App.tsx
- [ ] **(P1, S-M)** F11: Tabbed scenario builder (asteroid, nuclear, earthquake, landslide)
- [ ] **(P1, S)** F12: Click-globe-to-set-location for scenario builder

### Globe rendering improvements (P0-P1)
- [ ] **(P0, S)** F1: Wire Globe.tsx to render initial source as 3D cylinder + camera fly-to scale fix
- [ ] **(P2, S)** I12: `Globe.tsx` entity diff/in-place mutation (no thrash on time-slider)
- [ ] **(P2, S)** I16: Cesium code-splitting (manualChunks) in `vite.config.ts`

### Backend physics + presets (P1-P2)
- [ ] **(P1, S)** I4: Add `fault_length_m` + `fault_width_m` to `EarthquakeSource`
- [ ] **(P2, S)** I5: Add Krakatoa 1883 preset (was claimed in README, missing in code)

### Quality / hygiene (P2)
- [ ] **(P2, S)** I15: Tighten `shell:allow-open` to citation-URL allowlist
- [ ] **(P2, S)** I9: Light theme (Catppuccin Latte) + toggle

### Documentation
- [ ] **(P2, S)** D2: `CONTRIBUTING.md`
- [ ] **(P2, S)** D3: `.github/ISSUE_TEMPLATE/*.yml` + PR template
- [ ] **(P2, S)** D4: `SECURITY.md`

## Phase 0.2 — Real propagation (target v0.2.0) — DEFERRED to next session

Phase 0.2 requires sustained focus and a working `cargo` build (currently blocked locally on MSVC build tools missing). Items kicked to next session:

- [ ] **(P0, L)** F2: `wgpu` compute SWE solver on regular lat-lon grid
- [ ] **(P0, M)** F6: Synolakis runup overlay + coastal-point database + Tauri batch command
- [ ] **(P1, M)** F5: Implement Okada 1985 dislocation
- [ ] **(P1, L)** F4: Bundle offline bathymetry (SRTM15+ or GEBCO 2024 + Natural Earth)

## Phase 0.3+ items — see RESEARCH_FEATURE_PLAN.md

- [ ] **(P2, M)** F7: Side-by-side comparison mode
- [ ] **(P2, L)** F9: Hunga Tonga atmospheric Lamb-wave source
- [ ] **(P2, M)** F8: DART buoy historical overlay
- [ ] **(P2, L)** F13: Inundation polygons
- [ ] **(P2, M-L)** F10: Scenario export (PNG/MP4/CZML deep-link)
- [ ] **(P1, M)** Code signing (macOS Gatekeeper, Windows Authenticode)
- [ ] **(P1, M)** `tauri-plugin-updater` (Ed25519-signed manifest)
- [ ] **(P3, L)** F14: Population casualty overlay (opt-in)
- [ ] **(P3, L)** Boussinesq dispersive solver (FUNWAVE-TVD-style)
- [ ] **(P3, XL)** Adaptive Mesh Refinement (GeoClaw-style)

## Per-item conventions

- Boxes ticked **only** when verification passes locally OR is documented as deferred to CI (Rust-only changes today).
- One commit per item or per cohesive batch (per CLAUDE.md auto-continue rule), with brief status line.
- ROADMAP.md is the canonical *phased* plan; this TODO is the *granular* working list.
