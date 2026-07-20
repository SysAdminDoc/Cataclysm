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
- **Direct impact effects (crater / overpressure / wind)**: the
  `direct_hazard.rs` Collins–Melosh–Marcus 2005 crater Pi-scaling is
  locked to the CMM 2005 equations to <1% across 50 m–2 km impactors
  with a Meteor Crater (~1.2 km) order-of-magnitude anchor, and the CMM
  blast-overpressure fit and Rankine-Hugoniot peak-wind relation
  (≈72 m/s at 5 psi) are checked. Svetsov et al. 2025 corroborates the
  same 20 m–3 km range; a full cross-check against its data tables is
  tracked in `Roadmap_Blocked.md`. See [`VALIDATION.md`](VALIDATION.md).

## Crater-forming impact aftermath

The direct-impact result carries an authoritative Rust-authored secondary-effects
timeline when an impact reaches the ground and forms a crater. Airbursts omit the
timeline. Regional crater-forming impacts receive two quantitative screening
events:

- **Equivalent seismic magnitude** uses the Collins–Melosh–Marcus impact-energy
  coupling and the Hanks–Kanamori moment-magnitude scale. It is an energy-scale
  comparison, not a prediction of fault rupture, shaking duration, or local
  Mercalli intensity.
- **Ballistic ejecta thickness** is reported for land targets at five final-crater
  radii. The idealized radial blanket follows Collins et al. 2005:

  ```text
  t_rim = 0.14 R_c (R_c / D_final)^0.74
  t(r)  = t_rim (r / R_c)^-3
  ```

  where `R_c = D_final / 2`. The displayed arrival is a simple ballistic
  timescale. Water targets omit this land-ejecta estimate.

Impacts with effective ground-coupled energy at or above `1 × 10^23 J` also
receive a **Chicxulub-class literature screen** across tens of minutes, days,
months, and years: spatially uneven ejecta-reentry heating, global aerosol
loading, impact-winter/productivity disruption, and a long climate-recovery
tail. These entries intentionally remain qualitative. Morgan et al. 2013,
Senel et al. 2023, and Bralower et al. 2022 do not support deriving a universal
fire fraction, temperature curve, extinction probability, or recovery date
from impact energy alone.

Every timeline event embeds its citations, confidence class, and an explicit
uncertainty statement in the result contract. GeoJSON/CZML exports preserve the
same `secondary_effects` object for audit and replay.

## Caveats

- Dispersion ignored at short wavelengths — `r^(-5/6)` decay
  partially compensates but a dispersive solver is the correct fix.
- Vertical-impact assumption; oblique impacts produce asymmetric
  cavities (Gisler et al. 2011).
- Atmospheric coupling (Lamb-wave precursor) modelled separately in
  [`lamb_wave.md`](lamb_wave.md); not currently summed into the
  asteroid IC.
- Long-term events are staged literature scenarios, not a coupled
  atmosphere–ocean–ecosystem simulation. The `1 × 10^23 J` gate is a
  conservative product-screening threshold rather than an extinction boundary.

## References

Ward & Asphaug 2000; Range et al. 2022; Collins, Melosh & Marcus
2005; Hanks & Kanamori 1979; Morgan et al. 2013; Senel et al. 2023;
Bralower et al. 2022; Hills & Goda 1998. See
[`REFERENCES.bib`](REFERENCES.bib).
