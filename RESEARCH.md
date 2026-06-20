# Research — TsunamiSimulator

## Executive Summary

TsunamiSimulator is a Tauri 2 + React 19 + CesiumJS + Rust desktop application that uniquely occupies the gap between consumer hazard visualization tools (NUKEMAP, Asteroid Launcher) and operational tsunami codes (GeoClaw, MOST, FUNWAVE-TVD). At v0.4.2, it delivers peer-reviewed source physics for four tsunami mechanisms, a CPU+GPU shallow-water solver, streaming SWE playback on a 3D globe, 10 historical presets, and validated Synolakis runup — with 13.3K LOC, comprehensive tests (Vitest, Playwright axe-core, Rust unit + validation benchmarks), and clean CI across three platforms.

The highest-value direction is **solver credibility + visualization depth + toolchain modernization**: integrate the newly available GEBCO REST API for real bathymetry without the blocked 440 MB download, add arrival-time isochrones and attenuation charts that no consumer tool offers, modernize the build toolchain (Vite 8 gives 10-30x faster builds), unblock the four `Roadmap_Blocked.md` items whose MSVC blocker was resolved on 2026-06-01, and harden the supply chain with `cargo-deny`.

Top opportunities in priority order:
1. Upgrade Vite 7→8 (10-30x build speed via Rolldown)
2. Add cargo-deny to CI (license + duplicate dep auditing)
3. Upgrade rayon 1.10→1.12 (par_array_windows for windowed physics)
4. Unblock property-based tests, commands.rs modularization, build-time demo data, and structured error reporting (MSVC resolved 2026-06-01)
5. Upgrade TypeScript 5.7→6.0 (strict defaults, Temporal types, prepares for 10x-faster TS 7.0)
6. GEBCO REST API for on-demand solver bathymetry (new 2026 API, partially unblocks F-V06)
7. Arrival-time isochrone overlay (table-stakes in operational tools, absent here)
8. Use Tauri emit_str* for faster SWE streaming IPC
9. Wave attenuation chart panel (complements globe with 1D visualization)
10. Scenario deep-link URL sharing

## Product Map

- **Core workflows**: Select preset or build custom scenario → configure source parameters → inspect source readout → run SWE simulation → scrub 24 snapshots → view runup/DART/inundation overlays → export PNG/share card/video/CZML/GeoJSON/text
- **User personas**: Science communicators, geoscience educators, students exploring tsunami physics, emergency-planning-adjacent users needing explicit "not operational" framing
- **Platforms**: Windows/macOS/Linux desktop via Tauri 2 (WebView2/WebKit/WebKitGTK); browser preview via `npm run dev` with deterministic demo data
- **Key integrations**: Rust physics → Tauri IPC (JSON) → React UI → CesiumJS globe; `tauri-plugin-store` for settings; optional Cesium ion token for satellite imagery; coarse offline bathymetry in `src-tauri/src/data/bathymetry.rs`

## Competitive Landscape

**GeoClaw** (Fortran/Python, BSD, 93 stars)
- Learn: AMR for multi-scale resolution, NTHMP-validated benchmark culture, explicit caution language, Boussinesq dispersive equations for short-wavelength tsunamis
- Avoid: Expert-only Fortran+Makefile setup; no GUI; compilation problems with modern GCC

**Celeris** (Direct3D/Unity, academic)
- Learn: Real-time interactive parameter adjustment during live simulation; concurrent simulation+visualization; VR support via Unity3D port
- Avoid: Windows-only Direct3D lock-in; dense expert-control UI; nearshore-only scope

**NUKEMAP** (Web, 20M+ users)
- Learn: Preset "quick chips" selector, ring-on-map visualization, scrollable statistics panel, shareable URLs, clean screenshot mode, floating map style switcher
- Avoid: No 3D; static rings without time evolution; no wave propagation physics

**Asteroid Launcher** (Web, neal.fun)
- Learn: Progressive scroll-to-reveal statistics cards with expanding map rings; minimal UI with instant gratification; zero-setup experience
- Avoid: No propagation physics; no save/share; no scientific detail or citations

**Tsunami-HySEA** (CUDA/SYCL, GPU-accelerated, University of Malaga)
- Learn: Faster-than-real-time on consumer GPUs (50-70x vs single CPU); SYCL portability; powers IH-Tsusy operational system
- Avoid: Complex GPU-required deployment

**BROWNI** (WebGL, open source, INRIA Chile)
- Learn: Proves GPU-accelerated tsunami SWE is feasible in-browser with no server; validated against COMCOT and MOST
- Avoid: Linear SWE only; no inundation; research paper, not polished product

**MOST/ComMIT** (NOAA operational, Java)
- Learn: Precomputed propagation database for instant scenario composition; ComMIT's simplified GUI designed for non-expert users in developing countries (UNESCO-funded)
- Avoid: Dated Java GUI; proprietary code; limited to precomputed scenarios

**FUNWAVE-TVD** (Fortran, BSD, 50 stars)
- Learn: Fully nonlinear Boussinesq equations capture dispersion effects SWE misses; MUSCL-TVD shock-capturing for wave breaking; USACE-approved
- Avoid: Fortran-only; no built-in visualization; MPI parallelism complexity

## Security, Privacy, and Reliability

- **Tauri core**: Running 2.11.2, past the May 2026 origin-confusion advisory (patched in 2.11.1). Patch 2.11.3 available (June 17, 2026) — minor. No new Tauri CVEs in 2025-2026.
- **CesiumJS**: Only CVE (2023-48094, XSS in demo sandbox code) is in demo files not shipped by this app. No library CVEs found through 2026.
- **wgpu**: Designed for browser-security-sensitive use. Exhaustive validation prevents undefined GPU behavior. No CVEs found.
- **Supply chain gap**: `cargo-audit` runs in CI but `cargo-deny` (license auditing, duplicate dependency detection, crate ban-lists) is absent. Microsoft Rust training and corgea.com recommend cargo-deny as baseline supply chain hygiene. Needs: `src-tauri/deny.toml` + CI job.
- **Vite/esbuild**: npm audit was cleaned to low-severity in the v0.4.0 hardening pass. Current lockfile resolves Vite 7.3.5 and esbuild 0.28.1, both past known advisory ranges.
- **demo.ts drift**: The 665-line `src/lib/demo.ts` reimplements simplified physics in JavaScript for browser preview. It carries an "APPROXIMATE" watermark but its numbers diverge from the Rust source of truth over time. A build-time Rust fixture generator (`[[bin]]` target, now unblocked by MSVC resolution) would eliminate this drift class.
- **Resolved blockers**: Four `Roadmap_Blocked.md` items cited "Needs MSVC linker" as their blocker. CLAUDE.md records MSVC as resolved since 2026-06-01 with `cargo check`/`cargo test`/`cargo clippy` and `gpu`/`validation` features all building locally. These items are now actionable: property-based tests (`physics/*.rs`), commands.rs modularization (`commands.rs`, 1742 lines), build-time demo data generation (`Cargo.toml` `[[bin]]`), and structured error reporting (`commands.rs` new IPC).

## Architecture Assessment

- **commands.rs** (1742 lines): Largest single file. Houses all 15 Tauri command handlers, request/response types, and validation logic. Modularization is tracked in `Roadmap_Blocked.md` but its MSVC blocker is resolved. Split target: `commands/{mod,types,validators,simulation,source,query}.rs`.
- **Globe.tsx** (~1000+ lines): Core globe coordination. Already migrated runup overlays to Cesium Primitive API (v0.4.2). CesiumJS 1.142's `BufferPrimitiveCollections` and `GeoJsonPrimitive` could further improve overlay performance if the coastal point database grows beyond 60 entries. The composable-hooks refactor remains blocked on visual verification.
- **demo.ts** (665 lines): JS physics reimplementation drifting from Rust. Replaceable with Rust-generated fixtures now that MSVC is resolved.
- **SWE IPC**: `simulate_grid_streaming` sends base64-encoded PNG snapshots over Tauri channels. Tauri 2.3.0's `emit_str*` methods could reduce serialization overhead for high-frequency snapshot delivery.
- **Bathymetry**: The coarse offline sampler (`bathymetry.rs`, 198 lines) uses bounding-box land detection and basin-mean depths. A newly published GEBCO REST API (2026 peer-reviewed paper) enables single-point and batch depth queries without downloading the full 440 MB grid, potentially bypassing the F-V06 distribution blocker.
- **Test coverage**: Vitest (8 component/lib test files), Playwright (5 axe-core WCAG checks + 5 smoke tests + 1 round-trip), Rust (unit tests per module + 6 feature-gated validation benchmarks + cargo-audit in CI). Gaps: property-based tests (proptest, now unblocked), Playwright CDP testing against actual Tauri WebView2 window (current tests run against vite preview only).
- **Dependency freshness**: CesiumJS 1.142 and Tauri 2.11 are current. Vite (7.3 vs 8.0 available), TypeScript (5.7 vs 6.0), and rayon (1.10 vs 1.12) have non-breaking upgrades with significant wins. React 19.2 adds `<Activity>` for panel state preservation. wgpu 29 is current; v30 (unreleased) will add i16/u16 shader support.

## Rejected Ideas

- **CubeCL Rust GPU DSL**: The SWE kernel is ~200 lines of WGSL, not complex enough to justify a DSL dependency. Source: CubeCL GitHub (tracel-ai/cubecl).
- **VR/AR tsunami visualization**: XL effort, niche audience, no evidence of demand in the educational tsunami space beyond one 2024 IEEE paper on the Noto earthquake. Source: IEEE Xplore 10760205.
- **ML-assisted wave field reconstruction (Senseiver)**: Requires training data the project doesn't have; research frontier, not consumer-ready. Source: arXiv 2411.12948.
- **Live parameter adjustment during running simulation (Celeris pattern)**: Would require fundamental solver architecture change from batch to incremental. The current batch-compute + scrub UX is appropriate for the educational purpose. Source: celeria.org.
- **Precomputed propagation database (MOST/ComMIT pattern)**: Requires GEBCO data + significant precomputation infrastructure for every source type/location combination. Better to improve the live solver and API-query bathymetry. Source: NOAA ComMIT documentation.
- **CoverageJSON export**: No evidence of user demand; NetCDF is the field standard and is already tracked as blocked. Source: OGC CoverageJSON standard.
- **WebGPU CesiumJS renderer**: Experimental branch, not stable for production. Monitor for future CesiumJS stable release. Source: CesiumJS GitHub.
- **Population casualty / multi-event / multi-language**: Already tracked in `Roadmap_Blocked.md` with appropriate blockers. Not duplicated here.
- **Plugin ecosystem**: No competitor in this niche shows strong plugin demand; would add API/versioning burden before core workflows are stable. Source: scan of 29 tools found zero plugin-based tsunami simulators.

## Sources

OSS tsunami simulators:
- https://www.clawpack.org/geoclaw.html
- https://github.com/fengyanshi/FUNWAVE-TVD
- https://github.com/jagurs-admin/jagurs
- https://github.com/adcirc/adcirc
- https://github.com/Deltares/Delft3D
- https://github.com/jgalazm/browni
- https://plynett.github.io/
- https://egusphere.copernicus.org/preprints/2025/egusphere-2025-3900/

Consumer/educational tools:
- https://nuclearsecrecy.com/nukemap/
- https://neal.fun/asteroid-launcher/
- https://impact.ese.ic.ac.uk/ImpactEarth/
- https://inria.cl/en/tsunamilab
- https://ihcantabria.com/en/specialized-software/ihtsusy/

Standards, data, and APIs:
- https://www.gebco.net/data-products/gridded-bathymetry-data
- https://www.sciencedirect.com/science/article/pii/S2665963826000291
- https://www.weather.gov/nthmp/SubMapModel
- https://github.com/rjleveque/nthmp-benchmark-problems
- https://tsunami.ioc.unesco.org/en

Dependency releases:
- https://vite.dev/blog/announcing-vite8
- https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/
- https://react.dev/blog/2025/10/01/react-19-2
- https://github.com/rayon-rs/rayon/blob/main/RELEASES.md
- https://github.com/gfx-rs/wgpu/releases
- https://github.com/CesiumGS/cesium/releases
- https://github.com/tauri-apps/tauri/releases

Security and supply chain:
- https://github.com/tauri-apps/tauri/security/advisories
- https://corgea.com/learn/rust-security-best-practices-2025
- https://microsoft.github.io/RustTraining/engineering-book/ch06-dependency-management-and-supply-chain-s.html

Academic / GPU compute:
- https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2019MS001957
- https://www.researchgate.net/publication/383119584
- https://rustify.rs/articles/rust-gpu-computing-wgpu-2026

## Open Questions

- **GEBCO REST API terms**: The newly published GEBCO REST API enables on-demand depth queries, but its rate limits, availability guarantees, and licensing for integration into a desktop app need verification before committing to it as the solver bathymetry path. This could partially or fully unblock F-V06.
- **Vite 8 + CesiumJS compatibility**: CesiumJS uses a 4.1 MB manual chunk split via Rollup's `manualChunks`. Rolldown is broadly Rollup-compatible but edge cases exist. Needs a test build before committing to the upgrade.
