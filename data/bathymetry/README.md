# `data/bathymetry/` — bathymetric data placeholders

CesiumJS streams **Cesium World Bathymetry** (GEBCO 15-arcsec + higher-res
inserts) via the ion REST API at runtime — no local download required for the
3D-globe view. See `src/lib/cesium.ts`.

For **offline simulation** (the Rust SWE solver in v0.2.0+), production-grade
bathymetry still requires local terrain tiles. The current target is
GEBCO_2026, published April 23, 2026, because it includes the 15-arc-second
global terrain grid plus a Type Identifier (TID) grid that can expose source
confidence per cell.

The future local-data path:

1. Download GEBCO_2026 global grid data at 15-arc-second resolution from
   https://www.gebco.net/data-products/gridded-bathymetry-data
   along with the matching TID grid.
2. Decimate to a regional bounding box around the active scenario (e.g., 2°
   buffer around the source + propagation horizon).
3. Cache the decimated tiles in `data/cache/` (gitignored).
4. Sample via `physics::data::bathymetry::sample(lat, lon)` in Rust.
5. Surface TID-derived confidence in the UI and exported provenance before
   showing any output as GEBCO-backed.

**As of v0.2.0** the SWE solver supports two bathymetry sources:

- A low-confidence coarse offline approximation
  (`src-tauri/src/data/bathymetry.rs`) that
  classifies points into seven ocean basins and applies a 5° continental-shelf
  taper. Selectable via the "coarse basin/shelf bathymetry" toggle in the
  SwePlayback panel. This is not GEBCO_2026-backed bathymetry.
- A uniform-depth fallback derived from the preset's water_depth_m.

The GEBCO_2026/TID-backed loader remains a blocked delivery item until the
distribution, storage, cache invalidation, and first-run download decisions are
resolved.

**Nothing in this directory is committed.** This README is the only tracked
file; everything else is gitignored.
