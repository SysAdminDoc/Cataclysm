# TsunamiSimulator Completed Work

This file summarizes shipped work. Release-level detail remains in
[`CHANGELOG.md`](CHANGELOG.md); open work remains in [`ROADMAP.md`](ROADMAP.md).

## Current Release

TsunamiSimulator is at **v0.4.0** on `main`.

## Shipped Product Surface

- Tauri 2 desktop app with React, TypeScript, Vite, CesiumJS, and a Rust physics
  backend.
- Interactive 3D globe with historical presets, custom source builder,
  scenario comparison, SWE playback, DART overlays, coastal runup bars, and
  screenshot/share-card exports.
- Rust source models for asteroid impacts, nuclear detonations, earthquakes,
  landslides, and atmospheric Lamb-wave sampling.
- CPU shallow-water solver with wet/dry handling, sponge boundaries, nonlinear
  advection, validation harnesses, and GPU `wgpu` dispatch behind a feature
  flag with CPU fallback.
- Science documentation under `docs/science/` with derivations, citations, and
  validation notes.
- Release workflow scaffolding for installers, code signing, updater manifests,
  and cross-platform packaging.

## Shipped Milestones

- **v0.0.1:** Tauri/React/Rust scaffold and physics modules.
- **v0.1.0:** Cesium globe, first scenario UI, presets, Settings, citations, and
  initial release workflows.
- **v0.2.0 - v0.2.1:** CPU SWE propagation, runup overlay, DART overlay,
  comparison mode, no-token globe styles, and blank-globe/hardening fixes.
- **v0.3.0:** validation harness, full Okada correction, MP4/WebM export,
  onboarding, inspection, inundation discs, accessibility, screenshots, and
  science/release scaffolding.
- **v0.4.0:** premium polish, GPU SWE dispatch loop, nonlinear advection,
  Lamb-wave coupling, DART RMSE IPC, Lituya validation, and branded share-card
  export.

## Verification Note

This consolidation is documentation-only. Build, test, validation, and release
evidence remains in [`CHANGELOG.md`](CHANGELOG.md), [`ROADMAP.md`](ROADMAP.md),
and [`docs/science/`](docs/science/).
