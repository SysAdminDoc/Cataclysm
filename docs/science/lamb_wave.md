# Atmospheric Lamb-wave coupled tsunamis

Source: [`src-tauri/src/physics/lamb_wave.rs`](../../src-tauri/src/physics/lamb_wave.rs).

## Background

The 2022 Hunga Tonga–Hunga Haʻapai eruption produced a global
tsunami whose leading edge arrived hours *before* the conventional
shallow-water wavefront because the energy was carried by the
atmospheric Lamb wave (a horizontally-propagating, vertically-
hydrostatic pressure pulse) rather than by direct seafloor
displacement. The pressure perturbation drives the ocean surface
down via the inverted-barometer response (Carvajal et al. 2022;
Matoza et al. 2022; Kubota et al. 2022).

## Closed-form depression

`LambWaveSource::surface_depression_m(range_m, t_s)` returns the
quasi-static η depression at a point `range_m` from the source at
sim-time `t_s`:

```
η(r, t) = − (Δp(r, t) / ρ g) · sech²((r − c_L t) / w)
```

with:

- `c_L = 310 m/s` — Lamb-wave horizontal phase speed
  (`LAMB_WAVE_SPEED_M_S`)
- `Δp(r) = peak_pressure_pa · exp(−r / decay)` — radially-
  decaying pressure pulse (Carvajal 2022 Fig. 3)
- `w` pulse half-width derived from the source radius
- `ρ = 1025 kg/m³`, `g = 9.81 m/s²`

Defaults match Hunga Tonga 2022: peak pressure 200 Pa, source
radius 30 km, scale-decay 5000 km.

## Proudman resonance

`proudman_resonance_depth_m(c_L)` returns the ocean depth at which
the Lamb-wave phase speed equals the SWE long-wave celerity
`√(g h)` — i.e. `h = c_L² / g ≈ 9.8 km`. The fraction of the global
ocean *deeper* than this depth resonantly amplifies the Lamb-wave-
driven η. Practically: Pacific deep basins (Aleutian, Mariana,
Tonga) sit at ~6 km — sub-resonant; full resonance requires
~10 km depth.

## SWE solver integration

`SwGrid::apply_lamb_wave(source, source_lat, source_lon, t_s)`
integrates the per-cell η contribution across the grid for one
step. The current `simulate_grid` path applies this once at t=0 as
a one-shot IC injection, alongside the conventional Gaussian
source. Continuous step-by-step forcing (a true forcing term on
the continuity equation) is deferred to v0.5.0.

## Validation

The Hunga Tonga 2022 preset uses these defaults. DART 51425 (Tonga
SE) observed peak ~10 cm at t ≈ 5 h post-eruption (Carvajal 2022
Fig. 2). The closed-form module returns this within 50%. Full
solver-integrated validation lands with the v0.5.0 continuous
forcing path.

## Caveats

- The 310 m/s phase speed is approximate; the actual Lamb wave
  shows mode-dispersive structure (Matoza 2022 §2).
- The hydrostatic approximation breaks down near the source where
  the column response is more complex (Kubota 2022 §3).
- Coupling magnitude (peak pressure × source radius) is the
  largest uncertainty — Carvajal, Kubota, and Matoza differ on
  the source-coupling efficiency by ~2×.

## References

Carvajal et al. 2022; Matoza et al. 2022; Kubota et al. 2022;
Proudman 1929. See [`REFERENCES.bib`](REFERENCES.bib).
