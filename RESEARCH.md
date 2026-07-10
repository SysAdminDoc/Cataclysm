# Research — TsunamiSimulator

Date: 2026-07-09 — replaces all prior research.

## Executive Summary
Verified: TsunamiSimulator v0.4.4 is a local-first Tauri 2/React 19/Cesium 1.143 desktop simulator with cited Rust source models, CPU and optional wgpu propagation, model-vs-observation tools, provenance-bearing exports, and unusually strong educational guardrails. Its strongest shape is an approachable, transparent alternative to expert-only tsunami codes. The highest-value direction is to make the solver honor the source geometry and numerical assumptions already presented by the UI before adding more events. The current dirty worktree contains unfinished implementations of existing roadmap items (Okada correction, GPU parity, Kamchatka/Lisbon/Amorgos/Sanriku/YR4 content); they are not counted as complete here.

Top opportunities, in priority order:

1. Preserve earthquake, landslide, impact, and nuclear source geometry in the SWE initial field instead of reducing every source to one circular Gaussian.
2. Use one explicit attenuation model across the chart, globe inspection, coastal runup, and exports.
3. Add an authoritative Rust preflight and cells×steps×snapshots/output-byte budget before accepting a simulation.
4. Make settings and saved-scenario persistence transactional, verifiable, and honest about failures.
5. Replace the single center-latitude Cartesian metric with spherical row metrics for basin-scale runs.
6. Accumulate maxima/arrivals at solver-step cadence and add maximum-current products from the momentum fields already computed.
7. Give comparison runs independent cancellation ownership and configurable horizons long enough for distant observations.
8. Exercise optional Rust features in the local verification gate and harden Tauri capabilities against remote IPC authority.
9. Add portable project bundles plus standards-based local raster import/export.
10. Replace misleading empty states, stale documentation, and canvas-masked visual tests with explicit failures and deterministic evidence.

## Product Map
- Core workflows: select a cited preset or build an asteroid/nuclear/earthquake/landslide source; run CPU or optional GPU SWE propagation; scrub live/max/arrival products on a Cesium globe; compare scenarios; inspect runup, gauges, DART observations, and attenuation; export visual, vector, video, text, and time-series artifacts.
- Personas: educators and students; technically curious public users; scientific reviewers checking model provenance and validation; maintainers diagnosing local desktop/GPU behavior.
- Platforms and distribution: Windows/macOS/Linux source targets; locally built Windows MSI/NSIS artifacts are the only current installers. Browser preview is a watermarked deterministic approximation, not the Rust solver.
- Integrations and data flows: React → typed Tauri IPC → Rust physics/solver; tauri-plugin-store persistence; bundled coastal/DART JSON; optional Cesium imagery; local Natural Earth fallback; coarse synthetic basin/shelf bathymetry pending real-grid work.

## Competitive Landscape
- GeoClaw/Clawpack: strongest transparent reference for moving-topography inputs, gauges, spherical terms, AMR, and per-step fgmax products. Learn source-shaped initial conditions, controlled boundaries, and measurable convergence. Avoid its expert-only configuration burden.
- TsunAWI, Tsunami-HySEA, and JAGURS: mature basin-scale codes with finite faults, spherical grids, nested domains, ensembles, and production outputs. Learn geometry/kinematics and result completeness. Avoid HPC-first operational complexity in the default UX.
- Celeris-WebGPU: the closest interactive competitor, with browser reach, nesting, probes, and editable coastal structures. Learn fast experimentation and clear field diagnostics. Avoid creating a second browser-authoritative physics implementation; the existing Rust-to-WASM roadmap item is safer.
- NOAA MOST/NCTR and UNESCO TsuCAT: define checkable public vocabulary around arrival, maximum height/current, gauges, scenario databases, and offline continuity. Learn product completeness and evidence presentation. Avoid any operational forecast or alert implication.
- ANUGA and SFINCS: demonstrate explicit boundaries, restartability, local raster inputs, variable roughness, and fast hazard products. Learn interoperable inputs and preflight diagnostics. Avoid expanding into general river/rain/storm modeling.
- ArcGIS Pro, TUFLOW, OpenFlows, and Delft3D: paid value concentrates on scenario matrices, data import/export, support, reproducibility, current/velocity products, and collaboration. Learn portable projects and sensitivity workflows. Avoid vendor-cloud dependence and engineering-grade claims.
- PhET/NUKEMAP-style educational tools: validate guided explanations, shareable scenarios, and accessibility. Preserve TsunamiSimulator's stronger citation/limitations posture; avoid casualty estimates and authoritative-looking alerts.

## Security, Privacy, and Reliability
- Verified: npm audit reported zero vulnerabilities on 2026-07-09. cargo audit reported no vulnerabilities but 17 allowed warnings, including the Tauri Linux GTK3 chain and glib RUSTSEC-2024-0429; monitor upstream rather than forcing an unsupported toolkit migration.
- Verified: Tauri 2.11.5 is above the GHSA-7gmj-67g7-phm9 fix floor. src-tauri/capabilities/default.json still lacks an explicit local-only assertion, and scripts/verify.mjs does not reject remote capability URLs or wildcard authority.
- Verified: src/lib/settings.ts write/writeScenarios swallow persistence failures; Settings can display a save timestamp after failure, and scenario deletion has neither failure feedback nor undo.
- Verified: src-tauri/src/commands.rs independently permits up to 4,000,000 cells and 240 full-grid PNG snapshots. The non-streaming path retains snapshots, so a valid request can exhaust memory despite passing individual limits.
- Verified: comparison mode mounts two solvers, but cancel_simulation uses global tokens; cancelling one slot can cancel the other.
- Verified: attenuation, coastal-runup, DART-fit, inspect, and globe-layer failures are commonly converted into empty/no-overlap states or console-only errors, weakening diagnosis.
- Existing keychain token storage, signing, notarization, and updater activation remain covered by prior roadmap/blocked items and were not duplicated.

## Architecture Assessment
- Root boundary: SwePlayback.tsx sends center/amplitude/sigma only; commands.rs injects a Gaussian for every source. Earthquake Okada geometry and landslide directionality never reach solver cells. Mature codes use spatial or time-dependent displacement grids.
- Physics consistency: presets.rs assigns non-impact decay exponent 1/2, while coastal and inspect paths call the nuclear r^-1 branch for every non-impact source. Introduce one Rust AttenuationModel selected by source and reused everywhere.
- Numerical geometry: solver/mod.rs computes one longitude scale at the box center for domains allowed to span ±60 degrees. GeoClaw documents latitude-dependent spherical mass terms as material for tropical-to-polar propagation.
- Analysis products: solver/max_field.rs explicitly samples only at snapshot cadence, making peak time, arrival, and integrated energy depend on the requested frame count.
- Validation boundary: scripts/verify.mjs compiles/tests/clippies only default Rust features. The validation and GPU paths can regress without entering the normal gate; the dirty GPU parity work does not fix that policy gap.
- UI/test correction: UiIcon.tsx and toolbar icons already use aria-hidden, so the existing accessibility item should target actual tab semantics, timeline button roles, Escape behavior, and keyboard traversal. tests/visual-regression.spec.ts masks/hides the Cesium canvas, so it cannot validate primitive/overlay rendering.
- Documentation drift: README.md and CONTRIBUTING.md advertise older Rust floors; CLAUDE.md names Vite 5 and wgpu as planned; science/manual pages disagree on nuclear coupling and GPU advection; docs/ipc-api.md omits shipped max-field response data.
- Modularity: commands.rs and Globe.tsx remain large, but their existing roadmap items take precedence. New work should first establish typed source fields, run plans, error states, and per-run identity so later splits follow real boundaries.

## Rejected Ideas
- CAP export, live-alert ingestion, automatic evacuation routes/maps — NOAA/UNESCO reserve operational products for authoritative systems; this would contradict the educational-only contract.
- Casualty estimates or population exposure — no public evidence resolves the existing ethical and data-quality objections; facility-count work is already tracked separately.
- Full 3D hydrodynamics, river/rain/storm coupling, sediment, morphology, or ecology — Delft3D shows the maintenance burden; these would dilute the focused tsunami product.
- Directly embedding GPL tsunami solvers — licensing and dual-model maintenance conflict with the MIT Rust-authoritative architecture.
- General plugin ecosystem — unreviewed physics/data plugins would weaken citation, validation, and support guarantees; prefer vetted import formats.
- Native mobile and multi-user collaboration — no strong demand overcame Cesium/compute constraints; the existing browser-WASM path covers lightweight reach more coherently.
- Coastal-defense drawing and spatial roughness maps now — Celeris/ANUGA support them, but credible results depend on real nearshore bathymetry and wetting/drying already tracked elsewhere.
- Checkpoint/restart now — production solvers support it, but current runs are short; reconsider after configurable long horizons, AMR, or real high-resolution grids make interruption recovery material.
- TypeScript 7.0 upgrade — the 2026-07-08 release omits the compiler API used by current tooling; wait for the planned compatible line.
- GitHub Actions or Dependabot restoration — repository policy and commit history deliberately moved verification, builds, releases, and dependency maintenance local.

## Sources
### Project
- https://github.com/SysAdminDoc/TsunamiSimulator

### OSS and Research Models
- https://www.clawpack.org/geoclaw.html
- https://www.clawpack.org/dtopotools_module.html
- https://www.clawpack.org/v5.13.x/sphere_source.html
- https://www.clawpack.org/fgmax.html
- https://plynett.github.io/
- https://tsunami.awi.de/
- https://github.com/edanya-uma/Tsunami-HySEA
- https://github.com/jagurs-admin/jagurs
- https://anuga.readthedocs.io/en/stable/
- https://sfincs.readthedocs.io/en/stable/

### Commercial and Community
- https://pro.arcgis.com/en/arcgis-pro/latest/help/mapping/simulation/simulation-in-arcgis-pro.htm
- https://tuflow.com/
- https://www.bentley.com/software/openflows-flood/
- https://www.researchgate.net/post/Is_there_any_user_friendly_and_open_source_software_for_tsunami_modelling

### Standards, Data, and Science
- https://nctr.pmel.noaa.gov/model.html
- https://tsunami.ioc.unesco.org/en/tsucat
- https://www.ncei.noaa.gov/products/natural-hazards/tsunamis-earthquakes-volcanoes/tsunamis/dart-ocean-bottom-pressure
- https://www.gebco.net/data-products-gridded-bathymetry-data/gebco2026-grid
- https://docs.ogc.org/is/21-026/21-026.html
- https://github.com/radiantearth/stac-spec
- https://cfconventions.org/conventions.html
- https://arxiv.org/abs/2508.20596
- https://pubs.usgs.gov/publication/70274101
- https://www.tsunami.gov/?page=help

### Dependencies and Security
- https://github.com/tauri-apps/tauri/security/advisories/GHSA-7gmj-67g7-phm9
- https://v2.tauri.app/reference/javascript/store/
- https://v2.tauri.app/security/capabilities/
- https://github.com/CesiumGS/cesium/blob/main/CHANGES.md
- https://github.com/gfx-rs/wgpu/releases

## Open Questions
- None. Public sources and live repository evidence were sufficient for prioritization; maintainer signing credentials remain explicit blockers in Roadmap_Blocked.md, not research questions.
