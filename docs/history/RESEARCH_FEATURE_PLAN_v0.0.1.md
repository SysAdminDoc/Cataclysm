# Project Research and Feature Plan

> **Status:** Companion to `ROADMAP.md`. `ROADMAP.md` is the canonical *what/when* phased plan. This document is the *why/evidence/competitive* research backing it, written so a coding agent can implement features without re-doing the research. Last updated 2026-05-24, against repo state at commit `91c360c`.

---

## Executive Summary

`TsunamiSimulator` is a v0.0.1 scaffold of a desktop application (Tauri 2 + React 19 + TypeScript + Vite frontend, Rust backend with CesiumJS globe) that aims to combine **NOAA-grade tsunami physics** with **NukeMap-grade consumer UX** in a single offline-capable installable app. The current shape is exceptionally strong as a foundation: all source-physics formulas (asteroid, nuclear, landslide, earthquake) are encoded with peer-reviewed citations in `src-tauri/src/physics/`, ten historical presets are wired with literature-derived parameters in `src-tauri/src/presets.rs`, and the React UI is themed and laid out for the three-pane production workflow (presets / globe / scenario+results). But the project does **not yet propagate a wave** — `physics::shallow_water::sample_wavefront` is an analytical decay sampler, not a finite-volume solver — and `tauri build` will fail today because `src-tauri/icons/` is empty.

Competitive research confirms the positioning gap is real and exploitable: no existing product combines an interactive 3D globe, GPU-class real-time SWE compute, multiple source types (asteroid + nuke + earthquake + landslide + volcanic) in one app, and offline operation. NukeMap (Wellerstein) is web-only and single-source. Asteroid Launcher (Agarwal) has gorgeous animation but no peer-reviewed wave propagation. NOAA MOST / GeoClaw / FUNWAVE-TVD are operational-grade but batch-mode, server-bound, and Fortran/Python-only. The 2022 Hunga Tonga atmospheric Lamb-wave coupling research (Carvajal 2022, Matoza 2022, Kubota 2022) and the GPU-accelerated GeoClaw paper (Qin 2019, 3.6–6.4× speedup) are public-domain advances that this project can incorporate.

**Top 10 priorities** (ranked by user value × evidence strength × feasibility):

1. **P0 — Ship a runnable Tauri build** (generate icons, fix the bundle config, document the MSVC prerequisite, get CI green).
2. **P0 — Replace `sample_wavefront` with a real GPU shallow-water solver** via `wgpu` compute shaders on a regular lat-lon grid (BROWNI architecture, wgpu validated for compute in 2024+).
3. **P0 — Wire the Cesium globe to render initial displacement and time-stepped wavefront** so a preset click → camera fly-to → animated wave is the actual experience, not the printed readout it is today.
4. **P1 — Cesium token UX**: stop shipping the token in the bundle (`.env` is currently a security/cost footgun for open-source). Settings UI + `app_data_dir` storage at first launch.
5. **P1 — Bundle GEBCO/SRTM15+ bathymetry for offline mode** — both are public-domain at 15-arc-sec, ~300 MB compressed (BODC + Sandwell), removes Cesium ion dependency for the physics path.
6. **P1 — Synolakis runup + named coastal-point database overlaid on the globe** as runup bars (NOAA MOST gauge concept, but rendered as 3D extruded polygons; data targets: Range 2022 Chicxulub, Tōhoku Miyako 40 m, Lituya 524 m).
7. **P1 — Real Okada 1985 dislocation** to replace the Geist–Dmowska M_w empirical placeholder — operational tools all do this; without it the Tōhoku/Sumatra presets are toys.
8. **P2 — DART buoy historical overlay** for the four modern presets (Tōhoku, Indian Ocean, Hunga Tonga, plus arrival times). NOAA NCEI hosts the time series; turn validation into a UI feature.
9. **P2 — Hunga Tonga atmospheric Lamb-wave source** — research-frontier physics that no consumer tool has and only JAGURS has operationally; gives the project a unique "we model the new stuff" angle.
10. **P2 — Side-by-side comparison mode** (synchronized timelines, two scenarios) — directly serves the project's pedagogical case (Poseidon-propaganda vs realistic, Cumbre Vieja Ward-Day vs Løvholt-rebuttal, Chicxulub vs modern Tōhoku scale).

---

## Evidence Reviewed

### Local files inspected (full read, this session)
- Repo root: `LICENSE`, `.gitignore`, `README.md`, `CHANGELOG.md`, `ROADMAP.md`, `CLAUDE.md`, `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `index.html`, `.env.example`
- Frontend: `src/main.tsx`, `src/App.tsx`, `src/styles.css`, `src/vite-env.d.ts`, `src/types/scenario.ts`, `src/lib/cesium.ts`, `src/lib/tauri.ts`, `src/components/Globe.tsx`, `src/components/PresetSelector.tsx`, `src/components/ScenarioBuilder.tsx`, `src/components/ResultsPanel.tsx`
- Backend: `src-tauri/Cargo.toml`, `src-tauri/build.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/icons/README.md`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/presets.rs`, `src-tauri/src/physics/{mod,constants,asteroid,nuclear,landslide,earthquake,shallow_water}.rs`
- Docs / data: `docs/science/README.md`, `docs/science/REFERENCES.bib`, `data/bathymetry/README.md`, `src-tauri/icons/README.md`
- Build verification: `npm install` (136 pkgs, clean), `npx tsc --noEmit` (clean), `npx vite build` (4.35 MB bundle, success), `cargo check` (FAIL — host missing MSVC C++ build tools)

### Git history
- `91c360c` (HEAD on `main`) — TsunamiSimulator v0.0.1 — scaffold. Single commit on initial repo. Branch protection enabled on `main` (enforce_admins=true). Repo is PUBLIC.

### External sources (researched in depth this session; see also full notes in [/tmp/research.md] from research subagent)
- **NUKEMAP** — https://nuclearsecrecy.com/nukemap/ + FAQ. Methodology: Glasstone-Dolan 1977, Kingery-Bulmash overpressure, LandScan 2011 population. Closed source, web-only.
- **MISSILEMAP** — https://nuclearsecrecy.com/missilemap/. Trajectory + CEP visualization. Google Maps API.
- **Asteroid Launcher (Neal Agarwal)** — https://neal.fun/asteroid-launcher/. Inputs: composition / diameter (1 m–1.6 km) / velocity / angle. Outputs: crater / shockwave / thermal / wind / earthquake / tsunami. Apple Maps. Closed source.
- **Purdue Impact:Earth!** — https://impact.ese.ic.ac.uk/ImpactEarth/. Collins–Melosh–Marcus 2005 formulas. Numerical-only output.
- **NOAA MOST / ComMIT** — https://nctr.pmel.noaa.gov/ComMIT/. Operational; linear SWE; Okada source; KMZ export.
- **GeoClaw** — https://www.clawpack.org/. Open source (BSD), Fortran 90 + Python, AMR, CUDA variant (Qin et al. 2019 https://arxiv.org/abs/1901.06798) — 3.6–6.4× on single GPU vs. 16-core CPU.
- **COMCOT** — https://www.gns.cri.nz/.../comcot/. Cornell origin, GNS NZ maintained. Multiple source types incl. landslide.
- **ANUGA** — https://github.com/GeoscienceAustralia/anuga_core. GPL, finite-volume on unstructured triangles, wetting/drying. Python + Cython.
- **FUNWAVE-TVD** — https://fengyanshi.github.io/build/html/. Boussinesq, USACE-approved, dispersive. Fortran 90.
- **JAGURS** — Sci Adv https://www.science.org/doi/10.1126/sciadv.adf5493. Operational at JMA. Post-2022 atmospheric Lamb wave coupling.
- **BROWNI** — Andrés 2021 *Computers & Geosciences* 150:104744, https://www.sciencedirect.com/science/article/abs/pii/S0098300421002600. Browser GPU SWE, ~30 fps at 1000×500 cells.
- **NHWAVE / SWASH** — 3D non-hydrostatic.
- **Cesium ion pricing** — https://cesium.com/platform/cesium-ion/pricing/. Free tier 5 GB storage / 15 GB/month bandwidth, **NON-COMMERCIAL**. $149+/month for commercial. Cannot redistribute. Cannot cache for offline.
- **GEBCO 2024** — https://www.gebco.net/data-products-gridded-bathymetry-data/gebco2024-grid. 15-arcsec NetCDF, ~80 MB compressed, public domain (BODC).
- **ETOPO 2022** — https://www.ncei.noaa.gov/products/etopo-global-relief-model. NOAA, public domain, ~600 MB.
- **SRTM15+ V2.6** (Tozer/Sandwell 2019) — https://portal.opentopography.org/. 15-arcsec, CC-BY 4.0.
- **Natural Earth coastlines** — https://www.naturalearthdata.com/. Public domain, ~10 MB vector.
- **Blue Marble Next Generation** — https://neo.gsfc.nasa.gov/view.php?datasetId=BlueMarbleNG. NASA, 500 m, public domain.
- **wgpu (Rust)** — https://github.com/gfx-rs/wgpu. Cross-platform (D3D12 / Vulkan / Metal / WebGPU / OpenGL). MIT/Apache 2.0. Compute stable since 2024.
- **Burn + CubeCL** (Rust ML/compute) — https://github.com/tracel-ai/burn. CUDA/ROCm/WGSL backends. MIT/Apache 2.0.
- **WebGPU shallow-water examples** — https://github.com/lisyarus/webgpu-shallow-water, https://github.com/piellardj/water-webgpu.
- **Range et al. 2022 Chicxulub** — *AGU Advances* 3:e2021AV000627. 4.5 km initial wave, 1.5 km @ 220 km, 30,000× 2004 IOT energy.
- **Carvajal et al. 2022 Hunga Tonga** — *Science* 377:91. Lamb wave–ocean coupling at 3.6 mHz spectral peak.
- **Kubota et al. 2022 Tonga Lamb** — *GRL* 49:e2022GL098752.
- **Kim et al. 2019 Storegga** — *JGR-Oceans* 124:3607. Volume 1700 km³, average velocity 35 m/s.
- **Ward & Day 2001 / Løvholt 2008 Cumbre Vieja** — original 500 km³ catastrophic claim vs. dispersive-Boussinesq rebuttal (3–8 m Atlantic).
- **Gersonde et al. 1997 Eltanin** — *Nature* 390:357.
- **NOAA DART** — https://www.ndbc.noaa.gov/dart/dart.shtml + https://nctr.pmel.noaa.gov/Dart/about-dart.html. Real-time pressure recorders; NetCDF time-series archive at NCEI.
- **NOAA Science On a Sphere — Chicxulub** — https://sos.noaa.gov/catalog/datasets/tsunami-asteroid-impact-66-million-years-ago/. Pre-computed propagation, spherical projection, play/pause/scrub UX template.
- **Cesium Stories / CZML** — https://cesium.com/blog/2020/03/04/time-dynamic-stories/. Time-tagged entity playback model.

### Could not verify (this session)
- **`cargo check`** — VS Build Tools "Desktop development with C++" workload is not installed on this host. The Rust code is syntactically reviewed but not compiler-verified. Verification deferred to a host with MSVC link.exe present, or to GitHub Actions Windows runner (see roadmap R3).
- **Cesium ion token live behavior** — `.env.example` is empty; haven't run the app end-to-end with a real token to confirm the GEBCO tileset streams correctly or that the CSP allows the `*.cesium.com` host without an `'unsafe-eval'` console warning. Needs live validation.
- **Tauri `npm run tauri build`** — gated on the MSVC + icon issues; bundle output not produced.

---

## Current Product Map

### Core workflows (today, as scaffolded)
1. **Preset playback** — user clicks a preset card in the left rail → frontend `useEffect` in `App.tsx:55-69` calls `api.runPreset({...})` → Rust returns `{preset, initial, wavefront}` → `Globe.tsx` draws a source point + cavity disc + concentric wavefront ellipses → `ResultsPanel` shows energy / cavity / amplitude / M_w / wavelength → timeline slider re-fires the IPC call on every drag.
2. **Custom asteroid scenario** — user fills the `ScenarioBuilder` form → click "Simulate Impact" → `App.tsx:71-104` calls `api.asteroidInitialConditions(input)` → globe re-renders. Earthquake, nuclear, and landslide scenarios are NOT yet exposed in the UI even though the Rust commands exist.
3. **Browser preview fallback** — `App.tsx:42-46` detects non-Tauri context (via `isTauri()` checking `window.__TAURI_INTERNALS__`) and serves a single mocked Chicxulub preset + inline asteroid math. Allows `npm run dev` previews without the Rust backend.

### Existing surface features
| Surface | Code location | Triggers |
|---|---|---|
| Preset selector (10 events) | `src/components/PresetSelector.tsx`, data from `src-tauri/src/presets.rs::all_presets()` | Card click |
| Scenario builder (asteroid only) | `src/components/ScenarioBuilder.tsx` | Form submit |
| Results panel | `src/components/ResultsPanel.tsx` | Reactive on `initial` prop |
| Timeline slider (0–6 h, 60 s step) | `ResultsPanel.tsx:60-78` | Drag → fires `run_preset` re-call |
| Cesium globe with optional GEBCO bathymetry | `src/components/Globe.tsx`, `src/lib/cesium.ts` | Mount + props update |
| Catppuccin Mocha theme tokens | `src/styles.css:1-32` | Always |
| Cesium token gate | `Globe.tsx:128-145` | Falls back to friendly empty state when `VITE_CESIUM_TOKEN` missing |

### Existing backend (Rust) surface
| Tauri command | Location | Status |
|---|---|---|
| `asteroid_initial_conditions` | `commands.rs:18-21` | Working — Ward-Asphaug + Schmidt-Holsapple |
| `nuclear_initial_conditions` | `commands.rs:23-26` | Working — Glasstone-Dolan + Le Méhauté |
| `landslide_initial_conditions` | `commands.rs:28-31` | Working — Heller-Hager (subaerial) + Watts (submarine) |
| `earthquake_initial_conditions` | `commands.rs:33-36` | Stub — Geist-Dmowska M_w → uplift empirical; Okada planned |
| `far_field_amplitude` | `commands.rs:54-66` | Working — selects impact `r^(-5/6)` vs nuclear `r^(-1)` decay |
| `coastal_runup` | `commands.rs:75-78` | Working — Synolakis 1987 closed form |
| `list_presets` | `commands.rs:80-83` | Working |
| `run_preset` | `commands.rs:103-124` | Working but only samples the analytical wavefront, not a real solver |

### Personas (inferred from `README.md` + `ROADMAP.md` + author profile)
- **Curious public** — wants to "see Chicxulub" or "see what Poseidon really does". NukeMap-style audience.
- **Educators (high-school earth-science, undergrad geophysics)** — wants to project an animation in class; needs play/pause/scrub + permalink-to-scenario.
- **Hazard researchers** — wants peer-reviewed defaults + ability to set custom Okada or landslide parameters + import/export NetCDF. Currently underserved beyond preset playback.
- **Tsunami warning trainees** — secondary audience; wants Tōhoku/Sumatra/Cascadia scenarios with DART comparison.

### Platforms / distribution
- Currently builds for **Windows / macOS / Linux** through Tauri 2 (`bundle.targets: "all"` in `tauri.conf.json:33`), but **no binary is produced** — `src-tauri/icons/` is empty so `tauri build` fails immediately; no GitHub Actions release workflow exists; no signing configured.

### Permissions / network / storage
- **Capabilities** (`src-tauri/capabilities/default.json`): `core:default` + `shell:allow-open` (for opening citation URLs).
- **CSP** (`tauri.conf.json:28`): Allows `https://*.cesium.com`, `https://*.ion.cesium.com`, `https://*.openstreetmap.org` in `img-src` and `connect-src`. Permits `'unsafe-eval'` and `'unsafe-inline'` in `script-src` (required by Cesium's WebAssembly tile decoder — known upstream limitation).
- **Network calls**: Cesium ion REST for World Bathymetry tiles + base imagery (only when `VITE_CESIUM_TOKEN` set). No telemetry. No analytics.
- **Storage**: None today. No settings file, no scenario save, no offline tile cache.

---

## Feature Inventory

### 1. Asteroid impact source (Ward-Asphaug + Schmidt-Holsapple)
- **User value**: The flagship source; powers Chicxulub, Eltanin, custom scenarios.
- **Entry point**: Preset card → `run_preset` IPC, OR scenario form → `asteroid_initial_conditions` IPC.
- **Code**: `src-tauri/src/physics/asteroid.rs:1-227` (formula + `initial_displacement()` + `far_field_amplitude_m()`).
- **Maturity**: Complete for point-source readout. **Verified** by two unit tests (Chicxulub cavity ∈ [10,120] km radius; 1 km Atlantic far-field ∈ [10,500] m at 6000 km).
- **Tests/docs**: 2 in-file `#[cfg(test)]` unit tests; full citation block in module docstring; cited in `docs/science/REFERENCES.bib` (ward2000asteroid, schmidt1982estimates, collins2005earth, range2022chicxulub).
- **Improvement opportunities**:
  - `initial_amplitude_m()` uses `0.5 * cavity_depth` — Ward-Asphaug fig. 3 shows the rim wave is 0.3–0.5× depending on cavity steepness. The 0.5 is the upper bound; document this in the docstring and allow override.
  - No coupling to *ejecta*-driven wave (the 4.5 km Range 2022 "initial wall" is ejecta, not rim — we only model the rim).
  - No oblique-impact asymmetry (sin θ^(1/3) is the only angle correction; real impacts have downrange/uprange wave asymmetry per Wünnemann 2014).
  - No atmospheric ablation correction for small impactors that burn up.

### 2. Nuclear burst source (Glasstone-Dolan + Le Méhauté + DNA 5% efficiency)
- **User value**: Drives the Poseidon-realistic/propaganda contrast — a marquee educational feature.
- **Entry point**: Preset card; **no scenario builder UI yet** for custom nuclear bursts.
- **Code**: `src-tauri/src/physics/nuclear.rs:1-194`.
- **Maturity**: Complete for point-source. Verified by two unit tests (Tsar Bomba underwater @ 100 km < 20 m; Poseidon-propaganda @ 100 km < 50 m — both bound the propaganda check).
- **Tests/docs**: 2 unit tests. Full citation block.
- **Improvement opportunities**:
  - No surface-burst-specific wave model (Crossroads-Able vs Crossroads-Baker distinction is set by `BurstMode::Surface` scale factor 0.4, which is hand-tuned).
  - No fallout overlay (NUKEMAP has wind-advected Gaussian plume — could be added with NOAA HRRR meteorology).
  - The `_suppress_unused_mt_constant` function at `nuclear.rs:182-185` is dead code from an iteration cleanup; should be removed.

### 3. Landslide source (Heller-Hager + Watts)
- **User value**: Powers Lituya Bay (524 m runup), Storegga, Hunga Tonga (submarine), Cumbre Vieja scenario.
- **Entry point**: Preset card only; no scenario builder UI yet.
- **Code**: `src-tauri/src/physics/landslide.rs:1-186`.
- **Maturity**: Complete with one verified unit test (Lituya initial wave 10–500 m band).
- **Improvement opportunities**:
  - Submarine slide formula `0.0574 * water_depth * sin(slope) * V^(1/3) / 100` (line 105) is a hand-derivation hybrid of Watts 2003 + Kim 2019 — should be replaced with a clear citation-traceable form (Watts et al. 2005 eqn. 13 or Grilli 2002 wavemaker).
  - No retrogressive failure mechanics (Storegga was retrogressive per Kim 2019, but we treat it as monolithic).
  - No air-cushion effect for Lituya-class subaerial impacts (Fritz 2001 finds it minor but it's a parameter knob).

### 4. Earthquake source (Geist-Dmowska scaffold; Okada planned)
- **User value**: Tōhoku, Indian Ocean — the two presets most users will recognize.
- **Entry point**: Preset only.
- **Code**: `src-tauri/src/physics/earthquake.rs:1-141`.
- **Maturity**: **Stub / partial**. Uses `log(η_max) ≈ 0.5·M_w − 3.3` from Geist-Dmowska 1999. Real Okada-1985 fault dislocation is missing. The single unit test only verifies M_w→uplift OoM and long-wave speed at 4000 m → ~200 m/s.
- **Improvement opportunities**:
  - **Implement Okada 1985 fully** — closed-form elliptic-integral evaluations of surface displacement from a rectangular dislocation in an elastic half-space. Reference implementation: NOAA `okada92.f` (Fortran), USGS `okada_wrapper` Python, or Rust port from scratch. The struct already has `strike_deg`/`dip_deg`/`rake_deg`/`slip_m`/`fault_length_m`/`fault_width_m` fields ready to receive — but `fault_length` and `fault_width` are MISSING from `EarthquakeSource` (`earthquake.rs:33-46`) — only `slip_m` is stored. Fix the struct, then implement.
  - Tanioka-Satake 1996 horizontal-displacement correction matters for shallow dips like Tōhoku.

### 5. Shallow-water propagation (linear long-wave sampler — NOT a solver)
- **User value**: This is the wavefront the user sees animate.
- **Entry point**: `run_preset` calls `sample_wavefront` at each requested time.
- **Code**: `src-tauri/src/physics/shallow_water.rs:74-104`.
- **Maturity**: **Partial / misleading**. `sample_wavefront` is an *analytical decay sampler* — it returns `A_0 · (R_c / r)^α` at log-spaced ranges from the source. It is NOT solving the shallow-water PDE. It does not see bathymetry. It does not handle landfall. The function is correctly documented as "cheap deep-ocean propagation sampler — this is sufficient for v0.0.1 — the v0.2.0 solver will replace this with a real grid-based integration" (`shallow_water.rs:80-82`), but the README/ROADMAP could be clearer that the "animated wavefront" in v0.0.1 is artistic not physical.
- **Improvement opportunities**: This is the **P0 work** of the whole project. See "Highest-Value New Features" §2.

### 6. Synolakis 1987 coastal runup
- **User value**: The bridge from offshore amplitude → inland runup height (e.g., the 524 m Lituya number, the 40 m Tōhoku Miyako number).
- **Entry point**: `coastal_runup` Tauri command. **Not invoked from the UI yet.**
- **Code**: `shallow_water.rs:51-61`. Formula `R/H₀ = 2.831 √(cot β) (H₀/d)^(5/4)`, clamped at H/d = 0.78 (breaking criterion).
- **Maturity**: Working closed-form. Single unit test confirms mild-slope amplification 3–10×.
- **Improvement opportunities**: Build a coastal-point database (~100 named points with lat/lon + beach slope + offshore depth), call `coastal_runup` per point per time step, render as 3D extruded bars on the globe at the coastline.

### 7. Preset registry
- **User value**: The "menu" — the curated content.
- **Code**: `src-tauri/src/presets.rs:1-152`. 10 events.
- **Maturity**: Complete for v0.0.1. Each preset cites a peer-reviewed source.
- **Improvement opportunities**:
  - **Cumbre Vieja scenario** has no inline disclaimer about it being a *disputed* hypothesis even though the blurb says "Ward & Day 2001 hypothesized" — should be stronger ("Subsequent peer review (Løvholt 2008) finds the 25 m claim exaggerated by 5–10×").
  - **Poseidon-propaganda** preset name is good but its `id: "poseidon_propaganda"` mixes editorial language into a stable identifier — fine but worth committing to.
  - **No 1755 Lisbon, no Krakatoa 1883, no Alaska 1964, no Cascadia AD 1700, no Aitape 1998, no Anak Krakatau 2018, no 2018 Sulawesi (submarine landslide), no 2023 Türkiye-Syria (no tsunami but seismic source).** The "10 events" claim in README mentions Krakatoa 1883 in the preset table but the actual code does NOT have a Krakatoa entry — this is a doc/code drift.

### 8. CesiumJS globe rendering
- **Code**: `src/components/Globe.tsx`, `src/lib/cesium.ts`.
- **Maturity**: Working scaffold but with several known gaps:
  - **`Globe.tsx:39-50` creates a Viewer with `terrain: undefined`** and asynchronously upgrades to `Cesium.createWorldBathymetryAsync()` if the token is present (`Globe.tsx:51-58`). No loading state while the bathymetry tileset loads.
  - **`Globe.tsx:120-133` rebuilds wavefront entities on every prop change** — no diff, just `remove` + `add` in a loop. For 32 rings × 1 fps timeline update this is fine; for a real solver streaming snapshots at 30 fps this will thrash the entity collection.
  - **`Globe.tsx` never destroys `sourceEntityRef.current` on unmount** beyond the implicit `viewer.destroy()` — fine in practice, but the `wavefrontEntitiesRef.current` array is also leaked across React StrictMode double-invocations. Add explicit cleanup on each effect.
  - **No camera reset / "fit to wave"** as the wavefront grows beyond the initial fly-to range.
- **Improvement opportunities**: See "UX/Accessibility/Trust" below.

### 9. Catppuccin Mocha theme tokens
- **Code**: `src/styles.css:1-32`.
- **Maturity**: Complete. All corner radii ∈ {4, 6, 8, 10, 12} per user's no-pill-backdrops global rule.
- **Improvement opportunities**: No light-mode theme yet (README claims "Light mode toggle" as a feature in `Features → UX → "Catppuccin Mocha default theme … Light mode toggle"` — but no toggle exists in code). Either add it (token swap is straightforward) or remove the README claim.

### 10. Tauri shell + Rust backend boot
- **Code**: `src-tauri/src/lib.rs:14-29`, `src-tauri/src/main.rs:1-7`, `src-tauri/Cargo.toml:1-37`.
- **Maturity**: Working scaffold; release profile configured with LTO + `panic = "abort"` + strip.
- **Improvement opportunities**:
  - No `tauri-plugin-store` for settings persistence.
  - No `tauri-plugin-fs` permission limits — `shell:allow-open` is permissive enough but worth tightening with an allowlist of known citation URLs (cesium.com, agupubs.onlinelibrary.wiley.com, etc.).
  - No `tauri-plugin-window-state` — window size/position not persisted across launches.
  - No `tauri-plugin-updater` — out-of-band update channel missing.

### Partial / hidden / stale / undocumented features
- **Hidden** — Nuclear, landslide, earthquake **scenario builders** don't exist in the UI. Their Tauri commands work; the React side just doesn't surface forms for them.
- **Stale** — README mentions "Krakatoa 1883" preset (`README.md:103`) but the code only has 10 presets and Krakatoa is not one of them (closest is `hunga_tonga_2022`).
- **Stale** — README mentions "Light mode toggle when practical" (`README.md:115`) — not implemented.
- **Stale** — README claims `physics::data::bathymetry::sample(lat, lon)` in Rust (`data/bathymetry/README.md:13`) — no such module exists yet.
- **Undocumented** — The browser-preview mock-physics shortcut in `App.tsx:71-95` duplicates the Schmidt-Holsapple formula in JavaScript with hand-coded constants — silent drift risk if the Rust formula changes.

---

## Competitive and Ecosystem Research

> Full annotated source notes from the research agent (4500+ words, 100+ citations) are preserved separately. The summary below is the *what to copy / what to avoid* synthesis.

### Direct consumer-facing competitors

| Product | Notable capabilities | What to copy | What to avoid |
|---|---|---|---|
| **NUKEMAP** (Wellerstein, 2012-) | LandScan 2011 population + casualty modeling; KMZ export; shareable URLs; rigorous FAQ documenting methodology and uncertainty; transparent citation of declassified data sources | Population/casualty overlay (use WorldPop or GHS-POP, both CC-BY); citation-rich FAQ as a UI surface (we have `docs/science/REFERENCES.bib` — make it user-visible); KMZ/CZML export; "uncertainty bars" in result readouts | Closed source; web-only; tied to Google Maps proprietary tiles |
| **MISSILEMAP** (Wellerstein) | Trajectory + CEP visualization; great-circle paths | Great-circle "would-reach-coast-by-T" arrival animation pattern | Trajectory modeling is out of scope for tsunami |
| **Asteroid Launcher** (Agarwal) | Cinematic animated impact; composition selector; population casualty rollup; one-click shareable scenarios | Cinematic animation aesthetic (we have Cesium 3D — go past their 2D); preset "memorable city" targets ("what if 14 km Chicxulub hit New York?"); simple shareable scenario URLs (deep links in Tauri are doable) | Closed source; physics is implied not cited; Apple Maps lock-in |
| **Purdue Impact:Earth!** (Collins-Melosh-Marcus 2005) | Most rigorous formulas; documents methodology page | Inline formula explanations (every result row should link to its derivation in `docs/science/`); seismic-equivalent Richter magnitude readout (we have it; expose it more) | Numerical-only output (no globe); no animation |

### Operational simulators (what we are *technically* closest to)

| Product | What we should learn | What we should NOT do |
|---|---|---|
| **NOAA MOST / ComMIT** | Three-phase model (generation / propagation / inundation); nested grids; KMZ export; pre-computed Cascadia / Aleutian / etc. scenarios as a content gallery; DART buoy assimilation | Don't aim for forecast-operational accuracy in v1.0 — that's a 10-year roadmap. Don't ship without a "NOT FOR EVACUATION" banner (we already have it in `App.tsx:113-115`). |
| **GeoClaw** (LeVeque, Berger, George, Mandli) | **AMR is the right scaling answer for global+coastal in one sim** (v0.5.0 roadmap item). GPU variant (Qin 2019) shows 3.6–6.4× speedup is realistic. NetCDF + VTK output for ParaView interop. | Fortran 90 makes contribution painful — Rust path is the right call. |
| **COMCOT** | Multi-source: fault / landslide / custom profile / wave maker | Don't replicate the legacy Fortran build pain (PCOMCOT .ctl files). |
| **ANUGA** | **Unstructured triangular mesh** is geometrically flexible for coastlines + buildings. Particle-tracking for debris/sediment. | We don't need GPL-3 entanglement; ANUGA is a reference, not a fork target. |
| **FUNWAVE-TVD** (Shi/Kirby) | Fully nonlinear Boussinesq — what we want for v0.5.0 dispersive solver. Wave breaking model. Coupled meteo-tsunami via atmospheric pressure forcing — relevant for Hunga Tonga. | Boussinesq is 10–100× slower than SWE per FUNWAVE docs — make it an *optional* solver toggle, not the default. |
| **JAGURS** (JMA) | Atmospheric Lamb wave coupling — published post-2022 Tonga. The "spectral match at 3.6 mHz" finding is novel physics. | Not open-source enough to fork from. |
| **NHWAVE / SWASH** | Full 3D non-hydrostatic — only for sub-km coastal domains. | Not the right tool for transoceanic; ignore. |
| **BROWNI** (Andrés 2021) | **Architecturally closest to what we want for the GPU solver**: linear SWE on WebGL compute, ~30 fps at global 1000×500 cells, validated against MOST. Open source (Apache 2). | Linear only; no inundation; we want more. |

### Globe rendering / data alternatives

| Option | Verdict for TsunamiSimulator |
|---|---|
| **CesiumJS + Cesium ion** (current) | Best 3D globe in browsers/WebViews, but pricing terms (commercial = $149+/mo, no offline cache, no redistribution) make it a long-term cost / freedom risk for an OSS desktop app. Acceptable for v0.0.1 baseline. |
| **CesiumJS + locally hosted tiles** | Self-host the GEBCO/SRTM15+ raster + Natural Earth coastlines as tiles bundled in the installer (or downloaded on first run). CesiumJS the library is Apache 2.0 — only the *ion data* requires a license. **This is the right offline path.** |
| **MapLibre GL JS v5 globe view** (Jan 2025+) | Production-ready in 2026. BSD 2-Clause. Lighter than Cesium. Vector tiles native. Globe support newer than Cesium's — viable migration target in v1.0 if Cesium ion economics bite. |
| **three-globe** + **three.js** | MIT. Good for point/arc overlays but needs custom shader work for bathymetric terrain. Treat as the *visualization layer* on top of a separate raster compositor — overengineering for v1.0. |
| **NASA WorldWind** | Still maintained as of 2025-26; less momentum than Cesium/MapLibre. Not a priority migration target. |

### Data alternatives (recommended bundling stack)
- **Bathymetry/topography**: SRTM15+ V2.6 (CC-BY 4.0, ~300 MB, fewer redistribution constraints than GEBCO) **OR** GEBCO 2024 (public domain, ~80 MB compressed). SRTM15+ preferred for explicit OSS licensing.
- **Coastlines**: Natural Earth 10m (`naturalearthdata.com`, public domain, ~10 MB).
- **Globe imagery**: Blue Marble Next Generation 2004 monthly (NASA, public domain, ~2 GB full year — ship just 1 month for ~170 MB).
- **Population (optional)**: WorldPop (CC-BY 4.0) or GHS-POP (CC-BY 4.0). 1 km global ≈ 200 MB.
- **Buildings (optional)**: OpenStreetMap (ODbL — must cite). Buildings only needed for coastal-inundation context in dense cities.

### GPU compute stack (recommended for v0.3.0+)
- **wgpu** (gfx-rs) — primary. Cross-platform Vulkan/D3D12/Metal/WebGPU. Compute stable 2024+. MIT/Apache 2.0. Multiple production users (Firefox WebGPU, Servo, Deno).
- **CubeCL** (in Burn ecosystem) — alternative DSL for compute kernels in Rust. Targets CUDA/ROCm/WGSL. More mature for ML-style kernels; SWE is simpler than ML so wgpu direct is preferred.
- **Reference implementations to study**: `lisyarus/webgpu-shallow-water` (TypeScript, virtual-pipes model); `piellardj/water-webgpu` (TypeScript, water rendering not SWE physics); Qin et al. 2019 CUDA GeoClaw (Fortran kernels in Bash AMR scaffold).

---

## Highest-Value New Features

> Format: each feature has Title / User Problem / Evidence / Proposed Behavior / Implementation Areas / Data-Model-API-UI Implications / Risks / Verification / Complexity (S/M/L/XL) / Priority (P0/P1/P2/P3).

### F1 — Cesium globe renders the source event correctly (Phase 1 of `ROADMAP.md`)
- **User problem**: A v0.0.1 user clicks "Chicxulub" expecting an animation; instead they get a numeric readout and four concentric thin lines. The product promise in `README.md` (NukeMap for tsunamis) is undelivered until this works.
- **Evidence**: `Globe.tsx:81-119` draws the source cavity and label but the wavefront is just rings (`Globe.tsx:120-133`); ROADMAP.md Phase 1 acceptance criteria are not met.
- **Proposed behavior**: Preset click → camera flies to lat/lon → cavity rendered as a translucent **3D cylinder** (height = cavity depth, color ramp by amplitude) → results panel populates → arrival-time isochrones render as polylines on the globe per the sampler, until the real solver lands.
- **Implementation areas**: `src/components/Globe.tsx` (entity rendering improvements), `src/lib/cesium.ts` (camera helpers).
- **Data model implications**: None — already returned by `run_preset`.
- **Risks**: Cesium camera flyTo on Earth-scale entities is finicky — at Chicxulub's 50 km cavity, default camera distance is wrong by 2 OOM. Use `HeadingPitchRange` with explicit `range = max(20*cavity_radius, 1.5e6)` (already in `Globe.tsx:117-118`, verify in practice).
- **Verification**: With a Cesium token in `.env`, run `npm run tauri dev`, click each preset, confirm globe focuses on correct lat/lon, cavity disc visible, scale appropriate.
- **Complexity**: S (1-2 days)
- **Priority**: **P0**

### F2 — Real GPU shallow-water equation solver via `wgpu` compute
- **User problem**: Without a real solver, every wavefront on the globe is artistically rendered, not physically computed. The product cannot keep its NOAA-grade claim.
- **Evidence**: `physics::shallow_water::sample_wavefront` (lines 80-104) is explicitly a "cheap deep-ocean sampler". BROWNI demonstrated WebGL shallow-water at 1000×500 cells ~30 fps. Qin et al. 2019 confirmed 3.6–6.4× speedup over 16-core CPU for AMR + CUDA. wgpu compute is stable since 2024.
- **Proposed behavior**:
  1. Add `physics::solver::SwGrid` — owns a `2 × Nx × Ny` ping-pong texture pair (η, u, v) plus depth field h. Initialize from `physics::data::bathymetry::sample()` (new module, see F4).
  2. Add `physics::solver::TimeStepper` with WGSL kernel that updates η, u, v using leapfrog or Lax-Friedrichs on a regular lat-lon grid with `1/cos(φ)` spherical metric and Manning friction.
  3. Add `simulate_grid(scenario, t_end, dt, n_snapshots) -> Vec<GridSnapshot>` Tauri command — streams snapshots back.
  4. Frontend renders each snapshot as a textured ellipsoid layer (Cesium `SingleTileImageryProvider` with a generated PNG, or a custom `Primitive` with shader).
- **Implementation areas**: New `src-tauri/src/physics/solver/{mod.rs, grid.rs, kernels.wgsl, time_step.rs}`. Update `Cargo.toml` to add `wgpu = "23"` + `bytemuck`. Update `src-tauri/tauri.conf.json` if Vulkan / Metal validation layers need debug allow.
- **Data model**: `GridSnapshot { time_s: f64, nx: u32, ny: u32, bbox: [f64;4], eta_png_b64: String }` is the IPC-friendly form for v0.2.0. Later: switch to shared-memory IPC (`tauri::ipc::Channel<...>`) for performance.
- **Risks**:
  - wgpu adapter probing on headless CI is finicky — use `wgpu::PowerPreference::LowPower` for tests.
  - GPU memory budget: 2 channels × float32 × 1024² grid = 8 MB; fine. 8192² = 512 MB — needs tiling for global high-res.
  - Numerical stability: `dt < min(dx, dy) / max(c)` (CFL); enforce in solver.
- **Verification**:
  - Unit test against the [analytical Stoker dam-break solution](https://en.wikipedia.org/wiki/Dam-break_equation) — flat-bottom 1-D channel, exact closed form for η.
  - Validate against Range et al. 2022 Chicxulub at the published gauge points (open ocean amplitude at 220 km should be order 1 km magnitude; matching to ±50% is enough for v0.2.0).
- **Complexity**: **L** (3–5 weeks for a single dev; the wgpu compute pipeline + Cesium texture binding + correctness vs. an analytical case is the hard part).
- **Priority**: **P0**

### F3 — Cesium ion token UX (don't bundle the token; load from settings)
- **User problem**: Today the README tells the user to paste their token into `.env`, which becomes a baked-in string in the production JS bundle. For an OSS desktop binary, that means anyone who downloads the installer gets the maintainer's token — and a free-tier token has 15 GB/month bandwidth across ALL users worldwide. First viral moment = exhausted quota = broken app for everyone.
- **Evidence**: `src/lib/cesium.ts:9` reads `VITE_CESIUM_TOKEN` from `import.meta.env`, which Vite inlines at build time. Cesium ion T&C (`https://cesium.com/legal/`) prohibit redistribution of access tokens.
- **Proposed behavior**: First-launch UX: empty state in `Globe.tsx` shows "Paste your free Cesium ion token to enable bathymetry" with a link to `https://cesium.com/ion/signup`. Token stored in `tauri-plugin-store` under `app_data_dir / settings.json`. Optional fallback: bundle-mode ships *no* Cesium ion dependency and uses locally-rendered GEBCO tiles + Natural Earth coastlines (see F4).
- **Implementation areas**: Add `tauri-plugin-store` to `Cargo.toml` + `tauri.conf.json` permissions. Create `src/components/Settings.tsx` with token input + save. Update `src/lib/cesium.ts:configureCesium()` to read from the store before falling back to env. Update README install steps.
- **Data model**: `Settings { cesium_token: Option<String>, prefer_offline: bool, theme: "mocha" | "latte" }` in store.
- **Risks**: First-launch dialog feels like onboarding friction. Mitigate by *only* showing the prompt if the user actually clicks a preset that needs bathymetry — let the app explore without it.
- **Verification**: Build with `npm run tauri build`, install on a fresh user, confirm no token leaks in `Resources/*.js`. Run a scenario and confirm token persisted across restart.
- **Complexity**: **M** (3–5 days incl. settings UI).
- **Priority**: **P1**

### F4 — Offline bathymetry + coastlines mode
- **User problem**: Cesium ion's free tier is non-commercial; the OSS app cannot lean on a streaming service for distribution. Also, classroom/airgapped/field-use scenarios need to work without internet.
- **Evidence**: Cesium ion pricing page (`https://cesium.com/platform/cesium-ion/pricing/`); GEBCO 2024 NetCDF 80 MB compressed (`https://www.gebco.net/data-products-gridded-bathymetry-data/gebco2024-grid`); SRTM15+ V2.6 CC-BY 4.0 same size; Natural Earth 10m coastlines 10 MB.
- **Proposed behavior**:
  1. First-run wizard: "Download offline bathymetry (190 MB)? Yes / Skip / Only when needed". Stores SRTM15+ NetCDF + Natural Earth shapefiles in `app_data_dir / data/`.
  2. Rust backend exposes `physics::data::bathymetry::sample(lat, lon) -> f64` reading from a memory-mapped NetCDF.
  3. Frontend has a "Bathymetry source" setting: `Cesium ion` (online streaming) | `Local GEBCO` (offline raster). Globe layer switches accordingly.
  4. The SWE solver in F2 *always* uses local bathymetry — even in online mode — because solver needs raw depth, not streamed tiles.
- **Implementation areas**: New `src-tauri/src/data/{mod.rs, bathymetry.rs, coastlines.rs}`. Add `netcdf = "0.10"` or `gdal` crate to `Cargo.toml`. Create `assets/data/README.md` documenting source + license. Update `tauri.conf.json` to bundle the data files or download-on-demand.
- **Data model**: NetCDF backed `Bathymetry { grid: ndarray::Array2<i16>, bbox, transform }`.
- **Risks**: First-run 190 MB download is friction — gate behind explicit user action. Tauri's installer payload size matters for some users; offer "lite" installer (no bundled data) + "complete" installer (with data).
- **Verification**: Disconnect from network, restart app, click Chicxulub preset — must still render globe + see solver run.
- **Complexity**: **L** (1–2 weeks).
- **Priority**: **P1**

### F5 — Real Okada 1985 dislocation for earthquake source
- **User problem**: Tōhoku and Indian Ocean — the most-recognized presets — are powered by a `log(η_max) ≈ 0.5·M_w − 3.3` empirical that ignores fault geometry. For M9 Sumatra-Andaman with a 1300-km-long fault, this gives a single point uplift instead of the elongated rupture pattern that drives the directional wave radiation.
- **Evidence**: `physics::earthquake::peak_seafloor_uplift_m()` (line 64) uses the empirical; `EarthquakeSource` struct (line 33-46) is missing `fault_length_m` and `fault_width_m` fields. MOST, GeoClaw, ANUGA, COMCOT all use Okada 1985 as the canonical source.
- **Proposed behavior**: Add `fault_length_m` + `fault_width_m` fields to `EarthquakeSource`. Implement Okada 1985 elliptic-integral form (Steketee 1958 / Okada 1985 / Mansinha-Smylie 1971) as `physics::earthquake::okada::vertical_displacement(...)`. Returns a 2-D field on a user-specified grid around the epicenter.
- **Implementation areas**: `src-tauri/src/physics/earthquake.rs` (rewrite `peak_seafloor_uplift_m` + add 2-D field method). Add `okada1985` reference implementation. Update presets to include fault dimensions (already mostly there for Tōhoku/Sumatra — just need to add the missing struct fields).
- **Data model**: `EarthquakeSource { ..., fault_length_m: f64, fault_width_m: f64, ... }`. `OkadaDisplacement { center, grid_nx, grid_ny, dx_m, dy_m, eta_field: Vec<f64> }`.
- **Risks**: Okada formulas have a lot of sign and trigonometry traps. Validate against [USGS okada_wrapper Python](https://github.com/tbenthompson/okada_wrapper) point-by-point on a Tōhoku test case.
- **Verification**: For Tōhoku 2011 with published Fujii & Satake 2013 finite-fault inversion (40 subfaults), our Okada at the central subfault should give ~7 m vertical uplift on the seafloor.
- **Complexity**: **M** (1 week, mostly debugging trig).
- **Priority**: **P1**

### F6 — Coastal-point runup database + visualization
- **User problem**: The `coastal_runup` Tauri command works but is never called from the UI. Users want to see "this wave produces a 12 m runup at Banda Aceh, 23 m at Lhoknga" — that's the visceral output.
- **Evidence**: `commands.rs:75-78` exposes `coastal_runup`. `physics::shallow_water::synolakis_runup_m` returns sensible amplification factors (3–10× on 2° slopes per the unit test). Range et al. 2022 published validation targets at named locations.
- **Proposed behavior**:
  1. Curate a JSON database of ~100 named coastal points with `{name, lat, lon, beach_slope_deg, offshore_depth_m_at_50m_contour}` covering the regions affected by all 10 presets (Banda Aceh, Lhoknga, Miyako, Otsuchi, Hilo HI, Crescent City CA, Anchorage AK, Lisbon, Cádiz, Ponta Delgada, Pearl Harbor, etc.).
  2. On each wavefront snapshot, sample offshore amplitude at each coastal point's location, call `coastal_runup`, render a colored bar above the point on the Cesium globe (3D `wallGraphics` or `polylineVolumeGraphics`).
  3. Optional hover popup showing the calculation: "offshore A₀ = 1.2 m, slope = 1.8°, depth = 50 m → runup = 8.4 m".
- **Implementation areas**: New `src/data/coastal_points.json`. New `src/components/CoastalRunupOverlay.tsx`. New Tauri command `runup_at_points(scenario_id, time_s) -> Vec<{name, runup_m}>` that batches `coastal_runup` calls.
- **Data model**: JSON shipped as a static asset; loaded once at app start.
- **Risks**: Manning friction / nearshore complexity ignored at this resolution — disclose in the UI. Coastal points have nontrivial sources for beach slope (use [Athanasiou 2019 GCS beach-slope dataset](https://doi.pangaea.de/10.1594/PANGAEA.892993) or hand-curate).
- **Verification**: For Tōhoku at the Miyako point (lat 39.64, lon 141.97), runup should be in [20, 80] m band.
- **Complexity**: **M** (1 week including data curation).
- **Priority**: **P1**

### F7 — Side-by-side comparison mode
- **User problem**: The project's educational thesis (e.g., "Poseidon propaganda is propaganda", "Cumbre Vieja is disputed", "Chicxulub is 30 000× worse than Tōhoku") only lands when the user can *see two scenarios at once*. Today they have to memorize numbers between clicks.
- **Evidence**: `App.tsx` has only one `initial` / `wavefront` state. No comparison UI. Multi-scenario panels are a NUKEMAP feature (set multiple detonations).
- **Proposed behavior**: Toggle "Compare" mode. Splits the central globe view into two side-by-side Cesium viewers (or one viewer with two colored wavefront layers). Both timelines tied. Results panel shows both readouts in adjacent columns with diff highlighting.
- **Implementation areas**: Major `App.tsx` refactor — extract `<Scenario>` component owning its own `initial`/`wavefront`/`timeS` state, render twice. CSS adjustments in `styles.css`.
- **Data model**: Move single-scenario state into a Zustand store (already a dep at `package.json:21`) keyed by `scenarioSlot: "A" | "B"`.
- **Risks**: Two Cesium viewers = 2× GPU + memory; on weak laptops globe will stutter. Provide a "shared globe with overlays" mode as alternative.
- **Verification**: Pick `poseidon_propaganda` in slot A and `poseidon_realistic` in slot B; confirm both globes animate in sync and results panels show 100 Mt vs 2 Mt energy.
- **Complexity**: **M** (1–2 weeks).
- **Priority**: **P2**

### F8 — DART buoy historical overlay
- **User problem**: Without ground-truth, users can't tell whether the simulator is right. "It says 8 m at gauge 21413 at 14:46 UTC — was that what actually happened?"
- **Evidence**: NOAA DART historical archive at `https://www.ndbc.noaa.gov/dart/dart.shtml`. Time-series available in NetCDF for Tōhoku 2011 (DART buoys 21413, 21418, 21419, 51407, 51425, 52403, etc.) and Indian Ocean 2004. Hunga Tonga 2022 had complete DART coverage. NetCDF parseable from Rust via `netcdf` crate.
- **Proposed behavior**: For each of the 4 modern presets (Tōhoku 2011, Indian Ocean 2004, Hunga Tonga 2022, + one more), ship a small subset of DART observations (~20 MB total across all). Render DART stations as 3D pins on the globe. Click pin → overlay 2-panel chart: observed (red line) vs. simulated (blue line) water-surface elevation at that station. Time scrubber moves a vertical line across both.
- **Implementation areas**: New `src-tauri/src/data/dart.rs`. New `src/components/DartOverlay.tsx`. New `assets/data/dart/{2011_tohoku,2004_sumatra,2022_tonga}.nc` files.
- **Data model**: `DartStation { id: u32, lat, lon, observations: Vec<(time_s, eta_m)> }`.
- **Risks**: Distinguishing what we forecast vs. what was observed must be visually unambiguous — color-code legends, no auto-fitting that misleads. Ground-truth that disagrees with our model is *good* — own it, it builds trust.
- **Verification**: For Tōhoku at DART 21413 (off Sanriku), our model's amplitude vs. observed should be in [0.5×, 2×] band at first wave peak.
- **Complexity**: **M** (1–2 weeks).
- **Priority**: **P2**

### F9 — Hunga Tonga atmospheric Lamb-wave source
- **User problem**: The Hunga Tonga preset is in the registry, but the model treats it as a submarine landslide. The actual 2022 event was dominated by atmospheric Lamb-wave coupling per Carvajal et al. 2022 (`Science` 377:91-95). No consumer tool models this. Only JAGURS (JMA) does, operationally.
- **Evidence**: Carvajal 2022, Matoza 2022, Kubota 2022 (all linked above). The relevant addition to SWE is an atmospheric-pressure-gradient forcing term: `∂η/∂t += -(1/ρg) (∂p_atm / ∂t)`, with `p_atm(t, x)` taken as a moving Gaussian pulse at Lamb-wave phase speed ~310 m/s.
- **Proposed behavior**:
  - Add `physics::source::AtmosphericPulse { center, amplitude_pa, lamb_speed_m_s, sigma_m, t0_s }`.
  - Add solver forcing path: `solver::step()` accepts an optional `&dyn PressureForcing` and adds the gradient term each step.
  - Update the Hunga Tonga preset to combine a submarine landslide source (the volcanic caldera collapse) **plus** an atmospheric pulse.
- **Implementation areas**: `src-tauri/src/physics/atmospheric.rs` (new). Wire into `physics::solver`.
- **Risks**: Calibrating the pulse amplitude / σ is research-grade — cite Carvajal 2022 figure 2 for parameter ranges. Make this feature gated behind "Advanced Physics" toggle initially.
- **Verification**: At Pacific gauges 21–24 hours after eruption (the "second arrival" from the Lamb-wave path going the long way around), our model should produce a non-zero amplitude. The first arrival in our submarine-landslide-only model would have decayed by then.
- **Complexity**: **L** (2–3 weeks; depends on F2 solver being in place).
- **Priority**: **P2**

### F10 — Scenario export (PNG screenshot, MP4 timelapse, CZML deep-link)
- **User problem**: NUKEMAP and Asteroid Launcher both give users a way to share a scenario. Today this app has no export at all.
- **Evidence**: NUKEMAP exports KMZ + has shareable URLs. Cesium Stories uses CZML for time-tagged playback. Tauri 2 has `tauri-plugin-fs` + `tauri-plugin-dialog` for save-as.
- **Proposed behavior**:
  - **PNG**: Capture current globe + side panels via `html2canvas` or Cesium's `Scene.requestRenderMode + screenshot` API. Save to user-picked path.
  - **MP4 / WebM**: Render the timeline 0→6h at fixed cadence; capture each frame via Cesium; ffmpeg-via-`tauri-plugin-shell` or `mp4-muxer` Rust crate to encode.
  - **CZML deep-link**: Serialize scenario state (preset id + time + camera + active overlays) into a base64-URL fragment. `tsunamisimulator://load?...` deep link (Tauri 2 protocol handler).
- **Implementation areas**: New `src/lib/export.ts`, new Tauri commands `save_screenshot(path, png_bytes)`, `save_recording(path, frames)`, `register_protocol_handler()`. New `src/components/ExportMenu.tsx`.
- **Risks**: MP4 encoding via ffmpeg shell-out is a dep on the user's system having ffmpeg — bundle `ffmpeg-static`? Or use pure-Rust `mp4` + h264 encoder (slower, simpler).
- **Verification**: Click "Export PNG" → confirm the saved file matches what's on screen. Click "Export MP4" on Chicxulub timeline 0–60 min → confirm output plays in VLC.
- **Complexity**: **M-L** (1–2 weeks; MP4 is the hard half).
- **Priority**: **P2**

### F11 — Nuclear / landslide / earthquake scenario builders in the UI
- **User problem**: The Rust commands exist but only asteroids have a scenario builder. To deliver on the "NukeMap for tsunamis" promise, the user must be able to detonate a custom-yield warhead anywhere.
- **Evidence**: `src/components/ScenarioBuilder.tsx` only renders asteroid form. `commands.rs` has 4 scenario commands.
- **Proposed behavior**: Tabbed scenario builder with tabs `Asteroid | Nuclear | Earthquake | Landslide`. Each tab renders its own form with the matching IPC input shape from `src/types/scenario.ts`. Same submit pattern.
- **Implementation areas**: Rewrite `src/components/ScenarioBuilder.tsx` as a tab component. Add `NuclearForm`, `EarthquakeForm`, `LandslideForm` siblings.
- **Risks**: Form bloat — keep each tab to ≤6 fields. Use sensible defaults pre-filled.
- **Verification**: Build a custom 1-Mt underwater nuke at 50.0°N -10.0°E, confirm globe renders the cavity, results panel shows 1 Mt energy + ~M5 seismic-equivalent.
- **Complexity**: **S-M** (3-5 days).
- **Priority**: **P1**

### F12 — Live globe click → set scenario location
- **User problem**: Today users type lat/lon manually. Every consumer competitor lets users click a map.
- **Evidence**: NUKEMAP, Asteroid Launcher, MISSILEMAP all use click-to-set. Cesium has `ScreenSpaceEventHandler` for click → cartographic conversion.
- **Proposed behavior**: When "Pick Location on Globe" button is clicked in the scenario builder, the globe enters pick mode (cursor change). Next click on globe → cartographic position injected into the form. Press Escape to cancel.
- **Implementation areas**: `src/components/Globe.tsx` exposes a `onPick: (lat, lon) => void` prop. `src/components/ScenarioBuilder.tsx` shows the pick button and consumes the callback.
- **Risks**: Picking ocean depth from the GEBCO terrain at click point requires `Cesium.sampleTerrain(...)` async call — keep UX responsive with a loading state.
- **Verification**: Open Nuclear scenario form, click "Pick Location", click globe in the Atlantic at ~50°N, confirm form fields populate within 1 second.
- **Complexity**: **S** (2-3 days).
- **Priority**: **P1**

### F13 — Inundation polygon overlays (Phase 4 of ROADMAP)
- **User problem**: A "wave height bar" at a coastal point is informative; an actual flood polygon over a real city is visceral.
- **Evidence**: GeoClaw, MOST, FUNWAVE all produce inundation rasters. With local bathymetry + the SWE solver, wetting/drying cell tracking is a well-known algorithm (Audusse et al. 2004).
- **Proposed behavior**: When the SWE solver runs near land cells, track which cells become wet. At the final time, render the union of wet cells as a translucent red GeoJSON polygon overlay on the globe.
- **Implementation areas**: `physics::solver::wetdry::WetDryTracker`. New Tauri command `inundation_polygon(scenario_id) -> GeoJSON`. Cesium `GeoJsonDataSource` to render.
- **Risks**: Coastal grid resolution matters — at 500 m (GEBCO native) we're showing block-y "flood-yes/flood-no" zones. Document the limitation. This is why operational tools use 10-m DEM for inundation phase.
- **Verification**: Tōhoku 2011 inundation polygon for the Sanriku coast should overlap published USGS post-event survey.
- **Complexity**: **L** (2–3 weeks, depends on F2 + F4).
- **Priority**: **P2**

### F14 — Population casualty overlay (optional / opt-in)
- **User problem**: Some users (educators, hazard researchers) want "if Chicxulub hit New York today, how many people". This is NUKEMAP's marquee feature.
- **Evidence**: WorldPop and GHS-POP are CC-BY 4.0 1-km global rasters. Heavy moral / editorial weight — handle carefully.
- **Proposed behavior**: Optional, gated behind an "Enable casualty estimation" Settings toggle. Sample population raster at each inundation cell. Apply a depth-based casualty function (e.g., Jonkman 2005 dose-response: P(death) = Φ((ln(h) − μ) / σ) with μ=0.34, σ=0.43 for sudden inundation). Display range estimate with a wide confidence band.
- **Implementation areas**: New `src-tauri/src/data/population.rs`. New scenario result field `estimated_affected: { p10, p50, p90 }`.
- **Risks**: This is the most editorially-sensitive feature in the project. Defaults off. Heavy disclaimer ("model estimate with ±OOM uncertainty; not predictive of real events"). User must explicitly accept the toggle.
- **Verification**: Run Chicxulub-at-New-York hypothetical; sanity-check that estimate is within historical OOM (Range 2022 didn't compute casualties for the K-Pg case since humans didn't exist, but modern hits to known cities have published estimates: a 14 km asteroid hitting NYC = "complete destruction of the eastern seaboard" per multiple references).
- **Complexity**: **L** (1–2 weeks + significant editorial review).
- **Priority**: **P3** (high value but high risk; ship later when project has more trust).

---

## Existing Feature Improvements

### I1 — Fix `tauri build` (icons + ensure release pipeline can run)
- **Current behavior**: `src-tauri/tauri.conf.json:34-40` references `icons/32x32.png`, `icons/128x128.png`, etc. but `src-tauri/icons/` contains only `README.md`. `npm run tauri build` will fail with `image format error` or `file not found`.
- **Problem**: No installable binary exists. CI cannot validate anything beyond TypeScript.
- **Recommended change**: (a) Place placeholder 1024×1024 master PNG under `assets/branding/logo.png`. (b) Run `npm run tauri icon assets/branding/logo.png` to generate all icon sizes into `src-tauri/icons/`. (c) Add a CI step that runs `npm run tauri build` (or at minimum, builds the icons directory).
- **Code locations**: `src-tauri/icons/`, `src-tauri/tauri.conf.json`, future `.github/workflows/release.yml`.
- **Backward compatibility**: New project, no concerns.
- **Verification**: `npm run tauri build` produces an MSI / DMG / AppImage in `src-tauri/target/release/bundle/`.
- **Complexity**: **S** (1 day, given a placeholder logo is acceptable for v0.1.0).
- **Priority**: **P0**.

### I2 — Add `.github/workflows/release.yml` (workflow_dispatch + cross-platform build + signed artifacts)
- **Current behavior**: No CI / CD. Per the user's global `CLAUDE.md` rule "every release workflow shares the same shape", every other repo has a workflow_dispatch release pipeline.
- **Problem**: No automated verification. No public binaries. Contributors can't get green-build feedback.
- **Recommended change**: Standard 3-runner matrix (`ubuntu-latest`, `macos-latest`, `windows-latest`). Steps:
  1. Checkout, Node 20, Rust stable, platform-specific deps (WebKit on Linux).
  2. `npm install`, `npx tsc --noEmit`, `npx vite build`, `cargo test --manifest-path src-tauri/Cargo.toml`.
  3. `npm run tauri build`.
  4. `gh release upload <tag> src-tauri/target/release/bundle/**/*.{msi,dmg,AppImage,deb}`.
- **Code locations**: New `.github/workflows/release.yml`, `.github/workflows/ci.yml` (PR build).
- **Backward compatibility**: None.
- **Verification**: Push a tag `v0.1.0` and watch the workflow attach 3 artifacts to the GH release.
- **Complexity**: **S-M** (3-5 days incl. dealing with Windows MSVC + macOS code signing later).
- **Priority**: **P0**.

### I3 — Remove the duplicate browser-preview mock in `App.tsx`
- **Current behavior**: `App.tsx:14-33` defines a `MOCK_PRESETS` array with a hand-coded Chicxulub entry. `App.tsx:71-95` re-derives Schmidt-Holsapple in JS for the browser preview path.
- **Problem**: Two sources of truth for the same constants — silent drift when the Rust formula changes.
- **Recommended change**: For browser preview (`npm run dev` without `tauri dev`), either (a) skip — show "Run via `npm run tauri dev` for full experience" empty state, or (b) compile the Rust physics modules to WebAssembly via `wasm-bindgen` and call them from JS. (a) is the v0.1.0 fix; (b) is a longer bet.
- **Code locations**: `src/App.tsx`, `src/lib/tauri.ts` (`isTauri()`).
- **Backward compatibility**: Browser preview becomes less interactive in v0.1.0 — acceptable since this is a desktop app.
- **Verification**: Run `npm run dev` (no Tauri), confirm "Browser preview — limited functionality" banner appears.
- **Complexity**: **S** (half day).
- **Priority**: **P1**.

### I4 — Fix `EarthquakeSource` missing `fault_length_m` + `fault_width_m`
- **Current behavior**: Struct at `earthquake.rs:33-46` has `mw`, `depth_m`, `strike_deg`, `dip_deg`, `rake_deg`, `slip_m`, `water_depth_m`, `location` — but **no fault dimensions**. `effective_cavity_radius_m()` computes them from Wells-Coppersmith scaling each call.
- **Problem**: For real Okada (see F5), the user must be able to specify a length-width on their custom earthquake; currently impossible.
- **Recommended change**: Add `fault_length_m: f64`, `fault_width_m: f64` to `EarthquakeSource`. Have `tohoku_2011()` and `indian_ocean_2004()` pre-fill with peer-reviewed values (Fujii-Satake 2013 finite-fault). Make `effective_cavity_radius_m()` use the stored value, falling back to Wells-Coppersmith if zero.
- **Code locations**: `src-tauri/src/physics/earthquake.rs`, `src-tauri/src/presets.rs`, `src/types/scenario.ts` (sync TS types).
- **Backward compatibility**: This is v0.0.x; no external consumers yet.
- **Verification**: Run `cargo test`; `tohoku_2011().fault_length_m` should be ~500_000 m, `fault_width_m` ~200_000 m.
- **Complexity**: **S** (half day).
- **Priority**: **P1**.

### I5 — README presets table claims Krakatoa 1883 — code has no Krakatoa
- **Current behavior**: `README.md:103` lists Krakatoa 1883 as a preset. `src-tauri/src/presets.rs` has Hunga Tonga 2022 but not Krakatoa.
- **Problem**: Documentation drift.
- **Recommended change**: Either add a Krakatoa 1883 preset (caldera collapse, 42 m wave per Choi et al. 2003) — straightforward `LandslideSource` of submarine kind — or remove the line from README. Adding it is preferred since it broadens preset coverage.
- **Code locations**: `src-tauri/src/presets.rs::all_presets()` (add new entry), `README.md` (no change needed if added; one-line edit if removed).
- **Backward compatibility**: New preset id is additive.
- **Verification**: `list_presets` IPC returns 11 entries; click Krakatoa, globe flies to Sunda Strait.
- **Complexity**: **S** (half day).
- **Priority**: **P2**.

### I6 — Remove `_suppress_unused_mt_constant` dead code
- **Current behavior**: `nuclear.rs:182-185` has `#[allow(dead_code)] fn _suppress_unused_mt_constant() -> f64 { J_PER_MT_TNT }`. `commands.rs:118` has `let _ = matches!(preset.source, PresetSource::Asteroid(_));` — another dead-code suppressor.
- **Problem**: These are leftovers from iteration. They're harmless but they're noise that future maintainers will wonder about.
- **Recommended change**: Delete both. `J_PER_MT_TNT` *is* used (via `yield_mt` method, line 56). If clippy complains in the future, gate at module level.
- **Code locations**: `src-tauri/src/physics/nuclear.rs`, `src-tauri/src/commands.rs`.
- **Backward compatibility**: None.
- **Verification**: `cargo build` still passes; no new warnings.
- **Complexity**: **S** (5 minutes).
- **Priority**: **P2**.

### I7 — Globe empty state when no preset selected
- **Current behavior**: On first launch, `Globe.tsx` shows the globe with no markers. Users may not know to click a preset.
- **Problem**: Onboarding friction.
- **Recommended change**: Render a faint "Choose a preset on the left, or build a scenario on the right" overlay when `initial === null`. Fade out when first preset is loaded.
- **Code locations**: `src/components/Globe.tsx`.
- **Backward compatibility**: Visual change only.
- **Verification**: Open dev mode, confirm overlay visible until first preset click.
- **Complexity**: **S** (1 hour).
- **Priority**: **P1**.

### I8 — Loading state while Cesium World Bathymetry tile set fetches
- **Current behavior**: `Globe.tsx:51-58` calls `Cesium.createWorldBathymetryAsync().then(setProvider)`. While this promise is pending, the globe shows flat WGS84 ellipsoid with no indication that bathymetry is loading.
- **Problem**: User thinks bathymetry didn't work.
- **Recommended change**: Add a small loading badge in the corner ("Loading GEBCO bathymetry…") while the promise is pending. Replace with a green check once tiles start rendering.
- **Code locations**: `src/components/Globe.tsx`.
- **Backward compatibility**: Visual only.
- **Verification**: Throttle network to slow 3G, observe the badge.
- **Complexity**: **S** (1 hour).
- **Priority**: **P2**.

### I9 — Light theme toggle (claimed in README, not implemented)
- **Current behavior**: README claims "Catppuccin Mocha default theme … Light mode toggle". `styles.css` defines only Mocha tokens.
- **Problem**: Documentation drift; user expectation unmet.
- **Recommended change**: Add Catppuccin Latte token block in `styles.css`. Detect `prefers-color-scheme`, override via Settings toggle. Use CSS custom-property swap via `data-theme="latte"` on `<html>`.
- **Code locations**: `src/styles.css`, new `src/lib/theme.ts`.
- **Backward compatibility**: Dark stays the default.
- **Verification**: Toggle in Settings UI, confirm globe still readable (lighter atmosphere setting in Cesium recommended).
- **Complexity**: **S** (1 day).
- **Priority**: **P2**.

### I10 — Disclaimer banner is text-only; users dismiss it mentally
- **Current behavior**: `App.tsx:113-115` shows "Educational only — not for evacuation" in the header. NUKEMAP has a similar warning. Both are easy to ignore.
- **Problem**: For a hazard-related tool, the trust signal needs to be unmissable on first run (not annoying on every run).
- **Recommended change**: First-run modal: "TsunamiSimulator is an educational physics-visualization tool. It is NOT for evacuation planning. For real tsunami warnings, use NOAA PTWC / NTWC or your national tsunami warning center. [Got it]". Don't re-show after first acknowledgment (store flag in `app_data_dir`). Header banner stays as a constant low-key reminder.
- **Code locations**: New `src/components/FirstRunDisclaimer.tsx`. Use `tauri-plugin-store`.
- **Backward compatibility**: First-run-only.
- **Verification**: Fresh install → modal appears once.
- **Complexity**: **S** (1 day).
- **Priority**: **P1**.

### I11 — Scenario builder lacks Cumbre Vieja-style "include disputed scenarios?" gate
- **Current behavior**: Cumbre Vieja and Poseidon-propaganda presets are in the registry alongside well-established events.
- **Problem**: Mixing speculative scenarios with peer-reviewed history is fine as long as the UI flags it.
- **Recommended change**: Tag each preset with `is_speculative: bool` and `controversy_note: Option<&str>`. Sort speculative below historical in `PresetSelector`. Add a small icon ("⚠ Hypothetical — contested in literature").
- **Code locations**: `src-tauri/src/presets.rs::Preset` struct, `src/components/PresetSelector.tsx`.
- **Backward compatibility**: Additive.
- **Verification**: Cumbre Vieja card shows the controversy icon and tooltip.
- **Complexity**: **S** (half day).
- **Priority**: **P2**.

### I12 — `Globe.tsx` rebuilds wavefront entities on every prop change (no diff)
- **Current behavior**: `Globe.tsx:120-133` removes all `wavefrontEntitiesRef.current` and re-adds. With 32 rings × every slider tick (~5/sec when dragging), this thrashes.
- **Problem**: Fine for v0.0.1 sampler; will not scale to a real solver emitting 30 fps snapshots.
- **Recommended change**: Maintain a persistent ring of entities sized to `n_samples`; on snapshot update, mutate their `ellipse.semiMajorAxis` / `outlineColor.alpha` properties in-place. Cesium re-renders cheaply.
- **Code locations**: `src/components/Globe.tsx`.
- **Backward compatibility**: Visual identical.
- **Verification**: Profile React in DevTools while dragging the timeline; commit time should drop.
- **Complexity**: **S** (half day).
- **Priority**: **P2** (P1 once F2 solver lands).

### I13 — `sample_wavefront` uses log-spacing; consider linear for animation
- **Current behavior**: `shallow_water.rs:96-100` log-spaces sample ranges from `r_min` to `wavefront_r`.
- **Problem**: For a wavefront *visualization*, the leading edge is more interesting than the source region. Log-spacing concentrates samples near source.
- **Recommended change**: Either (a) linear-space samples with the front at the last index, or (b) put N samples *behind* the front (e.g., 50 m, 100 m, 200 m, ... back from leading edge) so the visualization shows the wave train, not the decay tail.
- **Code locations**: `src-tauri/src/physics/shallow_water.rs::sample_wavefront`.
- **Backward compatibility**: Visual change.
- **Verification**: Rings cluster near the leading edge at animation playback.
- **Complexity**: **S** (1 hour).
- **Priority**: **P2** (obviated by F2 anyway).

### I14 — Make citation footer in app surface clickable to open URL
- **Current behavior**: `App.tsx:124-126` says "Sources cite peer-reviewed papers. See `docs/science/`". The `docs/science/` directory ships only with the binary if Tauri's `resources` config is set — and it isn't.
- **Problem**: User has no in-app way to see citations.
- **Recommended change**: Add `src/components/CitationsModal.tsx` that lists every preset's `reference` field clickable to open the paper URL via `tauri-plugin-shell`. Also include `docs/science/REFERENCES.bib` as a downloadable asset.
- **Code locations**: `src/components/CitationsModal.tsx`, `src/App.tsx` footer.
- **Backward compatibility**: Additive.
- **Verification**: Click any reference, browser opens the paper.
- **Complexity**: **S** (half day).
- **Priority**: **P2**.

### I15 — Tighten `shell:allow-open` capability to an allowlist
- **Current behavior**: `src-tauri/capabilities/default.json` allows shell-open for any URL.
- **Problem**: Slight risk of abuse if scenario imports / deep links inject malicious URLs.
- **Recommended change**: Use Tauri's allowlist syntax: only allow `https://*.cesium.com`, `https://agupubs.onlinelibrary.wiley.com`, `https://www.science.org`, `https://www.researchgate.net`, `https://github.com/SysAdminDoc/TsunamiSimulator`, `https://nuclearsecrecy.com`, `https://impact.ese.ic.ac.uk`, `https://www.ndbc.noaa.gov`, `https://www.gebco.net`, `https://cesium.com`.
- **Code locations**: `src-tauri/capabilities/default.json`.
- **Backward compatibility**: Citation URLs need to be in the list.
- **Verification**: Click each preset reference — opens. Click a non-allowed URL — refused.
- **Complexity**: **S** (1 hour).
- **Priority**: **P2**.

### I16 — `vite.config.ts` has 4 MB chunk size warning; consider Cesium code-splitting
- **Current behavior**: `vite build` output: `dist/assets/index-D0JxE2P2.js   4,350.92 kB`. Warning: "Some chunks are larger than 4000 kB after minification."
- **Problem**: Initial app load is slow even from local disk because Tauri loads JS from filesystem then evaluates.
- **Recommended change**: Add `build.rollupOptions.output.manualChunks` to split Cesium into its own chunk, lazy-load Cesium only when Globe mounts (`React.lazy`).
- **Code locations**: `vite.config.ts`, `src/App.tsx` (lazy-import Globe).
- **Backward compatibility**: First-render shows app shell faster.
- **Verification**: After change, `dist/` has multiple chunks; `cesium-XXXX.js` ~3.5 MB; main app ~500 KB.
- **Complexity**: **S** (half day).
- **Priority**: **P2**.

### I17 — Preset blurbs in `presets.rs` use unicode (e.g., "Tōhoku", "—") — verify Windows console doesn't choke
- **Current behavior**: Per the user's global PowerShell rule "no emoji/unicode", but Rust strings handle UTF-8 cleanly. The Tauri IPC layer uses serde_json which is UTF-8 native. Render in browser is fine.
- **Problem**: Possibly fine — but worth a check.
- **Recommended change**: Confirm via `cargo run` + console output that the Tōhoku character renders. If any layer (logging, error messages) hits Windows cp1252 console, fall back to ASCII transliteration there only.
- **Code locations**: `src-tauri/src/presets.rs`.
- **Backward compatibility**: Unlikely impact.
- **Verification**: Open Windows cmd, run debug build, confirm no encoding errors.
- **Complexity**: **S** (verification only).
- **Priority**: **P3**.

### I18 — Cargo deps could pin minor versions; add `cargo audit` to CI
- **Current behavior**: `Cargo.toml` uses `tauri = "2.1"`, `serde = "1.0"`, `ndarray = "0.16"`, `rayon = "1.10"`. Caret semantics.
- **Problem**: Cargo `cargo audit` not yet wired; security advisories slip through.
- **Recommended change**: Add CI step `cargo install cargo-audit && cargo audit`. Add `dependabot.yml` for both npm and cargo.
- **Code locations**: New `.github/workflows/ci.yml`, new `.github/dependabot.yml`.
- **Backward compatibility**: None.
- **Verification**: PR with a known-vulnerable transitive shows red.
- **Complexity**: **S** (1 day).
- **Priority**: **P1**.

---

## Reliability, Security, Privacy, and Data Safety

### Bugs / risks found
- **R1 [Verified]** — `tauri build` will fail today (icons missing). See I1.
- **R2 [Verified]** — Cesium token bundled into JS at build time. See F3.
- **R3 [Verified]** — `cargo check` cannot be run on current host (MSVC C++ workload not installed). Documented in `CLAUDE.md` gotcha. Risk: code is syntactically valid but not compiler-verified until CI runs on a Windows GH Actions runner with VS Build Tools. See I2 (CI workflow).
- **R4 [Likely]** — `Globe.tsx` Cesium viewer reuses across hot-reload may leak GPU memory in development. React StrictMode double-invocation of the mount effect will create-then-destroy two viewers — observable in dev only.
- **R5 [Assumption]** — The wavefront ring colors use `outlineColor.alpha = 0.3 + 0.5 * t` where `t = a/maxA`. If `maxA = 0` (zero amplitude), divide-by-zero NaN propagates. Add guard.
- **R6 [Assumption]** — `commands.rs::run_preset` uses `mean_depth_m: 4000` as a hardcoded value passed from frontend (`App.tsx:61`). For Lituya Bay (122 m depth) the long-wave speed is wrong by 6× → arrival-time isochrones will be wrong. Use the preset's `water_depth_m` instead, or query GEBCO at the source point.

### Missing guardrails
- **G1** — No CFL stability check in `sample_wavefront` (not needed for sampler, but **required** when F2 lands).
- **G2** — No bounds check on user input in `ScenarioBuilder` — user can input `diameter_m: -100` and get NaN-everywhere results.
- **G3** — No "is this preset id valid" check at the React layer; relies on Rust returning `Err`. Add a client-side check.
- **G4** — No file path sandboxing — when F4 lands (bathymetry data), the read must be confined to `app_data_dir`. Use `tauri-plugin-fs` scope.

### Permission / network / filesystem concerns
- **P1** — Outbound network: only Cesium ion REST. Document explicitly in README.
- **P2** — No telemetry/analytics, by design. Maintain this — disclose explicitly in privacy section of README (currently missing).
- **P3** — No auto-updates. Users on stale versions miss physics fixes. Add `tauri-plugin-updater` with a public signing key for v1.0.

### Recovery / rollback needs
- **U1** — If a custom scenario crashes the Rust backend (panic), Tauri logs the panic but the React UI may hang. Wrap the Tauri command handlers in `Result<..., String>` (some already are; standardize) so the frontend can show an error toast.
- **U2** — If the bathymetry NetCDF (when shipped per F4) is corrupted, app should gracefully fall back to flat-bottom mode rather than refusing to start. Add a fallback layer.

### Logging / diagnostics
- **L1** — No structured logging. Add `tracing` crate to the Rust backend with `tracing-subscriber` writing to `app_log_dir`. Frontend `console.error` is fine for v0.x.
- **L2** — No crash report mechanism. For v1.0, integrate Sentry or a simpler "Send last log" button.

---

## UX, Accessibility, and Trust

### Onboarding gaps
- **U1** — First-launch experience is silent: empty globe + sidebars. Add a 3-step onboarding overlay (1: "Pick a preset", 2: "Watch the wavefront", 3: "Build your own scenario"). Dismissable, not re-shown.
- **U2** — Cesium token requirement is buried in README. The `Globe.tsx:128-145` fallback is good but should also offer "Continue without bathymetry" so users can at least see the globe outline.
- **U3** — First-run disclaimer (see I10).

### Empty / loading / error / disabled states
- **E1** — Globe before first preset: empty. Add overlay. (I7)
- **E2** — Globe while bathymetry loads: silent. Add badge. (I8)
- **E3** — Globe if Cesium throws: silent crash. Add error boundary.
- **E4** — Results panel before any selection: shows "Select a preset…" prose (`ResultsPanel.tsx:21-29`) — good.
- **E5** — Scenario builder Simulate button: no disabled state for invalid inputs (negative diameter, etc.).
- **E6** — Preset cards: hover effect present (`styles.css:201-204`), active state present, no busy indicator while `run_preset` is in flight.

### Destructive / irreversible actions
- None today. Future export (F10) should confirm overwrite via `tauri-plugin-dialog`.

### Settings clarity
- No Settings UI at all today. Required by F3 (Cesium token), I9 (theme toggle), I10 (disclaimer state), F4 (bathymetry source preference), F14 (casualty estimation opt-in).

### Accessibility
- **A1** — No keyboard navigation between preset cards (per the user's "no keyboard shortcuts" rule, that's intentional, but Tab/Enter/Arrow should still work for screen readers and keyboard users).
- **A2** — Color encoding on wavefront rings (alpha proportional to amplitude) has no textual readout — screen readers can't perceive a "tall wave" visually. Provide a textual time-series readout below the globe.
- **A3** — Cesium canvas is unlabeled to assistive tech. Add `<canvas role="img" aria-label="3D globe showing tsunami source">`.
- **A4** — Color contrast check: Catppuccin Mocha is generally WCAG AA, but the `--subtext` (#a6adc8) on `--mantle` (#181825) gives 6.3:1 — passes for body text. Verify focus rings are visible on dark.
- **A5** — `<input>` controls in the scenario form have proper `<label>` wrappers — good per `ScenarioBuilder.tsx`.

### Microcopy / trust signals
- **M1** — Header warning "Educational only — not for evacuation" is good. Strengthen: "For tsunami warnings, contact NOAA PTWC (Pacific) / NTWC (Atlantic)". Make NOAA NTWC/PTWC a hyperlink.
- **M2** — Result readouts give precise numbers ("4.5 km", "1.5 km") but no uncertainty band. Operational tools cite ±OOM uncertainty. Add error bars in v1.0: "4.5 ± 0.5 km" with a tooltip explaining the source of uncertainty.
- **M3** — Preset blurbs are good. The Poseidon and Cumbre Vieja entries do explicitly flag the controversy — keep that pattern.
- **M4** — Add a small "About this calculation" link next to each result row, opening the relevant formula in `docs/science/`.

---

## Architecture and Maintainability

### Module / boundary improvements
- **A1** — Move physics constants into a single place: today both `physics::constants` *and* hardcoded numbers (e.g., `0.0574` in `landslide.rs:104`) exist. Promote every "magic number" with a paper citation to `constants.rs` with a named constant.
- **A2** — `commands.rs::run_preset` doesn't separate concerns well — it does preset lookup, initial-displacement computation, decay selection, and wavefront sampling all in one function. Refactor when the real solver lands (F2): split into `physics::scenario::Scenario::initial()` and `physics::solver::run(scenario, params)`.
- **A3** — `src/types/scenario.ts` is hand-maintained to match Rust types. Future-proof: use `ts-rs` or `specta` (Rust crates) to auto-generate TS from `#[derive(TS)]` annotations.

### Refactor candidates
- **R1** — Browser-preview mock physics in `App.tsx:71-95` (I3).
- **R2** — `Globe.tsx` entity management (I12).
- **R3** — `sample_wavefront` will be replaced wholesale by F2.

### Test gaps
- **T1** — Frontend has zero tests. Per user's "no tests unless requested" rule, that's a deliberate gap.
- **T2** — Backend has 7 unit tests across physics modules. Add property-based tests via `proptest` for physical invariants (energy conservation, monotone decay) once the solver lands.
- **T3** — No integration test that the full Tauri command chain works. Add at least one `tauri::Builder::default().invoke_handler(...).run(mock_context)` smoke test.

### Documentation gaps
- **D1** — `docs/science/` has REFERENCES.bib and a README index. No per-formula derivation notes yet (e.g., `docs/science/asteroid.md` showing the cavity-scaling derivation step by step) — promised in the README scaffolding text.
- **D2** — No CONTRIBUTING.md.
- **D3** — No PR template / issue templates.
- **D4** — No SECURITY.md (vulnerability reporting policy).
- **D5** — No screenshots in README. Project rule says screenshots get re-captured on every UI change — none exist yet because the UI is still mostly empty.

### Release / build / deployment gaps
- **B1** — No icons → tauri build broken (I1).
- **B2** — No CI / release pipeline (I2).
- **B3** — No code signing — required for macOS Gatekeeper, Windows SmartScreen reputation.
- **B4** — No auto-update channel.

---

## Prioritized Roadmap

> Each item: checkbox, priority, title, why, evidence, files, acceptance, verify. Items group into phases that mirror `ROADMAP.md`'s `v0.1.0 / v0.2.0 / …` cadence.

### Phase 0.1 — Get something runnable (target v0.1.0)

- [ ] **P0 — Generate icon set and verify `npm run tauri build` ships an installer**
  - Why: Without icons the bundle fails; without a bundle there's no product.
  - Evidence: `src-tauri/tauri.conf.json:34-40` references icons that don't exist; `src-tauri/icons/` contains only README.
  - Touches: `assets/branding/logo.png` (new), `src-tauri/icons/*` (generated), README install steps.
  - Acceptance: `npm run tauri build` produces `src-tauri/target/release/bundle/{msi,dmg,deb,AppImage}` artifacts on each platform.
  - Verify: On a host with MSVC: `npm run tauri build` exits 0 and the MSI installs cleanly.

- [ ] **P0 — Add `.github/workflows/release.yml` (workflow_dispatch + 3 OS matrix + GH release upload)**
  - Why: No automated build means no public binaries and no CI verification of Rust code (the local host can't compile it).
  - Evidence: No `.github/` directory exists.
  - Touches: `.github/workflows/release.yml`, `.github/workflows/ci.yml`.
  - Acceptance: Trigger workflow from GH UI, three OS-specific installers attached to release.
  - Verify: `gh workflow run release.yml -f tag=v0.1.0-alpha`; check artifacts.

- [ ] **P0 — Wire Globe.tsx to render initial source displacement with camera fly-to + cavity disc (Phase 1 of ROADMAP.md)**
  - Why: The product hasn't shipped a globe-with-tsunami experience yet; this is the v0.1.0 promise.
  - Evidence: `Globe.tsx:81-119` already draws source point + label; cavity ellipse exists; need to add the cylinder height = cavity depth + flyTo tuning.
  - Touches: `src/components/Globe.tsx`.
  - Acceptance: Click any preset → globe flies to lat/lon within 2 s → 3D cavity visible with amplitude-mapped color.
  - Verify: Manual click-through of all 10 presets.

- [ ] **P0 — Fix `mean_depth_m` hardcoded 4000 in `App.tsx:61`; use preset's stored water depth**
  - Why: Lituya Bay (122 m depth) gets wrong arrival times.
  - Evidence: `App.tsx:61` hardcodes 4000.
  - Touches: `src/App.tsx`, possibly `commands.rs::RunPresetRequest` to derive depth server-side.
  - Acceptance: `run_preset` for Lituya shows wavefront `c = √(g·122) ≈ 35 m/s`, not 200 m/s.
  - Verify: Slider Lituya to t=10 min; wavefront radius should be ~21 km, not ~120 km.

- [ ] **P1 — Cesium token UX (Settings UI; first-launch prompt; `app_data_dir` persistence)**
  - Why: Don't ship the maintainer's token in the binary.
  - Evidence: `src/lib/cesium.ts:9` reads `import.meta.env`; Cesium ion T&C prohibit redistribution.
  - Touches: New `src/components/Settings.tsx`, `src/lib/settings.ts`, `src-tauri/Cargo.toml` (+ `tauri-plugin-store`), `src-tauri/capabilities/default.json`.
  - Acceptance: Bundle the production app, install on a fresh user, no token leaks anywhere in resources.
  - Verify: `grep -r '[A-Za-z0-9_-]{40,}' src-tauri/target/release/bundle/.../resources/`.

- [ ] **P1 — Add per-preset disclaimer / controversy flag**
  - Why: Cumbre Vieja and Poseidon-propaganda must be visually distinguished from peer-reviewed history.
  - Evidence: `src-tauri/src/presets.rs::Preset` lacks `is_speculative` / `controversy_note`.
  - Touches: `src-tauri/src/presets.rs`, `src/types/scenario.ts`, `src/components/PresetSelector.tsx`.
  - Acceptance: Cumbre Vieja card shows ⚠ icon; hover tooltip says "Disputed: Ward-Day worst case vs Løvholt rebuttal".
  - Verify: Visual.

- [ ] **P1 — First-run disclaimer modal**
  - Why: Hazard-tool trust signal must be unmissable once, not annoying every launch.
  - Evidence: I10.
  - Touches: New `src/components/FirstRunDisclaimer.tsx`, settings store.
  - Acceptance: Fresh install → modal once → "Got it" → never shown again unless user resets settings.
  - Verify: Manual.

- [ ] **P1 — Tabbed scenario builder (asteroid, nuclear, earthquake, landslide)**
  - Why: The Rust commands exist; only asteroid has a UI today.
  - Evidence: F11.
  - Touches: `src/components/ScenarioBuilder.tsx` (rewrite), add `NuclearForm.tsx`, `EarthquakeForm.tsx`, `LandslideForm.tsx`.
  - Acceptance: Each tab submits its respective IPC and updates the globe.
  - Verify: Build a 1-Mt underwater nuke; globe shows ~1 km cavity disc and ~5 m initial amplitude.

- [ ] **P1 — Click-globe-to-set-location for scenario builder**
  - Why: Every consumer competitor does this.
  - Evidence: F12.
  - Touches: `src/components/Globe.tsx` (expose `onPick`), `src/components/ScenarioBuilder.tsx` (button).
  - Acceptance: Click "Pick on Globe" → click ocean → form populated within 1 s.
  - Verify: Manual.

- [ ] **P1 — Add `cargo audit` + `dependabot.yml`**
  - Why: Standard OSS hygiene; security advisories slip through otherwise.
  - Evidence: I18.
  - Touches: New `.github/workflows/ci.yml`, `.github/dependabot.yml`.
  - Acceptance: Weekly PRs from dependabot; security-advisory PRs flagged.
  - Verify: Wait for first dependabot PR.

### Phase 0.2 — Real propagation (target v0.2.0)

- [ ] **P0 — Implement `wgpu` compute SWE solver on regular lat-lon grid (F2)**
  - Why: The flagship physics feature; everything downstream depends on it.
  - Evidence: F2 with full justification.
  - Touches: New `src-tauri/src/physics/solver/{mod,grid,kernels.wgsl,time_step}.rs`, `Cargo.toml` (+ `wgpu = "23"`, `bytemuck`), `commands.rs` (new `simulate_grid`).
  - Acceptance: Solver matches analytical Stoker dam-break to ±5% for 1-D constant-depth case. For Chicxulub, far-field amplitude at 220 km within OOM of Range et al. 2022's 1.5 km.
  - Verify: `cargo test --release` runs the analytical-case test; `npm run tauri dev`, click Chicxulub, watch animation, eyeball validate.

- [ ] **P0 — Synolakis runup overlay (F6: coastal-point database + Tauri batch command + Cesium 3D bars)**
  - Why: Runup is the visceral output users care about. Synolakis is already implemented in Rust — just needs to be invoked.
  - Evidence: F6, plus `commands.rs:75-78` already exposes `coastal_runup`.
  - Touches: New `src/data/coastal_points.json`, new `commands.rs::runup_at_points`, new `src/components/CoastalRunupOverlay.tsx`.
  - Acceptance: For Tōhoku at the Miyako coastal point, runup readout ∈ [20, 80] m.
  - Verify: Visual inspection + spot-check numbers against Mori et al. 2011.

- [ ] **P1 — Implement Okada 1985 dislocation (F5; fix I4 EarthquakeSource struct first)**
  - Why: Tōhoku / Sumatra accuracy depends on real fault geometry.
  - Evidence: F5, I4.
  - Touches: `src-tauri/src/physics/earthquake.rs` (rewrite peak_seafloor_uplift_m + add field method).
  - Acceptance: Tōhoku 2011 central subfault → ~7 m vertical uplift on seafloor.
  - Verify: Unit test against published Fujii-Satake 2013 finite-fault solution.

- [ ] **P1 — Add Krakatoa 1883 preset (fix doc/code drift I5)**
  - Why: README claims it; users will look for it.
  - Evidence: I5.
  - Touches: `src-tauri/src/presets.rs`.
  - Acceptance: 11 presets total; Krakatoa flies to Sunda Strait (-6.10, 105.42).
  - Verify: `list_presets` returns 11 entries.

- [ ] **P1 — Bundle offline bathymetry (F4: SRTM15+ or GEBCO 2024 + Natural Earth coastlines)**
  - Why: Cesium ion offline policy + classroom/airgapped use.
  - Evidence: F4 + Cesium ion pricing T&C.
  - Touches: New `src-tauri/src/data/{bathymetry,coastlines}.rs`, new `assets/data/` (gitignored), download script `scripts/fetch-bathymetry.sh`, `Cargo.toml` (+ `netcdf`), Settings UI option.
  - Acceptance: With network disabled, app still renders globe + runs solver.
  - Verify: `airplane mode → click Chicxulub → globe + wave still works`.

### Phase 0.3 — Polish + new physics (target v0.3.0)

- [ ] **P2 — Side-by-side comparison mode (F7)**
- [ ] **P2 — Hunga Tonga atmospheric Lamb-wave source (F9; depends on F2 solver)**
- [ ] **P2 — DART buoy historical overlay for 4 modern presets (F8)**
- [ ] **P2 — Inundation polygons (F13; depends on F2 + F4)**
- [ ] **P2 — Scenario export: PNG screenshot + CZML deep-link (F10 partial; MP4 deferred)**
- [ ] **P2 — Citation in-app modal (I14)**
- [ ] **P2 — Tighten shell:allow-open allowlist (I15)**
- [ ] **P2 — Cesium code-splitting in vite.config.ts (I16)**
- [ ] **P2 — Light theme toggle (I9)**
- [ ] **P2 — Globe empty / loading states (I7, I8)**
- [ ] **P2 — `Globe.tsx` entity diff/in-place mutation (I12)**

### Phase 0.4 — GPU + Boussinesq (target v0.4.0+)

- [ ] **P2 — Replace CPU SWE leapfrog with full WGSL compute pipeline + ping-pong textures** (extends F2)
- [ ] **P3 — Boussinesq dispersive solver as opt-in alternative** (FUNWAVE-TVD-style; needed for nearshore Chicxulub validation)
- [ ] **P3 — Adaptive Mesh Refinement** (GeoClaw-style; coarse far-field + fine coastal in one solve)

### Phase 1.0 — Release readiness

- [ ] **P1 — Code signing (macOS Gatekeeper, Windows Authenticode)**
- [ ] **P1 — Auto-updater (`tauri-plugin-updater` with Ed25519-signed manifest)**
- [ ] **P2 — Onboarding overlay (3-step first-time experience)**
- [ ] **P2 — User manual under `docs/`**
- [ ] **P2 — Screenshots in README (per project rule)**
- [ ] **P3 — Population casualty overlay (F14; opt-in, heavy disclaimer)**
- [ ] **P3 — MP4 timeline recording export (F10 second half)**

---

## Quick Wins

Order-of-doing for a single afternoon:
1. Delete `_suppress_unused_mt_constant` and the `matches!` dead-code in `commands.rs` (I6, 5 min).
2. Add `RoadblockDisclaimer` modal with `tauri-plugin-store` flag (I10, 2 hours).
3. Globe empty-state overlay when `initial === null` (I7, 1 hour).
4. Loading badge while `createWorldBathymetryAsync` resolves (I8, 1 hour).
5. Bounds-check scenario form inputs (G2, 30 min).
6. Wire the citation footer to a clickable list opening URLs (I14 minimum, 1 hour).
7. Fix `mean_depth_m` hardcoded 4000 (1 hour).
8. Add `is_speculative` flag to presets and the ⚠ icon (I11, 2 hours).

That's a half-day of work that materially improves perceived quality.

---

## Larger Bets

Items requiring multi-week effort and dedicated design:

- **B1 — Full GPU SWE solver with grid streaming to Cesium** (F2 + F4). 4-6 weeks. The most important bet — gates every downstream physics feature. Risk: wgpu compute pipelines have subtle correctness issues; allocate time for analytical-solution validation.

- **B2 — Offline-only build profile** (no Cesium ion at all; locally rendered raster globe via three-globe or a custom shader). 2-3 weeks. De-risks the long-term licensing dependency. Lets the project ship on classroom networks, airgapped science labs, and government computers.

- **B3 — Atmospheric coupling for Hunga Tonga–class events** (F9). 3-4 weeks after F2 lands. Research-frontier physics — no consumer competitor has it.

- **B4 — Inundation engine** (F13). 3-4 weeks after F2 + F4. Wetting/drying SWE handling + GeoJSON polygon extraction + Cesium rendering. The "real" version of runup beyond the Synolakis closed-form.

- **B5 — Population casualty model** (F14). 2 weeks of code + significant editorial review. High value but high responsibility. Defer until the project has earned trust through the simpler physics features.

---

## Explicit Non-Goals

- **Real-time tsunami forecasting / warning integration with NOAA NTWC.** Operational warning is a 10+ year program with regulatory compliance, redundancy, telecommunications integration — out of scope and dangerous to imply. We will explicitly never label this app for warning use.

- **Fortran or C++ port for HPC.** This is a desktop app for laptops, not a cluster code. GeoClaw / FUNWAVE / MOST already serve the HPC niche.

- **Inversion of seismic data to source parameters.** Tools like SIFT (NOAA Short-term Inundation Forecast for Tsunamis) do this. We're forward-modeling only.

- **Mobile (iOS / Android) port.** Tauri 2 supports mobile but Cesium ion + WebGL2 + 4 MB JS bundle is too heavy for current mobile WebViews. Re-evaluate in 2027.

- **Stochastic / Monte Carlo hazard assessment.** Ward & Asphaug 2000 do this for asteroid hazard rates; PTHA (Probabilistic Tsunami Hazard Analysis) is a research field of its own. Out of scope.

- **Real-time multiplayer / collaborative scenarios.** Tempting but distracting from the core simulation work.

- **Anything that requires a paid Cesium ion seat by default.** The project must always have an offline / free-token path.

- **Replication of NUKEMAP's full nuclear-effects suite (fireball, fallout, thermal radiation).** That's NUKEMAP's job, and Wellerstein does it better than we ever will. We model the *tsunami* generated by an underwater burst — not the airburst effects on land.

---

## Open Questions

> Only the items that materially block prioritization. Anything answerable by inspection or public-source research is *not* listed here.

1. **What license does the user want for the bundled GEBCO/SRTM15+ data?** Both are public-domain / CC-BY 4.0, so neither blocks shipping. But if the user later wants a "lite" installer without bundled data + a "complete" installer with it, the choice of `data/` partition affects build pipeline. Assumption: SRTM15+ V2.6 (CC-BY 4.0) bundled, GEBCO 2024 available via "Download data" wizard. — *Verify: ask user, or pick SRTM15+ and document.*

2. **Cesium ion or self-hosted tiles for v1.0?** Cesium ion is the path of least resistance and what the v0.0.1 scaffold uses. Self-hosting GEBCO + Natural Earth tiles (e.g., via `tippecanoe` + a small bundled HTTP server) costs ~2 weeks of work and removes the licensing dependency entirely. — *Decision blocks F3 design; can default to "both supported; ion by default, self-host on opt-in" but the work has to land somewhere.*

3. **Should the project accept user-submitted historical presets via PR (Sumatra 1797, Lisbon 1755, etc.) or curate centrally?** Curation maintains quality but caps coverage. — *Assumption: open to PRs, with a schema for citing the source paper required in the PR template (to be added).*

4. **What's the casualty model editorial line?** F14 is potentially the most-misused feature. Range of options: (a) ship it with heavy disclaimers, (b) make it a separate optional plugin, (c) never ship it and link to NUKEMAP for the population-effects use case. — *Decision needed before F14 starts. Default assumption: (b) plugin / opt-in.*

5. **Does the project want to integrate with NOAA SIFT or just compare against DART?** Pure comparison (F8) is low-risk: just plot observed vs. modeled. Integration would mean fetching SIFT pre-computed scenarios from NOAA's API — useful but operationally complex. — *Assumption: stick to DART historical comparison; SIFT integration deferred indefinitely.*

---

## Appendix — Recommended File Tree After v0.3.0

```
TsunamiSimulator/
├── .github/
│   ├── dependabot.yml
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug.yml
│   │   ├── preset-request.yml
│   │   └── physics-issue.yml
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── workflows/
│       ├── ci.yml
│       └── release.yml
├── assets/
│   ├── branding/{logo.png,banner.png}
│   └── data/{coastal_points.json,dart/*.nc,bluemarble/}
├── docs/
│   ├── science/
│   │   ├── REFERENCES.bib
│   │   ├── asteroid.md       (Ward-Asphaug derivation)
│   │   ├── nuclear.md        (Glasstone-Dolan + Le Méhauté derivation)
│   │   ├── landslide.md      (Heller-Hager + Watts derivation)
│   │   ├── earthquake.md     (Okada 1985 derivation)
│   │   ├── shallow_water.md  (SWE + Synolakis + dispersion notes)
│   │   ├── atmospheric.md    (Lamb-wave coupling notes)
│   │   └── README.md
│   └── user-manual/
│       ├── presets.md
│       ├── custom-scenario.md
│       └── interpreting-results.md
├── src/
│   ├── components/
│   │   ├── Globe.tsx
│   │   ├── PresetSelector.tsx
│   │   ├── ScenarioBuilder.tsx           (tabbed)
│   │   ├── ResultsPanel.tsx
│   │   ├── Settings.tsx                  (new)
│   │   ├── FirstRunDisclaimer.tsx        (new)
│   │   ├── CitationsModal.tsx            (new)
│   │   ├── CoastalRunupOverlay.tsx       (new)
│   │   ├── DartOverlay.tsx               (new)
│   │   └── CompareView.tsx               (new)
│   ├── data/
│   │   └── coastal_points.json
│   ├── lib/
│   │   ├── cesium.ts
│   │   ├── tauri.ts
│   │   ├── settings.ts                   (new)
│   │   ├── export.ts                     (new)
│   │   └── theme.ts                      (new)
│   ├── types/
│   │   ├── scenario.ts                   (auto-gen from ts-rs)
│   │   └── settings.ts                   (new)
│   ├── App.tsx
│   ├── main.tsx
│   └── styles.css
└── src-tauri/
    ├── capabilities/default.json
    ├── icons/                            (generated)
    └── src/
        ├── commands.rs
        ├── lib.rs
        ├── main.rs
        ├── presets.rs
        ├── data/
        │   ├── bathymetry.rs             (new)
        │   ├── coastlines.rs             (new)
        │   ├── dart.rs                   (new)
        │   └── population.rs             (new, optional)
        └── physics/
            ├── mod.rs
            ├── constants.rs
            ├── asteroid.rs
            ├── nuclear.rs
            ├── landslide.rs
            ├── earthquake.rs
            ├── atmospheric.rs            (new — Lamb wave)
            ├── shallow_water.rs
            └── solver/                   (new)
                ├── mod.rs
                ├── grid.rs
                ├── time_step.rs
                ├── wetdry.rs
                └── kernels.wgsl
```
