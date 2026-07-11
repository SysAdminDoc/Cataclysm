# Research — Hyper-real living Earth rendering

**Research date:** 2026-07-11

**Decision horizon:** next hyper-real rendering milestones

**Product constraint:** desktop only; scientific results remain authoritative

## Executive summary

There is no practical, licensable, monolithic “real Earth 3D model” that can be
downloaded and dropped into Cataclysm. Google Earth, Microsoft Flight Simulator,
Outerra, Cesium, ArcGIS, OpenSpace, and UNIGINE all converge on the same design:
a precision ellipsoid and coordinate system, streamed multiresolution terrain and
imagery, optional city meshes, and separate atmosphere, cloud, ocean, lighting,
and local-detail systems.

Cataclysm should gather that architecture, not a giant mesh. The recommended
system is:

1. **CesiumJS analytical Earth:** the current Tauri/React client remains the
   inspectable, measurable renderer and gains an open, offline-capable Earth data
   pyramid, physical lighting, temporal Earth layers, and a real ocean surface.
2. **Cesium for Unreal cinematic Earth:** the already-roadmapped cinematic client
   uses the same ECEF/geodetic frame protocol and Rust simulation fields for
   street-level water, volumetric clouds, fire, smoke, debris, and capture.
3. **One renderer-neutral Earth asset contract:** every terrain, imagery, ocean,
   building, and weather source declares datum, resolution, timestamp, license,
   attribution, cache permission, checksum, and quality-tier availability.

The ocean must be built as three visually continuous but scientifically separate
systems:

- a planet-scale Fresnel/absorption/sun-glitter surface;
- regional spectral wind waves driven by wind, significant wave height, period,
  and direction;
- solver-driven tsunami elevation and velocity, transformed near shore into
  shoaling, breaking, foam, turbidity, run-up, drawdown, and wetting/drying.

Ambient waves may add sub-grid visual detail, but they must never change tsunami
arrival, elevation, current, or inundation. NASA GIBS browse imagery may make the
Earth look current, but it must never be treated as a numerical physics input.

## Current Cataclysm baseline

| Surface | Current implementation | Realism gap |
|---|---|---|
| Earth | Cesium globe with Esri World Imagery; ellipsoid unless token-gated terrain is enabled | No controlled offline global relief pack, night emissions, time-varying surface, provider provenance, or close-range detail pipeline |
| Atmosphere | Cesium lighting, `SkyAtmosphere`, and fog enabled in `Globe.tsx` | No scenario-time sun tuning, exposure strategy, cloud volume/parallax, cloud shadows, night transition, or reference-calibrated scattering |
| Ocean | Imagery plus an 8-bit RGBA SWE image through `SingleTileImageryProvider` | The sea is flat; no water BRDF, displacement, wind state, whitecaps, depth response, or shoreline interaction |
| Asteroid | Canvas billboard, glow polyline, ellipses, cylinders, and rings | No geometric body, PBR regolith, ablation, fragmentation, volumetric entry wake, physical splash, terrain lighting, or persistent aftermath |
| Nuclear | Short expanding ellipse effect | No staged flash/fireball/blast/cloud/fallout sequence, volumetric persistence, shared scene lighting, or distance-aware arrival |
| Renderer ownership | `Globe.tsx` is about 1,576 lines and owns viewer, resources, overlays, effects, and animation loops | Physical render systems cannot be tested, budgeted, replayed, or torn down independently |
| Assets | No tracked glTF/GLB, KTX, HDR/EXR, 3D Tiles, or Unreal project assets | No asset pipeline, material calibration library, LOD policy, or redistributable cinematic pack |

The existing HR-00 through HR-53 roadmap correctly identifies the major render
features. The net-new gaps are the data/provenance pipeline, an open offline base
planet, temporal Earth observations, an ambient ocean-state contract, and a
vertical-datum-aware coastal hero-zone builder.

## What existing Earth systems teach us

### Renderer and product survey

| System | What Cataclysm can gather | Decision |
|---|---|---|
| CesiumJS | WGS84/ECEF precision, terrain/imagery quadtree, screen-space-error LOD, water masks, atmosphere controls, 3D Tiles, time-dynamic layers, explicit GPU resource lifecycle | **Adopt now.** It already fits the product stack. Built-in water is only a starting material, not the living ocean. |
| Cesium for Unreal | ECEF-to-local frames, globe anchors, origin shifting, georeferenced sublevels, streamed real-world tiles combined with Unreal rendering | **Keep as the cinematic tier.** Every hazard, cloud, water, and debris actor must remain globe-anchored through rebases. |
| Google Photorealistic 3D Tiles | Rapidly streamed textured city/terrain mesh and standard 3D Tiles interoperability | **Optional online enhancement only.** Billing, attribution, no unauthorized caching, no extraction, and incomplete geographic coverage prevent use as the canonical/offline Earth. |
| Cesium ion | Mature tiling pipeline for terrain, imagery, buildings, point clouds, and reality mesh | Useful provider and build reference. SaaS data is quota/terms-bound; self-host only content whose rights allow it. |
| ArcGIS SceneView/Earth | Mature global/local scene model, elevation, integrated mesh, daylight, shadows, weather, voxels, and GIS analysis | Strong reference and optional provider; less direct control over cinematic hazards and potentially service/licensing constrained. |
| NASA WorldWind | Open layer/terrain separation, elevation/imagery streaming, WMS, and public-data orientation | Architecture reference, not the preferred renderer; current web stack and visual ceiling trail Cesium. |
| OpenSpace | Separate height, color, overlay, night, and water-mask layers; time-varying NASA data; scientific time and globe handling | **Adopt its layer taxonomy.** It is a better scientific presentation reference than a hazard VFX engine. |
| osgEarth | Self-hosted/offline composition of GDAL terrain, imagery, vector, sky, and a simple bathymetry-aware ocean | Valuable native/offline reference; a separate C++ renderer and its ocean is deliberately simple. |
| Outerra / SpaceEngine | Seamless orbit-to-ground transitions by combining sparse source data with procedural detail | **Adopt the principle, not assets/code.** Both show why satellite imagery alone becomes blurred and flat near the ground. |
| Microsoft Flight Simulator | Cloud-streamed tiles, photogrammetry where available, procedural/AI reconstruction elsewhere, caching, LOD, and separate live weather | Best large-scale architecture lesson; proprietary product and data cannot be redistributed. |
| UNIGINE Sim | 64-bit geospatial worlds, GIS ingestion, dynamic terrain, geometry water, weather/clouds, ephemeris, sensors, headless operation | Best turnkey professional-simulator benchmark, but proprietary pricing makes it an evaluation path rather than the default architecture. |
| Unreal native rendering | Physically based sky/atmosphere, ray-marched volumetric clouds, unified water mesh/materials, GPU Gerstner waves, Niagara, sparse volumes, LWC | Use for cinematic rendering. These systems solve visuals, not global geodata or tsunami physics. |

### The reusable Earth data pyramid

A convincing Earth should be composed from independent, swappable layers:

1. WGS84 ellipsoid, ECEF positions, geodetic interchange, and camera-local ENU
   or Unreal ESU frames.
2. Geoid/vertical-datum transformation; mean sea level is not the WGS84
   ellipsoid and datum mismatch can invalidate near-shore water placement.
3. Global terrain and bathymetry height pyramid.
4. Day albedo/imagery, surface material classification, land/water mask,
   coastline distance field, and local normal/detail synthesis.
5. Night emissions, cloud field, aerosol/haze, snow/ice, fire, and other
   time-indexed visual layers.
6. Optional buildings, photogrammetry, vegetation, and local collision proxies.
7. Authoritative simulation fields: eta, velocity, wet/dry state, pressure,
   thermal flux, fallout, crater/ejecta state, and event phases.

Each layer requires its own LOD, timestamp, cache, attribution, fallback, and GPU
budget. Terrain and imagery should never be fused into one irreversible asset.

## Recommended living-Earth stack

### 1. Open, deterministic base planet

- Use NOAA ETOPO 2022 (15 arc-second global topography and bathymetry) as the
  reproducible global relief source, processed into terrain/bathymetry tiles.
- Use NASA Blue Marble Next Generation as a permitted, stable fallback albedo.
- Derive land/water and coastline-distance products only from sources whose
  derivative and redistribution terms are recorded in the manifest.
- Package bounded low/medium-detail tiers; higher-resolution regional packs are
  downloadable and checksum-addressed rather than making the installer enormous.
- Preserve a clearly labelled ellipsoid/minimal fallback if a pack is missing or
  corrupt. The application must never open to a blank globe.

ETOPO is appropriate for orbit/regional appearance and deep-water context. It is
not detailed enough for credible local inundation. NOAA site-specific tsunami
work uses nested grids down to roughly 1/3 arc-second near shore; Cataclysm needs
equivalent local topobathymetric quality for hero locations.

### 2. Time-varying Earth without confusing visuals with science

NASA GIBS can provide scenario-date WMTS layers such as true color, clouds,
fires, snow/ice, and night observations. Those layers should be cached by layer,
date, projection, and tile coordinates, with an explicit acquisition timestamp.

GIBS documentation describes these as visualization/browse products. They improve
context and historical appearance but do not replace calibrated meteorological,
oceanographic, or hazard inputs. Missing dates use a labelled nearest-date or
climatology fallback, never a silent current-day substitution.

### 3. One physical lighting system

The sun, atmosphere, clouds, ocean, terrain, asteroid plasma, fireballs, nuclear
flash, smoke, and dust must share:

- scenario UTC and geolocation;
- physically coherent solar direction and angular size;
- Rayleigh/Mie scattering and aerial perspective;
- HDR scene-referred light and exposure adaptation;
- cloud transmittance, shadows, and reflection contribution;
- day/night color response and night emissions.

Cesium can deliver a materially better analytical milestone by using its globe
atmosphere parameters, lighting from the sun, terrain shadows, water masks, and
custom shaders. Unreal remains the route to ray-marched volumetric weather and
cinematic interaction. A high-resolution texture under inconsistent lighting
will still look composited and artificial.

### 4. A genuinely alive ocean

**Planet scale — optical body**

- curvature-correct horizon and atmospheric extinction;
- Fresnel reflection, depth absorption, sky/cloud reflection, sun glitter, and
  distance-dependent roughness;
- bathymetry-informed water color without revealing bathymetry as a painted map;
- multi-band normal detail that remains stable under camera movement.

**Regional scale — ambient wind sea**

- GPU FFT/JONSWAP or validated multi-band spectral waves;
- input contract for wind vector, significant wave height, peak/mean period,
  directional spread, currents, and sea ice;
- NOAA GFS-Wave/WAVEWATCH III or Copernicus Marine as optional time/location
  sources, with deterministic scenario overrides and an offline climatology;
- scale-aware whitecaps, foam lifetime, spray, and cloud reflections.

Tessendorf-style spectral synthesis is the appropriate graphics foundation;
Gerstner waves are a cheaper quality tier. Neither is the tsunami model.

**Hazard scale — authoritative displacement**

- Rust eta/u/v snapshots displace adaptive ocean tiles and drive flow normals;
- render interpolation may smooth frames but may not move arrival time or peaks;
- the tsunami remains broad and low in deep water;
- nested, high-resolution topobathymetry drives shoaling, refraction, drawdown,
  breaking thresholds, bores, wetting/drying, debris, turbidity, and run-up;
- ambient waves are added visually after sampling the solver field and never feed
  back into exported scientific water level or current.

NOAA benchmark and inundation guidance should define validation scenes. A global
FLIP ocean would consume extreme compute while being less scientifically useful
than shallow-water propagation plus local high-detail visual coupling.

### 5. Local hero zones

Orbit-to-ground realism requires selective density. For every curated coastal or
impact location, build a versioned local ENU asset pack containing:

- best-permitted terrain and bathymetry with datum metadata;
- shoreline mesh/distance field and wet/dry collision surface;
- buildings/vegetation with stable IDs and simplified collision proxies;
- local material classification and procedural detail masks;
- provider attribution, license, source date, bounds, checksum, and error budget.

The global renderer streams the broad Earth; the hero pack supplies the detail
needed for wave interaction, debris, crater/ejecta, fire, and ground cameras.
This is how MSFS/Outerra-style systems avoid storing maximum detail everywhere.

## Data and licensing decisions

| Need | Preferred baseline | Optional enhancement | Guardrail |
|---|---|---|---|
| Global relief/bathymetry | NOAA ETOPO 2022 | Local NOAA coastal DEMs and other licensed regional surveys | Record horizontal/vertical datum and source resolution; never infer inundation quality from global relief |
| Stable global albedo | NASA Blue Marble NG | User-configured or licensed regional imagery | Preserve attribution and redistribution terms in the asset manifest |
| Temporal visual Earth | NASA GIBS WMTS | Provider-specific satellite products | Mark browse imagery as visual context; cache by date and layer |
| Ambient ocean state | NOAA GFS-Wave/WAVEWATCH III | Copernicus Marine wave/current products | Store product time, resolution, variables, units, interpolation, and license; deterministic offline override |
| City/building detail | Open/self-hosted permitted data | Google Photorealistic 3D Tiles or Cesium ion | Optional online mode only when terms, billing, authentication, attribution, and cache rules are satisfied |
| Cinematic scene | CesiumJS fallback plus local packs | Cesium for Unreal | Same render-frame protocol and asset provenance; no duplicated hazard physics |

An asset is not “available” merely because it can be viewed online. The importer
must reject unknown licenses and incompatible datum/units, and the runtime must
distinguish streamable, cacheable, redistributable, derived-work-permitted, and
attribution-required content.

## Implementation implications

### Recommended sequence

1. Ship the asset/provider manifest and vertical-datum rules before adding more
   providers or visual assets.
2. Produce the open offline base planet and deterministic scenario-time sun/night
   captures.
3. Split the Cesium renderer lifecycle, then implement physical ocean optics and
   an ambient-ocean input contract.
4. Add NASA GIBS temporal visual layers with provenance and graceful offline
   behavior.
5. Stream solver eta/u/v into the Cesium ocean; validate separation between
   ambient wind waves and authoritative hazard fields.
6. Build one datum-correct coastal hero pack and demonstrate continuous
   deep-water propagation, shoaling, breaking, and run-up.
7. Use the same fixtures to validate the Unreal cinematic client, origin shifts,
   effects, and deterministic capture.

### Measurable acceptance

- Orbit-to-10 km transition has no tile cracks, coordinate jitter, hard exposure
  step, or visible imagery/material seam.
- Scenario UTC drives terminator, atmosphere, clouds, night emissions, glint, and
  every environmental dataset lookup.
- Ocean is identifiable as water with analytical eta color fully disabled.
- Ambient-wave changes do not alter scientific probes, arrival time, maximum eta,
  wet/dry state, or exported fields.
- One coastal fixture places mean water level and terrain within a documented
  vertical error budget and passes NOAA-compatible propagation/run-up benchmarks.
- One asteroid and one nuclear fixture illuminate terrain, ocean, and clouds in
  the same HDR lighting space and retain deterministic geometry/timing.
- Low/Medium/High/Cinematic tiers log GPU time separately for terrain, imagery,
  ocean, atmosphere/clouds, hazard effects, and post-processing.
- Offline mode renders the approved base planet and environmental fallback with
  no hidden network dependency.

## Cross-cutting audit

- **Security/privacy:** remote tile URLs, credentials, cache paths, archive
  extraction, and asset decoders are trust boundaries. Keep provider hosts
  allowlisted, secrets outside scenario exports, checksums mandatory, and cache
  sizes bounded. No location telemetry is required.
- **Accessibility:** reduced motion must suppress camera shake/aggressive cuts but
  not scientific animation; flashes need a photosensitivity-safe mode; all
  color-coded physical layers retain legends, numeric probes, and contrast-safe
  analytical alternatives.
- **Internationalization:** geospatial provenance, units, UTC/local time, datum,
  layer titles, and attribution need catalog-ready strings. Proper names and
  required legal attribution must not be machine-translated silently.
- **Observability:** log provider latency/errors, cache hit rate, active LOD,
  terrain/imagery source, scenario time, vertical datum, texture memory, shader
  tier, and per-system GPU time in the diagnostics bundle.
- **Testing:** add schema fixtures, provider mocks, license-policy tests, datum
  conversion tests, visual references, GPU resource-leak loops, offline tests,
  field-to-surface numerical comparisons, and origin-shift tests.
- **Documentation:** user-facing source/attribution and realism-limit panels must
  explain which layers are measurements, browse imagery, simulation, or
  procedural visuals. Scientific uncertainty must remain visible.
- **Distribution/upgrades:** base assets need versioned manifests, resumable
  downloads, checksums, disk-budget controls, migrations, and rollback. Provider
  API/terms changes cannot break the packaged offline Earth.
- **Plugins/providers:** use a narrow provider interface and capability matrix;
  do not expose arbitrary runtime shader or code plugins.
- **Multi-user:** no collaboration/server mode is needed for rendering realism;
  deterministic replay files are the correct sharing primitive.
- **Mobile:** explicitly rejected. The product is desktop-only and quality tiers
  should target desktop GPUs rather than diluting the design for phones.

## Rejected or deferred ideas

- **One downloadable high-polygon Earth mesh:** cannot provide orbit-to-ground
  detail, temporal layers, or manageable distribution and would still need every
  dynamic system described above.
- **Google/photogrammetry as the mandatory base:** licensing, billing, attribution,
  cache restrictions, authentication, and coverage make it an enhancement only.
- **A sharper sphere texture as the realism program:** resolution does not add
  terrain relief, parallax, material response, weather, scale detail, or motion.
- **A looping normal map as the living ocean:** useful only as one capillary band;
  it cannot express wind state, glint, whitecaps, tsunami displacement, breaking,
  or shoreline interaction.
- **Rendering a tsunami as a tall traveling wall in deep water:** physically
  misleading; dramatic height belongs to shoaling, breaking, and run-up.
- **Using GIBS browse imagery as weather/ocean physics:** it is visual context,
  not a calibrated simulation forcing product.
- **Global FLIP/Navier–Stokes water:** prohibitively expensive and less accurate
  for basin-scale tsunami propagation than the authoritative SWE solver with
  targeted local visual coupling.
- **Migrating entirely to Unreal now:** it would delay the scientific renderer,
  duplicate working desktop infrastructure, and does not remove the need for
  geodata, licensing, precision, datum, or shared-state engineering.

## Source set

The survey covered more than 50 distinct primary, official, academic, and
community sources. These are the 30 sources most directly useful to decisions.

### Engines and rendering systems

1. [CesiumJS platform](https://cesium.com/platform/cesiumjs/)
2. [CesiumJS Globe API](https://cesium.com/learn/cesiumjs/ref-doc/Globe.html)
3. [CesiumJS CustomShader API](https://cesium.com/learn/cesiumjs/ref-doc/CustomShader.html)
4. [Cesium for Unreal: placing objects and origin shifting](https://cesium.com/learn/unreal/unreal-placing-objects/)
5. [Cesium for Unreal georeference API](https://cesium.com/learn/cesium-unreal/ref-doc/classACesiumGeoreference.html)
6. [Cesium for Unreal georeferenced sublevels](https://cesium.com/learn/unreal/unreal-sublevels/)
7. [Google Photorealistic 3D Tiles](https://developers.google.com/maps/documentation/tile/3d-tiles)
8. [Google Map Tiles API policies](https://developers.google.com/maps/documentation/tile/policies)
9. [ArcGIS SceneView](https://developers.arcgis.com/javascript/latest/references/core/views/SceneView/)
10. [NASA WorldWind](https://worldwind.arc.nasa.gov/)
11. [OpenSpace globe layer architecture](https://docs.openspaceproject.com/latest/building-content/globebrowsing/working-with-layers.html)
12. [osgEarth layer catalog](https://docs.osgearth.org/en/latest/layers.html)
13. [Outerra full-world engine](https://outerra.com/)
14. [Microsoft Flight Simulator technical overview](https://developer.microsoft.com/en-us/games/articles/2021/07/microsoft-flight-simulator-the-future-of-game-development/)
15. [UNIGINE Sim capabilities](https://unigine.com/products/sim/overview/)
16. [Unreal Sky Atmosphere](https://dev.epicgames.com/documentation/en-us/unreal-engine/sky-atmosphere-component-in-unreal-engine)
17. [Unreal Volumetric Clouds](https://dev.epicgames.com/documentation/unreal-engine/volumetric-cloud-component-in-unreal-engine)
18. [Unreal Water System](https://dev.epicgames.com/documentation/unreal-engine/water-system-in-unreal-engine)
19. [Unreal Large World Coordinates](https://dev.epicgames.com/documentation/unreal-engine/large-world-coordinates-in-unreal-engine-5)

### Earth, ocean, and hazard data/science

20. [NOAA ETOPO 2022 global relief](https://www.ncei.noaa.gov/products/etopo-global-relief-model)
21. [NOAA coastal elevation models](https://www.ncei.noaa.gov/products/coastal-elevation-models)
22. [NASA Blue Marble Next Generation](https://neo.gsfc.nasa.gov/view.php?datasetId=BlueMarbleNG)
23. [NASA GIBS access basics](https://nasa-gibs.github.io/gibs-api-docs/access-basics/)
24. [NASA GIBS Python/browse-product guidance](https://nasa-gibs.github.io/gibs-api-docs/python-usage/)
25. [NOAA WAVEWATCH III](https://polar.ncep.noaa.gov/waves/wavewatch.shtml)
26. [Copernicus Marine data catalog](https://data.marine.copernicus.eu/)
27. [NOAA tsunami inundation modeling guidelines](https://vlab.noaa.gov/documents/27521613/29089376/1inundationmodelingguidelines.pdf/fdcfc0ea-f797-74e5-c760-45ea75215920)
28. [NOAA tsunami analytical benchmarks](https://nctr.pmel.noaa.gov/benchmark/Analytical/index.html)
29. [Tessendorf, Simulating Ocean Water](https://people.computing.clemson.edu/~jtessen/reports/papers_files/coursenotes2002.pdf)
30. [Bruneton and Neyret, Precomputed Atmospheric Scattering](https://onlinelibrary.wiley.com/doi/10.1111/j.1467-8659.2008.01245.x)

## Open decisions to resolve through prototypes

1. Whether Cesium custom ocean displacement can meet the analytical High-tier
   frame budget before the Unreal client is available.
2. Which redistributable high-resolution terrain/building sources cover the first
   three hero coastal zones and what vertical transformations they require.
3. Whether FFT/JONSWAP is necessary for High, or whether a deterministic
   multi-band Gerstner implementation is sufficient below Cinematic.
4. The asset-pack disk budgets for bundled, downloadable, and user-supplied data.
5. The smallest shared GPU field format that preserves eta/u/v precision across
   Cesium/WebGL and Unreal without duplicating interpolation logic.
