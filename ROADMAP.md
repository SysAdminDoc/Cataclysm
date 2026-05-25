# TsunamiSimulator Roadmap

Phased delivery plan. Each phase ends with a working, demoable artifact.

---

## Phase 0 — Scaffold ✅ (v0.0.1 — 2026-05-24)

- [x] Repo skeleton, LICENSE, README, CHANGELOG, ROADMAP
- [x] Tauri 2 + React 19 + Vite + TypeScript frontend boots
- [x] Rust backend compiles with all physics modules stubbed-but-numerically-correct
- [x] Preset registry populated with peer-reviewed parameters for 10 events
- [x] Catppuccin Mocha theme tokens
- [x] Cesium ion token plumbing via `.env`

## Phase 1 — Globe + Initial Conditions (v0.1.0)

**DoD:** User clicks a preset, sees the globe fly to the impact site, watches the initial cavity / fault displacement render as a colored disc, and reads the calculated peak wave amplitude.

- [ ] CesiumJS globe mounted in React, GEBCO World Bathymetry terrain provider loaded
- [ ] Camera fly-to on preset / scenario coordinates
- [ ] Initial water-surface displacement rendered as a Cesium entity (cylinder/disc with height = cavity depth, color ramp by amplitude)
- [ ] `physics::asteroid::cavity_geometry()` invoked from frontend via `tauri::invoke`, results piped into the scene
- [ ] Scenario builder form: lat/lon picker (click globe), impactor diameter, density, velocity, angle, target=water/land
- [ ] Preset dropdown showing all 10 events with one-line description
- [ ] Results panel: cavity radius, cavity depth, energy (J + Mt TNT), seismic-equivalent magnitude, peak amplitude at 100 km / 1000 km

## Phase 2 — Linear Long-Wave Propagation (v0.2.0)

**DoD:** Hit `Simulate`, see a propagating wavefront ring expand across the globe over simulated minutes, with amplitude decreasing as `r^(-5/6)` (Ward–Asphaug) or `r^(-1/2)` (point-source) depending on source type.

- [ ] Regular lat-lon grid in Rust (`ndarray` or `nalgebra`) with `1/cos(φ)` spherical metric
- [ ] Linear long-wave dispersion `c = √(gh)` using local bathymetry `h`
- [ ] FTCS or leapfrog time-stepping, CFL-stable Δt
- [ ] `rayon` parallelism for grid updates
- [ ] Wavefront extracted as polylines, streamed to frontend as GeoJSON every N timesteps
- [ ] Cesium animation timeline driving playback (1×, 10×, 100×, 1000× real-time)
- [ ] Coastal arrival-time isochrones overlay

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
