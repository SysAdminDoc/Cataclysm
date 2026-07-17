# Moving-pressure meteotsunami source

Source: [`src-tauri/src/physics/meteotsunami.rs`](../../src-tauri/src/physics/meteotsunami.rs)

Cataclysm represents a fast-moving weather disturbance as an oriented
two-dimensional Gaussian surface-pressure anomaly. Its centre translates at a
constant speed and heading along a finite track. Unlike earthquake, impact,
explosion, and landslide sources, it does not inject a displaced-water field at
time zero. The solver starts flat and applies the atmospheric pressure gradient
to depth-averaged velocity at every accepted CPU or GPU step:

```text
du/dt = -(1/rho_w) dp_a/dx
dv/dt = -(1/rho_w) dp_a/dy
```

The GPU path re-uploads the host-side forced fields before each compute step,
so CPU and GPU consume the same source array and the pressure mathematics is
not duplicated in WGSL.

## Proudman resonance

Maximum sustained energy transfer occurs as the disturbance speed `U` matches
the long-wave celerity:

```text
U ≈ c = sqrt(g h)
```

The validation harness moves the same 300 Pa pressure footprint across a
uniform 100 m basin at resonant, strongly subcritical, and strongly
supercritical speeds. The resonant run must produce at least 15% more peak
surface response than either off-resonance run. This regression checks the
complete pressure-gradient plus SWE path rather than an analytical resonance
factor.

## Lake Superior 2025 preset

The `lake_superior_meteotsunami_2025` preset is an educational pressure-only
reconstruction of the 2025-06-21 event reported by NOAA GLERL. GLERL measured a
19.3 inch meteotsunami rise at Point Iroquois before the later wind-driven surge
and 45.4 inch seiche rebound. The preset's 300 Pa Gaussian and 39 m/s west-to-
east track are representative parameters inferred from the reported crossing,
not an HRRR-driven or NOAA-calibrated hindcast. The bundled inland-water
bathymetry is only a nominal 50 m, so the UI starts this preset on its declared
155 m uniform validation depth unless the user selects imported bathymetry.

## Scope and limitations

- Pressure is a prescribed Gaussian, not a weather-model field.
- Speed and heading are constant; the track is straight and finite.
- Wind stress, Coriolis forcing, precipitation, harbor resonance, and the later
  basin seiche are excluded.
- The analytical radial wavefront is disabled for this source; quantitative
  propagation comes from the forced SWE run.
- Browser source readouts use the shared Rust module, but browser SWE playback
  remains explicitly approximate.
- Run quality retains finite-field, depth, CFL, and mass checks, while energy
  conservation drift is explicitly marked not applicable because the
  prescribed atmosphere performs external work on the water column.

## References

- NOAA GLERL (2025), [June 21, 2025 Storm Causes Significant Meteotsunami and
  Seiche on Lake Superior](https://www.glerl.noaa.gov/blog/2025/07/18/june-21-2025-storm-causes-significant-meteotsunami-and-seiche-on-lake-superior/).
- NOAA/NWS (2020), *Meteotsunami Guidelines and Best Practices*.
- NOAA NOS CO-OPS 079, *Meteotsunamis: State of the Science*.
- Anarde et al. (2020), *JGR Oceans*, doi:10.1029/2020JC016347.
