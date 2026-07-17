# Cataclysm — Blocked Roadmap Items

Items moved here from ROADMAP.md because they depend on external
resources, secrets, or decisions that only the maintainer can provide.
Return them to ROADMAP.md once the blocker is resolved.

---

## Science / validation

- **P3** — Cross-validate impact scaling against the Svetsov et al. 2025 numerical data tables.
  *The impact crater/overpressure/wind scaling is already validated against Collins–Melosh–Marcus 2005 (its implemented basis) with a Meteor Crater anchor — see `physics::validation::impact_*` and `docs/science/VALIDATION.md`. A per-size numerical cross-check specifically against Svetsov et al. 2025 (MAPS, doi:10.1111/maps.14329) needs that paper's crater/overpressure/wind data tables.*
  **Blocker:** Requires access to the paywalled MAPS paper's supplementary numerical tables (or an open dataset reproducing them). Return to ROADMAP.md once the tables are available; then assert app outputs land within a documented tolerance of Svetsov's values and reconcile any coefficient differences with a cited note.

---

## Phase 3 — Trust / release / supply chain

- **F-V04 P0** — Code signing (Win Authenticode + macOS notarisation).
  *Workflow scaffolded conditional on `WIN_SIGN_CERT_BASE64` / `APPLE_*` secrets being present (no-op when missing); `docs/release/CODESIGNING.md` documents the 8 secret slots.*
  **Blocker:** Needs maintainer EV cert + Apple Developer enrollment.

- **P1** — Adopt Azure Artifact Signing for Windows code signing.
  **Blocker:** Needs maintainer-controlled paid Azure subscription, Artifact Signing account, completed identity validation, active certificate profile, signing role assignment, and account endpoint/profile metadata before local `signtool` signing can succeed. Return to ROADMAP.md once those Azure resources exist.

- **P1** — Publish winget manifest for Windows Package Manager distribution.
  **Blocker:** Acceptance depends on external `microsoft/winget-pkgs` submission, validation, and merge before `winget search TsunamiSimulator` can find the package. Return to ROADMAP.md once a release URL and maintainer publication path are ready.

- **F-V07 P1** — `tauri-plugin-updater` Ed25519-signed channel.
  *Release workflow now emits `latest.json` updater manifest conditional on `TAURI_SIGNING_PRIVATE_KEY` being present.*
  **Blocker:** Needs maintainer to run `npx tauri signer generate`, paste private key as GH secret, paste public key into `tauri.conf.json`, and register the plugin in `src-tauri/src/lib.rs` (steps documented in `docs/release/CODESIGNING.md`).

## Phase 3 — Science-frontier

- **HR-03U P1** — Mirror renderer quality budgets into Unreal scalability
  profiles.
  **Blocker:** The repository has no Unreal project or packaged Unreal runtime;
  this becomes actionable only after HR-50 creates `cinematic/`. The shipped
  Cesium runtime already owns Low/Medium/High/Cinematic budgets, automatic
  degradation/recovery, GPU-reset UX, diagnostics, and the reference-hardware
  performance gate.

- **F-V06 P1** — GEBCO_2026/TID-backed bathymetry via first-run download wizard.
  **Blocker:** Needs decision on distribution channel (GitHub Release vs Cloudflare R2) and a built GEBCO_2026 regional-tile artifact.

## Phase 4

- **F4-04 P1** — Real flood polygons (marching-squares on `h + η > 0`) as GeoJSON overlays.
  **Blocker:** Depends on F-V06 GEBCO. First-order inundation discs (I-V02) shipped in v0.3.0.

## Phase 5 — Boussinesq + AMR (v0.5.0)

**DoD**: Chicxulub simulation matches Range et al. 2022 AGU Advances wave heights to within 25% at the named coastal sample points.

- Boussinesq dispersive terms — critical for impact-tsunami short wavelengths where `ω √(h/g) > 0.3`.
  **Blocker:** Research-grade implementation; requires significant solver architecture work.

- Adaptive mesh refinement (AMR) — coarse far-field, fine coastal patches.
  **Blocker:** Research-grade implementation; requires solver restructuring.

- Validation harness comparing to published peer-reviewed simulations (extends F-V01).
  **Blocker:** Depends on Boussinesq solver.

## Phase 6 — Release

- Signed Windows installer + macOS .dmg + Linux AppImage via GitHub Actions (replaces F-V04).
  **Blocker:** Depends on F-V04 code signing activation.

## Research-Driven — P1 Reliability

- **P1** — GEBCO_2026/TID progressive bathymetry loader (XL).
  **Blocker:** Same as F-V06; needs distribution channel decision + artifact.

## Future / Stretch

- **Population casualty overlay** (opt-in, heavy disclaimer).
  **Blocker:** Requires population density data source decision (GPW, WorldPop), ethical review for displaying estimated casualties, and appropriate disclaimers.

- **Multi-event scenarios** — Chicxulub debris re-entry secondary impacts, Tōhoku aftershock tsunamis.
  **Blocker:** Significant solver architecture work — multiple concurrent sources, superposition of wave fields, sequential event timing.

## Research-Driven — External data licensing

- **P3 — SWOT satellite swath overlay for the Kamchatka 2025 preset.**
    Why: June 2026 SWOT coverage is the first detailed satellite imaging of a tsunami in motion — an observed-vs-simulated visual no competitor has; depends on the Kamchatka preset and a PO.DAAC licensing check (see RESEARCH.md Open Questions).
    Evidence: https://www.sciencedaily.com/releases/2026/06/260623011002.htm; HN https://news.ycombinator.com/item?id=46133555.
    Touches: src/data/ (processed swath GeoJSON), Globe.tsx (toggleable overlay on the Kamchatka preset), docs/science/.
    Acceptance: Kamchatka preset offers a "SWOT observed" overlay with timestamp and attribution; simulated wavefront at the same epoch renders alongside.
    Complexity: M
  **Blocker:** NASA PO.DAAC redistribution/attribution terms for the June 2026
  SWOT Kamchatka swath product need a live check before any processed subset
  can be bundled with the app (flagged in RESEARCH.md Open Questions,
  2026-07-09). Return once the licensing question is answered and a processed
  GeoJSON swath exists.

---

## Moved from ROADMAP.md (2026-07-12 triage — keep ROADMAP actionable-only)

### Hyper-real rendering North Star (HR-10 .. HR-53)
**Blocker:** The whole cinematic program is built on a packaged Unreal Engine
renderer (`cinematic/`) that does not exist yet, plus licensed cloud/ocean/asset/
audio packs, GPU water-tile pipelines, and local high-detail terrain/photogrammetry.
None are producible in an autonomous coding pass; the CesiumJS analytical globe is
the shipped fallback. Return individual rows to ROADMAP.md as independently-landable
Cesium-only slices once HR-50 stands up the Unreal client.

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

### UNI-13 — Immersive mode, mushroom-cloud 3D, sound, night mode
**Blocker:** Depends on the blocked Unreal cinematic renderer and licensed 3D/audio
assets. Ship after HR-50/HR-52.

### Living-Earth data stack — offline base-Earth pack, temporal EO service, ocean-state adapter, coastal hero-zone packs, HDR gate
**Blocker:** These need large external datasets (ETOPO 2022, Blue Marble NG, NASA
GIBS, NOAA GFS-Wave/Copernicus Marine) that must be acquired, licensed, tiled, and a
distribution channel chosen, plus (coastal packs, HDR gate) the blocked Unreal scene.
The Antimeridian/polar tiled-field-transport item stayed in ROADMAP.md because it is
pure Cesium+Rust with no external dependency.

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

### Location-aware casualties via a real population-density grid
**Blocker:** Requires acquiring a GHS-POP/GHS-SMOD-derived global density raster and a
bundling-size / distribution-channel decision (same class as the blocked GEBCO pack;
flagged as an Open Question in RESEARCH.md). Return once the packaged density asset and
its resolution/size budget are decided.

- [ ] P1 — Replace the flat casualty population scalar with a real offline density source
  Why: `nuclear_casualties` and the direct-hazard readouts multiply ring areas by a single uniform user-entered `population_density`, so casualties ignore where the event actually is and read as false precision; NUKEMAP moved to urban land-use density weighting for exactly this reason.
  Evidence: `src-tauri/src/physics/direct_hazard.rs` `nuclear_casualties` (~L990-1039) uses one `density` scalar; NUKEMAP roadmap urban-density weighting (https://blog.nuclearsecrecy.com/2026/02/10/nukemap-roadmap/); GHS-POP/GHS-SMOD open, redistributable grids (https://human-settlement.emergency.copernicus.eu/ghs_pop2023.php).
  Touches: bundled compact GHS-POP-derived density raster + provenance in `src/data/earth-assets.json`, Rust density sampler in `data::`, casualty functions, target-picking flow, Earth-asset validation.
  Acceptance: casualty estimates sample a georeferenced density grid at the target with cited provenance and declared resolution/error; a manual override remains available; outputs are stated as ranges, not exact integers; the grid ships offline and passes `validate:earth-assets`.
  Complexity: L

### ML surrogate for instant inundation preview
**Blocker:** Research-grade: needs an offline training pipeline over solver outputs, a
shipped/validated ONNX model, and measured error bounds before it can be trusted.

- [ ] P3 — Prototype an ML surrogate for instant inundation preview with solver refine
  Why: full solver runs are not real-time on arbitrary hardware, so an emulator trained on the app's own runs could paint an instant approximate inundation/wave preview on drag while the authoritative Rust solver refines in the background — the interactivity/fidelity resolution proven in 2025 tsunami-ML and Celeris work.
  Evidence: interactive-latency ceiling in `solver/**`; NHESS 2025 ML tsunami surrogates (https://nhess.copernicus.org/articles/25/1655/2025/); Celeris-WebGPU interactive Boussinesq (https://github.com/plynett/plynett.github.io). Likely / needs live validation before committing.
  Touches: offline training pipeline over solver outputs, small ONNX model shipped and run in Rust, preview-then-refine UX, provenance labelling of approximate previews, parity/error bounds vs solver.
  Acceptance: dragging a source shows an instant clearly-labelled approximate preview that the full solver replaces on completion; the surrogate's error vs the solver is measured and bounded; the surrogate is never presented as the authoritative result; the approach is validated on a benchmark before wider rollout.
  Complexity: XL

---

## Moved from ROADMAP.md (2026-07-14 triage — large bets / external gates)

- [ ] P3 — Add a cited supervolcano ashfall module
  **Blocker:** research-grade, multi-pass. An Ash3d-style advection-diffusion
  tephra model with an umbrella cloud plus presets that reproduce published
  isopachs (Yellowstone/Taupo) needs a validation dataset and staged physics that
  cannot land in a single pass.
  Evidence: Yellowstone Ash3d supereruption modeling
  https://agupubs.onlinelibrary.wiley.com/doi/full/10.1002/2014GC005469 and
  https://www.usgs.gov/publications/modeling-ash-fall-distribution-a-yellowstone-supereruption.
  Touches: new ashfall source/advection model, wind-field input, isopach overlay,
  presets, science note, uncertainty copy.
  Complexity: L

- [ ] P3 — Publish to winget, Flathub, and a Homebrew cask
  **Blocker:** requires maintainer-owned distribution accounts and processes
  (winget-pkgs PR, Flathub submission/review, a Homebrew tap) plus published
  releases with stable checksums — external accounts and a maintainer decision.
  Evidence: Tauri distribution guide https://v2.tauri.app/distribute/;
  winget via winapp/MSIX https://learn.microsoft.com/en-us/windows/apps/dev-tools/winapp-cli/guides/tauri.
  Touches: winget manifest, Flatpak manifest/AppImage, Homebrew cask formula,
  release docs, per-channel checksums.
  Complexity: M

## Phase 3 — Physics-frontier and web-distribution (from 2026-07-14 incremental scan)

- **P2** — Non-hydrostatic / Boussinesq nearshore run-up mode for phase-resolving wave breaking.
  Why: shallow-water propagation cannot resolve wave breaking and near-shore
  run-up the way phase-resolving Boussinesq schemes do; Celeris-WebGPU proves a
  client-side WebGPU implementation is feasible.
  Evidence: Celeris-WebGPU https://plynett.github.io/ (extended-Boussinesq breaking + run-up); ASCE JWPED5 https://ascelibrary.org/doi/10.1061/JWPED5.WWENG-2370.
  Touches: a new dispersive solver alongside the SWE solver, CPU/GPU kernels, validation suite, contracts, extensive documentation.
  **Blocker:** Research-grade, multi-pass solver rewrite that cannot land in a
  single implementation pass and needs its own validation programme. Return to
  ROADMAP.md as scoped sub-milestones once the SWE convergence/GCI harness exists.
  Complexity: XL

- **P3** — Web/LMS distribution: PhET-style embed + Google Classroom share + offline Chromebook classroom bundle.
  Why: the education-adoption gold standard is an embeddable web build with an
  LMS/Classroom share button and an offline pack; teachers expect it, and it is a
  monetization-free channel into classrooms.
  Evidence: PhET distribution model https://phet.colorado.edu/en/help-center/getting-started; Chromebook simulation bundles https://www.excelschools.net/en/simulations/category/by-device/chromebook.html.
  Touches: a web (non-Tauri) build target, embed/iframe surface, Classroom share, offline service-worker/app-cache bundle, licensing/hosting decision.
  **Blocker:** Depends on the tracked WASM physics port (no web build exists
  today, since physics is Rust-only) and a maintainer decision on a web hosting/
  distribution channel. Return to ROADMAP.md once the WASM port lands and a
  hosting channel is chosen.
  Complexity: XL
