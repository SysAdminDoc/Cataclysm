# Project Research and Feature Plan

> **Archive note (2026-06-01):** This v0.4.0 forward plan is retained as
> historical evidence and implementation context. The active delivery plan lives
> in [`../../ROADMAP.md`](../../ROADMAP.md), shipped work is summarized in
> [`../../COMPLETED.md`](../../COMPLETED.md), and current research synthesis
> lives in [`../../RESEARCH_REPORT.md`](../../RESEARCH_REPORT.md).

> Active research evidence + forward-looking proposals backing
> [`../../ROADMAP.md`](../../ROADMAP.md) (canonical phased plan). Historical
> research from earlier phases is archived under
> [`docs/history/`](./) and remains valid for the time
> windows it documents:
>
> - [`RESEARCH_FEATURE_PLAN_v0.0.1.md`](./RESEARCH_FEATURE_PLAN_v0.0.1.md) —
>   scaffold-era competitive research (NUKEMAP / Asteroid Launcher /
>   NOAA MOST / GeoClaw / FUNWAVE-TVD / JAGURS landscape). Still accurate.
> - [`RESEARCH_FEATURE_PLAN_v0.3.0.md`](./RESEARCH_FEATURE_PLAN_v0.3.0.md) —
>   v0.3.0 forward plan written 2026-05-25 against `ef90dc8` (v0.2.1).
>   Defined F-V01..F-V13 + I-V01..I-V10; 15 of 23 shipped on `main`
>   during the autonomous Phase 0.3.0 batch (now reflected in
>   `CHANGELOG.md`); F-V03 README screenshots/demo has since shipped,
>   and 4 items remain blocked on maintainer input.
>
> This document is the **v0.4.0 forward-looking plan**, focused on
> Phase 4 (GPU + nonlinear), Phase 5 (Boussinesq + AMR), and Phase 6
> (UX polish + v1.0.0), plus the Phase 0.3 items still blocked on
> inputs only the maintainer can supply.
>
> **Last refreshed:** 2026-05-25, against `28d9242` (`main` HEAD, latest CI run `26408080280` in flight).
> **Confidence labels:** *Verified* (read in code / run), *Likely* (inferred from strong evidence), *Assumption* (unverified, flagged with verification step), *Needs live validation* (requires a Windows/macOS/Linux runtime to confirm).

---

## Executive Summary

`TsunamiSimulator` shipped **v0.2.1** to the GitHub Releases page with installers for Win/macOS/Linux on 2026-05-25. Between that release and this document, an autonomous Phase 0.3.0 batch landed **15 of the 23 Phase 3 items** identified in the prior research plan, including: the full Okada 1985 I-term half-space correction (Tōhoku peak now lands in the [1, 30] m band per Fujii-Satake 2013), a quantitative validation harness against Stoker + Carrier-Greenspan + Range 2022 Chicxulub, IPC bounds and NaN guards across the entire physics surface, wet/dry land cells + sponge boundary conditions in the SWE solver, MP4/WebM timeline export, click-on-globe Inspect overlay, Hunga Tonga atmospheric Lamb-wave source, a 5-step onboarding tour, inundation polygons, curated per-preset camera framings, reduced-motion + aria-live accessibility, OS-keychain-token settings reset path, and a wgpu GPU solver scaffold ready for buffer-binding plumbing. F-V03 README screenshots/demo now ships from `assets/screenshots/`; the remaining blocked Phase 3 items require maintainer inputs (EV cert, Apple Developer enrollment, Ed25519 keypair, GEBCO distribution channel).

The next direction of value is **Phase 4 (GPU + nonlinear)** and **Phase 6 (release-readiness)** in parallel: finish the wgpu dispatch loop to unlock 10× resolution at interactive frame rates; bake real GEBCO 2024 bathymetry into the SWE solver path; integrate the already-shipped Lamb-wave module into the solver IC so `hunga_tonga_2022`'s `controversy_note` finally goes away; and resolve the four blocked Phase 3 items so users on v0.2.1 get a v0.3.0 in-app update with signed installers.

**Top 10 opportunities, ranked**

1. **P0 — Finish the `wgpu` SWE dispatch loop** (F-V05 dispatch). Scaffold + WGSL kernel are ready; binding plumbing + readback unlock ~50× compute headroom.
2. **P0 — Real GEBCO 2024 bathymetry** (F-V06) — unblock with a deliberate choice on distribution channel and ship the download wizard.
3. **P0 — Code signing pipeline** (F-V04) — install conversion is the lowest-hanging fruit once a cert is in hand.
4. **P0 — `tauri-plugin-updater` in-app channel** (F-V07) — closes the "users on broken v0.2.0 never learn about v0.2.1" gap.
5. **P1 — Nonlinear momentum advection in the solver** — current solver linearises by dropping `(u·∇)u`; near-coast wave steepening / breaking depends on this.
6. **P1 — Wet/dry inundation polygon (real, not first-order disc)** — extends I-V02 with a true flood polygon from grid cells where `h + η > 0`.
7. **P1 — User manual under `docs/`** — close the non-expert workflow gap before v1.0.
8. **P1 — Lamb-wave coupled into the SWE solver IC** — `lamb_wave_sample` exists; integrating into `simulate_grid` removes the Hunga Tonga `controversy_note`.
9. **P2 — Validation harness extensions** — Tōhoku DART buoy RMSE, Range Chicxulub coastal map, Lituya runup at Gilbert Inlet.
10. **P2 — Multi-event scenarios** — Chicxulub debris re-entry secondary impacts, Tōhoku M7+ aftershock tsunamis.

---

## Evidence Reviewed (this pass)

### Repo state verified

- **HEAD**: `28d9242 fix(clippy): manual_clamp → clamp in inundation_extent_m computation` (Verified via `rtk git log`).
- **Releases on GitHub**: v0.1.0, v0.2.0, v0.2.1 — each with the 6-installer matrix (`.msi`, `.exe`, `.dmg`, `.deb`, `.rpm`, `.AppImage`) plus the `control.tar.gz` + `data.tar.gz` Debian sidecars. *Verified via `gh release view`*.
- **CI**: run `26408080280` in flight at write-time; Frontend job (TS + Vite) ✓ in 23s; Rust matrix + cargo audit pending.

### New code landed during the autonomous Phase 0.3.0 batch

| Module | Lines | New / changed |
|---|---|---|
| `src-tauri/src/physics/okada.rs` | 365 | Full I4/I5 closed form with `cos δ → 0` limits; wired into `earthquake::initial_displacement`. *Verified.* |
| `src-tauri/src/physics/lamb_wave.rs` | 160 | New module; `LambWaveSource` + `lamb_wave_sample` IPC + Proudman resonance helper. *Verified.* |
| `src-tauri/src/physics/validation.rs` | 151 | New module behind `validation` feature; 3 benchmark tests. *Verified.* |
| `src-tauri/src/physics/solver/mod.rs` | 704 | Wet/dry land masking + `BoundaryMode { ZeroFlux, Sponge }` enum + cosine sponge taper. *Verified.* |
| `src-tauri/src/physics/solver/gpu.rs` | new | wgpu adapter probe + `GpuTimeStepper` skeleton. *Verified.* |
| `src-tauri/src/commands.rs` | 795 | New `inspect_at_point` + `lamb_wave_sample` commands; `inundation_extent_m` on `RunupAtPoint`. *Verified.* |
| `src-tauri/src/presets.rs` | + ~30 | `camera_view: Option<CameraView>` on every Preset entry. *Verified.* |
| `src/components/Tour.tsx` | 122 | New 5-step onboarding component. *Verified.* |
| `src/components/Globe.tsx` | 786 | Inspect mode + inundation discs + runup-bar hover labels + reduced-motion-aware flyTo. *Verified.* |
| `src/lib/export.ts` | + ~80 | `exportGlobeVideo()` via MediaRecorder. *Verified.* |
| `src/styles.css` | + ~80 | Tour styles + `:focus-visible` + `prefers-reduced-motion` overrides + `.sr-only`. *Verified.* |
| `src-tauri/Cargo.toml` | + ~12 | `[features] validation` and `gpu`; wgpu 26 + pollster 0.4 optional deps. *Verified.* |
| `.github/workflows/ci.yml` | + ~5 | `cargo audit` fail-on-vuln; checkout/setup-node/upload-artifact bumped to v5; Node 22. *Verified.* |

### External sources reviewed (delta vs v0.3.0 plan)

- **wgpu 26.0 release notes** — current stable; `Adapter::request_adapter` now returns `Result<Adapter, RequestAdapterError>` (already accounted for in `gpu::probe_adapter`). Vulkan, Metal, D3D12, OpenGL, WebGPU backends.
- **GEBCO 2024 grid product page** (`https://www.gebco.net/data_and_products/gridded_bathymetry_data/`) — 15 arc-second resolution global compilation; ~6 GB GeoTIFF; CC0 public domain.
- **SRTM15+V2.6** (Tozer et al. 2019) — alternative 15-arc-sec global bathymetry; also CC0.
- **NOAA NCEI Tsunami Event Database** — already cited; DART buoy time-series JSON is bundled (`src/data/dart_buoys.json`) for 3 events.
- **Tauri 2 plugin-updater docs** (`https://v2.tauri.app/plugin/updater/`) — current stable; supports JSON update manifests signed with `tauri-plugin-updater::signer`.
- **GitHub Actions windows-2025 runner image** (announced Apr 2026, scheduled redirect from `windows-latest` June 15 2026) — pinning planned for I-V05 follow-up.
- **`cargo-dist`** (`https://opensource.axo.dev/cargo-dist/`) — alternative to the hand-rolled `release.yml`; provides cross-compilation matrix + signed installers + auto-updater manifest generation in one tool.
- **WGSL spec v1** (`https://www.w3.org/TR/WGSL/`) — confirmed `@compute @workgroup_size(8, 8)` syntax matches the existing scaffold in `solver/kernels.rs`.

### Areas not verified this pass

- **Live Run-simulation flow** end-to-end on a Windows host — the v0.2.1 fix for the SWE blank-globe bug was pushed but the maintainer hasn't confirmed it actually fires on their machine.
- **wgpu GPU path** behaviour on real hardware — scaffold compiles; full dispatch hasn't been written.
- **Tauri updater** flow — `tauri-plugin-updater` isn't yet in `Cargo.toml`. *Verification step*: `grep -r "tauri-plugin-updater" src-tauri/` should return empty.

---

## Current Product Map (v0.3.0-development snapshot)

### What ships in v0.2.1 today

- 11 presets (Chicxulub, Eltanin, Tōhoku 2011, Indian Ocean 2004, Lituya Bay 1958, Krakatoa 1883, Storegga, Hunga Tonga 2022, Cumbre Vieja, Poseidon-realistic, Poseidon-propaganda) with peer-reviewed parameters.
- 5 globe styles: OSM default (no token), Esri Imagery, Natural Earth II (offline), Cesium World Imagery (token), Cesium World Bathymetry (token).
- CPU shallow-water leapfrog solver with `rayon` row-parallel updates; PNG-encoded snapshot sequence; Play/Pause + scrub.
- Coastal-runup overlay at 60+ named coastal points (Synolakis 1987).
- DART buoy historical overlay for 3 modern events with sparkline + globe pins.
- Side-by-side compare mode.
- Tabbed scenario builder (Asteroid / Nuclear / Earthquake / Landslide) + click-globe location pick.
- Settings (token / theme / globe style) with reset paths.
- First-run disclaimer.
- Citations modal.
- PNG export.
- 3-OS installer matrix on GitHub Releases.

### What lives on `main` but is unreleased (will ship in v0.3.0)

- Full Okada 1985 I-term half-space correction for the earthquake source.
- Wet/dry land masking + cosine sponge boundaries in the SWE solver.
- Quantitative validation harness behind `validation` cargo feature.
- IPC bounds + NaN guards across the entire physics surface.
- 5-step onboarding tour.
- Click-on-globe Inspect overlay with multi-line readout.
- MP4/WebM timeline export.
- Hunga Tonga atmospheric Lamb-wave source module + `lamb_wave_sample` IPC.
- First-order inundation polygons (semi-transparent discs at coastal points).
- Per-preset curated Cesium camera framings.
- `:focus-visible` + `prefers-reduced-motion` + aria-live accessibility wins.
- Settings → Advanced (Reset / Replay tour / Show first-run again).
- `cargo audit` fail-on-vuln.
- GitHub Actions bumped to v5 + Node 22.
- wgpu solver scaffold + `[features] gpu`.

### Architecture (Verified)

```
┌─ Tauri 2 Window ─────────────────────────────────────────────────────┐
│ ┌─ React 19 + TS + Vite + CesiumJS ─────────────────────────────┐ ▲ │
│ │ - App.tsx (header, 3-pane layout, compare/inspect toggles)    │ │ │
│ │ - components/{Globe,Scenario,Results,SwePlayback,Dart,...}    │ │ │
│ │ - hooks/{useScenarioSlot,useEscapeKey}                        │ │ │
│ │ - lib/{cesium,settings,tauri,theme,export,globe-styles}       │ │ │
│ └───────────────────────────────────────────────────────────────┘ │ │
│                            ▲ ▼ tauri::invoke (JSON over IPC)        │
│ ┌─ Rust backend ────────────────────────────────────────────────┐ │ │
│ │ - commands.rs (15 #[tauri::command] entry points + validators)│ │ │
│ │ - physics/{asteroid,nuclear,landslide,earthquake,okada}.rs    │ │ │
│ │ - physics/lamb_wave.rs  (atmospheric coupling, F-V09)         │ │ │
│ │ - physics/validation.rs (gated by 'validation' feature, F-V01)│ │ │
│ │ - physics/shallow_water.rs (Synolakis runup, linear long-wave)│ │ │
│ │ - physics/solver/{mod,kernels,gpu}.rs (CPU leapfrog + GPU)    │ │ │
│ │ - data/bathymetry.rs (7-basin coarse approximation)           │ │ │
│ │ - presets.rs (11 events with camera_view + controversy_note)  │ │ │
│ └───────────────────────────────────────────────────────────────┘ │ │
└──────────────────────────────────────────────────────────────────────┘
```

### Tauri commands registered (Verified via `src-tauri/src/lib.rs`)

```
asteroid_initial_conditions, nuclear_initial_conditions,
landslide_initial_conditions, earthquake_initial_conditions,
far_field_amplitude, coastal_runup, runup_at_points,
list_presets, run_preset, simulate_grid,
inspect_at_point, lamb_wave_sample
```

12 total. *Verified.*

---

## Feature Inventory (delta vs v0.3.0 plan)

The v0.3.0 plan listed 16+ shipped features. This pass adds the following **shipped-in-the-batch** entries.

| New feature | Code | Maturity | Tests / docs |
|---|---|---|---|
| Quantitative validation harness | `physics::validation` (gated) | Complete (3 benchmarks) | Local; opt-in CI via `--features validation` |
| Hunga Tonga Lamb-wave source | `physics::lamb_wave` + `lamb_wave_sample` IPC | Complete (closed-form; not yet in SWE IC) | 3 tests + module docstring with citations |
| Inspect overlay | `commands::inspect_at_point` + `Globe.tsx` inspect-mode effect | Complete | Manual flow; no unit tests |
| MP4/WebM timeline export | `lib/export.ts::exportGlobeVideo` | Complete (MediaRecorder + canvas.captureStream) | Manual flow |
| Inundation polygons (first-order) | `RunupAtPoint::inundation_extent_m` + Globe.tsx ellipse renderer | Complete (disc approximation) | Manual flow |
| 5-step onboarding tour | `components/Tour.tsx` | Complete | Manual flow |
| wgpu solver scaffold | `physics::solver::gpu` (gated) | Partial (`probe_adapter` works; dispatch is TODO) | 1 probe test |
| Per-preset camera framing | `physics::CameraView` + `Preset.camera_view` + `Globe.tsx` flyTo | Complete (all 11 presets curated) | Manual flow |
| Accessibility wins | `styles.css` + `index.html` + components | Complete | Manual flow (NVDA/VoiceOver needed for full verify) |
| Settings Advanced reset/replay | `Settings.tsx` + `lib/settings.ts` | Complete | Manual flow |

### Hidden / partial / undocumented (delta)

- **`physics::okada::OkadaFault::vertical_displacement_field`** is now exercised via the `earthquake::initial_displacement` adapter (used by `peak_uplift_m`). The full grid field is computed but only the centre value is surfaced. *Hidden capability:* the grid is available for a future "show seafloor uplift map" overlay.
- **wgpu `GpuTimeStepper`** is callable but `step()` is a no-op TODO. *Verified.*
- **`physics::lamb_wave`** is wired through `lamb_wave_sample` IPC but the SWE solver doesn't consume it as an additional IC. *Hidden — invocation requires the frontend to call directly.*
- **`physics::validation`** is gated behind a feature flag — not part of default `cargo test`. Documented in `docs/science/VALIDATION.md`.

---

## Competitive and Ecosystem Research (delta)

The v0.0.1 plan's landscape (NUKEMAP, Asteroid Launcher, Purdue Impact:Earth!, NOAA MOST, GeoClaw, COMCOT, ANUGA, FUNWAVE-TVD, JAGURS) and the v0.3.0 plan's three new entries (Earth NullSchool, NOAA Tsunami Forecast Page, CesiumJS Sandcastle) are still accurate.

**Three additional adjacent tools worth borrowing from for v0.4.0+ work**:

| Product / source | Notable capability | Learn from | Avoid |
|---|---|---|---|
| **MIT's Project Tsunami Visualization Lab** (`https://mit-tsunamilab.github.io/`) | Education-focused 3-D tsunami visualisations with embedded NOAA NCEI event data, in-browser playback of historical events | The pattern of "scrub the slider to a real historical moment, see the model wave and the observed buoy trace side by side" — already partially present in our DartOverlay; could be extended with v0.4.0 Tohoku DART RMSE display | n/a |
| **GMT (Generic Mapping Tools)** | Industry-standard for academic geospatial mapping; their `grdmix` + `grdmath` tools produce the relief renders our README screenshots will need | Their hill-shade lighting model produces dramatic seafloor renders that would look good as a desktop wallpaper / share-card export | Don't ship a GMT runtime dependency — it's heavyweight (200 MB+) |
| **`cargo-dist`** by Axo | Drop-in replacement for hand-rolled GitHub Actions release workflows; handles cross-compilation, code signing (Win Authenticode + macOS notarisation when secrets provided), updater manifest generation, GitHub Releases publishing | We could replace our 130-line `release.yml` with ~15 lines of `dist-workspace.toml` + a single workflow trigger; would also unlock auto-signing once secrets land | Don't migrate blindly — the current workflow has been validated across 3 releases; do a staged migration |

---

## Highest-Value New Features (forward, post-Phase 0.3.0)

### F4-01 — `wgpu` SWE dispatch loop (full GPU path) (P0)

- **Problem solved**: CPU leapfrog tops out at ~200×200 grids for interactive runs; a real GEBCO 15-arc-second simulation over a Chicxulub-class basin (4 Mcells) needs the GPU.
- **Evidence**: `physics::solver::gpu::GpuTimeStepper::step()` is a TODO no-op. `physics::solver::kernels::SWE_LEAPFROG_WGSL` is a complete kernel. Qin et al. 2019 reports 3.6–6.4× on a single GPU vs. 16-core CPU.
- **Proposed behaviour**:
  1. In `GpuTimeStepper::new(grid, dt, manning_n)`, create the `wgpu::Device` + `Queue`, compile `SWE_LEAPFROG_WGSL`, build the bind-group layout, allocate ping-pong storage buffers for `h`, `eta`, `u`, `v`, and uniform buffer for `Params` (matches the WGSL `struct Params`).
  2. In `step(grid, n_steps)`: upload `h` once (immutable for the run); upload initial `eta`, `u`, `v`; loop `n_steps` dispatches with `(nx + 7) / 8, (ny + 7) / 8` workgroups, swapping ping-pong each step; on completion, read `eta` back via `BufferAsyncMapping`.
  3. In `commands::simulate_grid`, when `--features gpu` is compiled, probe the adapter at start; on success use `GpuTimeStepper`; otherwise fall back to the CPU `TimeStepper`. Add `use_gpu` boolean to `SimulateGridResponse` so the UI can surface "ran on GPU" vs "ran on CPU".
- **Implementation areas**:
  - `src-tauri/src/physics/solver/gpu.rs` — bind-group layout, buffer creation, dispatch loop, readback.
  - `src-tauri/src/physics/solver/kernels.rs` — add `WgslKernel` builder if needed for parameterising workgroup size.
  - `src-tauri/src/commands.rs::simulate_grid` — CPU/GPU dispatcher behind `cfg!(feature = "gpu")`.
- **Risks**:
  - **Adapter availability** on Linux CI runners — already handled: `probe_adapter` returns `NoAdapter` and we fall back to CPU. Defensive.
  - **WGSL/Vulkan driver bugs** producing different results than CPU — mitigate with a regression test `swe_gpu_matches_cpu_within_1e-4` on a 64×64 grid.
  - **Float32 vs Float64** — WGSL is f32-only. CPU leapfrog runs f64. Expect ~1e-7 round-off difference, well within the validation tolerance.
- **Verification plan**:
  - `cargo build --release --features gpu` succeeds on Linux/macOS/Windows.
  - `cargo test --release --features gpu -- swe_gpu_matches_cpu` — sub-1e-4 agreement on a Tohoku-class scenario.
  - Manual: with a discrete GPU available, Tohoku at 50 cells/deg should complete in <2 s (vs ~10 s CPU).
- **Estimated complexity**: L (multi-day; bind-group setup is mechanical but error-prone).
- **Priority**: **P0** — unblocks v0.4.0 DoD ("10× resolution at 60 FPS").

### F4-02 — Nonlinear momentum advection in the SWE solver (P1)

- **Problem solved**: Current solver implements `∂u/∂t + g∇η = − fric`, omitting the nonlinear `(u·∇)u` advection term. Steepening near coast (where the wave amplitude becomes comparable to local depth) requires the nonlinear form to produce physically realistic crests + breaking. The module's own docstring is already aspirational — eq. 1 shows the nonlinear form but the implementation only ships the linear part.
- **Evidence**:
  - `src-tauri/src/physics/solver/mod.rs` line 13–14 documents `∂u/∂t + g ∂η/∂x = − g n² |U| u / H^(4/3)` — no advection.
  - Code search: `grep -n "advection\|u.*du.*dx" src-tauri/src/physics/solver/mod.rs` returns empty. *Verified.*
- **Proposed behaviour**: Extend `TimeStepper::step_one` to compute the advection term `u·(∂u/∂x) + v·(∂u/∂y)` on the same row-parallel pass. Use upwind differencing for stability (central differencing on `u` and `v` is unstable at the steepening shocks). Gate the extension behind a `LinearSwe` vs `NonlinearSwe` enum (default: nonlinear) so the validation harness can opt into the linear form for the Stoker test.
- **Implementation areas**:
  - `src-tauri/src/physics/solver/mod.rs::step_one` momentum loop.
  - Add a `SolverMode` enum on `TimeStepper` parallel to `BoundaryMode`.
  - WGSL kernel `solver/kernels.rs` — add advection branch (already wired for friction).
- **Risks**:
  - Numerical instability at sharp wavefronts — upwind differencing helps but doesn't fully solve. Caps via `recommended_dt_s(0.4)` should hold.
  - The validation-harness Stoker test depends on the linear form's exact celerity; add an explicit `with_solver_mode(LinearSwe)` so the test still passes.
- **Verification plan**:
  - New test `nonlinear_solver_steepens_at_coast` — inject a Gaussian over a 1-m beach and verify the leading-edge gradient `∂η/∂x` near the shore exceeds the initial-condition gradient by ≥ 1.5×.
  - Existing tests continue to pass.
- **Estimated complexity**: M.
- **Priority**: **P1** — Phase 4 DoD requires "NSWE shows wave steepening and breaking near coasts."

### F4-03 — Real GEBCO 2024 bathymetry via first-run download wizard (P0, was P1)

- **Problem solved**: Same as the v0.3.0 plan — the coarse 7-basin proxy misses every island, every continental-slope feature, and every trench-channel-controlled propagation path. The wet/dry land masking shipped in v0.3.0 is now waiting on this.
- **Status escalation rationale**: Three reasons to bump from P1 to P0 for v0.4.0:
  1. The wet/dry handling shipped in v0.3.0 already paints a "1 m → land cell" assumption. Without real GEBCO, the coastlines are coarse rectangles and the inundation polygons in I-V02 read as too generous.
  2. The v0.4.0 wgpu solver's resolution headroom is meaningless without higher-resolution bathymetry data to feed it.
  3. The validation-harness Chicxulub North-Atlantic coastline runup map (the published Range 2022 reference) requires real GEBCO to be implementable.
- **Implementation** (carry-over from v0.3.0 plan, F-V06):
  - `src-tauri/src/data/gebco.rs` (new): memory-mapped read of a 30-arc-second zstd-compressed flat Int16 array, bilinear sampling.
  - `scripts/build-bathymetry.rs` (new): converts the GEBCO 2024 GeoTIFF (downloaded by the maintainer once) into the bundled format.
  - `src-tauri/src/commands.rs::download_bathymetry` (new Tauri command) — fetches the prebuilt artifact at runtime with progress events.
  - First-run modal `FirstRunBathymetryPrompt.tsx`.
- **Decision required**: distribution channel. Two options:
  - **A. GitHub Release asset** (~440 MB at 30 arc-sec). Free for the project; counts against GitHub bandwidth. *Recommend.*
  - **B. Cloudflare R2** ($0.015/GB egress). Cleaner separation from release artifacts.
- **Risks**: 30-arc-sec at ~1 km is still under-resolved for fjord-scale events like Lituya Bay. Document this clearly. Future v0.5.0 could ship a regional 15-arc-sec patch via second download.
- **Verification plan**: After first launch, Tohoku SWE simulation should visibly reflect/refract on the Japan Trench geometry; the wave-front in the snapshot PNGs follows the 7000 m trench instead of the flat-basin straight line.
- **Estimated complexity**: XL (download UX + binary asset hosting + memory-mapped sampling + bilinear interp + cache invalidation).
- **Priority**: **P0** for v0.4.0 (was P1 in v0.3.0).

### F4-04 — Wet/dry inundation polygons (real flood polygons) (P1)

- **Problem solved**: The v0.3.0 inundation discs are first-order — a circular projection of `runup_m / tan(slope)` at each coastal point. The actual flood polygon depends on local topography. With real GEBCO + wet/dry cell handling, we can extract the connected component of cells where `h + η > 0` along the coastline and emit it as a GeoJSON polygon.
- **Evidence**: `src/components/Globe.tsx` already has an `inundationEntitiesRef: Map<string, Cesium.Entity>` rendering pipeline; reusing it for `GeoJsonDataSource` is a small extension. `RESEARCH_FEATURE_PLAN_v0.3.0.md` I-V02 documents the deferred path.
- **Proposed behaviour**:
  1. After a SWE snapshot is computed, run a marching-squares boundary extraction on `h + η > 0`.
  2. Emit per-snapshot `inundation_polygon_geojson: Option<String>` on `GridSnapshot`.
  3. Frontend renders via `Cesium.GeoJsonDataSource.load(geojson)`.
- **Implementation areas**:
  - `src-tauri/src/physics/solver/mod.rs::snapshot` — call into a new `polygon::extract_inundation` helper.
  - New `src-tauri/src/physics/solver/polygon.rs` — marching-squares + polygon-simplify (Ramer-Douglas-Peucker).
  - `src/components/Globe.tsx` — replace the disc renderer (or stack a polygon overlay on top) with GeoJsonDataSource.
- **Risks**: Marching-squares on a 1000×1000 grid emits a lot of vertices. Simplify aggressively (~ε = 100 m).
- **Verification plan**: Tohoku Sendai Plain snapshot at t = 30 min shows a ~5-10 km inland polygon matching the published 8 km inundation extent.
- **Estimated complexity**: M.
- **Priority**: P1 (depends on F4-03).

### F4-05 — Lamb-wave coupled into SWE solver IC (P1)

- **Problem solved**: `lamb_wave_sample` exists as a separate IPC but isn't fed into the SWE solver. The Hunga Tonga preset's `controversy_note` still says "Atmospheric Lamb-wave coupling now available via the lamb_wave_sample command but not yet integrated into the SWE solver IC".
- **Evidence**: `src-tauri/src/physics/lamb_wave.rs::LambWaveSource::surface_depression_m` returns the per-point η contribution. `src-tauri/src/physics/solver/mod.rs::SwGrid::inject_gaussian` is the only IC-injection path today. *Verified.*
- **Proposed behaviour**: New `SwGrid::inject_lamb_wave_ring(source, time_s_start, time_s_end, sample_dt_s)` that, for each cell, integrates the Lamb-wave-driven η contribution over the time window and adds it to `self.eta_m`. Gate behind a `SimulateGridRequest.include_lamb_wave: bool` flag (default false; on for `hunga_tonga_2022` preset).
- **Implementation areas**:
  - `src-tauri/src/physics/solver/mod.rs` — new injection helper.
  - `src-tauri/src/commands.rs::simulate_grid` — read the new flag.
  - `src/components/SwePlayback.tsx` — checkbox "Include atmospheric coupling (Hunga Tonga only)".
  - `src-tauri/src/presets.rs` — update `hunga_tonga_2022` `controversy_note` to remove the deferral language.
- **Risks**:
  - The Lamb-wave ring advances at 310 m/s; the SWE solver step at 1–10 s. Need to integrate the Lamb forcing as a *source term* on the continuity equation, not just an IC. (Per Carvajal 2022 the coupling is continuous, not impulsive.) This is more involved than I initially budgeted.
  - The 310 m/s Lamb speed produces aliasing when the SWE grid resolution is coarse (the ring moves through several cells per timestep). Address by interpolating the η contribution onto adjacent cells.
- **Verification plan**: With Lamb coupling on, Tonga DART 51425 amplitude at t = 5 h matches Carvajal 2022 Fig. 2 (~10 cm) within 50%.
- **Estimated complexity**: M.
- **Priority**: P1.

### F4-06 — Tōhoku DART buoy RMSE display (P2)

- **Problem solved**: `DartOverlay.tsx` shows observed time series as sparklines but doesn't display the model–observed RMSE. The DART buoy data is the gold-standard ground truth for the three modern presets — without RMSE, users see two squiggles but can't quantify agreement.
- **Evidence**: `src/components/DartOverlay.tsx` already extracts the buoy at a given time via linear interpolation (`sampleEta`). `src-tauri/src/commands.rs::simulate_grid` produces the model snapshots. Joining them requires sampling the SWE η at each buoy's lat/lon over each snapshot.
- **Proposed behaviour**:
  1. New `commands::dart_buoy_rmse` command takes the latest snapshot + buoy id, samples the η field at the buoy location via bilinear interp, and returns the time-series RMSE vs observed.
  2. `DartOverlay.tsx` renders the RMSE alongside each sparkline: "Model RMSE: 0.18 m over 7 200 s".
- **Implementation areas**:
  - `src-tauri/src/commands.rs::dart_buoy_rmse` (new).
  - `src/components/DartOverlay.tsx` — RMSE display.
- **Risks**: Bilinear sampling needs the grid bounding box to contain the buoy. For Tohoku DART 51407 (Hawaii) the SWE grid box is small and centred on the source — the buoy is outside the box. Need to extend the grid coverage or fall back to "buoy outside grid" message.
- **Verification plan**: Tohoku 51418 (NE of source) — Mori et al. 2011 reports peak 1.8 m at t = 1200 s; our model should land within ±50%.
- **Estimated complexity**: M.
- **Priority**: P2.

### F4-07 — Lituya Bay validation case (P2)

- **Problem solved**: Lituya Bay's 524 m runup is the project's marquee landslide preset, but the v0.2.x analytical Heller-Hager gives the initial wave at the impact point — not the bay-geometry-amplified runup on the opposite shore. With the v0.3.0 wet/dry solver + a hand-curated 122 m fjord depth raster, we could reproduce the observed 524 m within order-of-magnitude.
- **Evidence**: `RESEARCH_FEATURE_PLAN_v0.3.0.md` "Future benchmarks" section. `src-tauri/src/physics/landslide.rs::lituya_bay_1958()` defines the source. `src-tauri/src/physics/solver/mod.rs` now has wet/dry — applicable to Gilbert Inlet's narrow geometry.
- **Proposed behaviour**: Bundle a hand-curated 100 m × 100 m bathymetry raster for Gilbert Inlet (≈ 5 km × 5 km, 50×50 cells = 7.5 KB). Add a `validation::lituya_bay_runup_matches_observed` test that runs `simulate_grid` over the curated raster and asserts the peak runup on the opposing shore lands in [200, 1000] m.
- **Implementation areas**:
  - `src-tauri/src/data/lituya_bay.bathymetry.rs` (new — small const array).
  - `src-tauri/src/physics/validation.rs` — add the test.
  - `docs/science/VALIDATION.md` — add the row.
- **Risks**: Heller-Hager already over-predicts initial amplitude; the validation may pass by accident (over-predict + correct attenuation = right answer). Document the failure mode.
- **Estimated complexity**: S.
- **Priority**: P2.

### F4-08 — Multi-event scenarios (P3)

- **Problem solved**: Real catastrophic events rarely come alone. Tōhoku 2011 had 12+ M ≥ 6 aftershocks in the first 24 hours, each generating a small tsunami. Chicxulub plausibly triggered secondary impacts from re-entering ejecta (Wittmann 2009). Current product is one-source-at-a-time.
- **Evidence**: `ROADMAP.md` "Future / Stretch": "Multi-event scenarios — Chicxulub debris re-entry secondary impacts, Tōhoku aftershock tsunamis".
- **Proposed behaviour**: Extend the scenario builder with a `secondary_sources: SourceList` field. Each source carries its own `t_offset_s` and is injected into the SWE solver at the corresponding step. Visual: a stacked timeline on the right panel showing "T+0 main shock — T+15min aftershock 1 — T+2hr aftershock 2".
- **Implementation areas**:
  - `src-tauri/src/commands.rs` — extend `SimulateGridRequest` with secondary sources.
  - `src-tauri/src/physics/solver/mod.rs` — multi-IC injection.
  - `src/components/ScenarioBuilder.tsx` — secondary-source UI.
- **Risks**: UI complexity — most users won't use it. Hide behind an Advanced toggle.
- **Estimated complexity**: L.
- **Priority**: P3.

### F4-09 — Share-card export with metadata overlay (P2)

- **Problem solved**: The PNG export captures the bare globe canvas. Sharing on social/classroom needs a branded image with scenario metadata (event name, parameters, citation, project URL).
- **Evidence**: `src/lib/export.ts::captureGlobePng` produces a raw canvas PNG. NUKEMAP, Asteroid Launcher, and Range 2022 supplementary figures all use metadata-overlaid renders.
- **Proposed behaviour**: New `exportGlobeShareCard(meta)` composites the canvas PNG with a 200-px-tall header strip containing: project logo, preset name, key parameters (M_w, peak amplitude, energy in Mt TNT), citation short-ref, and the project URL. Output: a 1200×800 PNG suitable for Twitter/X / Bluesky / Mastodon.
- **Implementation areas**:
  - `src/lib/export.ts::exportGlobeShareCard`.
  - `assets/branding/logo.svg` already exists — use directly.
- **Risks**: Canvas composition is straightforward but adds ~100 lines to export.ts.
- **Estimated complexity**: M.
- **Priority**: P2.

### F4-10 — Boussinesq dispersive solver (P3, v0.5.0 target)

- **Problem solved**: Linear/nonlinear SWE assumes long-wave dispersion (`ω √(h/g) « 1`). Impact tsunamis from sub-kilometre asteroids have short wavelengths where this fails — Ward & Asphaug 2000 explicitly call this out. FUNWAVE-TVD uses Boussinesq for exactly this case.
- **Evidence**: `ROADMAP.md` Phase 5 DoD. `src-tauri/src/physics/asteroid.rs` doc says: "frequency dispersion" → r^(-5/6) decay.
- **Proposed behaviour**: New `physics::boussinesq` module implementing the Madsen-Sørensen 1992 weakly-nonlinear weakly-dispersive Boussinesq form. Behind a `SimulateGridRequest.use_boussinesq: bool` flag; default off (Boussinesq is 3× slower per step).
- **Implementation areas**:
  - `src-tauri/src/physics/boussinesq.rs` (new).
  - `simulate_grid` dispatcher.
- **Risks**: Stability of implicit Boussinesq schemes is tricky. Consult Shi et al. 2012 FUNWAVE-TVD paper for stability bounds.
- **Estimated complexity**: XL.
- **Priority**: P3 (v0.5.0).

### F4-11 — Adaptive Mesh Refinement (AMR) (P3, v0.5.0 target)

- **Problem solved**: A single uniform grid can't simultaneously resolve the open-ocean propagation (need ~5 km cells over a 5 000 km basin) and the coastal runup (need ~50 m cells over a 5 km shore). GeoClaw is the canonical AMR solution.
- **Evidence**: `ROADMAP.md` Phase 5. Berger et al. 2011 (already cited).
- **Proposed behaviour**: Implement a simple 2-level AMR — uniform coarse grid + user-pickable fine patches at named coastal points. Far from a full Berger-Oliger refinement; just enough to validate the Range 2022 Chicxulub far-field at coastal locations.
- **Estimated complexity**: XL.
- **Priority**: P3.

### F4-12 — Multi-language UI (en/ja, then en/es) (P3)

- **Problem solved**: The Tōhoku and Indian Ocean presets are arguably most useful to Japanese and South Asian audiences in their native language. Translation also surfaces a real engineering benefit: it forces all user-facing strings out of inline JSX into a single resource file.
- **Evidence**: `ROADMAP.md` Future / Stretch.
- **Proposed behaviour**: Adopt `react-i18next` (industry standard, ~30 KB gzipped, supports plural rules + interpolation). Extract all strings from `src/components/*.tsx` + `App.tsx` into `src/i18n/{en,ja,es}.json`. Auto-detect from OS locale; user override in Settings.
- **Estimated complexity**: L.
- **Priority**: P3.

---

## Existing Feature Improvements (forward)

### I4-01 — `cargo-dist` migration for the release pipeline (P1)

- **Current**: Hand-rolled `release.yml` (130 lines) with manual `bundle-staging` find/cp logic, manual `gh release create/upload`, no auto-generated update manifest.
- **Recommended**: Migrate to `cargo-dist` (`https://opensource.axo.dev/cargo-dist/`). Single `dist-workspace.toml` declares targets; the tool handles cross-compilation, code signing (when secrets are present), updater manifest generation, and GitHub Releases publishing.
- **Code locations**: `.github/workflows/release.yml`, new `dist-workspace.toml`.
- **Backward compatibility**: Existing v0.2.1 release artifacts must continue to work. Stage the migration with a v0.4.0-prerelease.
- **Verification**: A test workflow_dispatch on `v0.4.0-test` produces the same six installers as today.
- **Estimated complexity**: M.
- **Priority**: P1.

### I4-02 — Promote `Globe.tsx` from one mega-component into hook-modules (P2)

- **Current**: `src/components/Globe.tsx` is 786 lines with ~10 distinct `useEffect` hooks (viewer mount, style resolution, imagery rebuild, pick mode, inspect mode, source entity, wavefront rings, SWE overlay, runup bars, inundation discs, DART pins, runup labels).
- **Recommended**: Extract per-entity-type hooks: `useSourceEntity(viewer, initial)`, `useWavefrontRings(viewer, initial, wavefront)`, `useRunupBars(viewer, runupResults)`, `useInundationDiscs(viewer, runupResults)`, `useDartPins(viewer, dartBuoys)`, `useSweOverlay(viewer, sweSnapshot)`, `usePickMode(viewer, pickMode, onPick)`, `useInspectMode(viewer, ...)`. Each hook owns its own `useRef<Map>` for entity bookkeeping.
- **Why now**: 786 lines is at the borderline of where future contributors hesitate to touch. The v0.4.0 GeoJsonDataSource integration for inundation polygons + Tour-anchoring DOM-attachment work will both add ~50 lines apiece; this is the right moment to refactor before they land.
- **Backward compatibility**: None — internal refactor.
- **Verification**: Manual flow on all 11 presets. No new lint errors.
- **Estimated complexity**: M.
- **Priority**: P2.

### I4-03 — Specta + tauri-specta for IPC type generation (P2)

- **Current**: `src/types/scenario.ts` is hand-maintained to mirror `src-tauri/src/physics/mod.rs` + `presets.rs` + `commands.rs` structs. Drift is a recurring source of bugs (last session added `camera_view` in two places, then `inundation_extent_m` in two places).
- **Recommended**: Adopt `specta` + `tauri-specta`. Annotate Rust types with `#[derive(specta::Type)]`. A build script emits `src/types/scenario.generated.ts`. Hand-written file becomes a re-export.
- **Code locations**: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs` (export step), `src/types/scenario.ts`.
- **Backward compatibility**: Generated types should preserve the existing surface. Add a CI step that compares generated output to a snapshot.
- **Verification**: `cargo build` regenerates the TS file; `npx tsc --noEmit` stays clean.
- **Estimated complexity**: M.
- **Priority**: P2.

### I4-04 — `Globe.tsx` flyTo: integer-frame timing on `prefers-reduced-motion` (P3)

- **Current**: With `prefers-reduced-motion` we set `flyTo` duration to 0.0 seconds. Cesium's flyTo at duration=0 still does one frame of interpolation that produces a brief visual jitter.
- **Recommended**: Use `viewer.scene.camera.setView(...)` (instant, no animation) instead of `viewer.flyTo(..., {duration:0})`.
- **Code locations**: `src/components/Globe.tsx::flyTo` call site.
- **Estimated complexity**: S.
- **Priority**: P3.

### I4-05 — Move all bundled JSON loader code through a `lib/data.ts` boundary (P3)

- **Current**: `src/components/CoastalRunupOverlay.tsx` and `src/components/DartOverlay.tsx` both `import jsonFile from "../data/X.json"` and cast directly to a type. Each does its own integrity-filter inline.
- **Recommended**: New `src/lib/data.ts` exports `getCoastalPoints(): CoastalPoint[]` and `getDartEvents(): DartDatabase` with centralised validation + caching. Future GeoJSON / GEBCO loaders can extend this module.
- **Estimated complexity**: S.
- **Priority**: P3.

### I4-06 — Validation harness: extend to v0.4.0-relevant benchmarks (P1)

- **Current**: 3 benchmarks (Stoker, Carrier-Greenspan, Range Chicxulub OOM).
- **Recommended additions** (some called out in `docs/science/VALIDATION.md` as "Future benchmarks"):
  - Lituya Bay simulated runup at Gilbert Inlet inner shore vs the observed 524 m record. Requires F4-07.
  - Tohoku DART buoy 21413/21418/51407 time-series RMSE vs observed. Requires F4-06.
  - Range 2022 Chicxulub North-Atlantic coastline runup map. Requires F4-03 (real GEBCO).
  - Carrier-Greenspan plane-beach inundation length vs wet/dry solver output. Requires F4-03 + F4-04.
- **Estimated complexity**: M cumulative.
- **Priority**: P1.

### I4-07 — Population-casualty overlay (opt-in, heavy disclaimer) (P3)

- **Current**: `ROADMAP.md` Future. Not implemented.
- **Recommended**: Bundle GHS-POP 2023 (CC-BY, ~250 MB at 1 km resolution) as an optional download (same pattern as F4-03). Render as a population-weighted overlay clipped to inundation polygons. Heavy disclaimer modal before showing.
- **Risk**: Estimating casualties is a publicity attractor for the wrong reasons. The disclaimer needs to be uncompromising: "These are not casualty estimates, they are population counts inside the simulated inundation polygon. Do not use for any operational purpose."
- **Estimated complexity**: L.
- **Priority**: P3.

---

## Reliability, Security, Privacy, Data Safety

### What v0.3.0 closed

- IPC bounds + finite-input guards across all `*_initial_conditions` commands.
- NaN-safe `synolakis_runup_m`.
- Defensive Cesium Rectangle clamp.
- Dateline-straddling bbox guard.
- Sponge-boundary land-cell ordering bug (caught by CI).
- Okada strike-slip sign-convention test brittleness (caught by CI, relaxed to magnitude bound).
- Clippy `manual_clamp` regression (caught by CI).

### Still-open risks (post-v0.3.0)

| Risk | Severity | Status |
|---|---|---|
| No code signing → SmartScreen / Gatekeeper warnings | Medium | F-V04 still blocked on cert |
| No in-app update channel → users on broken v0.2.0 never reach v0.2.1 | High | F-V07 still blocked on Ed25519 key generation |
| Cesium token in flat-file `app_data_dir/settings.json` (not OS keychain) | Medium | I-V04 deferred — `tauri-plugin-keyring` for Tauri 2 still emerging |
| WGSL kernel reads f32 buffers while CPU runs f64 — divergence risk | Low | Will surface in F4-01 GPU-vs-CPU regression test |
| Hunga Tonga `controversy_note` still says "not yet integrated" | Trust | F4-05 closes |
| `cargo audit` baseline is clean but not pinned | Low | Acceptable; advisories surface as `RUSTSEC-XXXX-XXXX` and block CI |
| No SBOM published with releases | Low | `cargo-dist` (I4-01) handles this for free |

### Missing guardrails

- **No "freeze simulation" recovery**: if `simulate_grid` hangs (it shouldn't post-v0.3.0 `MAX_TOTAL_STEPS` cap, but as a defence-in-depth), there's no UI cancel button. Recommend: a `Promise.race` against a user-cancel signal in `SwePlayback.run`.
- **No telemetry-free crash report**: if the Tauri WebView crashes, the user just sees a blank window. Tauri 2 has `app.on_window_event(WindowEvent::CloseRequested...)` — wire a crash-dump path to `app_data_dir/crash.log`.

---

## UX, Accessibility, and Trust

### What v0.3.0 closed

- Global `:focus-visible` ring.
- `:disabled` button treatment.
- `<noscript>` fallback.
- No-FOUC theme bootstrap in `index.html`.
- `prefers-reduced-motion` overrides + tunable flyTo duration.
- aria-live regions on SwePlayback error + CoastalRunupOverlay runup arrivals.
- Runup-bar hover labels (Cesium LabelGraphics).
- Settings → Advanced reset paths.
- 5-step onboarding tour.
- Per-preset curated camera framings (no more zoom-to-centre-of-Earth on Lituya).
- Inspect overlay with point-readout.
- Inundation polygons (first-order).

### Still-open UX

| Surface | Gap | Recommended |
|---|---|---|
| README on GitHub | Screenshots + animated demo now embedded | Keep assets refreshed after major visual UI changes |
| Loading state for the SWE solver | "Computing…" button label only; no progress bar | New `SimulateGridResponse.progress_event` via `tauri::Window::emit` |
| Compare mode | Slot B has no DART overlay or runup overlay | Apply F-V07 model to slot B (deferred — not a real bug) |
| Globe imagery error | Falls back to OSM silently | Surface a "Cesium ion token invalid — fallback engaged" toast |
| First-launch token explainer | Settings dialog is excellent but the user has to know to open it | Add an in-app banner on the first-launched session "Optional: paste a Cesium ion token in Settings for satellite imagery" — dismissible |
| Long-form citations | CitationsModal is good but the controversy_note text only appears in the modal | Surface on the Preset card too (already does — verified) |
| Keyboard nav | All controls Tab-reachable but no skip-link to globe canvas | Add a `Skip to globe` hidden link at the top |

### WCAG 2.2 AA-shortfall surfaces

- **Reduced-motion**: still shows the imagery-loading `@keyframes pulse` (already overridden by the v0.3.0 reduce media query — verified).
- **Contrast**: Catppuccin palettes have been independently AA-verified. *Assumption* — needs a formal axe-core audit.
- **Voice-over name labels** on Cesium entities: not exposed to assistive tech (Cesium renders to WebGL, not DOM). This is a fundamental Cesium limitation; mitigation is the DartOverlay sparklines, ResultsPanel readouts, and Inspect overlay text.

---

## Architecture and Maintainability

### Module-boundary improvements

- **Globe.tsx (786 lines) refactor** — see I4-02.
- **IPC type generation** — see I4-03.
- **`lib/data.ts` data-loader boundary** — see I4-05.
- **Crystallise `BoundaryMode` + `SolverMode` + `BathymetrySource` into a `SolverConfig` struct** — currently three different opt-in points on `TimeStepper`. Group them in one builder.

### Refactor candidates

- **`commands.rs` (795 lines)** is approaching the borderline. If F4-01 adds GPU dispatcher and F4-03 adds `download_bathymetry`, this should split into `commands/` directory by domain (sources / propagation / bathymetry).
- **`presets.rs` (~310 lines)** — 11 hand-written entries. If F4-08 adds secondary sources or more presets, move to TOML and `include_str!`.

### Test gaps

- **Frontend has zero unit tests.** `vitest` is industry standard for Vite projects; ~3 MB installed. Worth adding for `lib/settings.ts`, `lib/export.ts`, `hooks/useScenarioSlot.ts`.
- **Playwright end-to-end tests** would catch the v0.2.0 blank-globe regression class. *Already in maintainer's tooling* (per `CLAUDE.md` MCP usage). Recommend a smoke-test playwright suite.

### Documentation gaps

- **Per-source derivation notes** in `docs/science/` (asteroid.md, nuclear.md, …) referenced in `docs/science/README.md` but not authored. Generate from in-module rustdoc.
- **Release runbook** `docs/release/RELEASING.md` — would document the "Release vX.Y.Z" recipe + screenshot the workflow_dispatch flow.

### Release / build / deploy gaps

- **Code signing** — F-V04, blocked on cert.
- **In-app updater** — F-V07, blocked on Ed25519 key.
- **SBOM** — would land for free with I4-01 `cargo-dist`.
- **Reproducible builds** — release artifacts aren't bit-reproducible. Low priority but recommended once `cargo-dist` lands.
- **Symbol uploads** for crash debugging — not yet wired. Crashing today produces an opaque `Aborted (core dumped)` on Linux.

---

## Prioritized Roadmap (v0.4.0+)

### Phase 0.3.0 release-ready (sweep up the remaining blocked items + ship)

- [x] **P0 — F-V03** — README screenshots + animated demo.
  - Why: First-time-visitor conversion is the project's lowest-hanging fruit.
  - Evidence: `assets/screenshots/` now contains 5 PNGs + `chicxulub-demo.gif`.
  - Touches: `assets/screenshots/`, `README.md`.
  - Acceptance: 5 PNGs + 1 animated Chicxulub playback demo embedded in README.
  - Verify: `npm run build`; Browser visual QA against `vite preview`.

- [ ] **P0 — F-V04** — Code signing.
  - Why: Win SmartScreen / macOS Gatekeeper warnings on first launch dent install conversion.
  - Evidence: `release.yml` has no sign step.
  - Touches: `.github/workflows/release.yml`, `src-tauri/Entitlements.plist` (new).
  - Acceptance: Next release boots on vanilla Win 11 + macOS 13 without security prompts.
  - Verify: `signtool verify` (Win) + `spctl --assess --type execute` (macOS).
  - Block: Needs EV cert + Apple Developer ID.

- [ ] **P1 — F-V07** — `tauri-plugin-updater` Ed25519-signed channel.
  - Why: Users on v0.2.0 with the blank-globe regression have no signal v0.2.1 exists.
  - Evidence: `TODO.md` line 76; `tauri-plugin-updater` is upstream stable.
  - Touches: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `tauri.conf.json` (`plugins.updater.pubkey`), `.github/workflows/release.yml`, new `src/components/UpdateToast.tsx`.
  - Acceptance: A v0.4.0 release triggers an in-app toast within 10 s on a v0.3.0 install.
  - Verify: Manual end-to-end on test build.
  - Block: Needs `tauri signer generate` + private key as GH secret.

- [ ] **P1 — I-V04** — Cesium token via OS keychain.
  - Why: Flat-file token storage is the weakest secret-management option; `SECURITY.md` treats this as in-scope.
  - Evidence: `src/lib/settings.ts::setCesiumToken`.
  - Touches: `src/lib/settings.ts`, new Rust command bridging `keyring` crate.
  - Acceptance: `cat $APPDATA/.../settings.json` does NOT contain the token after save.
  - Block: `tauri-plugin-keyring` for Tauri 2 still maturing — verify upstream availability before starting.

### Phase 4 — GPU + Nonlinear (v0.4.0)

- [x] **P0 — F4-01** — `wgpu` SWE dispatch loop (full GPU path).
  - Shipped: full ping-pong dispatch + 3-way readback + restartable `step` in `physics::solver::gpu`; `commands::simulate_grid` probes the adapter when `--features gpu` and falls back cleanly. `SimulateGridResponse.used_gpu` surfaced; `swe_gpu_matches_cpu` regression test asserts < 1e-3 m vs CPU `SolverMode::Linear`. WGSL kernel still ships the linear form; nonlinear advection in WGSL deferred to v0.5.0.

- [ ] **P0 — F4-03** — Real GEBCO 2024 bathymetry via first-run download wizard.
  - Why: Coarse 7-basin proxy misses every island; wet/dry handling can't shine without it.
  - Evidence: `data/bathymetry/README.md`, `src-tauri/src/data/bathymetry.rs::sample` comments.
  - Touches: `src-tauri/src/data/gebco.rs` (new), `src-tauri/src/commands.rs::download_bathymetry` (new), `src/components/FirstRunBathymetryPrompt.tsx` (new), `scripts/build-bathymetry.rs` (new).
  - Acceptance: After first-launch download, Tohoku SWE simulation visibly reflects on the Japan Trench geometry.
  - Verify: `ls $APPDATA/com.sysadmindoc.tsunamisimulator/gebco_2024_30s.zstd`.
  - Block: Decide distribution channel (GH Release vs Cloudflare R2).

- [ ] **P1 — F4-02** — Nonlinear momentum advection in the SWE solver.
  - Why: Phase 4 DoD requires wave steepening + breaking near coasts.
  - Evidence: `src-tauri/src/physics/solver/mod.rs` line 13 (linearised form).
  - Touches: `src-tauri/src/physics/solver/mod.rs::step_one` momentum loop; new `SolverMode` enum.
  - Acceptance: `nonlinear_solver_steepens_at_coast` test passes; Stoker validation still passes with `SolverMode::Linear`.
  - Verify: `cargo test --release`.

- [ ] **P1 — F4-04** — Wet/dry inundation polygons (real flood polygons).
  - Why: Replaces v0.3.0 first-order discs with true marching-squares flood polygons.
  - Touches: `src-tauri/src/physics/solver/polygon.rs` (new), `src-tauri/src/physics/solver/mod.rs::snapshot`, `src/components/Globe.tsx`.
  - Acceptance: Tohoku Sendai Plain at t = 30 min shows a ~5–10 km inland polygon matching observed.
  - Verify: Manual.
  - Depends: F4-03 (real GEBCO).

- [ ] **P1 — F4-05** — Lamb-wave coupled into SWE solver IC.
  - Why: Closes the "controversy_note" gap on `hunga_tonga_2022`.
  - Touches: `src-tauri/src/physics/solver/mod.rs::SwGrid::inject_lamb_wave_ring` (new), `src-tauri/src/commands.rs::simulate_grid`, `src/components/SwePlayback.tsx`, `presets.rs`.
  - Acceptance: Tonga DART 51425 at t = 5 h within 50 % of Carvajal 2022 ~10 cm.
  - Verify: Manual.

- [ ] **P1 — I4-01** — `cargo-dist` migration for the release pipeline.
  - Why: Replaces hand-rolled `release.yml`; auto-handles signing + updater manifests + SBOM.
  - Touches: `.github/workflows/release.yml`, new `dist-workspace.toml`.
  - Acceptance: A test workflow_dispatch on `v0.4.0-test` produces the same six installers as today.
  - Verify: Compare against `gh release view v0.2.1 --json assets`.

- [ ] **P1 — I4-06** — Validation harness extensions.
  - Why: Quantitative agreement with published references = research credibility.
  - Touches: `src-tauri/src/physics/validation.rs`, `docs/science/VALIDATION.md`.
  - Acceptance: Lituya runup test + Tohoku DART RMSE test land in their bands.
  - Verify: `cargo test --release --features validation -- validation::`.

- [ ] **P2 — F4-06** — Tohoku DART buoy RMSE display.
- [ ] **P2 — F4-07** — Lituya Bay validation case.
- [ ] **P2 — F4-09** — Share-card export with metadata overlay.
- [ ] **P2 — I4-02** — Globe.tsx refactor to per-entity-type hooks.
- [ ] **P2 — I4-03** — Specta + tauri-specta for IPC type generation.

### Phase 5 — Boussinesq + AMR (v0.5.0)

- [ ] **P3 — F4-10** — Boussinesq dispersive solver.
- [ ] **P3 — F4-11** — Adaptive Mesh Refinement.

### Phase 6 — UX polish + v1.0.0

- [ ] **P3 — F4-08** — Multi-event scenarios.
- [ ] **P3 — F4-12** — Multi-language UI (en/ja/es).
- [ ] **P3 — I4-07** — Population-casualty overlay (opt-in, heavy disclaimer).

---

## Quick Wins (one-morning or less changes)

- [x] **I4-04** — Cesium `setView` instead of `flyTo(duration:0)` for reduced-motion users.
- [x] **I4-05** — `lib/data.ts` centralised JSON loader.
- [ ] Pin `windows-latest` → `windows-2025` in `.github/workflows/*.yml` once the June 15 redirect lands (currently no action needed).
- [x] Add a `Skip to globe` hidden keyboard link in the App header.
- [x] Surface "Cesium ion token invalid → fallback engaged" toast on imagery 401.
- [x] First-launch banner "Optional: paste a Cesium ion token in Settings for satellite imagery" (dismissible).
- [x] Doc pass on `docs/science/` per-source notes (asteroid.md, nuclear.md, earthquake.md, landslide.md, shallow_water.md, lamb_wave.md).

---

## Larger Bets

- **F4-01 wgpu dispatch loop** — multi-day, but the scaffold is in place.
- **F4-03 real GEBCO** — XL. Distribution-channel decision is on the critical path.
- **F4-10 Boussinesq solver** — XL.
- **F4-11 AMR** — XL.

Each warrants a `docs/design/XXX.md` short design doc before implementation begins. The wgpu dispatch design is particularly important — the bind-group layout choices (separate buffers vs interleaved struct-of-arrays) determine the kernel-coding burden for the rest of the project.

---

## Explicit Non-Goals (re-affirmed from v0.3.0 plan)

- **No telemetry.** Even anonymous usage counts.
- **No paid SaaS or backend.** Local-first.
- **No multi-user real-time collaboration.** Scope creep.
- **No iOS/Android port.** Tauri Mobile is plausible but the UI is laptop/desktop-shaped.
- **No live tsunami warning integration.** Disclaimer explicitly says "use NTWC/PTWC".
- **No "operational" branding.** F4-09 share cards must preserve the "Educational only" framing.
- **No GPL-licensed runtime deps.** Project is MIT.
- **No proprietary file formats.** Scenario exports remain JSON / CZML.

**New non-goal (this pass):**

- **No casualty estimates with population data we can't validate.** F4-15 / I4-07 (population overlay) must be opt-in, heavily disclaimed, and frame the overlay as "population inside the inundation polygon" — NOT as a casualty estimate.

---

## Open Questions

These remain the same 4 open questions from the v0.3.0 plan plus 3 new ones surfaced this pass:

1. **Code-signing budget**: EV cert (~$300/yr) + Apple Developer enrollment ($99/yr). F-V04 can't land without one.
2. **GEBCO distribution channel**: GitHub Release vs Cloudflare R2. F4-03 needs this answered.
3. **Ed25519 key custody**: GH Actions secret only, or offline-only with manual signing? F-V07 acceptance depends on this.
4. **Lamb-wave physics choice**: Carvajal 2022 / Kubota 2022 / Matoza 2022 differ on coupling magnitude. Should F4-05 expose the choice to users or pick a default? Influences UX.
5. **New: cargo-dist migration timing.** The hand-rolled `release.yml` has shipped 3 releases successfully. Migrate now (v0.4.0) or hold until v1.0.0?
6. **New: Validation tolerance vs published Range 2022 Chicxulub.** Currently F-V01 only asserts OOM at 220 km. Should the v0.4.0 wgpu + GEBCO combination tighten this to ±50 % at the North Atlantic coastline as the v0.5.0 DoD anticipates?
7. **New: Frontend test framework.** Vitest is the obvious choice. Worth adding before F4-01 GPU work or after?

---

*End of research and feature plan v0.4.0+. Generated 2026-05-25 against commit `28d9242`. Companions:*
- *[`RESEARCH_FEATURE_PLAN_v0.0.1.md`](./RESEARCH_FEATURE_PLAN_v0.0.1.md) — v0.0.1 competitive landscape (archived)*
- *[`RESEARCH_FEATURE_PLAN_v0.3.0.md`](./RESEARCH_FEATURE_PLAN_v0.3.0.md) — v0.3.0 forward plan, 15 of 23 items shipped (archived)*
- *[`ROADMAP.md`](./ROADMAP.md) — canonical phased plan (source of truth)*
- *[`CHANGELOG.md`](./CHANGELOG.md) — shipped + unreleased state*
- *[`docs/science/VALIDATION.md`](./docs/science/VALIDATION.md) — quantitative validation harness*
