# Roadmap

Nuclear weapon effects simulator with 12 effect rings, 38 weapon presets, full WW3 engine (427 targets, 708 warheads, 7 scenarios), HEMP, water burst, SVG mushroom cloud, PWA. Physics from Glasstone & Dolan.

## Research-Driven Additions (Round 5)

## Research-Driven Additions

- [ ] P0 - Sync exported metadata and onboarding counts to v3.6.0
  Why: Saved JSON currently reports `version:'3.5.0'`, and the welcome overlay still advertises 32 weapons despite the v3.6.0 data set.
  Evidence: `js/app.js:1467`, `index.html:41`, `js/data.js`, `README.md`, `sw.js`.
  Touches: `js/app.js`, `index.html`, `test/run-url-search.js`, `README.md`, `CLAUDE.md`, `CHANGELOG.md`.
  Acceptance: JSON exports report the current app version from one shared source, onboarding weapon count matches `NM.WEAPONS.length - 1`, and a local test fails on future version/count drift.
  Complexity: S

- [ ] P0 - Harden CSV import with schema validation and preview
  Why: CSV import can process arbitrary file size, row count, coordinate ranges, yield ranges, and burst labels before triggering detonations.
  Evidence: `js/app.js:1526-1547`, existing export/import workflow, OWASP DOM/data validation guidance.
  Touches: `js/app.js`, `test/run-url-search.js`, `index.html`, `css/styles.css`.
  Acceptance: Import shows a preview summary, rejects files above a documented size/row cap, validates lat/lng/yield/burst per row, reports skipped rows, and imports only confirmed valid rows.
  Complexity: M

- [ ] P1 - Add model provenance to every export and report
  Why: Analysts need exported files to preserve physics model, app version, citation keys, assumptions, and confidence labels.
  Evidence: `NM.CITATIONS` in `js/physics.js`, NukeBlastSimulator methodology page, Fourmilab calculator, NUKEMAP roadmap.
  Touches: `js/physics.js`, `js/app.js`, `js/immersive.js`, `js/premium.js`, `test/run-physics.js`.
  Acceptance: JSON/GeoJSON/CSV/KML/text/PDF exports include app version, selected blast model, citation keys for emitted effects, and a short assumptions block; tests assert required metadata.
  Complexity: M

- [ ] P1 - Replace nearest-city casualty density with optional gridded population tiles
  Why: Current casualty estimates use nearest-city heuristics, while credible blast tools and datasets use gridded population surfaces.
  Evidence: `NM.estimateDensity()` in `js/physics.js`, WorldPop API, GHS-POP R2023A, NUKEMAP roadmap LandScan work.
  Touches: `js/physics.js`, `js/heatmap.js`, `js/app.js`, `data/`, `build.py`, `test/run-physics.js`.
  Acceptance: Density lookup can use versioned static population tiles with offline fallback to the current heuristic; UI/export identifies the density source; tests cover tile hit, tile miss, and fallback.
  Complexity: XL

- [ ] P1 - Add a WSEG-10 fallout comparison mode
  Why: Current fallout ellipses are useful but simplified; WSEG-10 is the practical public next step and is called out by NUKEMAP and GOFAI/glasstone.
  Evidence: `NM.calcEffects().fallout` in `js/physics.js`, GOFAI/glasstone, NUKEMAP roadmap.
  Touches: `js/physics.js`, `js/effects.js`, `js/extras.js`, `js/app.js`, `test/run-physics.js`.
  Acceptance: A selectable fallout model shows current simplified plume vs WSEG-10-derived dose zones, exports identify the chosen model, and regression tests pin known reference cases.
  Complexity: L

- [ ] P1 - Add privacy notice and safe rendering for location/error flows
  Why: GPS and live wind features touch location data, and one geolocation error path uses `innerHTML` with `err.message`.
  Evidence: `js/immersive.js:219-231`, `js/app.js:957-989`, Open-Meteo terms/docs, OWASP DOM XSS guidance.
  Touches: `js/immersive.js`, `js/app.js`, `index.html`, `css/styles.css`.
  Acceptance: GPS and real-wind controls show concise pre-use privacy text, errors render via text-safe helpers, and no browser/API error message is inserted as raw HTML.
  Complexity: S

- [ ] P1 - Add browser QA for mobile, PWA, offline, and accessibility states
  Why: Node tests cover models, but no automated browser pass verifies installability, service-worker updates, mobile clipping, tab semantics, high contrast, or reduced motion.
  Evidence: `package.json`, `test/`, WCAG 2.2, PWA manifest docs, recent mobile/a11y fixes in `git log`.
  Touches: `package.json`, `test/`, `index.html`, `css/styles.css`, `sw.js`.
  Acceptance: A local Playwright/Lighthouse script runs desktop and mobile smoke flows, checks no console errors, verifies PWA manifest/SW registration, captures screenshots, and is documented in repo notes.
  Complexity: M

- [ ] P2 - Add PWA screenshots, shortcuts, and native share support
  Why: The app is installable but does not expose screenshots, app shortcuts, or Web Share flows that improve mobile/install surfaces.
  Evidence: `manifest.json`, `js/app.js:443`, MDN Web Share API, MDN manifest screenshots.
  Touches: `manifest.json`, `index.html`, `js/app.js`, `assets/`, `README.md`.
  Acceptance: Manifest includes screenshot assets and shortcuts for Detonate, WW3, Saved Scenarios, and Emergency Guide; supported browsers use `navigator.share()` for links/exports with clipboard fallback.
  Complexity: M

- [ ] P2 - Introduce a UI string registry for localization
  Why: NUKEMAP's 2026 roadmap prioritizes translation, while NukeMap hardcodes English strings across HTML and panel generators.
  Evidence: `index.html`, `js/app.js`, `js/premium.js`, `js/advanced.js`, NUKEMAP roadmap.
  Touches: `js/i18n.js`, `index.html`, `js/*.js`, `build.py`, `test/`.
  Acceptance: Core navigation, onboarding, controls, exports, and emergency-guide strings resolve through a registry; English remains default; tests catch missing string keys.
  Complexity: L

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
