# Research — Cataclysm

## Executive Summary

Cataclysm v0.10.1 is a local-first Tauri/Cesium desktop workspace whose Rust
backend combines cited asteroid, nuclear, earthquake, landslide, and shallow-water
tsunami models. Its strongest current shape is the trust boundary already built
around scientific inputs, geodesy, rendering, run quality, coastal provenance,
offline fallback, and deterministic local verification. The highest-value
direction is to finish that trust system before adding more spectacle. In
priority order: (1) **Verified**—explicitly permission every custom Tauri
command, (2) **Verified**—make the mandatory safety notice fail safe,
(3) **Verified**—give the reference recorder a bounded, observable lifecycle,
(4) **Verified**—replace post-step wet/dry rejection with a well-balanced
positivity-preserving scheme, (5) **Verified**—add velocity/depth/momentum hazard
products, (6) **Verified**—validate a radiation/open boundary,
(7) **Verified**—repair numeric-form semantics and recoverable saved-scenario
deletion, (8) **Verified**—provide semantic chart equivalents and broader
reflow/accessibility regression coverage, (9) **Likely**—add ParaView-ready VTK
time-series export, and (10) **Likely**—compare immutable historical results
with normalized reruns after package/run identity lands.

## Product Map

- **Core workflows:** select or author a cited hazard; compute direct effects or
  run SWE propagation; inspect time, reach, gauges, runup, and direct-effect
  thresholds; compare scenarios; export visual and scientific products.
- **User personas:** educators, students, science communicators, hazard
  enthusiasts, and researchers doing exploratory analysis—not emergency
  management, warning, evacuation, or engineering design.
- **Platforms and distribution:** React 19/TypeScript 6/Vite 8 frontend; Tauri
  2.11/Rust 2024 desktop backend; Windows MSI/NSIS is the verified release path,
  with macOS/Linux source targets and CPU plus optional wgpu acceleration.
- **Key integrations and data flows:** Rust owns physics and direct-effect
  results; typed Tauri IPC and checksummed renderer messages feed Cesium; online
  Esri/OSM/Cesium context degrades to bundled Natural Earth; local settings and
  OS-keychain token storage keep analysis on-device.
- **Hard constraints:** coarse bathymetry, static idealized sources, analytical
  runup, no AMR/Boussinesq solver, unsigned installers, desktop-only interaction,
  and a current Cesium bundle that still requires a narrow CSP
  `unsafe-eval` exception.

## Competitive Landscape

### GeoClaw and ANUGA

- **Do well:** mature wet/dry SWE schemes, gauges and maximum fields, checkpoints,
  AMR/unstructured meshes, reproducible scenarios, and benchmark culture.
- **Learn:** preserve lake-at-rest states, prevent negative depth by construction,
  record flow intensity products, and make long runs restartable.
- **Avoid:** requiring users to assemble a Python/Fortran/GIS toolchain before
  they can inspect an educational scenario.

### FUNWAVE-TVD, JAGURS, and Tsunami-HySEA

- **Do well:** dispersive and nested modeling, hot starts, NetCDF interchange,
  open-boundary work, GPU/HPC execution, and point time series.
- **Learn:** boundary reflection is a measured correctness property; execution
  backends must preserve one solver/output contract.
- **Avoid:** CUDA-only coupling and exposing research switches without validity
  bounds, diagnostics, or a deterministic CPU reference.

### SWEpy and OpenSPH

- **Do well:** positivity-preserving schemes, velocity/depth outputs, VTK
  interoperability, and paired GUI/CLI workflows.
- **Learn:** keep numerical semantics independent of device and export fields in
  formats scientists can inspect without Cataclysm.
- **Avoid:** moving scientific authority into ad hoc frontend code or depending
  on a single immature GPU stack.

### OpenQuake

- **Do well:** strict admission, job identity, versioned inputs/outputs,
  sensitivity workflows, portable state, and headless reproducibility.
- **Learn:** immutable old results plus normalized current reruns make model and
  data upgrades auditable.
- **Avoid:** enterprise orchestration, financial-loss modeling, and executable
  model plugins inside the trusted desktop core.

### NUKEMAP and Nuclear War Simulator

- **Do well:** place-first setup, clear effect thresholds, point exposure,
  shelter/fallout context, comparison, sharing, and population framing.
- **Learn:** answer what happened here, when, under which model, and why; preserve
  the mandatory educational/non-operational boundary even when settings fail.
- **Avoid:** weapons-game breadth, false casualty precision, and burying core
  workflows under dense movable panels.

### Asteroid Launcher and Impact: Earth!

- **Do well:** staged consequence storytelling, intuitive scale, observer-distance
  summaries, recurrence context, and cited impact chains.
- **Learn:** pair visual effects with semantic values and explicit model limits.
- **Avoid:** artistic effects or casualty/ocean claims that outrun the cited model.

### ArcGIS Flood Simulation and Moody's Risk Modeler

- **Do well:** governed terrain/roughness inputs, stale-result handling, temporal
  products, side-by-side model-version change management, and audit-ready bulk
  workflows.
- **Learn:** retain immutable prior results and show version/data/schema deltas
  before a normalized rerun replaces any interpretation.
- **Avoid:** proprietary service dependence, insurance pricing, and presenting
  visualization-grade terrain as engineering inundation analysis.

### ParaView

- **Do well:** portable relative state, rotating autosave/recovery, headless
  extractors, and standard scientific field/time-series inspection.
- **Learn:** VTK time series and explicit recovery state broaden independent
  verification without adding executable plugins.
- **Avoid:** making a heavyweight analysis suite part of Cataclysm's runtime.

## Security, Privacy, and Reliability

- **Verified — custom commands are not explicitly permissioned.**
  `src-tauri/build.rs` calls bare `tauri_build::build()` while
  `src-tauri/src/lib.rs` registers 26 application commands. Tauri documents
  that registered application commands are allowed to all windows/webviews by
  default unless supplied through `AppManifest::commands` and capability
  permissions. Define least-privilege read/query, simulation/cancel,
  diagnostics, and keychain groups; add a negative test for an unprivileged
  webview.
- **Verified — the mandatory notice fails open on read failure.**
  `src/components/FirstRunDisclaimer.tsx:28-33` only handles a resolved settings
  read. A rejected read leaves `open=false`, so the safety notice disappears.
  Render the notice with a persistence warning on error; acknowledgement may
  remain best-effort and recur next launch.
- **Verified — reference capture has an unbounded failure path.**
  `scripts/capture-reference-scenes.mjs:319-496` bounds preview startup but has
  no overall/per-scene watchdog, structured progress heartbeat, signal cleanup,
  or verified child-tree shutdown. Local strict/reference runs repeatedly
  exceeded 5, 10, and 20 minutes and left Node/Vite workers. A failed capture
  must terminate its browser and preview tree and identify the last phase.
- **Verified — destructive saved-scenario state is not recoverable.**
  `src/components/ScenarioBuilder.tsx:532-550` deletes immediately with no
  pending/error state, rollback, or undo. Use atomic persistence and a bounded
  undo toast; restore the row if storage rejects.
- **Verified — current audits did not identify an actionable dependency CVE.**
  Vite is on the patched 8.1.2 line, Tauri is 2.11.5, wgpu is current 29.x, and
  `package-lock.json`/`Cargo.lock` contain no affected path from the advisories
  reviewed. RustSec GTK maintenance notices remain platform-inherited rather than
  a Windows exploit. Do not manufacture an upgrade row without an affected
  dependency path.
- **Recovery/rollback needs:** preserve existing solver checkpoint, transactional
  settings/import, portable-package migration, and run-admission roadmap items;
  add recorder child-tree cleanup and saved-scenario undo rather than a second
  generic recovery framework.

## Architecture Assessment

- **Numerical boundary:** `src-tauri/src/physics/solver/quality.rs` correctly
  rejects negative total depth after a step, but
  `src-tauri/src/physics/solver/kernels.rs` and `gpu.rs` do not establish a
  lake-at-rest/well-balanced invariant. Implement one wet/dry flux contract on
  CPU and GPU before relying on post-step rollback.
- **Hazard-product boundary:** `physics/solver/max_field.rs` records peak
  `|eta|`, time of maximum, arrival, and integrated `eta²`, but not maximum
  flow depth, speed, momentum, momentum flux, or minimum depth/drawdown. Extend
  the accumulator after the existing GPU-resident max-field item so products do
  not reintroduce per-step readback.
- **Domain boundary:** `physics/solver/mod.rs` documents residual sponge
  reflection. Add a selectable radiation/transmissive boundary only with an
  outgoing-wave reflected-energy fixture and CPU/GPU parity.
- **UI boundary:** `src/App.tsx` (~1,800 lines) and
  `src-tauri/src/commands.rs` (~2,700 lines) remain concentration points, but
  their decomposition is already roadmapped. Do not create duplicate refactor
  rows.
- **Form semantics:** `ScenarioBuilder.tsx:133-196` nests a help button, number
  input, and range input inside one `label`; `HazardControls.tsx:79-119`
  similarly wraps two controls and silently clamps invalid exact input. Use
  explicit IDs/group descriptions, visible validation, and keyboard/screen-reader
  tests.
- **Visualization semantics:** `AttenuationChart.tsx`, `DartOverlay.tsx`, and
  the runup gauge SVG expose names but no equivalent data table/summary for the
  encoded series, thresholds, legend, and active values. This is distinct from
  the already-roadmapped analytical-globe equivalent.
- **Test gaps:** no command-permission negative fixture, notice-read-failure
  fixture, recorder timeout/orphan-process test, lake-at-rest/dry-front parity
  case, reflected-energy boundary case, chart-equivalent assertion, or
  zoom/reflow matrix spanning builder, compare, layers, coastal results, export,
  lessons, and recovery.
- **Interoperability gap:** planned Zarr serves chunked scientific storage;
  optional `.vti` + `.pvd` serves immediate ParaView inspection and is not a
  duplicate. Gate it through the existing shared quality/provenance preflight.
- **Category disposition:** security, accessibility, observability, testing,
  offline resilience, migration, and upgrade strategy produce additions or
  existing prerequisites. i18n/l10n, docs/product truth, distribution/signing,
  checkpoints, CLI, local raster import, and ensembles already have live rows.
  Mobile and real-time multi-user work conflict with the local desktop posture;
  executable plugins conflict with the Rust-authoritative trust boundary.

## Rejected Ideas

- **Operational alerts, evacuation routing, or CAP output — rejected.** They
  contradict the explicit educational/non-operational product boundary. Source:
  NTHMP modeling guidance and `FirstRunDisclaimer.tsx`.
- **Detailed EMP simulation — rejected.** NUKEMAP's 2026 roadmap explicitly
  declines it because available public models cannot support the apparent
  precision. Source: NUKEMAP roadmap.
- **Hosted executable mods/workshop — rejected.** It broadens the desktop
  trusted-code surface and undermines cited Rust authority. Source: Universe
  Sandbox.
- **Cloud-first SaaS, insurance pricing, or real-time collaboration — rejected.**
  Governance lessons transfer; the product and privacy model do not. Source:
  Moody's Risk Modeler.
- **CUDA-only solver path — rejected.** HySEA toolchain issues reinforce the
  existing wgpu plus deterministic CPU fallback.
- **Mobile client — rejected.** The dense Cesium/scientific workspace, local
  compute, offline data, and desktop packaging are intentional constraints.
- **Replace sponge edges without a reflection benchmark — rejected.** Boundary
  sophistication without a measured reflected-energy acceptance test would only
  move uncertainty. Source: OpenFOAM/JAGURS/FUNWAVE histories.
- **Immediate Tauri, React, Cesium, wgpu, or keyring major churn — rejected.**
  Current `package.json` and `src-tauri/Cargo.toml` versions expose no verified
  defect that a migration alone fixes.
- **Economic-loss or mitigation-design engine — rejected.** Credible output needs
  validated exposure, behavior, and high-resolution inundation models not present
  in this educational simulator. Source: ArcGIS/Moody's.

## Sources

### Direct OSS and adjacent projects

- https://github.com/clawpack/geoclaw
- https://www.clawpack.org/fgmax.html
- https://github.com/anuga-community/anuga_core/releases
- https://github.com/fengyanshi/FUNWAVE-TVD
- https://github.com/jagurs-admin/jagurs/releases
- https://github.com/edanya-uma/Tsunami-HySEA
- https://github.com/joaquinmeza90/SWEpy
- https://github.com/gem/oq-engine/releases
- https://github.com/pavelsevecek/OpenSPH
- https://github.com/mandli/tsunami-models

### Commercial products and community signal

- https://blog.nuclearsecrecy.com/2026/02/10/nukemap-roadmap/
- https://db.nuclearsecrecy.com/nukemap/faq/
- https://store.steampowered.com/app/1603940/Nuclear_War_Simulator/
- https://neal.fun/asteroid-launcher/
- https://doc.esri.com/en/arcgis-pro/latest/help/mapping/simulation/simulation-in-arcgis-pro.html
- https://www.moodys.com/web/en/us/who-we-serve/insurance/intelligent-risk-platform/risk-modeler.html
- https://universesandbox.com/faq/
- https://news.ycombinator.com/item?id=33870612
- https://www.purdue.edu/impactearth/

### Standards, platform APIs, and guidance

- https://v2.tauri.app/security/capabilities/
- https://v2.tauri.app/security/permissions/
- https://vlab.noaa.gov/web/national-tsunami-hazard-mitigation-program/modeling-guidance
- https://www.w3.org/TR/WCAG22/
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/label
- https://docs.paraview.org/en/latest/UsersGuide/savingResults.html
- https://openfoam.org/release/6/

### Dependency, academic, and security sources

- https://gmd.copernicus.org/articles/19/3953/2026/
- https://vite.dev/blog/announcing-vite8
- https://github.com/advisories/GHSA-p9ff-h696-f583
- https://rustsec.org/advisories/

## Open Questions

None block prioritization or implementation. Signing credentials, updater keys,
bundled GEBCO distribution rights, and Unreal runtime availability remain
explicitly separated in `Roadmap_Blocked.md`.
