# Cataclysm Roadmap

Actionable work only. Historical and completed roadmap material is archived in CHANGELOG.md; blocked work is kept in Roadmap_Blocked.md.

## Actionable Items

- [ ] P3 — Export a single bounded GeoPackage for GIS handoff
  Why: GeoJSON/KML/CZML/CSV exports fragment related vector products, while GeoPackage provides one open, portable, offline container that QGIS/GDAL can inspect without adding a server.
  Evidence: current export set in `src/lib/export.ts`; OGC GeoPackage 1.4 https://docs.ogc.org/is/12-128r19/12-128r19.html.
  Touches: Rust SQLite/GeoPackage writer, export IPC/UI/CLI seam, shared provenance preflight, interoperability and adversarial fixtures.
  Acceptance: one `.gpkg` opens in the QGIS/GDAL versions pinned by an interoperability fixture with source/fault geometry, gauges/runup, arrival isochrones, applicable direct-effect polygons, CRS/datum, units, quality, citations, and source/data digests; table/geometry/row/size limits fail closed; a round-trip fixture verifies geometry and metadata without retaining another full run in memory.
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
