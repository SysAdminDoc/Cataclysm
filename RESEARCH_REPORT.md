# TsunamiSimulator Research Report

This file is the current research synthesis. Historical plans are archived in
[`docs/history/`](docs/history/):

- [`RESEARCH_FEATURE_PLAN_v0.0.1.md`](docs/history/RESEARCH_FEATURE_PLAN_v0.0.1.md)
- [`RESEARCH_FEATURE_PLAN_v0.3.0.md`](docs/history/RESEARCH_FEATURE_PLAN_v0.3.0.md)
- [`RESEARCH_FEATURE_PLAN_v0.4.0.md`](docs/history/RESEARCH_FEATURE_PLAN_v0.4.0.md)

## Current Product Thesis

TsunamiSimulator should remain a scientifically grounded, interactive desktop
hazard-visualization tool: consumer-grade globe UX on top of transparent,
peer-reviewed tsunami source and propagation models. It is not an evacuation or
warning system; authoritative live warnings remain NOAA/PTWC/NTWC work.

## What The Research Concluded

- Real value comes from improving physical credibility and explanation, not from
  turning the app into a generic GIS suite.
- The Rust backend should remain the only place where physics is computed; the
  React/Cesium frontend should render backend snapshots and metadata.
- Phase 4 correctly prioritized GPU SWE, nonlinear terms, Lamb-wave coupling,
  validation, and release polish.
- The remaining high-value work is still concentrated in GEBCO bathymetry,
  Boussinesq/AMR fidelity, real flood polygons, signed distribution, updater
  activation, and user-facing documentation.

## Active Research Risks

- **Bathymetry distribution:** real GEBCO data needs a maintainer-owned hosting
  and packaging decision before the first-run download wizard can ship.
- **Solver fidelity:** Boussinesq dispersive terms and AMR are required for
  short-wavelength impact tsunami realism.
- **Validation:** additional Chicxulub, Tohoku, DART, and Lituya checks should
  stay tied to peer-reviewed references in `docs/science/REFERENCES.bib`.
- **Release trust:** code signing, macOS notarization, and updater signing are
  scaffolded but need maintainer credentials and key custody.
- **Communication:** the UI and docs must keep the education/hazard-awareness
  boundary explicit so users do not treat simulations as live warnings.

## Current Canonical Sources

- [`ROADMAP.md`](ROADMAP.md) - active delivery plan.
- [`COMPLETED.md`](COMPLETED.md) - shipped feature summary.
- [`CHANGELOG.md`](CHANGELOG.md) - release-level evidence.
- [`docs/science/`](docs/science/) - formula derivations, citations, and
  validation notes.
