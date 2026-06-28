# Roadmap

Nuclear weapon effects simulator with 12 effect rings, 38 weapon presets, full WW3 engine (427 targets, 708 warheads, 7 scenarios), HEMP, water burst, SVG mushroom cloud, PWA. Physics from Glasstone & Dolan.

## Research-Driven Additions (Round 5)

## Research-Driven Additions

- [ ] P3 - Evaluate Leaflet 2 migration after stable release
  Why: Leaflet 2 alpha moves toward ESM/classes and may affect plugins and global-script loading, so migration should be planned after stability improves.
  Evidence: Leaflet 2.0.0 alpha announcement, current vanilla script includes in `index.html`.
  Touches: `index.html`, `js/*.js`, `build.py`, `README.md`.
  Acceptance: A compatibility spike documents required code changes, bundle strategy, plugin impact, and a go/no-go recommendation after a stable Leaflet 2 release exists.
  Complexity: L
