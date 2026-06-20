# TsunamiSimulator Roadmap

Single source of truth for delivery. Blocked items live in
[`Roadmap_Blocked.md`](./Roadmap_Blocked.md). Shipped work is summarized in
[`CHANGELOG.md`](./CHANGELOG.md).

---

## Research-Driven Additions

### P0

- [ ] P0 — Complete Vite 8 migration: `rolldownOptions` + `codeSplitting`
  Why: vite.config.ts still uses deprecated `build.rollupOptions` and `manualChunks` function — both produce deprecation warnings and may be removed in Vite 9
  Evidence: Vite 8 migration guide (vite.dev/guide/migration); Rolldown codeSplitting docs
  Touches: vite.config.ts — rename key, replace `manualChunks` function with `codeSplitting.groups` regex array, update stale "Rollup" comment on line 9
  Acceptance: `npx vite build` produces no deprecation warnings; CesiumJS and React chunks are correctly split
  Complexity: S

- [ ] P0 — Add unit tests for recently shipped features
  Why: AttenuationChart, TimelineView, exportKml, scenarioFromUrl/scenarioToUrlParams were shipped with zero test coverage
  Evidence: No matching test imports found in src/**/__tests__/
  Touches: src/lib/__tests__/export.test.ts (add KML tests), src/lib/__tests__/scenario-schema.test.ts (add URL encoding/decoding tests), new src/components/__tests__/TimelineView.test.tsx, new src/components/__tests__/AttenuationChart.test.tsx
  Acceptance: `npm run test:unit` covers KML export edge cases (empty points, missing center), URL round-trip encoding, timeline date parsing for all preset date formats, attenuation chart log-scale axis computation
  Complexity: M

- [ ] P0 — Fix TimelineView hardcoded year 2026
  Why: `parseDateToYearsAgo` on line 30 of TimelineView.tsx uses `2026 - parseInt(...)` — will show wrong "years ago" values starting January 2027
  Evidence: src/components/TimelineView.tsx:30
  Touches: src/components/TimelineView.tsx — replace `2026` with `new Date().getFullYear()`
  Acceptance: Timeline labels show correct relative ages regardless of the current year
  Complexity: S

### P1

- [ ] P1 — Update Playwright smoke test for new toolbar buttons
  Why: The "export buttons are present" test (smoke.spec.ts lines 46-53) doesn't verify the new KML or Link buttons
  Evidence: tests/smoke.spec.ts — only checks PNG, Share, Video, Text, Citations, Settings
  Touches: tests/smoke.spec.ts — add assertions for KML and Link buttons
  Acceptance: Playwright test verifies all toolbar buttons including KML and Link are rendered
  Complexity: S

- [ ] P1 — Fix KML export fragile placemark-to-folder indexing
  Why: Lines 508-511 of export.ts use conditional array indexing (`placemarks[1]` when `cavityR > 500`) duplicated between placemark building and folder slotting — divergence would misattribute placemarks
  Evidence: src/lib/export.ts:508-511
  Touches: src/lib/export.ts — build separate source/runup arrays instead of indexing a flat placemarks list
  Acceptance: KML export produces correct folder structure for sources with and without cavity polygons; existing KML test covers both cases
  Complexity: S

- [ ] P1 — Wire custom scenario URL sharing
  Why: scenarioToUrlParams supports base64 custom scenario encoding but App.tsx line 432 passes null; scenarioFromUrl restores presets but ignores ?scenario= path
  Evidence: src/App.tsx:432 (passes null), src/App.tsx:231-233 (only handles preset type), src/lib/scenario-schema.ts:378-388 (encoding exists)
  Touches: src/App.tsx — pass current custom scenario input to scenarioToUrlParams; handle scenario type in URL restore effect
  Acceptance: Custom scenario Link button copies a ?scenario= URL that another user can paste to restore the full scenario
  Complexity: S

- [ ] P1 — Upgrade Rust edition 2021 → 2024
  Why: Edition 2024 (stable since Rust 1.85, Feb 2025) enables new Cargo resolver, async closures, cfg_select!, updated Rustfmt
  Evidence: Rust 1.85 announcement; Cargo.toml edition = "2021"
  Touches: src-tauri/Cargo.toml — change `edition = "2021"` to `edition = "2024"`
  Acceptance: `cargo check` passes with edition 2024; CI Rust jobs remain green
  Complexity: S

### P2

- [ ] P2 — Bump tsconfig target to ES2025
  Why: TypeScript 6 defaults to ES2025; vite.config.ts build target already includes es2022/chrome105; ES2025 unlocks Set operations, Array.fromAsync, and other modern syntax without downleveling
  Evidence: tsconfig.json target = "ES2022"; TS 6 announcement defaults to ES2025
  Touches: tsconfig.json — change target and lib from ES2022 to ES2025
  Acceptance: `npx tsc --noEmit` passes; no new runtime errors in browser preview or Playwright tests
  Complexity: S

- [ ] P2 — Pass busyId to TimelineView for loading feedback
  Why: Selecting a preset from the timeline shows no loading indicator because TimelineView doesn't accept or use busyId
  Evidence: src/components/TimelineView.tsx props lack busyId; src/components/PresetSelector.tsx passes busyId to card list but not timeline
  Touches: src/components/TimelineView.tsx (add busyId prop, show loading state on active marker), src/components/PresetSelector.tsx (pass busyId through)
  Acceptance: Clicking a timeline marker shows a visual loading indicator matching the card view's behavior
  Complexity: S

- [ ] P2 — Document AttenuationChart JS physics as architecture carve-out
  Why: computeDecayCurve in AttenuationChart.tsx violates the "physics in Rust only" rule (CLAUDE.md); it should either be migrated to a Rust IPC call (blocked on MSVC) or explicitly documented as a sanctioned carve-out like demo.ts
  Evidence: src/components/AttenuationChart.tsx:23-40 — JS wave decay computation; CLAUDE.md architecture rule
  Touches: CLAUDE.md — add AttenuationChart to Known residuals as a sanctioned carve-out alongside demo.ts, or add a BROWSER PREVIEW label
  Acceptance: Architecture violation is either resolved (Rust IPC) or explicitly sanctioned with the same treatment as demo.ts
  Complexity: S
