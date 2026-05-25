# TsunamiSimulator Roadmap

Phased delivery plan. Each phase ends with a working, demoable artifact.

---

> Detailed evidence-backed plan + competitive research lives in
> [`RESEARCH_FEATURE_PLAN.md`](./RESEARCH_FEATURE_PLAN.md). Per-item granular
> checklist lives in [`TODO.md`](./TODO.md).

## Phase 0 — Scaffold ✅ (v0.0.1 — 2026-05-24)

- [x] Repo skeleton, LICENSE, README, CHANGELOG, ROADMAP
- [x] Tauri 2 + React 19 + Vite + TypeScript frontend boots
- [x] Rust backend compiles with all physics modules stubbed-but-numerically-correct
- [x] Preset registry populated with peer-reviewed parameters for 10 events
- [x] Catppuccin Mocha theme tokens
- [x] Cesium ion token plumbing via `.env`

## Phase 1 — Globe + Initial Conditions ✅ (v0.1.0 — 2026-05-25)

**DoD:** User clicks a preset, sees the globe fly to the impact site, watches the initial cavity / fault displacement render as a colored disc, and reads the calculated peak wave amplitude.

- [x] CesiumJS globe mounted in React, Cesium World Bathymetry (GEBCO) terrain provider loaded asynchronously
- [x] Camera fly-to on preset / scenario coordinates (range clamped 0.5 Mm – 8 Mm)
- [x] Initial water-surface displacement rendered as a 3D Cesium cylinder (height = cavity_depth via Ward–Asphaug parabola), translucent with amplitude-mapped color
- [x] All four `physics::*::initial_conditions()` invoked from frontend via `tauri::invoke`, results piped into the scene
- [x] Scenario builder: tabbed Asteroid / Nuclear / Earthquake / Landslide forms; click-globe-to-pick location
- [x] Preset selector showing all 11 events (Krakatoa 1883 added) with one-line description; speculative flagged with ⚠
- [x] Results panel: cavity radius, cavity depth, energy (J + Mt TNT), seismic-equivalent magnitude, peak amplitude
- [x] Settings modal: Cesium ion token + theme; first-run disclaimer; in-app citations modal with peer-reviewed links
- [x] CI/CD pipeline (3 OS matrix); release workflow with workflow_dispatch and signed-installer-ready artifact upload; Dependabot; cargo-audit

## Phase 2 — Linear Long-Wave Propagation ✅ (v0.2.0 — 2026-05-25)

**DoD:** Hit `Simulate`, see a propagating wavefront ring expand across the globe over simulated minutes, with amplitude decreasing as `r^(-5/6)` (Ward–Asphaug) or `r^(-1/2)` (point-source) depending on source type.

- [x] Regular lat-lon grid in Rust with row-parallel leapfrog (`rayon::par_chunks_mut`)
- [x] Linear long-wave dispersion `c = √(gh)` using local bathymetry `h`
- [x] Leapfrog time-stepping with CFL-safe Δt (`recommended_dt_s(cfl)`)
- [x] `rayon` parallelism for both continuity + momentum updates
- [x] Snapshot fields serialised as base64 PNG + bbox; frontend renders via Cesium `SingleTileImageryProvider`
- [x] Per-snapshot scrubber in the right-rail SwePlayback component
- [x] Coastal-runup overlay (F6) computes Synolakis 1987 runup at 60 named coastal points
- [x] DART buoy historical overlay (F8) compares model vs. observed water-surface elevation
- [x] Side-by-side comparison mode (F7) runs two scenarios with synchronized timeline
- [x] Multi-globe-style selector — OSM (default no-token), Esri Imagery, Natural Earth, Cesium World Imagery + Bathymetry
- [x] App is fully usable without any Cesium ion token

## Phase 3 — Coastal Runup + All Presets (v0.3.0)

**DoD:** Each of the 10 presets reproduces its peer-reviewed peak runup ±50% at characteristic coastal points (Chicxulub North Atlantic 10 m, Tōhoku 40 m, Lituya 524 m within its bay).

- [ ] Synolakis 1987 runup applied at every coastal grid cell where the wave arrives
- [ ] Slope and offshore depth sampled from GEBCO at each runup point
- [ ] Coastal point database (~100 named locations, lat/lon/slope/offshore-depth-50m)
- [ ] Runup bars rendered as Cesium 3D extruded polygons at coastline
- [ ] Lituya Bay special case (confined fjord — needs landslide-specific Slingerland scaling, not Synolakis)
- [ ] Earthquake source via Okada 1985 (replaces seafloor-displacement placeholder)
- [ ] Submarine landslide source (Watts et al. 2005 wavemaker boundary)

## Phase 4 — GPU + Nonlinear (v0.4.0)

**DoD:** 10× the grid resolution at 60 FPS playback. NSWE shows wave steepening and breaking near coasts.

- [ ] `wgpu` compute pipeline for the SWE solver (cross-platform: D3D12/Vulkan/Metal/WebGPU)
- [ ] Nonlinear shallow-water equations with Manning bottom friction `n=0.025`
- [ ] Wet/dry cell handling for inundation
- [ ] Inundation polygons as GeoJSON overlays on Cesium

## Phase 5 — Boussinesq + AMR (v0.5.0)

**DoD:** Chicxulub simulation matches Range et al. 2022 AGU Advances wave heights to within 25% at the named coastal sample points.

- [ ] Boussinesq dispersive terms — critical for impact-tsunami short wavelengths where ω √(h/g) > 0.3
- [ ] Adaptive mesh refinement (AMR) — coarse far-field, fine coastal patches
- [ ] Validation harness comparing to published peer-reviewed simulations

## Phase 6 — UX Polish + Release (v1.0.0)

**DoD:** A non-expert can pick "Chicxulub" from the menu, hit play, and understand what they're seeing without reading the manual.

- [ ] Onboarding overlay explaining what's real vs approximate
- [ ] Side-by-side comparison mode (2 scenarios, synchronized timelines)
- [ ] PNG / MP4 export of animation
- [ ] Signed Windows installer + macOS .dmg + Linux AppImage via GitHub Actions
- [ ] `assets/screenshots/` regenerated and embedded in README
- [ ] User manual under `docs/`

## Future / Stretch

- **Volcanic caldera collapse** source — Krakatoa, Hunga Tonga full physics (Lamb-wave atmospheric coupling for Hunga Tonga)
- **Cumbre Vieja flank-collapse scenario** with the Ward & Day 2001 worst case alongside the Pararas-Carayannis rebuttal — let the user see both
- **Multi-event scenarios** — Chicxulub debris re-entry secondary impacts, Tōhoku aftershock tsunamis
- **Offline mode** with bundled tile cache (1–2 GB low-res world bathymetry shipped in installer)
- **Comparison overlay** with NOAA DART buoy real arrival times for the 4 modern presets
- **Multi-language** UI (en/ja first — Tōhoku audience)
