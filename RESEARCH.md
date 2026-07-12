# Research — Cataclysm

Date: 2026-07-12 — replaces all prior research.

## Executive Summary

Cataclysm v0.10.0 is a desktop, Rust-authoritative multi-hazard simulator that
combines cited asteroid, nuclear, earthquake, landslide, and tsunami models with
a professional Cesium globe workspace. Its strongest current shape is trust:
checked IPC inputs, CPU/GPU parity fixtures, deterministic renderer recordings,
Earth-asset/geodesy contracts, offline imagery fallback, keychain secrets,
recoverable settings, and unusually broad local verification. The highest-value
direction is therefore not another visual expansion; it is closing the remaining
scientific-contract, data-lineage, and reproducibility gaps before the larger
AMR/Boussinesq/cinematic program.

Top opportunities, in priority order:

1. **Verified — execute the existing product-truth gate first:** Cesium 1.143
   requires Node >=22 while Vite 8 requires Node >=22.12 on the Node-22 line,
   yet `scripts/doctor.mjs`, `README.md`, and `CONTRIBUTING.md` accept Node 20;
   Doctor also accepts Rust 1.85 and CONTRIBUTING claims 1.78 while
   `src-tauri/Cargo.toml` requires 1.88. This strengthens the existing
   “authoritative product-truth” roadmap item; do not duplicate it.
2. **Verified — one generated input contract:** earthquake Mw is 5–10 in
   `src/lib/scenario-schema.ts` but 4.0–10.5 in `src-tauri/src/commands.rs`.
3. **Verified/Likely — fail closed on invalid solver fields:** CPU snapshots
   currently turn non-finite cells transparent in `physics/solver/mod.rs` rather
   than invalidating the run; expose numerical-quality evidence and block normal
   exports when invariants fail.
4. **Verified — per-point coastal-data lineage:** most coastal depths are nominal
   50 m values and slope records lack point-level source/method/uncertainty in
   `src/data/coastal_points.json`, despite producing quantitative runup.
5. **Verified — preserve source geometry:** the existing top solver item remains
   essential because propagation still begins from a circular Gaussian.
6. **Verified — keep max-field accumulation on the GPU:** every accepted GPU step
   currently submits, polls, maps, and copies eta/u/v to the CPU, serializing the
   path that is supposed to accelerate the solve.
7. **Likely — inspectable local bathymetry import:** NetCDF-CF/GeoTIFF import with
   CRS/datum/resolution preflight lets users supply real data now without waiting
   for the blocked bundled-GEBCO distribution decision.
8. **Likely — sensitivity ensembles:** bounded deterministic parameter ensembles
   with percentile layers are more honest than one exact outcome for uncertain
   inputs and match OpenQuake/USGS practice without claiming forecast probability.
9. **Verified — accessible viewport equivalence:** Cesium internals are excluded
   from axe and the application provides no dynamic text equivalent for the active
   scene; add an owned summary plus Windows forced-colors coverage.
10. **Likely — durable and reproducible runs:** checkpoints, non-executable
    scenario bundles, and a headless CLI make long runs recoverable, shareable,
    migratable, and independently repeatable.

## Product Map

- **Core workflows:** choose or author a cited event; calculate source effects;
  run/watch SWE propagation; inspect runup, gauges, DART and direct effects;
  compare scenarios; export visual and scientific products.
- **Personas:** educators/students, science communicators, hazard enthusiasts,
  and researchers performing exploratory or illustrative work—not operational
  warning or evacuation analysis.
- **Platforms/distribution:** Tauri desktop; locally verified Windows MSI/NSIS;
  macOS/Linux source-build targets; desktop-only by design.
- **Data flow:** Rust owns physics and direct-effect results; typed Tauri IPC and
  a checksummed renderer protocol transport fields/events; Cesium presents them;
  Esri/OSM/Cesium provide online context and Natural Earth II is the bundled
  fallback; settings are local and the ion token is held in the OS keychain.
- **Current constraints:** coarse basin/shelf solver bathymetry, static Okada
  source time, analytical coastal runup, no AMR/Boussinesq, unsigned installers,
  and a Cesium Viewer bundle that still needs CSP `unsafe-eval`.

## Competitive Landscape

### GeoClaw and ANUGA

- Do well: benchmark culture, AMR/unstructured local refinement, wet/dry flows,
  checkpoints, gauges, and practical topography workflows.
- Learn: scientific input preflight, runtime conservation evidence, restartable
  domains, and conservative nested coastal refinement.
- Avoid: expert-only Python/Fortran setup and forcing users to become GIS/toolchain
  specialists before they can inspect a scenario.

### Tsunami-HySEA, FUNWAVE-TVD, and JAGURS

- Do well: GPU/HPC propagation, nested grids, dispersive/phase-resolving options,
  NetCDF interchange, hot starts, and nearshore modeling.
- Learn: GPU-resident diagnostics/maxima, standardized fields, and model-tier
  selection with explicit validity limits.
- Avoid: CUDA/vendor lock, brittle compiler workflows, and exposing advanced
  switches without stability bounds or CPU parity.

### OpenQuake and NHERI SimCenter R2D

- Do well: logic-tree/ensemble uncertainty, source/exposure separation,
  standardized workflows, versioned inputs, background jobs, and portable results.
- Learn: percentile products, deterministic seeds, job identity, durable state,
  and governed data/model provenance.
- Avoid: insurance-only accounting, enterprise orchestration, and arbitrary model
  execution inside the trusted educational core.

### NUKEMAP and Nuclear War Simulator

- Do well: familiar-place targeting, explainable thresholds, point exposure,
  shelter/fallout context, population cells, and portable interchange.
- Learn: one click should answer what happens at this place, why, when, under
  which model, and with what uncertainty.
- Avoid: weapons-catalog/game mechanics and false precision from one population or
  mortality model.

### Asteroid Launcher and Purdue Impact: Earth!

- Do well: approachable scale/frequency framing (Launcher) and a cited full
  consequence chain including atmosphere, crater, ejecta and seismic effects
  (Purdue).
- Learn: simple-to-expert disclosure, observer-location summaries, recurrence
  context, and long-term effects already represented by active roadmap items.
- Avoid: flat-map spectacle that omits ocean propagation or hides model limits.

### USGS, NOAA/NTHMP, NASA/JPL

- Do well: revisioned event feeds, ShakeMap uncertainty products, benchmark and
  modeling guidance, and explicit operational/non-operational boundaries.
- Learn: import authoritative events as versioned educational seeds, validate
  against observations, and publish uncertainty and provenance beside outputs.
- Avoid: describing imported events as forecasts, warnings, or live risk claims.

### Cesium, ParaView, and OpenSphere

- Do well: scalable globe primitives, temporal scientific data, portable state,
  layer adapters, and recoverable visualization workflows.
- Learn: batched fields, bounded caches, declarative non-executable adapters,
  relative portable references, and accessible application-owned scene summaries.
- Avoid: per-entity/per-frame churn, unvalidated projections, and runtime code
  plugins that broaden the Tauri trust boundary.

### ArcGIS Flood Simulation and Moody's risk platform

- Do well: governed data foundations, scenario comparison, uncertainty, asset
  context, temporal rasters, and decision-ready reporting.
- Learn: inspectable assumptions and comparable scenario products are more valuable
  than cinematic rendering alone.
- Avoid: proprietary coupling, financial-loss engines, and engineering claims from
  visualization-grade or coarse global results.

## Security, Privacy, and Reliability

- **Verified — no current dependency vulnerability:** `npm audit` reports zero
  vulnerabilities across 369 packages; `cargo audit` reports zero vulnerabilities
  across 515 crates. RustSec emits 17 allowed informational warnings, chiefly
  inherited GTK3/rust-unic maintenance notices; Linux inherits `glib` 0.18.5's
  advisory through Tauri/Wry, while the active Windows graph is unaffected.
- **Verified — real build-floor mismatch:** `scripts/doctor.mjs:6-7`,
  `README.md:203-204`, `CONTRIBUTING.md:26-27`, `package.json` (no `engines`), and
  `src-tauri/Cargo.toml:10` disagree. The effective floor is Node >=22.12 and
  Rust >=1.88. Fix through the existing product-truth gate.
- **Verified — input-contract mismatch:** `SCENARIO_BOUNDS.mw` is [5,10] while
  Rust accepts [4.0,10.5]. Generate validators, UI bounds, documentation values,
  and parity tests from one versioned contract.
- **Verified — silent-invalid-field path:** `SwGrid::snapshot` in
  `src-tauri/src/physics/solver/mod.rs` replaces non-finite values with zero/
  transparent pixels. A simulation-quality record must distinguish a valid zero
  from suppressed numerical failure and prevent ordinary exports of invalid runs.
- **Verified — CSP residual:** `src-tauri/tauri.conf.json` allows `unsafe-eval`;
  the current production Cesium Viewer/widgets bundle contains `new Function` and
  Knockout eval paths. Retain and document this narrow residual until an engine-
  only/CesiumWidget prototype passes a packaged CSP smoke test.
- **Verified — recovery gap:** crash evidence and visual reset ship, but active
  solver fields/tick/input digests are not checkpointed. Recovery must reject
  incompatible solver/data/protocol versions rather than silently resume.
- **Missing guardrails:** portable scenario packages need entry-count, compressed
  and expanded-size, path traversal, schema/version, hash, MIME, and no-executable
  enforcement before any embedded data is accepted.

## Architecture Assessment

- **Keep the Rust-authoritative boundary.** The renderer protocol, geodesy/surface
  contracts, and lifecycle-owned Cesium hosts are strong; arbitrary executable
  model plugins would weaken them.
- **Fix GPU synchronization at the source.** `stream_simulation_dispatch` and
  `run_simulation_gpu` call `GpuTimeStepper::step_with_diagnostics(..., 1)`;
  `gpu.rs` reuploads host eta/u/v and maps three readback buffers on every call.
  Add WGSL max/time/energy buffers and batch accepted steps between display,
  cancellation, and completion readbacks while preserving step-cadence products.
- **Make scientific data an explicit boundary.** `data/bathymetry/README.md` and
  `src-tauri/src/data/bathymetry.rs` expose only the placeholder/coarse path. A
  local import adapter should normalize a constrained NetCDF-CF/GeoTIFF subset
  into the existing CRS/datum/surface contract with preview and provenance.
- **Add per-record coastal lineage.** Extend `src/data/coastal_points.json` with
  slope/depth source, sample method, resolution, datum, uncertainty/confidence,
  and rights; validation must reject quantitative labels without those fields.
- **Use the existing run-admission item as a prerequisite.** Sensitivity ensembles,
  checkpoints, and CLI jobs need run identity, resource estimates, scoped cancel,
  and correlation in local diagnostics; do not file a second run-registry item.
- **Testing gaps:** no CPU invalid-field fail-closed fixture, runtime mass/CFL
  quality report, GPU-resident max-field parity/throughput benchmark, coastal
  provenance validator, imported-raster CRS/datum fixture, checkpoint corruption/
  migration test, forced-colors Playwright pass, package zip-bomb/path-traversal
  test, or CLI-vs-GUI golden-result test.
- **Already covered—do not duplicate:** source-geometry injection, spherical SWE
  metrics, commands.rs modularization, typed async states, transactional settings,
  layers, product-truth/docs cleanup, WASM preview, NTHMP, Zarr, i18n, USGS/JPL/
  HazEL feeds, humanitarian POIs, terrain draping, recurrence, casualty models,
  AMR/Boussinesq, GEBCO distribution, and the cinematic renderer program.

## Rejected Ideas

- **Operational warning, evacuation, or CAP product — rejected.** NOAA's warning
  role and Cataclysm's educational disclaimer make this a trust contradiction.
  Source: https://nctr.pmel.noaa.gov/model.html
- **Full evacuation/traffic/first-responder simulation — rejected.** It requires a
  separately validated behavioral model; export interoperable hazard products
  instead. Source: ArcGIS/SimCenter landscape.
- **Insurance pricing/economic-loss engine — rejected.** Exposure/provenance lessons
  transfer; reinsurance accounting does not fit the educational physics product.
  Source: Moody's Intelligent Risk Platform.
- **Arbitrary executable plugins or a mod workshop — rejected.** They undermine
  cited Rust authority and widen the desktop trusted-code surface; prefer bounded
  declarative data/scenario adapters. Source: OpenSphere/Universe Sandbox.
- **CUDA-only acceleration — rejected.** Preserve wgpu plus deterministic CPU
  fallback; HySEA's compiler/vendor friction is the failure mode to avoid.
- **Remove CSP `unsafe-eval` now — rejected.** The current Cesium Viewer bundle
  demonstrably uses eval/code-generation paths; `wasm-unsafe-eval` alone is not
  equivalent. Source: Cesium 1.143 bundle and Tauri CSP guidance.
- **Tauri 3/GTK4 migration now — deferred.** Current RustSec warnings are inherited,
  not active vulnerabilities, and Tauri 3 is not a stable migration target.
- **Engineering mitigation design (seawalls/barriers) now — deferred.** It becomes
  credible only after high-resolution wetting/drying and validation land. Source:
  ArcGIS Flood Simulation.
- **Time-dependent rupture and compound multi-event solving now — deferred.** Both
  depend on source-field injection and larger validation architecture; keep them
  behind the existing science-frontier work rather than the actionable roadmap.
- **Mobile, cloud sync, and real-time multi-user editing — rejected.** They conflict
  with the desktop, local-first, deterministic scientific-workspace posture.

## Sources

### Direct OSS and adjacent tools

- https://github.com/clawpack/geoclaw
- https://github.com/edanya-uma/Tsunami-HySEA
- https://github.com/fengyanshi/FUNWAVE-TVD/issues/57
- https://anuga.readthedocs.io/en/stable/setup_anuga_script/checkpointing.html
- https://docs.openquake.org/oq-engine/3.22/manual/user-guide/workflows/scenario-hazard.html
- https://nheri-simcenter.github.io/R2D-Documentation/
- https://db.nuclearsecrecy.com/nukemap/faq/
- https://store.steampowered.com/app/1603940/Nuclear_War_Simulator/
- https://universesandbox.com/faq/
- https://www.purdue.edu/impactearth/

### Commercial, community, and landscape

- https://www.moodys.com/web/en/us/who-we-serve/insurance/intelligent-risk-platform.html
- https://doc.esri.com/en/arcgis-pro/latest/help/mapping/simulation/simulation-in-arcgis-pro.html
- https://news.ycombinator.com/item?id=33870612
- https://www.reddit.com/r/geography/comments/koxtir
- https://github.com/mandli/tsunami-models
- https://amreldib.github.io/awesome-gis/

### Standards and scientific guidance

- https://www.weather.gov/media/nthmp/MMS/TsunamiModelSummary.pdf
- https://vlab.noaa.gov/web/national-tsunami-hazard-mitigation-program/modeling-guidance
- https://www.usgs.gov/publications/probabilistic-tsunami-hazard-analysis-multiple-sources-and-global-applications
- https://usgs.github.io/pdl/userguide/products/shakemap.html
- https://www.usgs.gov/publications/quantifying-and-qualifying-usgs-shakemap-uncertainty
- https://cfconventions.org/Data/cf-conventions/cf-conventions-1.13/cf-conventions.html
- https://www.w3.org/WAI/WCAG22/Understanding/non-text-content
- https://www.w3.org/TR/css-color-adjust-1/

### Platform, dependencies, and security

- https://v2.tauri.app/security/capabilities/
- https://v2.tauri.app/distribute/windows-installer/
- https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/evergreen-vs-fixed-version
- https://vite.dev/blog/announcing-vite8
- https://raw.githubusercontent.com/CesiumGS/cesium/1.143/CHANGES.md
- https://rustsec.org/advisories/

## Open Questions

- None block prioritization or implementation. Signing credentials, updater keys,
  bundled GEBCO distribution, and Unreal build/runtime availability remain explicit
  external blockers in `Roadmap_Blocked.md`.
