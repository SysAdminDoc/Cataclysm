# Asteroid impact tsunami

Source: [`src-tauri/src/physics/asteroid.rs`](../../src-tauri/src/physics/asteroid.rs).

## Initial displacement

Cavity radius from a vertical impact (Ward & Asphaug 2000 eq. 2,
calibrated against impact-cratering data and confirmed by Range et al.
2022 hydrocode runs):

```
R_c = C · D^(0.78) · v^(0.44) · g^(-0.22) · ρ_t^(-0.22) · ρ_i^(0.22)
```

with `C ≈ 1.88` (SI), `D` impactor diameter, `v` impact velocity, `g`
surface gravity, `ρ_t` target density (water = 1000 kg/m³), and `ρ_i`
impactor density.

The cavity is modelled as a paraboloid; ejected water rim height is
~`R_c / 12` per Ward & Asphaug Fig. 3. Energy release follows
`E = ½ m v²` with the asteroid's kinetic energy converted to crater
work + radiated wave energy + thermal + ejecta KE. Wave-coupling
efficiency for asteroid impacts is bracketed at 5–15% (Ward & Asphaug
2000 §3); we use 10% as the central estimate.

## Far-field amplitude

`r^(-5/6)` envelope (Ward & Asphaug 2000 eq. 11) — short-wavelength
frequency-dispersion decay faster than the long-wave `r^(-1/2)`
geometric spreading because impact wavelengths are short relative to
ocean depth. This is the model's primary uncertainty: real impacts
straddle the Boussinesq regime (`ω √(h/g) ≈ 0.3`) and the SWE
approximation under-represents dispersion. Phase 5 will add a
Boussinesq path (F4-10).

## Validation

- **Chicxulub @ 220 km**: model returns ≈ 1.5 km cavity. Range et al.
  2022 hydrocode reports 1.5 km peak η at 220 km from impact. Within
  OOM band (0.5–3.0 km). See [`VALIDATION.md`](VALIDATION.md) for the
  programmatic test.
- **Eltanin impact (2.5 Ma, ~1 km bolide)**: model far-field
  consistent with Hills & Goda 1998 reconstruction (~30 m at South
  American coast).

## Caveats

- Dispersion ignored at short wavelengths — `r^(-5/6)` decay
  partially compensates but a dispersive solver is the correct fix.
- Vertical-impact assumption; oblique impacts produce asymmetric
  cavities (Gisler et al. 2011).
- Atmospheric coupling (Lamb-wave precursor) modelled separately in
  [`lamb_wave.md`](lamb_wave.md); not currently summed into the
  asteroid IC.

## References

Ward & Asphaug 2000; Range et al. 2022; Collins, Melosh & Marcus
2005; Hills & Goda 1998. See [`REFERENCES.bib`](REFERENCES.bib).
