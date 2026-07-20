# How the Physics Works

Cataclysm models three stages of a tsunami: generation (source), propagation (open ocean), and coastal interaction (runup). Each stage uses well-established formulas from peer-reviewed literature.

## Stage 1: Source generation

Most source types compute an **initial water-surface displacement** — the shape and size of the cavity or uplift that the event creates in the ocean surface. Meteotsunamis instead force momentum continuously during the run.

- **Asteroid impacts** use the Ward & Asphaug 2000 scaling to compute cavity diameter and depth from impactor size, speed, and water depth. The cavity is parabolic with depth ≈ diameter / 2.83.
- **Nuclear detonations** use Glasstone & Dolan 1977 cavity radius scaling with Le Méhauté 1996 wave generation efficiency (~5% of total yield couples to water waves).
- **Earthquakes** use the Okada 1985 elastic half-space solution to compute vertical seafloor displacement from fault geometry (strike, dip, rake, slip, dimensions).
- **Landslides** use Fritz & Hager 2001 (subaerial) or Watts et al. 2005 (submarine) empirical scaling.
- **Meteotsunamis** apply `-(1/rho_w) grad(p_a)` at every SWE step for a translating Gaussian pressure anomaly; Proudman amplification occurs near `U = sqrt(gh)`.

### Large-impact aftermath

Crater-forming asteroid results add an event-stepped aftermath timeline. Its
seconds/minutes events provide order-of-magnitude seismic and land-ejecta
screening from Collins–Melosh–Marcus and Hanks–Kanamori. At Chicxulub-class
energy, the same scrubber continues through cited tens-of-minutes, days, months,
and years literature scenarios for reentry heating, atmospheric loading, impact
winter, productivity disruption, and climate recovery.

The Results panel and bottom scrubber stay synchronized. Select a phase to read
its confidence, limits, and sources. Climate phases are qualitative scenarios,
not direct outputs of a coupled climate model and never an extinction
probability. Airbursts and smaller impacts omit inapplicable phases.

## Stage 2: Propagation

The solver integrates the **shallow-water equations** (SWE) — the standard depth-averaged model used by NOAA, JMA, and other tsunami warning agencies:

```
∂η/∂t + ∂(Hu)/∂x + ∂(Hv)/∂y = 0          (continuity)
∂u/∂t + (u·∇)u + g ∂η/∂x = −friction      (x-momentum)
∂v/∂t + (u·∇)v + g ∂η/∂y = −friction      (y-momentum)
```

where:
- **η** is the water surface elevation (meters above mean sea level)
- **H = h + η** is the total water column depth
- **h** is the bathymetric depth (positive = below sea level)
- **u, v** are the depth-averaged velocities in the x and y directions
- **g** = 9.81 m/s² (gravitational acceleration)
- **friction** uses Manning's roughness formula: g n² |U| u / H^(4/3)

The solver uses:
- **Explicit leapfrog time-stepping** on a regular latitude-longitude grid
- **CFL-safe time step**: Δt < 0.4 × min(Δx, Δy) / max(√(gH)) ensures stability
- **Upwind advection** for the nonlinear (u·∇)u terms to handle wave steepening
- **Land masking**: cells shallower than 1 m are treated as dry land
- **Sponge boundary**: cosine-tapered damping at grid edges absorbs outgoing waves
- **GPU acceleration** via wgpu when a compatible adapter is available

## Stage 3: Coastal runup

The **Synolakis 1987** analytical runup law estimates maximum wave runup at the coast:

```
R = 2.831 × √(cot β) × H^(5/4) / d^(1/4)
```

where:
- **R** is the runup height (meters)
- **β** is the beach slope angle
- **H** is the offshore wave amplitude
- **d** is the offshore water depth

This is sampled at 79 named coastal points worldwide. Current beach slopes are legacy curated estimates and most offshore depths are nominal 50 m placeholders whose original per-point sample lineage was not retained. The app labels these runup values illustrative and low confidence, exposes uncertainty and exact provenance record IDs, and excludes three zero-slope deep-water reference gauges from the coastal calculation.

## What's accurate vs. approximate

| Aspect | Accuracy | Notes |
|---|---|---|
| Initial conditions | Good | Uses published analytical formulas |
| Deep-ocean propagation | Good | SWE is the standard operational model |
| Arrival times | Good | √(gH) phase speed is well-validated |
| Coastal runup | Approximate | Synolakis is analytical, not full wetting/drying |
| Near-coast behavior | Limited | No Boussinesq dispersion for short wavelengths |
| Atmospheric coupling | Partial | Moving pressure and Lamb-wave forcing are one-way; wind stress and coupled weather are excluded |
| Large-impact aftermath | Screening | Seismic/ejecta values are order-of-magnitude; climate phases are cited qualitative scenarios, not forecasts |

Browser builds use the same Rust source-model, analytical wavefront,
attenuation, arrival, and Synolakis-runup functions through the versioned
WebAssembly ABI in `src-tauri/wasm`. Only the browser's JavaScript SWE
frame/gauge playback remains an illustrative approximation; its screenshots and
share cards carry the explicit `BROWSER SWE PLAYBACK — APPROXIMATE` watermark.

## Further reading

Full derivations and citations are in `docs/science/`. Each source module has its own note:
- `docs/science/asteroid.md` — Ward-Asphaug + Schmidt-Holsapple
- `docs/science/nuclear.md` — Glasstone-Dolan + Le Méhauté
- `docs/science/earthquake.md` — Okada 1985
- `docs/science/landslide.md` — Fritz-Hager + Slingerland-Voight
- `docs/science/shallow_water.md` — SWE solver details
- `docs/science/lamb_wave.md` — Hunga Tonga atmospheric coupling
- `docs/science/meteotsunami.md` — moving pressure forcing and Proudman resonance

## Disclaimer

This is an educational tool, not a forecast system. For real tsunami warnings, use [NOAA NTWC](https://tsunami.gov) or [PTWC](https://www.weather.gov/ptwc/).
