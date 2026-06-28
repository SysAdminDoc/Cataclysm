# Roadmap

Nuclear weapon effects simulator with 12 effect rings, 38 weapon presets, full WW3 engine (427 targets, 708 warheads, 7 scenarios), HEMP, water burst, SVG mushroom cloud, PWA. Physics from Glasstone & Dolan.

## Research-Driven Additions (Round 5)

## Research-Driven Additions

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
