# IPC Command Reference

Tauri commands live in `src-tauri/src/commands.rs` or a focused backend module.
The frontend calls them via typed wrappers in `src/lib/tauri.ts`.

## Source Models

### `asteroid_initial_conditions`
Compute initial water displacement from an asteroid/comet ocean impact.
- **Input:** `AsteroidImpact` — `diameter_m`, `density_kg_m3`, `velocity_m_s`, `angle_deg` (0,90], `water_depth_m` [0,12000], `location` (GeoPoint)
- **Output:** `Result<InitialDisplacement, String>`
- **Validation:** all fields finite+positive; angle in (0,90]; water depth in [0,12000]; lat/lon in range

### `nuclear_initial_conditions`
Compute initial displacement from an underwater/surface nuclear detonation.
- **Input:** `NuclearBurst` — `yield_kt`, `burst_mode` (Surface|Shallow|DeepOptimal|Abyssal), `burst_depth_m`, `water_depth_m`, `location`
- **Output:** `Result<InitialDisplacement, String>`

### `earthquake_initial_conditions`
Compute Okada 1985 seafloor displacement from a fault dislocation.
- **Input:** `EarthquakeSource` — `mw`, `depth_m`, `strike_deg`, `dip_deg`, `rake_deg`, `slip_m`, `fault_length_m` (0=auto), `fault_width_m` (0=auto), `water_depth_m`, `location`
- **Output:** `Result<InitialDisplacement, String>`

### `landslide_initial_conditions`
Compute displacement from a subaerial or submarine landslide.
- **Input:** `LandslideSource` — `kind` (Subaerial|Submarine), `volume_m3`, `density_kg_m3`, `drop_height_m`, `slope_deg`, `water_depth_m`, `water_body_width_m`, `location`
- **Output:** `Result<InitialDisplacement, String>`

## Propagation & Analysis

### `far_field_amplitude`
Analytical far-field amplitude at a given range from the source.
- **Input:** `initial_amplitude_m`, `cavity_radius_m`, `range_m`, `mean_depth_m`, `decay_alpha`
- **Output:** `Result<{ amplitude_m, travel_time_s }, String>`

### `diagnostics_bundle`
PII-free support facts for the LogViewer "Copy diagnostics" button.
- **Input:** none
- **Output:** `{ app_version, os, arch, gpu_status, gpu_adapter?, solver }`

### `attenuation_curve`
Sampled far-field decay curve for the attenuation chart. Same amplitude
branch as `far_field_amplitude`; sampling starts at `max(cavity_radius, 1 km)`.
- **Input:** `initial_amplitude_m`, `cavity_radius_m`, `decay_alpha`, `max_range_m` (≤ 40 000 km), `n_samples` (2–2048)
- **Output:** `Result<Vec<{ range_m, amplitude_m }>, String>`

### `coastal_runup`
Synolakis 1987 closed-form runup at a single coastal point.
- **Input:** `offshore_amplitude_m`, `slope_rad`, `depth_m`
- **Output:** `Result<f64, String>`

### `runup_at_points`
Batch runup computation at validated bundled coastal points.
- **Input:** `RunupAtPointsRequest` — source params + stable `point_ids` (max 2000). Rust resolves numerical inputs and provenance from the bundled database; unknown and deep-water-reference IDs are rejected.
- **Output:** `Result<Vec<RunupAtPoint>, String>` — results include the slope/depth values, full independent provenance records, exact sample/record IDs, derived quantitative confidence/label, and runup/arrival/inundation fields.

### `inspect_at_point`
Click-to-inspect: amplitude, arrival, runup, model provenance, assumptions,
confidence, and explicit unknowns at an arbitrary globe coordinate.
- **Input:** `InspectAtPointRequest` — source params + click lat/lon + time_s
- **Output:** `Result<InspectAtPointResult, String>`

### `probe_direct_hazard`
Inspect a completed asteroid or nuclear result without rerunning its simulation.
Live direct results are held in a bounded 16-entry content-addressed registry.
- **Input:** `{ result_id, click_lat, click_lon }`
- **Output:** range, applicable displayed thresholds and modeled arrival times,
  governing model/citations, assumptions, screening confidence, and explicit
  unknowns. Outside all displayed thresholds is never reported as safe; fallout
  is excluded from radial inference because it requires wind-oriented plume data.

### `nuclear_shelter_advisor`
Return shelter screening for one registered immutable nuclear result without
rerunning the model or accepting client-supplied effect radii.
- **Input:** validated content-addressed `result_id`
- **Output:** six key-radius zones with modeled overpressure/thermal context and
  eight per-shelter screening scores, plus model identity and limitations.
- **Limits:** the source result must still be present in the bounded 16-result
  direct-hazard registry; asteroid and stale IDs fail closed.

### `asteroid_result_visuals`
Return bounded visualization data retained by one registered immutable asteroid
result without accepting browser-computed entry or crater values.
- **Input:** validated content-addressed `result_id`
- **Output:** up to 256 atmospheric trajectory samples plus optional final
  crater diameter, depth, rim height, and simple/complex classification.
- **Limits:** the source result must still be present in the bounded 16-result
  direct-hazard registry; nuclear and stale IDs fail closed.

### `jpl_api_request`
Perform one serialized NASA/JPL SSD request outside the WebView.
- **Input:** endpoint enum (`fireball`, `sbdb`, or `sentry`) plus the exact
  allowlisted parameter shape for that endpoint.
- **Output:** JSON only after its signature version matches Fireball 1.2, SBDB
  1.3, or Sentry 2.0.
- **Limits:** one request at a time; 5-second connect and 12-second total
  timeout; redirects denied; response capped at 1 MiB; unknown parameters fail
  before network access. The renderer CSP intentionally grants no JPL origin.

### `usgs_recent_earthquakes`
Fetch the fixed USGS ComCat significant-month GeoJSON feed through the desktop
backend.
- **Input:** none
- **Output:** generated timestamp, fixed source URL, and up to 32 validated
  magnitude-5+ earthquake summaries with product-availability flags
- **Limits:** serialized request; redirects denied; 5-second connect and
  15-second total timeout; 2 MiB response cap; the renderer has no direct USGS
  network authority

### `usgs_earthquake_detail`
Fetch one validated ComCat event and its preferred official products.
- **Input:** `{ eventId }`, restricted to 2–32 lowercase ASCII letters/digits;
  the backend constructs the fixed USGS detail URL
- **Output:** event metadata, optional complete Okada source mapping, optional
  PAGER summary, and optional bounded ShakeMap MMI contours
- **Mapping:** preferred finite-fault geometry is used when present; otherwise
  preferred moment-tensor nodal plane 1 plus Wells–Coppersmith dimensions and
  scalar-moment average slip are returned with explicit assumptions
- **Limits:** only an exact USGS PDL `download/cont_mmi.json` URL may be
  followed; redirects denied; detail/contour responses capped at 4/2 MiB;
  geometry capped at 512 contours and 24,000 points

### `lamb_wave_sample`
Atmospheric Lamb-wave properties at a given distance from source.
- **Input:** `LambWaveSampleRequest` — source params + receiver lat/lon
- **Output:** `Result<LambWaveSampleResult, String>` — `range_m, arrival_time_s, pressure_pa, surface_depression_m, proudman_resonance_depth_m, lamb_wave_speed_m_s`

## SWE Simulation

### `simulate_grid`
Run a full SWE simulation (batch — returns all snapshots at once). GPU-aware: dispatches to wgpu when `--features gpu` is compiled and an adapter exists.
- **Input:** `SimulateGridRequest` — source location, `initial_amplitude_m`, `source_sigma_m`, `mean_depth_m`, `use_real_bathymetry`, optional content-addressed `bathymetry_asset_id`, `box_half_size_deg` (0,60], `cells_per_deg` (0,200], `t_end_s` [0,86400], `n_snapshots` [2,240], `include_lamb_wave`, `colormap` (diverging|cividis|viridis)
- **Output:** `Result<SimulateGridResponse, String>` — `snapshots` (Vec of PNG-encoded GridSnapshot), `dt_s, nx, ny, used_gpu`, plus an optional opaque `scientific_export` descriptor or non-fatal `scientific_export_error`.
- **Limits:** 4M cells max; 50B cell-steps max; 1M leapfrog steps max
- **Local raster contract:** an asset ID requires `use_real_bathymetry=true`. The cached manifest and SHA-256 are revalidated; source axes are normalized and depths are bilinearly sampled at solver cell centres. Any uncovered or NoData cell rejects the run rather than mixing bathymetry sources.

### `simulate_grid_streaming`
Streaming variant — sends each snapshot via a Tauri Channel as it's computed. GPU-aware (same dispatch as `simulate_grid`).
- **Input:** same as `simulate_grid` + `on_snapshot: Channel<GridSnapshot>` and
  optional `resume_run_id` plus `checkpoint_interval_s` in [15,3600] (default
  60). Resume accepts only a retained checkpoint whose
  scenario/settings/data/solver digests, timestep, schedule prefix, grid,
  bathymetry, tick, and simulated time match the rebuilt run plan.
- **Output:** `Result<SimulateGridStreamMeta, String>` — `dt_s, nx, ny,
  used_gpu, n_snapshots`, an optional opaque scientific-export descriptor with
  CF-NetCDF and independently generated Zarr v3 availability/error metadata,
  plus authenticated pre-interruption gauge history for resumed
  chart/CSV continuity.

### `save_scientific_export`
Copy one retained solver artifact to a user-selected local `.nc` file or new
`.zarr` directory without
exposing its application-cache path or quantitative arrays to the WebView.
- **Input:** a 32-hex-character opaque export ID, `export_kind` (`netcdf` or
  `zarr`), and an absolute destination with the matching extension in an
  existing parent directory.
- **Output:** bytes copied.
- **Limits:** completed finite runs only; at most 1,000,000 grid cells, 96 MiB
  per artifact, 4,096 Zarr files, and four retained run products. IDs,
  extensions, parents, filenames, missing/stale artifacts, sizes, symbolic
  links, and existing Zarr destination directories fail closed.
- **Format:** NetCDF-3 Classic with CF-1.12 coordinates, final eta/velocity/
  depth fields, maximum/arrival products, WGS 84 mapping, mean-sea-level datum,
  units, citations, scenario SHA-256, solver backend, and quality JSON.
- **Zarr format:** Zarr 3.1 with named dimensions, chunked final eta/velocity/
  depth and maximum/arrival fields, CF-1.12-style coordinate and variable
  metadata, WGS 84 mapping, datum, scenario provenance, and quality JSON.

### `cancel_simulation`
Signal one owned simulation to stop. The solver polls its run-specific cancel
flag between accepted steps and snapshot batches.
- **Input:** validated `run_id`
- **Output:** `true` when an active run was signaled, otherwise `false`.

### `list_solver_checkpoints`
List bounded authenticated checkpoint metadata without exposing application-data
paths. Invalid or incompatible entries are quarantined rather than offered.
- **Input:** none
- **Output:** run/scenario identity, solver version, creation time, simulated
  progress, target time, and accepted step index for up to four retained runs.

### `remove_solver_checkpoint`
Remove one retained checkpoint by its validated run ID.
- **Input:** `run_id`
- **Output:** `true` when an entry was removed, otherwise `false`.

## Data & Diagnostics

### `preflight_bathymetry_import`
Read and validate one user-selected local scientific raster without modifying
the application cache.
- **Input:** path, optional NetCDF variable name, bounded source label and rights statement, and `depth_positive_down` or `elevation_positive_up` sample semantics.
- **Output:** format, filename, size, SHA-256, variable/band, dimensions, WGS 84 bounds/resolution, horizontal and vertical CRS, units, NoData, wet/dry/valid counts, depth range, and warnings.
- **Validation:** GeoTIFF requires an unrotated north-up EPSG:4326 grid plus EPSG:5714/5715 and metre vertical units; NetCDF requires regular one-dimensional CF latitude/longitude coordinates, metre units, matching `positive`, and an explicit mean-sea-level vertical datum. Files are capped at 512 MiB and 16,777,216 cells.

### `import_bathymetry`
Repeat strict preflight, verify the preview SHA-256, and atomically copy the
raster plus a provenance manifest into the application-owned offline cache.
- **Input:** the original preflight request and its `expected_sha256`.
- **Output:** schema version, stable content-addressed asset ID, import time, cache filename, and the complete preflight report.
- **Limits:** at most eight active imports and 2 GiB of declared raster bytes. The copied file is re-hashed before commit so a changed source is rejected.

### `list_imported_bathymetry`
List active cached rasters newest-first after validating each manifest and source size.
- **Input:** none.
- **Output:** `Vec<ImportedBathymetryAsset>`.

### `remove_imported_bathymetry` / `restore_imported_bathymetry`
Move one content-addressed raster and manifest between the active cache and an
application-owned trash directory without requiring network access.
- **Input:** validated `asset_id`.
- **Output:** remove returns no value; restore returns the recovered asset.
- **Safety:** partial two-file moves are rolled back, and restore re-applies active-cache quotas.

### `list_presets`
Return the full preset registry.
- **Input:** none
- **Output:** `Vec<Preset>` — each with `id, name, date, blurb, reference, source, is_speculative, controversy_note, camera_view`

### `run_preset`
Run a preset's source model + far-field propagation sampler.
- **Input:** `RunPresetRequest` — `preset_id`, `time_s`, `mean_depth_m` (0=auto), `n_samples` [2,2000]
- **Output:** `Result<RunPresetResponse, String>` — `initial, wavefront`

### `dart_buoy_rmse`
Compute RMSE between observed DART buoy data and model time series.
- **Input:** `DartRmseRequest` — `buoy_lat, buoy_lon, observations, model_samples`
- **Output:** `Result<DartRmseResult, String>` — `rmse_m, n_samples, observed_peak_m, model_peak_m`

### `gpu_probe`
Lightweight GPU availability check.
- **Input:** none
- **Output:** `String` — `"available"`, `"no-adapter"`, or `"feature-off"`
