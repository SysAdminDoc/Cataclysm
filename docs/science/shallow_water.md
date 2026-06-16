# Shallow-water propagation and runup

Sources: [`src-tauri/src/physics/shallow_water.rs`](../../src-tauri/src/physics/shallow_water.rs)
and [`src-tauri/src/physics/solver/`](../../src-tauri/src/physics/solver/).

## Linear long-wave celerity

`c = √(g h)` — the leading-order wave speed for `λ » h`. Used by:

- `sample_wavefront` — analytical envelope sampler emitting time-of-
  arrival rings at user-selected times.
- `long_wave_travel_time_s` — arrival time at a receiver from a
  great-circle distance, via numerical integration of `dt = ds / c(s)`
  along the geodesic.

## Runup

Synolakis 1987 normalised solitary-wave runup law:

```
R / h_0 = 2.831 · √(cot β) · (H / h_0)^(5/4)
```

`H` offshore wave height, `h_0` offshore depth, `β` beach slope.
Captures the canonical narrow-band amplification of an incoming
soliton up a sloping beach. Implementation: NaN-safe; out-of-band
inputs return `None` rather than blowing up.

## Numerical solver

`solver::TimeStepper` runs a forward-Euler leapfrog discretisation
of the depth-averaged shallow-water equations on a regular lat-lon
grid (Mader 1988; Kowalik & Murty 1993):

```
∂η/∂t + ∂(H u)/∂x + ∂(H v)/∂y = 0
∂u/∂t + (u·∇)u + g ∂η/∂x = − g n² |U| u / H^(4/3)
∂v/∂t + (u·∇)v + g ∂η/∂y = − g n² |U| v / H^(4/3)
```

- `SolverMode::Linear` drops the `(u·∇)u` advection term — used by
  the analytical Stoker validation case.
- `SolverMode::Nonlinear` (default for live simulations as of
  v0.4.0) keeps the upwind-differenced advection so waves steepen
  near the coast.
- Wet/dry handling via `LAND_DEPTH_THRESHOLD_M = 1.01`. Land cells
  are pinned to η = 0 and act as reflective walls.
- `BoundaryMode::Sponge` (default) cosine-tapers the rim cells so
  outgoing waves don't reflect back into the source.
- CPU path: row-parallel via `rayon::par_chunks_mut`.
- GPU path: behind `--features gpu`; same WGSL leapfrog kernel
  (currently linear-SWE only; F4-02 advection branch deferred).

## Validation

See [`VALIDATION.md`](VALIDATION.md). Three quantitative cases:
Stoker dam-break, Carrier-Greenspan plane-beach runup, Range 2022
Chicxulub OOM. Lituya / Tōhoku DART cases shipped as F4-06/F4-07.

## Caveats

- Linear long-wave celerity fails for `ω √(h/g) > 0.3` — true for
  short-wavelength asteroid impacts. Phase 5 Boussinesq path
  (F4-10) addresses this.
- Manning's `n` is hard-coded to a coastal default
  (`MANNING_N_COASTAL`); regional bottom-roughness variation is
  not modelled.

## References

Synolakis 1987; Mader 1988; Kowalik & Murty 1993; Carrier &
Greenspan 1958; Stoker 1957. See [`REFERENCES.bib`](REFERENCES.bib).
