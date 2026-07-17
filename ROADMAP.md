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

### P2 — Impact mode + data
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
- The UNI-08..14 items below remain the parity backlog, now worked entirely
  inside Cataclysm against the preserved `legacy/` reference.

---

## Research-Driven Additions (2026-07-09)

Grounded in `RESEARCH.md` (2026-07-09). Items marked "returns from
Roadmap_Blocked" had "Needs MSVC linker / Rust compilation" blockers that are
stale: the VsDevCmd wrapper works and `npm run verify` runs 67 Rust release
tests locally.

### P1 — solver fidelity (from the 2026-07-09 second research pass)

- [ ] P1 — Extend the NTHMP benchmark suite with solver-applicable analytical slices
  Why: BP1 now ships, while the old blanket blocker predates the working validation
  feature and overstates what can be tested without a dispersive solver. Add the
  non-dispersive analytical portions of BP4/BP6/BP7 and explicitly retain the
  phase-resolving portions as out of reach.
  Evidence: `physics::validation::nthmp_bp1_*`; `docs/science/VALIDATION.md`;
  NOAA/NTHMP benchmark specifications.
  Touches: `src-tauri/src/physics/validation.rs`, validation fixtures,
  `docs/science/VALIDATION.md`.
  Acceptance: every added assertion cites its source and tolerance; unsupported
  dispersive or breaking-wave claims remain explicitly excluded; validation tests pass.
  Complexity: M

### P2 — cited presets, products, and architecture

- [ ] P2 — Modularize commands.rs into submodules
  Why: 1,944 lines and growing with each new IPC; split into types/validators/simulation/source/query keeps the boundary reviewable. Returns from Roadmap_Blocked (stale MSVC blocker).
  Evidence: current `src-tauri/src/commands.rs` line count and command test surface.
  Touches: src-tauri/src/commands/ (new module tree), src-tauri/src/lib.rs.
  Acceptance: no behavior change; all 67+ Rust tests pass; no file exceeds ~600 lines.
  Complexity: M

- [ ] P2 — Split Globe.tsx into composable hooks and controllers
  Why: the MSVC/foreground-verification blocker is stale; headless Playwright,
  deterministic reference scenes, and controller lifecycle tests now provide the
  non-interactive verification surface needed for this refactor.
  Evidence: `src/components/Globe.tsx`; `src/render/cesium/`; reference-capture tests.
  Touches: `src/components/Globe.tsx`, reusable globe hooks/controllers, focused tests.
  Acceptance: behavior and locked reference scenes remain unchanged; lifecycle tests
  cover setup/teardown; no foreground UI is launched.
  Complexity: M

- [ ] P2 — Add desktop deep-link import for shared scenario URLs
  Why: Rust and installer compilation work locally, so the old toolchain blocker no
  longer justifies deferring the OS routing that completes the existing URL codec.
  Evidence: `scenarioFromUrl` / `scenarioToUrlParams`; Tauri 2 deep-link plugin docs.
  Touches: Tauri plugin/capabilities, single-instance routing, scenario import flow,
  installer metadata, headless/integration fixtures.
  Acceptance: a bounded `cataclysm://open?scenario=...` payload reaches the existing
  fail-closed importer on cold and warm launch; malformed/oversized input is rejected;
  platform registration is verified without foreground automation.
  Complexity: M

- [ ] P2 — Export solver products as CF-compliant NetCDF
  Why: the old C-library blocker is an installation concern, not an external blocker;
  the local toolchain may use the maintained `netcdf` crate or a verified pure-Rust
  writer while preserving a portable release build.
  Evidence: existing scientific export preflight; NetCDF-CF conventions.
  Touches: Rust export module/IPC, release toolchain, export UI, interoperability tests.
  Acceptance: coordinates, time, eta/velocity/depth/max fields, CRS/datum, units,
  quality warnings, citations, and provenance round-trip through a pinned reader;
  unsupported or oversized grids fail closed.
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

### P3 — education distribution and larger bets

- [ ] P3 — Remove application-owned inline styles and narrow the CSP exception to Cesium
  Why: Cesium still injects dynamic inline styles, but that does not block eliminating
  Cataclysm-owned inline style attributes or proving that the remaining exception is
  isolated to the embedded Cesium widget surface.
  Evidence: current Tauri `style-src` policy; Cesium dynamic widget styling.
  Touches: React components/stylesheets, CSP verification contract, security docs.
  Acceptance: tracked application components use classes/CSS variables instead of
  inline styles; verification inventories remaining inline styles and rejects any
  non-Cesium regression; Cesium remains functional under the documented exception.
  Complexity: M


- [ ] P3 — Zarr v3 scientific output export via `zarrs` (pure Rust)
  Why: gives researchers a chunked, self-describing raw-field export complementary
  to the now-actionable CF-NetCDF export; zarrs 0.23.x is spec-complete Zarr v3.1.
  Note: raises rust-version to 1.91, so schedule the toolchain change deliberately.
  Evidence: https://crates.io/crates/zarrs and the active CF-NetCDF export item.
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

- [ ] P2 — Latte (light) theme contrast QA pass with a live checker
  Why: several tokens need on-screen WCAG AA verification in the light theme that can't be done headless — `--divider` (#b8c3cf) may be too subtle on `--mantle` (#e6e9ef) so panel separations blur, the `.status-dot` colors want checking on light surfaces, and placeholder text at 0.78 opacity on `--subtext` is borderline.
  Where: `src/styles/_globals.css` (Latte block), `src/styles/_layout.css` (`.status-dot`, `input::placeholder`).

## Audit-Driven Additions (2026-07-14)

- [ ] P2 — Add a wavefront-only IPC so timeline playback doesn't refetch the whole preset each frame
  Why: `useScenarioSlot` re-runs `api.runPreset` on every `timeS` change to update the wavefront ring, so playback/scrubbing round-trips the full preset (initial displacement + 48 wavefront samples) once per tick. The busy-badge flicker is fixed, but the per-tick IPC flood remains; only the time-dependent wavefront actually changes.
  Where: `src/hooks/useScenarioSlot.ts` (effect at ~L81-130), `src-tauri/src/commands.rs` (`run_preset`) — add a lightweight `sample_preset_wavefront(preset_id, time_s, n_samples)` command and call it from a separate time-only effect.


## Research-Driven Additions

### P0

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

### P0

### P1

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

- [ ] P1 — Surface the asteroid airburst overpressure footprint and airburst-vs-crater outcome
  Why: `direct_hazard.rs` already integrates atmospheric entry (`airburst_altitude`, `airburst_energy`, fragmentation energy deposition), but the result presents impact/crater framing; the single most-reinforced misconception in impact sims is that every object craters, when most (Chelyabinsk ~500 kt at ~30 km, Tunguska) airburst with zero crater. A live competitor (Universe Sandbox) is building exactly this for 2026.
  Evidence: `src-tauri/src/physics/direct_hazard.rs:106-107,265-372` (airburst already computed); Universe Sandbox 2026 roadmap https://universesandbox.com/blog/2026/03/universe-sandbox-roadmap-2026/; Chelyabinsk airburst https://www.sciencedirect.com/science/article/pii/S0094576517315229.
  Touches: asteroid result readouts, ground-overpressure ring rendering from an elevated burst (not a surface crater), Results copy, `ResultsPanel.tsx`, direct-hazard fixtures.
  Acceptance: an airbursting asteroid shows an overpressure/thermal footprint centered under the burst altitude with no crater ring and a plain-language "airburst — did not reach the ground" statement; a ground-impacting case still shows the crater; the airburst altitude and deposited energy are displayed and cited; fixtures cover a Chelyabinsk-class airburst and a Chicxulub-class ground impact.
  Complexity: M

- [ ] P1 — Add an overpressure window-glass injury layer (injuries vs. deaths)
  Why: shattered glass is the dominant injury mechanism in both nuclear blasts and asteroid airbursts (Chelyabinsk: ~1,600 injured, zero deaths), yet results conflate a single casualty number; documented breakage thresholds (~200 Pa light / ~500 Pa heavy) turn overpressure into a legible, teachable "injuries far outnumber deaths" distinction no consumer sim models explicitly. Complements, not duplicates, the tracked casualty-model-plurality item.
  Evidence: bolide window-damage study https://onlinelibrary.wiley.com/doi/10.1111/maps.13085; overpressure rings already computed for nuclear/asteroid in `src-tauri/src/physics/direct_hazard.rs`.
  Touches: Rust glass-breakage threshold model keyed to existing overpressure field, a distinct injury overlay/ring, Results injuries-vs-deaths readout, citations, tests.
  Acceptance: nuclear and airburst results show a cited window-breakage radius (light/heavy thresholds) and an injuries estimate presented separately from deaths with stated assumptions and uncertainty; the layer is labelled educational, not operational; a fixture verifies the threshold radii against the cited curve.
  Complexity: M

- [ ] P1 — Add a deterministic frame-accurate video encoder (WebCodecs) alongside MediaRecorder
  Why: `exportGlobeVideo` records the live canvas via `MediaRecorder`, which is real-time and drops frames under load, so it cannot produce the reproducible output the deterministic-replay contract (HR-53 / the tracked highlight-story item) promises; `VideoEncoder` (WebCodecs, available in the Chromium WebView2 runtime) encodes frame-by-frame from rendered timesteps for byte-reproducible, frame-exact MP4.
  Evidence: `src/lib/export.ts:418-449` (`pickVideoMime`/`exportGlobeVideo` MediaRecorder path); WebCodecs guidance https://developer.chrome.com/docs/web-platform/best-practices/webcodecs; existing deterministic capture bridge in `scripts/capture-reference-scenes.mjs`.
  Touches: a WebCodecs `VideoEncoder` export path (feature-detected, MediaRecorder fallback), frame-stepped render loop, File System Access streaming write, export UI labelling (real-time vs. deterministic), tests.
  Acceptance: when `VideoEncoder` is available, a replay exports a deterministic MP4 assembled from stepped frames (identical bytes across two runs of the same scenario); MediaRecorder remains as the real-time fallback and is labelled as approximate; failure preserves the replay and offers retry.
  Complexity: M

### P2

- [ ] P2 — Preserve Cesium and panel state across hazard-module switches with React `<Activity>`
  Why: hazard domains are isolated workspaces that park/rebuild state when switching Tsunami/Impact/Nuclear, forcing expensive Cesium re-initialisation and losing panel state; React 19.2's `<Activity mode="hidden">` keeps a subtree mounted (state preserved, effects unmounted) for exactly this "hidden but instant to restore" case, and `useEffectEvent` reads latest sim params without re-subscribing Cesium listeners.
  Evidence: React 19.2 https://react.dev/blog/2025/10/01/react-19-2 (already on `react ^19.2`); hazard-mode isolation rule in `CLAUDE.md`; mode switch/teardown in `src/App.tsx`.
  Touches: `src/App.tsx` hazard-mode composition, Globe/panel subtrees wrapped in `<Activity>`, event-listener effects migrated to `useEffectEvent`, visual/interaction tests.
  Acceptance: switching hazard modules and back restores the prior globe camera, layers, and panel state without a full Cesium re-mount or visible reflash; the parked module runs no effects while hidden; isolation guarantees (null tsunami props, separate nonces) are preserved.
  Complexity: S

- [ ] P2 — Batch large hazard overlays through Cesium `Buffer*` primitive collections
  Why: inundation polygons, blast/runup rings, and gauge points render per-entity; Cesium 1.140–1.142 shipped experimental `BufferPolygonCollection`/`BufferPolylineCollection`/`BufferPointCollection` (single GPU buffer, per-color alpha, bounding volumes) — the correct substrate for tens of thousands of simulation cells and the lower-level backing beneath the tracked `GeoJsonPrimitive` item.
  Evidence: Cesium June/April 2026 releases https://cesium.com/blog/2026/06/01/cesium-releases-in-june-2026/ and https://cesium.com/blog/2026/04/01/cesium-releases-in-april-2026/ (all ≤ pinned 1.143); overlay rendering in `src/render/cesium/**`, `src/components/Globe.tsx`.
  Touches: overlay adapters for inundation/rings/gauges, `Globe.tsx`, Playwright visual baselines (deliberately updated).
  Acceptance: a 500+-cell hazard overlay renders through one buffer collection with no visual regression and measurably better frame time than the per-entity path; the API is feature-detected with an entity fallback while it remains experimental.
  Complexity: M

- [ ] P2 — Use Cesium async/quadtree picking so inspect stays responsive during playback
  Why: globe pick/inspect is synchronous and competes with heavy solver playback; Cesium (Dec 2025, ≤ pin) added async scene picking and quadtree-accelerated terrain picking that keep interaction non-blocking during animation.
  Evidence: Cesium Dec 2025 release https://cesium.com/blog/2025/12/01/cesium-releases-in-december-2025/; pick/inspect handling in `src/components/Globe.tsx`.
  Touches: `Globe.tsx` pick/inspect path, async picking wiring, interaction tests.
  Acceptance: clicking to inspect during 60-frame playback returns a result without stalling the animation; picking accuracy over terrain is unchanged; the sync path remains as fallback where async is unavailable.
  Complexity: S

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

- [ ] P2 — Harden the npm supply chain in the local release gate
  Why: `verify.mjs` runs `npm audit` but not signature/provenance verification, and the Sept-2025 chalk/debug/ansi-styles compromise hit transitive deps of the Vite/React/Cesium toolchains; adding `npm audit signatures` and lockfile-pin enforcement closes a real ingestion path consistent with the build-locally posture.
  Evidence: `scripts/verify.mjs:454` (`npm audit` only); chalk/debug npm compromise https://semgrep.dev/blog/2025/chalk-debug-and-color-on-npm-compromised-in-new-supply-chain-attack/.
  Touches: `scripts/verify.mjs` (add `npm audit signatures`/provenance check), lockfile-integrity assertion, release docs.
  Acceptance: the gate fails on unsigned/unverifiable provenance for direct+transitive packages where attestations exist and on lockfile drift; the check runs locally with no CI dependency; a documented allowlist covers packages lacking attestations.
  Complexity: S

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

## Research-Driven Additions

## Research-Driven Additions (2026-07-16)

Grounded in `RESEARCH.md` (2026-07-16). Verified against the codebase to avoid
duplicating implemented physics: Ward–Asphaug ocean-impact→tsunami coupling,
`SolverMode::Linear`, and per-key settings migration already exist; the items
below are the net-new, non-duplicate opportunities from this scan.

### P2

- [ ] P2 — First-arrival ETA quick-preview reusing the existing linear SWE mode
  Why: full nonlinear runs are slow, but `SolverMode::Linear` already exists and is unused as a product surface; an instant coarse first-arrival/ETA map before (or instead of) the expensive nonlinear pass is the responsiveness pattern that makes easyWave and Celeris feel alive, at near-zero new physics.
  Evidence: Verified — `SolverMode::Linear` is exercised only in `solver/gpu.rs` parity tests; no `arrival-time`/`eta_map` product exists; isochrones in `solver/max_field.rs` require a full run. easyWave early-warning model https://git.gfz-potsdam.de/id2/geoperil/easyWave; Celeris interactivity https://plynett.github.io/.
  Touches: a new fast-preview IPC command (linear-mode coarse grid → per-cell first-arrival time), `src/components/SwePlayback.tsx`/`Globe.tsx` (an "arrival-time preview" layer + "Quick ETA" action that runs before/without the full solve), `docs/manual/`.
  Acceptance: a Quick ETA action returns a coarse first-arrival map for a preset in a small fraction of the full-run time, rendered as a labelled non-authoritative preview layer clearly distinguished from validated max-field isochrones; the full nonlinear run remains the reproducible/exported product; a Rust test confirms the linear preview's arrival times are monotonic and bracket the nonlinear isochrones for a known case.
  Complexity: M

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
