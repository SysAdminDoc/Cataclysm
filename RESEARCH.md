# Research — Cataclysm

Date: 2026-07-12 (supersedes the 2026-07-11 pass)

## Executive Summary

Cataclysm v0.10.0 is a desktop, scientifically-grounded multi-hazard disaster
simulator (asteroid impact, nuclear detonation, seafloor earthquake, landslide,
and the tsunamis they generate) built on Tauri 2 + React 19 + CesiumJS with a
Rust physics core. Since the 2026-07-11 research pass the team shipped nearly all
of that pass's top-10 "trust and correctness" opportunities: GPU-enabled release
packaging (`9204a6a`), solver-step-cadence maxima decoupling (`311271b`), hazard
workspace isolation (`429a02b`), offline imagery fallback (`45a6392`), CSV formula
neutralization (`1514dd0`), accessible states (`cf7fa53`), scoped Compare
cancellation and settings/effect recovery (v0.8.3, `ae5bbe7`). A fresh code audit
of the current tree found **no P0/P1 defects** — the codebase is unusually hardened
(checked IPC bounds, SHA-verified render protocol, revoked object URLs, keychain
token storage, tight CSP). The strongest current shape is therefore its
scientific integrity and the new progressively-disclosed Simple/Customize/Advanced
workspace.

The highest-value direction now shifts from "fix the shipped contract" to
**closing feature and data gaps that the field considers table stakes and that the
existing roadmap does not yet cover** — most of the previous pass's roadmap items
remain open and should be executed as-written; this pass adds what they miss.

Top opportunities, in priority order (all new this pass unless noted):

1. **Verified** — Re-validate persisted scenarios on read (audit: `readScenarios`
   trusts the store). Small, pure trust fix.
2. **Verified** — Unify front-end/back-end input bounds from one table (audit:
   `mw`/`rake` diverge between `scenario-schema.ts` and `commands.rs`).
3. **Verified/Likely** — Replace the flat casualty population scalar with a real
   offline density grid (GHS-POP); casualties currently ignore location.
4. **Likely** — Metric/imperial units + comparison anchors (the single most
   repeated user complaint about this class of tool).
5. **Likely** — Event recurrence/frequency context after each run (calibrates dread
   with probability; core to the education mission).
6. **Likely** — Multiple selectable casualty models with visible disagreement
   (NUKEMAP's own 2026 direction).
7. **Verified** — 0.25 psi light-damage ring + extended-validity sources (rings
   currently floor at 1 psi).
8. **Likely** — Live USGS earthquake seeding + ShakeMap/PAGER comparison (real
   events + free validation, no new physics).
9. **Likely** — Drape analytical overlays onto real terrain (Cesium 1.135 3D-Tiles
   terrain; answers the "mountains should block this" complaint at analytical level).
10. **Verified** — Publish build provenance/SBOM/reproducibility as the unsigned-app
    trust substitute (fits the no-code-signing policy).

## Product Map

- **Core workflows:** pick or author a cited source (asteroid/nuclear/quake/slide);
  run analytical + shallow-water propagation; watch the guided Prepare → Calculate →
  Watch → Understand journey; inspect wave/runup/gauge/DART/direct-effect outputs;
  compare scenarios; export visual and machine-readable products.
- **Progressive disclosure (v0.10.0):** Simple (globe/scenario/journey/timeline/
  outcomes dominant) → Customize (rerun, ocean depth, atmospheric-wave) → Advanced
  (grids, gauges, confidence, diagnostics). Selection and computed fields survive
  mode switches.
- **User personas:** educators/students; science communicators; hazard enthusiasts;
  researchers using it for exploratory/illustrative — not operational — work.
- **Platforms/distribution:** Tauri desktop, Windows MSI/NSIS is the verified
  shipped platform (unsigned by policy); macOS/Linux are source targets. Mobile is
  intentionally excluded.
- **Integrations/data flow:** Rust IPC owns all physics and direct-hazard results;
  CesiumJS projects backend fields onto WGS84 via a renderer-neutral, checksummed
  frame protocol; Esri/Cesium/OSM providers supply online Earth context with a
  bundled Natural Earth II offline fallback; keychain holds the Cesium token;
  exports include PNG, video, CZML, GeoJSON, KML, CSV, and share URLs.

## Competitive Landscape

### NUKEMAP (nuclearsecrecy.com) — the direct nuclear reference
- Does well: plain-language consequences, historical weapon presets, and a
  **publicly published Feb-2026 roadmap** naming its own next features.
- Learn: multiple casualty models, urban land-use density weighting, child/
  demographic breakouts, humanitarian POI counts, WSEG-10 time-varying fallout dose
  rate + shelter guidance, a 0.25 psi ring, and an open effects library (AWEL.js).
- Avoid: 2D-map-only framing and LandScan lock-in (use redistributable GHS-POP).

### Asteroid Launcher (neal.fun) / Purdue "Impact: Earth!"
- Does well: approachable presets, recurrence-interval honesty (Launcher); NASA/DHS-
  grade formula fidelity with a full consequence chain incl. ejecta thickness and
  seismic magnitude (Purdue).
- Learn: recurrence context, named impactor presets, dual simple/expert panels,
  extinction-scale range, and secondary/long-term effects.
- Avoid: Launcher's flat-plane, tsunami-free ocean impacts — that omission is
  literally Cataclysm's thesis (the #1 HN complaint about Launcher).

### Celeris-WebGPU / Tsunami-HySEA (2024-2026 solver state of the art)
- Does well: interactive GPU Boussinesq with breaking/runup (Celeris, 2025);
  spherical NLSW, nested grids, and dynamic wetting/drying at operational scale
  (HySEA).
- Learn: a two-tier standard/high-order model switch and the ML-surrogate-preview +
  full-solver-refine pattern resolve the interactivity-vs-fidelity tradeoff.
- Avoid: coupling credibility to one GPU path without a deterministic CPU parity
  gate; adopting GPL/HPC deps into the MIT desktop core.

### NASA Eyes on Asteroids / Worldview / OpenSpace / Earth Studio (globe UX)
- Does well: live NEO catalog with next-5 close approaches + countdown (Eyes);
  temporal scrubber + deep-linkable time/layer state + live "events" (Worldview);
  branchable scripted narrative flythroughs (OpenSpace); keyframe cinematic camera
  export (Earth Studio).
- Learn: guided lessons should be branchable OpenSpace-style scripts, not linear
  videos; ship a real temporal scrubber and deep-linkable state; NEO countdown with
  a "jump to Apophis 2029" hook (2029 = UN Year of Asteroid Awareness).
- Avoid: unrestricted content/profile systems before CSP/license/checksum
  enforcement.

### JPL SSD/CNEOS & USGS feeds (authoritative live data)
- Does well: free, keyless JSON APIs — JPL SBDB/CAD/Fireball/Sentry; USGS real-time
  quake GeoJSON/FDSN + ShakeMap + PAGER.
- Learn: a **desktop Tauri app is the ideal client** — JPL's CORS/rate rules block
  websites but not a local cache; seed real events and benchmark casualty estimates
  against official PAGER output.
- Avoid: presenting any pulled catalog object as a live warning or a risk claim
  without the authoritative risk field.

## Security, Privacy, and Reliability

Fresh audit of the current tree (v0.10.0): **no P0/P1 issues.** The previous pass's
verified defects (CSV injection, silent settings writes, non-transactional import,
mixed hazard state, global cancellation, ephemeral crash evidence) are shipped-fixed
or covered by still-open roadmap items. Remaining, lower-severity findings:

- **Verified (P2) — read-path trust gap:** `src/lib/settings.ts` `readScenarios`
  returns stored records with only an `Array.isArray` check; a corrupted/tampered
  store or schema change flows unvalidated data to the UI. Validate on read.
- **Verified (P2) — validation-bound divergence:** `src/lib/scenario-schema.ts`
  (`mw` [5,10], `rake` [-180,180]) vs `src-tauri/src/commands.rs`
  `earthquake_initial_conditions` (`mw` [4.0,10.5], no `rake` range check). Derive
  both from one table.
- **Verified (P3) — dead cancellation registration:** `api.simulateGrid`
  (`src/lib/tauri.ts` ~L275) discards its `run_id`, so the non-streaming
  `simulate_grid` path cannot be cancelled. Return the id or drop the registration.
- **Verified (P3) — no listener teardown:** `LogViewer.installTauriDiagnosticsListener`
  never captures its unlisten handle (intentional singleton; harmless but untestable).
- **Missing guardrails (already roadmapped, still open):** per-run memory/concurrency
  admission budget; transactional settings import with schema rejection; persisted
  redacted crash evidence + reset-visual-settings recovery; reduced Tauri capability
  surface. These remain valid; do not re-file.
- **Reliability opportunity:** casualties are exact integers from a uniform density
  scalar — false precision (covered by the open "honest uncertainty" item plus the
  new population-grid item).

## Architecture Assessment

- **Physics authority is clean.** Rust owns all results; the checksummed renderer
  protocol (`src-tauri/src/render_protocol/**`) and lifecycle-owned Cesium hosts
  (`src/render/cesium/**`) are well-bounded with leak-cycle tests. No refactor
  needed here.
- **Casualty model is the weakest scientific surface.** `direct_hazard.rs`
  `nuclear_casualties` blends blast/thermal/radiation over ring areas times one flat
  density; it lacks a real population source, alternative models, and a sub-1-psi
  band. Address via the three new casualty items (density grid, model picker,
  0.25 psi ring).
- **Overlays ignore terrain.** Analytical overlays clamp to the ellipsoid; adopting
  Cesium 1.135 `Cesium3DTilesTerrainProvider` for draping is a bounded, near-term
  correctness/legibility win distinct from the P1 hyper-real HR-13 terrain work.
- **Live-data adapters are absent.** No JPL/USGS/GIBS client exists; a cached,
  offline-first feed adapter is a reusable module that unlocks NEO discovery
  (already roadmapped) and USGS seeding (new).
- **Refactors already covered — do not duplicate:** commands.rs modularization,
  GeoJsonPrimitive overlay port, WASM physics, spherical SWE metrics, run
  identity/admission, transactional settings, typed async states, Layers controller,
  product-truth gate, offline Earth packs, i18n, HazEL browser, meteotsunami, NTHMP
  benchmarks, Zarr, humanitarian OSM layer, cinematic Earth/ocean/effects. All are
  open in ROADMAP.md and remain valid.
- **Test/doc gaps (new):** no read-path scenario-validation fixture; no
  front/back bounds-parity test; no casualty-vs-real-density regression; no
  provenance/SBOM release artifact; no winget manifest.

## Rejected Ideas

- **Missile-exchange / WW3 / MIRV modes — deprioritized, not net-new.** Valuable
  (MISSILEMAP) but already tracked as UNI-11/UNI-12; not re-filed. Source:
  https://nuclearsecrecy.com/missilemap/.
- **Live weather-driven fallout plume — deferred.** Compelling (NUKEMAP) but
  contradicts local-first/offline determinism unless done as an optional cached
  adapter; the WSEG-10 time-dose item delivers most of the educational value
  offline first.
- **Gaussian-splat photoreal cities — deferred to hyper-real track.** Cesium 1.135
  supports it, but it belongs to the existing HR-10..HR-13 cinematic program, not a
  separate near-term item.
- **Operational warning/evacuation product — rejected (unchanged).** Preserve the
  educational boundary; NOAA/PTWC/NTWC own live warnings.
- **Mobile UI — rejected (unchanged).** Owner requires desktop-only.
- **Cloud-only or GitHub-Actions build/provenance — rejected.** Per repo policy,
  provenance/SBOM must be generated locally, not via CI.
- **Full ML/PINN replacement of the SWE solver — rejected.** A surrogate is a
  preview accelerator only; the Rust solver stays authoritative (the surrogate item
  is explicitly preview-then-refine). Source: https://arxiv.org/html/2406.16236v1.
- **Real-time multi-user editing, arbitrary runtime plugins — rejected (unchanged).**

## Sources

### Direct competitors and community signal
- https://blog.nuclearsecrecy.com/2026/02/10/nukemap-roadmap/
- https://nuclearsecrecy.com/missilemap/
- https://outrider.org/nuclear-weapons/interactive/bomb-blast
- https://neal.fun/asteroid-launcher/
- https://www.purdue.edu/impactearth/
- https://news.ycombinator.com/item?id=33870612
- https://steamcommunity.com/app/230290/discussions/

### Solver fidelity and techniques (2024-2026)
- https://github.com/plynett/plynett.github.io
- https://ascelibrary.org/doi/10.1061/JWPED5.WWENG-2370
- https://www.researchgate.net/publication/277757438
- https://gmd.copernicus.org/articles/19/3953/2026/
- https://nhess.copernicus.org/articles/25/1655/2025/
- https://academic.oup.com/gji/article/238/1/382/7657823
- https://www.sciencedirect.com/science/article/pii/S0094576517314996

### Globe UX and rendering
- https://cesium.com/blog/2025/11/03/cesium-releases-in-november-2025/
- https://cesium.com/blog/2025/06/30/draping-imagery-over-3d-tiles-in-cesiumjs/
- https://www.openspaceproject.com/
- https://earth.google.com/studio/docs/making-animations/keyframes/
- https://www.earthdata.nasa.gov/data/tools/worldview
- https://eyes.nasa.gov/apps/asteroids/

### Data sources / APIs
- https://ssd-api.jpl.nasa.gov/
- https://earthquake.usgs.gov/earthquakes/feed/
- https://nctr.pmel.noaa.gov/propagation-database.html
- https://www.gebco.net/data-products-gridded-bathymetry-data/gebco2024-grid
- https://human-settlement.emergency.copernicus.eu/ghs_pop2023.php
- https://protomaps.com/

### Distribution / trust (unsigned app)
- https://slsa.dev/spec/v1.0/distributing-provenance
- https://v2.tauri.app/distribute/
- https://v2.tauri.app/security/capabilities/
- https://owasp.org/www-community/attacks/CSV_Injection

## Open Questions

- **Population-grid packaging size.** A global GHS-POP density raster is large;
  which resolution ships bundled vs. an optional download? (Blocks the casualty-
  density item's asset decision, analogous to the blocked GEBCO hosting choice.)
- No other question blocks prioritization or implementation. Code-signing
  credentials and updater endpoints remain external blockers already recorded in
  `Roadmap_Blocked.md`.
