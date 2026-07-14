# Research — Cataclysm

## Executive Summary

Cataclysm v0.10.4 is a local-first Tauri 2 / React 19 / CesiumJS desktop
workspace whose Rust backend combines cited asteroid, nuclear, earthquake,
landslide, and shallow-water tsunami models behind a progressively disclosed
professional simulator. Its strongest current shape is the trust boundary
already engineered around scientific inputs, geodesy, renderer protocol, run
quality, coastal provenance, offline fallback, and deterministic local
verification — this is what separates it from the "fun-but-fictional" impact and
blast toys it competes with. The highest-value direction remains *finishing that
trust system and deepening physical credibility before adding spectacle*, but a
fresh code audit and 2025-2026 external scan surface two new fronts: (a) a small
cluster of **verified correctness/security bugs** in the direct-hazard, solver,
and settings paths that quietly change headline numbers or leak a token, and
(b) a class of **new hazard sources that reuse the existing SWE solver as a
forcing term** (volcanic-source tsunami, meteotsunami / Hunga-Tonga Lamb wave)
plus supervolcano ashfall over the existing advection machinery.

Top opportunities in priority order: (1) fix the Okada displacement-field
georeferencing before it is wired into the SWE initial condition;
(2) stop the antimeridian bounding box from leaving the ±180 frame;
(3) reject sub-floor `mean_depth_m` instead of silently clamping it;
(4) order casualty/latent-cancer effect rings by radius before annulus
accumulation; (5) route legacy token migration through the OS keychain, never
the plaintext store; (6) add a cited **volcanic-source tsunami** module; (7) add
**meteotsunami / moving atmospheric-pressure** forcing (Hunga Tonga 2022);
(8) surface **institutions/infrastructure inside a hazard zone** and a
**child-casualty** demographic metric; (9) exploit **WebGPU subgroups/f16 +
timestamp queries** for solver throughput and an honest in-app GPU profiler; and
(10) run a **hazard-map-literacy** design pass so overlays match official
symbology and pre-empt documented misreadings.

## Product Map

- **Core workflows:** select or author a cited hazard; compute direct effects or
  run SWE propagation; inspect time, reach, gauges, runup, and direct-effect
  thresholds; compare scenarios; export visual and scientific products.
- **User personas:** educators, students, science communicators, hazard
  enthusiasts, and researchers doing exploratory analysis — not emergency
  management, warning, evacuation, or engineering design.
- **Platforms and distribution:** React 19 / TypeScript 6 / Vite 8 frontend;
  Tauri 2.11 / Rust 2024 desktop backend; Windows MSI/NSIS is the verified
  release path, macOS/Linux are source targets; CPU plus optional wgpu
  acceleration.
- **Key integrations and data flows:** Rust owns physics and direct-effect
  results; typed Tauri IPC and checksummed renderer-protocol messages feed
  Cesium; online Esri/OSM/Cesium context degrades to bundled Natural Earth II;
  local settings and OS-keychain token storage keep analysis on-device.
- **Hard constraints:** coarse bathymetry, static idealized sources, analytical
  runup, no AMR/Boussinesq solver, unsigned installers, desktop-only
  interaction, and a Cesium bundle that still needs a narrow CSP `unsafe-eval`
  exception.

## Competitive Landscape

### GeoClaw, ANUGA, and Celeris-WebGPU

- **Do well:** mature wet/dry SWE schemes, gauges and maximum fields,
  checkpoints, AMR/unstructured meshes, reproducible scenarios, benchmark
  culture. Celeris-WebGPU (USACE/ONR/NSF, v2025) is the closest prior art — an
  open-source, browser, WebGPU Boussinesq SWE solver built expressly for natural
  hazard *education*, faster-than-real-time on desktop GPUs.
- **Learn:** preserve lake-at-rest states, prevent negative depth by
  construction, record flow-intensity products, make long runs restartable; mine
  Celeris' WGSL for wet/dry and dispersive techniques and benchmark against it.
- **Avoid:** requiring users to assemble a Python/Fortran/GIS toolchain before
  they can inspect an educational scenario.

### FUNWAVE-TVD, JAGURS, and Tsunami-HySEA

- **Do well:** dispersive and nested modeling, hot starts, NetCDF interchange,
  open-boundary work, GPU/HPC execution, point time series.
- **Learn:** boundary reflection is a measured correctness property; execution
  backends must preserve one solver/output contract.
- **Avoid:** CUDA-only coupling and exposing research switches without validity
  bounds, diagnostics, or a deterministic CPU reference.

### NUKEMAP (2026 public roadmap)

- **Do well:** place-first setup, clear effect thresholds, point exposure,
  shelter/fallout context, comparison, sharing, population framing. The Feb-2026
  roadmap adds an open, modular effects library (AWEL.js), a **DELFIC** fallout
  model beside WSEG-10, **click-anywhere dose-over-time**, **child casualties**
  as a distinct metric, and **institution lookup inside damage rings** via OSM.
- **Learn:** answer what happened here, when, under which model, and why; a
  humanitarian/demographic framing (child casualties, named institutions in
  zone) is what serious users ask for; extract effect models into an
  independently-citable, versioned crate.
- **Avoid:** weapons-game breadth, false casualty precision (NUKEMAP itself
  declines detailed EMP), and burying core workflows under dense panels.

### Asteroid Launcher and Impact: Earth!

- **Do well:** staged consequence storytelling, intuitive scale,
  observer-distance summaries, recurrence context, cited impact chains.
- **Learn:** pair visual effects with semantic values and explicit model limits.
  Asteroid Launcher's most-noted gap is that it does **not** model tsunamis from
  ocean impacts — precisely the axis Cataclysm already wins; make an explicit
  "ocean-impact tsunami" scenario pack the differentiator.
- **Avoid:** artistic effects or casualty/ocean claims that outrun the model.

### OpenQuake, ArcGIS Flood, Moody's, ParaView

- **Do well:** strict admission, job identity, versioned inputs/outputs,
  sensitivity workflows, immutable prior results plus normalized reruns, portable
  relative state, headless extractors, standard VTK time-series inspection.
- **Learn:** make model/data upgrades auditable; VTK time series and explicit
  recovery broaden independent verification without executable plugins.
- **Avoid:** enterprise orchestration, insurance pricing, real-time
  collaboration, executable model plugins in the trusted core.

## Security, Privacy, and Reliability

Verified in this pass (new, not previously tracked):

- **Legacy token migration writes the Cesium token to the plaintext store.**
  `src/lib/settings.ts:357-360` — when a plugin-store exists and the key is in
  `SENSITIVE_KEYS`, the localStorage→store migration does `store.set(key, …)`,
  persisting `cesium_token` into `settings.json` and defeating the keychain-only
  design (the keychain branch at `:315-335` is the correct path). Route sensitive
  keys through `writeTokenToKeychain`, never `store.set`.
- **Antimeridian bounding box leaves the ±180 frame.**
  `src-tauri/src/commands.rs:1033-1034` normalizes only the source *center*
  longitude; `west = lon - half` / `east = lon + half` (half up to 60°) then
  produce spans like `[-235, 361]` — exactly what the adjacent comment claims to
  prevent. The degenerate `bbox` reaches Cesium's `SingleTileImageryProvider`.
  Clamp/wrap the span or split at the dateline (near-term slice of the larger
  tiled-transport item).
- **`mean_depth_m` is validated in `[0, 12000]` then silently clamped to 50 m.**
  `commands.rs:943` accepts near-zero depth; `:1055`/`:1240` do
  `req.mean_depth_m.max(50.0)`, so CFL, celerity, arrival times, gauges, and
  exports all reflect 50 m while the provenance strip reports the request. Reject
  sub-floor depth in `validate_simulate_grid`, consistent with the fail-closed
  rule.
- **Missing guardrails on atmospheric entry.**
  `src-tauri/src/physics/direct_hazard.rs:261,338-345` — the RK4 integrator caps
  at 5,000,000 steps and, if exhausted, falls through to `reaches_ground: true`
  with no convergence flag; `:182-197` floors `v`/`m` at `1e-12` and divides by
  `velocity` in the `θ` derivative, so a nearly-stopped body can produce a wild
  step and a spurious `airburst_energy` that feeds blast/thermal radii. Add a
  convergence flag and a physical velocity floor.

- **Recovery/rollback needs:** preserve existing solver-checkpoint,
  transactional-settings, portable-package, and run-admission roadmap items; add
  keychain-safe token migration and the cancelled-run replay short-circuit rather
  than a second generic recovery framework.
- **No actionable dependency CVE found.** Vite 8.1.x, Tauri 2.11.5, wgpu 29.x,
  and the locks contain no affected path from advisories reviewed; RustSec GTK
  notices remain platform-inherited. Do not manufacture an upgrade row.

## Architecture Assessment

- **Direct-hazard effect rings assume a monotone radius order they do not
  enforce.** `direct_hazard.rs:1023-1060` (casualties) and `:1076-1097` (latent
  cancer) accumulate `previous_area` across zones built from *independent* radii
  (`thermal_3.max(psi_3)`, `psi_1`, `thermal_1`, …). Only `psi_0_25` was
  hand-ordered; for yields where `thermal_1 > psi_1` or `thermal_3 > psi_20` the
  `(area - previous_area).max(0.0)` term zeroes a real ring or overlaps a counted
  one, changing headline deaths/injuries/cancers. Sort zones by radius descending
  before accumulation, as the ring-rendering path already does.
- **Okada displacement-field georeferencing is inconsistent.**
  `physics/okada.rs:108-115` shifts `origin_lat` to the grid's south edge but
  leaves `origin_lon` at the *center*, and applies `lat_per_m` to the x/longitude
  spacing with no `cos(lat)` term. `uz_m` is laid out from the south-west corner,
  so any consumer treating `(origin_lat, origin_lon)` as the SW corner
  misregisters the uplift by up to half a grid width. Latent today (only tests
  read the field) but will silently corrupt the seafloor IC the moment it is
  coupled to the SWE grid.
- **Gauge bilinear sampler has an edge dead band.**
  `physics/solver/mod.rs:408-436` — `x = (lon-west)/dlon - 0.5`; a gauge on the
  outer half-cell rim yields `x = nx-0.5`, fails the `x <= nx-1` test, and returns
  `eta_m: None` with no diagnostic, so frame-edge DART buoys can go dark. Clamp
  indices into range or document the dead band.
- **Sponge damping is wet/dry-unaware and invisible to the quality gate.**
  `mod.rs:1005-1012,1057-1075` damps every rim cell without wet/dry awareness, so
  a wet rim adjacent to interior land compounds absorption with the reflective
  land wall; `quality.rs:145-149` excludes the sponge band from drift, hiding the
  loss. Skip damping on cells whose interior neighbor is dry, or document that
  frame-touching coastlines are unsupported.
- **Cancelled streaming runs can hang the UI and double CPU work.**
  `src/lib/tauri.ts:42-69,411-419` — on cancel the client still `await`s
  `waitForRenderReplay(replay, render_frame_count, …)`, which busy-polls for up to
  120 s if a counted frame was dropped; `SwePlayback.tsx:321-325,381-436`
  supersedes with a best-effort `cancelSimulation` while the old worker runs to
  completion. Short-circuit the wait when `meta.cancelled`, and gate a new run on
  the previous run's teardown. (Distinct frontend slice of the tracked run-identity
  item.)
- **Scenario migration flag and round-trip fidelity.**
  `src/lib/scenario-schema.ts:387-388,428` reports `migrated: true` for a current
  payload that used the `version` alias, and `settings.ts:696` re-stamps `data`
  with the parsed payload, dropping keys the schema does not model. Derive
  `migrated` from schema-version presence-and-equality and decide explicitly
  whether location `depth_m` is preserved.
- **Concentration points** `App.tsx` and `commands.rs` decomposition is already
  roadmapped; do not duplicate.
- **Test gaps (new):** no ring-order-monotonicity test across yields, no Okada
  georeferencing test, no sub-floor-depth rejection test, no antimeridian bbox
  test, no concurrent-superseded-stream test.

## New capability directions (sourced)

- **Volcanic-source tsunami.** The 2024 *PAGEOPH* TGV review enumerates six
  mechanisms (volcano-tectonic quakes, flank/slope failure, pyroclastic flows,
  underwater explosions, air-pressure waves, caldera collapse); flank collapse and
  pyroclastic-flow-into-sea reduce to a few-parameter source term feeding the
  existing SWE solver. Santorini/Anak Krakatau are teachable cases, and the
  revised "caldera collapse ≠ simple tsunami" science is itself a misconception
  lesson. Lab data (Liu & Fritz 2024) supports a "validated against experiments"
  evidence claim. README already lists caldera collapse as planned.
- **Meteotsunami / moving atmospheric-pressure forcing.** Vilibić et al. 2025
  (*Reviews of Geophysics*) is the definitive review; Proudman resonance
  (disturbance speed ≈ √(gh)) is a one-line coupling condition over existing
  bathymetry-derived celerity and a beautiful interactive knob. The Hunga Tonga
  2022 dual-speed Lamb/Pekeris pressure pulse is directly implementable as a
  moving forcing term and explains the globally-recorded "early" wave — a marquee
  2022 scenario, no new solver.
- **Supervolcano ashfall.** An Ash3d-style advection-diffusion tephra model with a
  continent-scale umbrella cloud (Yellowstone/Taupo) reuses the plume/advection
  machinery, is cited and tractable, and fits the "cataclysm" brand; the
  "umbrella bullseye vs wind-blown plume" contrast is a strong teaching visual.
- **Humanitarian/demographic framing.** Institutions-in-zone (schools, hospitals,
  museums via OSM) and a child-casualty metric are NUKEMAP-validated, reuse the
  geocoding stack, and apply to both blast and inundation footprints.
- **Solver throughput + honest profiling.** WebGPU subgroups accelerate max-field
  and flux reductions; f16 storage halves bandwidth on the memory-bound SWE
  stencil; timestamp queries enable a real per-pass in-app GPU profiler. All land
  on the existing wgpu path without changing the CPU reference.
- **Hazard-map literacy.** Recent tsunami-communication research (MDPI *Water*
  2024; Springer 2025 uncertainty chapter) shows users misread single-scenario
  maps as certainty and safe zones as guarantees, and that comparison/percentage
  framings can mislead. Adopting IOC-UNESCO Tsunami Ready symbology (clearly
  labelled non-operational), leading with arrival time, and showing uncertainty
  bands counters documented failure modes.
- **WCAG 2.2 AA beyond forced-colors.** A globe leans on *drag* (pan/rotate/place)
  and small targets; 2.5.7 Dragging Movements (non-drag alternative), 2.5.8
  Target Size, 2.4.11 Focus Not Obscured, and 3.2.6 Consistent Help are the
  highest-value untracked criteria.
- **Distribution + supply chain.** winget (MSIX/`winapp`), Flathub, and a Homebrew
  cask are the expected reach channels for an OSS scientific app; a CycloneDX SBOM
  plus SLSA provenance attached to each release strengthens the "why trust this"
  story and is achievable locally (syft/`cargo cyclonedx`) with no CI.

## Rejected Ideas

- **Full MHD CME / geomagnetic-storm solver — rejected as a simulation.** ENLIL-
  class 3D MHD is far outside an educational desktop's scope; a Carrington event
  has no globe-spatial wave field to propagate. Ship it, if at all, as a narrative
  timeline scenario card, not a solver hazard. Source: NASA ENLIL Carrington viz.
- **Gamma-ray-burst / supernova radiative-transfer solver — rejected as a
  simulation.** The terrestrial effect (ozone loss, UV) is near-uniform globally,
  so there is nothing spatial to solve; the 2024 *Comms Earth & Env* "atmosphere
  is more protective than feared" result is a good myth-busting *card* for the
  long-term-effects timeline, not a hazard mode.
- **Operational alerts, evacuation routing, CAP output — rejected.** Contradicts
  the educational/non-operational boundary. Source: NTHMP guidance,
  `FirstRunDisclaimer.tsx`.
- **Detailed EMP simulation — rejected.** NUKEMAP's 2026 roadmap declines it for
  lack of public models supporting the apparent precision.
- **Hosted executable mods / workshop — rejected.** Broadens the trusted-code
  surface and undermines Rust authority. Source: Universe Sandbox.
- **Cloud-first SaaS, insurance pricing, real-time collaboration — rejected.**
  Governance lessons transfer; the product and privacy model do not. Source:
  Moody's Risk Modeler.
- **CUDA-only solver path — rejected.** HySEA toolchain friction reinforces
  wgpu + deterministic CPU fallback.
- **Mobile client — rejected for now.** Dense Cesium/scientific workspace, local
  compute, offline data, and desktop packaging are intentional; revisit only if
  Tauri mobile maturity plus a genuinely simplified "pocket" mode both land.
- **Immediate Tauri/React/Cesium/wgpu/keyring major churn — rejected.** No
  verified defect a migration alone fixes.

## Sources

### Direct OSS, adjacent, and prior art

- https://github.com/clawpack/geoclaw
- https://www.clawpack.org/fgmax.html
- https://github.com/anuga-community/anuga_core/releases
- https://github.com/fengyanshi/FUNWAVE-TVD
- https://github.com/jagurs-admin/jagurs/releases
- https://github.com/edanya-uma/Tsunami-HySEA
- https://plynett.github.io/
- https://ascelibrary.org/doi/10.1061/JWPED5.WWENG-2370
- https://github.com/joaquinmeza90/SWEpy
- https://github.com/gem/oq-engine/releases

### Competitive and community signal

- https://blog.nuclearsecrecy.com/2026/02/10/nukemap-roadmap/
- https://db.nuclearsecrecy.com/nukemap/faq/
- https://neal.fun/asteroid-launcher/
- https://sorvegliatispaziali.inaf.it/en/asteroid-launcher-how-to-simulate-an-asteroid-impact/
- https://www.matrixgames.com/news/nuclear-war-simulator-1-dev-log
- https://news.ycombinator.com/item?id=33870612

### Hazard science (new sources / candidate hazards)

- https://link.springer.com/article/10.1007/s00024-024-03515-y
- https://www.nature.com/articles/ncomms13332
- https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2023JC020796
- https://www.nature.com/articles/s41598-023-35800-6
- https://agupubs.onlinelibrary.wiley.com/doi/10.1029/2024RG000867
- https://www.coastalwiki.org/wiki/Proudman_resonance_and_meteo_tsunamis
- https://agupubs.onlinelibrary.wiley.com/doi/full/10.1002/2014GC005469
- https://www.usgs.gov/publications/modeling-ash-fall-distribution-a-yellowstone-supereruption

### Communication, standards, platform, and supply chain

- https://www.mdpi.com/2073-4441/16/23/3423
- https://link.springer.com/chapter/10.1007/978-3-031-98115-9_8
- https://tsunami.ioc.unesco.org/en/tsunami-ready
- https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/
- https://v2.tauri.app/distribute/
- https://cesium.com/blog/2026/07/01/cesium-releases-in-july-2026/
- https://developer.chrome.com/blog/new-in-webgpu-128
- https://learn.microsoft.com/en-us/windows/apps/dev-tools/winapp-cli/guides/tauri

## Open Questions

None block prioritization or implementation. Signing credentials, updater keys,
bundled GEBCO distribution rights, large real-terrain datasets, and Unreal
runtime availability remain explicitly separated in `Roadmap_Blocked.md`.
Whether new hazards (volcanic-source tsunami, meteotsunami, ashfall) ship as
first-class modes or curated scenario packs is a product decision, not a
research gap — both reuse existing solvers.
