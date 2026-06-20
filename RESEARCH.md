# Research — TsunamiSimulator

## Executive Summary

TsunamiSimulator (v0.4.2) is a Tauri 2 + React 19.2 + CesiumJS + Rust desktop app that fills a unique gap: no other tool combines multi-source tsunami generation (asteroid, nuclear, earthquake, landslide) with real-time 3D globe propagation. The codebase is mature (~13.7K LOC, comprehensive CI across 3 platforms, 5 axe-core WCAG checks) but the most recent implementation session shipped four frontend features (AttenuationChart, TimelineView, KML export, URL sharing) with zero test coverage and a Vite 8 upgrade that uses deprecated configuration APIs.

The highest-value direction is **quality consolidation + Vite 8 migration completion**: fix the deprecated `rollupOptions`/`manualChunks` config before a future Vite version removes them, add tests for the untested features, fix the TimelineView hardcoded year and KML export fragility, then move to the blocked Rust-side improvements (commands.rs modularization, proptest, GEBCO API) once the MSVC linker environment is available.

Top opportunities in priority order:
1. Complete Vite 8 migration — `rolldownOptions` + `codeSplitting` replace deprecated APIs
2. Add unit tests for AttenuationChart, TimelineView, KML export, URL sharing (zero coverage)
3. Update Playwright smoke test to verify new KML/Link toolbar buttons
4. Fix TimelineView hardcoded year 2026 → dynamic `new Date().getFullYear()`
5. Fix KML export fragile conditional placemark-to-folder indexing
6. Wire custom scenario URL sharing (infrastructure exists, not connected in App.tsx)
7. Update Rust edition 2021 → 2024 (available since Rust 1.85)
8. Bump tsconfig target ES2022 → ES2025 (TS 6 default, matches build target)
9. Pass `busyId` to TimelineView for loading feedback on timeline preset selection
10. Address AttenuationChart JS physics violation — document or migrate to Rust IPC

## Product Map

- **Core workflows**: Select preset or build custom scenario → configure source parameters → inspect source readout → run SWE simulation → scrub 24 snapshots → view runup/DART/inundation overlays → export PNG/share card/video/CZML/GeoJSON/KML/text → share via deep-link URL or clipboard
- **User personas**: Science communicators, geoscience educators, students exploring tsunami physics, emergency-planning-adjacent users needing explicit "not operational" framing
- **Platforms**: Windows/macOS/Linux desktop via Tauri 2 (WebView2/WebKit/WebKitGTK); browser preview via `npm run dev` with deterministic demo data
- **Key integrations**: Rust physics → Tauri IPC (JSON) → React UI → CesiumJS globe; `tauri-plugin-store` for settings; optional Cesium ion token for satellite imagery; coarse offline bathymetry in `src-tauri/src/data/bathymetry.rs`

## Competitive Landscape

**NUKEMAP** (Web, 20M+ users)
- Learn: Migrating to self-hosted Protomaps + Cloudflare; AWEL.js effects library going open-source; planning WebGL fallout shading, mobile overhaul, multi-language. URL sharing is table-stakes.
- This project's advantage: 3D globe, water physics, multi-source. NUKEMAP has no 3D, no tsunami modeling. It is deepening within nuclear effects, not expanding.

**Asteroid Launcher** (neal.fun)
- Learn: The #1 user-requested missing feature is water/tsunami effects. "I wish this took water into account" is the most common HN comment. This is TsunamiSimulator's core value proposition.
- Avoid: No save/share features. Single-session toy.

**Tracy Arm megatsunami game** (USC, Patrick Lynett, coming to Steam)
- Learn: A real physicist making an immersive tsunami experience validated the market. Single-event recreation, not a general-purpose simulator.
- Watch: Could expand to general-purpose if successful.

**BROWNI** (WebGL, INRIA Chile)
- Learn: Proves GPU-accelerated tsunami SWE in-browser is feasible. Validated against 2011 Tōhoku and 2010 Chile. Uses older WebGL API, not WebGPU compute.
- Avoid: Linear SWE only; no inundation; research paper, not consumer product.

**Impact: Earth!** (Purdue/Imperial)
- Learn: Excellent scientific validation source. Text-based calculator with no visualization. Zero competitive threat as UX.

**Educator tools gap**: NOAA Science On a Sphere, TsunamiLab (IMAGINARY), pre-rendered animations. No interactive, visually compelling, scientifically grounded tool for classroom use exists. TsunamiSimulator fills this gap.

**GPU SWE state of art**: WebGPU is production-ready across browsers (late 2025). MLS-MPM achieves ~100K particles on integrated GPU. Virtual pipes method proven for regular grids. weBIGeo paper shows 748-3120x speedup for geospatial compute on WebGPU terrain.

## Security, Privacy, and Reliability

- **Tauri 2.11.2**: Past the May 2026 origin-confusion advisory (patched in 2.11.1). No new CVEs.
- **React 19.2.7**: Must be on 19.2.6+ to have CVE-2025-55182 (React2Shell) patches. Current version is safe.
- **CesiumJS**: Only CVE (2023-48094) is in demo sandbox not shipped by this app.
- **cargo-deny**: Added in last session (deny.toml + CI job). Configuration looks correct.
- **Vite 8 deprecation risk**: Using deprecated `rollupOptions` and `manualChunks` — these work today but may be removed in Vite 9, causing CI build failures with no notice. Should be migrated to `rolldownOptions` + `codeSplitting.groups`.
- **demo.ts drift**: 665-line JS physics reimplementation continues to diverge from Rust source of truth. The `computeDecayCurve` in AttenuationChart.tsx adds another JS physics path.

## Architecture Assessment

- **commands.rs** (1742 lines): Largest Rust file. Modularization blocked on MSVC linker availability.
- **Globe.tsx** (1068 lines): Largest React component. Refactoring to composable hooks blocked on visual verification.
- **demo.ts** (665 lines): Drifting JS physics reimplementation. AttenuationChart.tsx adds a 6th JS physics function (`computeDecayCurve`) that violates the "physics in Rust only" architecture rule in `CLAUDE.md`.
- **New feature test gap**: AttenuationChart, TimelineView, KML export (`exportKml`), URL sharing (`scenarioFromUrl`/`scenarioToUrlParams`) — all shipped without unit tests. The export.test.ts and scenario-schema.test.ts files exist but don't cover these new functions.
- **Playwright gap**: The `smoke.spec.ts` "export buttons are present" test (line 46-53) checks for PNG, Share, Video, Text, Citations, Settings buttons but not the new KML or Link buttons.
- **TimelineView `parseDateToYearsAgo`**: Hardcodes `2026` on line 30 (`return 2026 - parseInt(isoMatch[1], 10)`). This will show wrong "years ago" values starting January 2027.
- **KML export template**: The placemark-to-folder assignment on lines 508-511 of export.ts uses fragile conditional indexing that depends on `cavityR > 500` being evaluated identically in two separate code paths.
- **URL sharing incomplete**: `scenarioToUrlParams` supports custom scenario encoding via base64 JSON, but App.tsx line 432 passes `null` for the scenario parameter, and `scenarioFromUrl` only restores presets (not `?scenario=` path) on mount (line 231-233).
- **Vite config stale comments**: Line 9 of vite.config.ts references "Rollup" but the bundler is now Rolldown.
- **Rust edition 2021**: Could be upgraded to 2024 (available since Rust 1.85) for new resolver, async closures, cfg_select!.
- **tsconfig target ES2022**: TS 6 defaults to ES2025; the build target in vite.config.ts already includes `es2022` and `chrome105`.

## Rejected Ideas

- **CubeCL Rust GPU DSL**: The SWE kernel is ~200 lines of WGSL, not complex enough to justify a DSL dependency. Source: CubeCL GitHub.
- **VR/AR tsunami visualization**: XL effort, niche audience, no demand evidence beyond one 2024 IEEE paper. Source: IEEE Xplore 10760205.
- **ML-assisted wave field reconstruction**: Requires training data the project doesn't have. Source: arXiv 2411.12948.
- **Live parameter adjustment during simulation (Celeris pattern)**: Requires fundamental solver architecture change. Current batch-compute + scrub UX suits the educational purpose. Source: celeria.org.
- **Precomputed propagation database (MOST/ComMIT)**: Requires GEBCO + significant precomputation infra. Better to improve the live solver. Source: NOAA ComMIT docs.
- **Plugin ecosystem**: No competitor shows plugin demand; would add API burden. Source: scan of 29 tools.
- **Population casualty / multi-event / multi-language**: Already tracked in `Roadmap_Blocked.md`.
- **Arrival-time isochrones / GEBCO API / DART RMSE / emit_str***: Already tracked in `Roadmap_Blocked.md` with MSVC/Rust compilation blockers.
- **MLS-MPM solver (WebGPU particle method)**: Proven for fluid visuals but architecturally incompatible with the existing grid-based SWE solver. Would require complete solver rewrite. Source: matsuoka-601/WebGPU-Ocean.

## Sources

Competitor/product research:
- https://blog.nuclearsecrecy.com/2026/02/10/nukemap-roadmap/
- https://news.ycombinator.com/item?id=33870612
- https://www.alaskasnewssource.com/2026/05/09/engineer-creates-video-game-alaskas-tracy-arm-landslide-which-generated-megatsunami/
- https://inria.hal.science/hal-02112763v2
- https://impact.ese.ic.ac.uk/ImpactEarth/
- https://www.imaginary.org/program/tsunamilab

Dependency/toolchain:
- https://vite.dev/guide/migration (Vite 7→8 migration guide)
- https://github.com/CesiumGS/cesium/issues/13353 (CesiumJS + Vite 8 tracking)
- https://rolldown.rs/reference/outputoptions.advancedchunks (codeSplitting docs)
- https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/
- https://react.dev/blog/2025/10/01/react-19-2
- https://blog.rust-lang.org/2025/02/20/Rust-1.85.0/ (Rust 2024 Edition)
- https://github.com/rayon-rs/rayon/blob/main/RELEASES.md
- https://docs.rs/proptest/latest/proptest/attr.property_test.html

GPU/SWE research:
- https://arxiv.org/html/2506.23364 (weBIGeo WebGPU compute overlays)
- https://tympanus.net/codrops/2025/02/26/webgpu-fluid-simulations-high-performance-real-time-rendering/
- https://github.com/lisyarus/webgpu-shallow-water
- https://github.com/jgalazm/browni

Security:
- https://github.com/tauri-apps/tauri/security/advisories
- https://embarkstudios.github.io/cargo-deny/checks/cfg.html

## Open Questions

- **GEBCO REST API terms**: Rate limits, availability, and desktop app licensing need verification before committing as the solver bathymetry path. This could unblock F-V06.
- **MSVC linker in CI vs local**: The MSVC linker is present in GitHub Actions CI (the Rust job runs on `windows-latest`) but may not be available in all local dev environments. Items blocked on MSVC compilation can be developed via CI-verified PRs even if local `cargo check` isn't available.
