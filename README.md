# TsunamiSimulator

[![Version](https://img.shields.io/badge/version-0.2.0-blue.svg)](./CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](#install)
[![Stack](https://img.shields.io/badge/stack-Tauri%202%20%2B%20React%20%2B%20CesiumJS%20%2B%20Rust-orange.svg)](#architecture)
[![Physics](https://img.shields.io/badge/physics-Ward%E2%80%93Asphaug%20%7C%20Synolakis%20%7C%20Okada%20%7C%20Glasstone-purple.svg)](./docs/science)

> A scientifically grounded 3D-globe desktop application for simulating tsunami generation, propagation, and coastal inundation from asteroid impacts, nuclear detonations (atmospheric and underwater), seafloor earthquakes, and subaerial landslides — with peer-reviewed historical presets like Chicxulub (66 Ma), Tōhoku 2011, Indian Ocean 2004, and Lituya Bay 1958.

This is the **NukeMap for tsunamis** — but with a real 3D bathymetric globe, real shallow-water physics, and presets you can scrub through frame-by-frame.

---

## Why this exists

Existing tools each do one piece:

- **[NukeMap](https://nuclearsecrecy.com/nukemap/)** — nuclear airburst effects only, 2D map, no water.
- **[Asteroid Launcher](https://neal.fun/asteroid-launcher/)** — fun, 2D map, no propagating tsunami.
- **[Purdue "Impact: Earth!"](https://impact.ese.ic.ac.uk/ImpactEarth/)** — accurate formulas, single-point readout, no animation.
- **[GeoClaw](http://depts.washington.edu/clawpack/geoclaw/)** / **[COMCOT](https://www.researchgate.net/publication/374553562)** / **[MOST](https://www.pmel.noaa.gov/news-story/first-global-tsunami-simulation-chicxulub-asteroid-impact-66-million-years-ago)** — operational accuracy, Fortran/Python, no consumer UI.

`TsunamiSimulator` combines them: **NOAA-grade physics + consumer-grade interactive globe**. Pick a source (asteroid, nuke, fault, slide), drop it anywhere on Earth, and watch a real shallow-water solution propagate over GEBCO bathymetry, run up real coastlines, and produce inundation polygons.

---

## Features (v0.0.1 scaffold → roadmap)

### Source models (energy → initial water-surface displacement)

| Source | Status | Reference |
|---|---|---|
| **Asteroid / comet impact** | ✅ formulas wired | Ward & Asphaug 2000 *Icarus* 145:64; Schmidt & Holsapple 1982 |
| **Underwater nuclear** | ✅ formulas wired | Glasstone & Dolan 1977; Le Méhauté 1996; DNA 1996 (5% energy → wave) |
| **Atmospheric / surface nuclear (ocean)** | ✅ formulas wired | Van Dorn et al. 1968; Adams 1972 |
| **"Russia Poseidon" tsunami torpedo** | ✅ realistic mode | Skeptical physics — 360° dispersion, ~5% efficiency |
| **Earthquake (Okada fault dislocation)** | ⏳ scaffold | Okada 1985; Mansinha & Smylie 1971 |
| **Subaerial landslide** | ⏳ scaffold | Fritz & Hager 2001 (Lituya); Slingerland & Voight |
| **Submarine landslide** | 🔲 planned | Watts et al. 2005 |
| **Volcanic caldera collapse** | 🔲 planned | Krakatoa 1883, Hunga Tonga 2022 |

### Propagation

- ✅ **Linear long-wave** (deep-ocean, fast preview).
- ⏳ **Nonlinear shallow-water equations** (NSWE) — depth-averaged 2D, finite-volume Godunov on a regular lat-lon grid with `1/cos φ` metric.
- 🔲 **Boussinesq** for dispersive waves (impact-tsunami wavelengths shorter than ocean depth — important for Ward–Asphaug regime).
- 🔲 **Adaptive mesh refinement** (AMR) like GeoClaw — coarse far-field, fine coastal.
- 🔲 **GPU compute** via `wgpu` (cross-platform; expect 50–100× over CPU for the same grid).

### Coastal inundation

- ⏳ **Synolakis 1987 runup law** for beach geometry: `R/H₀ = 2.831 √(cot β) (H₀/d)^(5/4)`.
- 🔲 **MOST-style wetting/drying** on bathymetric grid.
- 🔲 **Inundation polygons** rendered as GeoJSON overlays on Cesium.

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

### UX

- **Cesium globe** with GEBCO world bathymetry — accurate seafloor depth everywhere.
- **Scenario builder** — click anywhere on the globe, dial in diameter/velocity/yield/angle, hit `Simulate`.
- **Timeline scrubber** — step the simulation forward minute by minute, watch the wave-front ring expand.
- **Effect overlays** — wave height isolines, arrival-time isochrones, run-up bars on coastlines, debris field.
- **Side-by-side comparison** — same source over different oceans / locations.
- **Catppuccin Mocha** default theme (deep dark, branded accents). Light mode toggle.

---

## Install

> v0.0.1 is a scaffold — no shipped binary yet. Build from source.

### Prerequisites

- **Node.js** ≥ 20 LTS
- **Rust** ≥ 1.78 (stable) with `rustup`
- **Tauri CLI v2** — `cargo install tauri-cli --version "^2.0"`
- **Cesium ion access token** — free tier at https://cesium.com/ion/signup (paste into `.env`)
- Windows: WebView2 runtime (preinstalled on Win11)
- macOS: Xcode CLT
- Linux: `libwebkit2gtk-4.1-dev`, `librsvg2-dev`, `libssl-dev`, `pkg-config`

### Build

```bash
git clone https://github.com/SysAdminDoc/TsunamiSimulator
cd TsunamiSimulator
cp .env.example .env       # paste your Cesium ion token here
npm install
npm run tauri dev          # development hot-reload
npm run tauri build        # production binary in src-tauri/target/release/
```

---

## Architecture

```
┌─────────────────────────── Tauri 2 Window ───────────────────────────┐
│ ┌─────────────────────────────────────────────────────────────────┐  │
│ │  React 19 + TypeScript + Vite (frontend / WebView2)             │  │
│ │  ─ CesiumJS 1.124+ globe with GEBCO bathymetry                   │  │
│ │  ─ Scenario builder, timeline, overlays, results panel           │  │
│ └──────────────────────────────  ▲  ───────────────────────────────┘  │
│                                  │ tauri::invoke (JSON over IPC)      │
│ ┌──────────────────────────────  ▼  ───────────────────────────────┐  │
│ │  Rust backend (src-tauri/)                                       │  │
│ │  ─ physics::asteroid    Ward–Asphaug + Schmidt–Holsapple         │  │
│ │  ─ physics::nuclear     Glasstone–Dolan + Le Méhauté             │  │
│ │  ─ physics::landslide   Fritz–Hager + Slingerland–Voight         │  │
│ │  ─ physics::earthquake  Okada 1985 (planned)                     │  │
│ │  ─ physics::shallow_water  NSWE + Synolakis runup                │  │
│ │  ─ data::bathymetry     GEBCO 15-arcsec sampler                  │  │
│ │  ─ presets              Chicxulub / Tōhoku / Lituya / …          │  │
│ └──────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────┘
```

Heavy physics runs in the Rust backend (multi-threaded via `rayon`, GPU via `wgpu` planned). The frontend only handles globe rendering, controls, and result visualization. The IPC boundary keeps the WebView from blocking on million-cell SWE solves.

---

## The science (and its limits)

This is not a forecast tool. Compared to operational models like NOAA MOST:

- **What's accurate** — initial conditions (cavity geometry from Ward–Asphaug, fault displacement from Okada), open-ocean propagation in deep water, far-field arrival times.
- **What's approximate** — coastal runup (we use Synolakis 1987 analytical instead of full wetting/drying), dispersion (linear long-wave first, Boussinesq later).
- **What's wrong** — anything involving the atmosphere coupling (Hunga Tonga–style Lamb-wave coupling is a research frontier), tsunami earthquake source-time functions (we use static dislocation), submarine landslide rheology.
- **The "Russia Poseidon" honest take** — Russian state media's 500-m-wave claim is propaganda. The 1996 Defense Nuclear Agency study put underwater-explosion wave-generation efficiency at ~5%. A 100-Mt warhead at 100 km open ocean produces a ~few-meter wave, not a city-killer. We model both the propaganda yield and a realistic one — the comparison is the point.

See [`docs/science/`](./docs/science) for formula derivations and citations.

---

## Citations (anchors, full list in `docs/science/REFERENCES.bib`)

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
- [`RESEARCH_FEATURE_PLAN.md`](./RESEARCH_FEATURE_PLAN.md) — evidence-backed feature plan with competitive research (NUKEMAP, Asteroid Launcher, NOAA MOST, GeoClaw, BROWNI, FUNWAVE-TVD, JAGURS), prioritized roadmap, and recommendations grounded in peer-reviewed physics literature.

## License

[MIT](./LICENSE). For scientific education and hazard-awareness visualization only. Not for evacuation planning. Use NOAA NTWC/PTWC for real warnings.

## Author

[@SysAdminDoc](https://github.com/SysAdminDoc) — Senior Systems Administrator, medical-imaging IT, side projects in physics-based simulators.
