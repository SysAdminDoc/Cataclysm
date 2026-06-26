# Changelog

All notable changes to AsteroidSimulator will be documented in this file.

## [0.2.0] - 2026-06-26

### Improved
- Thermal radiation: atmospheric absorption model reduces overestimated burn radii by 15-40%
- Luminous efficiency: continuous log-linear interpolation instead of step function
- Airblast: ground reflection amplification (1.0-1.8x) for surface bursts
- NEO search: computes impact velocity from orbital elements (a, e) instead of hardcoded 20 km/s
- Energy formatter: uses GJ/TJ/PJ/EJ prefixes instead of scientific notation for sub-kiloton impacts
- Ring max radius raised from 20,000 km to Earth half-circumference
- Thermal exposure capped at fireball surface (no longer returns Infinity at distance=0)

### Added
- Trajectory profile SVG chart (altitude + velocity curves with breakup/airburst markers)
- Global effects section for extinction-level impacts (>1e23 J): impact winter, wildfires, acid rain
- "At Your Location" summary badge with human-readable damage description
- Configurable coastal beach slope for tsunami runup (gentle shelf to steep volcanic)
- CNEOS close approach table: upcoming asteroid flybys with "simulate impact" button
- Export simulation results as JSON
- Copy shareable link button
- Tooltips on all input parameters explaining physical meaning and ranges
- 16 edge case tests: tiny impacts, extreme energies, shallow angles, observer at distance=0, Chicxulub full validation (59 total)

## [0.1.0] - 2026-06-26

### Added
- Complete physics engine implementing Collins et al. 2005 impact effects chain
- 43 unit tests validated against historical events
- Interactive CesiumJS 3D globe with damage ring overlays
- Impact parameter input panel with real-time simulation
- Results panel showing all 9 effect categories
- 6 historical event presets
- Click-to-impact on globe (left click = ground zero, right click = observer)
- NASA CNEOS/JPL Small-Body Database integration
- Atmospheric entry trajectory arc on globe
- Animated blast wave expansion
- Crater cross-section SVG diagram
- Effect ring legend, energy comparisons, shareable URLs
- Ocean vs land auto-detection, responsive layout
- Catppuccin Mocha dark theme
