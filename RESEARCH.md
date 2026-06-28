# Research - TsunamiSimulator

## Executive Summary
TsunamiSimulator is a Tauri 2 desktop education simulator with a strong current core: Rust-owned tsunami physics, React/Cesium globe visualization, historical presets, custom scenarios, streaming SWE playback, DART/runup overlays, exports, citations, diagnostics, first-run safety framing, and a local verification gate. The highest-value direction is trust and evidence discipline before larger science bets: keep shipped docs aligned with v0.4.4, finish citation/external-link hardening, make every result/export carry model provenance, refresh bathymetry language to GEBCO_2026, add settings migration, and add guided classroom workflows. New opportunities from this pass are: fix stale shipped-science docs, add unsigned-installer checksum guidance, introduce a manual dependency refresh cadence after removing Dependabot, and add user-placed gauges/time-series exports once the solver can return sampled values.

## Product Map
- Core workflows: select a preset; build an asteroid/nuclear/earthquake/landslide scenario; run or stream SWE snapshots; inspect globe/runup/DART outputs; export PNG, share-card, video, text, CZML, GeoJSON, KML, or scenario URL.
- User personas: educators and curious public users needing strong model-limit framing; technically literate hobbyists comparing speculative scenarios; reviewers checking formulas, citations, validation, and release artifacts.
- Platforms and distribution: Tauri desktop for Windows/macOS/Linux, deterministic browser preview, public GitHub repo with v0.4.4 release assets built locally and unsigned, plus source builds for non-Windows platforms.
- Key integrations and data flows: React controls -> typed Tauri IPC -> Rust physics/solver modules; Cesium globe with local Natural Earth default and optional Cesium ion styles; `tauri-plugin-store` settings; static coastal/DART datasets; shell-open citation URLs gated by Tauri capabilities.

## Competitive Landscape
- GeoClaw: strong AMR, wetting/drying, topography workflows, KML/Google Earth tooling, gauges, and explicit research/teaching disclaimers. Learn from its validation/provenance posture and gauge outputs; avoid expert-only setup friction.
- NOAA MOST/ComMIT/SIFT: strong operational forecast pattern: precomputed source databases, DART-constrained source refinement, arrival/height/inundation/current outputs, and high-resolution topo/bathy for inundation. Learn from output semantics and DART confidence loops; avoid implying evacuation suitability.
- Celeris / Celeris-WebGPU: strong interactive GPU wave modeling, Boussinesq/NLSW experimentation, example loading, live controls, and built-in time-series plots. Learn from immediate gauges/probes and experiment ergonomics; avoid a dense coastal-engineering control surface.
- FUNWAVE-TVD / JAGURS / ANUGA: strong dispersive models, nesting, wetting/drying, benchmark culture, and HPC-oriented file workflows. Learn from benchmark discipline and nested-resolution architecture; keep these as later science tracks until data and validation are ready.
- NUKEMAP / Impact: Earth / Asteroid Launcher: strong simple setup, memorable visual scale, shareability, and uncertainty framing. Learn from guided scenario storytelling and fast comprehension; avoid casualty overlays without explicit ethics/product review.
- TUFLOW FV / Delft3D FM: strong flexible meshes, GIS interoperability, professional support, and production hydrodynamics. Learn from GIS export/import expectations; avoid commercial-suite breadth that would dilute the focused education product.
- CesiumJS platform: Cesium 1.142 adds large-vector paths such as `GeoJsonPrimitive` and MVT data support. Learn from this before future flood-vector rendering; avoid churn while current runup/inundation overlays remain modest.

## Security, Privacy, and Reliability
- Verified: GitHub release v0.4.4 is now public with SHA256 values and notes that MSI/NSIS installers are unsigned; README/CODESIGNING explain unsigned warnings, but users would benefit from local checksum verification steps beside the install instructions.
- Verified: `npm audit --audit-level=moderate --json` is clean after the DOMPurify override; previous research claiming an active npm advisory is stale.
- Verified: `cargo audit` and `cargo deny` are not installed in this environment, while `scripts/verify.mjs` only runs them when present. The existing doctor roadmap item remains valid.
- Verified: `npm outdated --json` shows small patch/minor drift in Tauri, Vite, Playwright, axe, React types, and lint tooling. Dependabot was intentionally removed, so manual dependency review needs a lightweight cadence.
- Verified: `src-tauri/capabilities/default.json` and `src/components/CitationsModal.tsx` are already being edited in the worktree toward exact citation URLs and explicit legacy HTTP exceptions. Keep the existing roadmap item until tests prove the policy and UI fail closed.
- Verified: `src/lib/settings.ts` validates individual keys and avoids desktop `cesium_token` mirroring, but settings have no store-level schema version or migration history. The existing settings-migration item remains high value.
- Verified: `src/lib/export.ts` and `src/lib/text-export.ts` carry model-limit text unevenly across output formats. The existing shared-provenance item remains high value.
- Verified: `tests/smoke.spec.ts` provides smoke and axe coverage, but visual-regression coverage for screenshots, modal clipping, toolbar density, and light/dark states remains manual.

## Architecture Assessment
- Verified: the primary architecture boundary is still correct: authoritative physics in Rust (`src-tauri/src/physics/*`, `src-tauri/src/commands.rs`) and rendering/control state in React/Cesium (`src/*`).
- Verified: large files remain refactor candidates: `src/styles.css`, `src-tauri/src/commands.rs`, `src/components/Globe.tsx`, `src-tauri/src/physics/solver/mod.rs`, and `src/App.tsx`. The blocked roadmap correctly parks the riskiest splits behind visual/Rust verification.
- Verified: docs drift is now the clearest low-risk quality gap: `README.md` still says Okada is planned and wgpu is planned, `data/bathymetry/README.md` still targets GEBCO 2024/v0.3.0, `src-tauri/src/presets.rs` says Hunga Tonga Lamb-wave coupling is planned even though the UI exposes it, and validation comments still mention a per-PR CI loop after local-only verification.
- Verified: bathymetry documentation still references GEBCO 2024 in `data/bathymetry/README.md`, `src/data/coastal_points.json`, and `src-tauri/src/data/bathymetry.rs`; GEBCO_2026 is current, has a TID grid, and should anchor future confidence/provenance language.
- Verified: user-placed gauge/time-series output is absent. This is a notable gap versus NOAA/GeoClaw/Celeris patterns and would strengthen DART comparison, classroom exercises, and exports once the solver exposes sampled eta series.
- Verified: browser-preview physics remains a controlled carve-out in `src/lib/demo.ts`, and `AttenuationChart.tsx` duplicates far-field attenuation visually. Keep them visibly approximate until generated Rust fixtures or IPC-backed chart data are practical.

## Rejected Ideas
- Restore GitHub Actions workflows as the default release path: rejected because the repo intentionally moved to local builds; improve local verification, checksum guidance, and manual release steps instead.
- Full GEBCO local download/solver loader now: already blocked by artifact/distribution decisions; first update docs/provenance to GEBCO_2026/TID and keep coarse bathymetry honest.
- Boussinesq, AMR, NTHMP benchmark suite, and real flood polygons now: scientifically valuable but already blocked by data, validation, and solver architecture dependencies.
- NetCDF export now: useful for interoperability, but the existing blocked item correctly notes `netcdf-sys`/C-library packaging friction; strengthen CZML/GeoJSON/KML/text and gauge CSV first.
- Casualty or population overlay: sourced from NUKEMAP-style demand but ethically sensitive and currently less valuable than trust, provenance, validation, and guided education.
- Plugin ecosystem: contradicts the citation-verified physics boundary and adds security/maintenance surface before there is extension demand.
- Mobile-native app: educational tools benefit from mobile reach, but this product currently depends on a desktop Tauri/Cesium cockpit with a 1200x800 minimum window.
- Multi-user/collaboration: common in commercial suites, but no current repo or education-tool evidence puts it above local reliability, exports, data provenance, and lesson workflows.
- Full i18n/l10n now: valuable later, especially for Japan/Tohoku education, but the blocked roadmap already parks it behind a stable UI string catalog.

## Sources
### Project
- https://github.com/SysAdminDoc/TsunamiSimulator
- https://github.com/SysAdminDoc/TsunamiSimulator/releases

### OSS / research models
- https://www.clawpack.org/geoclaw.html
- https://nctr.pmel.noaa.gov/model.html
- https://nctr.pmel.noaa.gov/ComMIT/
- https://plynett.github.io/
- https://www.celeria.org/
- https://fengyanshi.github.io/build/html/index.html
- https://github.com/jagurs-admin/jagurs
- https://github.com/GeoscienceAustralia/anuga_core
- https://github.com/mandli/tsunami-models

### Operational / commercial / education tools
- https://nuclearsecrecy.com/nukemap/
- https://blog.nuclearsecrecy.com/2026/02/10/nukemap-roadmap/
- https://neal.fun/asteroid-launcher/
- https://www.purdue.edu/impactearth/
- https://www.tuflow.com/products/tuflow-fv/
- https://www.deltares.nl/en/software-and-data/products/delft3d-flexible-mesh-suite

### Standards, data, dependencies, security
- https://www.gebco.net/data-products/gridded-bathymetry-data
- https://cesium.com/blog/2026/06/01/cesium-releases-in-june-2026/
- https://v2.tauri.app/security/
- https://v2.tauri.app/plugin/shell/
- https://v2.tauri.app/distribute/
- https://www.ogc.org/standards/geotiff/
- https://www.ogc.org/standards/geopackage/
- https://cfconventions.org/
- https://github.com/axodotdev/cargo-dist
- https://github.com/advisories/GHSA-cmwh-pvxp-8882

## Open Questions
- Needs maintainer decision: should unsigned v0.4.x installers remain public with checksum guidance, or should public binaries pause until Authenticode/macOS signing is available?
- Needs maintainer decision: is GEBCO_2026 via GitHub Releases acceptable despite large artifacts, or should the first-run bathymetry loader target external object storage?
- Needs implementation validation: should user-placed gauges sample raw SWE eta values from Rust snapshots, or is a lower-fidelity analytical preview acceptable for browser-only lessons?
