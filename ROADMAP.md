# Cataclysm Roadmap

Single source of truth for delivery. Blocked items live in
[`Roadmap_Blocked.md`](./Roadmap_Blocked.md). Shipped work is summarized in
[`CHANGELOG.md`](./CHANGELOG.md).

---

## Unification: NukeMap + AsteroidSimulator parity (2026-07-10)

Cataclysm absorbed **AsteroidSimulator** and **NukeMap** (both merged in under
`legacy/`, history preserved). v0.6.0 landed the ported **engines**; these items
rebuild their **UIs** on the Cesium globe. The standalone NukeMap and
AsteroidSimulator repos stay live until this section is drained and Cataclysm
deploys with parity — only then are they retired (code is already safe in-tree).

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
- **UNI-06** Shelter advisor (port `js/shelter.js`, already pure) + latent-cancer
  readout (`estimateLatentCancer`).

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
- **UNI-13** Immersive mode, mushroom-cloud 3D, sound, night mode.
- **UNI-14** Export/PWA parity: extend existing exporters (PNG/CZML/GeoJSON/KML)
  to nuclear/impact results; preserve NukeMap's offline single-file capability
  path where feasible under Vite/Tauri.

### Exit criteria (then retire standalones)
- Nuclear + impact modes reach feature parity with the standalone apps.
- Cataclysm web build deploys (GitHub Pages) and desktop bundle builds.
- Only then: delete `SysAdminDoc/NukeMap` and `SysAdminDoc/AsteroidSimulator`
  (code + history already preserved under `legacy/`), and update the desktop
  Portfolio-Consolidation-Map.

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
