# Research — TsunamiSimulator

## Executive Summary
Verified: TsunamiSimulator is a Tauri 2 desktop simulator that pairs Rust source and shallow-water physics with a React/Cesium educational cockpit for non-operational tsunami exploration. Its strongest current shape is trust-centered: cited presets, model-limitations copy, guided lessons, SWE playback, DART/runup/gauge overlays, provenance exports, settings migrations, Tauri shell URL policy tests, and broad local verification. Highest-value direction remains reliability before larger physics: (1) restore the missing `npm run doctor`, (2) stabilize the failing Playwright visual gate, (3) make gauge CSVs use Rust SWE samples instead of demo sampling, (4) repair public docs pointing at ignored/local files, (5) enforce Rust advisory/license checks in strict release mode, (6) sign/package Windows releases through Azure Artifact Signing and winget, (7) persist guided-lesson completion, (8) finish classroom accessibility/export polish, (9) migrate dense Cesium overlays to Buffer*Collection primitives, and (10) keep GEBCO, Boussinesq, AMR, NetCDF, i18n, mobile, multi-user, and plugin bets deferred until the active trust gaps are closed.

## Product Map
- Core workflows: choose a historical/speculative preset or custom source; run/stream SWE propagation; scrub snapshots on a Cesium globe; inspect DART, runup, user gauge, comparison, and attenuation views; export PNG, share card, video, CZML, GeoJSON, KML, CSV, text, and scenario URLs.
- User personas: educators and students; technically curious public users; reviewers checking equations, citations, validation limits, diagnostics, and release artifacts.
- Platforms and distribution: Windows/macOS/Linux Tauri desktop; Vite browser preview with deterministic approximate data; local Tauri MSI/NSIS/AppImage/DMG release builds. Current public Windows artifacts remain unsigned.
- Key integrations and data flows: React controls -> typed Tauri IPC -> Rust physics/SWE solver; `tauri-plugin-store` settings; Cesium imagery/terrain with Natural Earth fallback; local coastal/DART JSON datasets; Tauri shell-open capability synchronized to `src/lib/external-link-policy.json`.

## Competitive Landscape
- GeoClaw: strong AMR, wetting/drying, gauges, fgmax, KML/Google Earth plotting, topography, and explicit research-tool disclaimers. Learn its gauge/fgmax output semantics and limitation framing; avoid its expert-only setup friction.
- Celeris-WebGPU/BROWNI: real-time client GPU wave simulation with probe/export workflows and browser deployment. Learn from immediate probe/field export UX; avoid replacing TsunamiSimulator's Rust-authoritative desktop physics with browser-only solver authority.
- NOAA MOST/SIFT/DART: operational pattern around precomputed propagation databases, DART-constrained source refinement, and arrival/amplitude/velocity/time-series products. Learn the DART confidence-loop and forecast-product vocabulary; avoid operational forecast claims.
- FUNWAVE-TVD, JAGURS, Tsunami-HySEA, ANUGA, and SFINCS: open/research models cover Boussinesq, nesting, MPI/OpenMP/GPU/HPC, wetting/drying, benchmarks, and flood workflows. Learn validation/tutorial cadence and parameter safety; avoid making HPC/GIS expertise mandatory for the default classroom path.
- Delft3D FM, TUFLOW FV, MIKE 21/3, and FLOW-3D HYDRO: professional suites emphasize map editors, online data connectivity, flexible meshes, GPU/3D options, service packages, and support channels. Learn packaging/support and data-management expectations; avoid becoming a professional coastal-engineering suite.
- NUKEMAP, Impact: Earth, and Asteroid Launcher: public hazard simulators turn complex parameters into shareable mapped effects with progressive disclosure. Learn shareability and uncertainty cues; avoid casualty/population overlays without a separate ethics/data decision.
- PhET: education-first simulations emphasize accessibility, offline use, translations, teacher material, and scaffolded concepts. Learn glossary, print/handout, progress, and non-mouse patterns; defer full i18n until string extraction and copy workflow are stable.

## Security, Privacy, and Reliability
- Verified: `package.json` defines `"doctor": "node scripts/doctor.mjs"` and `README.md` advertises `npm run doctor`, but `scripts/doctor.mjs` is absent. Local `npm run doctor` on 2026-07-01 fails with `MODULE_NOT_FOUND`.
- Verified: `npm run test:e2e -- tests/visual-regression.spec.ts --reporter=line` failed 7 of 11 screenshots on 2026-07-01 (`desktop-preset-active`, `desktop-swe-ready`, `desktop-swe-running`, `narrow-first-run`, `narrow-preset-active`, `narrow-settings`, `narrow-citations`). This blocks trustworthy visual/UI roadmap work.
- Verified: user gauge CSVs are not sampled from Rust SWE fields. `src/components/SwePlayback.tsx:96-104` always calls `sampleGaugesFromDemo(...)`, and `src/lib/export.ts` labels desktop output as `"Backend SWE solver"`. Rust `GridSnapshot` exposes `eta_png_b64` but not raw eta samples, matching the blocked DART RMSE prerequisite in `Roadmap_Blocked.md`.
- Verified: `npm run deps-check` on 2026-07-01 reports 13 outdated npm packages, Vite latest at 8.1.2, `cargo-audit` installed, `cargo-deny` missing, and `npm audit --audit-level=moderate` clean.
- Verified: `scripts/verify.mjs` still skips `cargo-audit`/`cargo-deny` when absent. This is acceptable for casual dev checks only if strict/release verification fails closed.
- Verified: `src-tauri/tauri.conf.json` allows Cesium-driven `unsafe-eval`, inline styles, and specific remote imagery/terrain hosts. Tauri CSP docs make CSP a security control; treat these as documented constraints with a regression allowlist, not quick-removal work.
- Verified: Tauri shell-open URL policy already has a unit guard in `src/lib/__tests__/external-links.test.ts`; do not add duplicate policy-parity work.
- Verified: public README/CONTRIBUTING still reference ignored/local-only markdown (`COMPLETED.md`, `RESEARCH_REPORT.md`, `SECURITY.md`). Existing active roadmap covers the repair; older claims that issue templates are absent are stale because `.github/ISSUE_TEMPLATE/*.yml` exists.
- Missing guardrails: restored doctor script, stable visual baselines, Rust-derived gauge series, strict Rust advisory/license mode, docs/script truth gate, CSP allowlist guard, signed Windows artifacts, install-channel verification, and classroom settings export/import.
- Recovery and rollback needs: settings migrations exist, but classroom deployment still needs settings export/import; release trust still needs signed installers, checksums, and a package-manager path.

## Architecture Assessment
- Verified large-file pressure points: `src/styles.css` is 2,890 lines, `src-tauri/src/commands.rs` 1,711 lines, `src/components/Globe.tsx` 1,002 lines, and `src-tauri/src/physics/solver/mod.rs` 974 lines. Active roadmap already covers CSS splitting; `Roadmap_Blocked.md` correctly holds Globe/commands splits behind visual/Rust verification.
- Verified test architecture is broad but brittle at the visual layer: `tests/visual-regression.spec.ts` mixes axe checks and full-page screenshots, masks only `.cesium-widget canvas`, and uses tight diff thresholds while `playwright.config.ts` has no project-specific screenshot stabilization beyond disabled animations.
- Verified SWE data boundary is too image-oriented for analysis exports: Rust snapshots serialize PNGs for rendering, while gauge and DART analytical workflows need raw eta samples. Adding sample points to the simulation request/streaming response would fix user gauges and unblock later DART RMSE display.
- Verified export architecture is broad for single scenarios but incomplete for current workflows: compare mode has no combined export, and installed desktop builds cannot open shared scenario URLs without the existing Tauri deep-link roadmap item.
- Verified dependency posture: `npm audit` is clean, but npm minor/patch drift and missing `cargo-deny` keep the manual dependency cadence active.
- Documentation gaps are concrete: public README/CONTRIBUTING links must point only to tracked files or live URLs because `.gitignore` intentionally keeps most root markdown local-only.

## Rejected Ideas
- Plugin ecosystem: rejected because cited, bounded physics and a small Tauri permission surface are more valuable than third-party extension risk; no competitor made plugins table-stakes.
- Mobile-native app: rejected because the current app is a dense desktop Cesium cockpit with a 1200x800 Tauri minimum window and heavy solver/export controls.
- Multi-user/collaboration: rejected because no local workflow or competitor signal outranks reliability, exports, signing, and classroom workflows.
- Full i18n/l10n now: rejected for now; PhET shows value, but TsunamiSimulator needs a stable string catalog and copy workflow first.
- Operational forecast mode or NOAA-style propagation database: rejected because NOAA MOST/SIFT is operational infrastructure and TsunamiSimulator is explicitly non-operational education/review software.
- Casualty/population overlay: rejected because NUKEMAP shows public interest, but this needs an ethical/data-source decision and stronger misuse framing.
- NetCDF export now: rejected because `Roadmap_Blocked.md` documents the cross-platform `netcdf-sys`/C-library build burden; existing CZML/GeoJSON/KML/CSV/text exports cover current workflows.
- GeoPackage export now: rejected because GIS interop is useful, but SQLite/GeoPackage dependency weight is lower value than fixing preflight, visual verification, gauge provenance, signing, and current export gaps.
- Offline GEBCO/bathymetry packs now: rejected because packaged GEBCO/TID distribution is already blocked; keep Natural Earth/browser fallback until artifact size and licensing are settled.
- Direct WebGPU browser solver replacement: rejected because Celeris-WebGPU is compelling, but this project's architecture intentionally keeps authoritative physics in Rust/Tauri.
- GitHub Actions build/release workflows: rejected because repo policy keeps builds local; improve local verification and artifact trust instead.

## Sources
### Project
- https://github.com/SysAdminDoc/TsunamiSimulator

### OSS and Research Models
- https://www.clawpack.org/geoclaw
- https://www.clawpack.org/googleearth_plotting.html
- https://github.com/mandli/tsunami-models
- https://plynett.github.io/
- https://fengyanshi.github.io/
- https://nctr.pmel.noaa.gov/tsunami-forecast.html
- https://nctr.pmel.noaa.gov/propagation-database.html
- https://github.com/jagurs-admin/jagurs
- https://github.com/edanya-uma/Tsunami-HySEA
- https://github.com/geoscienceaustralia/anuga_core
- https://sfincs.readthedocs.io/en/latest/overview.html

### Commercial, Adjacent, and Educational Tools
- https://www.deltares.nl/en/software-and-data/products/delft3d-flexible-mesh-suite
- https://www.tuflow.com/products/tuflow-fv/
- https://www.dhigroup.com/technologies/mikepoweredbydhi/mike-21-3
- https://www.flow3d.com/products/flow-3d-hydro/ports-and-coastal/
- https://nuclearsecrecy.com/nukemap/
- https://neal.fun/asteroid-launcher/
- https://www.purdue.edu/impactearth/
- https://phet.colorado.edu/en/inclusive-design

### Standards, Platform, Dependencies, and Security
- https://www.gebco.net/data-products/gridded-bathymetry-data
- https://cfconventions.org/
- https://v2.tauri.app/plugin/deep-linking/
- https://v2.tauri.app/security/csp/
- https://cesium.com/blog/2026/06/01/cesium-releases-in-june-2026/
- https://playwright.dev/docs/test-snapshots
- https://vite.dev/releases
- https://rustsec.org/
- https://embarkstudios.github.io/cargo-deny/checks/advisories/cfg.html
- https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html

## Open Questions
- None blocking prioritization. Signing credentials, GEBCO distribution, full i18n, NetCDF, Boussinesq/AMR, and mobile/multi-user directions are already either active roadmap work or intentionally held in `Roadmap_Blocked.md`.
