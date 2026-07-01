# TsunamiSimulator Roadmap

Single source of truth for delivery. Blocked items live in
[`Roadmap_Blocked.md`](./Roadmap_Blocked.md). Shipped work is summarized in
[`CHANGELOG.md`](./CHANGELOG.md).

---

## Research-Driven Additions

### P1

- [ ] P1 — Migrate runup/inundation overlays to CesiumJS Buffer*Collection APIs
  Why: CesiumJS 1.140 (April 2026) added `BufferPointCollection`, `BufferPolylineCollection`, and `BufferPolygonCollection` — performance-focused vector primitive APIs. Current overlays use batched `CylinderGeometry`/`EllipseGeometry` primitives which create individual geometry objects for 60+ coastal points. Buffer APIs would reduce memory and draw-call overhead.
  Evidence: https://cesium.com/blog/2026/04/01/cesium-releases-in-april-2026/ (CesiumJS 1.140 release notes); `src/components/CoastalRunupOverlay.tsx` (current primitive-based approach)
  Touches: `src/components/CoastalRunupOverlay.tsx`, `src/components/Globe.tsx` (entity/primitive lifecycle), package.json (if CesiumJS version bump needed)
  Acceptance: Runup bars and inundation discs render using Buffer*Collection APIs. Visual output is unchanged. Performance profile shows reduced entity count and faster frame times when 60+ coastal points are active.
  Complexity: M

### P2

- [ ] P2 — Add physics glossary tooltip system
  Why: Educational users encounter specialized terms (Mw, SWE, Okada, Synolakis, DART, CFL, runup, eta) without inline definitions. PhET simulations succeed by making complex models legible through implicit scaffolding — tooltips for domain terminology are part of that pattern.
  Evidence: PhET design principles (https://phet.colorado.edu/); `src/components/ResultsPanel.tsx`, `src/components/SwePlayback.tsx`, `src/components/ScenarioBuilder.tsx` all contain domain-specific terminology without hover definitions
  Touches: New `src/lib/glossary.ts` (term definitions), new `src/components/GlossaryTip.tsx` (tooltip component), `src/components/ResultsPanel.tsx`, `src/components/SwePlayback.tsx`, `src/components/ScenarioBuilder.tsx`, `src/styles.css`
  Acceptance: At least 15 domain terms (Mw, SWE, Okada, Synolakis, DART, CFL, runup, eta, cavity radius, attenuation, Boussinesq, Manning friction, leapfrog, wavefront, inundation) show an inline tooltip on hover/focus with a brief definition and citation. Tooltips are keyboard-accessible (focusable).
  Complexity: M

- [ ] P2 — Add print stylesheet for classroom handouts
  Why: Teachers need printable summaries of preset readouts, scenario results, and lesson content for classroom distribution. Currently the dark-theme UI prints as a dark page with clipped content.
  Evidence: PhET educational patterns; `src/styles.css` has no `@media print` rules
  Touches: `src/styles.css` (add `@media print` block), `src/components/ResultsPanel.tsx` (print-optimized layout), `src/components/GuidedLesson.tsx` (print lesson content)
  Acceptance: Browser print (Ctrl+P) produces a clean white-background page with readable results, source parameters, citations, and model-limitation disclaimers. Globe canvas is replaced with a placeholder or hidden. No truncation or overflow.
  Complexity: S

- [ ] P2 — Add comparison-mode export
  Why: Compare mode places two scenarios side-by-side on synchronised globes, but the comparison cannot be exported. Teachers and reviewers want to save or share comparison results (e.g., Poseidon realistic vs propaganda).
  Evidence: `src/App.tsx` compare mode (data-compare attribute); no export path exists for the comparison view; NUKEMAP shareable comparison pattern
  Touches: `src/lib/export.ts` (new `exportComparisonPng` function), `src/App.tsx` (comparison export button), `src/styles.css`
  Acceptance: A "Compare export" button in comparison mode captures both globe canvases side-by-side in a single PNG with labels, source summaries, and model provenance. The export includes the "BROWSER PREVIEW — APPROXIMATE" watermark when in browser mode.
  Complexity: M

- [ ] P2 — Add colorblind-safe third colormap option
  Why: Current colormaps are "diverging" (pink/blue) and "cividis" (yellow/blue). Adding a perceptually uniform sequential colormap (e.g., Viridis) would improve accessibility for users with protanopia or deuteranopia. Accessibility guidelines recommend testing with at least three CVD simulations.
  Evidence: https://colorblind.io/guides/data-visualization; `src/lib/settings.ts` ColormapId type currently allows only "diverging" | "cividis"
  Touches: `src/lib/settings.ts` (extend ColormapId), `src-tauri/src/physics/solver/mod.rs` (colormap palette), `src/lib/demo.ts` (demo colormap), `src/components/Settings.tsx` (UI for third option), tests
  Acceptance: Settings offers three colormaps including at least one perceptually uniform sequential option. SWE overlay renders correctly with all three. Tests verify the new colormap value persists and migrates.
  Complexity: S

- [ ] P2 — Refresh npm dependencies to current minor/patch versions
  Why: `npm run deps-check` reports 13 outdated packages including Tauri CLI (2.11.2→2.11.3), Playwright (1.61.0→1.61.1), axe-core (4.11.3→4.12.1), Vite (8.0.16→8.1.0), and React type definitions. Staying current reduces drift and picks up bug fixes.
  Evidence: `npm run deps-check` output; `package.json`
  Touches: `package.json`, `package-lock.json`
  Acceptance: `npm run deps-check` reports 0 outdated packages within the current major version ranges. `npm run verify` passes (typecheck + lint + vitest + build + audit + playwright + rust).
  Complexity: S

### P3

- [ ] P3 — Add settings export/import for classroom deployment
  Why: Teachers deploying TsunamiSimulator across a classroom of machines need consistent starting configuration (theme, globe style, colormap, dismissed banners). Manual setup on each machine is friction.
  Evidence: PhET classroom deployment patterns; `src/lib/settings.ts` loadAll/resetAll already provide the read/write primitives
  Touches: `src/components/Settings.tsx` (export/import buttons), `src/lib/settings.ts` (serialization helpers), `src/lib/export.ts` (downloadBlob reuse)
  Acceptance: Settings panel has "Export settings" and "Import settings" buttons. Export saves a JSON file. Import reads and applies it with validation. Unknown keys are ignored with a console.warn. At least one test covers the round-trip.
  Complexity: S

- [ ] P3 — Add keyboard-accessible gauge coordinate entry from globe inspect
  Why: Currently gauges require manual lat/lon typing. The existing inspect-on-click feature already displays lat/lon coordinates at the clicked point. Wiring "Add gauge here" into the inspect tooltip would make gauge placement faster and more accessible.
  Evidence: `src/components/Globe.tsx` inspect mode (line ~456, `inspect_at_point`); `src/components/SwePlayback.tsx` gauge add UI
  Touches: `src/components/Globe.tsx` (add gauge callback from inspect), `src/components/SwePlayback.tsx` (accept gauge from parent), `src/App.tsx` (thread gauge callback)
  Acceptance: When inspect mode is active and a point is clicked, an "Add gauge" action appears in the inspect tooltip. Clicking it creates a gauge at that lat/lon with an auto-generated name. The gauge appears in the SwePlayback gauge list.
  Complexity: M

- [ ] P3 — Split styles.css into component-scoped partials
  Why: `src/styles.css` is 2,890 lines — the largest single file in the frontend. It has no architectural blocker (unlike Globe.tsx and commands.rs which need Cesium/Rust verification). Component-scoped partials would improve maintainability and reduce merge conflicts.
  Evidence: `src/styles.css` (2,890 lines); no `@media print`, no CSS Modules, no component scoping
  Touches: `src/styles.css` (split into partials), `vite.config.ts` (if adopting CSS Modules), all components importing styles
  Acceptance: Styles are organized into component-scoped files (e.g., `src/components/SwePlayback.css`, `src/components/Globe.css`). No visual changes. All Playwright visual regression tests pass with unchanged baselines.
  Complexity: M

## Research-Driven Additions

### P2

- [ ] P2 — Add desktop deep-link import for shared scenario URLs
  Why: Scenario URLs are exportable, but an installed desktop app cannot open a shared scenario directly from email, docs, or a browser. Tauri's deep-link plugin supports custom desktop schemes and fits the existing share/export workflow.
  Evidence: Tauri deep-link documentation; existing scenario URL export path in `src/App.tsx`; NUKEMAP export/share pattern
  Touches: `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/src/lib.rs`, `src/App.tsx`, scenario URL parser/tests
  Acceptance: Launching `tsunamisimulator://open?scenario=<encoded>` opens the existing app instance when possible, validates and imports the scenario into the active slot, rejects malformed links with a LogViewer warning/toast, and has parser coverage for valid, malformed, and oversized payloads.
  Complexity: M

## Research-Driven Additions

### P1

- [ ] P1 — Enforce Rust advisory and license checks for release verification
  Why: RustSec and cargo-deny checks are already configured, but `scripts/verify.mjs` skips them when binaries are missing, so release verification can pass without Rust advisory/license coverage.
  Evidence: `scripts/verify.mjs:166-175`; `src-tauri/deny.toml`; RustSec cargo-audit; Embark cargo-deny
  Touches: `scripts/verify.mjs`, `scripts/deps-check.mjs`, `package.json`, `README.md`, `docs/release/CODESIGNING.md`
  Acceptance: Normal developer verification may warn when `cargo-audit` or `cargo-deny` are absent, but release/strict verification fails with actionable install text. With both tools installed, `npm run verify` runs `cargo audit` and `cargo deny check` and fails on advisories or denied licenses.
  Complexity: S

### P2

- [ ] P2 — Add a docs/script truth gate to local verification
  Why: The broken `npm run doctor` path proves README/CHANGELOG/package script drift is not currently caught before release.
  Evidence: `README.md:161`; `CHANGELOG.md:192-194`; `package.json` script `"doctor": "node scripts/doctor.mjs"`; missing `scripts/doctor.mjs`
  Touches: `scripts/verify.mjs`, `package.json`, `README.md`, `CONTRIBUTING.md`
  Acceptance: A verification step scans public docs for `npm run <script>` and local markdown/file links, then fails when referenced npm scripts or tracked support paths are missing. The check ignores intentional external URLs and ignored local-only notes.
  Complexity: S

- [ ] P2 — Guard Tauri CSP exceptions with a documented allowlist
  Why: Cesium currently requires `unsafe-eval` and inline styles, but future CSP broadening should not happen silently in a desktop app with remote imagery/terrain access.
  Evidence: `src-tauri/tauri.conf.json:28`; Tauri security documentation; CesiumJS runtime constraints
  Touches: `src-tauri/tauri.conf.json`, `scripts/verify.mjs`, `README.md`, `docs/ipc-api.md`
  Acceptance: Local verification parses the configured CSP and fails if new wildcard origins, extra remote hosts, or additional unsafe directives are introduced without updating a small allowlist/rationale. Existing Cesium-required exceptions remain documented and unchanged.
  Complexity: S

## Research-Driven Additions

### P1

- [ ] P1 — Sample user gauge CSVs from Rust SWE fields
  Why: Desktop gauge CSVs are labeled as backend SWE output, but the current gauge series is generated by the browser demo sampler instead of raw Rust solver eta values.
  Evidence: `src/components/SwePlayback.tsx:96-104`; `src/lib/demo.ts::sampleGaugesFromDemo`; `src/lib/export.ts`; GeoClaw gauge outputs; NOAA SIFT/DART time-series products; `Roadmap_Blocked.md` DART RMSE prerequisite.
  Touches: `src-tauri/src/physics/solver/mod.rs`, `src-tauri/src/commands.rs`, `src/lib/tauri.ts`, `src/types/scenario.ts`, `src/components/SwePlayback.tsx`, `src/lib/export.ts`, `src/components/__tests__/SwePlayback.test.tsx`, Rust command tests.
  Acceptance: `simulate_grid` and streaming simulation accept gauge sample points and return per-snapshot eta samples from the Rust grid; desktop gauge sparklines/CSV use those samples and label the solver mode accurately; browser preview keeps the demo sampler with the existing approximate provenance; tests cover backend sample interpolation/bounds and CSV output.
  Complexity: M
