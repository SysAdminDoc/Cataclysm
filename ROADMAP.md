# TsunamiSimulator Roadmap

Single source of truth for delivery. Blocked items live in
[`Roadmap_Blocked.md`](./Roadmap_Blocked.md). Shipped work is summarized in
[`CHANGELOG.md`](./CHANGELOG.md).

---

## Research-Driven Additions

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

### P3

- [ ] P3 — Design a teacher-friendly guided scenario path
  Why: Comparable public education tools win by making complex models legible quickly; TsunamiSimulator has strong science but no structured lesson flow beyond the first-run tour.
  Evidence: README personas and "NukeMap for tsunamis" positioning; NOAA Science On a Sphere / Impact: Earth / NUKEMAP education patterns; `src/components/Tour.tsx`
  Touches: `src/components/Tour.tsx`, `src/components/PresetSelector.tsx`, `docs/manual/getting-started.md`, optional preset metadata
  Acceptance: Users can launch 3-5 guided scenarios that explain source choice, model limitations, expected readouts, and export/share next steps without adding new physics.
  Complexity: M
