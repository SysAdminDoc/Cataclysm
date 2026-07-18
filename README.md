<p align="center">
  <img src="./assets/branding/logo.svg" width="152" height="152" alt="Cataclysm propagation and fault logo">
</p>

# Cataclysm

[![Version](https://img.shields.io/badge/version-0.10.5-blue.svg)](./CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](#install)
[![Stack](https://img.shields.io/badge/stack-Tauri%202%20%2B%20React%20%2B%20CesiumJS%20%2B%20Rust-orange.svg)](#architecture)
[![Physics](https://img.shields.io/badge/physics-Ward%E2%80%93Asphaug%20%7C%20Synolakis%20%7C%20Okada%20%7C%20Glasstone%E2%80%93Dolan%20%7C%20Holsapple-purple.svg)](./docs/science)

> A scientifically grounded 3D-globe **multi-hazard disaster simulator**: asteroid impacts (entry, airburst, cratering, thermal/blast), nuclear detonations (fireball, overpressure, thermal, radiation, EMP, fallout, casualties), seafloor earthquakes, subaerial/submarine landslides — and the tsunamis these events generate. Peer-reviewed historical presets span Chicxulub, Tunguska, Chelyabinsk, Hiroshima, Tsar Bomba, Tōhoku 2011, and Lituya Bay 1958.

**Cataclysm** unifies three former projects — **TsunamiSimulator** (its base), **AsteroidSimulator**, and **NukeMap** — into one globe. It began life as "the NukeMap for tsunamis"; it now aims to *be* the NukeMap, the impact simulator, and the tsunami solver at once.

The Cataclysm mark combines three propagating wavefronts, a fault cut, and a
single event core. The same source artwork is used by the desktop installers,
mobile targets, PWA, launch experience, and in-app command bar.

> **Migration status (v0.10.5):** tsunami, asteroid, earthquake, landslide, and nuclear models now sit behind a progressively disclosed professional workspace. Simple keeps the scenario, globe, Run & Watch journey, timeline, and outcomes dominant; Customize reveals a small understandable control set; Advanced restores exact grids, gauges, confidence, and scientific diagnostics. Source-aware Outcome, Science, and Validation views connect named coastal effects to the globe and timeline while retaining auditable assumptions and provenance. Rust remains the sole authority for direct-effect and named-coast inputs.

---

## Visual tour

![Cataclysm professional simulator workspace in the dark theme](./assets/screenshots/simulator-workspace-dark.png)

| Light workspace | Categorized settings |
|---|---|
| ![Cataclysm simulator workspace in the light theme](./assets/screenshots/simulator-workspace-light.png) | ![Professional simulator settings with category navigation](./assets/screenshots/settings-dark.png) |

---

## Why this exists

Existing tools each do one piece:

- **[NukeMap](https://nuclearsecrecy.com/nukemap/)** — nuclear airburst effects only, 2D map, no water.
- **[Asteroid Launcher](https://neal.fun/asteroid-launcher/)** — fun, 2D map, no propagating tsunami.
- **[Purdue "Impact: Earth!"](https://impact.ese.ic.ac.uk/ImpactEarth/)** — accurate formulas, single-point readout, no animation.
- **[GeoClaw](http://depts.washington.edu/clawpack/geoclaw/)** / **[COMCOT](https://www.researchgate.net/publication/374553562)** / **[MOST](https://www.pmel.noaa.gov/news-story/first-global-tsunami-simulation-chicxulub-asteroid-impact-66-million-years-ago)** — operational accuracy, Fortran/Python, no consumer UI.

`Cataclysm` combines them: **peer-reviewed source physics + a professional interactive globe workspace**. Pick a source (asteroid, nuke, fault, slide), drop it anywhere on Earth, and watch a shallow-water solution propagate over the default low-confidence coarse basin/shelf bathymetry or a strictly validated local GeoTIFF/NetCDF-CF raster, estimate runup at named coastal points, and produce first-order inundation discs. Optional Cesium World Bathymetry improves visual terrain only; it is not the backend solver grid.

---

## Features (current build + roadmap)

### Source models (energy → initial water-surface displacement)

| Source | Status | Reference |
|---|---|---|
| **Asteroid / comet impact** | ✅ formulas wired | Ward & Asphaug 2000 *Icarus* 145:64; Schmidt & Holsapple 1982 |
| **Underwater nuclear** | ✅ formulas wired | Glasstone & Dolan 1977; Le Méhauté 1996; DNA 1996 (5% energy → wave) |
| **Atmospheric / surface nuclear (ocean)** | ✅ formulas wired | Van Dorn et al. 1968; Adams 1972 |
| **"Russia Poseidon" tsunami torpedo** | ✅ realistic mode | Skeptical physics — 360° dispersion, ~5% efficiency |
| **Earthquake (Okada fault dislocation)** | ✅ full Okada I-term wired | Okada 1985; Mansinha & Smylie 1971 |
| **Subaerial landslide** | ✅ Heller–Hager 2D channel | Fritz & Hager 2001 (Lituya); Slingerland & Voight |
| **Submarine landslide** | ✅ Watts 2003 best-fit | Watts et al. 2005 |
| **Volcanic caldera collapse** | 🔲 planned | Krakatoa 1883, Hunga Tonga 2022 |

### Propagation

- ✅ **Linear long-wave** (deep-ocean, fast preview).
- ✅ **Shallow-water equations** — well-balanced, positivity-preserving 2D finite-volume solver with `rayon`
  row-parallel updates, Manning bottom friction, CFL-safe Δt, snapshots
  rendered as PNG overlays on the Cesium globe.
- 🔲 **Boussinesq** for dispersive waves (impact-tsunami wavelengths shorter than ocean depth — important for Ward–Asphaug regime).
- 🔲 **Adaptive mesh refinement** (AMR) like GeoClaw — coarse far-field, fine coastal.
- ✅ **GPU compute** via `wgpu` behind the `gpu` feature flag, with CPU fallback when no adapter is available.

### Coastal inundation

- ✅ **Synolakis 1987 runup law** sampled at 60+ named coastal points,
  rendered as colour-graded 3D bars on the globe.
- 🔲 **MOST-style wetting/drying** on bathymetric grid.
- ✅ **First-order inundation discs** from runup/slope estimates.
- 🔲 **Real flood polygons** rendered as GeoJSON overlays on Cesium.

### Presets (historical events with peer-reviewed parameters)

| Event | Date | Source type | Magnitude | Peak wave | Reference |
|---|---|---|---|---|---|
| **Chicxulub impact** | 66 Ma | Asteroid, 14 km dia | ~10⁸ Mt TNT | 4.5 km initial, 1.5 km @ 220 km | Range et al. 2022 *AGU Adv* |
| **Tōhoku** | 2011-03-11 | M 9.1 megathrust | — | 40 m runup | Mori et al. 2011 |
| **Indian Ocean** | 2004-12-26 | M 9.2 megathrust | — | 30 m runup, 230k dead | Synolakis et al. 2005 |
| **Lituya Bay** | 1958-07-09 | Rockslide, 30 M m³ | M 7.8 trigger | **524 m runup** | Fritz et al. 2001 |
| **Krakatoa** | 1883-08-27 | Caldera collapse | VEI 6 | 42 m | Choi et al. 2003 |
| **Storegga slide** | ~8150 BP | Submarine slide, 3000 km³ | — | 20 m+ in Scotland | Bondevik et al. 2005 |
| **Hunga Tonga** | 2022-01-15 | Submarine volcano | VEI 5–6 | 15 m local + atmospheric Lamb wave | Carvajal et al. 2022 |
| **Eltanin** | 2.51 Ma | Asteroid, ~1 km dia | South Pacific | Globally significant | Gersonde et al. 1997 |
| **Hypothetical Cumbre Vieja** | — | Flank collapse (La Palma) | 500 km³ scenario | Disputed; 5–25 m E coast US | Ward & Day 2001 (controversial) |
| **"Poseidon" deployment** | — | 100 Mt underwater | — | ~1–5 m at 100 km (realistic) | DNA 1996, Glasstone 1977 |
| **Kamchatka** | 2025-07-29 | M 8.8 megathrust | — | 0.85 m at DART 21416 (2nd-largest ever recorded) | USGS us6000qw60; NCTR |
| **Sanriku (Miyako)** | 2026-04-20 | M 7.4 thrust | — | modest; warning in 17 min | USGS us6000sri7; NCTR |
| **Lisbon** | 1755-11-01 | M ~8.7 thrust | — | trans-Atlantic | Barkan et al. 2009 |
| **Amorgos** | 1956-07-09 | M 7.7 normal fault | — | 30 m local (landslide-driven) | Okal et al. 2009 |
| **Anak Krakatau** | 2018-12-22 | Flank collapse, 0.27 km³ | — | ~50 m near volcano | Grilli et al. 2019 |
| **2024 YR4 what-if** | — | Asteroid, 60 m (impact ruled out) | ~7.7 Mt | myth-busting upper bound | NASA/JWST |

### UX

- **Desktop-first professional simulator workspace** — persistent scenario
  library, dominant globe viewport, Setup / Results / Layers inspector, and a
  full-width simulation transport with playback speed and solver state.
- **Focused command bar** — mode switching, inspect/compare tools, grouped
  exports, references, and settings without a wall of equal-priority buttons.
- **Explainable all-hazard point probe** — inspect tsunami wave/runup or
  asteroid/nuclear effect thresholds at one coordinate with modeled arrival,
  governing model and citations, assumptions, confidence, and safe unknowns.
  Comparison panes evaluate the same coordinate; text and CSV preserve the
  complete report without rerunning the simulation.
- **Auditable installed notices** — References exposes the production npm and
  Rust versions, SPDX identifiers, source links, and license texts bundled with
  the current desktop package; lockfile drift is rejected during verification.
- **Scenario library filters** — recorded and what-if cases stay searchable,
  while guided training remains available without crowding the primary flow.
- **Four-language foundation** — Settings persists English, Spanish, Japanese,
  or Bahasa Indonesia locally and includes the preference in portable profiles.
  Settings (including map provenance, renderer/GPU states, onboarding, and
  portable data actions), the command bar, hazard/workspace navigation,
  viewport instruments, scenario library, quick start, source-model summary,
  SWE solver/recovery/gauge controls, persistent playback, Results and coastal
  validation, Visualization Layers and humanitarian context, trust/evidence
  controls, all seven lessons and worksheets, and the full glossary follow the
  selected language. English
  remains the canonical fallback while advanced surfaces are progressively
  extracted into the completeness-checked catalog.
- **NOAA historical event import** — installed builds search the NCEI HazEL
  Global Historical Tsunami Database by year/location and transfer only a
  supported earthquake record's magnitude and epicentre into the builder.
  A visible DOI-backed provenance note identifies the remaining default fault
  inputs that require review; the WebView receives no direct NCEI network
  authority and the bundled library continues to work offline.
- **Installed-app scenario links** — `cataclysm://open?scenario=…` and
  `cataclysm://open?preset=…` open the existing desktop app or start it once,
  then pass through the same bounded, fail-closed importer as browser shares.
- **Deterministic global-exchange lab** — seven preserved NukeMap scenarios,
  427 target records, and 712 assigned warheads can be explored through
  Cesium-native great-circle arcs and an accessible React HUD. Phase filters,
  launcher selection, and immediate-casualty screening are repeatable and
  clearly bounded as educational legacy-model outputs, not predictions or
  current force assessments.
- **MIRV pattern preview** — all eight preserved payload presets project their
  legacy circle or triangle aim-point geometry and stagger timing around the
  selected effects origin, with a Cesium spread boundary and an accessible
  coordinate list. Previewing never detonates the points or creates casualty
  results.
- **5 globe styles**: high-detail Esri World Imagery by default, bundled Natural
  Earth II as the deterministic offline fallback, OpenStreetMap, Cesium World
  Imagery, and Cesium World Bathymetry.
- **Enforced Earth source contracts** — every integrated imagery, terrain, and
  ocean input has version, license, attribution, datum, resolution, integrity,
  quality-tier, and use-rights metadata. Settings exposes the active source
  contract; diagnostics include the provider/asset inventory; media export
  fails closed when required live attribution is unavailable.
- **Shared geodesy and surface contract** — WGS84 geographic/ECEF coordinates,
  local Unreal-style ENU centimetres, vertical-axis direction, CRS/datum, and
  declared error budgets travel with solver height fields and exports. One
  versioned mask drives solver wet/dry cells and picked asteroid/nuclear target
  response; ambiguous coast cells preserve the operator's material choice.
- **Scenario builder** — tabbed Asteroid / Nuclear / Earthquake / Landslide / Meteotsunami
  forms; click-globe-to-pick location.
- **Timeline scrubber + SWE playback** — scrub a 24-frame snapshot sequence
  through the live shallow-water solver, with classic or colorblind-safe
  overlay colormaps.
- **Effect overlays** — wavefront ring, primitive-backed coastal runup bars and
  inundation discs at 60+ named coastal points, user-created gauge markers,
  and DART buoy historical observations with per-buoy model-vs-observed RMSE
  for the four instrumented presets. Gauge markers are batched for rendering;
  the accessible gauge table remains the interaction and export surface.
- **Opt-in humanitarian context** — Layers can query OpenStreetMap schools,
  healthcare sites, and emergency-response facilities whose mapped point or
  feature center falls inside active first-order runup discs. Nothing is sent
  until the switch is enabled; requests are limited to the 30 largest active
  extents, 2 MiB, and 500 results, then cached locally for 24 hours. An older
  cache remains visible offline. Coverage and tagging vary, and the layer does
  not claim damage, operability, access, evacuation status, or emergency need.
  Facility data is attributed to
  [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright) under ODbL.
- **Max-field products** — fgmax-style peak-amplitude, time-of-maximum, and
  energy-directivity overlays for every solver run, plus labelled
  first-arrival isochrones (NOAA travel-time-map style) exportable as
  GeoJSON.
- **CF-NetCDF interchange** — completed desktop solver runs can export a
  bounded CF-1.12 NetCDF-3 Classic file containing final elevation, velocity,
  depth, maximum, arrival, coordinate, CRS/datum, quality, citation, and
  provenance data. The pure-Rust writer adds no native NetCDF runtime library;
  oversized and invalid artifacts are rejected before saving.
- **Zarr v3 interchange** — the same run also publishes a chunked Zarr 3.1
  directory store with named time/latitude/longitude dimensions, CF-1.12-style
  units and metadata, final state, max-field products, and full provenance.
  The pure-Rust `zarrs` writer produces stores that open directly with Python
  `zarr.open`; existing destination directories are never overwritten.
- **Recoverable long solver runs** — authenticated, atomically replaced
  checkpoints preserve the full grid, tick, maximum fields, and gauge history.
  Advanced mode offers 30-second, one-minute, and five-minute wall-clock
  cadences; compatible interrupted runs can resume without changing the
  deterministic result.
- **Nuclear shelter screening** — an expandable, accessible table compares the
  preserved NukeMap shelter heuristic across key modeled effect radii. Rust
  derives every score from the registered result, and the UI states clearly
  that these are educational comparisons rather than personal survival odds or
  protective-action guidance.
- **Impact profile diagrams** — responsive SVGs plot the bounded atmospheric
  trajectory and modeled crater cross-section returned by the registered Rust
  result, including breakup/airburst markers and accessible descriptions.
- **NASA/JPL impact data** — desktop impact setup can populate inputs from SBDB,
  show Sentry risk context when available, and plot the latest 80 located CNEOS
  fireballs. Bounded built-in references keep both workflows useful offline.
- **Offline NukeMap location catalog** — search 246 population-bearing cities,
  41,958 US ZIP centroids, 459 strategic/metro targets, or pasted coordinates
  without transmitting the query. Location selection updates the target and a
  clearly shown nearest-city density estimate; the complete 39-row NukeMap
  weapon reference table is available in nuclear setup.
- **Unified historical direct scenarios** — the scenario library includes all
  10 NukeMap test events and six AsteroidSimulator impact presets as recorded
  source inputs, with historical context kept separate from modeled outcomes.
  Starfish Prime uses a dedicated high-altitude EMP screening path with no
  implied ground blast, thermal, fallout, or casualty rings.
- **Teacher mode** — lockable classroom settings profiles (via settings
  export/import) and a printable worksheet for each of the 7 guided lessons.
- **Side-by-side comparison mode** — two scenarios on synchronised globes.
- **Catppuccin Mocha** dark theme default + **Latte** light theme toggle.

### Renderer quality budgets

Visual quality is independent of the authoritative Rust solver field. Automatic
performance protection watches rolling P95 frame time, steps down one tier only
after sustained pressure, and recovers with hysteresis; it never changes solver
ticks, event times, eta/velocity fields, or analytical overlays.

| Tier | Target viewport | Target | GPU memory | Visual budget highlights |
|---|---:|---:|---:|---|
| Low | 1280 x 720 | 60 FPS | 512 MB | 0.75 render scale, 1x MSAA, no volumetrics/reflections |
| Medium | 1920 x 1080 | 60 FPS | 1 GB | 2x MSAA, 24 volumetric samples, 30k particles |
| High | 2560 x 1440 | 60 FPS | 2 GB | 4x MSAA, terrain shadows, AO, 80k particles |
| Cinematic | 3840 x 2160 | 30 FPS | 4 GB | 8x MSAA, bloom, 96 volumetric samples, 200k particles |

The hardware gate is measured in headless Chrome/ANGLE D3D11 on Windows 11
build 26100, Intel Core Ultra 9 285, NVIDIA GeForce RTX 4070 SUPER, driver
32.0.15.9579. Run `npm run benchmark:renderer`; it rejects software rendering
and writes adapter plus frame-time evidence to
`artifacts/performance/renderer-benchmark.json`.

---

## Install

Prebuilt Windows installers for the latest release are on the
[Releases page](https://github.com/SysAdminDoc/Cataclysm/releases):
an MSI package and an NSIS setup executable. The v0.10.5 Windows installers are
locally built from this repository and are currently unsigned until a Windows
code-signing certificate is configured, so Windows may show an unknown-publisher
warning. macOS and Linux remain supported source-build targets; platform
installers for those systems should be produced locally on those platforms when
signing/build hosts are available.

**Verify your download** — each release includes a `checksums-sha256.txt` file.
Compare the SHA256 of the downloaded file to the published value:

```powershell
# PowerShell
(Get-FileHash .\Cataclysm_0.10.5_x64_en-US.msi -Algorithm SHA256).Hash
```

```cmd
:: Command Prompt
certutil -hashfile Cataclysm_0.10.5_x64_en-US.msi SHA256
```

See [`docs/release/CODESIGNING.md`](./docs/release/CODESIGNING.md) for full
verification details and the maintainer release checklist.

The app starts with high-detail **Esri World Imagery** and automatically falls
back to bundled **Natural Earth II** when offline or when the provider fails, so
the simulator remains usable without network tiles or a token. OpenStreetMap is
another no-token online option, and a free Cesium ion token unlocks optional
streamed imagery and visual bathymetric terrain from Settings. Provider terms,
attribution, spatial metadata, and rights-review dates are visible beside the
selected Earth source.
The separate humanitarian-facilities layer is also online-only and off by
default. Enabling it sends bounded boxes for the currently active modeled
coastal extents to the public OpenStreetMap Overpass service; scenario names,
source parameters, and raw solver fields are not transmitted. Cached results
degrade to a clearly marked stale view when offline.
Solver bathymetry defaults to the app's low-confidence coarse basin/shelf
approximation. Desktop users can instead preflight, cache, and select a local
WGS 84 GeoTIFF or NetCDF-CF depth/elevation raster from Settings; unknown
horizontal or vertical metadata fails closed, and solver runs reject uncovered
or NoData cells rather than silently mixing sources.

The production web build is installable as a PWA. Its generated service worker
precaches the complete local application, including Cesium workers, widgets,
and bundled Natural Earth imagery, so a previously loaded build can start and
run with the network unavailable. Tauri keeps its native asset-loading path and
does not register the browser service worker. This packaged cache preserves the
old NukeMap single-file build's offline intent without pretending the full
Cesium application can remain one practical HTML file.

The bundled surface mask is intentionally coarse and declares a 550 km worst-
case horizontal error. It is a consistency contract, not a shoreline product.
Three official NOAA GEOID18 coastal fixtures validate ellipsoid/orthometric
conversion and Cesium/Rust/Unreal coordinate agreement; arbitrary geoid or tide-
datum conversion fails closed until the required model grid is supplied.

### Build from source

Prerequisites:

- **Node.js** ≥ 20 LTS
- **Rust** ≥ 1.91 (stable) with `rustup`
- Windows: Visual Studio 2022/2026 with "Desktop development with C++"
  workload (provides MSVC `link.exe`); WebView2 runtime (preinstalled on Win11)
- macOS: Xcode Command Line Tools
- Linux: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`,
  `libayatana-appindicator3-dev`, `librsvg2-dev`, `libsoup-3.0-dev`

The Tauri CLI ships via the `@tauri-apps/cli` npm dev dependency — no
separate `cargo install` step.

```bash
git clone https://github.com/SysAdminDoc/Cataclysm
cd Cataclysm
npm install
npm run doctor             # local toolchain preflight with actionable fixes
npm run dev                # browser preview with Rust/WASM source physics
npm run build:physics      # rebuild + verify the checked-in browser WASM asset
npm run tauri dev          # full desktop app with Rust/Tauri IPC
npm run verify             # local type/lint/test/audit/build verification gate
npm run verify:release     # strict default/GPU/validation Rust matrix + policy gate
npm run verify:rust-advisories # reject new, expired, stale, or path-drifted RustSec warnings
npm run verify:render-protocol # independent binary replay and ECEF conformance gate
npm run capture:references # regenerate 12-scene 1440p/4K visual candidates + telemetry
npm run verify:highlight-assets -- --scene orbit-global --resolution 1440p # require opener/thumbnail quality
npm run tauri:build        # isolated installed-package gate + GPU installer manifest
```

The browser preview loads a checked-in 215.4 KiB WebAssembly module compiled
from the same Rust asteroid, nuclear, earthquake, landslide, attenuation,
arrival, and Synolakis-runup code used by desktop IPC. The JavaScript-only
boundary is the deterministic SWE frame/gauge playback; exports show the
`BROWSER SWE PLAYBACK — APPROXIMATE` watermark only while that layer is active.
Direct-effects blast, thermal, crater, fallout, and casualty calculations still
require the installed desktop app.

`npm run build:physics` requires the `wasm32-unknown-unknown` Rust target. Normal
web builds verify the checked-in module's ABI, source digest, SHA-256, and byte
size so stale generated physics cannot ship silently. The production main JS
chunk changed from 1,260.56 kB / 356.96 kB gzip to 1,257.34 kB / 356.14 kB
gzip; the separate WASM asset adds 220,561 bytes raw (215.4 KiB), taking the
offline cache from 14.6 MiB to 14.8 MiB.

`tauri:build` runs the strict gate, deletes stale bundles, compiles the desktop
binary with GPU support, performs a non-visual capability smoke, and writes
`src-tauri/target/release/bundle/cataclysm-build-manifest.json` with the enabled
Cargo features and SHA-256 digest of every platform artifact. Systems without a
supported adapter continue through the existing CPU fallback instead of losing
simulation capability.

RustSec vulnerabilities always fail. Warning-class transitive advisories are
accepted only through `scripts/rust-advisory-baseline.json`, where every entry
names its dependency path, affected target, upstream issue, owner, rationale,
and absolute review date; the release manifest records that baseline's digest.

On Windows this command is intentionally restricted to a clean disposable
profile or VM with `CATACLYSM_INSTALL_SMOKE_ISOLATED=1`, `tauri-driver`, and a
matching `msedgedriver.exe`. It installs the emitted MSI and NSIS packages one at
a time, verifies the installed version and GPU capability, completes the Tōhoku
Run & Watch journey through frame 60/60, exercises text export, diagnostics, and
an OS-keychain restart round trip, then uninstalls each package. The build fails
before verification if Cataclysm is already installed or running. The
`Installed Windows release gate` workflow provisions this isolated environment;
its optional `webview2_preview` input reverses WebView2's channel preference for
forward-compatibility testing.

The strict release gate also renders 24 unmasked, offline-safe reference frames
from fixed scenario/time/effect/camera seeds. Candidate PNGs and telemetry are
written under ignored `artifacts/visual-reference/`; the tracked hash locks are
validated by `npm run verify:reference-locks`. A visual change is approved one
frame at a time, for example:

```bash
npm run approve:reference -- --scene orbit-global --resolution 1440p --approve orbit-global@1440p --reason "Reviewed atmosphere change"
```

Wildcard, multi-frame, mismatched, and reason-free approvals fail before
rendering. Browser-only direct-effect reference frames consume tracked binary
recordings serialized by Rust and decoded through the same protocol client.

Each reference scene also declares its subject, event phase, target region,
required scale cue, forbidden failure cues, and perceptual thresholds in
`src/data/reference-visual-quality.json`. Event scenes emit labelled
Before / Event / Aftermath review sheets. A stable analytical baseline may be
explicitly blocked from highlight use; `verify:highlight-assets` fails unless
both the metrics and the dated human review approve that exact scene for the
launch opener, scenario thumbnails, or other promotional presentation.

To bake a Cesium ion token at build time, `cp .env.example .env` and paste
it in; otherwise leave it blank and paste at runtime in **Settings**.

---

## Architecture

```
┌─────────────────────────── Tauri 2 Window ───────────────────────────┐
│ ┌─────────────────────────────────────────────────────────────────┐  │
│ │  React 19 + TypeScript + Vite (frontend / WebView2)             │  │
│ │  ─ CesiumJS 1.143+ globe with optional bathymetric terrain        │  │
│ │  ─ Scenario builder, timeline, overlays, results panel           │  │
│ └──────────────────────────────  ▲  ───────────────────────────────┘  │
│                                  │ tauri::invoke (JSON over IPC)      │
│ ┌──────────────────────────────  ▼  ───────────────────────────────┐  │
│ │  Rust backend (src-tauri/)                                       │  │
│ │  ─ physics::asteroid    Ward–Asphaug + Schmidt–Holsapple         │  │
│ │  ─ physics::nuclear     Glasstone–Dolan + Le Méhauté             │  │
│ │  ─ physics::landslide   Fritz–Hager + Slingerland–Voight         │  │
│ │  ─ physics::earthquake  Okada 1985 (full I-term)                  │  │
│ │  ─ physics::shallow_water  NSWE + Synolakis runup                │  │
│ │  ─ data::bathymetry     coarse or validated local raster depth   │  │
│ │  ─ presets              Chicxulub / Tōhoku / Lituya / …          │  │
│ └──────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────┘
```

Physics runs in the Rust backend (multi-threaded via `rayon`, GPU via `wgpu`
behind the `gpu` feature flag). Renderer protocol v1 streams checksummed raw
SWE fields, authoritative ticks, typed hazard events, and georeferenced ENU/ECEF
transforms over Tauri raw channels. Cesium decodes and presents those packets;
future renderers replay the same bytes without reimplementing physics. The
legacy SWE PNG channel remains temporarily for analytical color overlays.

The WebView loads Cataclysm presentation only from bundled `style-src 'self'`
stylesheets: tracked application HTML/TypeScript may not create inline style
attributes, mutate DOM styles, or inject runtime stylesheets. CesiumJS is the
sole exception because its widget writes inline dimensions and positions under
`.cesium-viewer` / `.cesium-widget`. CSP cannot scope `'unsafe-inline'` to that
subtree, so static source verification and a headless rendered-DOM inventory
enforce the narrower ownership boundary while the desktop policy retains the
token required by Cesium.

---

## The science (and its limits)

This is not a forecast tool. Compared to operational models like NOAA MOST:

- **What's accurate** — initial conditions (cavity geometry from Ward–Asphaug, fault displacement from Okada), idealized open-ocean propagation in deep water, far-field arrival times.
- **What's approximate** — default solver bathymetry uses coarse basin means with a shelf taper; local raster accuracy remains the user's documented source accuracy and is bilinearly resampled without datum transformation. Coastal runup uses Synolakis 1987 analytical instead of full wetting/drying; inundation discs are first-order; dispersion is linear long-wave first (Boussinesq later).
- **What's wrong** — anything involving the atmosphere coupling (Hunga Tonga–style Lamb-wave coupling is a research frontier), tsunami earthquake source-time functions (we use static dislocation), submarine landslide rheology.
- **The "Russia Poseidon" honest take** — Russian state media's 500-m-wave claim is propaganda. The 1996 Defense Nuclear Agency study put underwater-explosion wave-generation efficiency at ~5%. A 100-Mt warhead at 100 km open ocean produces a ~few-meter wave, not a city-killer. We model both the propaganda yield and a realistic one — the comparison is the point.

See [`docs/science/`](./docs/science) for formula derivations and citations.

---

## References (anchors, full list in `docs/science/REFERENCES.bib`)

- Ward, S. N., & Asphaug, E. (2000). Asteroid impact tsunami: a probabilistic hazard assessment. *Icarus*, 145, 64–78.
- Range, M. M., et al. (2022). The Chicxulub Impact Produced a Powerful Global Tsunami. *AGU Advances*. https://doi.org/10.1029/2021AV000627
- Synolakis, C. E. (1987). The runup of solitary waves. *J. Fluid Mech.*, 185, 523–545.
- Okada, Y. (1985). Surface deformation due to shear and tensile faults in a half-space. *BSSA*, 75, 1135–1154.
- Fritz, H. M., Hager, W. H., & Minor, H.-E. (2001). Lituya Bay case: rockslide impact and wave run-up. *Sci. Tsunami Hazards*, 19, 3–22.
- Glasstone, S., & Dolan, P. J. (1977). *The Effects of Nuclear Weapons* (3rd ed.). USDOE.
- Le Méhauté, B., & Wang, S. (1996). *Water Waves Generated by Underwater Explosion*. World Scientific.
- Collins, G. S., Melosh, H. J., & Marcus, R. A. (2005). Earth Impact Effects Program. *Meteoritics & Planetary Science*, 40, 817–840.
- Berger, M. J., George, D. L., LeVeque, R. J., & Mandli, K. T. (2011). The GeoClaw software for depth-averaged flows. *Advances in Water Resources*, 34(9), 1195–1206.

---

## Roadmap & research

- [`ROADMAP.md`](./ROADMAP.md) — phased delivery plan (v0.1.0 → v1.0.0).
- [`CHANGELOG.md`](./CHANGELOG.md) — shipped feature summary.

## Citation

If you use Cataclysm in academic or educational work, cite it via the
machine-readable [`CITATION.cff`](./CITATION.cff) at the repository root — GitHub
renders a "Cite this repository" control from it, and the version/license are
kept in lock-step with the release by the `citation-metadata` verification gate.

## License

[MIT](./LICENSE). For scientific education and hazard-awareness visualization only. Not for evacuation planning. Use NOAA NTWC/PTWC for real warnings.

## Author

[@SysAdminDoc](https://github.com/SysAdminDoc) — Senior Systems Administrator, medical-imaging IT, side projects in physics-based simulators.
