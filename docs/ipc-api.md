# IPC Command Reference

Every Tauri command lives in `src-tauri/src/commands.rs`. The frontend calls them via typed wrappers in `src/lib/tauri.ts`.

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
Batch runup computation at multiple named coastal points.
- **Input:** `RunupAtPointsRequest` — source params + `points` (max 2000)
- **Output:** `Result<Vec<RunupAtPoint>, String>` — each with `id, name, lat, lon, range_m, offshore_amplitude_m, runup_m, arrival_time_s, has_arrived, inundation_extent_m`

### `inspect_at_point`
Click-to-inspect: amplitude, arrival, runup at an arbitrary globe coordinate.
- **Input:** `InspectAtPointRequest` — source params + click lat/lon + time_s
- **Output:** `Result<InspectAtPointResult, String>`

### `lamb_wave_sample`
Atmospheric Lamb-wave properties at a given distance from source.
- **Input:** `LambWaveSampleRequest` — source params + receiver lat/lon
- **Output:** `Result<LambWaveSampleResult, String>` — `range_m, arrival_time_s, pressure_pa, surface_depression_m, proudman_resonance_depth_m, lamb_wave_speed_m_s`

## SWE Simulation

### `simulate_grid`
Run a full SWE simulation (batch — returns all snapshots at once). GPU-aware: dispatches to wgpu when `--features gpu` is compiled and an adapter exists.
- **Input:** `SimulateGridRequest` — source location, `initial_amplitude_m`, `source_sigma_m`, `mean_depth_m`, `use_real_bathymetry`, `box_half_size_deg` (0,60], `cells_per_deg` (0,200], `t_end_s` [0,86400], `n_snapshots` [1,240], `include_lamb_wave`, `colormap` (diverging|cividis)
- **Output:** `Result<SimulateGridResponse, String>` — `snapshots` (Vec of PNG-encoded GridSnapshot), `dt_s, nx, ny, used_gpu`
- **Limits:** 4M cells max; 50B cell-steps max; 1M leapfrog steps max

### `simulate_grid_streaming`
Streaming variant — sends each snapshot via a Tauri Channel as it's computed. GPU-aware (same dispatch as `simulate_grid`).
- **Input:** same as `simulate_grid` + `on_snapshot: Channel<GridSnapshot>`
- **Output:** `Result<SimulateGridStreamMeta, String>` — `dt_s, nx, ny, used_gpu, n_snapshots`

### `cancel_simulation`
Signal all in-flight simulations to stop. The solver polls the cancel flag between snapshot batches.
- **Input:** none
- **Output:** none

## Data & Diagnostics

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
