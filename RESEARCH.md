# Research - TsunamiSimulator

## Executive Summary
TsunamiSimulator is a Tauri 2 desktop tsunami education simulator with a strong current shape: Rust owns the physics, React/Cesium owns the globe cockpit, and the product already has presets, custom scenarios, shallow-water playback, DART/runup overlays, exports, citations, first-run safety messaging, diagnostics, and accessibility tests. The highest-value direction is trust and maintainability before new science: clear the active DOMPurify advisory, sync public docs/screenshots/release truth to v0.4.4, make tests and manuals match the current "Run solver" UI, tighten external-link capability handling, make every result/export carry explicit model provenance and limitations, refresh the bathymetry plan to GEBCO_2026/TID reality, add a local toolchain doctor, then use Cesium 1.142's new primitive/vector-tile path when larger overlays arrive.

## Product Map
- Core workflows: choose a historical/speculative preset; build a custom asteroid/nuclear/earthquake/landslide source; run/scrub SWE playback; inspect globe/runup/DART outputs; export/share PNG, share-card, video, text, CZML, GeoJSON, KML, and URLs.
- User personas: educators and curious public users needing clear safety framing; technically literate hobbyists comparing scenarios; researchers/reviewers checking formulas, citations, and validation limits.
- Platforms and distribution: Tauri desktop on Windows/macOS/Linux; browser preview for deterministic demo frames; GitHub Releases currently list v0.4.0 while repo/app metadata is v0.4.4.
- Key integrations and data flows: React -> typed Tauri IPC -> Rust source/solver modules; CesiumJS globe with local Natural Earth default and optional Cesium ion imagery/bathymetry; local tauri-plugin-store settings; static coastal/DART data; citation links opened through Tauri shell allowlist.

## Competitive Landscape
- GeoClaw: excels at AMR, wetting/drying, topography workflows, Google Earth/KML tooling, and explicit research/teaching disclaimers. Learn from its validation/provenance posture and topo workflow; avoid exposing research-grade knobs without guardrails.
- NOAA MOST/ComMIT/SIFT: excels at operational forecast workflows, precomputed scenario databases, DART-constrained source updates, tabular/graphical outputs, and high-resolution topo/bathy for inundation. Learn from arrival/height/current/inundation output semantics; avoid implying operational suitability.
- Celeris / Celeris-WebGPU: excels at interactive GPU Boussinesq/NLSW modeling, live bathymetry/topography edits, overlays, time-series probes, raw data output, and many preconfigured examples. Learn from immediate experimentation and probe/export ergonomics; avoid its dense expert-only control surface.
- FUNWAVE-TVD / JAGURS / broader tsunami-model list: excels at dispersive/Boussinesq models, nesting/AMR, wetting-drying, parallel/HPC execution, benchmarks, and NetCDF-style model data. Learn from benchmark discipline and nested-resolution architecture; avoid trying to match HPC solvers inside a consumer desktop app before data and validation are ready.
- NUKEMAP / Impact: Earth / Asteroid Launcher: excel at simple scenario setup, memorable visualization, explainable uncertainty, share/export behavior, and broad educational reach. Learn from concise controls, advanced export options, and transparent modeling assumptions; avoid casualty/humanitarian overlays without a deliberate ethics review.
- TUFLOW FV / Delft3D FM: excel at flexible meshes, GPU/HPC/cloud execution, GIS integration, service packages, and professional support. Learn from GIS interoperability and supportability; avoid commercial-suite breadth that would dilute the focused "NukeMap for tsunamis" product.
- CesiumJS platform: Cesium 1.142 adds GeoJsonPrimitive and MVTDataProvider for large-scale GeoJSON/vector rendering. Learn from this for future high-volume inundation/vector overlays; avoid churn while current overlays remain small.

## Security, Privacy, and Reliability
- Verified: `npm audit --json` reports one moderate advisory, `GHSA-cmwh-pvxp-8882`, through `cesium@1.142.0 -> @cesium/engine@26.0.0 -> dompurify@3.4.10`; patched DOMPurify is 3.4.11.
- Verified: `src-tauri/capabilities/default.json` allows citation links through `shell:allow-open`, including two `http://` hosts and broad publisher domains. Tauri documents capabilities as the WebView/system-resource boundary, so this allowlist needs tests and periodic review.
- Verified: `SECURITY.md` already treats `shell:allow-open`, settings leakage, CSP, malicious deep links, and supply-chain risk as in scope; the advisory and allowlist findings map directly to the project's stated security policy.
- Verified: `src/components/SwePlayback.tsx` renders "Run solver"; `src/components/__tests__/SwePlayback.test.tsx` and `docs/manual/*.md` still query/document "Run simulation." The focused Vitest run could not complete locally because the worker hung on the VMware share, so the label mismatch is source-verified and the test result needs CI/local validation.
- Verified: release/docs truth is split: app/README/Cargo/Tauri show v0.4.4; GitHub Releases latest is v0.4.0; `COMPLETED.md` says v0.4.2; existing screenshot assets show v0.4.1/v0.4.2; `CONTRIBUTING.md` still says OpenStreetMap is the default globe.
- Verified: `data/bathymetry/README.md`, `src/data/coastal_points.json`, and `src-tauri/src/data/bathymetry.rs` still reference GEBCO 2024; GEBCO_2026 was published April 23, 2026 and includes TID source-data metadata.
- Likely: token handling is materially improved because `settings.ts` no longer mirrors `cesium_token` to localStorage in desktop mode, but there is no settings-store schema version for future migrations.

## Architecture Assessment
- Verified: the strongest architecture choice remains Rust-only authoritative physics behind typed IPC (`src/lib/tauri.ts`, `src-tauri/src/commands.rs`, `src-tauri/src/physics/*`).
- Verified: `src/components/Globe.tsx` is 996 lines, `src-tauri/src/commands.rs` is 1635 lines, `src/styles.css` is 2637 lines, and `src/lib/demo.ts` is 642 lines; these are real refactor candidates, but `Roadmap_Blocked.md` correctly parks the high-risk `Globe.tsx`/`commands.rs` splits until visual/Rust verification is available.
- Verified: browser-preview physics remains a sanctioned carve-out in `src/lib/demo.ts`; `src/components/AttenuationChart.tsx::computeDecayCurve` is another frontend formula copy. Both are documented locally, but they should stay visibly non-authoritative and eventually move behind Rust/generated fixtures.
- Verified: scenario sharing has a schema version in `src/lib/scenario-schema.ts`; app settings in `src/lib/settings.ts` normalize individual keys but do not have a store-level schema version or migration audit trail.
- Verified: unit and e2e coverage is now broad (component tests, export/schema/settings tests, Playwright smoke, axe checks), but local verification is brittle on this workspace: Vitest hung, `cargo audit` is not installed, and `CLAUDE.md` records MSVC `link.exe` missing from the current PowerShell PATH.
- Likely: Cesium 1.142's GeoJsonPrimitive could reduce future overlay overhead, but it should wait for larger GeoJSON/flood-vector data; current Primitive migration for runup bars already addressed the immediate rendering issue.

## Rejected Ideas
- Full GEBCO local download/solver loader now: already blocked in `Roadmap_Blocked.md` by artifact/distribution decisions; update the target/version and provenance first.
- Boussinesq, AMR, NTHMP benchmark suite, and real flood polygons now: scientifically valuable but already blocked as research-grade or dependent on GEBCO/Rust verification.
- NetCDF export now: interoperability is valid, but `Roadmap_Blocked.md` notes the `netcdf-sys`/C library burden; keep CZML/GeoJSON/KML/text strong first.
- Casualty or population overlay: sourced from NUKEMAP-style demand but already flagged as ethically sensitive; not recommended without an explicit ethics/product review.
- Plugin ecosystem: conflicts with the project's citation-verified physics boundary and would add maintenance/security surface before there is evidence of extension demand.
- Mobile-native app: NUKEMAP's roadmap makes mobile important for websites, but this product is a desktop 3D globe with a 1200x800 minimum window and Tauri desktop distribution.
- Multi-user/collaboration: commercial suites support professional workflows, but no repo evidence or comparable educational-tool evidence makes it higher value than trust, validation, exports, and docs.
- Commercial-suite parity with TUFLOW/Delft3D: flexible meshes, 3D density, sediment, water quality, and cloud/HPC are useful references, not a near-term scope fit.

## Sources
### Project
- https://github.com/SysAdminDoc/TsunamiSimulator

### OSS / research models
- https://www.clawpack.org/geoclaw.html
- https://depts.washington.edu/clawpack/geoclaw/
- https://github.com/mandli/tsunami-models
- https://github.com/jagurs-admin/jagurs
- https://fengyanshi.github.io/build/html/index.html
- https://github.com/fengyanshi/FUNWAVE-TVD
- https://github.com/GeoscienceAustralia/anuga_core
- https://github.com/Delta-function/cliffs-src
- https://github.com/jgalazm/browni
- https://plynett.github.io/
- https://arxiv.org/abs/1611.05984

### Operational / commercial / education tools
- https://nctr.pmel.noaa.gov/model.html
- https://nctr.pmel.noaa.gov/ComMIT/
- https://nctr.pmel.noaa.gov/tsunami-forecast.html
- https://nctr.pmel.noaa.gov/benchmark/
- https://nuclearsecrecy.com/nukemap/
- https://blog.nuclearsecrecy.com/2026/02/10/nukemap-roadmap/
- https://neal.fun/asteroid-launcher/
- https://www.purdue.edu/impactearth/
- https://www.tuflow.com/products/tuflow-fv/
- https://www.deltares.nl/en/software-and-data/products/delft3d-flexible-mesh-suite

### Standards, data, dependencies, security
- https://www.gebco.net/data-products/gridded-bathymetry-data
- https://www.gebco.net/data-products/gebco-web-services
- https://www.ogc.org/standard/geopackage/
- https://cfconventions.org/
- https://cesium.com/blog/2026/06/01/cesium-releases-in-june-2026/
- https://github.com/advisories/GHSA-cmwh-pvxp-8882
- https://v2.tauri.app/security/
- https://v2.tauri.app/plugin/shell/

## Open Questions
- Needs live validation: can CI pass `src/components/__tests__/SwePlayback.test.tsx` after updating its accessible-name queries, or is the Vitest hang masking an additional test-runtime issue?
- Needs maintainer decision: should v0.4.4 be published as an unsigned GitHub Release now, or should public releases wait until signing/updater secrets are available?
