# Validation harness — TsunamiSimulator

The Rust modules under `src-tauri/src/physics/` are the source of truth
for every formula. This document captures **the quantitative comparison
against analytical benchmarks** required to substantiate the
project-level claim of "scientifically grounded" physics.

The harness lives at `src-tauri/src/physics/validation.rs` and is gated
behind the `validation` cargo feature so the per-PR CI loop stays fast:

```bash
cd src-tauri
cargo test --release --features validation -- validation::
```

## Benchmarks

| Test | Reference | Acceptance | Currently |
|------|-----------|-----------|-----------|
| `stoker_wavefront_speed_matches_sqrt_gh` | Stoker 1957, *Water Waves*, §10.2 — wavefront propagates at `√(g·h)` over a uniform shallow channel | ±25 % on wave-front position after 5 minutes of simulated time on a 4 km uniform-depth basin | shipped v0.3.0 |
| `synolakis_matches_carrier_greenspan_envelope` | Synolakis 1987, *J. Fluid Mech.* 185:523, Fig. 4 — `R = 2.831 √(cot β) H^(5/4) / d^(1/4)` matches Carrier-Greenspan 1958 analytical for `H/d < 0.78` | ±25 % over `H/d ∈ [0.005, 0.3]`, slope = 2°, depth = 50 m | shipped v0.3.0 |
| `ward_asphaug_chicxulub_order_of_magnitude` | Range et al. 2022 *AGU Advances*, `doi:10.1029/2021AV000627`, Fig. 3 — 1.5 km ring-wave amplitude at r = 220 km | OOM only (50 m – 10 km): we use Ward-Asphaug analytical `r^(-5/6)` decay, Range used full Boussinesq SWE | shipped v0.3.0 |
| `lituya_bay_runup_in_published_band` | Fritz, Hager & Minor 2001 *Sci. Tsunami Hazards* 19:3 — Lituya Bay 1958 524 m runup record | Synolakis closed-form on the confined-fjord geometry; band [100, 2000] m | shipped v0.4.0 (F4-07) |
| `dart_buoy_rmse_basic_math` + 3 edge cases | F4-06 — RMSE math correctness, time-bracket interpolation, out-of-range obs skip, location-bounds rejection | RMSE = 0 on identical series; offset-by-K → RMSE = K; interp midpoint; reject lat > 90° | shipped v0.4.0 |
| `swe_gpu_matches_cpu` | F4-01 — GPU vs CPU agreement on linear-SWE leapfrog over a 17×17 flat-ocean Gaussian | < 1e-3 m max-cell deviation after 50 leapfrog steps; silently no-ops on adapter-less runners | shipped v0.4.0 |

## Future benchmarks (deferred to v0.4.0+)

- **Carrier-Greenspan plane-beach inundation length** vs. SWE wet/dry
  solver output at the named coastal points. Requires F-V06 real GEBCO.
- **Range 2022 Chicxulub North-Atlantic coastline** runup map vs.
  Synolakis sampling at the 60+ named coastal points. Requires F-V06.
- **Tohoku 2011 DART buoy timeseries display** RMSE vs. observed at
  21413, 21418, 51407. The bundled DART time series already exists in
  `src/data/dart_buoys.json` and the `dart_buoy_rmse` IPC + math are
  shipped (see F4-06 entry above). What remains is the frontend
  integration — SWE PNG decode → bilinear-spatial sample at each buoy
  lat/lon over the snapshot sequence → call the IPC → render RMSE
  alongside each sparkline in `DartOverlay.tsx`.

## Why these particular tests?

- Stoker is the canonical 1D SWE analytical and the cheapest way to
  catch a continuity- or momentum-sign bug in the leapfrog kernel.
- Carrier-Greenspan is the canonical runup analytical and the cheapest
  way to catch a Synolakis-formula bug — the two should agree exactly
  by construction.
- Range 2022 is the published peer-reviewed Chicxulub simulation that
  the project's marketing claim references; the OOM check is a sanity
  guard against a wildly wrong cavity-rim formula.

## Adding a new validation case

1. Pick a benchmark that exercises a code path not already covered.
2. Add a `#[test]` inside `physics::validation` keyed to the cargo
   feature. Cite the published reference in a doc comment.
3. Document the test + acceptance band here.
4. Verify locally with the command above before pushing.
