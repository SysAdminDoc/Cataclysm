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

- [ ] **HR-00 - Hyper-real reference suite and capture gate**
  Why: realism needs stable targets rather than subjective iteration. Establish
  canonical orbit, daylight ocean, night Earth, atmospheric entry, land impact,
  ocean impact, airburst, surface burst, deep-ocean propagation, shoaling, and
  urban inundation shots, using NASA/NOAA/USGS imagery and physically based VFX
  references where licensing permits redistribution.
  Touches: `tests/visual/`, `scripts/`, `docs/visual/`, Playwright capture
  plumbing, future Unreal automation commandlet.
  Acceptance: 12 deterministic scenes render from fixed scenario/time/camera
  seeds at 1440p and 4K; each stores frame time, GPU, renderer, quality tier,
  exposure, sun position, and asset provenance; intentional visual changes use
  reviewed baselines rather than blanket snapshot replacement.
  Complexity: M

- [ ] **HR-01 - Renderer-neutral scenario and frame-state protocol**
  Why: the scientific engine must drive both the Cesium and Unreal renderers
  without either frontend inventing physics. The protocol must carry event
  phases, georeferenced transforms, eta/u/v fields, bathymetry, wet/dry state,
  temperatures, pressures, fallout density, crater/ejecta dimensions, and
  authoritative simulation time.
  Touches: `src-tauri/src/` (new versioned render-frame DTOs and binary field
  stream), `src/types/`, `src/lib/tauri.ts`, schema fixtures, export provenance.
  Acceptance: one recorded scenario replays frame-for-frame in two independent
  clients; schema compatibility tests reject unknown breaking versions;
  positions agree within 1 m locally and event timing within one simulation
  tick; the rendering clients contain no duplicated hazard formulas.
  Complexity: L

- [ ] **HR-02 - Break the monolithic globe into lifecycle-safe render systems**
  Why: `Globe.tsx` currently owns viewer setup, imagery, camera, picking,
  analytical overlays, animation RAFs, and hazard entities. Hyper-real materials
  and effects need independently testable systems with deterministic teardown.
  Touches: `src/components/Globe.tsx`, new `src/render/cesium/` modules for
  planet, ocean, camera, asteroid, nuclear, tsunami, overlays, resources, and
  renderer clock.
  Acceptance: `Globe.tsx` becomes orchestration only; every GPU/Cesium resource
  has explicit create/update/destroy ownership; switching modes or replaying 100
  times does not grow entities, primitives, textures, RAFs, or event handlers;
  existing visual and interaction tests pass.
  Complexity: L

- [ ] **HR-03 - Quality tiers, GPU budgets, and graceful degradation**
  Why: volumetrics, water displacement, shadows, particles, terrain, and 4K
  post-processing cannot all run at full quality on every GPU. Quality must
  scale without changing scientific results.
  Touches: Settings, diagnostics bundle, Cesium renderer, Unreal scalability
  profiles, performance capture scripts.
  Acceptance: Low/Medium/High/Cinematic presets document resolution and feature
  budgets; High targets 60 fps at 2560x1440 and Cinematic targets 30 fps at 4K
  on the documented reference GPU; automatic fallback never removes the solver
  field or changes event timing; GPU resets surface a recoverable error.
  Complexity: M

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
