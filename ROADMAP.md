# Cataclysm Roadmap

Actionable work only. Historical and completed roadmap material is archived in CHANGELOG.md; blocked work is kept in Roadmap_Blocked.md.

## Actionable Items

- [ ] P3 — Export a single bounded GeoPackage for GIS handoff
  Why: GeoJSON/KML/CZML/CSV exports fragment related vector products, while GeoPackage provides one open, portable, offline container that QGIS/GDAL can inspect without adding a server.
  Evidence: current export set in `src/lib/export.ts`; OGC GeoPackage 1.4 https://docs.ogc.org/is/12-128r19/12-128r19.html.
  Touches: Rust SQLite/GeoPackage writer, export IPC/UI/CLI seam, shared provenance preflight, interoperability and adversarial fixtures.
  Acceptance: one `.gpkg` opens in the QGIS/GDAL versions pinned by an interoperability fixture with source/fault geometry, gauges/runup, arrival isochrones, applicable direct-effect polygons, CRS/datum, units, quality, citations, and source/data digests; table/geometry/row/size limits fail closed; a round-trip fixture verifies geometry and metadata without retaining another full run in memory.
  Complexity: M

- [ ] P2 — Surface the deterministic WebCodecs video export in the UI
  Why: `exportDeterministicVideo` (frame-stepped H.264/MP4 via WebCodecs + mp4-muxer) exists and is bug-fixed, but nothing calls it — the export menu still only offers the real-time MediaRecorder path.
  Where: `src/lib/export.ts` (helper present), export/highlight-story UI in `src/App.tsx`/`src/components/HighlightStoryDialog.tsx`, a frame-stepping `renderFrame(i)` driver over the SWE replay.
  Acceptance: an export option encodes a replay frame-by-frame with a progress indicator; feature-detected with a MediaRecorder fallback labelled real-time; failure preserves the replay and offers retry.
  Complexity: M

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

- [ ] P2 — HazEL observed-runup validation overlay (extends the historical event browser)
  Why: the planned NCEI HazEL browser loads event parameters into the scenario builder; the same API also serves 26,000+ *observed* runup points — overlaying them against simulated runup turns HazEL from a convenience loader into a per-event validation surface, the single strongest scientific-legitimacy move for the tsunami mode.
  Evidence: Verified extension of the existing "NCEI HazEL historical tsunami event browser" item — that item's acceptance stops at loading magnitude/epicentre. NCEI runup records https://www.ngdc.noaa.gov/hazel/view/hazards/tsunami/event-search.
  Touches: `src/lib/` (extend the HazEL client to fetch runup records for a selected event), `src/components/CoastalRunupOverlay.tsx`/`Globe.tsx` (observed-vs-simulated comparison layer with residuals), CSP allowlist already added by the base HazEL item.
  Acceptance: for a HazEL event with runup records, an opt-in layer plots observed runup points alongside simulated runup at comparable locations with a residual summary and explicit sampling/confidence caveats; degrades gracefully offline; does not alter solver output. Do not land before the base HazEL browser item.
  Complexity: M

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
