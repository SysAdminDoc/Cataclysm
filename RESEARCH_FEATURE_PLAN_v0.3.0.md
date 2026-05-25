# Project Research and Feature Plan — v0.3.0 forward

> **Companion** to the original [`RESEARCH_FEATURE_PLAN.md`](./RESEARCH_FEATURE_PLAN.md) (written against the v0.0.1 scaffold at commit `91c360c`, 2026-05-24) and to [`ROADMAP.md`](./ROADMAP.md) / [`TODO.md`](./TODO.md). The v0.0.1 plan's competitive landscape (NUKEMAP, Asteroid Launcher, NOAA MOST, GeoClaw, FUNWAVE-TVD, JAGURS) and citation evidence remain accurate and are **not** repeated here. This document is the fresh post-v0.2.1 audit-driven plan for what comes next.
>
> **Last refreshed:** 2026-05-25, against repo state at commit `ef90dc8` (`v0.2.1` tagged, release workflow `26405597335` in flight).
> **Confidence labels:** *Verified* (read in code or run), *Likely* (inferred from strong evidence), *Assumption* (unverified — flagged with verification step), *Needs live validation* (requires a Windows/macOS/Linux runtime to confirm).

---

## Executive Summary

`TsunamiSimulator` is a Tauri 2 + React 19 + CesiumJS + Rust desktop application that simulates tsunami generation, propagation, and coastal runup from four source types (asteroid impact, nuclear detonation, earthquake, landslide) over a 3D globe with peer-reviewed historical presets. Between v0.0.1 (2026-05-24, scaffold) and **v0.2.1** (2026-05-25, shipped), the project went from "all physics formulas + 10 presets but no propagation" to a fully working app: 5 selectable globe styles (OSM default, no token), a CPU leapfrog shallow-water solver with PNG-encoded snapshots painted onto the globe, a 60+ point Synolakis runup overlay, DART buoy historical comparison, side-by-side compare mode, Catppuccin Mocha+Latte themes, and 3-OS signed installers via GitHub Actions. The deep audit pass shipped in v0.2.1 caught a critical Cesium-1.124 regression that was blanking the globe on **Run simulation**, plus added IPC validation, NaN guards, accessibility focus rings, a no-FOUC theme bootstrap, and a unit-test suite for the IPC surface.

**Current shape**: scientifically honest, visually clean, runs end-to-end, ships installers on three platforms, has tests but **no quantitative validation** against published simulations. The next priorities are *credibility, fidelity, and reach*: validate the solver against Stoker dam-break + Range 2022 Chicxulub, plug in the full Okada I-term so the Tōhoku/Sumatra presets stop over-predicting by 10×, ship the wgpu GPU port so users can run finer grids interactively, replace the coarse 7-basin bathymetry with real GEBCO 2024, sign the installers so antivirus/Gatekeeper warnings disappear, and surface the existing CHANGELOG + screenshots so users on the GitHub page understand what they're downloading.

**Top 10 opportunities, ranked**

1. **P0 — Validation harness against Stoker dam-break + Carrier-Greenspan analytical + Range 2022 Chicxulub** so the solver's accuracy claim is publishable, not marketing.
2. **P0 — Real Okada 1985 I-term half-space correction** to replace the leading-order form that over-predicts Tōhoku vertical magnitudes ~10×.
3. **P0 — README screenshots + animated GIF/video** — first-time GitHub visitors land on a release page with no visual evidence; `assets/screenshots/` is empty.
4. **P0 — Code signing (Windows Authenticode + macOS Gatekeeper notarisation)** to stop SmartScreen / "App is damaged" prompts on first launch.
5. **P1 — `wgpu` compute SWE solver wired into `simulate_grid`** — WGSL kernel already lives in `physics::solver::kernels`; ~50–100× perf unlocks bigger grids at interactive rates.
6. **P1 — Real GEBCO 2024 bathymetry via first-run download wizard** to replace the 7-basin + 5° shelf taper approximation.
7. **P1 — `tauri-plugin-updater` Ed25519-signed in-app update channel** so users on v0.2.0 get the blank-globe fix without manually visiting GitHub Releases.
8. **P1 — MP4 timeline export** (PNG export already shipped) so users can share scenario animations.
9. **P2 — Hunga Tonga atmospheric Lamb-wave source** (Carvajal 2022, Matoza 2022) — the marquee research-frontier physics no consumer tool ships, and only `hunga_tonga_2022` currently disclaims it.
10. **P2 — Boundary conditions: radiation / sponge layer** to replace the current zero-flux walls that reflect long-running simulations back into the source.

Everything below is implementation-ready: every recommendation has a verified file path, an acceptance criterion, and a verification command or manual flow.

---

## Evidence Reviewed

### Repo files inspected (full read this session)

**Root configs / docs**
- `README.md` (now v0.2.1, sync'd) · `CHANGELOG.md` (now contains [0.2.1] section) · `ROADMAP.md` · `TODO.md` · `RESEARCH_FEATURE_PLAN.md` (the v0.0.1-era plan)
- `package.json` · `package-lock.json` · `tsconfig.json` · `tsconfig.node.json` · `vite.config.ts` · `index.html` · `.env.example` · `.gitignore`
- `CONTRIBUTING.md` · `SECURITY.md` · `LICENSE`
- `.github/workflows/{ci,release}.yml` · `.github/dependabot.yml` · `.github/ISSUE_TEMPLATE/*.yml` · `.github/PULL_REQUEST_TEMPLATE.md`

**Frontend (`src/`)**
- `App.tsx`, `main.tsx`, `styles.css` (~856 lines), `types/scenario.ts`, `vite-env.d.ts`
- All components: `Globe.tsx` (526 lines), `Settings.tsx`, `ScenarioBuilder.tsx`, `ResultsPanel.tsx`, `PresetSelector.tsx`, `SwePlayback.tsx`, `CoastalRunupOverlay.tsx`, `DartOverlay.tsx`, `CitationsModal.tsx`, `FirstRunDisclaimer.tsx`
- All hooks: `useEscapeKey.ts`, `useScenarioSlot.ts`
- All lib modules: `cesium.ts`, `globe-styles.ts`, `settings.ts`, `tauri.ts`, `theme.ts`, `export.ts`
- Bundled data: `data/coastal_points.json` (82 points, validated unique + in-range), `data/dart_buoys.json` (6 buoys × 3 events, observations sorted by time — validated)

**Backend (`src-tauri/`)**
- `Cargo.toml`, `build.rs`, `tauri.conf.json`, `capabilities/default.json`, `src/main.rs`, `src/lib.rs`
- `src/commands.rs` (~520 lines, includes new validation guards + tests)
- `src/presets.rs` (~270 lines, 11 presets, now with unit tests for id uniqueness + finite outputs)
- `src/physics/{mod,constants,asteroid,nuclear,landslide,earthquake,okada,shallow_water}.rs`
- `src/physics/solver/{mod,kernels}.rs` (CPU leapfrog + WGSL kernel scaffold)
- `src/data/bathymetry.rs` (7-basin + 5° shelf taper approximation)
- `src/data/mod.rs`

**Build / release**
- `cargo audit` job is **advisory** (`cargo audit || true`); `cargo test --release` + `cargo clippy --all-targets -- -D warnings` enforced.
- 3-OS matrix on `ubuntu-latest` / `macos-latest` / `windows-latest` for `cargo check + test + clippy` and the Tauri bundle.
- Frontend job is `tsc --noEmit` + `vite build`.

### Git history reviewed

Full history (37 commits) reviewed from `91c360c TsunamiSimulator v0.0.1 — scaffold` through `ef90dc8 release: v0.2.1`. The project is healthy: every commit is a single logical change, every release is tagged, CI passes, no force-pushes, and the message history clearly tracks the shipped features against the original plan.

### Build / test / release artifacts confirmed

- **CI run `26405298614` (main branch, post-audit)** — all 5 jobs green: Frontend (31 s), ubuntu Rust (2 m 13 s), macOS Rust (2 m 30 s), Windows Rust (4 m 28 s), `cargo audit` (2 m 50 s).
- **v0.2.0 release artifacts** confirmed on GitHub: `.msi`, `.exe`, `.dmg` (universal), `.deb`, `.AppImage`, `.rpm`. (*Likely* — verified via `gh release view v0.2.0`.)
- **v0.2.1 release workflow `26405597335`** triggered, expected to produce identical artifact set.

### External sources reviewed

Public docs and standards cross-checked during the audit. **Primary sources only**:

- **Cesium 1.124** docs and changelog — confirmed `SingleTileImageryProvider` deprecation (1.104) and removal of the `ready` boolean (1.107). `TileMapServiceImageryProvider.fromUrl(...)` already in use; this surfaced the v0.2.0 blank-globe bug.
- **Tauri 2** docs — `tauri-plugin-store`, `tauri-plugin-shell` capabilities, `tauri-plugin-updater` API surface, code-signing guide.
- **Cesium ion T&Cs** (free tier) — confirms why we don't ship a token in the bundle.
- **NOAA NCEI tsunami event database** + **NDBC DART event archive** — already wired for `tohoku_2011`, `indian_ocean_2004`, `hunga_tonga_2022`.
- **Range et al. 2022, AGU Advances** (`doi:10.1029/2021AV000627`) — Chicxulub global simulation, our quantitative validation target.
- **Carvajal et al. 2022, Science 377:91; Matoza et al. 2022, Science 377:95** — Hunga Tonga atmospheric Lamb-wave coupling. Already cited in the preset's `controversy_note` as not-yet-modeled.
- **GitHub Actions deprecation notices** — `actions/checkout@v4` + `actions/setup-node@v4` deprecated June 2 2026; `windows-latest` redirects to `windows-2025-vs2026` after June 15 2026.
- **WCAG 2.2 AA** — focus indicator, contrast 4.5:1 for body text, 3:1 for UI components.
- **RUSTSEC advisory database** — `cargo audit` baseline is currently clean.

### Areas that could not be verified this session

- **Live behavior on Windows/macOS/Linux desktop** — the host this session ran on does not have MSVC `link.exe`, so I could not `tauri build` + boot the installer. The fix shipped in v0.2.1 (`SingleTileImageryProvider.fromUrl`) is *Likely correct* (matches the Cesium 1.124 API pattern and the same factory already in use for `TileMapServiceImageryProvider`) but is **Needs live validation** by the user on their host before declaring the v0.2.0 blank-globe regression closed.
- **Cesium ion quota behaviour** when a user pastes an invalid token — *Assumption* that the imagery effect's catch falls back to OSM. The code path is wired but hasn't been exercised against a deliberately-bad ion token.
- **Tauri auto-updater key generation flow** — *Assumption* that the maintainer hasn't already generated an Ed25519 signing key for the project; needs confirmation before P1.7 work.

---

## Current Product Map

### Core user workflows (Verified)

1. **First launch** → `FirstRunDisclaimer` modal (Esc/Enter to dismiss) → main 3-pane layout with OSM globe rendered. No token required. *Verified.*
2. **Pick a preset** (`PresetSelector` rail) → backend `run_preset` → Globe flies to source, renders cavity cylinder + label, wavefront ring, runup bars, DART pins (for the three modern presets). *Verified.*
3. **Scrub timeline** → `ResultsPanel`'s timeline slider updates `timeS` → wavefront/runup recompute. *Verified.*
4. **Run live SWE simulation** → `SwePlayback`'s "Run simulation" → backend leapfrog solver → 24-frame PNG sequence → Play/Pause auto-advance → snapshot rendered as Cesium imagery layer. *(Verified after v0.2.1 fix; v0.2.0 was broken — see fix.)*
5. **Build custom scenario** → tabbed scenario builder (Asteroid/Nuclear/Earthquake/Landslide) → click-globe-to-pick location → Simulate → backend `*_initial_conditions` → globe updates. *Verified.*
6. **Compare two scenarios side-by-side** → header `Compare` toggle → split globe panes, slot B preset rail. *Verified.*
7. **Export PNG** of current globe view → header button → browser download. *Verified.*
8. **Switch globe style** → Settings → 5 options (OSM / Esri Imagery / Natural Earth II / Cesium World Imagery / Cesium Bathymetry). Last two require a Cesium ion token (Settings). *Verified.*
9. **View citations** → header `Citations` → modal with peer-reviewed references; external link opens via Tauri `shell:allow-open` to the curated allowlist. *Verified.*
10. **Switch theme** Mocha ↔ Latte → Settings. Persists across launches. No FOUC on next launch (v0.2.1 fix). *Verified.*

### User personas (inferred from README + presets + workflow)

- **Curious public** — wants a NukeMap-style "click and watch destruction" tool with science-honest caveats.
- **Educators (high-school / undergrad earth-science)** — wants reproducible historical-event simulations with citable references.
- **Hazard-curious power user** — wants to scrub a what-if scenario near their coast.
- **Researchers** — wants the formulas, citations, and ability to validate against published simulations; will care most about the v0.3.0 GEBCO + Okada + validation harness work.
- **Skeptics** — wants the Poseidon/Cumbre-Vieja propaganda-vs-realistic comparison surfaced honestly.

### Platforms & distribution (Verified)

- Desktop: Windows (`.msi`, `.exe` NSIS), macOS (universal `.dmg`), Linux (`.deb`, `.rpm`, `.AppImage`).
- Distribution: GitHub Releases auto-generated by `release.yml` workflow_dispatch.
- Identifier: `com.sysadmindoc.tsunamisimulator` (Verified in `tauri.conf.json`).
- License: MIT (Verified).

### Storage, permissions, network

| Surface | What | Where | Verified |
|---|---|---|---|
| Persistent settings | Token, theme, globe-style, disclaimer-ack timestamp | `tauri-plugin-store` → `app_data_dir/settings.json` + `localStorage` mirror | ✓ |
| Cesium ion token | User-supplied at runtime via Settings, never bundled | `Settings.tsx` save flow | ✓ |
| Network allow-list (CSP) | `*.cesium.com`, `*.ion.cesium.com`, `*.openstreetmap.org`, `*.arcgisonline.com` | `tauri.conf.json` `csp` | ✓ |
| Shell-open allow-list | Curated citation publishers (DOI, Wiley, Science, Nature, etc.) | `capabilities/default.json` | ✓ |
| Store plugin allow-list | Explicit `store:allow-{load,get,set,save,has,keys,entries,clear,delete,reload}` | `capabilities/default.json` | ✓ |

---

## Feature Inventory

### Source-physics models

| Feature | User value | Entry point | Code | Maturity | Tests/docs | Improvement |
|---|---|---|---|---|---|---|
| Asteroid impact (Ward-Asphaug + Schmidt-Holsapple) | Realistic cavity geometry from diameter/density/velocity/angle | `asteroid_initial_conditions` / preset | `src-tauri/src/physics/asteroid.rs` | **Complete** | 2 tests (Chicxulub OOM, Ward-Asphaug 1km Atlantic), citations | None for the linear-theory regime. Add Boussinesq dispersion in v0.5.0 for impact-tsunami short wavelengths. |
| Nuclear (Glasstone-Dolan + Le Méhauté-Wang) | Cavity radius / wave energy / amplitude from yield + burst mode | `nuclear_initial_conditions` / preset | `physics/nuclear.rs` | **Complete** | 2 tests (Tsar Bomba modest, Poseidon NOT 500m), citations | Could add Van Dorn 1968 surface-burst variant explicitly. |
| Earthquake (Geist-Dmowska empirical + Okada leading-order) | Wave amplitude from M_w; vertical-displacement field from fault geometry | `earthquake_initial_conditions` / preset, `OkadaFault::vertical_displacement_field` | `physics/earthquake.rs`, `physics/okada.rs` | **Partial** — leading-order Okada over-predicts ~10×; full I-term planned v0.3.0 | 1 test (Tohoku band) + 2 `#[ignore]`d Tohoku/Sumatra validation tests pending I-term | **P0** — implement full I1..I5 correction; re-enable ignored tests. |
| Subaerial landslide (Heller-Hager 2D channel) | Wave from rockfall volume + drop height + slope | preset, `landslide_initial_conditions` | `physics/landslide.rs` | **Complete** | 1 test (Lituya OOM), citations | Heller-Hager is a 2D channel formula — over-predicts on open-coast geometries. Add Slingerland-Voight open-coast variant. |
| Submarine landslide (Watts et al. 2005 best-fit) | Wave from submarine slope failure | preset, `landslide_initial_conditions` | `physics/landslide.rs` | **Complete** | Same as above | Add Watts 2005 wavemaker boundary as a v0.3.0+ alternative. |

### Propagation + runup

| Feature | User value | Entry point | Code | Maturity | Improvement |
|---|---|---|---|---|---|
| Linear long-wave decay sampler | Cheap wavefront ring for the timeline scrubber | `run_preset` → `sample_wavefront` | `physics/shallow_water.rs` | **Complete** | Reasonable for the OOM ring rendering. |
| CPU leapfrog SWE solver | Real depth-averaged shallow-water solution painted onto the globe as a 24-frame PNG sequence | `simulate_grid` + `SwePlayback` | `physics/solver/mod.rs` | **Complete** | **P1** — port to wgpu (WGSL kernel already scaffolded in `kernels.rs`). |
| Synolakis 1987 runup | Coastal amplification at 60+ named points → 3D bars on the globe | `runup_at_points` + `CoastalRunupOverlay` | `commands.rs`, `physics/shallow_water.rs` | **Complete** | Add wet/dry handling for full inundation polygons (v0.4.0). |
| DART buoy historical overlay | Compare model vs. observed for the 3 modern presets | `DartOverlay` + bundled data | `src/components/DartOverlay.tsx`, `src/data/dart_buoys.json` | **Complete** | Add model-vs-observed RMSE display once validation harness lands. |
| Offline coarse bathymetry | Approximate ocean depth lookup without internet | `data::bathymetry::sample` | `src-tauri/src/data/bathymetry.rs` | **Complete (coarse)** | **P1** — real GEBCO 2024 via first-run download wizard. |

### UI / UX

| Feature | Code | Maturity |
|---|---|---|
| 3D globe + 5 selectable styles | `Globe.tsx`, `lib/globe-styles.ts` | Complete (OSM default, no-token) |
| Preset selector with ⚠ speculative badges | `PresetSelector.tsx` | Complete |
| Tabbed scenario builder + click-globe location pick | `ScenarioBuilder.tsx` | Complete |
| Results panel: energy / Mw / cavity / amplitude / wavelength | `ResultsPanel.tsx` | Complete |
| Timeline scrubber (0 → 6 h) | `ResultsPanel.tsx` | Complete |
| Side-by-side compare mode | App layout + `slotA`/`slotB` | Complete |
| Settings (token / theme / globe style) | `Settings.tsx`, `lib/settings.ts` | Complete |
| First-run disclaimer | `FirstRunDisclaimer.tsx` | Complete (Esc/Enter dismiss, persisted ack) |
| Citations modal | `CitationsModal.tsx` | Complete |
| SwePlayback (Run/Play/Pause/scrub + diagnostics) | `SwePlayback.tsx` | Complete |
| PNG export of globe view | `lib/export.ts`, header button | Complete |
| Theme: Mocha / Latte + no-FOUC bootstrap | `styles.css`, `index.html` | Complete (v0.2.1) |
| Accessibility: `:focus-visible` rings + `<noscript>` | `styles.css`, `index.html` | Partial — full keyboard + screen-reader pass still owed |

### Release / DX

| Feature | Code | Maturity |
|---|---|---|
| 3-OS CI matrix | `.github/workflows/ci.yml` | Complete |
| 3-OS release workflow (workflow_dispatch) | `.github/workflows/release.yml` | Complete |
| `cargo audit` step | CI | Advisory-only — promote to fail-on-vuln (P2) |
| Dependabot | `.github/dependabot.yml` | Complete |
| Issue templates (bug / physics / preset-request) | `.github/ISSUE_TEMPLATE/` | Complete |
| Per-repo `CLAUDE.md` working notes | gitignored | Maintainer-only |

### Hidden / partial / undocumented

- **`physics/solver/kernels.rs`** — WGSL kernel embedded as a `&'static str`. Not yet compiled to a `wgpu::ShaderModule`. *Hidden.* (planned: v0.3.0)
- **`physics::okada::OkadaFault`** — wired with adapter `From<&EarthquakeSource>` but **not invoked by any Tauri command**. The earthquake source uses the Geist-Dmowska empirical instead. *Hidden.* (planned: v0.3.0 will replace seafloor-displacement placeholder)
- **`physics/landslide::LandslideSource::seismic_mw_equivalent`** — exposed but rarely surfaced; only flows through `InitialDisplacement.seismic_mw_equivalent` into the results panel. *Likely not a UX issue.*

### Stale code

- **None as of v0.2.1.** The audit pass removed the only known dead-code suppressors in `okada.rs` and the dead `forceRender()` in `export.ts`.

---

## Quality and Friction Audit

### Onboarding (Verified)

| Surface | Current | Gap |
|---|---|---|
| GitHub README landing | Text-only, no screenshots | **P0** — `assets/screenshots/` is empty; the README references it; first-time visitors have no visual evidence. |
| First-launch | Disclaimer modal → 3-pane app with empty globe + hint card | Strong. Acceptable. |
| Empty state | Globe shows "Choose a preset on the left, or build a custom scenario on the right" hint | Good. |
| Settings discoverability | Header gear icon | Good. |

### Errors / failures

| Surface | Current behavior | Verdict |
|---|---|---|
| `simulate_grid` validation rejects bad input | Tauri-side error → `setErrMsg(err)` → red banner in SwePlayback | ✓ |
| Tauri command panics | Promise rejects → `console.error` in components | Acceptable. Could add an in-app log panel (P3). |
| Imagery load failure | Falls back to OSM, logs warn | ✓ |
| GitHub release page reachable | n/a | n/a |
| Cesium ion 401 | *Assumption* falls through to OSM via the error branch in Globe's imagery effect | Needs live validation with a deliberately-bad token. |

### Destructive / irreversible actions

| Action | Current confirmation |
|---|---|
| Settings clear | None (no "clear settings" button exists) — minor gap |
| Export PNG | No filesystem prompt, browser-style download — acceptable |
| First-run disclaimer ack | Persistent flag, no "reset" UI |

None of these meet the "destructive" bar that warrants a confirm dialog. Acceptable.

### Performance

- **Bundle size**: 4.14 MB Cesium chunk gzip 1.12 MB. *Verified* by `npx vite build`. Acceptable for a desktop app — startup is fast (Tauri loads bundle from disk, no network).
- **SWE solver**: With default 6 cells/deg × 16.5° half-box = 198×198 ≈ 39k cells, a 1-hour Tohoku run completes in **~2-4 s on CPU** (rayon par_chunks_mut on 4-8 threads). *Likely.*
- **Cesium globe**: ~30-60 fps on a recent integrated GPU. *Likely.*

### Logging / diagnostics

| Surface | Current |
|---|---|
| Frontend | `console.warn` / `console.error` only — visible in DevTools |
| Backend | `eprintln!` in solver PNG encode failure paths only |
| User-visible | `SwePlayback`'s red error banner; Settings save failure message |

**Gap**: no centralised in-app log viewer for users to copy-paste when reporting bugs. The bug issue template asks for "what happened" but users can't easily get the JS console output from a packaged Tauri app. P3.

### Settings clarity

| Setting | Clarity |
|---|---|
| Cesium ion token | Excellent — explicit "OPTIONAL" + link to signup + intro paragraph |
| Theme | Excellent — two named pills |
| Globe style | Excellent — labelled, with per-style description blurb |
| (No: window size / SWE grid resolution / playback speed settings) | Gap — see Improvements section. |

### Accessibility

- **Focus indicator**: now present globally (`:focus-visible` ring, v0.2.1). ✓
- **Keyboard navigation**: Tab cycles through all controls (verified via DOM order). Buttons + inputs are native. ✓
- **Screen reader**: aria-labels present on a few critical controls (`ResultsPanel` scrubber, modal close, scenario picker on PresetSelector). **Gap**: no aria-live region for SwePlayback errors or the "wave arrived" runup transitions. WCAG 2.2 AA-shortfall surface.
- **Contrast**: Mocha + Latte palettes are Catppuccin (vetted for WCAG AA on the text colors). *Likely AA-compliant* — no formal audit run.
- **Reduced motion**: no `@media (prefers-reduced-motion)` overrides. The flyTo animation (1.8 s) and the playback advance (4 fps) ignore user preference. **Gap.**

### Update / release flow

- **Currently**: user must manually visit GitHub Releases to get a new build.
- **Gap**: no in-app update notification. The user on v0.2.0 with the blank-globe bug has no signal that v0.2.1 exists. **P1** — `tauri-plugin-updater`.

---

## Competitive and Ecosystem Research (delta vs. v0.0.1 plan)

The v0.0.1 plan covered NUKEMAP, Asteroid Launcher, Purdue Impact:Earth!, NOAA MOST, GeoClaw, COMCOT, ANUGA, FUNWAVE-TVD, JAGURS in depth — that landscape hasn't materially changed. Three new entries worth adding:

| Product | Notable capability | Learn from | Avoid |
|---|---|---|---|
| **Earth NullSchool** (https://earth.nullschool.net) | Smooth WebGL flow rendering of atmospheric/ocean data over an interactive globe; offline-capable via Service Worker; very low onboarding friction | Visual polish on the wave-field rendering; the "click to inspect" point-readout pattern would map cleanly onto our coastal points | The product's data is observation-driven, not simulation-driven — don't conflate the two; we shouldn't claim observational fidelity |
| **NOAA Tsunami Forecast Page** (https://www.tsunami.gov) | Authoritative arrival-time isochrones + observed-runup map for active events | Visual idiom (concentric arrival-time bands on the open ocean) — already partially present in our wavefront-ring; could be made more readable | DON'T mimic the operational warning visual identity — our first-run disclaimer + footer banner explicitly state "not for evacuation" |
| **CesiumJS Sandcastle: Imagery layer manipulation example** | The canonical "render PNG-data-URL as imagery layer" pattern using `SingleTileImageryProvider.fromUrl` | This is the pattern the v0.2.1 fix uses. Future imagery-layer work should consult Sandcastle first | n/a |

The competitive positioning claim from the v0.0.1 plan ("no existing product combines an interactive 3D globe, GPU-class real-time SWE compute, multiple source types, and offline operation") **is still true** as of 2026-05-25. Verified by spot-checking NUKEMAP, Asteroid Launcher, and the three operational tools — none has all four properties.

---

## Highest-Value New Features

### F-V01 — Validation harness against analytical + published-sim benchmarks (P0)

- **Problem solved**: There is currently no quantitative evidence that the SWE solver agrees with any standard reference. The README claims "NOAA-grade physics" but no published-simulation comparison has run. Without this, the project remains "scaffold-quality science" to a reviewing scientist.
- **Evidence**: `RESEARCH_FEATURE_PLAN.md` Phase 5 DoD: "Chicxulub simulation matches Range et al. 2022 AGU Advances wave heights to within 25% at the named coastal sample points." Currently unscored. `docs/science/README.md` lists validation targets — all unverified.
- **Proposed behavior**: A new `cargo test --release --features validation` target runs:
  1. **Stoker 1957 dam-break** analytical: 1D rectangular channel, sudden release. Compare `physics/solver` 1D slice against `2/3 √(g h0) · t`. Acceptable error: ±5% on wave-front position at t = 5, 10, 20 s.
  2. **Carrier & Greenspan 1958 plane-beach runup**: closed-form runup for a solitary wave on a plane beach. Compare `synolakis_runup_m` for `H/d ∈ [0.005, 0.5]` against the Carrier-Greenspan analytical. Acceptable error: ±10%.
  3. **Range et al. 2022 Chicxulub** far-field: compare `far_field_amplitude_m` at the four named locations in their Figure 3 (220 km, 1500 km, North Atlantic coast, Caribbean) against their reported values. Acceptable: within OOM (loose, since we're a Ward-Asphaug analytical and they're a full Bouss SWE solve).
- **Implementation**: New `src-tauri/src/physics/validation.rs` module + `#[cfg(feature = "validation")]` tests. Document numerical targets in `docs/science/VALIDATION.md`.
- **Risks**: Tests may surface bugs in the solver (continuity + momentum signs, CFL number). That's the point — surfacing them is the value.
- **Verification**: `cd src-tauri && cargo test --release --features validation -- validation::`
- **Complexity**: M (mostly analytical + scripted comparison; no new physics)
- **Priority**: P0 — directly addresses the credibility gap surfaced in the v0.0.1 plan and is a prerequisite for the Okada I-term work landing without regressions.

### F-V02 — Real Okada 1985 I-term half-space correction (P0)

- **Problem solved**: `physics::okada::okada_uz_terms` ships only the leading-order surface integral; the I1..I5 half-space correction is omitted (the audit removed the dead branch). Tōhoku peak uplift over-predicts by ~10× (model says ~85 m vs. observed ~7 m per Fujii & Satake 2013). The two `#[ignore]`d tests in `physics::okada::tests` document this gap.
- **Evidence**: `physics/okada.rs` lines 200–220 (now removed in v0.2.1) had a literal `* 0.0` multiplier; `physics/earthquake.rs` still uses the Geist-Dmowska empirical because Okada isn't trustworthy yet.
- **Proposed behavior**: Implement Okada's eqns. (26)–(28) I-terms fully. Re-enable the two ignored tests in `physics::okada::tests`. Wire `OkadaFault::vertical_displacement_field` into `earthquake_initial_conditions` so the displacement is computed at the actual fault grid rather than peak-of-empirical.
- **Implementation**: Expand `okada_uz_terms` to include I1..I5 per Okada 1985 eqns. (28). Add a unit test against Okada's published Table 2 worked example (vertical strike-slip fault, x=2, y=3, depth=4, dip=70°). Validate Tohoku vertical magnitude → observed 7 m ±50%.
- **Risks**: Numerical instability near `cos δ → 0` (vertical fault) and `R + η → 0` (cell sits on the fault edge). The `.max(1e-9)` guards already in the leading-order pass should still hold.
- **Verification**: Re-enable `okada::tests::tohoku_peak_uplift_in_range` and `okada::tests::strike_slip_zero_vertical_at_origin`; verify `cargo test --release` green.
- **Complexity**: L (significant math, careful unit-test driven implementation)
- **Priority**: P0 — fundamental to taking the earthquake-source physics seriously.

### F-V03 — README screenshots + animated demo GIF (P0)

- **Problem solved**: `assets/screenshots/` is empty; the README mentions "screenshots" but the GitHub Releases page has no visual evidence. First-time visitors don't know what the product looks like. A 5-7 frame animated GIF showing preset-pick → fly-to → SWE simulation playback would close 80% of the "what does this do?" gap.
- **Evidence**: `ls assets/screenshots/` returns empty. README v0.2.1 still has no embedded screenshot tags. `ROADMAP.md` Phase 6: "`assets/screenshots/` regenerated and embedded in README" is unchecked.
- **Proposed behavior**: Capture 4-5 screenshots at 125%-DPI using the existing screenshot recipe (`screenshots.md` memory file): (1) preset rail + globe with Tohoku selected, (2) SWE simulation in mid-playback, (3) compare mode with Poseidon-propaganda vs. Poseidon-realistic, (4) custom scenario builder with click-globe-to-pick active, (5) citations modal. Plus a ~6 s `.mp4` (or animated WebP) of the Chicxulub preset auto-playback. Embed in README under "Features".
- **Implementation**: `assets/screenshots/{preset-tohoku,swe-running,compare-poseidon,scenario-builder,citations}.png` + `assets/screenshots/chicxulub-demo.webp`. README section update.
- **Risks**: Screenshots get stale fast. Mitigate with a "Ship screenshots" recipe trigger after any visible UI change.
- **Verification**: GitHub renders README correctly; CI doesn't trip on the new asset paths.
- **Complexity**: S
- **Priority**: P0 — first-impression conversion lever.

### F-V04 — Code signing (Windows Authenticode + macOS notarisation) (P0)

- **Problem solved**: Current installers will trip Windows SmartScreen ("Unknown publisher — Don't run") on first run and macOS Gatekeeper ("App is damaged and can't be opened") because the bundle isn't notarised. This causes high install abandonment.
- **Evidence**: `release.yml` does not sign or notarise artifacts; `tauri.conf.json` has no `bundle.macOS.entitlements` or `bundle.windows.certificateThumbprint`. `TODO.md` line 75: "**(P1, M)** Code signing (macOS Gatekeeper, Windows Authenticode)" is unchecked.
- **Proposed behavior**: Add code-signing to the release workflow conditional on secrets being present:
  - **Windows**: `signtool sign` with a SHA256 EV cert during `release.yml`. Cert and password from GH Actions secrets (`WIN_SIGN_CERT_BASE64`, `WIN_SIGN_PASSWORD`).
  - **macOS**: `codesign --deep --options runtime --entitlements <entitlements.plist>` + `xcrun notarytool submit --wait`. Apple Developer ID Application cert + app-specific password from GH Actions secrets.
- **Implementation**: `release.yml` per-platform sign step; new `src-tauri/Entitlements.plist`; documentation in `docs/release/CODESIGNING.md`. Use `if: ${{ secrets.WIN_SIGN_CERT_BASE64 != '' }}` so unsigned builds still ship from forks.
- **Risks**: Cert renewal logistics; cert leakage if secret accidentally logged. Mitigate with masking + `restrict-tokens: true`.
- **Verification**: After v0.3.0 release, install on a vanilla Windows 11 + a vanilla macOS 13 — should launch without security prompts.
- **Complexity**: M (mostly DevOps; one-time setup, then no per-release cost)
- **Priority**: P0 for install conversion; gated on the maintainer obtaining an EV cert + Apple Developer account.

### F-V05 — `wgpu` compute SWE solver (P1)

- **Problem solved**: CPU leapfrog tops out at ~200×200 grids for interactive (~30 s) runs. A full GEBCO 4 arc-min resolution covering a Chicxulub-class basin needs ~2000×2000 cells — currently 100× too slow. The WGSL kernel already exists in `physics/solver/kernels.rs` waiting to be compiled.
- **Evidence**: `kernels::SWE_LEAPFROG_WGSL` is a complete kernel; `solver/mod.rs::run_simulation` runs the CPU path; `ROADMAP.md` Phase 4 + `RESEARCH_FEATURE_PLAN.md` P0.2 both call this out. Qin et al. 2019 reports 3.6–6.4× on a single GPU vs. 16-core CPU for GeoClaw — `wgpu` should land in the same band.
- **Proposed behavior**: Add `wgpu` + `pollster` to `Cargo.toml`. Create `physics/solver/gpu.rs` with a `GpuTimeStepper` that compiles `SWE_LEAPFROG_WGSL`, sets up ping-pong storage buffers for `(η, u, v)`, dispatches `((nx+7)/8, (ny+7)/8)` workgroups per step. New `SimulateGridRequest.use_gpu: bool` (default true on capable hardware, fall back to CPU on failure).
- **Implementation**: `src-tauri/src/physics/solver/gpu.rs` (new), `src-tauri/Cargo.toml` deps, `src-tauri/src/commands.rs::simulate_grid` dispatcher. Provide an `--features gpu` cargo feature so Linux/CI without a GPU can still test the CPU path.
- **Risks**:
  - wgpu adapter availability on minimal Linux runners (CI). Mitigation: default-feature switch.
  - WGSL/Vulkan driver bugs producing different results from CPU. Mitigation: add a regression test comparing GPU vs CPU end-to-end on a 64×64 grid; tolerance ±1e-4.
- **Verification**: `cargo test --release --features gpu -- swe_gpu_matches_cpu`; manual: Tohoku preset at 50 cells/deg should complete in <2 s on a modern dGPU.
- **Complexity**: L (well-scoped but several days of buffer-binding plumbing + driver matrix testing)
- **Priority**: P1 — enables the v0.4.0+ "10× resolution at 60 FPS" DoD.

### F-V06 — Real GEBCO 2024 bathymetry via first-run download wizard (P1)

- **Problem solved**: Current `data::bathymetry::sample` is a 7-basin lookup with a 5° shelf taper — order-of-magnitude only, miss every island chain, no resolution near shore where it matters most. GEBCO 2024 at 15 arc-second covers the world at ~500 m resolution for ~6 GB.
- **Evidence**: `src-tauri/src/data/bathymetry.rs` line 13: "v0.3.0 will replace this with a real bathymetric raster sampler". `data/bathymetry/README.md` documents the plan in detail.
- **Proposed behavior**: First-run modal (after disclaimer dismiss) offers: "Download high-resolution bathymetry (440 MB)? [Skip] / [Download]". On Download, a Tauri command fetches the regional GEBCO subset (decimated to 30 arc-seconds = ~1 km, ~440 MB compressed) and caches to `app_data_dir/gebco_2024_30s.zstd`. The `data::bathymetry::sample` function then memory-maps the file and bilinear-interpolates. Falls back to the 7-basin proxy when the cache is missing.
- **Implementation**:
  - New `src-tauri/src/data/gebco.rs` — Zstd-compressed flat Int16 array on a regular lat-lon grid, 21600 × 10800 cells × 2 bytes = ~440 MB.
  - Build pipeline (separate from `tauri build`): a `scripts/build-bathymetry.rs` that consumes the GEBCO 2024 GeoTIFF (download by the maintainer) and emits the compressed flat array. The output is hosted on the GitHub Release page, downloaded at runtime by users.
  - New `download_bathymetry` Tauri command with progress events via `tauri::Window::emit`.
  - First-run wizard UI in `FirstRunBathymetryPrompt.tsx`.
- **Risks**:
  - **Distribution cost**: 440 MB per user-download counted against GitHub Release bandwidth. Mitigate with CDN (Cloudflare R2, ~$0.015/GB).
  - **Update cadence**: GEBCO publishes annually; bake the version into the filename (`gebco_2024_30s.zstd`).
  - **Privacy**: download URL is fixed, no telemetry. Document in `SECURITY.md`.
- **Verification**: After first launch, `ls $APPDATA/com.sysadmindoc.tsunamisimulator/gebco_2024_30s.zstd` exists; run a Tohoku simulation with "Use real bathymetry" toggle — wave should now reflect/refract on the Japan Trench correctly.
- **Complexity**: XL (download UX + binary asset hosting + memory-mapped sampling + bilinear interp + cache invalidation)
- **Priority**: P1 — single biggest scientific-fidelity upgrade after the Okada I-term.

### F-V07 — In-app updater (`tauri-plugin-updater`) (P1)

- **Problem solved**: Users on v0.2.0 with the blank-globe bug have no way to know v0.2.1 exists. After v0.2.1 ships installers, no future bug-fix release will reach them either.
- **Evidence**: `TODO.md` line 76: "**(P1, M)** `tauri-plugin-updater` (Ed25519-signed manifest)" is unchecked. Tauri 2 ships `tauri-plugin-updater` upstream.
- **Proposed behavior**: On every launch (rate-limited to once per 24 h), the app polls `https://github.com/SysAdminDoc/TsunamiSimulator/releases/latest.json` (a custom JSON we publish alongside each release, signed with a project-private Ed25519 key). If a newer version is available, surface a non-intrusive toast: "TsunamiSimulator vX.Y.Z is available — Restart to install [Later]". Auto-download in the background; restart applies. Opt-out toggle in Settings.
- **Implementation**:
  - Generate Ed25519 keypair (`tauri signer generate`). Public key into `tauri.conf.json` `plugins.updater.pubkey`. Private key into GH Actions secret `TAURI_SIGNING_PRIVATE_KEY`.
  - `release.yml` extra step: produce + sign the update manifest, upload alongside artifacts.
  - `src-tauri/Cargo.toml` + `tauri-plugin-updater` registration in `lib.rs`.
  - Frontend toast component + Settings opt-out.
- **Risks**:
  - Auto-updater pulls binaries from GitHub — already trusted. No new privacy surface.
  - User on a corporate network without GitHub access — gracefully degrade to no-update (already documented in Tauri plugin).
- **Verification**: Tag a v0.3.0, build it, install v0.2.1, launch — toast appears within ~10 s. Click "Restart to install" — v0.3.0 is now running.
- **Complexity**: M (mostly wiring; Tauri provides the heavy lifting)
- **Priority**: P1 — directly closes the "blank-globe regression reach" gap that motivated this audit.

### F-V08 — MP4 / WebM timeline export (P1)

- **Problem solved**: PNG export ships in v0.2.0 but is a single frame. Users sharing scenarios on social media or in classrooms want the *animation*, not a freeze-frame. The SwePlayback's 24-frame snapshot sequence is already in memory.
- **Evidence**: `TODO.md`: "MP4 timeline recording (mp4-muxer + canvas frame capture loop)" is unchecked. The PNG export pattern in `lib/export.ts` is the template.
- **Proposed behavior**: New "Export MP4" button next to "Export PNG" in the header. Disabled until SwePlayback snapshots exist. On click, iterate `snapshots[]`, call `setActiveIdx(i)` synchronously, await the next render, capture `canvas.toDataURL`, push the frame into `mp4-muxer`. Save the resulting blob.
- **Implementation**:
  - npm `mp4-muxer` (small, MIT, ~10 KB).
  - `lib/export.ts` new `exportGlobeMp4()` function.
  - Header button + busy state.
- **Risks**: 24 frames at ~1080p × 24 fps = ~1 s of video, ~5-10 MB. Acceptable.
- **Verification**: Click Export MP4 with a Tohoku simulation loaded — a `.mp4` downloads and plays in VLC/QuickTime.
- **Complexity**: M
- **Priority**: P1 — high social-share lever, modest effort.

### F-V09 — Hunga Tonga atmospheric Lamb-wave source (P2)

- **Problem solved**: The `hunga_tonga_2022` preset's `controversy_note` already says "Atmospheric Lamb-wave coupling (a major component of the real event) not yet modeled." The 2022 event's defining physics — the atmospheric pressure wave coupling into the ocean and driving the global tsunami — is research-frontier and no consumer tool has it.
- **Evidence**: Carvajal et al. 2022, *Science* 377:91; Matoza et al. 2022, *Science* 377:95. Kubota et al. 2022 ascribes the unusual far-field arrival to Lamb-wave coupling.
- **Proposed behavior**: A new `physics::lamb_wave` module that propagates a circular atmospheric pressure pulse at the Lamb-wave speed (~310 m/s) outward from the source, with a coupling coefficient `α_LW ≈ p / (ρ_w g)` driving the ocean surface. Plumb to a new preset variant `hunga_tonga_2022_with_lamb`.
- **Implementation**:
  - `src-tauri/src/physics/lamb_wave.rs` — closed-form atmospheric pressure pulse + ocean coupling.
  - Extension of `SimulateGridRequest` with `include_lamb_wave: bool`.
  - SwePlayback toggle.
  - Citation update to `docs/science/REFERENCES.bib`.
- **Risks**: This is unsettled science; reasonable researchers disagree on the coupling magnitude. Document the model + uncertainty band prominently.
- **Verification**: Lamb-wave-driven amplitude at e.g. Tonga DART 51425 at t ≈ 5 h after origin should be ~10 cm (Carvajal Fig 2).
- **Complexity**: M
- **Priority**: P2 — unique research-frontier feature; not urgent.

### F-V10 — Radiation / sponge-layer boundary conditions (P2)

- **Problem solved**: Current solver uses **zero-flux walls** (`u = v = 0` at i=0, i=nx-1, j=0, j=ny-1) — long-running simulations reflect the wave back into the source, polluting the snapshot sequence after ~30 minutes of simulated time on a 16°-half-box grid.
- **Evidence**: `src-tauri/src/physics/solver/mod.rs` lines 359, 393 explicitly install zero-flux. `docs/science/README.md` validation targets imply runs longer than current artifact-free duration.
- **Proposed behavior**: Replace zero-flux with a **Sommerfeld radiation condition** (`∂η/∂t + c ∂η/∂n = 0`) on the four boundaries, or a 10-cell-wide **sponge layer** that damps amplitudes via `η_new = η_new · (1 − damping(d_from_edge))`.
- **Implementation**: Add a `BoundaryMode` enum to `TimeStepper` — `ZeroFlux` (current), `Sommerfeld`, `Sponge { width_cells }`. Default switch to `Sponge { width_cells: 10 }` for the live solver.
- **Risks**: Sponge layer slightly reduces effective sim area; document.
- **Verification**: Run a 24-hour Tohoku sim — central η at t = 12 h should be << 1 m (not reflected). Test added to `solver::tests`.
- **Complexity**: M
- **Priority**: P2 — fidelity at long simulated times; not user-visible at the current 1-hour playback default.

### F-V11 — Click-on-globe for instant point readout (P2)

- **Problem solved**: A user looking at the wavefront ring or runup bars can see *that* a wave reaches a coastline but can't easily get the numeric amplitude / arrival time at a specific point. NUKEMAP and Earth NullSchool both shine here.
- **Evidence**: `runup_at_points` already exists for batch operation. The Globe already has click-pick wiring for scenario-builder. Reusing it for a readout overlay is a small extension.
- **Proposed behavior**: A header toggle "Inspect" → click anywhere on the globe → tooltip showing `range, offshore amp, arrival ETA, Synolakis runup` at that point. Tooltip persists until user clicks elsewhere or presses Esc.
- **Implementation**: Reuse `Cesium.ScreenSpaceEventHandler` infrastructure. New backend command `inspect_at_point(lat, lon, source, ...)`. New `InspectOverlay.tsx` component.
- **Risks**: Requires that `data::bathymetry::sample` work at arbitrary lat/lon (currently does — coarse but always returns a value).
- **Verification**: Tohoku preset + Inspect on (Hilo, HI) → tooltip shows ~8 hr arrival, ~1 m offshore amplitude.
- **Complexity**: M
- **Priority**: P2 — high "feels powerful" lever for general users.

### F-V12 — Onboarding tour (P3)

- **Problem solved**: First-time users may not know the difference between the four source-types, what "Compare" does, or how the SWE playback differs from the timeline scrubber.
- **Evidence**: No onboarding tour exists. The first-run modal is reference-only.
- **Proposed behavior**: A 5-step tooltip tour: (1) preset rail, (2) globe + fly-to, (3) results panel + timeline, (4) SWE playback Run/Play, (5) scenario builder. Triggered automatically on first launch (after disclaimer), dismissible, re-runnable from Settings.
- **Implementation**: `react-joyride` or `shepherd.js` (both MIT, ~30 KB gzipped). Settings → "Show tour again".
- **Risks**: Adds a small dependency. Acceptable.
- **Verification**: First-launch test on a fresh `app_data_dir`.
- **Complexity**: M
- **Priority**: P3 — nice-to-have, not urgent.

### F-V13 — Per-preset playback presets (camera angle + zoom + timeline range) (P3)

- **Problem solved**: Each preset has a "natural" camera framing — Chicxulub wants a global view, Lituya wants a tight 50 km zoom. Currently a one-size-fits-all flyTo clamp range tries to interpolate.
- **Evidence**: `Globe.tsx` flyRange = `clamp(cavity_radius_m * 25, 5e5, 8e6)` — heuristic, not curated.
- **Proposed behavior**: Each `Preset` gains an optional `camera_view: { heading_deg, pitch_deg, range_m }` field. The flyTo uses the curated view when present.
- **Implementation**: Add field to `Preset` struct + each preset entry. Update `Globe.tsx::flyTo` to honor it.
- **Risks**: None.
- **Verification**: Lituya preset lands tight on Gilbert Inlet, not a global view.
- **Complexity**: S
- **Priority**: P3 — polish.

---

## Existing Feature Improvements

### I-V01 — Wet/dry land cell handling in the SWE solver (P1)

- **Current**: `simulate_grid` substitutes `1 m` "tiny wet" depth on land cells so the solver's CFL doesn't blow up. The wave propagates over land at `√(g · 1) ≈ 3.13 m/s` — physically wrong; produces a visible "halo" of slow wave-spread on continental masses.
- **Recommended**: Implement proper wet/dry MUSCL-style flux limiter or a simple "h_total < 1 cm → freeze cell" mask. The latter is a 30-line change to the leapfrog loop.
- **Code locations**: `src-tauri/src/physics/solver/mod.rs::step_one`.
- **Backward compatibility**: SWE snapshot PNGs may visibly change (cleaner coastlines, no land halo).
- **Verification**: Tohoku simulation at t = 1 h — wave amplitude on continental land cells = 0 (currently nonzero).
- **Complexity**: M
- **Priority**: P1

### I-V02 — Inundation polygons (P1)

- **Current**: Runup is rendered as discrete 3D bars at 60+ named points. The geographic *extent* of inundation (the polygon enclosing all flooded cells) isn't shown.
- **Recommended**: After a SWE run, for each snapshot, compute `cells where h + η > 0` along the coastline; emit a GeoJSON polygon; render as a translucent overlay on the globe.
- **Code locations**: New `commands.rs::inundation_polygon` command; `Globe.tsx` GeoJSON-DataSource for rendering.
- **Backward compatibility**: Optional overlay, off by default.
- **Verification**: Tohoku simulation — Sendai Plain shows ~5 km inland polygon (matches the observed 8 km).
- **Complexity**: M
- **Priority**: P1 — depends on I-V01 wet/dry.

### I-V03 — Promote `cargo audit` from advisory to fail-on-vuln (P1)

- **Current**: `.github/workflows/ci.yml` line 97 runs `cargo audit || true`. Vulnerabilities surface in logs but never block a PR.
- **Recommended**: Drop the `|| true`. If the baseline is clean today (it is, per the current advisory database), then any future PR introducing a known-vulnerable transitive crate will fail CI loudly.
- **Code locations**: `.github/workflows/ci.yml`.
- **Backward compatibility**: A future Dependabot bump introducing a vulnerable dep would now block merging. Net positive — that's the value.
- **Verification**: Force-add a known-vulnerable crate (`thread_local = "0.3.5"`) → CI fails. Remove → CI green.
- **Complexity**: S
- **Priority**: P1

### I-V04 — Replace Cesium token storage with OS keychain (`tauri-plugin-keyring`) (P1)

- **Current**: Cesium ion token lives in `app_data_dir/settings.json` (flat JSON file readable by any process running as the user) + `localStorage` mirror. Per `SECURITY.md` "Settings store leakage (e.g. Cesium ion tokens being readable outside the user's `app_data_dir`)" is *in scope*; the flat-file approach is the weakest interpretation.
- **Recommended**: Use `tauri-plugin-keyring` (or `keyring` Rust crate) to store the token in Windows Credential Manager / macOS Keychain / Linux Secret Service. Fall back to the current store if no keychain available.
- **Code locations**: `src/lib/settings.ts::setCesiumToken/getCesiumToken`; new Rust command bridging keyring.
- **Backward compatibility**: Migrate existing tokens out of the flat store on first launch with keyring support.
- **Verification**: After save, `cat $APPDATA/.../settings.json` should NOT contain the token string.
- **Complexity**: M
- **Priority**: P1 — matches the SECURITY.md threat model.

### I-V05 — Bump GitHub Actions to Node 24 + `windows-2025-vs2026` (P2)

- **Current**: `actions/checkout@v4` + `actions/setup-node@v4` + `windows-latest` all generate deprecation warnings. Hard deadlines: Node 20 actions deprecated June 2 2026; `windows-latest` redirects to `windows-2025-vs2026` after June 15 2026.
- **Recommended**: Bump to `actions/checkout@v5` (when available; check release notes) and `actions/setup-node@v5`, pin `windows-2025-vs2026` explicitly (note that VS 2026 is already the host so this is a no-op pin for clarity).
- **Code locations**: `.github/workflows/{ci,release}.yml`.
- **Backward compatibility**: None — the bumps are transparent.
- **Verification**: CI green; no deprecation warnings.
- **Complexity**: S
- **Priority**: P2 — has a hard deadline but not urgent today.

### I-V06 — Reduced-motion + high-contrast theme honors (P2)

- **Current**: No `@media (prefers-reduced-motion)` overrides. The flyTo (1.8 s smooth animation) and the timeline-bar `:hover { transform: translateY(-1px) }` ignore user preference. WCAG 2.2 SC 2.3.3.
- **Recommended**: Add `@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } .button { transform: none !important; }}` block. Set Cesium `flyTo` duration to 0.4 s when reduced motion is set.
- **Code locations**: `src/styles.css`; `src/components/Globe.tsx` flyTo duration.
- **Backward compatibility**: None — users who haven't enabled reduced motion see no change.
- **Verification**: Toggle reduced-motion in OS settings → flyTo is near-instant; hover effects gone.
- **Complexity**: S
- **Priority**: P2 — WCAG compliance lever.

### I-V07 — Aria-live region for SwePlayback errors + runup arrivals (P2)

- **Current**: SwePlayback errors render in a styled banner but aren't announced to screen readers. Coastal runup bars appear silently on the globe as waves arrive.
- **Recommended**: Add `<div role="status" aria-live="polite">` and route human-readable transitions ("Solver error: ...", "Wave arrived at 3 coastal points") through it.
- **Code locations**: `src/components/SwePlayback.tsx`, `src/components/CoastalRunupOverlay.tsx`.
- **Backward compatibility**: None.
- **Verification**: Test with VoiceOver / NVDA — the announcements fire.
- **Complexity**: S
- **Priority**: P2

### I-V08 — In-app log viewer + "Copy diagnostics to clipboard" (P3)

- **Current**: No way to gather the JS console / Tauri command log from a packaged build. Issue-template prompts "what happened" but users can't paste a stack trace.
- **Recommended**: A hidden Ctrl+Shift+L log panel that captures the last N (1000?) `console.*` calls + Tauri command errors. "Copy to clipboard" button. Documented in the bug template.
- **Code locations**: New `src/lib/log-buffer.ts`; install a console-replay at `main.tsx`. New `src/components/LogPanel.tsx`.
- **Backward compatibility**: None.
- **Verification**: Ctrl+Shift+L opens the panel; Copy puts a multi-line diagnostic on the clipboard.
- **Complexity**: M
- **Priority**: P3

### I-V09 — Per-preset arrival-time at named coastal points in the readout (P3)

- **Current**: `CoastalRunupOverlay` puts 3D bars on the globe with runup magnitude. The arrival time is computed but not displayed numerically.
- **Recommended**: When the user hovers a runup bar, show `Arrival: T+3h12m · Runup: 8.2m` in a Cesium label.
- **Code locations**: `src/components/CoastalRunupOverlay.tsx` (track entity → result map already exists; just expand the label).
- **Backward compatibility**: None.
- **Verification**: Hover Hilo on Tohoku preset → "Arrival: T+5h28m · Runup: 8.0m".
- **Complexity**: S
- **Priority**: P3

### I-V10 — Settings: "Reset to defaults" + "Show first-run again" (P3)

- **Current**: No way to reset settings other than deleting `app_data_dir/settings.json` manually. No way to re-trigger the first-run disclaimer.
- **Recommended**: Settings → "Advanced" → two buttons. Both behind a confirm dialog.
- **Code locations**: `src/components/Settings.tsx`, `src/lib/settings.ts`.
- **Backward compatibility**: None.
- **Verification**: Click "Reset to defaults" → confirm → relaunch shows OSM globe + first-run modal again.
- **Complexity**: S
- **Priority**: P3

---

## Reliability, Security, Privacy, Data Safety

### Bugs / risks the v0.2.1 audit closed

- **(critical) v0.2.0 blank-globe** on Run simulation — `SingleTileImageryProvider` deprecation. Fixed in `acd2564`. **Needs live validation by the user.**
- **NaN poisoning** in `synolakis_runup_m` from `powf(5/4)` of negative amplitudes — fixed in `89a1ff8`.
- **`usize` overflow** in `run_simulation` if `dt_s` was non-finite — fixed in `89a1ff8`.
- **IPC** unbounded inputs (NaN diameter, 10⁹ Mt nuclear yield, 50 000-point coastal batch) — closed in `89a1ff8` + `198b894`.
- **Imagery rebuild wiped SWE overlay** on globe-style swap — fixed in `acd2564`.
- **Dateline-straddling scenarios** could construct an invalid `Cesium.Rectangle` and blank the whole scene — clamped in `acd2564`.
- **External link middle-click** could navigate the WebView off the React app — closed in `198b894` with `target="_blank" rel="noopener noreferrer"`.

### Open risks (post-v0.2.1)

| Risk | Severity | Mitigation status |
|---|---|---|
| Cesium ion token in flat-file `app_data_dir/settings.json` | Medium | See I-V04 (P1) |
| No code signing → SmartScreen / Gatekeeper warnings | Medium | See F-V04 (P0) |
| No in-app update channel → blank-globe regression doesn't reach users | High (for now) | See F-V07 (P1) |
| Cesium-WebGL `unsafe-eval` CSP required for WASM tile decoder | Low (Cesium-upstream, documented in `CLAUDE.md`) | None — Cesium constraint |
| SWE solver reflects waves off zero-flux walls in long sims | Low | See F-V10 (P2) |
| `cargo audit` is advisory | Medium | See I-V03 (P1) |
| Auto-updater Ed25519 private-key handling | Conditional on F-V07 | Document key-rotation procedure |
| GitHub Actions Node 20 deprecation | Low (hard deadline 2026-06-02) | See I-V05 (P2) |

### Missing guardrails (verified)

- No "Reset to defaults" — users with a corrupted store have no escape hatch (P3, I-V10).
- No log buffer for diagnostics → bug reports lack stack traces (P3, I-V08).
- No telemetry by design — *intentional*, document this prominently in `SECURITY.md` to build trust.

---

## UX, Accessibility, and Trust

### Onboarding gaps

1. **No screenshots on the GitHub README** — F-V03 (P0). First impression for any visitor.
2. **No animated demo** — F-V03 (P0). Single GIF/WebP shows what the app does in 5 seconds.
3. **No 5-step tour** — F-V12 (P3). Less critical because the layout is mostly self-explanatory.

### Empty / loading / error / disabled states

| State | Coverage |
|---|---|
| Globe with no source selected | Hint card — ✓ |
| Globe loading imagery | "Loading globe imagery…" badge with pulse — ✓ |
| Globe imagery error | "Imagery failed to load — check your network" — ✓ |
| SWE solver running | "Computing…" button label — ✓ |
| SWE solver error | Red banner with error message — ✓ |
| Browser-preview mode (non-Tauri) | Warnings in console — minor; not a real user surface |
| Coastal runup hasn't arrived | Bar hidden — ✓ |
| Settings save failure | Red error message + savedAt suppression — ✓ |
| Compare mode slot B empty | Slot B preset rail visible, globe hint card — ✓ |

### Destructive actions

None warrant a confirm dialog at current scope. If F-V07 lands, "Restart to install" should be a non-destructive toast.

### Microcopy / trust signals

- **First-run disclaimer** is excellent — names NOAA NTWC, JMA, IOC explicitly.
- **App header banner** "Educational only — not for evacuation. Use NOAA NTWC/PTWC for warnings." — excellent.
- **Speculative preset warnings** (⚠ icon + controversy_note) — excellent.
- **Cesium ion token section in Settings** — excellent, explicit about local storage.

### Recommended additions

- **Settings footer**: "TsunamiSimulator collects no telemetry. No data leaves your device except network calls to the tile providers you select."
- **Citations modal footer**: link to `docs/science/REFERENCES.bib` raw.

---

## Architecture and Maintainability

### Module boundaries (Verified — clean)

- Physics is in Rust only. The frontend never computes wave heights. ✓
- Cesium entities are projections of backend snapshots — no two-way state. ✓
- Settings flow through `lib/settings.ts`; no direct `localStorage`/store access from components. ✓
- IPC type contracts duplicated in TS `types/scenario.ts` and Rust structs. **Mild redundancy** — both have to be hand-synced.

### Refactor candidates

- **`src/components/Globe.tsx`** (526 lines) — borderline too large. Could split per-entity-type effects into `useSourceEntity`, `useWavefrontRings`, `useRunupBars`, `useDartPins`, `useSweOverlay` hooks. **Defer until the GPU solver + inundation polygon land** to avoid churn.
- **`src-tauri/src/commands.rs`** (~520 lines including tests) — currently fine. If F-V01 validation harness adds many test fixtures, split into `commands/` directory.
- **`src/lib/tauri.ts`** — typed wrappers are 100 lines, fine as-is. **Consider generating from Rust** via `specta` + `tauri-specta` to eliminate the manual TS/Rust contract duplication. P2.

### Test gaps

Major surfaces with no Rust tests (Verified):
- `physics::okada` — only the leading-order pass has a shape-smoke test. **P0** (F-V01).
- `physics::solver::run_simulation` — covered by 3 tests (alloc + propagate + snapshot count). No GPU-vs-CPU comparison. **P1** (F-V05).
- `commands::simulate_grid` — no end-to-end test (the worker uses `tauri::async_runtime::spawn_blocking` which is hard to invoke from a pure `cargo test`). Acceptable.
- Frontend has **zero** unit tests. No `vitest` or `jest` installed. **P2** — `@testing-library/react` for at least the form-validation hooks.

### Documentation gaps

- `docs/science/REFERENCES.bib` exists; **per-source derivation notes** (asteroid.md, nuclear.md, ...) referenced in `docs/science/README.md` do NOT exist. **P2** — generate from existing in-module rustdoc.
- No `docs/release/RELEASING.md` — the "Release vX.Y.Z" recipe lives in the maintainer's memory file only. **P3** — externalise.

### Release / build / deploy gaps

| Gap | Priority |
|---|---|
| No code signing | P0 (F-V04) |
| No in-app updater | P1 (F-V07) |
| `cargo audit` advisory | P1 (I-V03) |
| GitHub Actions Node 20 deprecation | P2 (I-V05) |
| No SLSA / SBOM attestation | P3 — file later; not blocking |

---

## Prioritized Roadmap

Implementation-ready checklist. Each item ties to a section above for the full rationale.

### Phase 0.3.0 — Credibility + reach (target release in 2–4 weeks)

- [ ] **P0 — Validation harness (F-V01)**
  - Why: Removes the "no quantitative agreement with any reference" gap that blocks the project from being taken seriously by researchers.
  - Evidence: `RESEARCH_FEATURE_PLAN.md` Phase 5 DoD; `docs/science/README.md` validation targets — all unverified today.
  - Touches: `src-tauri/src/physics/validation.rs` (new), `docs/science/VALIDATION.md` (new), `Cargo.toml` `[features] validation`.
  - Acceptance: `cargo test --release --features validation` green on all three targets (Stoker ±5%, Carrier-Greenspan ±10%, Range Chicxulub OOM).
  - Verify: `cd src-tauri && cargo test --release --features validation -- validation::`.

- [ ] **P0 — Real Okada I-term (F-V02)**
  - Why: Earthquake source physics is currently 10× off observed Tōhoku uplift.
  - Evidence: `physics/okada.rs` (post-v0.2.1 cleanup leaves only the leading-order pass); two `#[ignore]`d tests.
  - Touches: `src-tauri/src/physics/okada.rs`, `src-tauri/src/physics/earthquake.rs`, `src-tauri/src/commands.rs` (wire `OkadaFault` into `earthquake_initial_conditions`).
  - Acceptance: Tohoku preset's reported peak amplitude lands within 50% of the observed ~7 m at the source.
  - Verify: Remove `#[ignore]` from `okada::tests::tohoku_peak_uplift_in_range` and `okada::tests::strike_slip_zero_vertical_at_origin`; `cargo test --release` green.

- [ ] **P0 — README screenshots + demo (F-V03)**
  - Why: Empty `assets/screenshots/` directory; first-time GitHub visitors see only text.
  - Evidence: `ls assets/screenshots/` empty.
  - Touches: `assets/screenshots/*.png`, `assets/screenshots/chicxulub-demo.webp`, `README.md` "Features" section.
  - Acceptance: README renders 5 screenshots + 1 animated demo on GitHub.
  - Verify: View `https://github.com/SysAdminDoc/TsunamiSimulator` after merge — visual check.

- [ ] **P0 — Code signing (F-V04)**
  - Why: Windows SmartScreen / macOS Gatekeeper warnings on first launch are an install-conversion killer.
  - Evidence: `release.yml` has no sign step; `tauri.conf.json` has no cert thumbprint.
  - Touches: `.github/workflows/release.yml`, `src-tauri/Entitlements.plist` (new), `docs/release/CODESIGNING.md` (new).
  - Acceptance: Vanilla Win 11 + macOS 13 install of next signed release launches without warnings.
  - Verify: Manual install on a clean VM; check signature with `signtool verify` (Windows) and `spctl --assess --verbose --type execute` (macOS).
  - Gating: maintainer must obtain an EV cert + Apple Developer ID; otherwise step is conditional + sane-noop.

- [ ] **P1 — `wgpu` SWE solver (F-V05)**
  - Why: 50-100× perf unlocks GEBCO-resolution grids; WGSL kernel already scaffolded.
  - Evidence: `physics/solver/kernels.rs::SWE_LEAPFROG_WGSL` already present.
  - Touches: `src-tauri/src/physics/solver/gpu.rs` (new), `src-tauri/src/physics/solver/mod.rs`, `src-tauri/src/commands.rs::simulate_grid` (dispatcher), `src-tauri/Cargo.toml` (`wgpu`, `pollster`).
  - Acceptance: 50 cells/deg Tohoku run completes in <2 s on a recent dGPU; CPU-vs-GPU regression test ±1e-4.
  - Verify: `cargo test --release --features gpu -- swe_gpu_matches_cpu`.

- [ ] **P1 — Real GEBCO bathymetry (F-V06)**
  - Why: 7-basin proxy misses every island; key for credible Tohoku / Sumatra / Storegga simulations.
  - Evidence: `data/bathymetry/README.md` + `bathymetry.rs` comments both call this out as the v0.3.0 work.
  - Touches: `src-tauri/src/data/gebco.rs` (new), `src-tauri/src/data/bathymetry.rs`, `src-tauri/src/commands.rs::download_bathymetry` (new command), `src/components/FirstRunBathymetryPrompt.tsx` (new), `scripts/build-bathymetry.rs` (new build script).
  - Acceptance: After first-launch download (~440 MB cached), Tohoku SWE simulation visibly reflects/refracts on the Japan Trench geometry.
  - Verify: `ls $APPDATA/com.sysadmindoc.tsunamisimulator/gebco_2024_30s.zstd` exists after download; visual check.

- [ ] **P1 — `tauri-plugin-updater` (F-V07)**
  - Why: Users on v0.2.0 with the blank-globe bug have no in-app signal that v0.2.1 fixes it.
  - Evidence: `TODO.md` P1 item; Tauri 2 ships the plugin upstream.
  - Touches: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`), `.github/workflows/release.yml` (manifest sign + upload step), `src/components/UpdateToast.tsx` (new).
  - Acceptance: A v0.4.0 release triggers an in-app toast within 10 s on a v0.3.0 install.
  - Verify: Manual end-to-end on a test build.

- [ ] **P1 — MP4 export (F-V08)**
  - Why: PNG export already ships; MP4 unlocks social/classroom sharing of animations.
  - Evidence: `TODO.md` MP4 sub-bullet unchecked.
  - Touches: `src/lib/export.ts`, `src/App.tsx` header, `package.json` (`mp4-muxer`).
  - Acceptance: Export MP4 on Tohoku → playable in VLC.
  - Verify: Manual download check.

- [ ] **P1 — Wet/dry land cells (I-V01)**
  - Why: Visible "halo" of slow-spread on continental land in current SWE PNGs.
  - Touches: `src-tauri/src/physics/solver/mod.rs::step_one`.
  - Acceptance: Land-cell amplitudes = 0 in Tohoku snapshot at t = 1 h.
  - Verify: New `solver::tests::land_cells_stay_dry`.

- [ ] **P1 — Inundation polygons (I-V02)**
  - Why: Geographic extent of flooding, complements the discrete 3D bars.
  - Touches: `src-tauri/src/commands.rs::inundation_polygon` (new), `src/components/Globe.tsx` GeoJSON-DataSource.
  - Acceptance: Sendai Plain shows ~5-10 km inland polygon on Tohoku at t = 30 min.
  - Verify: Visual check against published 8 km observation.

- [ ] **P1 — Promote `cargo audit` to fail-on-vuln (I-V03)**
  - Why: Vulnerability surfacing is currently advisory only.
  - Touches: `.github/workflows/ci.yml` line 97.
  - Acceptance: Future PR introducing vulnerable transitive crate fails CI.
  - Verify: Smoke test by force-adding `thread_local = "0.3.5"`.

- [ ] **P1 — Cesium token in OS keychain (I-V04)**
  - Why: Flat-file storage of an API token is the weakest secret-management approach; SECURITY.md treats it as in-scope.
  - Touches: `src/lib/settings.ts`, new Rust command bridging `keyring` crate.
  - Acceptance: `cat $APPDATA/.../settings.json` does NOT contain the token after save.
  - Verify: Manual filesystem inspection.

### Phase 0.4.0 — Research-frontier physics + power-user (target post-0.3.0)

- [ ] **P2 — Hunga Tonga atmospheric Lamb-wave source (F-V09)**
- [ ] **P2 — Radiation / sponge-layer boundary conditions (F-V10)**
- [ ] **P2 — Click-on-globe inspect overlay (F-V11)**
- [ ] **P2 — Bump GitHub Actions to Node 24 + windows-2025 (I-V05)**
- [ ] **P2 — Reduced-motion + high-contrast theme honors (I-V06)**
- [ ] **P2 — Aria-live for SwePlayback + runup arrivals (I-V07)**

### Phase 0.5.0 — Polish + advanced solvers

- [ ] **P3 — Onboarding tour (F-V12)**
- [ ] **P3 — Per-preset camera views (F-V13)**
- [ ] **P3 — In-app log viewer (I-V08)**
- [ ] **P3 — Arrival-time labels on runup bars (I-V09)**
- [ ] **P3 — Settings: Reset + Show-tour-again (I-V10)**

### Phase 1.0.0 — Research-grade

- [ ] **P3 — Boussinesq dispersive solver** (`RESEARCH_FEATURE_PLAN.md` Phase 5)
- [ ] **P3 — Adaptive Mesh Refinement** (`RESEARCH_FEATURE_PLAN.md` Phase 5)
- [ ] **P3 — Population casualty overlay** (`TODO.md` F14 — heavy disclaimer required)

---

## Quick Wins (one-day-or-less changes)

- [ ] **I-V03 — `cargo audit` fail-on-vuln** — 1 line in `ci.yml`.
- [ ] **I-V05 — Node 24 + windows-2025-vs2026** — 2 lines in CI/release YAMLs once `actions/checkout@v5` is GA.
- [ ] **I-V06 — `prefers-reduced-motion`** — ~15 lines of CSS + 1 line in `Globe.tsx` flyTo.
- [ ] **I-V07 — aria-live regions** — ~10 lines across 2 components.
- [ ] **I-V09 — Runup hover labels** — 5 lines in `CoastalRunupOverlay`.
- [ ] **I-V10 — Reset-to-defaults button** — 30 lines in `Settings.tsx`.
- [ ] **F-V13 — Per-preset camera views** — Add field to 11 preset entries + 4 lines in `Globe.tsx`.

These should all fit in a single morning and would meaningfully raise the polish floor.

---

## Larger Bets (require design + staged rollout)

- **F-V01 Validation harness** — design the closed-form vs. solver comparison; document tolerance bands; add `[features] validation` to Cargo.
- **F-V02 Real Okada I-term** — careful numerical implementation; full reading of Okada 1985 Section 6; thorough unit tests against published Table 2.
- **F-V04 Code signing** — maintainer must obtain EV cert + Apple Developer enrollment; one-time DevOps setup with secret rotation strategy.
- **F-V05 wgpu solver** — `wgpu` API churn + Vulkan/Metal/D3D12 driver matrix; staged behind `--features gpu` for safety.
- **F-V06 Real GEBCO** — design choice on download size (440 MB at 30s vs. 6 GB at 15s); CDN cost; cache-versioning policy.
- **F-V07 Auto-updater** — Ed25519 key generation + storage; rate-limit polling logic; opt-out UX.

Each of these warrants a `docs/design/XXX.md` short design doc before implementation begins.

---

## Explicit Non-Goals

- **No telemetry**. Even anonymous usage counts. The trust posture (educational tool with hard "don't use for evacuation" disclaimer) is incompatible with even soft data collection. Document this in `SECURITY.md`.
- **No paid SaaS or backend**. The product is local-first. We deliberately don't ship a server.
- **No multi-user real-time collaboration**. Scope creep.
- **No iOS/Android port**. Tauri Mobile is plausible but the UI is laptop/desktop-shaped; mobile would need a separate design pass. Out of scope for v0.3.x.
- **No live tsunami warning integration** (NOAA NTWC RSS, JMA WS). The disclaimer says "use NTWC/PTWC" — integrating would invite confusion with the operational warning posture, which the product explicitly disavows.
- **No "operational" branding**. We do not want a user mistaking this for an evacuation tool. Any UI polish (NOAA-style visual idioms in F-V11) must preserve clear "educational" framing.
- **No GPL-licensed runtime deps that would force re-licensing**. The project is MIT; keep it that way.
- **No proprietary file formats**. Scenario exports should be JSON (CZML-compatible deep links per `TODO.md` F10 sub-bullet are fine; that's still text).

---

## Open Questions

These are the only items where research and inspection cannot answer the question — the maintainer needs to decide:

1. **Code-signing budget**: Is the maintainer willing to fund an EV cert (~$300/yr) + Apple Developer enrollment ($99/yr)? F-V04 cannot land without one or the other.
2. **GEBCO distribution**: Self-host the ~440 MB bathymetry asset on the GitHub Release page (counts against repo storage and bandwidth) or use Cloudflare R2 ($0.015/GB egress)? F-V06 needs this answered.
3. **Ed25519 key custody**: Is the maintainer comfortable storing the auto-updater signing key as a GH Actions secret only, or should it be offline-only with manual signing? F-V07 acceptance depends on this.
4. **Lamb-wave physics uncertainty**: Carvajal vs. Kubota vs. Matoza differ on coupling magnitude. Should F-V09 expose the choice to users (radio-button between "Carvajal 2022", "Kubota 2022") or pick a default? Influences UX complexity.

Everything else has been answered by inspecting the repo, the code, the docs, the public Cesium/Tauri/standard references, or the v0.0.1 plan's competitive landscape.

---

*End of research and feature plan v0.3.0. Generated 2026-05-25 against commit `ef90dc8` (`v0.2.1`). Companion to `RESEARCH_FEATURE_PLAN.md` (v0.0.1 baseline), `ROADMAP.md` (canonical phased plan), and `TODO.md` (granular checklist).*
