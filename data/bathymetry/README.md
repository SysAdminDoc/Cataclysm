# `data/bathymetry/` — bathymetric data placeholders

CesiumJS streams **Cesium World Bathymetry** (GEBCO 15-arcsec + higher-res
inserts) via the ion REST API at runtime — no local download required for the
3D-globe view. See `src/lib/cesium.ts`.

For **offline simulation** (the Rust SWE solver in v0.2.0+), we'll need local
bathymetry tiles. The plan:

1. Download GEBCO 2024 global ETOPO at 15-arc-second resolution: ~6 GB GeoTIFF
   from https://www.gebco.net/data_and_products/gridded_bathymetry_data/
2. Decimate to a regional bounding box around the active scenario (e.g., 2°
   buffer around the source + propagation horizon).
3. Cache the decimated tiles in `data/cache/` (gitignored).
4. Sample via `physics::data::bathymetry::sample(lat, lon)` in Rust.

**As of v0.2.0** the SWE solver supports two bathymetry sources:

- A coarse offline approximation (`src-tauri/src/data/bathymetry.rs`) that
  classifies points into seven ocean basins and applies a 5° continental-shelf
  taper. Selectable via the "coarse offline bathymetry" toggle in the
  SwePlayback panel.
- A uniform-depth fallback derived from the preset's water_depth_m.

The real GEBCO 2024 download wizard (per the plan below) lands in v0.3.0.

**Nothing in this directory is committed.** This README is the only tracked
file; everything else is gitignored.
