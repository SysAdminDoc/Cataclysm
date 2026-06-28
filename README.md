# NukeMap v3.6.0

![Version](https://img.shields.io/badge/version-v3.6.0-blue) ![License](https://img.shields.io/badge/license-MIT-green) ![Platform](https://img.shields.io/badge/platform-Web%20%2F%20PWA-lightgrey)

A premium nuclear weapon effects simulator with animated blast waves, SVG mushroom clouds, MIRV strikes, full WW3 simulation engine (427 verified targets, 708 warheads, 7 scenarios), HEMP continent-scale EMP, sound effects, shelter survival analysis, and comprehensive educational tools. Physics based on Glasstone & Dolan's *The Effects of Nuclear Weapons*.

**[Live Demo](https://sysadmindoc.github.io/NukeMap/)** | Installable as PWA

## Features

### Core Simulation
- **12 Effect Rings** — Fireball, crater, radiation, 200/20/5/1 psi blast, 3rd/1st degree burns, EMP, firestorm zone, flash blindness
- **38 Weapon Presets** — US, Russian, Chinese, UK, French, Indian, Pakistani, North Korean, Israeli arsenals
- **5 Burst Modes** — Airburst, Surface, Custom altitude, HEMP (high-altitude EMP), and Water
- **Fallout Modeling** — Elliptical plumes with adjustable wind direction, speed, and fission fraction
- **Casualty Estimation** — Zone-based fatality/injury model with population density data

### WW3 Simulation Engine
- **427 Verified Targets** — US (175), Russia (101), NATO Europe (74), China (66), plus infrastructure targets from FAS/BAS/NNSA and public infrastructure sources
- **7 Scenarios** — US vs Russia, Russia vs NATO, US vs China, Counterforce Only, Global Thermonuclear War, Russian/US First Strike
- **Animated Missile Arcs** — Great-circle trajectories color-coded by nation
- **Phased Escalation** — Air raid siren, staggered launches, phase rumble, rocket whoosh, explosion boom
- **Nuclear Winter** — Progressive darkening overlay with long-term death estimates
- **Floating Map HUD** — Live casualties, warheads, megatonnage, DEFCON indicator
- **Speed Control** — 1x / 2x / 5x / 10x with pause/resume

### HEMP (High-Altitude EMP)
- Detonation at 400 km altitude — zero blast/thermal at ground level
- EMP radius up to 2,200 km (continent-scale)
- Simulates E1/E2/E3 electromagnetic pulse effects

### Animations & Sound
- **Animated Blast Wave** — Physically-timed ring expansion
- **Fireball Glow** — Color-shifting animation (white → orange → red)
- **Camera Shake** — Yield-proportional intensity
- **Yield-Proportional Sound** — Procedural Web Audio: tactical weapons snap; strategic weapons roar with deep sub-bass
- **SVG Mushroom Cloud** — Realistic anatomy with animated reveal per detonation

### Analysis Panels (Effects Tab)
- **Shelter Survival** — 8 shelter types from open air to deep underground
- **Altitude Cross-Section** — SVG showing cloud, burst height, blast radii
- **Crater Cross-Section** — SVG diagram with bowl, lip, ejecta, depth markers
- **Casualties by Zone** — Per-ring fatality/injury breakdown
- **Destruction Statistics** — Buildings destroyed, area affected, hospitals overwhelmed
- **EMP Effects Detail** — Distance-based electronic system failure
- **Survival Probability** — Open air vs basement at 10 distances
- **Seismic Equivalent** — Richter magnitude comparison
- **Size Comparisons** — Blast area vs Manhattan, Central Park, etc.
- **Escape Time** — Walk/run/bike/car times to exit each zone
- **Building Damage** — Structural effects at 6 PSI levels (0.5–20 psi)
- **Conventional Equivalents** — "1,364x MOAB", "33,333x Tomahawk"
- **Ground-Level Experience** — What you'd see/hear/feel at each distance
- **Cloud Height Comparison** — Mushroom cloud vs Empire State, Burj Khalifa, ISS
- **Weapon Specifications** — 18 weapons with type, fuel, weight, delivery system
- **Nearby Strategic Targets** — WW3 database targets within 200 km
- **Emergency Action Guide** — Context-aware survival instructions by phase

### Overlays & Visualization
- Ring labels, distance reference rings, distance from GZ on hover
- Thermal flash gradient, radiation intensity overlay, aggregate damage heatmap
- Animated fallout particles, fallout dose contour lines
- Shockwave ring animation, fallout time-lapse slider (1–48 hours)
- Blast wave arrival indicator (time + PSI + severity on hover)
- Night mode (20x flash blindness range)
- Population heatmap, nuclear test database markers
- Animated nuclear test timeline (25 historic tests, chronological playback)

### Tools
- **MIRV Simulation** — 8 presets with circle/triangle/grid/cross patterns
- **Weapon Comparison** — Side-by-side effects table with overlaid rings
- **Experience Mode** — Click anywhere to see detailed survival report at that distance
- **Measurement Tool** — Click-to-measure distances on map
- **Missile Flight Calculator** — ICBM/SLBM/IRBM/SRBM from US/Russia/China launch sites
- **Yield Chart** — Visual bar comparison across weapons
- **Nuclear Winter Estimates** — Soot, temperature drop, growing season loss
- **Radiation Decay** — 7:10 rule calculator at any distance
- **Cumulative Dose Calculator** — Time + distance → total rem exposure
- **Overpressure Table** — Radius at 12 PSI levels
- **Draggable Ground Zero** — Drag to reposition detonation

### Search & Data
- **41,958 US ZIP Codes** — Every US ZIP resolves instantly (90210, 02134, 20500...)
- **250+ US Cities**, **100+ World Cities**, **427 Strategic/Military Targets**
- **Fuzzy Search** — City, state, ZIP, partial ZIP, coordinates, or target name/type
- **12 Quick Target Pills** — One-click fly to major cities

### UX & Export
- **Premium Control Surface** — Refined glass panel, accessible tabs/collapsibles, coherent buttons, disabled states, and responsive floating controls
- **12 Map Styles** — Dark, Alidade, Satellite, Sat+Labels, Terrain, OSM, Voyager, Light, Toner, Watercolor, Outdoors, Dark Clean
- **Floating Map Switcher** — Quick-access dropdown on the map
- **Quick Weapon Bar** — 6 common weapons as floating chips
- **Save/Load Scenarios** — Persist detonation sets to localStorage
- **Export PNG** — Map screenshot capture
- **Export KML** — Google Earth compatible
- **Export JSON** — Structured detonation data
- **CSV Import Preview** — Validates row count, file size, coordinates, yield, and burst type before importing
- **Summary Report** — Formatted text report with all details
- **Shareable URLs** — Detonation state encoded in URL parameters
- **Fullscreen Mode** — For presentations
- **Click-to-Copy Coordinates** — Tap coords display to copy
- **Auto-Geolocation** — Centers on your location on first load
- **PWA Installable** — Add to home screen as standalone app
- **Welcome Tutorial** — First-run guide for new users

### Weapon Encyclopedia (Info Tab)
- Browsable weapon arsenal by 9 countries
- Nuclear glossary with 11 key terms
- Click any weapon to select and configure

## Usage

1. Open the **[Live Demo](https://sysadmindoc.github.io/NukeMap/)** or `index.html`
2. Search for a city, ZIP code, or military target
3. Select a weapon from the dropdown, quick bar, or encyclopedia
4. Choose burst type: Airburst, Surface, Custom, or HEMP
5. Click the map to detonate (or right-click)
6. Explore 5 tabs: **Weapon** | **Effects** | **Results** | **Tools** | **Info**

## Offline / PWA

```bash
python build.py    # Creates NukeMap-offline.html (fully self-contained)
```

Or open `index.html` once online — the service worker caches everything. Installable as a PWA via browser "Add to Home Screen".

## Architecture

```
NukeMap/
  index.html          App shell (~700 lines)
  manifest.json       PWA manifest
  css/styles.css      All styling (~880 lines)
  js/
    zipcodes.js       41,958 US ZIP code database
    data.js           Cities, weapons, MIRV presets, shelter types
    physics.js        Glasstone & Dolan nuclear calculations
    physics-worker.js WW3 batch physics worker
    search.js         Fuzzy search (cities + ZIPs + military targets)
    effects.js        Map ring drawing, fallout, markers, tooltips
    animation.js      Blast wave, fireball glow, camera shake
    sound.js          Web Audio API yield-proportional sounds
    mushroom3d.js     SVG mushroom cloud overlay
    mirv.js           MIRV pattern generation
    shelter.js        Shelter survival analysis
    compare.js        Weapon comparison mode
    heatmap.js        Population density overlay
    extras.js         Overlays, dose calc, radiation overlay, damage heatmap
    advanced.js       Experience mode, scenarios, missile flight, emergency guide
    premium.js        Altitude profile, zone casualties, weapon specs, export
    immersive.js      Geiger, seismic, escape, GPS, test timeline, ground report
    ww3.js            WW3 simulation engine (1,180 lines)
    app.js            Main controller (1,835 lines)
  data/
    us_targets.json       175 US targets
    russia_targets.json   103 Russian targets
    targets.json          140 NATO + Chinese targets
    compiled_targets.js   Auto-generated JS arrays
  sw.js              Service worker
  build.py           Offline bundler
  build_targets.py   Target DB compiler
```

**~8,600 lines** of application code + 1.5 MB ZIP code database.

## License

MIT
