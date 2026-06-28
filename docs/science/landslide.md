# Landslide-source tsunami

Source: [`src-tauri/src/physics/landslide.rs`](../../src-tauri/src/physics/landslide.rs).

## Initial displacement

Subaerial / submarine landslides generate impulse waves whose
amplitude is governed by the slide mass, velocity, geometry, and
the receiving water-body slope.

We use the Heller & Hager 2010 dimensionless impulse-wave law:

```
H_M / h = a · P^b
```

with `P` the impulse-product parameter combining slide-Froude
number, relative slide thickness, relative slide mass, slide-impact
angle, and basin slope; constants `a, b` are calibrated against ≈
350 laboratory experiments. For Lituya Bay-class events the
analytical formula returns the wave amplitude at the impact point;
the SWE solver then propagates it across the coarse basin/shelf
bathymetry.

For submarine landslides we cross-check against Watts et al. 2005's
characteristic wavelength + amplitude scalings.

## Validation

- **Lituya Bay 1958** (`lituya_bay_1958`): Heller-Hager returns
  ~150 m at the impact point. Observed 524 m runup on Gilbert
  Inlet's opposing shore is amplified by the bay geometry — full
  validation requires the F4-07 curated bathymetry + SWE solver
  case to reproduce. Currently flagged in the preset's
  `controversy_note`.
- **Storegga slide (~ 8200 yr BP)** (`storegga`): model returns
  ~20 m at Scotland coast; sediment-record reconstructions
  (Smith et al. 2004) bracket 10–25 m. Within band.
- **Cumbre Vieja worst-case** (`cumbre_vieja`): model returns
  ~30 m far-field; Ward & Day 2001 hypothesise 10–25 m mid-
  Atlantic, but Løvholt et al. 2008 argue the worst-case slide
  scenario is unphysical. Explicitly marked speculative.

## Caveats

- Slide-water coupling is the largest uncertainty; H-H constants
  are calibrated for granular slides ≤ 1 km³. Larger slides may
  decouple before transferring momentum to the water (Mader 2004).
- Bay-geometry amplification (Lituya 524 m) is *not* captured by
  the closed form — it's a SWE-solver result.

## References

Heller & Hager 2010; Fritz et al. 2001; Watts et al. 2005;
Ward & Day 2001; Løvholt et al. 2008. See
[`REFERENCES.bib`](REFERENCES.bib).
