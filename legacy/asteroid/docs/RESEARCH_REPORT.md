# AsteroidSimulator Research Report

**Date:** 2026-06-26
**Sources verified:** 19 fetched, 65 claims extracted, 25 adversarially verified (21 confirmed, 4 killed)

---

## 1. Competitive Landscape

### Purdue/Imperial College "Impact: Earth!" (Collins, Melosh, Marcus)
- **URL:** https://www.purdue.edu/impactearth/
- **Status:** Gold standard web calculator since 2005
- **Inputs (6):** projectile diameter, density, impact velocity, impact angle, observer distance, target type (sedimentary rock / crystalline rock / water with depth)
- **Outputs (9 categories):** Energy, Global Changes, Atmospheric Entry, Crater, Thermal Effects, Seismic Effects, Ejecta, Air Blast, Tsunami
- **Crater scaling:** Three independent methods (yield, pi-scaling, Gault semi-empirical)
- **Presets (6):** Chelyabinsk, Meteor Crater, Tunguska, Ries Crater, Chesapeake Bay, Chicxulub
- **Weakness:** Text-only output. No map visualization. No interactive globe. No damage radii overlay. No real-time parameter adjustment feedback.

### Neal.fun "Asteroid Launcher"
- **URL:** https://asteroidlauncher.pages.dev/
- **Status:** Popular interactive web app (Space.com featured)
- **Strength:** Beautiful map-based visualization with damage rings, click-to-impact UX
- **Weakness:** Simplified physics, limited parameter control, no ocean impact modeling, no fragmentation physics, entertainment-focused rather than scientifically rigorous

### acse-ns1321/asteroid-impact-simulator (GitHub, MIT license)
- **URL:** https://github.com/acse-ns1321/asteroid-impact-simulator
- **Status:** Imperial College student project, 9 contributors
- **Implements:** Six coupled ODEs for atmospheric entry + airblast overpressure only
- **Missing:** Crater formation, thermal radiation, seismic effects, ejecta, tsunami — massive feature gap
- **Useful as:** Reference implementation for the atmospheric entry ODEs

### disastermap.ca
- **URL:** https://www.disastermap.ca/
- **Status:** Map-based disaster simulator (various disaster types)
- **Weakness:** Limited physics depth for impacts specifically

### Our opportunity
**No existing tool combines rigorous Collins et al. 2005 physics with interactive 3D globe visualization.** Purdue has the physics but no map. Neal.fun has the map but simplified physics. The GitHub simulator has code but only airblast. We fill all three gaps.

---

## 2. Canonical References

| Paper | Year | What it provides |
|-------|------|-----------------|
| Collins, Melosh & Marcus | 2005 | Complete impact effects chain (the bible) — MAPS 40:817-840 |
| Holsapple & Schmidt | 1987 | Pi-group crater scaling laws |
| Holsapple | 1993 | Updated scaling with material-dependent exponents |
| Hills & Goda | 1993 | Atmospheric fragmentation/pancake model — AJ 105:1114-1144 |
| Melosh | 1989 | "Impact Cratering: A Geologic Process" (textbook) |
| Collins et al. | 2017 | Airblast model comparison (static/moving/line-source) — MAPS 52:1542-1560 |
| Ward & Asphaug | 2000 | Impact tsunami generation & propagation — Icarus 145:64-78 |
| Glasstone & Dolan | 1977 | Nuclear blast/thermal scaling (adapted for impacts) |
| Synolakis | 1987 | Tsunami coastal runup formula |
| Gault | 1974 | Semi-empirical crater scaling |

---

## 3. Physics Models & Equations (Implementable)

### 3.1 Input Parameters

| Parameter | Symbol | Units | Typical Range |
|-----------|--------|-------|---------------|
| Projectile diameter | L | m | 1 — 50,000 |
| Projectile density | delta_i | kg/m^3 | 1000 (comet) — 7800 (iron) |
| Impact velocity | v_i | km/s | 11.2 — 72 |
| Impact angle | theta | degrees | 1 — 90 (from horizontal) |
| Observer distance | D | km | 0 — 20,000 |
| Target type | — | enum | Sedimentary rock / Crystalline rock / Water (with depth) |

**Preset densities:**
- Ice/comet: 1000 kg/m^3
- Porous rock: 1500 kg/m^3
- Dense rock/ite: 3000 kg/m^3
- Stony asteroid: 3300 kg/m^3
- Iron: 7800 kg/m^3

### 3.2 Atmospheric Entry (Hills & Goda 1993 Pancake Model)

Six coupled ODEs for the trajectory:

```
dv/dt = -C_D * rho_a * A * v^2 / (2 * m) + g * sin(theta)       [drag + gravity]
dm/dt = -C_H * rho_a * A * v^3 / (2 * Q)                         [ablation]
dtheta/dt = (g * cos(theta) / v) - (v * cos(theta)) / (R_E + z)  [trajectory curvature]
dz/dt = -v * sin(theta)                                           [altitude]
dx/dt = v * cos(theta) * R_E / (R_E + z)                          [ground distance]
dr/dt = fragmentation spreading (see below)                        [radius change]
```

**Constants:**
- C_D = 1.0 (drag coefficient for a sphere)
- C_H = 0.1 (heat transfer coefficient)
- Q = 8e6 J/kg (heat of ablation, stony; varies by composition)
- R_E = 6.371e6 m (Earth radius)
- g = 9.81 m/s^2

**Atmospheric density model (exponential):**
```
rho_a(z) = rho_0 * exp(-z / H)
rho_0 = 1.225 kg/m^3 (sea level)
H = 8500 m (scale height)
```

**Fragmentation trigger:**
Breakup begins when ram pressure exceeds material strength:
```
P_ram = rho_a * v^2 > S (material strength)
```

**Material strengths:**
- Comet (ice): S = 1e5 Pa (0.1 MPa)
- Carbonaceous chondrite: S = 2e6 Pa (2 MPa)
- Stony asteroid: S = 1e7 Pa (10 MPa, modern estimate; Hills & Goda used 50 MPa)
- Iron: S = 2e8 Pa (200 MPa)

**Post-fragmentation spreading (pancake model):**
```
dr/dt = v * alpha * sqrt(rho_a / delta_i)
alpha = 0.3 (spreading coefficient, default from acse-ns1321)
```

**Critical radii** (atmosphere cannot prevent ground damage):
- Stony asteroid: >100 m radius (Hills & Goda; ~28 m with modern 10 MPa strength)
- Comet: >500 m radius
- Iron (>20 km/s): >20-30 m radius
- Iron (11-15 km/s): >2 m radius

**Airburst altitude:** Where maximum energy deposition occurs (dE/dz peaks). Integrate the ODEs until either z=0 (ground impact) or the impactor is fully ablated/dispersed.

**Key insight (verified):** Airburst damage can be up to 2x larger than equivalent energy at surface for certain small asteroid sizes. This is counterintuitive and important to model.

### 3.3 Kinetic Energy

```
m = (pi/6) * L^3 * delta_i                    [mass of sphere]
E_kinetic = 0.5 * m * v_i^2                    [joules]
E_megatons = E_kinetic / 4.184e15              [convert to Mt TNT]
```

### 3.4 Crater Formation (Pi-Scaling, Holsapple 1993)

**Transient crater diameter** (gravity-dominated regime):
```
D_tc = 1.161 * (rho_i / rho_t)^(1/3) * L^0.78 * v_i^0.44 * g^(-0.22) * (sin(theta))^(1/3)
```

Where:
- rho_i = impactor density
- rho_t = target density (2500 kg/m^3 sedimentary, 2750 kg/m^3 crystalline)
- L = impactor diameter (m)
- v_i = impact velocity (m/s)
- g = 9.81 m/s^2

**Note:** The exponents (0.78, 0.44, -0.22) are material-dependent. Values above are for competent rock. Collins et al. 2005 provides the full formulation with pi-groups.

**Final crater diameter:**
Simple-to-complex transition at D_sc:
```
D_sc = 3200 m (sedimentary rock)
D_sc = 4000 m (crystalline rock)
```

For simple craters (D_tc < D_sc):
```
D_final = 1.25 * D_tc
depth = D_final / 5
```

For complex craters (D_tc >= D_sc):
```
D_final = 1.17 * D_tc^1.13 * D_sc^(-0.13)
depth = 0.15 * D_final^0.43 * D_sc^0.57      [shallower than simple]
```

**Yield scaling** (alternate method):
```
D_crater = 0.0133 * E^(1/3.4)                 [E in joules, D in meters]
```

**Melt volume** (complex craters):
```
V_melt = 8.9e-12 * E^0.85 * (sin(theta))^2    [m^3, E in joules]
```

### 3.5 Fireball & Thermal Radiation

**Fireball radius:**
```
R_fireball = 0.002 * E^0.333                   [E in joules, R in m]
```

(Adapted from Glasstone & Dolan nuclear fireball scaling)

**Thermal exposure** at distance D (km):
```
eta = luminous efficiency (fraction of energy radiated as thermal)
phi = E * eta / (2 * pi * D^2)                 [J/m^2]
```

Luminous efficiency varies: ~1e-4 for very large impacts, up to ~0.01 for airbursts.

**Damage thresholds:**
- 3rd degree burns: ~250 kJ/m^2
- 2nd degree burns: ~125 kJ/m^2
- 1st degree burns: ~60 kJ/m^2
- Paper ignition: ~100 kJ/m^2
- Dry wood ignition: ~250 kJ/m^2
- Firestorm threshold: ~300 kJ/m^2

### 3.6 Seismic Effects

**Equivalent earthquake magnitude:**
```
M = 0.67 * log10(E) - 5.87                     [E in joules]
```

(Collins et al. 2005, energy-magnitude conversion)

**Effective seismic energy** (only fraction couples into ground):
```
E_seismic = 1e-4 * E_kinetic                   [seismic efficiency ~0.01%]
```

**Mercalli intensity at distance D:**
Uses standard seismic attenuation relations. Approximate:
```
I_mercalli = M - 3 * log10(D/D_ref)            [D in km, rough]
```

### 3.7 Airblast / Overpressure

**Static-source model** (nuclear-test-derived, Collins et al. 2017 confirms adequate):

Two-term empirical formula for overpressure:
```
Delta_P(x) = 3.14e11 * x^(-1.3) + 1.8e7 * x^(-0.565)    [Pa]
```

Where x is the scaled distance. For surface bursts:
```
x = r * (E_kt)^(-1/3)                          [r in m, E_kt in kilotons]
```

For airbursts at altitude z_b:
```
r_ground = sqrt(R^2 - z_b^2)                   [burst-to-ground geometry]
```

Where R is the slant range from the burst point.

**Damage thresholds (overpressure):**
- 1 psi (6.9 kPa): Window breakage
- 2 psi (13.8 kPa): Minor structural damage
- 4 psi (27.6 kPa): Moderate damage, injuries from debris
- 7 psi (48.3 kPa): Severe structural damage
- 10 psi (68.9 kPa): Reinforced concrete damage
- 20 psi (137.9 kPa): Total destruction

**Wind velocity** from overpressure:
```
u = (5 * Delta_P) / (7 * P_0) * sqrt(2 * P_0 / (7 * rho_0))   [simplified]
```

**Key finding (verified):** Three airblast models (static, moving, line-source) agree beyond 3x burst height distance. Static-source is simplest and adequate for probabilistic assessment. Moving-source gives ~2x higher close-in; line-source ~2x lower close-in.

### 3.8 Ejecta

**Ejecta thickness at distance r from crater center:**
```
t(r) = T_0 * (r / R_crater)^(-3)               [power-law decay]
```

Where T_0 is the ejecta thickness at the crater rim:
```
T_0 ~ 0.14 * R_crater * (R_crater / D_final)^0.74
```

**Maximum ejecta range** (ballistic):
```
R_ejecta ~ v_eject^2 * sin(2 * phi_eject) / g
```

Where ejection velocity scales with crater size and impact energy.

### 3.9 Tsunami (Ocean Impacts)

**Ward & Asphaug 2000 model:**

**Impact cavity dimensions** (from energy arguments):
```
D_cavity = 1.27 * (E / (rho_w * g))^(1/4)      [cavity diameter, m]
depth_cavity = D_cavity / 2                      [parabolic approximation]
```

Where rho_w = 1025 kg/m^3 (seawater).

**Initial wave amplitude:**
```
A_0 ~ depth_cavity / 2                          [rim wave amplitude]
```

**Wave propagation with dispersion:**

For impactors under a few hundred meters radius (cavity width ~ ocean depth):
```
A(r) ~ A_0 * (R_0 / r)^n
```

Where:
- n = 0.5 for non-dispersive (long-wave): standard geometric spreading (1/sqrt(r))
- n ~ 1.0 for dispersive: frequency dispersion increases decay to nearly 1/r

**This is critical:** Dispersion significantly reduces distant tsunami hazard for moderate impactors. Traditional 1/sqrt(r) geometric spreading overestimates distant wave heights.

**Coastal runup** (Synolakis 1987, from TsunamiSimulator):
```
R / H_0 = 2.831 * sqrt(cot(beta)) * (H_0 / d)^(5/4)
```

Where:
- R = runup height
- H_0 = incident wave amplitude
- beta = beach slope angle
- d = water depth offshore

### 3.10 Global Effects (Large Impacts Only)

For Chicxulub-scale events (E > 1e23 J):
- **Dust/ejecta blanket:** Global coverage from re-entering ejecta
- **Wildfires:** Thermal pulse from re-entering ejecta ignites vegetation
- **Impact winter:** Dust + soot blocks sunlight for months-years
- **Acid rain:** NOx from shocked atmosphere + SO2 from vaporized sulfate rock

Threshold for global catastrophe: ~1e23 J (~impactor > 5 km diameter at typical velocities)

---

## 4. Validation Data (Historical Events)

| Event | Diameter | Density | Velocity | Angle | Energy | Key Observable |
|-------|----------|---------|----------|-------|--------|---------------|
| Chelyabinsk 2013 | ~19 m | 3300 kg/m^3 | 19 km/s | 18deg | ~500 kt | Airburst at ~30 km, ~1500 injuries from glass |
| Tunguska 1908 | ~50-80 m | 2000? kg/m^3 | ~15 km/s | ~30deg? | 3-15 Mt | Airburst at ~8 km, 2150 km^2 forest flattened |
| Meteor Crater | ~50 m | 7800 kg/m^3 | ~12.8 km/s | ~45deg | ~10 Mt | 1.18 km crater, 170m deep, simple |
| Ries Crater | ~1500 m | 3500 kg/m^3 | ~20 km/s | ~30deg | ~1.5e24 J | 24 km crater, complex |
| Chesapeake Bay | ~3000 m | 3500 kg/m^3 | ~20 km/s | ~45deg | ~2e25 J | 85 km crater, complex, ocean impact |
| Chicxulub | ~10-14 km | 2600 kg/m^3 | ~20 km/s | ~60deg | ~4e23-1e24 J | 180 km crater, mass extinction |

---

## 5. Recommended Stack

Based on the two sibling projects:

| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Frontend** | React 19 + TypeScript + Vite | Matches TsunamiSimulator, modern tooling |
| **Desktop** | Tauri 2 (Rust backend) | Matches TsunamiSimulator, physics in Rust for performance |
| **3D Globe** | CesiumJS | Matches TsunamiSimulator, 3D terrain, damage ring overlays |
| **Physics** | Rust (rayon for parallelism) | ODE integration, crater scaling, all effect calculations |
| **IPC** | serde + tauri::invoke | Proven pattern from TsunamiSimulator |

**Alternative (lighter weight):** Vanilla JS + Leaflet (NukeMap pattern) if desktop wrapper isn't needed. Leaflet is simpler but 2D-only.

**Recommendation:** Go with the Tauri + CesiumJS stack. The physics are more complex than NukeMap (6 coupled ODEs + 9 output categories), and TsunamiSimulator already proved this architecture works for impact-adjacent physics. The ocean impact tsunami chain can directly reuse TsunamiSimulator's SWE solver concepts.

---

## 6. Feature Differentiation (What Makes This Better)

| Feature | Purdue | Neal.fun | GitHub OSS | **Ours** |
|---------|--------|----------|------------|----------|
| Rigorous physics (Collins et al. 2005) | Yes | No | Partial (airblast only) | **Yes** |
| Interactive map/globe | No | Yes (2D) | Yes (basic) | **Yes (3D CesiumJS)** |
| Crater visualization | No | Simple ring | No | **3D profile + cross-section** |
| Ocean vs land | Yes (text) | No | No | **Yes + tsunami propagation** |
| Atmospheric entry ODE | Yes (text) | No | Yes | **Yes + animated trajectory** |
| Fragmentation/airburst | Yes (text) | Simplified | Yes (pancake) | **Yes + visual breakup** |
| Historical presets | 6 | None | None | **10+ with validation** |
| NASA NEO database | No | No | No | **Yes (CNEOS/JPL API)** |
| Real-time parameter sliders | No | Yes | No | **Yes** |
| Damage rings on map | No | Yes | Yes (basic) | **Yes (12+ effect categories)** |
| Multiple effect categories | 9 (text) | 4-5 (visual) | 1 (airblast) | **9+ (visual on globe)** |
| Animated blast wave | No | Yes | No | **Yes** |
| Ejecta curtain | Text only | No | No | **Visual on globe** |
| Population/casualty est. | No | Simplified | No | **Yes (from NukeMap pattern)** |

---

## 7. Open Questions

1. **Pi-scaling constants:** The exact Holsapple 1993 exponents for different target materials need extraction from the original paper. The values in section 3.4 are for competent rock; sediment, ice, and water targets have different exponents.

2. **Coastal runup detail:** Ward & Asphaug 2000 handles open-ocean propagation but not detailed near-shore nonlinear behavior. Korycansky & Lynett 2007 extended this — may need those equations for ocean impact accuracy.

3. **Multi-body fragmentation:** The pancake model handles a single breakup event. Chelyabinsk had multiple fragmentations. Register et al. 2017 and Wheeler et al. 2017 have fragment-cloud models for more accuracy, but are significantly more complex to implement.

4. **No complete open-source implementation exists.** The Purdue calculator is closed-source. We would be the first open-source implementation of the full Collins et al. 2005 effect chain.

---

## 8. NASA API Integration

**JPL Small-Body Database API:**
- **URL:** https://ssd-api.jpl.nasa.gov/
- **Endpoints:** SBDB query, close-approach data, orbit elements
- **Data:** diameter, albedo, spectral class, orbital elements for all known NEOs
- **Free, no API key required**

**CNEOS (Center for Near Earth Object Studies):**
- Sentry risk table (impact probability for known threats)
- Fireball/bolide event data (observed atmospheric entries)
- Close approach tables

This lets users select real asteroids and simulate "what if this one hit?"
