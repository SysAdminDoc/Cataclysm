# Research — TsunamiSimulator

Date: 2026-07-09 — replaces all prior research.

## Executive Summary
Verified: TsunamiSimulator v0.4.4 is a Tauri 2 desktop app pairing cited Rust source/SWE physics (14 IPC commands, 12 presets, 82 coastal points, 6 DART buoys, 5 guided lessons, 7 export formats) with a React/Cesium cockpit; the 2026-07-01 audit pass drained ROADMAP.md completely and the codebase carries zero TODO/FIXME markers. The strongest current shape is a trust-centered education tool; the highest-value direction is converting the July 2025 Kamchatka Mw 8.8 — the most-instrumented tsunami in history — into a validation showcase, while retiring stale "needs MSVC linker" blockers (Rust compilation works locally; `npm run verify` runs 67 Rust release tests). Top opportunities in priority order: (1) fix the `rust-version` 1.85 vs wgpu-29 MSRV 1.87 mismatch, (2) guard the dompurify override floor, (3) surface DART RMSE in the UI (backend already shipped), (4) replace `AttenuationChart.tsx` JS physics with an `attenuation_curve` IPC, (5) Kamchatka 2025 preset + DART validation pack, (6) arrival-time isochrone layer (the #1 lay question during Kamchatka), (7) fgmax-style peak-amplitude/time-of-max products, (8) property-based physics tests, (9) new cited presets (Krakatau 1883/2018, Lisbon 1755, Santorini, Sanriku 2026, 2024 YR4 myth-buster), (10) compile the physics crate to WASM to kill the `demo.ts` drift carve-out and open a web-demo path against fast-moving Celeris-WebGPU.

## Product Map
- Core workflows: pick a cited preset or build a custom source (asteroid/nuclear/earthquake/landslide); run/stream the SWE solver (CPU rayon or wgpu GPU with fallback); scrub snapshots on the Cesium globe; inspect DART sparklines, runup bars, user gauges, comparison slots, attenuation charts; export PNG/share-card/compare-PNG/video/CZML/GeoJSON/KML/CSV with provenance.
- Personas: educators and students (guided lessons, glossary, print stylesheet, settings export/import); technically curious public; reviewers checking citations (`docs/science/`, `REFERENCES.bib`) and validation harnesses.
- Platforms: Windows/macOS/Linux Tauri desktop; browser preview with watermarked approximate JS physics (`src/lib/demo.ts`, 703 lines). Windows MSI/NSIS built locally, unsigned (blocked on maintainer cert).
- Data flows: React → typed IPC (`src/lib/tauri.ts`) → Rust physics; `tauri-plugin-store` settings (schema v1, migrations); coastal/DART JSON datasets; Cesium imagery with Natural Earth II offline fallback; coarse basin-shelf synthetic bathymetry (`src-tauri/src/data/bathymetry.rs`) — real GEBCO still blocked on distribution channel.

## Competitive Landscape
- **Celeris-WebGPU (plynett.github.io)** — fastest-moving competitor: June 2026 added a spherical nonlinear SWE solver with a Japan-2011 example, grid nesting, time-series plot panels, and touch UX; peer-reviewed (ASCE JWPCOE 2026). Learn: zero-install reach, probe/time-series UX, nesting. Avoid: surrendering Rust-authoritative physics to a browser-only solver.
- **GeoClaw/Clawpack v5.14.0 (2026-01-26)** — the reference OSS model. Learn: fgmax maximum-field products and gauge fidelity (open issues #691, #657 show users depend on them), meteotsunami pressure forcing demand (issue #694). Avoid: expert-only setup friction.
- **Tsunami-HySEA v1.3.0 (2025-10) / JAGURS 2025.5.2 / FUNWAVE-TVD** — research codes now shipping dispersion, nested domains, hot-start, and a dedicated Meteo-HySEA meteotsunami code. Learn: dispersion matters most for this app's asteroid/landslide sources (pure SWE overstates far-field); already tracked as blocked Boussinesq work. Avoid: HPC/MPI complexity.
- **NOAA NCTR/PTWC products** — per-event model pages (Kamchatka 2025-07-29, Miyako 2026-04-20), travel-time isochrone maps, RIFT energy/directivity maps. Learn: these are the exact products laypeople saw in news coverage; matching their vocabulary makes results checkable. Avoid: any operational-forecast claim.
- **NUKEMAP (2026-02-10 roadmap)** — the public-hazard-sim UX playbook: humanitarian-impacts layer (OSM schools/hospitals in effect zones), multiple selectable models, i18n framework, open-sourcing the effects engine as a citable library. Learn: humanitarian-impact framing as the ethical alternative to casualty counts. Avoid: cost-heavy hosted basemaps.
- **PhET (PhET Studio, 2025)** — education distribution model: teacher-customized/locked sim configs, offline translated sims, worksheet ecosystems (TeachEngineering tsunami unit). Learn: teacher mode on top of the existing settings export/import. Avoid: full i18n before a stable string catalog.
- **SFINCS v2.3.0 (2025)** — added time-of-maximum output flag; validates the max-field product direction.

## Security, Privacy, and Reliability
- Verified: `src-tauri/Cargo.toml` declares `rust-version = "1.85"` but wgpu 29 raised MSRV to 1.87 (wgpu CHANGELOG) — the declared toolchain floor is wrong whenever the `gpu` feature builds. Fix: bump to 1.87.
- Verified: Cargo.lock has tauri **2.11.2**, which is past the CVE-2026-42184 / GHSA-7gmj-67g7-phm9 fix (2.11.1) — the Windows/Android `is_local_url()` origin-confusion IPC vulnerability is NOT active. Latest patch is 2.11.5 (2026-07-01); routine bump only.
- Verified: dompurify override locked at 3.4.11, above the 3.4.7 floor that closes CVE-2026-49978 (fourth sanitizer bypass in 12 months). Missing guardrail: nothing prevents a future lockfile regression below 3.4.7 — add a floor check to `scripts/verify.mjs`.
- Verified stale blockers in `Roadmap_Blocked.md`: items citing "Needs MSVC linker" (property tests, commands.rs modularization, `attenuation_curve`, `diagnostics_bundle`) are no longer blocked — CLAUDE.md documents the VsDevCmd wrapper and `npm run verify` runs 67 Rust release tests. These return to actionable work.
- Verified: DART RMSE is Rust-complete but invisible — `dart_buoy_rmse` IPC exists (`src-tauri/src/commands.rs:459-525`, 6 unit tests) and `GridSnapshot.gauge_samples` ships raw eta (`src/types/scenario.ts:115`), but `DartOverlay.tsx` shows only sparklines/arrival deltas, never RMSE. Frontend-only gap.
- Verified: `AttenuationChart.tsx:23-40` still reimplements r^(-5/6)/r^(-1/2) decay in JS, violating the "physics in Rust only" architecture rule; CLAUDE.md's own migration note is gated on now-available MSVC.
- Reliability gaps: no GPU-kernel tests (CPU/GPU eta divergence was a real shipped bug, fixed 2026-07-01 in `8626470`, with no parity regression test); no property-based tests; physics modules have no direct unit tests (validated only via preset benchmarks).
- Privacy/keys: Cesium ion token stored in plain `settings.json`; `tauri-plugin-stronghold` is officially deprecated for Tauri v3 — direct `keyring` crate use is now the defensible path (unblocks I-V04).
- Recovery/rollback: settings migrations and export/import shipped; release trust still needs signing (blocked, maintainer credentials).

## Architecture Assessment
- Large-file pressure: `src-tauri/src/commands.rs` 1,944 lines (split into types/validators/simulation/source/query submodules — now compilable, no longer blocked), `src-tauri/src/physics/solver/mod.rs` 1,250, `src/components/Globe.tsx` 1,081 (stays blocked on visual verification), `src/App.tsx` 812.
- The SWE data boundary improved (gauge samples now Rust-sourced since `fa71e5e`), but analysis products remain PNG-oriented: no per-cell max-amplitude/time-of-max accumulation in the solver, no travel-time grid, no energy integral — all three are cheap accumulator additions to `solver/mod.rs` that unlock NOAA-style products.
- `demo.ts` (703 lines) drift carve-out could be eliminated by compiling the physics crate to WASM (wasm-bindgen) for browser preview — one physics source of truth, and the foundation for a future web demo (Celeris pressure). Supersedes the blocked "build-time demo data generation" idea.
- Cesium 1.142's `GeoJsonPrimitive` and 1.140's Buffer* collections are purpose-built for the app's dynamic vector loads (inundation polygons, gauge markers); 1.143 `PathGraphics.materialMode "PORTIONS"` enables arrival-time-colored propagation paths. Current pin 1.142.0; 1.140 raised the WebGL2 floor (already met).
- Test gaps: GPU kernel parity, physics-module unit tests, property-based tests, offline-fallback automation. Docs are synced to v0.4.4; no contradictions found beyond the stale blocked-item claims noted above.
- WebGPU-in-webview is Windows-only (WebView2 Runtime 146+ adds a D3D11 compatibility mode; WKWebView/WebKitGTK still don't ship it) — keep native wgpu as the cross-platform GPU path.

## Rejected Ideas
- Google Photorealistic 3D Tiles basemap — Enterprise SKU, 1,000 free root-tileset events/month; ruinous for OSS users (developers.google.com/maps tile billing).
- tauri-plugin-stronghold for token storage — officially deprecated, removed in Tauri v3 (v2.tauri.app/plugin/stronghold).
- In-webview WebGPU compute path — Windows-only as of mid-2026; native wgpu already covers all platforms.
- Waiting on CesiumJS WebGPU renderer — still "longer-term exploration" per the June 2025 Cesium roadmap; nothing landed through 1.143.
- C-library NetCDF export (`netcdf-sys`) — cross-platform build burden stands; pure-Rust zarrs/netcdf3 path proposed instead (see roadmap).
- Browser-only solver authority (Celeris model) — contradicts the "physics in Rust only" architecture rule; WASM-compiled Rust physics achieves the same reach without forking truth.
- Casualty/population overlays — unchanged: needs ethics/data decision; NUKEMAP-style humanitarian-facility counts proposed as the softer alternative.
- Plugin ecosystem, mobile-native app, multi-user collaboration, operational forecast mode — unchanged rejections from 2026-07-01 research; no new counter-evidence.
- GitHub Actions build/release — repo policy is local builds only.
- Reddit-sourced demand claims — no indexable 2025-2026 threads found; dropped as unsourced.

## Sources
### Project
- https://github.com/SysAdminDoc/TsunamiSimulator

### OSS and Research Models
- https://www.clawpack.org/releases.html
- https://github.com/clawpack/geoclaw/issues
- https://plynett.github.io/
- https://github.com/plynett/plynett.github.io/commits/main
- https://zenodo.org/records/17151936
- https://github.com/jagurs-admin/jagurs/releases
- https://github.com/Deltares/SFINCS/releases
- https://github.com/rjleveque/nthmp-benchmark-problems

### Events, Presets, and Science
- https://nctr.pmel.noaa.gov/kamchatka20250729/
- https://www.sciencedirect.com/science/article/pii/S002980182601749X
- https://nctr.pmel.noaa.gov/miyako20260420/
- https://doi.org/10.3390/jmse13102005
- https://nhess.copernicus.org/articles/3/321/2003/
- https://pubs.usgs.gov/publication/70036556
- https://science.nasa.gov/solar-system/asteroids/2024-yr4-facts/
- https://www.glerl.noaa.gov/blog/2025/07/18/june-21-2025-storm-causes-significant-meteotsunami-and-seiche-on-lake-superior/
- https://www.ncei.noaa.gov/products/natural-hazards/tsunamis-earthquakes-volcanoes/tsunamis/travel-time-maps
- https://noaa.hub.arcgis.com/content/9c4e79757d3b45f7a522fc7072d60c15
- https://www.ngdc.noaa.gov/hazel/
- https://news.ycombinator.com/item?id=44729865

### Dependencies, Platform, Security
- https://github.com/CesiumGS/cesium/blob/main/CHANGES.md
- https://github.com/tauri-apps/tauri/security/advisories/GHSA-7gmj-67g7-phm9
- https://github.com/tauri-apps/tauri/releases
- https://github.com/gfx-rs/wgpu/blob/trunk/CHANGELOG.md
- https://github.com/advisories/GHSA-rp9w-3fw7-7cwq
- https://www.gebco.net/data-products-gridded-bathymetry-data/gebco2026-grid
- https://crates.io/crates/zarrs
- https://blog.nuclearsecrecy.com/2026/02/10/nukemap-roadmap/
- https://phet-io.colorado.edu/io-solutions/

## Open Questions
- GEBCO distribution channel (GitHub Release vs Cloudflare R2) for F-V06: the licensing half of the blocker dissolved 2026-04 — GEBCO_2026 is public domain with OPeNDAP subsetting — so only the maintainer's hosting decision still blocks real bathymetry and downstream flood polygons (F4-04).
- Code-signing credentials (F-V04) and updater key custody (F-V07) remain maintainer-only decisions; unchanged.
- SWOT Kamchatka swath data redistribution terms need a live check before the overlay item is implemented (NASA PO.DAAC licensing).
