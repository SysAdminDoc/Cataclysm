# TsunamiSimulator Roadmap

Single source of truth for delivery. Blocked items live in
[`Roadmap_Blocked.md`](./Roadmap_Blocked.md). Shipped work is summarized in
[`CHANGELOG.md`](./CHANGELOG.md).

---

Legacy actionable items were drained in the prior pass. New incomplete work
from the current research pass follows.

## Research-Driven Additions

### P1

- [ ] P1 — Add a shared provenance payload to all results and exports
  Why: Operational and education tsunami tools make model limits, source data, and citations visible in outputs; TsunamiSimulator exports currently carry this unevenly.
  Evidence: `src/lib/export.ts`; `src/lib/text-export.ts`; `src/components/ResultsPanel.tsx`; GeoClaw/NOAA MOST output conventions
  Touches: `src/lib/model-provenance.ts` or equivalent, `src/lib/export.ts`, `src/lib/text-export.ts`, `src/components/ResultsPanel.tsx`, export tests
  Acceptance: PNG/share-card/text/CZML/GeoJSON/KML outputs include scenario type, solver mode, bathymetry source, citation URL/ref, timestamp, app version, and "educational, not warning" limitation text.
  Complexity: M

- [ ] P1 — Refresh bathymetry strategy to GEBCO_2026 and expose data confidence
  Why: The repo still targets GEBCO 2024 while GEBCO_2026 is current and includes TID metadata that can improve transparency even before the blocked local-data loader exists.
  Evidence: GEBCO gridded-data docs; `data/bathymetry/README.md`; `src/data/coastal_points.json`; `src-tauri/src/data/bathymetry.rs`
  Touches: `data/bathymetry/README.md`, `src/data/coastal_points.json`, `src-tauri/src/data/bathymetry.rs`, `src/components/SwePlayback.tsx`, export provenance
  Acceptance: Docs/comments/data provenance target GEBCO_2026, UI/export copy labels the current coarse basin/shelf approximation honestly, and the future TID-backed bathymetry path is named without claiming it ships.
  Complexity: M

- [ ] P1 — Add a local toolchain and verification doctor
  Why: Local verification is currently fragile: MSVC `link.exe` is missing from this PowerShell PATH, `cargo audit` is not installed, and Vitest 4 worker runs can hang on the VMware shared folder.
  Evidence: local `cargo audit` result; focused Vitest run; `package.json` scripts
  Touches: `package.json`, `scripts/doctor.mjs` or equivalent, optional CI smoke step
  Acceptance: `npm run doctor` reports Node/Rust/Tauri, MSVC linker, cargo-audit, workspace path, and recommended Vitest flags with actionable pass/fail messages.
  Complexity: S

### P2

- [ ] P2 — Version and migrate the app settings store
  Why: Scenario payloads are versioned, but persisted app settings are only normalized key-by-key, making future preference changes harder to migrate safely.
  Evidence: `src/lib/settings.ts`; `src/lib/scenario-schema.ts`; settings tests
  Touches: `src/lib/settings.ts`, `src/lib/__tests__/settings-scenarios.test.ts`, `src/components/Settings.tsx`
  Acceptance: Settings writes include a schema version, legacy settings migrate deterministically, unknown values fall back with diagnostics, and tests cover at least one legacy-to-current migration.
  Complexity: M

- [ ] P2 — Add screenshot-backed visual and accessibility regression coverage for the current cockpit
  Why: Existing Playwright checks cover smoke paths and axe scans, but the committed screenshots are stale and there is no automated guard for toolbar density, modal clipping, or light/dark cockpit regressions.
  Evidence: `tests/smoke.spec.ts`; `assets/screenshots/*.png`; `src/styles.css`; Playwright screenshot tooling
  Touches: `tests/smoke.spec.ts`, `playwright.config.ts`, `assets/screenshots/*`, CI artifacts
  Acceptance: Playwright captures current v0.4.4 desktop and narrow-layout states for first-run, active preset, SWE running/ready, Settings, citations, and log viewer with no axe violations or obvious overflow.
  Complexity: M

### P3

- [ ] P3 — Design a teacher-friendly guided scenario path
  Why: Comparable public education tools win by making complex models legible quickly; TsunamiSimulator has strong science but no structured lesson flow beyond the first-run tour.
  Evidence: README personas and "NukeMap for tsunamis" positioning; NOAA Science On a Sphere / Impact: Earth / NUKEMAP education patterns; `src/components/Tour.tsx`
  Touches: `src/components/Tour.tsx`, `src/components/PresetSelector.tsx`, `docs/manual/getting-started.md`, optional preset metadata
  Acceptance: Users can launch 3-5 guided scenarios that explain source choice, model limitations, expected readouts, and export/share next steps without adding new physics.
  Complexity: M

## Research-Driven Additions

### P1

- [ ] P1 - Sync shipped-science documentation against v0.4.4
  Why: Public docs still describe shipped Okada, GPU SWE, Lamb-wave coupling, and GEBCO work as planned or v0.3-era.
  Evidence: `README.md`; `data/bathymetry/README.md`; `src-tauri/src/presets.rs`; `src-tauri/Cargo.toml`; GeoClaw/NOAA disclaimer patterns
  Touches: `README.md`, `data/bathymetry/README.md`, `docs/science/*.md`, `src-tauri/src/presets.rs`, `src-tauri/Cargo.toml`
  Acceptance: Searches for stale "Okada planned", "wgpu planned", "GEBCO 2024", "planned for v0.3.0", and "per-PR CI" no longer contradict the shipped v0.4.4 behavior.
  Complexity: S

- [ ] P1 - Add unsigned-installer checksum verification guidance
  Why: v0.4.4 release assets are intentionally unsigned, so users need a clear trust path before running Windows installers.
  Evidence: GitHub v0.4.4 release notes; `README.md`; `docs/release/CODESIGNING.md`; Tauri distribution docs
  Touches: `README.md`, `docs/release/CODESIGNING.md`, release checklist/docs
  Acceptance: Install docs show where to find SHA256 values and exact Windows commands to verify MSI/NSIS downloads, while keeping code-signing as a blocked credential item.
  Complexity: S

### P2

- [ ] P2 - Add a manual dependency refresh cadence
  Why: Dependabot was removed, `npm outdated` already shows maintenance drift, and Rust advisory/license tools are optional skips when not installed.
  Evidence: `npm outdated --json`; `scripts/verify.mjs`; `package.json`; `src-tauri/deny.toml`; no `.github/dependabot.yml`
  Touches: `package.json`, `scripts/verify.mjs`, `CONTRIBUTING.md`, optional `scripts/deps-check.mjs`
  Acceptance: A local command reports npm outdated packages, Cargo update/audit/deny availability, and the maintainer docs define when to run and commit dependency refreshes without adding Dependabot.
  Complexity: S

- [ ] P2 - Add user-placed gauges with CSV time-series export
  Why: NOAA, GeoClaw, and Celeris workflows all make point time-series/gauges first-class outputs; TsunamiSimulator currently has DART sparklines and point inspect but no user-defined sampled series.
  Evidence: NOAA MOST output conventions; GeoClaw gauge/fgout docs; Celeris-WebGPU time-series plots; `src-tauri/src/commands.rs`; `src/components/SwePlayback.tsx`
  Touches: `src-tauri/src/commands.rs`, `src-tauri/src/physics/solver/*`, `src/lib/tauri.ts`, `src/components/SwePlayback.tsx`, export tests
  Acceptance: Users can place at least three named gauges, run SWE playback, view eta-vs-time plots, and export a CSV with gauge name, lat/lon, time_s, eta_m, solver mode, and bathymetry source.
  Complexity: L
