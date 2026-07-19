# Nuclear-detonation tsunami

Source: [`src-tauri/src/physics/nuclear.rs`](../../src-tauri/src/physics/nuclear.rs).

## Initial displacement

Underwater burst cavity radius (Le Méhauté & Wang 1996, with
Glasstone & Dolan 1977 yield-scaling):

```
R_c ≈ k · Y^(1/3) · (h_b / Y^(1/3))^(α)
```

`Y` in kilotons; `k`, `α` depend on burst regime:

- **Shallow burst** (`h_b / Y^(1/3) < 0.5`): water-jet ejecta
  dominates; α ≈ 0.0; k ≈ 35 m / kt^(1/3).
- **Deep burst** (`h_b / Y^(1/3) > 1.5`): contained bubble pulse,
  steam vent collapses back into the cavity before wave emerges;
  α ≈ -0.5.

Wave-coupling efficiency η_wave for underwater nuclear is bracketed
DNA-TR-96-77 §4 at 0.1–4 %, single largest source of uncertainty in
the preset. Default: 1 %.

## Far-field amplitude

Linear long-wave geometric spreading `η(r) = η_0 · √(R_c / r)` —
nuclear initial cavity is ~10–100 m wide, long-wavelength regime,
so `r^(-1/2)` dominates (vs. the `r^(-5/6)` of asteroid impacts).

## Direct-effects casualty screens

Direct nuclear results return two Rust-authoritative immediate-casualty
screens over the same idealized, uniform population field:

- **Combined effects** combines independent blast, thermal-burn, and prompt-
  radiation screening probabilities in sorted effect annuli.
- **Blast-pressure proxy** applies DCPA/OTA-style mortality and injury
  fractions to overpressure bands and excludes thermal and prompt-radiation
  contributions.

The UI can switch between the returned estimates without recomputing physics
and shows their min/max disagreement. Both retain fixed indoor/outdoor
occupancy and urban-shielding assumptions and exclude fallout, fire spread,
evacuation, medical response, terrain, and building-specific vulnerability.
They are order-of-magnitude educational comparisons, not statistical
confidence intervals or protective guidance.

## Validation

- **Operation Crossroads Baker (1946, 21 kt at 27 m)**: model
  returns peak rim ≈ 28 m vs observed ~28 m base surge (US Navy
  technical report). Within ±50%.
- **Bikini Castle Bravo (1954, 15 Mt surface)**: model returns
  ~7 m at 1 km vs observed ~2 m (poorly coupled — air burst,
  Glasstone & Dolan §6.42). The over-prediction is intentional:
  surface bursts are bracketed as a special case in the code with
  a 10× efficiency penalty applied to η_wave.

## Caveats

- The Poseidon-class preset (Hambling 2022) uses an order-of-
  magnitude extrapolation beyond DNA-TR-96-77's tested band
  (≤ 50 kt). The 100 Mt "propaganda" variant is explicitly framed
  as speculative and carries a `controversy_note`.
- The underwater-source equations in this document remain hydrodynamic. Direct
  fallout, blast, thermal, radiation, and casualty products are separate
  screening models and do not feed back into the tsunami solver.

## References

Glasstone & Dolan 1977; DCPA 1973 / OTA 1979 casualty proxy (as documented by
NUKEMAP); Le Méhauté & Wang 1996; Defense Nuclear Agency DNA-TR-96-77 1996;
Hambling 2022 (Forbes). See
[`REFERENCES.bib`](REFERENCES.bib).
