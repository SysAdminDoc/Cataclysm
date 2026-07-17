# Validation harness — TsunamiSimulator

The Rust modules under `src-tauri/src/physics/` are the source of truth
for every formula. This document captures **the quantitative comparison
against analytical benchmarks** required to substantiate the
project-level claim of "scientifically grounded" physics.

The harness lives at `src-tauri/src/physics/validation.rs` and is gated
behind the `validation` cargo feature so the local verification loop stays fast:

```bash
cd src-tauri
cargo test --release --features validation -- validation::
```

## Benchmarks

| Test | Reference | Acceptance | Currently |
|------|-----------|-----------|-----------|
| `stoker_wavefront_speed_matches_sqrt_gh` | Stoker 1957, *Water Waves*, §10.2 — wavefront propagates at `√(g·h)` over a uniform shallow channel | ±25 % on wave-front position after 5 minutes of simulated time on a 4 km uniform-depth basin | ✅ shipped |
| `synolakis_matches_carrier_greenspan_envelope` | Synolakis 1987, *J. Fluid Mech.* 185:523, Fig. 4 — `R = 2.831 √(cot β) H^(5/4) / d^(1/4)` matches Carrier-Greenspan 1958 analytical for `H/d < 0.78` | ±25 % over `H/d ∈ [0.005, 0.3]`, slope = 2°, depth = 50 m | ✅ shipped |
| `nthmp_bp1_single_wave_on_simple_beach_runup` | Synolakis 1987 *J. Fluid Mech.* 185:523 + NTHMP 2011 model-benchmarking workshop, BP1 — single wave on a 1:19.85 simple beach, canonical non-breaking `H/d = 0.0185` | Reproduces the Synolakis closed form (<2 %) **and** lands within ±18 % of the published laboratory run-up `R/d ≈ 0.0885` | ✅ shipped |
| `nthmp_bp4_nonbreaking_lab_runup_slice` | NTHMP BP4 `Lab_runup.txt` / Synolakis 1987 — seven non-breaking simple-beach measurements over `H/d = 0.005..0.019` | Predicted `R/d` remains within ±25 % of each laboratory value; rows above the benchmark's `H/d > 0.045` breaking threshold are explicitly excluded | ✅ shipped |
| `nuclear_airburst_radii_match_glasstone_dolan` + `nuclear_effects_ordering_and_cube_root_scaling` | Glasstone & Dolan 1977 *The Effects of Nuclear Weapons* 3rd ed., ch. III/VII — 1 Mt air-burst radii ≈ 2.7 km (20 psi), 6.9 km (5 psi), 21 km (1 psi), 12 km (3rd-degree burns); Hiroshima 15 kt ≈ 1.7 km (5 psi) | Direct-nuclear blast/thermal radii within ±30 % of the published values (the simplified single-coefficient scaling omits height-of-burst curves); overpressure rings nest and blast radius scales as `W^(1/3)` | ✅ shipped |
| `impact_crater_scaling_matches_collins_melosh_marcus` + `impact_crater_reproduces_meteor_crater_scale` + `impact_overpressure_and_wind_match_collins_melosh_marcus` | Collins, Melosh & Marcus 2005 *MAPS* 40:817-840 (Earth Impact Effects Program), eqns. 21/54-57; Meteor Crater observed ≈ 1.19 km | Asteroid crater Pi-scaling reproduces CMM 2005 to <1 % at 50 m / 500 m / 2 km impactors and grows monotonically; Meteor Crater analog lands in the [0.8, 2.0] km order-consistency band; overpressure falls with range and CMM peak-wind gives ≈ 72 m/s at 5 psi | ✅ shipped |
| `ward_asphaug_chicxulub_order_of_magnitude` | Range et al. 2022 *AGU Advances*, `doi:10.1029/2021AV000627`, Fig. 3 — 1.5 km ring-wave amplitude at r = 220 km | OOM only (50 m – 10 km): we use Ward-Asphaug analytical `r^(-5/6)` decay, Range used full Boussinesq SWE | ✅ shipped |
| `lituya_bay_runup_in_published_band` | Fritz, Hager & Minor 2001 *Sci. Tsunami Hazards* 19:3 — Lituya Bay 1958 524 m runup record | Synolakis closed-form on the confined-fjord geometry; band [100, 2000] m | shipped v0.4.0 (F4-07) |
| `dart_buoy_rmse_basic_math` + 3 edge cases | F4-06 — RMSE math correctness, time-bracket interpolation, out-of-range obs skip, location-bounds rejection | RMSE = 0 on identical series; offset-by-K → RMSE = K; interp midpoint; reject lat > 90° | shipped v0.4.0 |
| `swe_gpu_matches_cpu` | F4-01 — GPU vs CPU agreement on linear-SWE leapfrog over a 17×17 flat-ocean Gaussian | < 1e-3 m max-cell deviation after 50 leapfrog steps; silently no-ops on adapter-less runners | shipped v0.4.0 |
| `moving_pressure_source_reproduces_proudman_amplification` | NOAA NOS CO-OPS 079; NOAA/NWS Meteotsunami Guidelines (2020); Anarde et al. 2020 — moving pressure resonates as `U ≈ sqrt(gh)` | Full forced-SWE peak response at resonance exceeds both 0.25c and 2c runs by at least 15% in a uniform 100 m basin | ✅ shipped |
| `swe_gpu_matches_cpu_with_moving_pressure_forcing` | Shared host-side pressure gradient followed by equivalent CPU/GPU hydrodynamic steps | < 1e-3 m max-cell eta deviation after 12 forced steps; skips cleanly without an adapter | ✅ shipped |

## NTHMP benchmark coverage

The [NTHMP / NOAA model-benchmarking suite](https://github.com/rjleveque/nthmp-benchmark-problems)
is the community credibility bar for tsunami models. Cataclysm's solver is a
**non-dispersive, geographic-grid shallow-water code without adaptive mesh
refinement**, so only the analytically tractable slice of the suite is in reach:

| NTHMP problem | Type | Status here | Why |
|---------------|------|-------------|-----|
| **BP1** — single wave on a simple beach | 1-D analytical run-up | ✅ covered (`nthmp_bp1_single_wave_on_simple_beach_runup`) | Closed-form Carrier-Greenspan / Synolakis run-up; no dispersion or fine bathymetry needed |
| **BP4** — solitary wave on a simple beach | 1-D laboratory | ✅ bounded slice (`nthmp_bp4_nonbreaking_lab_runup_slice`) | Maximum run-up is checked for seven official non-breaking measurements; breaking cases and time-resolved profiles are not claimed |
| **BP6** — solitary wave on a conical island | 2-D laboratory | ⛔ full case out of reach | Requires laboratory-scale conical wet/dry geometry plus the specified time-dependent wave-paddle boundary before gauge and wrap-around comparisons are meaningful |
| **BP7** — Monai Valley complex beach | 2-D laboratory | ⛔ full case out of reach | Requires the 0.014 m tank DEM, time-dependent inlet boundary, reflective wall contract, and gauge/shoreline comparison harness |
| **BP9** — Okushiri Island field case | 2-D field | ⛔ full case out of reach | Requires nested source/bathymetry grids and field-comparison machinery; the official description itself warns that the legacy grids have material horizontal and vertical misalignment |

The numbering and limits above follow the primary NTHMP benchmark repository,
not older category-local numbering. BP6 and BP7 are not rejected merely because
the solver is non-dispersive: their immediate missing contracts are
laboratory-scale geometry, time-dependent boundary forcing, and comparison
fixtures. BP9 additionally needs a defensible nested-grid ingestion path. The
BP1 wet/dry smoke test remains qualitative; only the BP1 analytical point and
BP4 non-breaking laboratory rows support quantitative claims today.

## Future benchmarks

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
- Glasstone & Dolan is the canonical open reference for nuclear weapon
  effects; anchoring the direct-nuclear blast/thermal radii to its
  published 1 Mt and Hiroshima figures gives the nuclear mode the same
  cited, regression-locked credibility the tsunami benchmarks provide,
  and the cube-root scaling check guards the yield-dependence.

## Adding a new validation case

1. Pick a benchmark that exercises a code path not already covered.
2. Add a `#[test]` inside `physics::validation` keyed to the cargo
   feature. Cite the published reference in a doc comment.
3. Document the test + acceptance band here.
4. Verify locally with the command above before pushing.
