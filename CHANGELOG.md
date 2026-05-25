# Changelog

All notable changes to TsunamiSimulator. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned for v0.1.0
- Cesium globe rendering with GEBCO bathymetry working end-to-end
- One full preset (Chicxulub) playing back with animated wavefront isolines on the globe
- Working scenario builder UI: click globe → dial in impactor → see initial wave amplitude readout

### Planned for v0.2.0
- Linear long-wave propagation solver running on a regular lat-lon grid in Rust (CPU first, `rayon` parallel)
- Synolakis runup at coastal points along the wavefront
- All ten v1.0 presets functional

### Planned for v0.3.0
- Nonlinear shallow-water equations (NSWE) with friction
- `wgpu` GPU compute path for the SWE solver

### Planned for v1.0.0
- Boussinesq dispersive solver for impact-tsunami short wavelengths
- Adaptive mesh refinement (coarse far-field, fine coastal)
- Inundation polygon overlays on the globe
- Signed Windows installer + macOS .dmg + Linux AppImage

---

## [0.0.1] - 2026-05-24 — Scaffold

### Added
- Project scaffold: Tauri 2 + React 19 + TypeScript + Vite + Rust backend.
- `LICENSE` (MIT), `.gitignore` (Node + Rust + Tauri + AI agent excludes), `README.md` with full architecture and citation list, this `CHANGELOG.md`, `ROADMAP.md` with phased delivery plan, `docs/science/` reference scaffolding.
- Rust physics modules with real formulas already encoded (not stubs):
  - `physics::asteroid` — Ward & Asphaug 2000 + Schmidt & Holsapple 1982 cavity scaling, far-field amplitude attenuation `(R_c/r)^(5/6)`.
  - `physics::nuclear` — Glasstone & Dolan 1977 cavity radius, Le Méhauté 1996 wave generation, 5% energy efficiency factor from DNA 1996.
  - `physics::landslide` — Fritz & Hager 2001 Lituya scaling, slide kinetic energy → impact wave height.
  - `physics::earthquake` — Okada 1985 fault dislocation stub.
  - `physics::shallow_water` — linear long-wave dispersion relation, Synolakis 1987 runup law, NSWE solver scaffold.
  - `physics::constants` — gravity, water/rock densities, Earth radius, TNT energy density, all named with units.
- `presets.rs` registry — Chicxulub, Tōhoku 2011, Indian Ocean 2004, Lituya Bay 1958, Krakatoa 1883, Storegga, Hunga Tonga 2022, Eltanin, Cumbre Vieja scenario, Poseidon (realistic + propaganda).
- React frontend scaffold with CesiumJS integration, dark Catppuccin Mocha theme, scenario builder, preset selector, results panel.
- Type-safe Tauri command bindings via `tauri::invoke` + `serde`.

### Notes
- Cesium ion access token is **required** for streaming bathymetry — free tier is sufficient. Set `VITE_CESIUM_TOKEN` in `.env`.
- This release is a **scaffold**: physics formulas are encoded and produce numerically correct values for individual source models, but the propagating wave-on-globe animation is not yet wired (planned for v0.1.0).
- No tests yet (per author's `no tests unless explicitly requested` rule).
