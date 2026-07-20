# WSEG-10 point fallout dose and shelter-time curves

Cataclysm's static heavy/light plume remains a presentation footprint. When a
user inspects a point after a surface or low burst, Rust separately evaluates a
time-varying point field using the historical WSEG-10 analytical model. This is
an educational damage-assessment screen, not a weather forecast or protective-
action product.

## Spatial field and arrival

The implementation in `physics/fallout.rs` follows Hanifen's 1980 documentation
of WSEG Research Memorandum No. 10 (ADA083515). Yield, fission fraction, a
constant wind speed and direction, and a fixed vertical shear define the mean
cloud/deposition parameters. The kernel returns the unit-time reference dose
rate, `R1`, at H+1 and a mean arrival time for the clicked downwind/crosswind
coordinate.

The compact field label follows the LLNL responder-planning screening
thresholds at H+1: the dangerous fallout field begins at 10 R/h (0.1 Sv/h in
the model's equivalent-residual-dose conversion) and the hot field at 0.01 R/h
(0.0001 Sv/h). These labels summarize the model field; they are not a safety
determination.

The shipped default is 40 km/h wind with 0.2 mph per kilofoot shear. Direction
and speed can be changed in Advanced setup. The query is evaluated only in Rust;
the Cesium polygon and React charts do not calculate dose.

## Time decay and accumulated exposure

After the mean arrival time, the nominal rate is the Glasstone-Dolan
approximation

```text
R(t) = R1 * t^-1.2
```

with `t` in hours after detonation. Integrating from arrival `ta` to a selected
time `tb` gives

```text
D = 5 * R1 * (ta^-0.2 - tb^-0.2)
```

The UI stops at 14 days, matching the HHS Rule-of-Seven teaching interval.
Published test data required decay exponents from 0.9 to 2.0 in some cases, so
Cataclysm evaluates all three exponents and plots the minimum/maximum band around
the nominal curve. Values before mean arrival are zero; this is an arrival gate,
not a claim that real deposition begins instantaneously.

## Shelter coupling

Every curve is returned for the same eight shelter profiles used by the UNI-06
shelter advisor. Rust applies each profile's idealized radiation exposure
fraction to both dose rate and cumulative exposure. The selected shelter changes
only the displayed backend curve; it does not create a personal survival
probability or recommendation.

## Limits

- One constant wind cannot reproduce changing direction, shear, rain, terrain,
  urban roughness, or particle-size distributions.
- The H+1 field includes activity that will be deposited at the point; real
  instruments and official instructions supersede the model.
- Shelter fractions assume continuous occupancy and idealized construction.
- WSEG-10 is a historical mean-case model. Results may differ from actual local
  measurements by orders of magnitude.

Sources: Hanifen (1980), *Documentation and Analysis of the WSEG-10 Fallout
Prediction Model* (ADA083515); Glasstone & Dolan (1977), *The Effects of Nuclear
Weapons*, Chapter IX; HHS Radiation Emergency Medical Management, *Fallout from
a Nuclear Detonation*.
