# TsunamiSimulator Roadmap

Single source of truth for delivery. Blocked items live in
[`Roadmap_Blocked.md`](./Roadmap_Blocked.md). Shipped work is summarized in
[`CHANGELOG.md`](./CHANGELOG.md).

---

## Research-Driven Additions

### P2

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
