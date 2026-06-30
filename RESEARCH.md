# Research — TsunamiSimulator

## Executive Summary
TsunamiSimulator is a Tauri 2 desktop simulator that combines Rust tsunami-source and shallow-water physics with a React/Cesium globe for education, technical review, and non-operational exploration. Its strongest current shape is the trust-centered cockpit: cited source models, guided lessons, SWE playback, DART/runup overlays, user gauges, provenance-stamped exports, settings migrations, and local verification tooling. Highest-value direction remains reliability and trust hardening before larger physics bets: (1) restore the broken `npm run doctor` preflight, (2) surface Rust solver diagnostics in the frontend LogViewer, (3) replace silent Promise catch blocks with logged diagnostics, (4) repair public docs that link to gitignored or local-only files, (5) make Rust advisory/license checks enforceable for release verification, (6) sign Windows artifacts through Azure Artifact Signing and publish winget metadata, (7) persist lesson completion and finish classroom handout/glossary/export polish, (8) migrate dense Cesium overlays to Buffer primitive APIs, (9) add desktop deep-link import for shared scenarios, and (10) add verification gates that prevent docs, scripts, and CSP security assumptions from drifting.

## Product Map
- Core workflows: choose a historical preset or custom source; run/stream the SWE solver; scrub propagation on a Cesium globe; inspect DART/runup/gauge traces; export PNG/share card/video/CZML/GeoJSON/KML/CSV/scenario URLs; compare two scenarios side-by-side.
- User personas: educators building classroom demos; technically curious public users comparing speculative scenarios; reviewers checking formulas, citations, validation limits, diagnostics, and release artifacts.
- Platforms and distribution: Windows desktop via Tauri MSI/NSIS, unsigned at v0.4.4; macOS/Linux source build paths; browser preview mode with deterministic demo data and approximate watermark.
- Key integrations and data flows: React controls -> typed Tauri IPC -> Rust source physics/SWE solver; `tauri-plugin-store` settings; Cesium terrain/imagery with Natural Earth fallback; local coastal/DART JSON datasets; shell-open citation links gated by Tauri capabilities.

## Competitive Landscape
- GeoClaw: rigorous tsunami shallow-water modeling, AMR, wetting/drying, gauges, fgmax outputs, KML tooling, and explicit cautionary docs. Learn its gauge semantics and limitation framing; avoid its expert-only Fortran/Python setup friction.
- Celeris-WebGPU: real-time Boussinesq/NLSW WebGPU simulation with bathymetry upload, field switching, vector arrows, time-series probes, image stacks, and raw data export. Learn from its probe/export depth and GPU immediacy; avoid importing its dense coastal-engineering control surface.
- NOAA MOST/SIFT: operational pattern around precomputed propagation databases, DART-constrained source refinement, and output expectations such as arrival, wave height, inundation, current speed, and time series. Learn the DART confidence-loop pattern; avoid any operational forecast positioning.
- FUNWAVE-TVD, JAGURS, and ANUGA: open models with stronger nearshore/coastal science coverage, documented setup, benchmarks, Boussinesq/nesting/HPC options, and community channels. Learn their validation/tutorial cadence and parameter-safety emphasis; avoid requiring HPC or GIS expertise for the core user path.
- Delft3D/TUFLOW/MIKE 21: professional hydrodynamic suites emphasize GUI map editors, online data connectivity, validated service packages, flexible mesh workflows, GPU acceleration, and support channels. Learn from packaging, support, and data-management expectations; avoid becoming a full professional coastal-modeling suite.
- NUKEMAP, Impact: Earth, and Asteroid Launcher: public-facing hazard simulators reduce complex physics into memorable parameter selection, mapped effects, share/export paths, and visible uncertainty cues. Learn shareability and progressive disclosure; avoid casualty/population overlays without a separate ethical/data decision.
- PhET: education-first simulation ecosystem with accessibility, offline access, translations, and teacher activities. Learn classroom handouts, glossary scaffolding, progress cues, and non-mouse access; defer full i18n until UI strings and translation workflow are stable.

## Security, Privacy, and Reliability
- Verified: `package.json` defines `"doctor": "node scripts/doctor.mjs"` and `README.md:161` advertises `npm run doctor`, but `scripts/doctor.mjs` is absent and local `npm run doctor` fails with `MODULE_NOT_FOUND`.
- Verified: Rust-side diagnostics are invisible in the app. `src-tauri/src/physics/solver/gpu.rs` and `src-tauri/src/physics/solver/mod.rs` still use `eprintln!` for GPU fallback, readback, and PNG encode failures while `src/components/LogViewer.tsx` captures frontend console entries.
- Verified: silent Promise catch blocks remain in `src/main.tsx`, `src/App.tsx`, `src/components/ScenarioBuilder.tsx`, and `src/components/SwePlayback.tsx`, hiding token/settings/tour/cancel failures from diagnostics.
- Verified: public docs need truth repair. `README.md:230-231` links `COMPLETED.md` and `RESEARCH_REPORT.md`, which are gitignored/local-only, and `CONTRIBUTING.md:130` points to gitignored/local-only `SECURITY.md`. The tracked issue templates now exist, so older research claiming `.github/ISSUE_TEMPLATE/` was absent is stale.
- Verified: `npm audit --audit-level=moderate` reports 0 vulnerabilities, but `npm run deps-check` reports 13 outdated npm packages and missing `cargo-audit` / `cargo-deny` binaries. `scripts/verify.mjs:166-175` currently skips Rust advisory/license checks when those tools are missing even though `src-tauri/deny.toml` is configured.
- Verified: `src-tauri/tauri.conf.json:28` keeps Cesium-driven CSP allowances (`script-src 'unsafe-eval'`, `style-src 'unsafe-inline'`). Treat these as documented platform constraints with a regression guard, not as quick-removal candidates.
- Missing guardrails: no restored local doctor, skipped Rust advisory tooling unless manually installed, unsigned Windows installers, no winget distribution, no docs/script truth gate, no CSP allowlist guard, and no settings export/import recovery path yet.
- Recovery and rollback needs: settings migrations exist, but classroom deployment still needs settings export/import; release trust still needs signed installers, checksums, and install-channel verification.

## Architecture Assessment
- Large files remain pressure points: `src/styles.css` is 3,291 lines, `src-tauri/src/commands.rs` is 1,742 lines, `src/components/Globe.tsx` is 1,074 lines, `src-tauri/src/physics/solver/mod.rs` is 1,005 lines, and `src/App.tsx` is 751 lines. The live roadmap already covers CSS splitting; `Roadmap_Blocked.md` correctly keeps Globe/commands splits behind visual/Rust verification.
- Gauge architecture is split: browser/demo gauge traces come from `src/lib/demo.ts::sampleGaugesFromDemo`, while Rust SWE snapshots expose PNG eta fields but not raw eta samples. This is the same root cause as the blocked DART RMSE sparkline item in `Roadmap_Blocked.md`.
- Export architecture is broad but not complete for current workflows: single-run exports are strong; compare mode and installed-app scenario opening are still missing. Tauri deep-linking is a fit for importing shared scenario URLs into the desktop app.
- Testing is materially stronger than earlier runs with Vitest and Playwright visual coverage, but the broken doctor command means the advertised preflight path is untested. Add coverage around any restored doctor script, docs/script truth guard, CSP guard, and deep-link parser.
- Documentation gaps are concrete, not stylistic: README/CONTRIBUTING link targets must match tracked files because `.gitignore` intentionally keeps most markdown local-only.

## Rejected Ideas
- Plugin ecosystem: rejected because the app's value comes from cited, bounded physics and a small Tauri permission surface; no competitor evidence justifies extension risk now.
- Mobile-native app: rejected because the current app is a desktop Cesium cockpit with a 1200x800 Tauri minimum window and dense solver controls.
- Multi-user/collaboration: rejected because no local workflow or competitor signal ranks it above reliability, exports, signing, and classroom workflows.
- Full i18n/l10n now: rejected for now; PhET shows the value, but TsunamiSimulator needs a string catalog and stable UI copy first.
- Operational forecast mode or NOAA-style propagation database: rejected because NOAA MOST/SIFT is operational infrastructure, while this app is explicitly non-operational education/review software.
- Casualty/population overlay: rejected because NUKEMAP shows demand but this would require an ethical/data-source decision and stronger misuse framing.
- NetCDF export now: rejected because `Roadmap_Blocked.md` documents the cross-platform `netcdf-sys`/C-library build burden; existing CZML/GeoJSON/KML/CSV cover current workflows.
- GeoPackage export now: rejected because OGC GeoPackage is useful for GIS interop, but adding SQLite/geopackage dependency weight is lower value than fixing broken preflight, diagnostics, signing, and existing export gaps.
- Offline terrain/bathymetry packs now: rejected because packaged GEBCO/bathymetry distribution is already blocked in `Roadmap_Blocked.md`; keep the Natural Earth/browser fallback path until artifact size and licensing are settled.
- Direct WebGPU browser solver replacement: rejected because Celeris-WebGPU is compelling, but TsunamiSimulator's architecture intentionally keeps authoritative physics in Rust/Tauri.
- GitHub Actions build/release workflows: rejected because repo policy and history keep builds local; roadmap should improve local verification and artifact trust instead.

## Sources
### Project
- https://github.com/SysAdminDoc/TsunamiSimulator

### OSS and research models
- https://www.clawpack.org/geoclaw.html
- https://www.clawpack.org/geohints.html
- https://plynett.github.io/
- https://fengyanshi.github.io/build/html/index.html
- https://nctr.pmel.noaa.gov/model.html
- https://nctr.pmel.noaa.gov/tsunami-forecast.html
- https://github.com/jagurs-admin/jagurs
- https://raw.githubusercontent.com/GeoscienceAustralia/anuga_core/main/README.rst

### Commercial, adjacent, and educational tools
- https://www.tuflow.com/products/tuflow-fv/
- https://www.deltares.nl/en/software-and-data/products/delft3d-flexible-mesh-suite
- https://www.dhigroup.com/technologies/mikepoweredbydhi/mike-21-3
- https://nuclearsecrecy.com/nukemap/
- https://www.purdue.edu/impactearth/
- https://phet.colorado.edu/
- https://neal.fun/asteroid-launcher/

### Standards, platform, dependencies, and security
- https://www.gebco.net/data-products/gridded-bathymetry-data
- https://www.ogc.org/standards/geopackage/
- https://cfconventions.org/
- https://cesium.com/blog/2026/04/01/cesium-releases-in-april-2026/
- https://community.cesium.com/t/pointprimitive-vs-entity-performance/26455
- https://v2.tauri.app/security/
- https://v2.tauri.app/plugin/updater/
- https://v2.tauri.app/plugin/deep-linking/
- https://azure.microsoft.com/en-us/products/artifact-signing
- https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options
- https://rustsec.org/
- https://github.com/RustSec/rustsec/tree/main/cargo-audit
- https://github.com/EmbarkStudios/cargo-deny
- https://docs.npmjs.com/cli/v11/commands/npm-audit/

## Open Questions
None.
