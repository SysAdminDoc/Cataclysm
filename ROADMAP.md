# Cataclysm Roadmap

Single source of truth for delivery. Blocked items live in
[`Roadmap_Blocked.md`](./Roadmap_Blocked.md). Shipped work is summarized in
[`CHANGELOG.md`](./CHANGELOG.md).

---

## Unification: NukeMap + AsteroidSimulator parity (2026-07-10)

Cataclysm absorbed **AsteroidSimulator** and **NukeMap** (both merged in under
`legacy/`, history preserved). v0.6.0 landed the ported **engines**; these items
rebuild their **UIs** on the Cesium globe. The standalone NukeMap and
AsteroidSimulator repos are already retired; their history and reference code
remain safe in-tree under `legacy/` while this section reaches parity.

### Standalone repos retired (2026-07-10)
- **`SysAdminDoc/AsteroidSimulator` and `SysAdminDoc/NukeMap` deleted** (GitHub +
  local) by owner direction: Cataclysm is the single primary repo. Their code and
  full history remain in-tree under `legacy/asteroid` and `legacy/nukemap` (git
  subtree). NukeMap's old GitHub Pages site (`sysadmindoc.github.io/NukeMap/`) is
  offline as a result; the nuclear experience now lives in Cataclysm's Nuclear
  mode and will ship on Cataclysm's own Pages deploy.
- The UNI-08..14 parity backlog is complete inside Cataclysm against the
  preserved `legacy/` reference.

---

## Research-Driven Additions (2026-07-12)

### P2

- [ ] P2 — Add a long-term / extinction-scale secondary-effects timeline
  Why: users explicitly want beyond-the-fireball consequences for large events (ejecta reentry heating, global firestorm, impact winter / photosynthesis shutdown, seismic shaking), and the app's Chicxulub-class presets currently stop at the immediate blast/tsunami.
  Evidence: no post-event long-term effects in results; HN extinction-scale/secondary-effects requests (https://news.ycombinator.com/item?id=33870612); Range et al. 2022 global-tsunami/energy context already cited in presets; Purdue Impact:Earth! ejecta/seismic outputs (https://www.purdue.edu/impactearth/).
  Touches: cited large-event effect models (ejecta thickness, seismic magnitude, thermal-pulse global effects), a "days/months/years after" timeline mode coupled to the scrubber, confidence/limits copy.
  Acceptance: large impacts expose cited secondary effects (ejecta blanket thickness, equivalent seismic magnitude, thermal reentry, climate-disruption narrative) staged on a long-term timeline; each effect cites a source and states uncertainty; small events omit effects that do not apply.
  Complexity: L


## Research-Driven Additions

### P1

- [ ] P1 — Keep GPU max-field accumulation resident and batch solver readback
  Why: every accepted GPU step currently reuploads host eta/u/v, dispatches one step, then submits, polls, maps, and copies three full fields so CPU max-field code can observe it, serializing the accelerated path.
  Evidence: `src-tauri/src/commands.rs` (`stream_simulation_dispatch`, `run_simulation_gpu`); `src-tauri/src/physics/solver/gpu.rs` (`step_with_diagnostics`); `physics/solver/max_field.rs`.
  Touches: WGSL buffers/kernel, `GpuTimeStepper`, GPU dispatcher, max-field encoding, cancellation/diagnostics, solver benchmark.
  Acceptance: peak, time-of-maximum, arrival, and eta² accumulation update on every accepted GPU step without host readback; eta/u/v read back only at display, cancellation, or completion boundaries; CPU/GPU products stay within declared tolerance and a fixed 4M-cell benchmark records material speedup without extra VRAM beyond budget.
  Complexity: L

- [ ] P1 — Add deterministic parameter-sensitivity ensembles with percentile products
  Why: exact single outcomes hide epistemic input uncertainty; USGS/OpenQuake practice uses ensembles and uncertainty products, which fit education when labelled sensitivity rather than occurrence probability.
  Evidence: USGS PTHA https://www.usgs.gov/publications/probabilistic-tsunami-hazard-analysis-multiple-sources-and-global-applications; ShakeMap uncertainty https://www.usgs.gov/publications/quantifying-and-qualifying-usgs-shakemap-uncertainty; OpenQuake scenario workflow https://docs.openquake.org/oq-engine/3.22/manual/user-guide/workflows/scenario-hazard.html.
  Touches: existing run admission/identity item, sampling/seed contract, batch orchestration, percentile fields/gauges, Results/Layers, exports.
  Acceptance: users select 1–3 inputs and cited bounds; a preflighted local ensemble reports median and 5th/95th percentile peak, arrival, runup, and applicable direct effects; exports include distributions, seed, sample count and failed/cancelled members; UI says sensitivity envelope, not probability/forecast.
  Complexity: L

### P2

- [ ] P2 — Define portable, non-executable scenario packages
  Why: share URLs and saved inputs do not carry solver settings, citations, local-data references, results, or migration evidence needed to reopen an exact analysis on another machine.
  Evidence: current scenario schema/settings/export paths; ParaView portable state pattern https://docs.paraview.org/en/latest/UsersGuide/savingResults.html; Universe Sandbox sharing https://universesandbox.com/faq/.
  Touches: versioned ZIP manifest/schema, scenario/settings/result serializers, optional embedded assets, import preview/migration, security tests.
  Acceptance: export/import round-trips inputs, solver settings, layers/camera, citations, provenance, optional checkpoints/results, and relative data references; packages contain no executable content and enforce path, entry-count, compressed/expanded-size, MIME, schema/version, and digest limits; future versions fail without mutation and older versions migrate as copies.
  Complexity: M

- [ ] P2 — Expose the Rust-authoritative workflow through a headless CLI
  Why: reproducible batch runs, research automation, regression generation, and independent verification currently require driving the GUI or bespoke scripts.
  Evidence: `src-tauri/src/lib.rs`/`commands.rs`; OpenSPH GUI/CLI pattern https://github.com/pavelsevecek/OpenSPH; NOAA ComMIT https://nctr.pmel.noaa.gov/ComMIT/.
  Touches: physics crate boundary, new binary target, scenario/package validation, run/compare/export/benchmark commands, structured progress and exit codes.
  Acceptance: CLI commands validate, run, resume, compare, inspect, export, and benchmark using the same Rust implementations/contracts as Tauri; JSON output is versioned and deterministic; cancellation and failures use non-zero exit codes; GUI-vs-CLI golden fixtures match.
  Complexity: L

- [ ] P2 — Offer a separately labelled offline Windows installer
  Why: Tauri defaults to downloading the WebView2 bootstrapper when the runtime is missing, so the current installer is not fully offline despite the app's classroom/offline posture.
  Evidence: `src-tauri/tauri.conf.json` (no `webviewInstallMode`); Tauri Windows installer docs https://v2.tauri.app/distribute/windows-installer/; Microsoft Evergreen guidance https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/evergreen-vs-fixed-version.
  Touches: local release build variants/manifests, installer naming/checksums, release docs, network-blocked VM smoke.
  Acceptance: the normal small installer remains; an optional `offline` MSI/NSIS embeds the Evergreen offline installer, documents its size tradeoff, and installs in a network-blocked clean Windows sandbox without WebView2; runtime servicing remains Evergreen rather than Fixed Version.
  Complexity: M

## Research-Driven Additions

### P1

### P2

- [ ] P2 — Export optional ParaView-ready VTK XML time series
  Why: planned Zarr covers chunked storage, but the scientific-visualization ecosystem expects VTK series for immediate independent field inspection.
  Evidence: Likely — SWEpy VTU output https://github.com/joaquinmeza90/SWEpy; ParaView state/extractor workflow https://docs.paraview.org/en/latest/UsersGuide/savingResults.html.
  Touches: streaming export adapter, shared quality/provenance preflight, export UI/CLI, interoperability fixture.
  Acceptance: export streams regular-grid frames as `.vti` plus `.pvd` with eta, depth, u/v, speed, quality, CRS/datum, units, simulation time, and source/data digests; ParaView 6.1 opens correct timesteps/arrays; invalid runs remain blocked; export does not retain another full run in memory.
  Complexity: M

- [ ] P2 — Compare immutable historical results with normalized current-model reruns
  Why: model/data corrections are frequent, but reopening an old analysis cannot yet show whether a changed result came from inputs, data, schema, or solver version.
  Evidence: Likely — current run/provenance types and portable-package roadmap item; Moody's model-version change management https://www.moodys.com/web/en/us/who-we-serve/insurance/intelligent-risk-platform/risk-modeler.html.
  Touches: run identity, portable package migration, immutable result snapshot, normalized rerun service, Compare/Science UI, delta export.
  Acceptance: opening an older package preserves its original result; preflight lists solver, schema, source, settings, and data-digest differences; an explicit normalized rerun creates a new linked result; Compare attributes field/gauge/direct-effect deltas to versioned inputs and never mutates the historical artifact.
  Complexity: L

## Research-Driven Additions (2026-07-14)

New items only. Verified against v0.10.4 source and a 2025-2026 external scan
(fresh code audit; NUKEMAP Feb-2026 roadmap; 2024 PAGEOPH volcanic-tsunami
review; Vilibić et al. 2025 meteotsunami review; Celeris-WebGPU; WebGPU 128;
Cesium July-2026; WCAG 2.2). Items already tracked in the sections above
(antimeridian tiled transport, run-identity/cancellation, GPU-resident
max-field, casualty-model plurality, USGS/NEO feeds, terrain draping, units,
recurrence, "why trust this", CLI, VTK, offline installer) are NOT repeated.

### P2 — reliability guards and physical credibility

- [ ] P2 — Exploit WebGPU subgroups/f16 and add a timestamp-query GPU profiler
  Why: subgroups accelerate the GPU-resident max-field and flux reductions, f16
  storage halves bandwidth on the memory-bound SWE stencil, and timestamp queries
  enable an honest per-pass in-app GPU profiler — all on the existing wgpu path
  without changing the CPU reference.
  Evidence: WebGPU 128 subgroups/f16 https://developer.chrome.com/blog/new-in-webgpu-128;
  timestamp queries https://developer.chrome.com/blog/new-in-webgpu-120;
  wgpu features https://docs.rs/wgpu/latest/wgpu/struct.Features.html;
  `src-tauri/src/physics/solver/gpu.rs`.
  Touches: WGSL kernels/reductions, optional f16 storage buffers, feature
  detection + fallback, `timestamp-query` pass wiring, diagnostics panel, solver
  benchmark.
  Acceptance: when the adapter advertises the features, subgroup reductions and
  f16 storage are used with graceful fallback and CPU/GPU products within declared
  tolerance; a fixed-size benchmark records material speedup within VRAM budget;
  the diagnostics panel reports per-pass GPU timings from timestamp queries.
  Complexity: M

- [ ] P2 — Hazard-map-literacy design pass on overlays and framing
  Why: tsunami-communication research shows users read single-scenario maps as
  certainty and safe zones as guarantees, and that comparison/percentage framings
  can mislead; leading with arrival time, adopting recognizable IOC symbology
  (clearly labelled non-operational), and showing uncertainty bands counter
  documented misreadings.
  Evidence: MDPI Water 2024 https://www.mdpi.com/2073-4441/16/23/3423;
  Springer 2025 uncertainty chapter https://link.springer.com/chapter/10.1007/978-3-031-98115-9_8;
  IOC Tsunami Ready symbology https://tsunami.ioc.unesco.org/en/tsunami-ready;
  current overlays in `src/render/cesium/**` and results copy.
  Touches: overlay color/symbology tokens, arrival-time-first result summaries,
  uncertainty-band presentation, non-operational labelling, misconception
  callouts, visual baselines.
  Acceptance: inundation/runup overlays use a documented, official-aligned
  legend with an explicit "not an evacuation map" label; results lead with
  arrival time and an uncertainty band rather than a bare single value; at least
  one misconception (safe-zone false confidence, single-scenario certainty) is
  actively pre-empted in copy; changes are covered by visual baselines.
  Complexity: M

- [ ] P2 — Close WCAG 2.2 AA gaps beyond forced-colors
  Why: a globe leans on drag (pan/rotate/place) and small targets, but there is
  no non-drag alternative, target-size floor, focus-not-obscured guarantee, or
  consistent-help affordance; these are the highest-value untracked WCAG 2.2 AA
  criteria for this UI.
  Evidence: WCAG 2.2 new criteria https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/;
  drag-to-place in `src/components/Globe.tsx`/interaction hosts; control sizes in
  `src/styles/**`.
  Touches: coordinate/keyboard alternatives for every drag-to-place/pan action,
  24×24 target-size audit, sticky-header focus-obscuring fixes, a persistent Help
  affordance, Playwright accessibility fixtures.
  Acceptance: every dragging interaction (pan, rotate, place marker) has a
  single-pointer/keyboard/coordinate alternative; interactive targets meet the
  24×24 minimum or an exception; keyboard focus is never fully obscured by fixed
  chrome; Help is reachable consistently; new axe/Playwright checks cover 2.5.7,
  2.5.8, 2.4.11, and 3.2.6.
  Complexity: M

### P3 — distribution and larger bets

- [ ] P3 — Attach an SBOM and build-provenance attestation to each release
  Why: for a scientific tool, a CycloneDX SBOM plus SLSA-style provenance on each
  GitHub Release strengthens the "why trust this" story and is increasingly
  expected, and it is achievable locally with no CI (consistent with the
  build-locally posture).
  Evidence: SLSA/reproducible-builds guidance https://reproducible-builds.org/reports/2025-07/;
  supply-chain toolchain https://github.com/bureado/awesome-software-supply-chain-security;
  existing local release flow in `scripts/build-release.mjs`.
  Touches: local SBOM generation (npm + Cargo → CycloneDX/SPDX), a provenance
  attestation step, release-manifest wiring, release docs.
  Acceptance: each release includes a machine-readable SBOM covering npm and
  Cargo dependencies and a provenance attestation of the local build; the release
  checklist and docs reference them; generation runs locally without a remote
  builder.
  Complexity: S

## Research-Driven Additions

### P1

- [ ] P1 — Automate spatial/temporal convergence and Grid Convergence Index reporting
  Why: mass/benchmark fixtures do not quantify discretization error, so resolution changes can alter arrival, peak, or runup without an observed-order or uncertainty guard.
  Evidence: existing solver quality/validation tests; NOAA convergence benchmark https://nctr.pmel.noaa.gov/benchmark/Basic/Basic_Convergence/index.html; NASA GCI guidance https://www.grc.nasa.gov/www/wind/valid/tutorial/spatconv.html.
  Touches: CPU/GPU solver benchmark harness, analytical and selected NTHMP fixtures, machine-readable convergence report, strict verification.
  Acceptance: at least three systematically refined grids/timesteps report observed order, Richardson estimate, GCI, and asymptotic-range check for arrival, peak elevation/runup, mass, and energy; CPU/GPU trends agree within declared bands; strict release verification fails on approved-fixture regression while preserving shock/discontinuity caveats.
  Complexity: L

- [ ] P1 — Add a convergence-calibrated resolution-adequacy preflight
  Why: “cells per degree” and broad cell-count caps do not tell users whether a fault, source width, or shortest declared feature is resolved, making higher-detail results look equally trustworthy.
  Evidence: `src/components/SwePlayback.tsx:535-548`; `src-tauri/src/commands.rs:905-1079`; depends on the convergence harness above; TOAST bathymetry-resolution disclosure https://docs.gempa.de/toast/current/base/simulations.html.
  Touches: run admission/estimator, source geometry metadata, Simple/Advanced solver controls, result quality/provenance, exports.
  Acceptance: preflight reports physical `dx/dy`, `dt`, cells across each source feature, estimated memory/runtime, and a convergence-calibrated adequacy grade; Simple mode selects a validated affordable grid; Advanced under-resolved overrides remain allowed but visibly marked in results and exports; no grade implies operational fitness.
  Complexity: M

### P2

- [ ] P2 — Add a bounded immutable local run archive
  Why: scenarios and crash evidence persist, but a successful result disappears when the session closes, forcing recomputation and obscuring which model/data version produced an earlier conclusion.
  Evidence: current settings/scenario persistence; existing checkpoint, portable-package, and normalized-rerun roadmap items; OpenQuake prior-run logs/outputs https://docs.openquake.org/oq-engine/3.19/manual/getting-started/running-calculations/web-ui.html; TOAST incident database https://docs.gempa.de/toast/current/base/import.html.
  Touches: versioned run-record codec/store, run completion flow, History UI, quota/cleanup, reopen/compare/export integration, corruption/migration tests.
  Acceptance: accepted runs atomically store immutable inputs, solver/schema/data digests, quality/provenance, summary/maxima/gauges, a redacted log tail, and optional fields/frames; History filters, pins, reopens without recomputation, links reruns, and supports recoverable deletion; a configurable quota uses preview-before-eviction/LRU rules; corrupt or future records are quarantined without mutating originals.
  Complexity: L

### P3

- [ ] P3 — Export a single bounded GeoPackage for GIS handoff
  Why: GeoJSON/KML/CZML/CSV exports fragment related vector products, while GeoPackage provides one open, portable, offline container that QGIS/GDAL can inspect without adding a server.
  Evidence: current export set in `src/lib/export.ts`; OGC GeoPackage 1.4 https://docs.ogc.org/is/12-128r19/12-128r19.html.
  Touches: Rust SQLite/GeoPackage writer, export IPC/UI/CLI seam, shared provenance preflight, interoperability and adversarial fixtures.
  Acceptance: one `.gpkg` opens in the QGIS/GDAL versions pinned by an interoperability fixture with source/fault geometry, gauges/runup, arrival isochrones, applicable direct-effect polygons, CRS/datum, units, quality, citations, and source/data digests; table/geometry/row/size limits fail closed; a round-trip fixture verifies geometry and metadata without retaining another full run in memory.
  Complexity: M

## Research-Driven Additions (2026-07-14 — incremental external scan)

New items only, from a focused net-new sweep of dependency changelogs, competitor/community signal, and standards. Everything already tracked above (units, casualty-model plurality, WSEG-10 fallout, USGS/NEO feeds, HazEL, meteotsunami, terrain draping, extinction-scale effects, humanitarian layer, "why trust this", i18n, WASM physics, NTHMP, ensembles, CLI, VTK/Zarr/GeoPackage, CITATION.cff, SBOM, WebGPU-128 subgroups/f16/timestamp-query, WCAG 2.2 forced-colors/drag/target-size, accessible globe/charts) is NOT repeated. Grounded against v0.10.4 source: video export already exists via `MediaRecorder`, airburst physics already exists in `direct_hazard.rs`, and Tauri `features = []` (no tray-icon/GTK advisory surface) — items are reframed accordingly.

### P1

- [ ] P1 — Wire in or remove the orphaned early-fallout dose model
  Why: `src-tauri/src/physics/fallout.rs` (466 lines, WSEG-10 / Glasstone-Dolan dose model, with companion `docs/science/fallout-dose.md`) has no `mod fallout;` declaration anywhere, so it is never compiled, tested, or referenced. As orphaned source it silently rots (compile/lint never see it) and misleads readers into thinking it is live.
  Where: `src-tauri/src/physics/mod.rs` (declare `mod fallout;`), a `fallout_dose_probe` IPC command + frontend surface, or delete the file+doc if the model is not being pursued. Maintainer decision: wire vs. remove.
  Acceptance: either the module compiles and is reachable through a tested command/consumer, or the orphaned file and its doc are removed; no uncompiled source remains in `src/physics/`.
  Complexity: M

### P2

- [ ] P2 — Surface extended max-field products in the Inspect/Results panels
  Why: max flow depth, speed, specific momentum flux, drawdown, and time-of-max-speed are now computed every step and written to the NetCDF/Zarr exports, but the interactive UI cannot display them — a point probe still reports only wave height/runup, not flow depth/speed/momentum flux/drawdown.
  Where: `src/components/PointProbePanel.tsx`/`ResultsPanel.tsx`; needs an IPC path that returns the per-cell extended values at a picked coordinate without shipping the full arrays (e.g. a `max_field_probe(lat, lon)` command), plus a Layers overlay option.
  Acceptance: a point probe reports max flow depth, speed, specific momentum flux, and drawdown at a coordinate with units; the values match the exported NetCDF/Zarr; no full-grid array is added to the result IPC payload.
  Complexity: M

- [ ] P2 — Surface the deterministic WebCodecs video export in the UI
  Why: `exportDeterministicVideo` (frame-stepped H.264/MP4 via WebCodecs + mp4-muxer) exists and is bug-fixed, but nothing calls it — the export menu still only offers the real-time MediaRecorder path.
  Where: `src/lib/export.ts` (helper present), export/highlight-story UI in `src/App.tsx`/`src/components/HighlightStoryDialog.tsx`, a frame-stepping `renderFrame(i)` driver over the SWE replay.
  Acceptance: an export option encodes a replay frame-by-frame with a progress indicator; feature-detected with a MediaRecorder fallback labelled real-time; failure preserves the replay and offers retry.
  Complexity: M

- [ ] P2 — Surface the Quick ETA preview in the UI
  Why: the `quick_eta_preview` IPC command and typed `api.quickEtaPreview` wrapper exist and are tested, but nothing calls them yet — the coarse first-arrival map is not rendered anywhere.
  Where: `src/components/SwePlayback.tsx` (a "Quick ETA" action), a new arrival-time preview layer in `src/render/cesium/**` / `Globe.tsx`, `src/lib/tauri.ts` (wrapper already present).
  Acceptance: a Quick ETA action renders the coarse arrival map as a clearly-labelled non-authoritative preview distinct from validated max-field isochrones; the full nonlinear run stays the reproducible/exported product.
  Complexity: M

- [ ] P2 — Keep globe inspect responsive during heavy playback (real async pick)
  Why: `pickEllipsoid` is a cheap analytic pick that is fine today; Cesium's only async pick (`scene.pickAsync`) resolves a *feature object*, not a ground coordinate, so it does not fit the inspect-coordinate use case. A genuine improvement needs either off-thread coordinate picking or throttling inspect during playback — not a drop-in swap. (A prior `globe.pick(ray)` swap was reverted as a non-improvement.)
  Where: `src/render/cesium/cesium-interaction-host.ts`, `src/components/Globe.tsx`.
  Acceptance: inspect during 60-frame playback returns a coordinate without a measurable animation stall, verified against the current `pickEllipsoid` baseline; picking accuracy unchanged.
  Complexity: S

- [ ] P2 — Batch large hazard overlays through Cesium `Buffer*` primitive collections
  Why: inundation polygons, blast/runup rings, and gauge points render per-entity; Cesium 1.140–1.142 shipped experimental `BufferPolygonCollection`/`BufferPolylineCollection`/`BufferPointCollection` (single GPU buffer, per-color alpha, bounding volumes) — the correct substrate for tens of thousands of simulation cells and the lower-level backing beneath the tracked `GeoJsonPrimitive` item.
  Evidence: Cesium June/April 2026 releases https://cesium.com/blog/2026/06/01/cesium-releases-in-june-2026/ and https://cesium.com/blog/2026/04/01/cesium-releases-in-april-2026/ (all ≤ pinned 1.143); overlay rendering in `src/render/cesium/**`, `src/components/Globe.tsx`.
  Touches: overlay adapters for inundation/rings/gauges, `Globe.tsx`, Playwright visual baselines (deliberately updated).
  Acceptance: a 500+-cell hazard overlay renders through one buffer collection with no visual regression and measurably better frame time than the per-entity path; the API is feature-detected with an entity fallback while it remains experimental.
  Complexity: M

- [ ] P2 — Add event sonification as an engagement and non-visual accessibility channel
  Why: the app is heavily visual with no audio; a WebAudio track (seismic rumble/P-S arrival, blast overpressure arrival, wave rumble) synchronised to the timeline is both an engagement feature no competitor offers and a genuine STEM-equity/accessibility win for blind and low-vision users, drawing on established seismic-sonification pedagogy.
  Evidence: IRIS/Columbia earthquake sonification pedagogy https://www.earth.columbia.edu/videos/view/part-2-of-2-a-deep-dive-into-earthquake-sonification-with-python-grades-10-12; timeline/transport in `src/components/SwePlayback.tsx` and the transport bar.
  Touches: WebAudio sonification module driven by solver/direct-effect series, transport coupling + mute/volume in Settings, reduced-motion/audio preference, accessibility copy, tests.
  Acceptance: an opt-in audio layer maps modeled quantities (arrival, amplitude, energy) to sound synced to the scrubber; it is off by default, respects a mute/volume setting, is described in an accessible label, and never implies operational alerting.
  Complexity: M

- [ ] P2 — Add a firestorm ignition-zone and smoke-loft overlay
  Why: large nuclear/impact events deposit thermal energy that ignites mass fires whose lofted smoke drives the climate effect, but results stop at a static thermal ring; a distinct ignition-zone + smoke-plume overlay bridges the blast/thermal module to the tracked impact-winter timeline, and NUKEMAP's own 2026 roadmap is adding thermal+conflagration modelling.
  Evidence: NUKEMAP roadmap (thermal/conflagration) https://blog.nuclearsecrecy.com/2026/02/10/nukemap-roadmap/; smoke-injection-height modelling https://docs.nlr.gov/docs/fy22osti/81470.pdf; existing thermal field in `src-tauri/src/physics/direct_hazard.rs`.
  Touches: cited ignition-threshold + smoke-lofting model in Rust, ignition-zone/smoke overlay, coupling to the extinction-scale timeline item, confidence/limits copy, tests.
  Acceptance: qualifying nuclear/impact events show a cited fire-ignition radius and a lofted-smoke indicator feeding the long-term climate narrative; each effect cites a source and states uncertainty; small events omit inapplicable effects.
  Complexity: M

- [ ] P2 — Upgrade wgpu 29→30 and add HDR fireball/thermal surface output
  Why: wgpu 30 (2026-07-01) adds surface color-space/HDR output and `SHADER_I16`; HDR tone-mapping renders the extreme luminance of a nuclear fireball or thermal field faithfully on capable Windows displays, and i16 packing cuts solver-buffer bandwidth — but v30 carries breaking API changes against the pinned wgpu-hal 29.0.4, so the upgrade must be deliberate.
  Evidence: wgpu CHANGELOG https://github.com/gfx-rs/wgpu/blob/trunk/CHANGELOG.md; pinned 29.0.4 note in `CLAUDE.md`; GPU path in `src-tauri/src/physics/solver/gpu.rs` and the Cesium HDR presentation.
  Touches: `src-tauri/Cargo.toml` wgpu/wgpu-hal/gpu-allocator bump, GPU kernel API migration (`VertexState.buffers`, `@interpolate(flat)`, `BufferBinding`), optional HDR surface config + tone-mapping, feature detection/fallback, GPU tests.
  Acceptance: the app builds and all GPU tests pass on wgpu 30 with CPU/GPU products within declared tolerance; on an HDR-capable Windows display the fireball/thermal surface renders in HDR with a graceful SDR fallback; the dx12-vs-gpu-allocator regression is re-checked before enabling any new backend.
  Complexity: M

### P3

- [ ] P3 — Add a parameterized volcanic caldera/flank-collapse tsunami source
  Why: volcanic-collapse tsunamis (Anak Krakatau 2018, Hunga Tonga 2022) are the hottest 2024–2026 tsunami-genesis research vein and a distinct mechanism absent from the four current sources, naturally coupling a volcanic event to the tsunami module; a parameterized initial-displacement source (collapse volume/geometry → initial wave) fits the existing source→IC→SWE pattern, with the dispersive/non-hydrostatic accuracy limit documented rather than claimed.
  Evidence: PAGEOPH 2024 volcanic-tsunami review https://link.springer.com/article/10.1007/s00024-024-03515-y; NHESS 2026 https://nhess.copernicus.org/articles/26/631/2026/; existing source modules in `src-tauri/src/physics/`.
  Touches: new Rust collapse source (volume/geometry/duration → initial displacement), `ScenarioBuilder.tsx` fifth source type, cited presets (Anak Krakatau 2018, Hunga Tonga 2022), `docs/science/`, applicability caveat copy.
  Acceptance: a collapse scenario produces a physically ordered initial wave from cited parameters and propagates through the existing SWE with a visible note that short/steep collapse waves need non-hydrostatic physics for near-field accuracy; presets ship with citations; CPU/GPU parity holds.
  Complexity: L

- [ ] P3 — Add an asteroid-deflection (kinetic-impactor) teaching mode
  Why: the asteroid module presents impact as inevitable, but the NGSS-aligned agency lesson is deflection — NASA confirmed (2026) DART altered Dimorphos' heliocentric orbit; a simplified Δv × lead-time → miss-distance calculator converts doom into an engineering-design lesson, distinct from the tracked NEO-discovery surface.
  Evidence: NASA DART orbit-change result https://www.jpl.nasa.gov/news/nasas-dart-mission-changed-orbit-of-asteroid-didymos-around-sun/; NGSS engineering-design practice; existing asteroid inputs in `ScenarioBuilder.tsx`.
  Touches: a deflection calculator (impulse + lead time → along-track displacement/miss distance using a documented linearised approximation, explicitly not full n-body), a "deflect it" UI mode, visualization of miss vs. impact, uncertainty/limits copy.
  Acceptance: users set an impulse and lead time and see the resulting miss distance (or reduced impact) with the linearised assumption stated; the mode is labelled a teaching approximation, never a mission prediction; the underlying impact scenario is unchanged when deflection is off.
  Complexity: L

- [ ] P3 — Add an NGSS engineering-design "mitigation" mode
  Why: classroom natural-hazard units (NGSS 4-ESS3-2, TeachEngineering "Survive That Tsunami!") are explicitly design-solution oriented, and letting a user place a barrier/sea wall and re-run makes the app curriculum-adoptable rather than a passive demo.
  Evidence: TeachEngineering tsunami design activity https://www.teachengineering.org/activities/view/cub_natdis_lesson06_activity1; NGSS 4-ESS3-2 https://thewonderofscience.com/4ess32; solver bathymetry/land-mask handling in `src-tauri/src/physics/solver/`.
  Touches: user-placed barrier objects that raise local bathymetry / add reflective cells, re-run + before/after comparison, mitigation UI, education copy tying to the standard.
  Acceptance: a user can place a simple barrier on the coast, re-run, and compare inundation with and without it; the barrier is represented as a documented bathymetry/reflectivity modification with stated simplifications; results are labelled educational.
  Complexity: L

## Research-Driven Additions (2026-07-16)

Grounded in `RESEARCH.md` (2026-07-16). Verified against the codebase to avoid
duplicating implemented physics: Ward–Asphaug ocean-impact→tsunami coupling,
`SolverMode::Linear`, and per-key settings migration already exist; the items
below are the net-new, non-duplicate opportunities from this scan.

### P2

- [ ] P2 — HazEL observed-runup validation overlay (extends the historical event browser)
  Why: the planned NCEI HazEL browser loads event parameters into the scenario builder; the same API also serves 26,000+ *observed* runup points — overlaying them against simulated runup turns HazEL from a convenience loader into a per-event validation surface, the single strongest scientific-legitimacy move for the tsunami mode.
  Evidence: Verified extension of the existing "NCEI HazEL historical tsunami event browser" item — that item's acceptance stops at loading magnitude/epicentre. NCEI runup records https://www.ngdc.noaa.gov/hazel/view/hazards/tsunami/event-search.
  Touches: `src/lib/` (extend the HazEL client to fetch runup records for a selected event), `src/components/CoastalRunupOverlay.tsx`/`Globe.tsx` (observed-vs-simulated comparison layer with residuals), CSP allowlist already added by the base HazEL item.
  Acceptance: for a HazEL event with runup records, an opt-in layer plots observed runup points alongside simulated runup at comparable locations with a residual summary and explicit sampling/confidence caveats; degrades gracefully offline; does not alter solver output. Do not land before the base HazEL browser item.
  Complexity: M

- [ ] P2 — Unified user-data schema-migration framework with upgrade tests
  Why: the app carries many independently-versioned JSON contracts and per-key settings migration is ad-hoc in `settings.ts` ("migrates legacy store copies"); there is no holistic, tested upgrade path across app versions, so a future schema change to scenarios/history/settings risks silent data loss on upgrade.
  Evidence: Verified — `src/lib/settings.ts` (~1011 lines) does per-key legacy migration; versioned contracts include `coastal_points.json` schema v2, earth-assets, source-input-contract, render-protocol; no single migration registry or cross-version upgrade test exists. Cross-ref existing portable-package/run-archive/checkpoint items (which each migrate independently).
  Touches: a single migration registry module (ordered version→version transforms for settings, saved scenarios, and run archive), `src/lib/settings.ts` and the persistence layers that consume it, a Vitest suite loading golden fixtures from prior schema versions.
  Acceptance: loading persisted data from each prior supported schema version migrates forward without loss, is idempotent, and is proven by golden-fixture tests; an unknown/future schema version fails closed with a clear recoverable message rather than corrupting state; migrations are append-only and documented.
  Complexity: M

- [ ] P2 — Data & Network trust panel with reachable-origin self-test
  Why: the product's positioning is trust-first (TrustDisclosure, FirstRunDisclaimer, disclaimers) and every feature implicitly promises local-only/no-telemetry, but there is no single surface that enumerates exactly which network origins the app can reach and asserts nothing else is contacted — an on-brand, philosophy-consistent alternative to the rejected telemetry idea.
  Evidence: Verified gap — CSP allowlist lives in `src-tauri/tauri.conf.json` and earth-provider config in `src/lib/earth-assets.ts`, but no consolidated user-facing data/privacy panel or automated origin assertion exists. Rejected-telemetry rationale in RESEARCH.md; Tauri CSP guidance https://v2.tauri.app/security/csp/.
  Touches: a new Settings/References "Data & Network" panel (lists every allowed origin, what it's used for, and that no usage/telemetry is transmitted; states keychain-local credential handling), a test that derives the allowed-origin set from the CSP/earth-assets config and fails if code references an origin not declared there.
  Acceptance: the panel enumerates every reachable origin with purpose and an explicit "no telemetry / no location transmitted" statement sourced from config, not hard-coded prose; a test asserts the app's declared origins match the CSP/earth-assets allowlist and flags any undeclared network reference; the panel works offline.
  Complexity: M

### P3

- [ ] P3 — OS notification and optional chime on long-run completion
  Why: solver runs (grid/streaming, ensembles) can take a while and users may look away; a completion notification is a small no-network quality-of-life win with no privacy cost.
  Evidence: Verified absent — no notification plugin in `package.json`/`Cargo.toml`; long runs surface only in-app via `SimulationTransport`. Tauri notification plugin (local OS notifications) https://v2.tauri.app/plugin/notification/.
  Touches: `@tauri-apps/plugin-notification` (+ capability grant scoped to the main window), `src/components/SwePlayback.tsx`/`App.tsx` (fire on run completion/failure), a Settings toggle honoring the existing sonification/quiet preferences, `src/lib/settings.ts`.
  Acceptance: when a long run finishes or fails while the window is unfocused, an opt-in local OS notification (and optional short chime reusing the sonification path) fires; the toggle defaults consistently with existing audio/quiet settings; nothing is transmitted off-device; disabled in teacher/classroom-locked mode if it would disrupt a lesson.
  Complexity: S

- [ ] P3 — Interactive "poke the wave" exploratory sandbox (non-reproducible mode)
  Why: Celeris' entire engagement hook is letting users perturb the wave field live and watch it respond — a powerful teaching affordance Cataclysm's wgpu solver can support; scoped explicitly as an exploratory mode that never feeds the deterministic/archived pipeline so it doesn't violate the reproducibility rules.
  Evidence: Celeris-WebGPU interactive editing https://plynett.github.io/ · https://github.com/plynett/plynett.github.io; existing GPU solver in `src-tauri/src/physics/solver/gpu.rs`. Reproducibility constraint per CLAUDE.md (max-field products must observe every accepted step) — this mode is deliberately outside that pipeline.
  Touches: a sandbox toggle in the playback UI, an IPC path that injects a bounded surface perturbation at a picked globe point into a running/paused linear-mode solve, clear "Exploratory — not a validated or exportable run" labelling, guardrails preventing sandbox state from being archived/exported/compared.
  Acceptance: in an explicitly-labelled exploratory mode, clicking the globe injects a bounded disturbance and the wave field visibly responds; the mode cannot produce archived, compared, or exported results and is visually distinct from validated runs; leaving the mode restores the authoritative run state; determinism of the normal pipeline is unaffected.
  Complexity: L
