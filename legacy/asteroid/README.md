[![Version](https://img.shields.io/badge/version-0.2.0-blue.svg)](https://github.com/SysAdminDoc/AsteroidSimulator/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Web-lightgrey.svg)]()
[![Tests](https://img.shields.io/badge/tests-59%20passing-brightgreen.svg)]()

# AsteroidSimulator

Simulate asteroid and comet impacts on Earth with precise mathematical models. Visualize crater formation, blast waves, thermal radiation, seismic effects, ejecta, and tsunamis from ocean impacts on an interactive 3D globe.

The first open-source implementation of the complete Collins et al. 2005 impact effects chain with interactive visualization.

## Features

- **9 Effect Categories** — Energy, atmospheric entry, crater, thermal radiation, seismic, airblast, ejecta, tsunami, global effects
- **Atmospheric Entry** — 6 coupled ODEs (Hills & Goda 1993 pancake model) with RK4 integration, fragmentation, ablation
- **Crater Formation** — Holsapple pi-scaling with simple/complex transition, SVG cross-section diagram
- **Blast & Thermal** — Overpressure damage rings, thermal burn radii, fireball visualization
- **Seismic** — Richter magnitude + Mercalli intensity at observer distance
- **Ocean Impacts** — Ward & Asphaug 2000 tsunami model with dispersive attenuation + Synolakis runup
- **NASA NEO Database** — Search real asteroids (Apophis, Bennu, 2024 YR4) via JPL SBDB API with orbital velocity
- **Close Approach Table** — Upcoming asteroid flybys from CNEOS with "what if it hit?" simulation
- **Atmospheric Absorption** — Thermal radiation reduced by realistic atmospheric transmittance
- **Ground Reflection** — Mach stem amplification for surface burst overpressure (1.0-1.8x)
- **Global Effects** — Extinction-level impact consequences (impact winter, wildfires, acid rain)
- **Export** — Download simulation as JSON or copy shareable link
- **Interactive 3D Globe** — CesiumJS with damage ring overlays, trajectory arc, animated blast wave
- **6 Historical Presets** — Chelyabinsk, Tunguska, Meteor Crater, Ries, Chesapeake Bay, Chicxulub
- **Observer Marker** — Right-click to place observer, auto-computes great-circle distance
- **Auto Land/Ocean Detection** — Click coordinates auto-set target type
- **Shareable URLs** — All parameters encoded in URL hash
- **Responsive** — Desktop three-panel layout, mobile stacked layout

## Physics References

Based on peer-reviewed impact science:

- Collins, Melosh & Marcus (2005) — *Earth Impact Effects Program* (MAPS 40:817-840)
- Holsapple (1993) — Pi-group crater scaling laws
- Hills & Goda (1993) — Atmospheric fragmentation model (AJ 105:1114-1144)
- Collins et al. (2017) — Airblast model validation (MAPS 52:1542-1560)
- Ward & Asphaug (2000) — Impact tsunami (Icarus 145:64-78)
- Glasstone & Dolan (1977) — Blast/thermal scaling (adapted)
- Synolakis (1987) — Tsunami coastal runup

## Getting Started

```bash
git clone https://github.com/SysAdminDoc/AsteroidSimulator.git
cd AsteroidSimulator
npm install
npm run dev
```

## Usage

| Action | Effect |
|--------|--------|
| Left click globe | Set impact location (ground zero) |
| Right click globe | Set observer location (computes distance) |
| Preset buttons | Load historical impact parameters |
| NASA NEO search | Look up real asteroid properties |
| Sliders | Adjust diameter, velocity, angle, distance |
| URL hash | Share or bookmark any simulation |

## Stack

- React 19 + TypeScript + Vite
- CesiumJS (3D globe, no token required)
- Vitest (43 tests)

## Testing

```bash
npm run test       # run all tests
npm run test:watch # watch mode
npm run build      # production build
```

## License

[MIT](LICENSE)
