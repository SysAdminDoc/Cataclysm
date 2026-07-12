# Cataclysm Roadmap

Single source of truth for delivery. Blocked items live in
[`Roadmap_Blocked.md`](./Roadmap_Blocked.md). Shipped work is summarized in
[`CHANGELOG.md`](./CHANGELOG.md).

---

## North Star: Hyper-real planet and hazard rendering (2026-07-11)

Cataclysm must stop reading as a map with effects drawn over it. The visual
target is a physically coherent planet that remains convincing from orbit to a
local impact or shoreline: curved atmosphere, moving cloud layers, sun glint and
depth in the ocean, terrain with real scale, and hazard effects whose geometry,
timing, lighting, and motion come from the simulation.

**Rendering architecture commitment:** Rust remains the only authority for
hazard physics. CesiumJS remains the analytical globe and compatible fallback.
A packaged Unreal Engine cinematic renderer, georeferenced with Cesium for
Unreal, owns the highest-fidelity water, atmosphere, volumetrics, particles,
debris, lighting, camera, and audio. Both renderers consume the same versioned
scenario and frame-state contract; Unreal must not reimplement source, blast,
fallout, wave, or runup formulas.

**v0.7 desktop baseline:** the analytical client now has the professional
simulator workspace that future cinematic rendering plugs into: scenario
library, dominant viewport, Setup / Results / Layers inspector, persistent
transport, grouped exports, categorized settings, and reproducible dark/light
desktop captures. The remaining rows below concern physical scene realism and
renderer architecture rather than another shell redesign.

**Visual truth rules**

- Deep-ocean tsunamis remain broad and visually subtle; dramatic height,
  breaking, foam, and debris emerge only as bathymetry shoals the wave near land.
- Analytical rings, heatmaps, labels, and gauges are optional instruments. The
  cinematic view defaults to the physical scene with overlays hidden.
- Every emitter, material, camera cue, and audio delay is parameterized from SI
  outputs. Artist-authored noise may add small-scale detail but may not change
  radius, arrival time, height, energy, or duration claims.
- Visual scale must remain continuous. Orbit, regional, approach, ground, and
  shoreline shots cannot reveal billboard sprites, flat color discs, hard LOD
  seams, texture swimming, or geometry popping.
- Deterministic reference captures and performance traces are required for each
  milestone. "Looks better" without repeatable before/after evidence is not an
  acceptance result.

### P0 - Shared rendering foundation and measurable quality

### P1 - The planet must look physically present

- [ ] **HR-10 - Physically coherent Earth, atmosphere, lighting, and clouds**
  Why: a convincing hazard begins with a convincing planet. Replace the generic
  globe presentation with physically based solar direction, aerial perspective,
  limb scattering, exposure adaptation, stars, day/night transition, city
  lights, terrain shadows, and multi-altitude cloud layers with real parallax.
  Evidence: CesiumJS atmosphere/post-process APIs; Cesium for Unreal
  `CesiumSunSky`; NASA visible-Earth references.
  Touches: Cesium viewer setup, post-process pipeline, shared simulation clock,
  Unreal planet level, licensed cloud/noise assets.
  Acceptance: fixed captures match reference behavior for blue atmospheric limb,
  sunset reddening, night-side darkness, cloud shadow direction, and solar glint;
  orbit-to-ground exposure changes without white clipping or sudden pumping;
  all lighting follows scenario UTC and coordinates.
  Complexity: L

- [ ] **HR-11 - PBR ocean surface at global and regional scales**
  Why: the current colored imagery overlay has no physical surface response.
  Build a layered ocean with Fresnel reflection, absorption by depth, sun glint,
  multi-band normal waves, wind direction, whitecaps, cloud reflection,
  underwater color, shoreline foam, and scale-aware roughness.
  Evidence: Cesium `Material` water fabric; Unreal Single Layer Water and Water
  System documentation.
  Touches: new shared ocean parameters, Cesium water primitive/material,
  bathymetry/land masks, Unreal ocean material and water mesh.
  Acceptance: ocean reads as water from orbit, aircraft, and near-surface views;
  normals and foam do not swim under camera motion; land never receives ocean
  shading; sun glint and wave direction respond to time and configured wind;
  analytical eta colors can be blended or disabled independently.
  Complexity: L

- [ ] **HR-12 - Solver-driven displaced tsunami surface**
  Why: `eta_png_b64` paints wave height as color but leaves the sea geometrically
  flat. Stream eta and velocity into adaptive GPU water tiles so the same solver
  field deforms the surface and drives normals, flow, foam, spray, and debris.
  Touches: Rust frame protocol, solver snapshot encoding, Cesium custom mesh or
  texture-driven vertex path, Unreal water data interface, temporal interpolation.
  Acceptance: displaced height matches sampled solver eta within renderer
  precision; frames interpolate smoothly without changing arrival time; deep
  ocean remains subtle at honest scale; an explicit educational exaggeration
  slider is off by default and watermarks exports when enabled.
  Complexity: XL

- [ ] **HR-13 - Georeferenced high-detail terrain, coastlines, and cities**
  Why: hyper-real water cannot meet flat or coarse shores. Stream the best
  permitted terrain, imagery, photogrammetry/3D Tiles, buildings, and bathymetry,
  then create a local high-resolution East-North-Up scene around each hero event.
  Touches: globe styles, terrain/3D Tiles providers, cache and provenance,
  Cesium for Unreal georeferenced sublevels, local collision proxy generation.
  Acceptance: camera can descend from orbit to street scale without losing
  geospatial alignment; terrain and buildings agree across renderers; hero
  locations have collision-capable local meshes; offline mode retains a clearly
  labelled lower-detail planet rather than failing blank.
  Complexity: XL

### P1 - Asteroid and comet realism

- [ ] **HR-20 - PBR asteroid bodies and physically staged atmospheric entry**
  Why: replace the canvas fireball billboard and glowing polyline with real
  irregular glTF bodies, scale-correct rotation/tumble, roughness and regolith,
  heated leading surfaces, fragmentation, plasma sheath, ionized wake, smoke,
  and atmospheric light cast onto terrain and clouds.
  Touches: shared asset registry, asteroid render-frame phases, Cesium model and
  particle systems, Unreal materials/Niagara, exposure and shadow systems.
  Acceptance: diameter is geometrically correct; trajectory and attitude follow
  entry angle/velocity; ablation brightness follows atmospheric density and
  energy loss; fragments conserve the parent visual mass budget; no fixed-screen
  billboard remains visible in High or Cinematic tiers.
  Complexity: L

- [ ] **HR-21 - Land impact crater, ejecta, flash, shock, and aftermath**
  Why: an expanding ellipse cannot communicate the violent transfer of energy.
  Render terrain-contact flash, ejecta curtain, ballistic debris, dust wall,
  thermal illumination, pressure condensation, crater excavation/decal or local
  mesh deformation, fires, and a persistent dust plume in physical sequence.
  Touches: asteroid/nuclear shared blast VFX, terrain decals/deformation, debris
  instancing, volumetric materials, event timeline, camera exposure.
  Acceptance: stage timing and dimensions come from Rust outputs; ejecta follows
  gravity and impact angle; flash illuminates surrounding terrain/clouds before
  the pressure front arrives; crater scale matches the result readout; aftermath
  remains visible when the one-shot animation ends.
  Complexity: XL

- [ ] **HR-22 - Ocean impact cavity, crown, vapor, spray, and wave birth**
  Why: replace the translucent cylinder and ellipse rings with a deforming water
  cavity, asymmetric splash crown, central jet, vapor cloud, ballistic droplets,
  aerated foam, fallback, and transition into the authoritative tsunami field.
  Touches: asteroid-water event phases, solver initial field, local water mesh,
  Cesium particles/mesh path, Unreal Niagara liquid/shallow-water coupling.
  Acceptance: cavity diameter/depth, jet height, asymmetry, and collapse timing
  derive from impact outputs; droplets collide with the local water/terrain;
  the near-field disturbance blends continuously into the propagated solver
  surface with no ring appearing from nowhere.
  Complexity: XL

### P1 - Nuclear realism

- [ ] **HR-30 - Physically staged nuclear detonation renderer**
  Why: render the complete time sequence rather than a generic expanding disc:
  sub-frame flash, exposure bloom, fireball growth and cooling, thermal light,
  blast front, dust pickup, condensation cloud where conditions permit, stem,
  cap roll-up, cloud rise, wind shear, and late-time dissipation.
  Touches: nuclear timeline, atmospheric inputs, Cesium post-process/particles,
  Unreal Niagara gas volumes, volumetric materials, shared blast-light system.
  Acceptance: airburst, surface, underground, and water bursts have materially
  different scenes; fireball and cloud dimensions follow yield/burst height;
  flash lights terrain and clouds without permanently clipping exposure; blast
  arrives at the camera after the physically calculated delay; mushroom clouds
  persist and advect instead of vanishing after a short animation.
  Complexity: XL

- [ ] **HR-31 - Fallout, EMP, fires, and nuclear aftermath as physical layers**
  Why: the aftermath must remain a scene, not only a polygon legend. Render a
  wind-advected particulate plume, deposition haze, city fire glow/smoke, damaged
  vegetation/ground tint where data supports it, and an optional non-literal EMP
  visualization that is clearly separated from physical visible light.
  Touches: fallout engine, weather inputs, persistent scene-state protocol,
  volumetric plume/particle renderer, analytical overlay controls.
  Acceptance: plume direction, width, arrival, and persistence match fallout
  outputs; cinematic particles and analytical contours stay aligned; EMP cannot
  be mistaken for a visible atmospheric shell; disabling cinematic effects does
  not remove quantitative fallout inspection.
  Complexity: L

### P1 - Tsunami, inundation, earthquake, and landslide realism

- [ ] **HR-40 - Shoaling, breaking, foam, runup, drawdown, and wetting/drying**
  Why: the defining tsunami image occurs at the coast. Couple the solver to a
  local high-resolution shoreline mesh that steepens waves, creates bores,
  exposes seabed during drawdown, floods terrain, leaves wet surfaces, and drives
  foam/spray from depth, slope, Froude number, and velocity gradients.
  Touches: SWE wet/dry solver work, local bathymetry/topography, water renderer,
  shoreline material, foam/breaking criteria, inundation state persistence.
  Acceptance: deep-water wave transitions continuously through shoaling to
  inundation; wet front never crosses higher terrain without sufficient head;
  drawdown precedes appropriate arrivals; water depth agrees with solver probes;
  foam is generated by physical thresholds rather than a looping texture.
  Complexity: XL

- [ ] **HR-41 - Water interaction with buildings, vegetation, vehicles, and debris**
  Why: a flooded texture cannot feel like real inundation. Use instanced debris,
  buoyancy/drag approximations, collision proxies, impact spray, and depth-based
  material changes to communicate flow through a populated environment.
  Touches: Unreal local scene, Cesium 3D Tiles metadata, debris library,
  depth/velocity sampling API, deterministic spawn seeds and safety limits.
  Acceptance: objects float, ground, or remain anchored by documented classes;
  motion direction and speed sample the solver field; debris cannot outrun the
  wet front; deterministic replays produce the same major paths; density scales
  down gracefully before frame rate collapses.
  Complexity: XL

- [ ] **HR-42 - Earthquake and landslide physical scene effects**
  Why: complete the hazard family with transient terrain displacement, fault
  uplift/subsidence, slope failure, rock fragmentation, dust, water entry, and
  directional landslide waves, while avoiding implausible Hollywood shaking.
  Touches: Okada and landslide fields, local terrain deformation, rock/debris
  assets, dust particles, camera response, source-to-SWE initial field.
  Acceptance: deformation direction and scale match the source grid; landslide
  mass and trajectory preserve the modeled volume/direction; dust and camera
  motion decay from physical event timing; resulting water disturbance joins the
  same solver field used by analytical playback.
  Complexity: L

### P2 - Cinematic renderer, direction, sound, and delivery

- [ ] **HR-50 - Packaged Unreal/Cesium cinematic renderer**
  Why: CesiumJS remains excellent for global analysis but is not the final home
  for street-scale volumetric fire, FLIP-style liquids, debris collisions, or
  cinematic temporal rendering. Add an Unreal client in-tree that consumes the
  shared protocol and uses Cesium for Unreal georeferencing, Water, Niagara
  Fluids, volumetrics, Lumen-compatible lighting, and Movie Render Queue.
  Evidence: https://cesium.com/learn/unreal/unreal-quickstart/;
  https://dev.epicgames.com/documentation/unreal-engine/water-system-in-unreal-engine;
  https://dev.epicgames.com/documentation/unreal-engine/niagara-fluids-in-unreal-engine.
  Touches: new `cinematic/` Unreal project, Rust stream/replay service, local
  packaging scripts, asset licenses/attribution, release size strategy.
  Acceptance: selecting Cinematic View launches directly into the same scenario,
  location, time, and camera target; no manual editor step is required; renderer
  disconnect/restart is recoverable; packaged releases contain a tested Cesium
  fallback for unsupported GPUs.
  Complexity: XL

- [ ] **HR-51 - Physics-aware camera director and seamless scale transitions**
  Why: game-quality scenes need deliberate framing without taking control away
  from the user. Build orbit-to-impact, tracking, flyby, ground-observer,
  shoreline, and free-camera rigs with collision, focal-length/exposure control,
  physically bounded shake, slow motion, replay, and immediate manual override.
  Touches: shared camera-shot schema, Cesium camera system, Unreal camera actors,
  replay timeline, reduced-motion setting.
  Acceptance: every hero scenario has at least three deterministic shot paths;
  the asteroid remains framed through entry and impact; camera shake starts at
  pressure/seismic arrival rather than detonation time; manual input interrupts
  direction immediately; reduced-motion disables shake and aggressive cuts.
  Complexity: L

- [ ] **HR-52 - Distance-, medium-, and atmosphere-aware audio**
  Why: light and sound must not arrive together at long range. Add layered entry
  roar, blast, low-frequency pressure, ejecta, splash, surf, structure/debris,
  underwater, and ambient beds with propagation delay, attenuation, occlusion,
  time dilation, and dynamic-range controls.
  Touches: render-frame events, audio asset registry/licensing, Web Audio fallback,
  Unreal spatial audio, Settings and accessibility.
  Acceptance: delay follows observer distance and medium; no sound propagates
  through vacuum; indoor/terrain occlusion is audible; slow-motion remains pitch
  coherent by mode; mute, captions/event labels, and night dynamic range ship.
  Complexity: L

- [ ] **HR-53 - Cinematic replay, capture, and final hyper-real acceptance gate**
  Why: users must be able to inspect and export the exact event they simulated.
  Record authoritative frame-state once, replay it deterministically at any
  quality tier, and export stills or video without rerunning stochastic effects.
  Touches: replay container and checksums, Cesium recorder, Unreal Movie Render
  Queue automation, export provenance, visual/performance test suite.
  Acceptance: the 12 HR-00 scenes replay identically from checksummed state;
  4K still and video exports contain scenario/time/renderer provenance; no
  analytical overlay leaks into clean cinematic output unless selected; a final
  review finds no billboard asteroid, cylinder splash, flat tsunami texture,
  generic expanding nuke disc, hard LOD seam, or physically mistimed audio.
  Complexity: L

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

- [ ] P1 — Open offline base-Earth pack and deterministic asset build pipeline
  Why: the default Esri imagery plus ellipsoid terrain is network-dependent and
  cannot provide a reproducible planet, while raw source assets are too large and
  inconsistent for direct release packaging.
  Evidence: NOAA ETOPO 2022 provides 15 arc-second global topobathymetric relief;
  NASA Blue Marble NG provides a stable global visual base; MSFS, Outerra, and
  Cesium all use tiled LOD rather than one maximum-detail model.
  Touches: local asset-build scripts, ETOPO terrain/bathymetry tiling, Blue Marble
  imagery tiling, land/water mask, GLB/KTX2/3D Tiles optimization where applicable,
  versioned downloadable packs, checksum/resume/rollback UI.
  Acceptance: a clean offline install renders a complete orbit-to-regional Earth
  from approved local assets; builds are byte-reproducible from pinned inputs;
  missing/corrupt packs fall back visibly rather than showing a blank globe;
  installer and on-disk budgets are measured and documented.
  Complexity: XL

- [ ] P1 — Versioned environmental state and temporal Earth-observation service
  Why: scenario UTC must drive the terminator, ocean, clouds, ice, and hazards
  coherently. Adding individual live layers without a shared state would create a
  visually plausible but temporally contradictory planet.
  Evidence: NASA GIBS exposes date-indexed WMTS browse layers; OpenSpace separates
  temporal globe layers; GIBS warns browse imagery is not a science-analysis input.
  Touches: render-frame/environment schema (UTC, wind, pressure, humidity,
  visibility, clouds, precipitation, sea state, tide, current, ice, provenance),
  GIBS client/cache, renderer clock, offline climatology and manual overrides.
  Acceptance: one scenario date deterministically controls sun, night emissions,
  selected visual observations, cloud/ocean inputs, and exports; each value states
  source time/resolution/interpolation; missing data uses a labelled fallback;
  browse imagery cannot enter numerical forcing code.
  Complexity: L

- [ ] P1 — Ambient ocean-state adapter with strict tsunami separation
  Why: HR-11 defines the water material and HR-12 defines solver displacement,
  but neither defines how real wind sea, multidirectional swell, tide, currents,
  and ice enter rendering without contaminating scientific tsunami output.
  Evidence: NOAA GFS-Wave/WAVEWATCH III and Copernicus Marine expose wave height,
  period/direction and ocean-state products; Tessendorf spectral synthesis and
  Unreal Gerstner waves provide complementary quality tiers.
  Touches: shared ocean-input schema, NOAA/Copernicus adapters, deterministic
  offline presets, Cesium FFT/Gerstner bands, Unreal Water inputs, provenance UI.
  Acceptance: changing wind, swell, current, or sea-ice state visibly changes the
  ambient surface while eta/u/v probes, arrival times, maximum fields, wet/dry
  cells, and exports remain bit-identical; absent network data replays from the
  recorded environmental state.
  Complexity: L

- [ ] P1 — Datum-correct coastal hero-zone pack builder
  Why: global relief cannot resolve shoreline structures, bathymetric channels,
  run-up, building interaction, or debris. HR-13/40/41 need a repeatable way to
  convert permitted local data into one renderer-neutral high-detail scene.
  Evidence: NOAA tsunami models use nested grids and site-specific DEMs down to
  roughly 1/3 arc-second; Cesium for Unreal uses local georeferenced sublevels.
  Touches: import/bake CLI, local ENU pack schema, terrain+bathymetry fusion,
  coastline distance field, buildings/vegetation, material masks, simplified
  collision proxies, Cesium tiles, Unreal sublevel output.
  Acceptance: one reference coast builds from a pinned manifest into matching
  Cesium and Unreal packs; waterline/terrain alignment meets the datum error
  budget; wet/dry and collision surfaces share stable IDs; a rebuild produces
  identical checksums and attribution.
  Complexity: XL

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

### P2 — visual truth and delivery controls

- [ ] P2 — HDR/color-management and temporal visual-quality gate
  Why: physically based atmosphere, ocean glint, asteroid entry, and nuclear
  flash cannot share a convincing scene without declared luminance/exposure and
  export color rules. Still screenshots also miss shimmer, LOD popping, texture
  swimming, foam drift, ghosting, and frame-interpolation failures.
  Evidence: Unreal atmosphere/cloud guidance treats sky, sun, clouds, reflections,
  and exposure as one environment; Cataclysm's visual tests currently mask or hide
  the Cesium canvas.
  Touches: scene-linear/HDR pipeline, tone mapping and bloom limits, SDR/HDR export
  metadata, photosensitivity-safe flash preset, deterministic video captures,
  temporal metrics and full-canvas visual tests.
  Acceptance: fixed luminance/exposure fixtures cover day, night, entry, impact,
  and nuclear flash; safe mode limits rapid luminance change without changing
  physics; automated sequences detect tile popping, shimmer, swimming, field
  discontinuity, and resource growth; exported media declares its color space.
  Complexity: L

## Research-Driven Additions

### P0

- [ ] P0 - UX-05: Replace generic source metrics with source-aware outcome storytelling
  Why: Results leads with internal quantities and currently labels a Tohoku earthquake metric as Cavity radius, while users primarily want to know what happened, where, when, how severe it was, and how certain the model is.
  Evidence: live Tohoku Results audit; generic metric rendering in `src/components/ResultsPanel.tsx`; NUKEMAP translates effect zones into plain-language consequences (https://db.nuclearsecrecy.com/nukemap/faq/); ArcGIS guided tours pair map stops with explanatory media (https://storymaps.arcgis.com/stories/22da4d581d7942a091dabd9e6b52619c).
  Touches: source-aware result view models, `ResultsPanel.tsx`, attenuation/runup/DART panels, direct-hazard results, glossary, confidence copy, export summaries, result fixtures.
  Acceptance: Results opens on What happened? with maximum effect, first/nearest affected place, arrival time, geographic reach, and confidence/limitations; Science and Validation tabs retain expert metrics and observations; labels vary correctly by earthquake, landslide, asteroid, and nuclear source; no earthquake shows cavity terminology; selecting an outcome focuses the relevant place/time on the globe; consequence estimates use honest ranges and assumptions.
  Complexity: M

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

- [ ] P1 - UX-10: Make onboarding, disabled actions, and exports explain the next step
  Why: Show first-run again actually schedules the notice for the next launch, and the empty Export menu exposes eight disabled formats without explaining what unlocks them.
  Evidence: live Settings/Data & onboarding and empty Export audits; `Settings.tsx`, `App.tsx` export popover, `FirstRunDisclaimer.tsx`; premium desktop tools pair unavailable actions with prerequisites and immediate recovery.
  Touches: onboarding actions/state, export capability descriptors, disabled-state tooltips/helper rows, empty-state CTA routing, microcopy and Playwright accessibility tests.
  Acceptance: Replay first-run opens immediately while Show on next launch is labeled truthfully; every unavailable export states whether it needs a source, solver frames, dynamic attribution, or desktop capability and offers the relevant action; export formats are grouped as Image, Replay, Share, and Data with descriptions; no toolbar opens into a wall of unexplained disabled buttons.
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

- [ ] P1 — Add precise direct-hazard inputs and honest uncertainty
  Why: critical asteroid/nuclear parameters are range-only, preventing exact simulator entry, while casualty outputs render exact integers from an explicitly educational approximation.
  Evidence: `src/components/HazardControls.tsx`; OpenQuake consequence workflows require explicit exposure, vulnerability, and consequence models.
  Touches: hazard controls, validators, direct-hazard result types, uncertainty/limitation copy, accessibility and physics-boundary tests.
  Acceptance: every continuous parameter has synchronized numeric entry with units, bounds, step, and validation; sliders remain optional coarse controls; educational consequence outputs use justified ranges/precision and expose assumptions rather than false exactness.
  Complexity: M

- [ ] P1 — Establish an authoritative product-truth and planning-ledger gate
  Why: tracked docs, onboarding, screenshots, and blocked work still contain legacy product names, versions, frame counts, runtime floors, provider defaults, release URLs, and already-shipped blockers.
  Evidence: `CONTRIBUTING.md`, `SECURITY.md`, `docs/manual/**`, `docs/science/**`, `Tour.tsx`, screenshot assets, `Roadmap_Blocked.md`; current `scripts/verify.mjs` docs checks cover only a small subset of drift.
  Touches: authoritative product constants/manifest, affected docs/onboarding/screenshots, `scripts/verify.mjs`, `ROADMAP.md`, `Roadmap_Blocked.md`.
  Acceptance: legacy/current product facts are reconciled; shipped and duplicate blocked entries are removed; docs and onboarding derive or validate name/version/runtime/frame/provider facts; verification fails on stale product names, release links, version strings, provider defaults, or completed blockers.
  Complexity: M

- [ ] P1 — Persist redacted crash evidence and add deterministic recovery
  Why: diagnostics are memory-only and vanish on reload; `Try again` commonly rethrows the same render fault and there is no reset-visual-settings or save/copy support action.
  Evidence: `src/lib/diagnosticsLog.ts`, `src/components/ErrorBoundary.tsx`, `src/main.tsx`; ANUGA and OpenQuake treat logs and failed-job evidence as first-class outputs.
  Touches: bounded crash store, redaction, backend/frontend panic hooks, diagnostics bundle, ErrorBoundary recovery actions, crash fixtures.
  Acceptance: the last bounded crash report survives restart without tokens/paths/private scenario content; fatal UI offers copy/save diagnostics, reset visual settings, retry, and reload; recovery actions are independently tested; successful restart marks but does not silently erase the report.
  Complexity: M

### P2

- [ ] P2 — Reduce Tauri frontend authority to used commands and store operations
  Why: the capability grants store enumeration, clear, and reload operations the app does not use, while Tauri registered application commands are otherwise callable by the webview unless explicitly constrained.
  Evidence: `src-tauri/capabilities/default.json`; `src/lib/settings.ts`; Tauri capabilities guidance: https://v2.tauri.app/security/capabilities/.
  Touches: capability/permission files, `build.rs` application command manifest, IPC negative tests, security documentation.
  Acceptance: only load/get/set/save/delete store operations and enumerated Cataclysm commands are available to `main`; unused calls are denied in tests; remote origins retain no IPC authority; normal simulator workflows pass.
  Complexity: M

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

- [ ] P1 — Re-validate persisted scenarios on read, not only on write
  Why: `saveScenario` validates via `parseScenarioPayload`, but `readScenarios()` returns stored records with only an `Array.isArray` check, so a tampered/corrupted store or a schema change flows unvalidated data into the UI.
  Evidence: `src/lib/settings.ts` `readScenarios` (~L422-440) vs the validated write path; code-audit 2026-07-12.
  Touches: `src/lib/settings.ts`, scenario read path, migration, unit tests for corrupt/legacy records.
  Acceptance: every scenario returned by `getSavedScenarios()` passes the same schema validation as the write path; malformed records are dropped or quarantined with a diagnostic, never rendered; a corrupt-store fixture is covered by a test.
  Complexity: S

- [ ] P1 — Derive front-end and back-end input bounds from one shared table
  Why: `SCENARIO_BOUNDS` clamps earthquake `mw` to [5,10] and `rake` to [-180,180], while Rust `earthquake_initial_conditions` accepts `mw` [4.0,10.5] and does not range-check `rake` at all, so URL/JSON-imported scenarios accept/reject inconsistently across the two entry paths.
  Evidence: `src/lib/scenario-schema.ts` (~L76,L80) vs `src-tauri/src/commands.rs` `earthquake_initial_conditions` (~L261-273); code-audit 2026-07-12.
  Touches: shared bounds constant (generated or asserted-equal in a test), `scenario-schema.ts`, `commands.rs`, cross-boundary parity test.
  Acceptance: one authoritative bounds table drives both layers or a test fails when they diverge; identical inputs are accepted/rejected identically through the builder, URL, and IPC paths; `rake` is range-checked in Rust.
  Complexity: S

- [ ] P1 — Replace the flat casualty population scalar with a real offline density source
  Why: `nuclear_casualties` and the direct-hazard readouts multiply ring areas by a single uniform user-entered `population_density`, so casualties ignore where the event actually is and read as false precision; NUKEMAP moved to urban land-use density weighting for exactly this reason.
  Evidence: `src-tauri/src/physics/direct_hazard.rs` `nuclear_casualties` (~L990-1039) uses one `density` scalar; NUKEMAP roadmap urban-density weighting (https://blog.nuclearsecrecy.com/2026/02/10/nukemap-roadmap/); GHS-POP/GHS-SMOD open, redistributable grids (https://human-settlement.emergency.copernicus.eu/ghs_pop2023.php).
  Touches: bundled compact GHS-POP-derived density raster + provenance in `src/data/earth-assets.json`, Rust density sampler in `data::`, casualty functions, target-picking flow, Earth-asset validation.
  Acceptance: casualty estimates sample a georeferenced density grid at the target with cited provenance and declared resolution/error; a manual override remains available; outputs are stated as ranges, not exact integers; the grid ships offline and passes `validate:earth-assets`.
  Complexity: L

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

- [ ] P2 — Add a 0.25 psi light-damage ring and extend nuclear-effects validity range
  Why: nuclear/blast rings currently floor at 1 psi (6.9 kPa window / 20 psi total), omitting the large 0.25 psi window-breakage / light-injury zone that dominates the affected-population count and is standard in modern effects tools.
  Evidence: blast thresholds in `direct_hazard.rs` (~L546-587) stop at 1 psi; NUKEMAP AWEL.js extends to 0.25 psi citing Capabilities of Nuclear Weapons 1960/1972 (https://blog.nuclearsecrecy.com/2026/02/10/nukemap-roadmap/).
  Touches: `physics::nuclear`/`direct_hazard` overpressure thresholds, ring metadata/legend copy, casualty zones, science derivation note, tests.
  Acceptance: a cited 0.25 psi ring renders with legend and plain-language effect; the extended-validity source is documented in `docs/science/`; existing ring values are unchanged; casualty zones account for the added band.
  Complexity: S

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

- [ ] P2 — Publish build provenance, SBOM, and reproducibility instead of code signing
  Why: installers ship unsigned (by policy), and the credible substitute for a certificate is verifiable provenance — a signed SLSA/in-toto attestation, a dependency SBOM, and a reproducible-build recipe a third party can check against the published hash.
  Evidence: unsigned-installer state in README/`docs/release/CODESIGNING.md`; SLSA provenance (https://slsa.dev/spec/v1.0/distributing-provenance); Sigstore/cosign keyless attestation; run locally, not via CI, per repo no-Actions rule.
  Touches: local `cosign`/`slsa-verifier` provenance generation, CycloneDX/SPDX SBOM (`cargo cyclonedx` + npm), release-checklist docs, checksum+attestation release assets.
  Acceptance: each release attaches a checksummed installer, an in-toto/SLSA provenance attestation, and an SBOM; docs show how to verify provenance and reproduce the build; no code-signing certificate is introduced.
  Complexity: M

### P3

- [ ] P3 — Make the non-streaming `simulate_grid` command cancellable or drop its dead run id
  Why: `api.simulateGrid` generates a `run_id` inline and discards it, so the registered cancel token can never be invoked for that path — dead code that implies a capability the caller cannot use.
  Evidence: `src/lib/tauri.ts` (~L275) discards the id; `src-tauri/src/commands.rs` `simulate_grid` (~L1010-1018); code-audit 2026-07-12.
  Touches: `tauri.ts` signature, `simulate_grid` registration, callers, test.
  Acceptance: either the non-streaming path returns its run id and honors `cancel_simulation`, or the unused registration is removed; behavior is covered by a test.
  Complexity: S

- [ ] P3 — Publish a winget manifest for the Windows installer
  Why: winget is the lowest-friction install/update path on Windows 11 and requires only a hand-authored manifest pointing at the unsigned GitHub Release asset plus its SHA-256 — no certificate.
  Evidence: Tauri distribute guidance notes winget manifests are author-provided (https://v2.tauri.app/distribute/); current install is manual download only (README).
  Touches: winget manifest YAML, release checklist, submission to `microsoft/winget-pkgs`.
  Acceptance: a versioned winget manifest referencing the release asset and hash is published; `winget install` fetches and installs the current version; the manifest is updated on release as part of the checklist.
  Complexity: S

- [ ] P3 — Prototype an ML surrogate for instant inundation preview with solver refine
  Why: full solver runs are not real-time on arbitrary hardware, so an emulator trained on the app's own runs could paint an instant approximate inundation/wave preview on drag while the authoritative Rust solver refines in the background — the interactivity/fidelity resolution proven in 2025 tsunami-ML and Celeris work.
  Evidence: interactive-latency ceiling in `solver/**`; NHESS 2025 ML tsunami surrogates (https://nhess.copernicus.org/articles/25/1655/2025/); Celeris-WebGPU interactive Boussinesq (https://github.com/plynett/plynett.github.io). Likely / needs live validation before committing.
  Touches: offline training pipeline over solver outputs, small ONNX model shipped and run in Rust, preview-then-refine UX, provenance labelling of approximate previews, parity/error bounds vs solver.
  Acceptance: dragging a source shows an instant clearly-labelled approximate preview that the full solver replaces on completion; the surrogate's error vs the solver is measured and bounded; the surrogate is never presented as the authoritative result; the approach is validated on a benchmark before wider rollout.
  Complexity: XL
