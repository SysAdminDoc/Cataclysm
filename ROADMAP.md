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

### P1 — Nuclear mode (core NukeMap experience)
- ✅ **UNI-01** Hazard-mode switch in the top bar (Tsunami / Impact / Nuclear). *(v0.6.0)*
- ✅ **UNI-02** Nuclear input panel: weapon preset picker (`WEAPON_PRESETS`), log
  yield slider, burst-type selector, population density, pick-on-globe. *(v0.6.0)*
- ✅ **UNI-03** Cesium ring renderer for `HazardResult.rings` (concentric ground
  ellipses + ground-zero marker + auto-frame). Shared by nuclear and asteroid
  modes. Replaces NukeMap `js/effects.js`. *(v0.6.0)*
- ✅ **UNI-04** Results readout + casualty estimate + ring legend. *(v0.6.0)*
  Remaining sub-item: detonation timeline (port `NM.calcTimeline`).
- **UNI-05** Fallout plume overlay (wind angle/speed) as a Cesium polygon —
  port `NM.Effects.drawFallout`.
- **UNI-06** Shelter advisor (port `js/shelter.js`, already pure): per-shelter-type
  survival probability at key radii from blast/thermal/radiation interpolation.

### P2 — Impact mode + data
- ✅ **UNI-07** Asteroid input panel (diameter/velocity/angle/density/target) wired
  to the ported engine. *(v0.6.0)* Remaining: `TrajectoryChart`/`CraterDiagram`
  SVG components from `legacy/asteroid/src/components/Results`.
- **UNI-08** NEO/fireball database integration (port `services/jplApi.ts`,
  `useFireballs`, fallback datasets) with the app's CSP allowlist.
- **UNI-09** Port NukeMap target/weapon/city/ZIP datasets (`data/*.json`,
  `js/zipcodes.js`, 41,958 ZIPs; `js/data.js` tables) to typed JSON;
  location search + density estimation from real city table.
- **UNI-10** Historical presets: fold NukeMap's 10 tests + AsteroidSimulator's
  6 impact presets into the unified preset registry alongside the tsunami presets.

### P3 — Advanced NukeMap features (breadth parity)
- **UNI-11** WW3 exchange engine: port scenario/target data + casualty aggregation
  (pure) from `js/ww3.js`; rebuild missile arcs + HUD as React/Cesium (708
  warheads, 427 targets, 7 scenarios).
- **UNI-12** MIRV mode (port `NM.MIRV.generatePattern`, already pure) + pattern
  preview on the globe.
- **UNI-14** Export/PWA parity: extend existing exporters (PNG/CZML/GeoJSON/KML)
  to nuclear/impact results; preserve NukeMap's offline single-file capability
  path where feasible under Vite/Tauri.

### Standalone repos retired (2026-07-10)
- **`SysAdminDoc/AsteroidSimulator` and `SysAdminDoc/NukeMap` deleted** (GitHub +
  local) by owner direction: Cataclysm is the single primary repo. Their code and
  full history remain in-tree under `legacy/asteroid` and `legacy/nukemap` (git
  subtree). NukeMap's old GitHub Pages site (`sysadmindoc.github.io/NukeMap/`) is
  offline as a result; the nuclear experience now lives in Cataclysm's Nuclear
  mode and will ship on Cataclysm's own Pages deploy.
- The UNI-05/06/08..14 items below remain the parity backlog, now worked entirely
  inside Cataclysm against the preserved `legacy/` reference.

---

## Research-Driven Additions (2026-07-09)

Grounded in `RESEARCH.md` (2026-07-09). Items marked "returns from
Roadmap_Blocked" had "Needs MSVC linker / Rust compilation" blockers that are
stale: the VsDevCmd wrapper works and `npm run verify` runs 67 Rust release
tests locally.

### P1 — solver fidelity (from the 2026-07-09 second research pass)

- [ ] P1 — Preserve source geometry in the SWE initial field
  Why: `simulate_grid` reduces every source to one circular Gaussian (`grid.inject_gaussian(lat, lon, initial_amplitude_m, source_sigma_m)`) — the Okada dipole uplift/subsidence field, landslide directionality, and cavity ring structure the UI presents are all discarded before propagation, so the solver contradicts the source readouts. RESEARCH.md (2026-07-09 second pass) ranks this the top solver-fidelity gap; see its Architecture Assessment for companion items (per-row spherical metrics, step-cadence maxima, unified attenuation model).
  Evidence: src-tauri/src/commands.rs (`inject_gaussian` call in both simulate paths); `OkadaFault::vertical_displacement_field` already computes the full uz grid and is unused by the solver.
  Touches: src-tauri/src/commands.rs (source-aware IC injection), src-tauri/src/physics/solver/mod.rs (`inject_field` from a sampled displacement grid), SwePlayback request plumbing.
  Acceptance: an earthquake preset run shows the characteristic uplift/subsidence dipole in frame 0 (not a symmetric bump); asteroid/nuclear keep the cavity ring; landslide keeps directionality; CPU/GPU parity holds.
  Complexity: L

### P2 — cited presets, products, and architecture

- [ ] P2 — Modularize commands.rs into submodules
  Why: 1,944 lines and growing with each new IPC; split into types/validators/simulation/source/query keeps the boundary reviewable. Returns from Roadmap_Blocked (stale MSVC blocker).
  Evidence: src-tauri/src/commands.rs line count; Roadmap_Blocked "Modularize commands.rs".
  Touches: src-tauri/src/commands/ (new module tree), src-tauri/src/lib.rs.
  Acceptance: no behavior change; all 67+ Rust tests pass; no file exceeds ~600 lines.
  Complexity: M

- [ ] P2 — Port inundation/gauge overlays to Cesium `GeoJsonPrimitive` + arrival-colored paths via `PathGraphics.materialMode`
  Why: Cesium 1.142's `GeoJsonPrimitive` bypasses the Entity layer for exactly this app's dynamic vector loads; 1.143's "PORTIONS" material mode enables per-interval arrival-time coloring of propagation paths — both free perf/visual wins after the 1.143 bump.
  Evidence: Cesium CHANGES.md 1.142/1.143; runup overlays already migrated to Primitive API (2026-06-19 CLAUDE.md status) — this extends the pattern.
  Touches: src/components/Globe.tsx, src/components/CoastalRunupOverlay.tsx.
  Acceptance: inundation discs and gauge markers render via primitives with no visual regression (Playwright visual baselines updated deliberately); frame rate on a 500-point run measurably improves or holds.
  Complexity: M

- [ ] P2 — NCEI HazEL historical tsunami event browser
  Why: the NCEI Natural Hazards REST API serves 2,200+ tsunami sources and 26,000+ runup records as free JSON — a one-click "load a real historical event" picker built on it dwarfs the 12-preset registry without bloating the binary.
  Evidence: https://www.ngdc.noaa.gov/hazel/ (public REST API backing).
  Touches: src/components/ (new browser modal, online-only with clear offline state), src-tauri capability/CSP allowlist for the NCEI host, src/lib/ (API client + mapping to scenario parameters with confidence caveats).
  Acceptance: searching "1960 Chile" lists the event and loads magnitude/epicenter into the scenario builder with a provenance note; feature degrades gracefully offline; CSP gate updated deliberately.
  Complexity: M

- [ ] P2 — Compile the physics crate to WASM for browser preview (retire demo.ts physics)
  Why: `demo.ts` (703 lines) forks physics truth and its numbers drift — the documented carve-out exists only because the browser can't call Rust; wasm-bindgen removes that constraint, deletes the drift class entirely, and is the foundation for any future web demo (Celeris-WebGPU is capturing the zero-install audience). Supersedes blocked "Build-time demo data generation from Rust".
  Evidence: src/lib/demo.ts; CLAUDE.md carve-out note; Celeris June 2026 momentum https://github.com/plynett/plynett.github.io/commits/main.
  Touches: src-tauri (physics crate split or wasm feature + wasm-bindgen exports for source models, far-field, runup — solver optional), vite.config.ts (wasm asset), src/lib/demo.ts (thin wrapper over WASM), CSP (wasm-eval already effectively allowed via unsafe-eval).
  Acceptance: browser preview source readouts/attenuation/runup numbers come from the same Rust code as desktop (spot-check equality); "APPROXIMATE" watermark scope narrows to the JS SWE playback only (or is removed if the solver is also compiled); bundle size delta documented.
  Complexity: L

- [ ] P2 — Meteotsunami source type (moving pressure disturbance, Proudman resonance)
  Why: demand triangulates three ways — GeoClaw issue #694 requests parameterized pressure forcing, EDANYA ships a dedicated Meteo-HySEA code, and the record June 2025 Lake Superior meteotsunami (45-inch surge) is a citable preset; the Lamb-wave module is precedent for atmospheric coupling but this needs time-dependent forcing in the solver loop.
  Evidence: https://github.com/clawpack/geoclaw/issues (#694); https://www.glerl.noaa.gov/blog/2025/07/18/june-21-2025-storm-causes-significant-meteotsunami-and-seiche-on-lake-superior/; Meteo-HySEA https://cheese2.eu/news/the-power-of-hysea-advancing-tsunami-simulations/.
  Touches: src-tauri/src/physics/ (new source module: pressure amplitude, disturbance speed/heading, track), solver/mod.rs + gpu.rs (per-step pressure-gradient forcing term), ScenarioBuilder.tsx (fifth source type), docs/science/, presets.rs (Lake Superior 2025-06-21 preset).
  Acceptance: a moving-pressure scenario reproduces Proudman amplification when disturbance speed ≈ √(gh) (validation test); Lake Superior preset ships with GLERL citation.
  Complexity: L

- [ ] P2 — NTHMP benchmark cases in the validation harness
  Why: the canonical benchmark data is publicly downloadable (rjleveque/nthmp-benchmark-problems) — the "data acquisition" half of the blocked item is stale; start with the 1-2 propagation benchmarks solvable by a non-dispersive SWE code (e.g., BP4 solitary wave on a simple beach analog to existing Synolakis work) rather than the full suite.
  Evidence: https://github.com/rjleveque/nthmp-benchmark-problems; existing validation feature (Stoker, Carrier-Greenspan, Range 2022) in src-tauri/src/physics/validation.rs. Cross-ref Roadmap_Blocked "NTHMP benchmark suite integration" (P3/XL) — this is the tractable first slice.
  Touches: src-tauri/src/physics/validation.rs (new feature-gated cases + vendored benchmark data snippets with license note), docs/science/VALIDATION.md.
  Acceptance: at least one NTHMP propagation benchmark passes within a documented tolerance under `cargo test --release --features validation`; VALIDATION.md documents which benchmarks are out of reach without Boussinesq/AMR and why.
  Complexity: L

### P3 — education distribution and larger bets


- [ ] P3 — Zarr v3 scientific output export via `zarrs` (pure Rust)
  Why: gives researchers a chunked, self-describing raw-field export without the C-library NetCDF burden that keeps the NetCDF item blocked; zarrs 0.23.x is spec-complete Zarr v3.1. Note: raises rust-version to 1.91 (schedule after the P0 1.87 bump).
  Evidence: https://crates.io/crates/zarrs; Roadmap_Blocked "NetCDF output export" C-dependency blocker.
  Touches: src-tauri/Cargo.toml, new export command (eta/max-field arrays + CF-style attrs), src/lib/export.ts (menu entry, desktop-only).
  Acceptance: an exported store opens in Python (`zarr.open`) with correct dims/coords/units; documented in the manual.
  Complexity: M

- [ ] P3 — Humanitarian-impact layer: OSM schools/hospitals/critical facilities inside the runup zone
  Why: NUKEMAP's 2026 roadmap names this the top public-facing addition; it is the ethically softer alternative to the rejected casualty overlay — counts of facilities, not people.
  Evidence: https://blog.nuclearsecrecy.com/2026/02/10/nukemap-roadmap/.
  Touches: src/lib/ (Overpass API client, online-only, cached), Globe.tsx (facility pins within inundation discs), CSP allowlist, disclaimer copy (first-order estimate framing).
  Acceptance: for a completed run, an opt-in layer lists/pins OSM-tagged schools+hospitals inside inundation extents with an explicit limitations note; degrades gracefully offline.
  Complexity: L

- [ ] P3 — i18n foundation + Spanish/Japanese/Bahasa Indonesia
  Why: IOC/ITIC distributes tsunami education in exactly these languages and PhET's translated+offline model proves distribution value; do the string-catalog extraction first, translations second. Cross-ref Roadmap_Blocked "Multi-language UI" — this refines its language order with evidence.
  Evidence: http://itic.ioc-unesco.org/index.php?option=com_content&view=article&id=1349&Itemid=+1075&lang=en; https://phet.colorado.edu/en/simulations/translated.
  Touches: all user-facing strings (extraction to catalog), src/lib/ (locale plumbing), Settings.tsx (language picker), glossary/lesson content.
  Acceptance: language switch swaps full UI including lessons/glossary; en remains canonical; missing keys fall back to en with a dev warning.
  Complexity: XL

## Research-Driven Additions (2026-07-11 — living Earth data stack)

Grounded in `RESEARCH.md` (2026-07-11). These are prerequisites and data/render
contracts not already covered by HR-00 through HR-53; they do not replace the
existing Earth, ocean, hazard, or Unreal milestones.

### P0 — physical and legal foundations

### P1 — deterministic living-planet inputs

- [ ] P1 — Antimeridian/polar tiled field transport
  Why: the current SWE imagery rectangle clamps longitudes rather than splitting
  wrapped fields, so waves near ±180 degrees can be cropped; polar convergence
  also makes a single geographic rectangle increasingly distorted.
  Evidence: `Globe.tsx` clamps SWE rectangle bounds; serious globe engines use
  quadtree/tiled fields and geocentric positioning rather than one global quad.
  Touches: frame-field tile schema, Rust snapshot encoder, Cesium texture/mesh
  addressing, Unreal field upload, dateline/polar fixtures.
  Acceptance: identical scenarios centered at 179.5°E and 179.5°W join without a
  seam or crop; high-latitude fields retain orientation and sampling accuracy;
  tiled transport preserves eta/u/v within renderer precision.
  Complexity: L

## Research-Driven Additions

### P0

### P1

- [ ] P1 - UX-06: Turn guided lessons into interactive globe stories
  Why: Guided training is hidden in an accordion and opens a static four-step modal that blocks the globe instead of directing the user through it.
  Evidence: live Tohoku guided-lesson audit; `PresetSelector.tsx`, `GuidedLesson.tsx`, `src/lib/guided-lessons.ts`; Google Earth Voyager and ArcGIS guided tours use sequenced places, camera changes, and media (https://earth.google.com/intl/versions/ and https://storymaps.arcgis.com/stories/2ed07d655eb64835b2244ef95da667fd); NASA Eyes uses interactive scrollytelling and ride-alongs (https://science.nasa.gov/eyes/).
  Touches: guided-story schema, `GuidedLesson.tsx`, camera/timeline commands, contextual callouts, focus management, worksheet/export path, visual and keyboard tests.
  Acceptance: each lesson can load a scenario, focus/highlight a real control or map feature, move the camera, seek/play a key moment, and present a short explanation beside rather than over the action; users can Explore freely or Follow story; Back/Next/Skip are always available; progress persists; reduced motion and screen-reader narration receive equivalent content.
  Complexity: L

- [ ] P1 - UX-07: Add visual scenario packs, favorites, recents, and Surprise Me
  Why: current cards are dense text rows and do not communicate spectacle, scale, duration, or why an event is worth opening; discovery ends after scanning 11 names.
  Evidence: live scenario-library audit; `PresetSelector.tsx` and `_presets.css`; Universe Sandbox emphasizes historical simulations and shareable simulation discovery (https://universesandbox.com/presskit/); Google Earth offers Voyager plus a roll-the-dice discovery action (https://earth.google.com/intl/versions/).
  Touches: scenario presentation metadata/thumbnails, preset grouping/filtering, local favorites/recents, deterministic surprise selection, provenance validation, capture script and accessibility tests.
  Acceptance: curated packs include Start Here, Asteroid Scale Ladder, Nuclear Scale Ladder, Ocean Disasters, Fact Check, Near-Earth Objects, and Scenario Duels; cards show a real preview image, hazard, scale, runtime, confidence, and key promise; favorites and recents are local and recoverable; Surprise Me chooses only complete cited scenarios and explains the selection; thumbnails are deterministic captures, not misleading concept art.
  Complexity: M

- [ ] P1 - UX-08: Ship one-click comparison stories instead of an empty Slot B
  Why: Compare currently splits the globe before Slot B is chosen and requires a compact dropdown, leaving casual users to invent a meaningful comparison themselves.
  Evidence: live Compare audit; `App.tsx` compare-source selector and dual-slot composition; NUKEMAP was designed to contextualize effects by comparing historical weapon scales (https://blog.nuclearsecrecy.com/2012/02/03/presenting-nukemap/).
  Touches: comparison-pair manifest, Compare launcher, linked cameras/timelines, delta summaries, preset cards, export metadata and visual tests.
  Acceptance: Compare opens with suggested pairs such as Tohoku vs Indian Ocean, Chelyabinsk vs Chicxulub, Hiroshima vs Tsar Bomba, and realistic vs claimed Poseidon; choosing a pair populates both slots, frames comparable extents, synchronizes meaningful times, and summarizes the largest defensible differences; custom Slot B remains available under Advanced.
  Complexity: M

- [ ] P1 - UX-09: Establish a legible desktop density and typography system
  Why: many operational labels and cards render at 9-10 px across three dense columns, forcing users to decode metadata before seeing hierarchy even at the supported 1600x1000 desktop size.
  Evidence: live 1600x1000 audit; 9-10 px rules throughout `_layout.css`, `_presets.css`, `_inspector.css`, `_results.css`, and `_lesson.css`.
  Touches: semantic type/density tokens, shared buttons/inputs/cards/tabs, left library, right inspector, transport, settings, dark/light visual baselines and WCAG tests.
  Acceptance: normal operational text is at least 12 px with readable line height; microtext is restricted to secondary provenance; scenario cards prioritize name/promise over raw metadata; repeated controls share heights, spacing, and focus/hover/selected states; Compact density is explicit and never the first-run default; dark and light 1440p/4K references remain unclipped.
  Complexity: M

- [ ] P1 - UX-10b: Group the Export menu into labelled Image / Replay / Share / Data sections
  Why: "Replay first-run notice" now opens the notice immediately (fixed), and each export button already surfaces its unlock reason via a toast, but the eight-plus formats still render as one flat list rather than described, categorised groups.
  Evidence: `App.tsx` export popover (flat `ToolbarButton` list with `disabledReason`); `FirstRunDisclaimer.tsx`/`Settings.tsx` replay path shipped.
  Touches: export popover grouping/section labels + short descriptions, `_layout.css`/export styles, Playwright accessibility tests.
  Acceptance: export formats are grouped as Image, Replay, Share, and Data with a one-line description per group; each unavailable format's prerequisite is discoverable inline (not only on click); no toolbar opens into a wall of unlabelled buttons.
  Complexity: S

- [ ] P1 - UX-11: Add a Near a place I know experience over the UNI-09 location data
  Why: scientific scale becomes emotionally legible when users can relate arrival times and effect distances to a familiar city; current direct hazards require a precise globe click and tsunami outcomes are organized around model internals.
  Evidence: live Impact/Nuclear targeting audit; UNI-09 city/ZIP dataset work; NUKEMAP deliberately combines city search, historical yields, auto-zoom, and familiar local context (https://db.nuclearsecrecy.com/nukemap/faq/).
  Touches: UX layer over the UNI-09 typed location index, Quick Start, hazard targeting, tsunami place probes, result summaries, privacy copy, local search and keyboard tests.
  Acceptance: users can search city, ZIP, landmark, or paste coordinates; the app never requests or infers live location by default; historical presets retain their factual origin while What if near... creates a clearly labeled custom copy; results lead with distance, arrival/effect timing, and defensible local context; searches work offline from the packaged index and never transmit the query.
  Complexity: M

- [ ] P1 - UX-12: Turn UNI-08 into a Planetary Defense Live discovery surface
  Why: a live catalog of real close approaches gives average users an immediate reason to return and connects asteroid spectacle to current science, while the current asteroid experience begins with anonymous diameter/velocity sliders.
  Evidence: UNI-08 NEO/fireball integration; NASA Eyes tracks more than 30,000 near-Earth objects, highlights the next five close approaches, and separates real-time orbit exploration from educational stories (https://science.nasa.gov/eyes/ and https://www.jpl.nasa.gov/asteroid-watch/eyes-on-asteroids/).
  Touches: UX shell over UNI-08 data/cache, live discovery cards, orbit/approach camera view, uncertainty/provenance panel, hypothetical-impact copy boundary, offline stale-data state.
  Acceptance: a Today / Next approaches collection shows current JPL objects with size range, miss distance, date, uncertainty, and last-updated time; Explore real approach never depicts an impact; Try a hypothetical impact creates an explicit non-prediction scenario using cited assumptions; cached data remains browsable offline with a stale badge; no object is described as dangerous without authoritative risk data.
  Complexity: L

- [ ] P1 - UX-13: Make deterministic replays shareable as short highlight stories
  Why: the current Export menu is format-first and Video is simply unavailable; the most compelling output for a casual user is a short, trustworthy story they can replay or share, not a raw GIS file.
  Evidence: live Export audit; existing HR-53 deterministic replay/capture contract; Google Earth presents authored stories and shareable projects (https://earth.google.com/intl/versions/); Universe Sandbox supports sharing simulations (https://universesandbox.com/presskit/).
  Touches: UX layer over HR-53 replay, chapter/key-moment metadata from HR-51, export popover, 15/30/60-second templates, title/stat cards, attribution/provenance, local file/share-link tests.
  Acceptance: Share story offers deterministic 15, 30, and 60 second cuts assembled from named key moments without rerunning physics; output includes scenario title, time, scale anchors, uncertainty/educational label, renderer/source attribution, and optional captions; users can preview before saving; clean cinematic and analytical variants are distinct; failure preserves the replay and offers retry without recomputation.
  Complexity: M

- [ ] P1 - UX-15: Put a contextual Why trust this? drawer beside every scenario and result
  Why: References currently opens a long global bibliography, forcing users to hunt for the active event and leaving model assumptions, confidence, limitations, and citations detached from the claim they are evaluating.
  Evidence: live References and Results audit; `src/components/ReferencesModal.tsx`, preset citation metadata, direct-hazard authority/model versions, and confidence fields already present in result contracts.
  Touches: contextual evidence view model, scenario preview, result summary, layer inspector, `ReferencesModal.tsx`, citation-link validation, export/replay provenance, screen-reader and offline-link states.
  Acceptance: every active scenario, outcome card, and analytical layer exposes one consistent Why trust this? action showing source title, model/version, key assumptions, confidence or validation status, limitations, and the exact citations supporting that claim; speculative and historical cases remain visibly distinct; broken or legacy links are labelled without hiding the citation; the global bibliography remains available under Advanced; exported stories preserve the same evidence identifiers.
  Complexity: S

- [ ] P1 — Implement row-aware spherical SWE metrics and conservation tests
  Why: one longitude scale computed at box-center latitude is applied to every row in domains up to 120 degrees wide, biasing cell geometry and transport away from the center latitude.
  Evidence: metric setup and use in `src-tauri/src/physics/solver/mod.rs`; domain caps in `src-tauri/src/commands.rs`; Clawpack documents latitude cell-size source terms as important for tropic-to-pole propagation; Celeris-WebGPU added a spherical NLSW solver in 2026.
  Touches: grid geometry, flux/source terms, CFL calculation, CPU/GPU kernels, conservation and latitude-symmetry fixtures.
  Acceptance: per-row metric terms are used consistently on CPU/GPU; still-water and mass/energy fixtures remain bounded; mirrored low/high-latitude scenarios agree in physical distance/time within tolerance; dateline and polar tests pass.
  Complexity: L

- [ ] P1 — Give solver runs identity, scoped cancellation, and resource admission
  Why: one global token list makes Cancel affect every active run, compare can double a roughly 352 MB high-resolution allocation, and closed snapshot receivers do not stop computation.
  Evidence: cancellation registry and streaming sends in `src-tauri/src/commands.rs`; grid/max-field allocations in `src-tauri/src/physics/solver/**`; ANUGA documents checkpointing, parallel memory failures, and resource troubleshooting.
  Touches: IPC request/response types, run registry, cancellation commands, memory/concurrency estimator, compare orchestration, diagnostics.
  Acceptance: every run has an ID and lifecycle; cancel-by-ID leaves other runs active; closed receivers terminate work; completion reports actual emitted frames and cancellation; over-budget compare/run requests are rejected before allocation with a calculated explanation.
  Complexity: L

- [ ] P1 — Make settings persistence and import transactional
  Why: writes can fail while the UI reports success; imports apply key-by-key without rollback or size limits; a future schema is stamped down to v1; early edits and classroom-lock state can be overwritten or remain stale.
  Evidence: `src/lib/settings.ts` write/migration/import paths; `src/components/Settings.tsx` load/apply/import/reset flows; Tauri Store persists in app data and returns asynchronous operations.
  Touches: settings schema validator, migration registry, staged snapshot/rollback, file-size cap, Settings loading/commit state, failure tests.
  Acceptance: the UI is non-editable until the durable snapshot loads; all changes prevalidate and commit atomically; any write failure restores prior durable/in-memory state and shows recovery; future schemas are rejected without mutation; import/reset immediately refresh every dependent setting.
  Complexity: M

- [ ] P1 — Use typed loading, empty, stale, and error states for derived outputs
  Why: preset, runup, attenuation, inspect, SWE, saved-scenario, and DART failures currently collapse into loading, empty, waiting, or “no overlap,” making failed computations look valid.
  Evidence: `PresetSelector.tsx`, `CoastalRunupOverlay.tsx`, `AttenuationChart.tsx`, `Globe.tsx`, `DartOverlay.tsx`, `ScenarioBuilder.tsx`; professional hazard tools distinguish workflow/output failures.
  Touches: shared async-result type, affected components/hooks, toast/log linkage, retry actions, unit and Playwright failure fixtures.
  Acceptance: each surface distinguishes loading, valid empty, current result, stale prior result, and error; errors retain the last valid result with a stale marker when safe; retry is local; “no overlap” is used only for a successful comparison with zero overlap.
  Complexity: M

- [ ] P1 — Turn Layers into a real simulator layer controller
  Why: `LayerInspector` exposes only Active/Waiting inventory despite a Layers affordance; professional globe tools provide visibility, opacity, order, legend, temporal coupling, and persistent layer state.
  Evidence: `src/components/LayerInspector.tsx`; OpenSpace layer groups/order/time controls; NASA Worldview and WorldWind Explorer layer opacity, ordering, palette, and comparison controls.
  Touches: layer descriptor/state model, `LayerInspector.tsx`, Cesium overlay adapters, settings/scenario schema, exports, accessibility tests.
  Acceptance: applicable layers can be shown/hidden, reordered, opacity-adjusted, reset, and inspected for legend/provenance; unavailable layers explain prerequisites; state persists per scenario and is represented in share/export metadata; controls are fully keyboard accessible.
  Complexity: L

- [ ] P1 — Establish an authoritative product-truth and planning-ledger gate
  Why: tracked docs, onboarding, screenshots, and blocked work still contain legacy product names, versions, frame counts, runtime floors, provider defaults, release URLs, and already-shipped blockers.
  Evidence: `CONTRIBUTING.md`, `SECURITY.md`, `docs/manual/**`, `docs/science/**`, `Tour.tsx`, screenshot assets, `Roadmap_Blocked.md`; current `scripts/verify.mjs` docs checks cover only a small subset of drift.
  Touches: authoritative product constants/manifest, affected docs/onboarding/screenshots, `scripts/verify.mjs`, `ROADMAP.md`, `Roadmap_Blocked.md`.
  Acceptance: legacy/current product facts are reconciled; shipped and duplicate blocked entries are removed; docs and onboarding derive or validate name/version/runtime/frame/provider facts; verification fails on stale product names, release links, version strings, provider defaults, or completed blockers.
  Complexity: M

### P2

- [ ] P2 — Extend static checks to tests, scripts, configs, and fresh E2E output
  Why: Playwright tests, config files, and verification scripts escape normal type/lint coverage, and standalone E2E can preview a stale `dist` directory.
  Evidence: `tsconfig.json`, `eslint.config.js`, package lint scripts, `playwright.config.ts`, `tests/**`, `scripts/**`.
  Touches: dedicated support-code tsconfig/JS checking, ESLint targets, E2E prebuild contract, verification tests.
  Acceptance: tests/config/scripts are type- or check-validated and linted; E2E always builds or proves a matching fresh artifact before preview; an intentionally stale `dist` fixture is rejected; the full local release gate remains deterministic.
  Complexity: M

## Research-Driven Additions (2026-07-12)

New items only. The existing undated and dated Research-Driven Additions sections
above are still open (verified against v0.10.0 source) and are NOT repeated here.
This pass adds gaps not previously tracked, grounded in a fresh code audit and a
2025-2026 competitive scan (NUKEMAP Feb-2026 public roadmap, Asteroid Launcher,
USGS/JPL feeds, Celeris-WebGPU, GHS-POP, Cesium 1.135, SLSA).

### P1

- [ ] P1 — Add a units system: metric/imperial plus intuitive comparison anchors
  Why: readouts are SI-only, the single most repeated complaint about impact/blast simulators, and comparison anchors ("Hiroshimas", "Tsar Bombas", city diameters) are what make scale legible to non-experts.
  Evidence: SI-only readouts across `ResultsPanel.tsx`/hazard readouts; HN Asteroid Launcher feedback (https://news.ycombinator.com/item?id=33870612); Outrider comparison framing (https://outrider.org/nuclear-weapons/interactive/bomb-blast).
  Touches: units setting + formatter, `ResultsPanel.tsx`, hazard readouts, runup/DART/attenuation labels, exports, settings persistence, tests.
  Acceptance: a persisted units toggle switches every displayed quantity between metric and imperial without touching solver values; energies/yields optionally show comparison anchors; exports record the unit system; no raw SI value leaks when imperial is selected.
  Complexity: S

- [ ] P1 — Show event frequency / recurrence context after every run
  Why: users repeatedly ask "how often does this happen?"; a calibrated recurrence interval with an uncertainty band turns raw destruction into an honest probability lesson and is core to the educational mission.
  Evidence: no recurrence output in `ResultsPanel.tsx`/hazard results; Asteroid Launcher recurrence framing (https://neal.fun/asteroid-launcher/); HN frequency-honesty requests (https://news.ycombinator.com/item?id=33870612).
  Touches: cited recurrence model per source (impactor size→interval, quake Mw→regional rate, yield context), result view models, confidence copy, references.
  Acceptance: each result states an order-of-magnitude recurrence interval with a source and uncertainty band; speculative/hypothetical cases are labelled as non-statistical; values cite a reference and never imply prediction.
  Complexity: S

### P2

- [ ] P2 — Offer multiple selectable casualty models with visible disagreement
  Why: casualties are produced by one blended blast/thermal/radiation model presented as a single number; NUKEMAP's own critique is that any single mortality proxy is wrong, and letting users switch models and watch the number change is the teaching moment.
  Evidence: single model in `direct_hazard.rs` `nuclear_casualties`; NUKEMAP roadmap multiple casualty models (https://blog.nuclearsecrecy.com/2026/02/10/nukemap-roadmap/).
  Touches: pluggable casualty model enum in Rust, model metadata/citations, results model picker, uncertainty presentation, tests.
  Acceptance: users can select among at least two cited casualty models (e.g. blast-proxy vs combined-effects) and see deaths/injuries update with the model named; a spread/range across models is shown; each model links its source and assumptions.
  Complexity: M

- [ ] P2 — Add a time-varying WSEG-10 fallout dose-rate model behind the shelter advisor
  Why: fallout is a static footprint with no time dimension, so the dynamic dose-rate-over-hours decay and cumulative-exposure-vs-shelter-time curve — the actionable civil-defense lesson — cannot be shown; this is the physics layer the UNI-06 shelter-advisor port needs and does not itself provide.
  Evidence: static fallout in `src/hazards/nuclear/fallout.ts` and `App.tsx` fallout rings; the UNI-06 backlog item ports only the static `shelter.js` factor + latent-cancer readout; NUKEMAP WSEG-10 dynamic dose-rate modelling (https://blog.nuclearsecrecy.com/2026/02/10/nukemap-roadmap/). Extends UNI-06, does not replace it.
  Touches: Rust WSEG-10 dose-rate model, per-point dose-rate/cumulative-exposure query IPC, downwind probe UI, time scrubber coupling, science note, tests.
  Acceptance: selecting a downwind point plots dose rate over time and cumulative exposure vs shelter duration feeding the UNI-06 advisor; the model is cited (WSEG-10) with stated assumptions and uncertainty; results are labelled educational, not operational.
  Complexity: M

- [ ] P2 — Seed earthquake scenarios from live USGS feeds and compare to official products
  Why: the seafloor-earthquake source starts from blank sliders, while real-time authoritative catalogs (and ShakeMap/PAGER) let users reproduce actual events and benchmark the app's estimates against official ones — strong education and validation with no new physics.
  Evidence: manual-only quake entry in `HazardControls.tsx`/`ScenarioBuilder.tsx`; USGS GeoJSON/FDSN feeds, ShakeMap, PAGER (https://earthquake.usgs.gov/earthquakes/feed/, https://earthquake.usgs.gov/fdsnws/event/1/); desktop client can cache offline.
  Touches: USGS feed client with offline cache + stale badge, "recent real quakes" discovery surface, Okada parameter mapping, optional PAGER/ShakeMap comparison layer, provenance/attribution.
  Acceptance: users can browse recent real quakes, load one as a cited Okada scenario, and optionally overlay official ShakeMap/PAGER for comparison; cached data is browsable offline with a stale timestamp; no event is presented as a live warning.
  Complexity: M

- [ ] P2 — Drape analytical overlays onto real terrain so elevation is respected
  Why: damage rings, runup bars, and inundation discs render on the smooth ellipsoid, so the most common user complaint — "mountains should block this" — is visibly untrue; Cesium 1.135 (already on the app's 1.143 line) ships `Cesium3DTilesTerrainProvider` and imagery-over-3D-Tiles draping.
  Evidence: ellipsoid-clamped overlays in `src/render/cesium/**`; HN "factor in mountains/elevation" (https://news.ycombinator.com/item?id=33870612); Cesium Nov-2025 3D Tiles terrain + draping (https://cesium.com/blog/2025/11/03/cesium-releases-in-november-2025/). Distinct from HR-13 hyper-real terrain: this is a near-term analytical draping win, not full PBR.
  Touches: terrain provider wiring, overlay height-clamping/classification, legend copy on elevation influence, offline/no-terrain fallback, visual baselines.
  Acceptance: with terrain enabled, analytical overlays follow ground elevation and are visibly occluded by high terrain where appropriate; disabling terrain restores the flat baseline; solver fields are unchanged; offline runs fall back cleanly.
  Complexity: M

- [ ] P2 — Add a long-term / extinction-scale secondary-effects timeline
  Why: users explicitly want beyond-the-fireball consequences for large events (ejecta reentry heating, global firestorm, impact winter / photosynthesis shutdown, seismic shaking), and the app's Chicxulub-class presets currently stop at the immediate blast/tsunami.
  Evidence: no post-event long-term effects in results; HN extinction-scale/secondary-effects requests (https://news.ycombinator.com/item?id=33870612); Range et al. 2022 global-tsunami/energy context already cited in presets; Purdue Impact:Earth! ejecta/seismic outputs (https://www.purdue.edu/impactearth/).
  Touches: cited large-event effect models (ejecta thickness, seismic magnitude, thermal-pulse global effects), a "days/months/years after" timeline mode coupled to the scrubber, confidence/limits copy.
  Acceptance: large impacts expose cited secondary effects (ejecta blanket thickness, equivalent seismic magnitude, thermal reentry, climate-disruption narrative) staged on a long-term timeline; each effect cites a source and states uncertainty; small events omit effects that do not apply.
  Complexity: L

## Audit-Driven Additions (2026-07-12)

- [ ] P1 — Make the surface-displacement legend match the active colormap
  Why: the SWE overlay is rendered by the Rust solver in the user-selected colormap (diverging / cividis / viridis via `settings.getColormap()` in `SwePlayback.tsx`), but the viewport legend ramp is a fixed rainbow gradient that matches none of them, so a colorblind user who picks the CVD-safe cividis/viridis gets a legend that misrepresents the data. Needs a design decision (magnitude vs signed legend, since diverging is signed while the scale reads 0–10+) and visual verification against the live overlay in each colormap.
  Where: `src/styles/_globe.css` (`.app__viewport-legend-ramp`), `src/App.tsx` (legend block ~L1490, wire active colormap), colormap definitions in `src-tauri/src/physics/solver/mod.rs` (`diverging_colormap`/`cividis_colormap`/`viridis_colormap`).

- [ ] P2 — Latte (light) theme contrast QA pass with a live checker
  Why: several tokens need on-screen WCAG AA verification in the light theme that can't be done headless — `--divider` (#b8c3cf) may be too subtle on `--mantle` (#e6e9ef) so panel separations blur, the `.status-dot` colors want checking on light surfaces, and placeholder text at 0.78 opacity on `--subtext` is borderline.
  Where: `src/styles/_globals.css` (Latte block), `src/styles/_layout.css` (`.status-dot`, `input::placeholder`).

## Research-Driven Additions

### P0

### P1

- [ ] P1 — Keep GPU max-field accumulation resident and batch solver readback
  Why: every accepted GPU step currently reuploads host eta/u/v, dispatches one step, then submits, polls, maps, and copies three full fields so CPU max-field code can observe it, serializing the accelerated path.
  Evidence: `src-tauri/src/commands.rs` (`stream_simulation_dispatch`, `run_simulation_gpu`); `src-tauri/src/physics/solver/gpu.rs` (`step_with_diagnostics`); `physics/solver/max_field.rs`.
  Touches: WGSL buffers/kernel, `GpuTimeStepper`, GPU dispatcher, max-field encoding, cancellation/diagnostics, solver benchmark.
  Acceptance: peak, time-of-maximum, arrival, and eta² accumulation update on every accepted GPU step without host readback; eta/u/v read back only at display, cancellation, or completion boundaries; CPU/GPU products stay within declared tolerance and a fixed 4M-cell benchmark records material speedup without extra VRAM beyond budget.
  Complexity: L

- [ ] P1 — Add Windows forced-colors support and regression coverage
  Why: the UI relies on gradients, shadows, status dots, and color ramps but has no `forced-colors` handling, so Windows High Contrast can erase boundaries and state distinctions.
  Evidence: `src/styles/**`; `tests/accessibility.spec.ts`; CSS Color Adjustment https://www.w3.org/TR/css-color-adjust-1/.
  Touches: semantic styles/tokens, legends/status shapes, focus indicators, Playwright accessibility fixtures.
  Acceptance: `forced-colors: active` uses system colors and visible borders/focus; status and legend meaning also has text/pattern/shape; command bar, library, inspector, transport, dialogs, and errors pass a Playwright forced-colors fixture without globally disabling adjustment.
  Complexity: S

- [ ] P1 — Provide an accessible dynamic equivalent for the analytical globe
  Why: Cesium internals are excluded from axe scans and the application-owned viewport has no concise text alternative for the meaningful active scene.
  Evidence: `src/components/Globe.tsx`; `tests/accessibility.spec.ts`; WCAG 2.2 non-text content https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.
  Touches: viewport shell, scene/layer/camera summary model, live-region cadence, coordinate-entry alternatives, screen-reader tests.
  Acceptance: the viewport has an accessible name and adjacent summary of scenario, region/scale, modeled time, visible analytical layers, selected probe, and renderer fallback/failure; updates are coalesced rather than announced per frame; pick and inspect remain operable through coordinates.
  Complexity: M

- [ ] P1 — Import local NetCDF-CF and GeoTIFF bathymetry through a strict preflight
  Why: users cannot escape the coarse basin approximation without the blocked bundled-GEBCO channel, while mature tsunami tools accept local scientific rasters and community evidence identifies preprocessing as a primary barrier.
  Evidence: `data/bathymetry/README.md`; `src-tauri/src/data/bathymetry.rs`; GeoClaw topology work https://github.com/clawpack/geoclaw/issues/705; CF 1.13 https://cfconventions.org/Data/cf-conventions/cf-conventions-1.13/cf-conventions.html.
  Touches: bounded raster readers, geodesy/surface contracts, crop/resample preview, cache/manifest, Settings/scenario data picker, diagnostics.
  Acceptance: a user can preview and import a documented NetCDF-CF/GeoTIFF subset; unknown CRS/datum/axis/units fail closed; resolution, nodata, vertical convention, checksum, rights, crop and resampling are shown before commit; imported data is cached atomically and can be removed/rolled back offline.
  Complexity: L

- [ ] P1 — Extend Inspect into an explainable all-hazard point probe
  Why: tsunami inspect reports wave/runup at a click, but asteroid/nuclear users only see concentric regions rather than the effect, arrival, threshold, formula, and uncertainty at a chosen place.
  Evidence: `src-tauri/src/commands.rs` (`inspect_at_point` is tsunami-only); `src-tauri/src/physics/direct_hazard.rs`; NUKEMAP FAQ https://db.nuclearsecrecy.com/nukemap/faq/.
  Touches: Rust direct-hazard probe query, globe inspect mode, Results panel, comparison and text/CSV export.
  Acceptance: one probe works across tsunami, asteroid, and nuclear domains and reports applicable peak/time/dose/threshold values, governing model/citation, assumptions, confidence, and safe unknown states; moving the probe never reruns the full simulation; Compare shows both scenarios at the same coordinate.
  Complexity: M

- [ ] P1 — Checkpoint authoritative solver state and recover interrupted runs
  Why: crash reports persist but solver fields and progress do not, so an interrupted high-resolution run restarts from zero.
  Evidence: streaming paths in `src-tauri/src/commands.rs`; ErrorBoundary recovery in `src/components/ErrorBoundary.tsx`; ANUGA checkpointing https://anuga.readthedocs.io/en/stable/setup_anuga_script/checkpointing.html.
  Touches: versioned checkpoint codec, solver/run registry, app-data retention, recovery UI, diagnostics, migration/corruption tests.
  Acceptance: configurable wall-clock checkpoints atomically preserve eta/u/v/depth, tick, source/settings/data digests, max fields, gauges, and solver/protocol versions; restart reproduces an uninterrupted golden run; corrupt/incompatible checkpoints are quarantined with diagnostics; completed/stale checkpoints are bounded and removable.
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

### P0

### P1

- [ ] P1 — Make SWE wetting and drying well-balanced and positivity-preserving
  Why: the solver currently detects negative total depth after a step and rolls back, while mature SWE schemes prevent invalid depth and preserve still water over variable topography.
  Evidence: Verified — `src-tauri/src/physics/solver/quality.rs`; GeoClaw https://www.clawpack.org/geoclaw.html; SWEpy https://github.com/joaquinmeza90/SWEpy.
  Touches: CPU/GPU flux and wet/dry kernels, quality metrics, validation fixtures, solver documentation.
  Acceptance: CPU and GPU preserve a constant free surface over strongly varying bathymetry within declared mass/velocity tolerances; advancing and retreating fronts never create negative depth under the documented CFL range; dam-break and NTHMP wet/dry fixtures pass without quality rollback; masks and conserved quantities agree across backends.
  Complexity: L

- [ ] P1 — Add flow-depth, speed, momentum, momentum-flux, and drawdown maximum fields
  Why: peak surface displacement alone omits the inundation intensity products used by mature tsunami workflows and is insufficient for point-level consequence interpretation.
  Evidence: Verified — `src-tauri/src/physics/solver/max_field.rs`; GeoClaw fgmax https://www.clawpack.org/fgmax.html; SWEpy https://github.com/joaquinmeza90/SWEpy.
  Touches: max-field accumulator and existing GPU-resident buffers, result types, Layers/Inspect/Results, scientific exporters.
  Acceptance: every accepted step updates maximum total flow depth, speed, momentum, momentum flux, minimum water depth/drawdown, and applicable time-of-maximum; fields carry units, bathymetry/source provenance, and confidence; machine-readable plus visual exports preserve them; CPU/GPU products agree within declared tolerance without per-step readback.
  Complexity: M

- [ ] P1 — Add a validated radiation/open-boundary mode
  Why: the solver documents mild long-run sponge reflection, and unmeasured reflected energy can contaminate basin-scale arrival and maximum fields.
  Evidence: Verified — `src-tauri/src/physics/solver/mod.rs`; OpenFOAM wave damping https://openfoam.org/release/6/; JAGURS boundary/nesting history https://github.com/jagurs-admin/jagurs/releases.
  Touches: CPU/GPU boundary kernels, solver settings/contracts, run-quality reflection metric, provenance, validation fixtures.
  Acceptance: a selectable radiation/transmissive mode has CPU/GPU parity; planar and radial outgoing-wave fixtures measure reflected-energy ratio below a declared threshold after boundary crossing; sponge remains selectable for compatibility; mode and measured reflection estimate appear in diagnostics and exports.
  Complexity: M

- [ ] P1 — Give paired numeric controls valid semantics and visible validation
  Why: Scenario Builder and direct-hazard rows wrap multiple interactive controls inside one label, and exact direct-hazard entry silently clamps or resets invalid text.
  Evidence: Verified — `src/components/ScenarioBuilder.tsx:133-196`; `src/components/HazardControls.tsx:35-119`; HTML label rules https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/label.
  Touches: shared numeric-field primitive, builder/hazard forms, validation styles/copy, component and axe tests.
  Acceptance: each number input, slider, help button, unit, bound, and error has an explicit programmatic relationship without nested interactive label content; invalid exact input remains editable and shows a specific error instead of silently changing; keyboard and screen-reader tests cover every numeric field in all four source tabs and both direct-hazard modes.
  Complexity: M

- [ ] P1 — Make saved-scenario deletion undoable and storage-safe
  Why: deletion is immediate and has no pending, failure, rollback, or recovery path despite removing user-authored state.
  Evidence: Verified — `src/components/ScenarioBuilder.tsx:532-550`; ParaView autosave/recovery https://docs.paraview.org/en/latest/UsersGuide/savingResults.html.
  Touches: saved-scenario persistence transaction, scenario list, toast/status system, rejection and undo tests.
  Acceptance: delete removes the row optimistically with a bounded Undo action; undo restores the same stable scenario ID/order/content; a persistence rejection restores the row and reports the failure; rapid delete/undo sequences cannot overwrite newer saves.
  Complexity: S

- [ ] P1 — Provide semantic data equivalents for analytical charts and gauges
  Why: named SVGs still hide the attenuation series, DART observations, gauge thresholds, legend meaning, and active values from non-visual users.
  Evidence: Verified — `src/components/AttenuationChart.tsx`, `DartOverlay.tsx`, and runup gauge SVG; WCAG 2.2 https://www.w3.org/TR/WCAG22/.
  Touches: chart/gauge view models, concise summaries and disclosure tables, CSV copy/export, accessibility tests.
  Acceptance: each chart/gauge has a concise summary and keyboard-accessible table containing series names, units, key extrema/thresholds, active selection, confidence, and provenance; updates are coalesced rather than announced per frame; visual SVG output and numeric exports remain unchanged.
  Complexity: M

- [ ] P1 — Expand visual/accessibility regression coverage across states and reflow
  Why: current desktop baselines omit major builder, comparison, layer, coastal-result, export, lesson, recovery, zoom, and narrow-reflow states.
  Evidence: Verified — `tests/accessibility.spec.ts`, `tests/visual-regression.spec.ts`, `tests/reference-visual.spec.ts`; WCAG 2.2 reflow https://www.w3.org/TR/WCAG22/#reflow.
  Touches: deterministic fixtures, Playwright projects, screenshot/axe baselines, release verification.
  Acceptance: both themes cover empty/loading/error/recovery plus custom builder, Compare, Layers, coastal Results, Export, lesson/tour, and direct hazards; 200% zoom and 320-CSS-pixel reflow have no clipped required control or two-dimensional page scroll; forced-colors and semantic-chart checks run in the same deterministic matrix.
  Complexity: M

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

