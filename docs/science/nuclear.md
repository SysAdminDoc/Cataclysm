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
- No fallout / blast-wave / thermal-radiation modelling — the
  simulator is hydrodynamic only.

## References

Glasstone & Dolan 1977; Le Méhauté & Wang 1996; Defense Nuclear
Agency DNA-TR-96-77 1996; Hambling 2022 (Forbes). See
[`REFERENCES.bib`](REFERENCES.bib).
