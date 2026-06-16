# How the Physics Works

TsunamiSimulator models three stages of a tsunami: generation (source), propagation (open ocean), and coastal interaction (runup). Each stage uses well-established formulas from peer-reviewed literature.

## Stage 1: Source generation

Each source type computes an **initial water-surface displacement** — the shape and size of the cavity or uplift that the event creates in the ocean surface.

- **Asteroid impacts** use the Ward & Asphaug 2000 scaling to compute cavity diameter and depth from impactor size, speed, and water depth. The cavity is parabolic with depth ≈ diameter / 2.83.
- **Nuclear detonations** use Glasstone & Dolan 1977 cavity radius scaling with Le Méhauté 1996 wave generation efficiency (~5% of total yield couples to water waves).
- **Earthquakes** use the Okada 1985 elastic half-space solution to compute vertical seafloor displacement from fault geometry (strike, dip, rake, slip, dimensions).
- **Landslides** use Fritz & Hager 2001 (subaerial) or Watts et al. 2005 (submarine) empirical scaling.

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

This is sampled at 60+ named coastal points worldwide, each with a calibrated beach slope from geomorphological surveys.

## What's accurate vs. approximate

| Aspect | Accuracy | Notes |
|---|---|---|
| Initial conditions | Good | Uses published analytical formulas |
| Deep-ocean propagation | Good | SWE is the standard operational model |
| Arrival times | Good | √(gH) phase speed is well-validated |
| Coastal runup | Approximate | Synolakis is analytical, not full wetting/drying |
| Near-coast behavior | Limited | No Boussinesq dispersion for short wavelengths |
| Atmospheric coupling | Partial | Lamb-wave forcing is one-way, no coupled model |

## Further reading

Full derivations and citations are in `docs/science/`. Each source module has its own note:
- `docs/science/asteroid.md` — Ward-Asphaug + Schmidt-Holsapple
- `docs/science/nuclear.md` — Glasstone-Dolan + Le Méhauté
- `docs/science/earthquake.md` — Okada 1985
- `docs/science/landslide.md` — Fritz-Hager + Slingerland-Voight
- `docs/science/shallow_water.md` — SWE solver details
- `docs/science/lamb_wave.md` — Hunga Tonga atmospheric coupling

## Disclaimer

This is an educational tool, not a forecast system. For real tsunami warnings, use [NOAA NTWC](https://tsunami.gov) or [PTWC](https://www.weather.gov/ptwc/).
