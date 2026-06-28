# Roadmap

Nuclear weapon effects simulator with 12 effect rings, 38 weapon presets, full WW3 engine (427 targets, 708 warheads, 7 scenarios), HEMP, water burst, SVG mushroom cloud, PWA. Physics from Glasstone & Dolan.

## Research-Driven Additions (Round 5)

## Research-Driven Additions

- [ ] P2 - Add scenario schema versioning, diff, and merge tools
  Why: Saved scenarios have folders/search but lack schema versions, import previews, or merge conflict handling for CSV/JSON round trips.
  Evidence: `js/app.js:1643-1736`, Nuclear War Simulator scenario expectations, existing NukeMap save/load workflow.
  Touches: `js/app.js`, `index.html`, `css/styles.css`, `test/run-url-search.js`.
  Acceptance: Saved scenarios include a schema version and updated timestamp; import can preview, diff against existing names/folders, merge or replace, and report validation errors.
  Complexity: M

- [ ] P2 - Add in-app diagnostics for cache, data, and model versions
  Why: PWA users can retain stale service-worker/data caches, and troubleshooting needs a visible way to verify active versions.
  Evidence: `sw.js`, `js/app.js:1791-1801`, service-worker update flow, version drift found in `js/app.js:1467`.
  Touches: `sw.js`, `js/app.js`, `index.html`, `css/styles.css`, `build.py`.
  Acceptance: Diagnostics panel shows app version, cache names, SW controller state, data counts, active physics/fallout model, offline status, and a refresh-cache action with toast feedback.
  Complexity: M

- [ ] P3 - Evaluate Leaflet 2 migration after stable release
  Why: Leaflet 2 alpha moves toward ESM/classes and may affect plugins and global-script loading, so migration should be planned after stability improves.
  Evidence: Leaflet 2.0.0 alpha announcement, current vanilla script includes in `index.html`.
  Touches: `index.html`, `js/*.js`, `build.py`, `README.md`.
  Acceptance: A compatibility spike documents required code changes, bundle strategy, plugin impact, and a go/no-go recommendation after a stable Leaflet 2 release exists.
  Complexity: L
