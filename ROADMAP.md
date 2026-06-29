# TsunamiSimulator Roadmap

Single source of truth for delivery. Blocked items live in
[`Roadmap_Blocked.md`](./Roadmap_Blocked.md). Shipped work is summarized in
[`CHANGELOG.md`](./CHANGELOG.md).

---

## Research-Driven Additions

### P0

- [ ] P0 — Surface Rust-side diagnostics to the frontend LogViewer
  Why: GPU solver failures, VRAM fallbacks, and PNG encode errors go to stderr via `eprintln!` and are invisible in the app's diagnostics panel. Users and support workflows miss critical solver state information.
  Evidence: 9 `eprintln!` calls in `src-tauri/src/physics/solver/gpu.rs` (lines 150, 158, 415, 457) and `src-tauri/src/physics/solver/mod.rs` (lines 312, 317); frontend LogViewer only intercepts JS `console.warn`/`console.error`
  Touches: `src-tauri/src/physics/solver/gpu.rs`, `src-tauri/src/physics/solver/mod.rs`, `src-tauri/src/lib.rs` (Tauri event emission), `src/components/LogViewer.tsx` (listen for Rust events)
  Acceptance: GPU fallback, VRAM limit, poll failure, readback failure, and PNG encode errors appear as timestamped entries in the LogViewer panel. Existing `eprintln!` calls are replaced or supplemented with `app_handle.emit("solver-diagnostic", ...)` events.
  Complexity: M

- [ ] P0 — Replace silent .catch(() => {}) error swallowers with logged warnings
  Why: 8 locations silently discard errors from settings reads, token fetches, tour completion, and simulation cancellation. These mask initialization and persistence failures that should appear in diagnostics.
  Evidence: `src/App.tsx` (lines 255, 263, 304, 376, 724), `src/main.tsx` (line 22), `src/components/ScenarioBuilder.tsx` (line 199), `src/components/SwePlayback.tsx` (line 136)
  Touches: `src/App.tsx`, `src/main.tsx`, `src/components/ScenarioBuilder.tsx`, `src/components/SwePlayback.tsx`
  Acceptance: Every `.catch(() => {})` is replaced with `.catch((err) => console.warn("[context] operation failed", err))` so failures appear in the LogViewer. No user-facing UI changes — these are diagnostic-only.
  Complexity: S

### P1

- [ ] P1 — Adopt Azure Artifact Signing for Windows code signing
  Why: Azure Artifact Signing (formerly Trusted Signing) offers code signing at ~$10/month without hardware tokens or EV certificates. This unblocks the existing F-V04 blocker in Roadmap_Blocked.md, which assumed $400-900/year EV certs were the only path. Unsigned installers trigger SmartScreen warnings and reduce user trust.
  Evidence: https://azure.microsoft.com/en-us/products/artifact-signing; https://textslashplain.com/2025/03/12/authenticode-in-2025-azure-trusted-signing/; existing F-V04 blocker in `Roadmap_Blocked.md`
  Touches: `docs/release/CODESIGNING.md`, `scripts/verify.mjs` (optional signtool step), build/release workflow, README install section
  Acceptance: Windows MSI and NSIS installers are signed with an Azure Artifact Signing certificate. `signtool verify /pa` reports a valid signature. SmartScreen no longer shows unknown-publisher warnings. CODESIGNING.md documents the Azure setup.
  Complexity: M

- [ ] P1 — Publish winget manifest for Windows Package Manager distribution
  Why: winget is the standard Windows package manager (ships with Windows 11). Publishing a manifest enables `winget install TsunamiSimulator` and improves discoverability. Unsigned installers are accepted on winget.
  Evidence: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/choose-distribution-path; winget supports MSI/EXE installers
  Touches: New `winget/` directory with manifest YAML, README install section, release checklist in `docs/release/CODESIGNING.md`
  Acceptance: `winget search TsunamiSimulator` finds the package. `winget install SysAdminDoc.TsunamiSimulator` installs from the GitHub Release MSI. Manifest passes `winget validate`.
  Complexity: S

- [ ] P1 — Persist guided-lesson completion state
  Why: The v0.4.4 guided lessons use ephemeral React state — lesson progress resets on page reload. Persisting completion timestamps (like tour/disclaimer) lets users track which lessons they've done and lets teachers verify student progress.
  Evidence: `src/components/GuidedLesson.tsx` uses `useState`; `src/lib/settings.ts` already persists `tour_completed_at` and `disclaimer_acknowledged_at` with the same pattern
  Touches: `src/lib/settings.ts` (add `lessons_completed` key), `src/lib/guided-lessons.ts`, `src/components/GuidedLesson.tsx`, `src/components/PresetSelector.tsx` (show completion badge), `src/lib/__tests__/settings-scenarios.test.ts`
  Acceptance: Completing a lesson persists its ID + timestamp. The lesson launcher in PresetSelector shows a visual indicator for completed lessons. Completion state survives app restart. At least one test covers the persistence round-trip.
  Complexity: S

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

### P0

- [ ] P0 — Restore the tracked local toolchain doctor
  Why: The README advertises `npm run doctor` and `package.json` wires it, but the target script is missing, so the documented preflight path fails before checking the user's machine.
  Evidence: `package.json` script `"doctor": "node scripts/doctor.mjs"`; `README.md:161`; `scripts/doctor.mjs` absent; local `npm run doctor` fails with `MODULE_NOT_FOUND`
  Touches: `scripts/doctor.mjs`, `package.json`, `README.md`, `scripts/verify.mjs`
  Acceptance: `npm run doctor` runs without module-resolution failure, reports required vs optional tools (Node/npm, Rust/Cargo, Tauri CLI, Visual Studio Build Tools, cargo-audit, cargo-deny, signtool), gives actionable install/fix text, exits nonzero only for required missing tools, and has at least one unit or smoke test covering the command.
  Complexity: S

### P1

- [ ] P1 — Repair public docs links to tracked support paths
  Why: Public docs currently send users to gitignored/local-only or absent markdown/templates, which undermines setup, support, and disclosure trust.
  Evidence: `README.md:230` links `COMPLETED.md` and `RESEARCH_REPORT.md`; `CONTRIBUTING.md:129` references absent `.github/ISSUE_TEMPLATE/` and gitignored `SECURITY.md`; `.gitignore` ignores most markdown except an explicit whitelist
  Touches: `README.md`, `CONTRIBUTING.md`, `.gitignore`
  Acceptance: README and CONTRIBUTING only link tracked files or live URLs; `rtk rg -n "COMPLETED.md|RESEARCH_REPORT.md|SECURITY.md|ISSUE_TEMPLATE" README.md CONTRIBUTING.md .gitignore` returns no stale public-doc references except intentional ignore rules; no new markdown files are created.
  Complexity: S

### P2

- [ ] P2 — Add desktop deep-link import for shared scenario URLs
  Why: Scenario URLs are exportable, but an installed desktop app cannot open a shared scenario directly from email, docs, or a browser. Tauri's deep-link plugin supports custom desktop schemes and fits the existing share/export workflow.
  Evidence: Tauri deep-link documentation; existing scenario URL export path in `src/App.tsx`; NUKEMAP export/share pattern
  Touches: `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/src/lib.rs`, `src/App.tsx`, scenario URL parser/tests
  Acceptance: Launching `tsunamisimulator://open?scenario=<encoded>` opens the existing app instance when possible, validates and imports the scenario into the active slot, rejects malformed links with a LogViewer warning/toast, and has parser coverage for valid, malformed, and oversized payloads.
  Complexity: M
