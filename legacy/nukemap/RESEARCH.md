# Research - NukeMap

## Executive Summary
NukeMap v3.6.0 is a static vanilla JavaScript + Leaflet nuclear weapon effects simulator with a strong offline/PWA shape, 38 weapon presets, 12 effect rings, HEMP and water burst modes, MIRV, scenario storage, GeoJSON/KML/CSV/JSON exports, a 427-target WW3 engine, WebWorker-assisted physics/heatmap work, and 2,689 local regression cases. Recent commits already closed the stale v3.5.0 research items: yield validation, WW3 orphaned frames, Geiger lifecycle, service-worker update toast, OffscreenCanvas heatmap, WW3 physics worker, GeoJSON, WCAG target sizing, SIPRI refresh, and LRU tile cache. Highest-value next direction is trust and analyst-grade fidelity: fix the remaining export/version drift, validate imported scenario data, expose source/confidence metadata in every model/export, replace nearest-city casualty density with gridded population data, improve fallout model comparability, add PWA install/share polish, prepare localizable UI strings, and add browser QA around accessibility and offline behavior.

## Product Map
- Core workflows: search or click a location, configure yield/burst/wind/model, detonate, inspect effects/casualties/shelter/timeline, save/share/export, and run WW3 scenarios.
- User personas: educators, students, emergency planners, civil-defense trainers, arms-control researchers, defense analysts, and public-interest users.
- Platforms and distribution: GitHub Pages static site, service-worker PWA, local `index.html`, and `build.py` offline single-file bundle.
- Key integrations and data flows: Leaflet 1.9.4 CDN + SRI, local JS modules under `window.NM`, Open-Meteo current wind, ZIP/city/target static data, IndexedDB/localStorage scenario storage, WebWorker physics and OffscreenCanvas heatmap fallback paths.

## Competitive Landscape
- NUKEMAP: strongest public benchmark, with 2026 roadmap work on updated LandScan population, humanitarian impacts, AWEL.js, WSEG-10/WebGL fallout, accessibility, mobile, and translation. NukeMap should learn from its source-linked model transparency and humanitarian-impact direction, but avoid waiting on unreleased AWEL.js or adopting backend cost/complexity.
- Nuclear War Simulator: strongest closed-source scenario simulator with desktop-scale conflict modeling, scenarios, and modding expectations. NukeMap should borrow scenario authoring/briefing ideas, but avoid desktop-only complexity and paid-game assumptions.
- NukeBlastSimulator: small Astro/Leaflet competitor with a public methodology page. NukeMap should keep making formulas and validation visible in-app, but avoid its narrow feature set and unclear licensing posture.
- Outrider blast simulator: communicates nuclear effects with a simple public-facing journey. NukeMap should preserve educator mode and low-friction onboarding, while keeping advanced controls available instead of reducing to a few presets.
- GOFAI/glasstone and HeWu: best OSS reference implementations for alternate U.S./Soviet effects models and WSEG-10 context. NukeMap should use them as validation oracles and model-comparison sources, not as runtime dependencies.
- Karzas-Latter-Seiler EMP code: useful public E1 HEMP reference implementation. NukeMap should use it for validation and confidence notes, but avoid promising weapon-design-specific EMP precision.
- Fourmilab Nuclear Bomb Effects Computer: durable source-oriented calculator. NukeMap should copy its explicit-calculator trust posture, not its dated interaction model.

## Security, Privacy, and Reliability
- Bug: `js/app.js:1467` exports JSON with `version:'3.5.0'` while the app, cache, README, title, and report footer are v3.6.0; exported files therefore misidentify the model version.
- Bug: `index.html:41` still says `32 Weapons`, while `js/data.js` currently defines 39 `NM.WEAPONS` entries including Custom; onboarding copy undercounts current presets.
- Risk: `js/app.js:1526-1547` CSV import accepts arbitrary file size, unbounded row count, unchecked lat/lng ranges, unchecked yield ceilings, and arbitrary burst labels before triggering map detonations.
- Risk: `js/immersive.js:231` injects `err.message` into `innerHTML`; browser geolocation errors are low-risk but should still use text-safe rendering consistently because the app has many HTML sinks.
- Missing guardrail: `index.html:6` uses a meta CSP and still allows `style-src 'unsafe-inline'`; static hosting may require this today, but Trusted Types plus a central HTML rendering helper would reduce DOM-XSS exposure as panels expand.
- Recovery gap: service-worker update prompts exist, but there is no visible offline cache status/audit panel for which JS/data/cache version is active when a user reports stale simulations.
- Privacy gap: GPS safety check and Open-Meteo wind lookup are user-triggered, but the UI does not summarize what location data leaves the browser before use.

## Architecture Assessment
- Model transparency: `js/physics.js` has `NM.CITATIONS`, but exports and most UI panels do not carry model names, citation keys, confidence labels, or assumptions; analysts cannot trace a saved file back to model choices.
- Casualty fidelity: `NM.estimateDensity()` uses nearest-city heuristics in `js/physics.js`, while competitors and population research point to gridded datasets (LandScan, WorldPop, GHS-POP) as the more credible path.
- Fallout fidelity: current Miller-style fallout ellipses are useful but limited; NUKEMAP and GOFAI/glasstone both point to WSEG-10 as the next practical public model for dose-over-time comparison.
- Scenario system: saved scenarios support folders/search, but there is no schema version, import preview, diff/merge flow, or validation report for CSV/JSON round trips.
- PWA packaging: `manifest.json` has icons and install basics, but no screenshots, shortcuts, categories, or share-target/web-share flow; app-store/install surfaces undersell the app.
- i18n: `index.html` and JS panels contain hardcoded English strings throughout; NUKEMAP's 2026 roadmap explicitly calls translation native-framework work a priority, and NukeMap has no string registry yet.
- Testing: Node tests cover physics/search/WW3/shelter, but there is no Playwright/Lighthouse pass for mobile clipping, tab semantics, installability, service-worker update UX, CSV import, export version metadata, or reduced-motion/high-contrast modes.

## Rejected Ideas
- Depend on AWEL.js: NUKEMAP says it is unreleased and not production-ready; use it later as a validation oracle only.
- Migrate to Leaflet 2.0 now: Leaflet 2 is still alpha and changes globals/factory APIs to ESM; NukeMap's no-bundler static shape should wait until stable.
- Switch to Protomaps/PMTiles immediately: useful for tile-cost control at NUKEMAP scale, but NukeMap's current public GitHub Pages app has no tile-billing pressure and already has offline fallback tiles.
- Add individual civilian agents: Nuclear War Simulator-style agent simulation would fight NukeMap's static PWA constraints and requires data/compute far beyond the current app.
- Implement DELFIC: NUKEMAP reports DELFIC browser feasibility as uncertain and public-code availability is weak; WSEG-10 is the practical next fallout model.
- Add remote accounts or collaboration: no strong competitor/source signal, and it would undermine NukeMap's local/offline privacy advantage.
- Add GitHub Actions: repo policy requires local builds/tests only; keep verification scripts local.

## Sources
### Competitors
- https://blog.nuclearsecrecy.com/2026/02/10/nukemap-roadmap/
- https://nuclearsecrecy.com/nukemap/
- https://store.steampowered.com/app/1603940/Nuclear_War_Simulator/
- https://nukeblastsimulator.com/methodology
- https://outrider.org/projects/nuclear-bomb-blast-simulator
- https://www.fourmilab.ch/bombcalc/

### OSS and Physics
- https://github.com/GOFAI/glasstone
- https://github.com/Prethea-Phoenixia/HeWu
- https://github.com/gshartnett/karzas-latter-seiler
- https://github.com/nuclearblastsimulator/nuclear-blast-simulator
- https://www.rand.org/pubs/working_papers/WRA879-2.html
- https://arxiv.org/abs/2402.14864

### Data and Nuclear Forces
- https://fas.org/initiative/status-world-nuclear-forces/
- https://www.sipri.org/media/press-release/2026/increasing-focus-nuclear-weapons-amid-heightened-escalation-risks-new-sipri-yearbook-out-now
- https://thebulletin.org/premium/2026-03/united-states-nuclear-weapons-2026/
- https://thebulletin.org/premium/2026-05/russian-nuclear-weapons-2026/
- https://www.congress.gov/crs-product/IF10472
- https://www.worldpop.org/sdi/introapi/
- https://human-settlement.emergency.copernicus.eu/ghs_pop2023.php
- https://www.nature.com/articles/s41597-025-04817-z

### Web Platform, Security, Accessibility
- https://leafletjs.com/2025/05/18/leaflet-2.0.0-alpha.html
- https://leafletjs.com/reference.html
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API
- https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/screenshots
- https://developer.mozilla.org/en-US/docs/Web/API/Trusted_Types_API
- https://owasp.org/www-community/attacks/DOM_Based_XSS
- https://www.w3.org/TR/WCAG22/
- https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas
- https://open-meteo.com/en/docs
- https://open-meteo.com/en/terms

## Open Questions
- Which gridded population source should be the first implementation target: static pre-tiled GHS-POP/WorldPop assets for offline reliability, or optional live lookup for smaller bundles?
- Should WSEG-10 ship first as a single-detonation dose-over-time model, or wait for a worker/WebGL implementation that can also support WW3-scale fallout?
