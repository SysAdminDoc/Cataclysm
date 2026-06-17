# TsunamiSimulator Roadmap

Single source of truth for delivery. Blocked items live in
[`Roadmap_Blocked.md`](./Roadmap_Blocked.md). Shipped work is summarized in
[`CHANGELOG.md`](./CHANGELOG.md).

---

## Future / Stretch

- **Population casualty overlay** (opt-in, heavy disclaimer)
- **Multi-event scenarios** — Chicxulub debris re-entry secondary impacts, Tōhoku aftershock tsunamis
- **Multi-language** UI (en/ja first — Tōhoku audience)

## Research-Driven Additions

### P0

- [ ] P0 — Correct bathymetry and confidence claims
  Why: The product currently overstates GEBCO/NOAA-grade fidelity while the backend still uses coarse offline bathymetry, which is the highest trust risk.
  Evidence: `README.md`; `src-tauri/src/data/bathymetry.rs`; `src-tauri/src/data/mod.rs`; GEBCO 2026 grid docs.
  Touches: `README.md`; `docs/manual/getting-started.md`; `docs/science/`; `src/components/FirstRunDisclaimer.tsx`; export metadata in `src/lib/export.ts`.
  Acceptance: User-facing copy, disclaimers, and exports consistently label the bathymetry as coarse/approximate unless real GEBCO is active; no docs claim a GEBCO sampler before it exists.
  Complexity: S

- [ ] P0 — Clear current npm audit findings
  Why: Two fixable low-severity dev-chain advisories keep the dependency surface from being clean on Windows development machines.
  Evidence: `npm audit --json`; GitHub advisories GHSA-4x5r-pxfx-6jf8 and GHSA-g7r4-m6w7-qqqr; `package-lock.json`.
  Touches: `package.json`; `package-lock.json`; CI dependency install path.
  Acceptance: `npm audit --audit-level=low` reports zero vulnerabilities or a documented no-fix transitive exception; `npm run typecheck`, `npm run test:unit`, and `npm run build` still pass.
  Complexity: S

- [ ] P0 — Add root error boundary and runtime error capture
  Why: A render/runtime failure can currently blank the Tauri WebView with no recovery path.
  Evidence: `src/main.tsx`; `src/components/LogViewer.tsx`; React root error-boundary best practice.
  Touches: `src/main.tsx`; `src/App.tsx`; `src/components/LogViewer.tsx`; new focused component tests.
  Acceptance: A forced render error shows a calm recovery panel, records the error in LogViewer, and does not break Settings, exports, or simulation controls after reload/retry.
  Complexity: M

### P1

- [ ] P1 — Validate and migrate saved/pasted scenarios
  Why: Saved scenarios and clipboard JSON are applied from unknown data without a versioned schema boundary.
  Evidence: `src/components/ScenarioBuilder.tsx`; `src/lib/settings.ts`; recent scenario-sharing commit `8767bca`.
  Touches: `src/components/ScenarioBuilder.tsx`; `src/lib/settings.ts`; new `src/lib/scenario-schema.ts`; ScenarioBuilder tests.
  Acceptance: Invalid, stale, or out-of-range payloads are rejected with specific inline feedback; valid older payloads migrate; no clipboard/store payload can put impossible values into visible scenario state.
  Complexity: M

- [ ] P1 — Cover scenario, settings, and streaming workflows in tests
  Why: Current Vitest/Playwright coverage misses the newest high-risk UX flows.
  Evidence: Existing tests under `src/components/__tests__`, `src/lib/__tests__`, and `tests/smoke.spec.ts`; missing ScenarioBuilder, Settings, and SwePlayback tests.
  Touches: `src/components/__tests__/`; `src/lib/__tests__/`; `tests/smoke.spec.ts`; test utilities/mocks.
  Acceptance: Tests cover scenario save/load/delete/copy/paste errors, Settings reset/token/offline rows, SwePlayback progress/cancel/snapshot handoff, and a smoke path for a saved scenario round trip.
  Complexity: M

- [ ] P1 — Remove stale shortcut documentation and hidden shortcut dependency
  Why: The manual advertises F6/F7/F8 controls that are not implemented, and policy favors explicit visible controls over shortcut-dependent UX.
  Evidence: `docs/manual/getting-started.md`; `docs/manual/custom-scenarios.md`; `src/hooks/useEscapeKey.ts`; source search for F-key handlers.
  Touches: `docs/manual/getting-started.md`; `docs/manual/custom-scenarios.md`; modal/control copy; keyboard-navigation tests.
  Acceptance: Docs no longer mention unsupported F-key shortcuts; every dismiss/cancel flow has visible controls and passes Tab/Enter/Escape accessibility checks where applicable.
  Complexity: S

### P2

- [ ] P2 — Move large runup overlays to Cesium primitive rendering
  Why: Cesium entities are fine for current named points but will not scale cleanly to larger runup/inundation overlays.
  Evidence: `src/components/Globe.tsx`; CesiumJS 1.142 `GeoJsonPrimitive` and buffer primitive release notes.
  Touches: `src/components/Globe.tsx`; `src/lib/export.ts`; globe rendering tests; Playwright visual smoke.
  Acceptance: Current 60+ point overlays look unchanged, and a synthetic 2,000-point runup/inundation fixture renders without entity leaks, severe frame drops, or broken picking.
  Complexity: L

- [ ] P2 — Add automated accessibility regression checks
  Why: Premium-quality hazard tooling needs repeatable contrast, focus, and semantic checks across first-run, settings, globe controls, and exports.
  Evidence: Existing Playwright smoke tests; no axe/jest-axe dependency or accessibility assertion in current tests; WCAG expectations for interactive controls.
  Touches: `package.json`; `tests/smoke.spec.ts`; component tests; CI workflow.
  Acceptance: CI runs an accessibility check over first-run, main cockpit, Settings, LogViewer, and at least one export flow; violations either fail the build or are explicitly waived with file-scoped rationale.
  Complexity: M
