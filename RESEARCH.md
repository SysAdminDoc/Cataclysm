# Research - TsunamiSimulator

## Executive Summary

Verified: TsunamiSimulator is a Tauri 2 desktop simulator that pairs a React 19/CesiumJS globe with Rust shallow-water physics, scenario presets, streaming playback, comparison mode, DART overlays, and export surfaces. Its strongest current shape is an educational/science-communication cockpit: faster and more approachable than GeoClaw/ANUGA/JAGURS, but not an operational hazard model. The highest-value direction is to protect trust before adding more science: correct real-GEBCO claims while the backend still uses coarse offline bathymetry, harden saved/pasted scenario data, add crash recovery, clear current low audit findings, and test the recently added persistence/streaming/settings flows. Top opportunities: (1) correct public/docs/UI claims about bathymetry and approximation limits, (2) clear the current Babel/esbuild audit findings, (3) add a root React error boundary with LogViewer capture, (4) validate and migrate scenario save/load/copy/paste payloads, (5) add component/e2e tests for scenario persistence, settings, and streaming playback, (6) remove stale shortcut documentation, (7) use Cesium 1.142 buffer/GeoJSON primitives for large runup overlays, (8) add an automated accessibility gate.

## Product Map

- Core workflows: choose source type or preset; configure asteroid, nuclear, earthquake, or landslide parameters; inspect source/globe output; run CPU/GPU-aware SWE simulation; scrub snapshots; compare two scenarios; view DART/runup/inundation readouts; export PNG/share card/video/CZML/text.
- User personas: science communicators and educators; geoscience students; developers validating numerical/visual ideas; emergency-planning-adjacent users who need explicit "not operational" framing.
- Platforms and distribution: Windows/macOS/Linux desktop through Tauri 2; React/Vite frontend in a WebView; optional Cesium ion token; release/signing/updater work remains blocked in `Roadmap_Blocked.md`.
- Key integrations and data flows: React UI -> Tauri IPC -> Rust physics commands in `src-tauri/src/commands.rs`; Cesium globe in `src/components/Globe.tsx`; settings/scenarios via `tauri-plugin-store` plus localStorage mirrors in `src/lib/settings.ts`; coarse offline bathymetry in `src-tauri/src/data/bathymetry.rs`; test surfaces in Vitest and Playwright.

## Competitive Landscape

- GeoClaw: strong at validated shallow-water inundation, wet/dry shoreline handling, AMR, topography tooling, and benchmark culture. Learn its explicit caution language and validation workflow. Avoid copying its expert-only setup burden into the desktop product.
- ANUGA and OceanMesh2D: strong at hydrodynamic modeling, mesh/preprocessing workflows, docs, and community issue patterns around boundaries, bathymetry, and parallel execution. Learn input validation and data-prep guardrails. Avoid exposing raw mesh complexity before the current scenario UX is hardened.
- Tsunami-HySEA, JAGURS, and FUNWAVE-TVD: strong at high-performance tsunami numerics, CUDA/SYCL or MPI/OpenMP execution, NetCDF outputs, Boussinesq/long-wave options, and NTHMP-style benchmarking. Learn output provenance and performance transparency. Avoid GPU/HPC features that require distribution choices already blocked.
- Celeris Base/WebGPU: strong at browser-side interactive wave simulation, live controls, gauges, design components, and rich output controls. Learn the immediacy of time-series probes and visual controls. Avoid its very dense, expert-control-heavy UI in this app's educator-first surface.
- MIKE 21/3, Delft3D FM, and TUFLOW: strong at professional support, validation, training, flexible meshes, bathymetry/data portals, GPU/cloud options, and clear module packaging. Learn from their support/training/error-message investment. Avoid implying comparable operational or consulting-grade confidence without real data and benchmarks.
- NUKEMAP, Asteroid Launcher, and Impact: Earth!: strong at public-facing scenario exploration, clear parameter controls, memorable results, and shareability. Learn their direct scenario-to-result storytelling. Avoid unsupported casualty/risk claims; NUKEMAP's opt-out logging and long-lived public trust show how sensitive hazard tools need transparent data and model boundaries.
- CesiumJS geospatial stack: Cesium 1.142 added `GeoJsonPrimitive` and buffer primitive improvements for large vector datasets. Learn from this new rendering path for runup/inundation scalability. Avoid staying on thousands of mutable entity objects when overlays grow.

## Security, Privacy, and Reliability

- Verified: `npm audit --json` currently reports two low-severity dev-chain advisories: `@babel/core` arbitrary file read (`package-lock.json` has 7.29.0; patched 7.29.6) and `esbuild` Windows dev-server path traversal (`package-lock.json` has 0.27.7; patched 0.28.1). No moderate/high/critical npm advisory was reported.
- Verified: the May 2026 Tauri origin-confusion advisory affects `tauri >=2.0 <=2.11.0`, patched in `>=2.11.1`; the current Rust lock resolves `tauri v2.11.2`, so the app is not on the vulnerable Tauri core.
- Verified: recent Vite GHSA/CVE ranges are fixed by 7.3.2; `package-lock.json` resolves Vite 7.3.5, so the app is past that patch level.
- Verified: `README.md` claims "GEBCO bathymetry", "GEBCO 15-arcsec sampler", and "NOAA-grade physics"; `src-tauri/src/data/bathymetry.rs` states the implementation is a coarse offline approximation and not a substitute for GEBCO/SRTM15+. This is the main product-trust defect.
- Verified: `ScenarioBuilder.loadScenario()` and `pasteScenario()` parse or cast payloads by `kind`/`source` shape only, then apply unknown saved/clipboard data into state; `settings.saveScenario()` persists `unknown` without schema versioning. Invalid or stale payloads should be rejected or migrated before reaching UI state.
- Verified: `src/main.tsx` mounts `<App />` directly under `React.StrictMode`; there is no root error boundary or global `error`/`unhandledrejection` capture into `LogViewer`, so a render crash can blank the WebView.
- Verified: `docs/manual/getting-started.md` documents F6/F7/F8 shortcuts and `docs/manual/custom-scenarios.md` references F6, but source search found no F-key handlers. Stale shortcut copy harms trust and accessibility.
- Likely: the current external-link allowlist and CSP are acceptable for a Cesium/Tauri desktop app but should remain part of release review. CSP hash tightening and larger diagnostics bundles are already tracked in `Roadmap_Blocked.md`.

## Architecture Assessment

- Verified: `src-tauri/src/commands.rs` and `src/components/Globe.tsx` remain large coordination modules; refactors are already tracked as blocked/deferred, so this pass does not duplicate them.
- Verified: scenario persistence needs a boundary module, not more inline checks. A small schema/migration helper shared by `ScenarioBuilder.tsx`, `settings.ts`, and tests would contain clipboard/store risk without changing the backend contract.
- Verified: `Globe.tsx` keeps runup and inundation overlays as mutable Cesium entities in `runupEntitiesRef` and `inundationEntitiesRef`. For current 60+ points this is fine; for larger overlays, Cesium 1.142's `GeoJsonPrimitive`/buffer primitives are the right next rendering path.
- Verified: test coverage exists but is narrow: Playwright smoke plus Vitest tests for PresetSelector, ResultsPanel, export/text, and globe styles. No tests were found for ScenarioBuilder persistence/clipboard flows, Settings reset/token/offline behavior, SwePlayback streaming progress/cancel, or automated axe accessibility checks.
- Verified: docs are out of sync with current implementation and policy in several places: README overstates GEBCO/NOAA-grade status; bathymetry comments still say v0.3.0 will replace the coarse sampler; manual shortcut copy is stale.
- Likely: plugin ecosystem, collaboration, mobile, and operational alert integrations would add architecture surface without serving the app's current educator-first desktop purpose.

## Rejected Ideas

- Real GEBCO progressive loader as an active item: Source Cooperative/OpenDEM/GEBCO 2026 make it technically plausible, but the repo already tracks GEBCO distribution as blocked in `Roadmap_Blocked.md`; do not duplicate until hosting/size/licensing decisions are unblocked.
- Real flood polygons as an active item: NTHMP and professional tools make this table-stakes for operational modeling, but this repo marks it dependent on real GEBCO and blocked.
- Full AMR or Boussinesq solver now: GeoClaw/FUNWAVE/JAGURS/Celeris support the value, but these are XL numerical projects already blocked/deferred; trust/test fixes should land first.
- Plugin ecosystem: Direct competitors do not show a strong plugin pattern for this app's niche; it would add API/versioning burden before core workflow contracts are stable.
- Mobile app port: Tauri/mobile plus Cesium/WebGPU constraints and the desktop-first README make this a misfit now; responsive QA is still useful for window sizes.
- Multi-user collaboration: no source indicated strong demand for collaborative desktop tsunami scenario editing, and it would require accounts/sync/privacy surfaces that conflict with the local-first product.
- Live official warning feed: NOAA/NTHMP/DART sources are useful for validation and education, but integrating real alerts risks operational confusion and liability.
- Casualty/population overlays now: public hazard tools show demand for impact narratives, but the existing roadmap already keeps this as opt-in stretch with heavy disclaimer; it should not precede model-limit trust work.
- NetCDF/scientific export as active work: HySEA/JAGURS/GeoClaw make NetCDF normal in research workflows, but prior planning already blocked heavier scientific export/benchmark paths until validation/data boundaries are clearer.

## Sources

OSS and analogous projects:
- https://github.com/mandli/tsunami-models
- https://www.clawpack.org/geoclaw.html
- https://github.com/geoscienceaustralia/anuga_core
- https://github.com/CHLNDDEV/OceanMesh2D
- https://github.com/jagurs-admin/jagurs
- https://github.com/edanya-uma/Tsunami-HySEA
- https://fengyanshi.github.io/build/html/
- https://plynett.github.io/
- https://github.com/lisyarus/webgpu-shallow-water

Commercial, adjacent, and community signal:
- https://www.dhigroup.com/technologies/mikepoweredbydhi/mike-21-3
- https://www.deltares.nl/en/software-and-data/products/delft3d-flexible-mesh-suite
- https://www.tuflow.com/
- https://nuclearsecrecy.com/nukemap/
- https://neal.fun/asteroid-launcher/
- https://news.ycombinator.com/item?id=33870612
- https://news.ycombinator.com/item?id=30282649
- https://www.reddit.com/r/Hydrology/comments/1facm9u/hecras_bathrymetry/

Standards, data, and platform APIs:
- https://www.weather.gov/nthmp/SubMapModel
- https://www.gebco.net/data-products/gridded-bathymetry-data
- https://www.ndbc.noaa.gov/dart/dart.shtml
- https://source.coop/alexgleith/gebco-2024
- https://www.opendem.info/bathymetryviewer_cog/
- https://github.com/CesiumGS/cesium/releases
- https://cesium.com/blog/2026/06/01/cesium-releases-in-june-2026/
- https://docs.rs/crate/wgpu/latest

Security and dependency advisories:
- https://github.com/tauri-apps/tauri/security/advisories/GHSA-7gmj-67g7-phm9
- https://github.com/advisories/GHSA-p9ff-h696-f583
- https://github.com/advisories/GHSA-4x5r-pxfx-6jf8
- https://github.com/advisories/GHSA-g7r4-m6w7-qqqr

Academic and engineering research:
- https://research.google/pubs/celeris-base-an-interactive-and-immersive-boussinesq-type-nearshore-wave-simulation-software/

## Open Questions

- None block the active roadmap additions. Blocked items remain in `Roadmap_Blocked.md` and require maintainer choices on GEBCO distribution, code signing, updater infrastructure, and release credentials before they can be reprioritized.
