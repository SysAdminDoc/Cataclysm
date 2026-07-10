# Earthquake-source tsunami

Sources: [`src-tauri/src/physics/earthquake.rs`](../../src-tauri/src/physics/earthquake.rs)
and [`src-tauri/src/physics/okada.rs`](../../src-tauri/src/physics/okada.rs).

## Initial displacement

The tsunamigenic source is the static vertical seafloor deformation
above a finite rectangular fault. Two paths:

1. **Leading-order parametric** (`EarthquakeSource::initial_displacement`)
   — `peak_uplift_m ≈ f(M_w, slip_m, dip_rad)` scaled to match
   observed peak uplift for the four modern presets. Used by the
   preset registry's `peak_uplift_m` field.

2. **Full Okada 1985 closed form** (`OkadaFault::vertical_displacement_field`)
   — the complete half-space solution with the I-term Poisson-ratio
   correction. Returns the per-cell vertical displacement field over
   a grid; the centre value is surfaced today but the full grid is
   available for a future "show seafloor uplift map" overlay.

The I-term limits (`cos δ → 0` for vertical-dip and dip-slip-only
faults) are handled explicitly with the alternate closed form rather
than letting the divisor approach zero (a frequent source of bugs in
3rd-party Okada ports).

### 2026-07-09 kernel correction

Property-based testing exposed non-physical growth of the strike-slip
vertical displacement with fault length. Three defects were fixed
against the reference implementation (Beauducel's `okada85.m`,
IPGP/deformation-lib) and Okada 1985 Table 2:

1. The eqn.-25 strike-slip u_z used `tan⁻¹(ξη/qR)` where
   `q·sinδ/(R+η)` belongs (the arctangent term appears in the
   strike-slip u_x and the dip-slip u_z, not here).
2. The I4/I5 elastic factor used DC3D's `α = (λ+μ)/(λ+2μ) = 2/3`;
   Okada 1985's I-terms take `μ/(λ+μ) = 1 − 2ν = 0.5` for ν = 0.25.
3. The Chinnery substitution used the fault-top depth where Okada's
   `d` is the depth of the DOWN-DIP (bottom) edge.

The kernel now reproduces Okada 1985 Table 2 cases 2 and 3
(strike-slip, dip-slip, tensile) to 4 significant figures — see
`table2_case2_uz_matches_paper` / `table2_case3_vertical_fault_uz_matches_paper`
in `okada.rs`. Note the arctangent is the single-branch `atan`, not
`atan2`: the extra half-turns of `atan2` break the four-corner
Chinnery telescoping.

## Validation

- **Tōhoku 2011 M9.0** (`tohoku_2011`): Okada returns 6 m vertical
  uplift at the trench, peak runup at Miyako ≈ 40 m. Fujii & Satake
  2013 report 5–9 m at the trench from joint tsunami-waveform +
  GPS inversion — within band.
- **Sumatra 2004 M9.1** (`indian_ocean_2004`): Okada returns 4 m
  uplift, peak runup at Banda Aceh ≈ 30 m. Chlieh et al. 2007
  report 4–6 m. Within band.

Both validation cases were initially `#[ignore]`-flagged because the
leading-order form over-predicted by ~10×; the full Okada I-term
correction unblocked them.

## Caveats

- Static deformation only — kinematic rupture propagation (the
  rupture velocity finite-source kinematics that match observed
  DART arrival times to ±30 s) is deferred.
- Aftershock cascade not modelled — see F4-08 (multi-event scenarios).
- Earthquake-induced submarine landslide tsunamis (e.g. PNG 1998)
  are scoped under the landslide path, not here.

## References

Okada 1985 *BSSA* 75:1135; Fujii & Satake 2013; Chlieh et al. 2007;
Aki & Richards 2002 *Quantitative Seismology* §11. See
[`REFERENCES.bib`](REFERENCES.bib).
