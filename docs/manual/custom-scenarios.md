# Custom Scenarios

Build your own tsunami scenario by selecting a source type and entering parameters. All physics runs in the Rust backend — the numbers you see come from peer-reviewed formulas.

## Source types

### Asteroid impact

Models a cosmic body striking the ocean surface. Uses Ward & Asphaug 2000 scaling for cavity geometry and Schmidt & Holsapple 1982 for crater scaling.

| Parameter | Range | Description |
|---|---|---|
| Diameter (m) | 1 – 50,000 | Impactor diameter. Chicxulub was ~14,000 m. |
| Density (kg/m³) | 500 – 8,000 | Iron: ~7,800; stony: ~3,000; cometary ice: ~500 |
| Velocity (m/s) | 1,000 – 72,000 | Typical NEO: ~18,000 m/s; long-period comet: up to 72,000 |
| Impact angle (°) | 1 – 90 | Impact angle from horizontal. 45° is statistically most probable |
| Water depth (m) | 0 – 12,000 | Ocean depth at impact point |

### Nuclear detonation

Models underwater or surface nuclear explosions. Uses Glasstone & Dolan 1977 for blast effects and Le Méhauté 1996 for wave generation efficiency (~5% of yield).

| Parameter | Range | Description |
|---|---|---|
| Yield (kt TNT) | 0.001 – 1,000,000 | Total yield. 1 kt = 4.184 × 10¹² J |
| Burst geometry | Surface / Shallow / Deep / Abyssal | Depth regime affects coupling efficiency |
| Burst depth (m) | 0 – 6,000 | Detonation depth below ocean surface |
| Water depth (m) | 0 – 12,000 | Ocean depth at the source |

### Earthquake (Okada fault)

Models seafloor displacement from a rectangular fault dislocation. Uses Okada 1985 half-space elastic solution with the full I-term correction.

| Parameter | Range | Description |
|---|---|---|
| Magnitude (Mw) | 5 – 10 | Moment magnitude |
| Hypocentre depth (m) | 0 – 100,000 | Hypocentre depth below seafloor |
| Strike (°) | 0 – 360 | Azimuth the fault plane faces |
| Dip (°) | 0 – 90 | Angle of fault plane from horizontal |
| Rake (°) | -180 – 180 | Slip direction on the fault. 90° = pure thrust |
| Slip (m) | 0 – 100 | Average coseismic displacement |
| Fault length (m) | 0 – 2,000,000 | 0 derives length from Wells–Coppersmith 1994 |
| Fault width (m) | 0 – 500,000 | 0 derives width from Wells–Coppersmith 1994 |
| Water depth (m) | 0 – 12,000 | Ocean depth at the source |

### Landslide

Models subaerial rockslides (Fritz & Hager 2001) or submarine slope failures (Watts et al. 2005).

| Parameter | Range | Description |
|---|---|---|
| Type | Subaerial / Submarine | Subaerial: rock-fall into water. Submarine: slope failure |
| Volume (m³) | 1 – 100,000,000,000,000 | Slide volume. Lituya: ~30M m³; Storegga: ~3000 km³ |
| Density (kg/m³) | 500 – 8,000 | Material density |
| Drop height (m) | 0 – 10,000 | Vertical fall of the slide mass centre |
| Slope (°) | 0 – 90 | Failure surface angle |
| Water depth (m) | 1 – 12,000 | Water depth at the source; landslide sources require water |
| Receiving body width (m) | 1 – 1,000,000 | Width of the receiving water body |

## Direct hazard controls

Direct asteroid and nuclear views use deliberately narrower interactive ranges than the tsunami source builder. Imported requests are validated against the same limits before Rust evaluates them.

### Direct asteroid

| Parameter | Range | Description |
|---|---|---|
| Diameter (m) | 1 – 20,000 | Impactor diameter |
| Density (kg/m³) | 500 – 9,000 | Impactor bulk density |
| Velocity (km/s) | 11 – 72 | Atmospheric entry velocity |
| Impact angle (°) | 5 – 90 | Entry angle from horizontal |
| Water depth (m) | 0 – 12,000 | Derived from the selected surface |
| Beach slope (rad) | 0.00001 – 1 | Uses 0.02 when no local slope is supplied |

### Direct nuclear

| Parameter | Range | Description |
|---|---|---|
| Yield (kt TNT) | 0.001 – 100,000 | Interactive weapon yield |
| Burst height (m) | 0 – 10,000,000 | Optional custom burst height |
| Fission fraction (%) | 0 – 100 | Uses 50% when omitted |
| Population density (people/km²) | 0 – 20,000 | Set to 0 to suppress casualty estimates |
| Wind from (°) | 0 – 359 | Fallout presentation direction |

## Location

Set the source location by:
- **Globe click**: Press "Pick on globe" and click the map
- **Coordinate entry**: Type latitude (−90 to 90°) and longitude (−180 to 180°)
- **Keyboard fallback**: When pick mode is active, a lat/lon form appears in the banner

## Running the simulation

After clicking **Simulate**, the initial conditions panel shows the source readout. Then:

1. Click **Run solver** in the SWE Playback section
2. The shallow-water solver runs (GPU or CPU) and produces 24 time snapshots
3. Use the scrubber or Play button to animate the wave propagation
4. Toggle **Coastal runup** to see Synolakis 1987 low-confidence screening estimates at 79 coastal points. Expand a Result to audit the legacy slope and nominal depth records; CSV, GeoJSON, KML, and text exports preserve the same IDs.

## Opening an installed desktop link

Installed packages register `cataclysm://open` for the same encoded scenario
or preset query used by browser share links. Opening one starts Cataclysm when
needed or routes it to the existing instance:

```text
cataclysm://open?scenario=<encoded scenario payload>
cataclysm://open?preset=<preset id>
```

The route accepts exactly one bounded `scenario` or `preset` value. Unknown
routes, extra or duplicate parameters, fragments, malformed payloads, and
oversized links are rejected without loading fallback physics.

## Export options

Desktop solver runs publish a run-quality record covering finite fields,
minimum total depth, characteristic CFL, accepted/rejected steps, and
sponge-adjusted mass/energy drift. A hard numerical-integrity violation stops
the run and blocks ordinary exports. Warning-level drift remains exportable and
is included in provenance text and gauge CSV columns.

| Format | Description |
|---|---|
| **PNG** | Screenshot of the current globe view |
| **Share card** | Branded 1200×800 image with metadata overlay |
| **Video** | 6-second WebM/MP4 recording of the globe |
| **Text** | Screen-reader-friendly text file with parameters and runup table |
| **CZML** | Time-dynamic Cesium playback file (viewable in any CesiumJS app) |
| **NetCDF** | Desktop-only CF-1.12 scientific grid with final SWE and maximum/arrival products |

NetCDF export becomes available after a completed desktop SWE run. The file is
generated from the live Rust grid before its quantitative arrays are released;
the export menu receives only an opaque cache handle. Grids above one million
cells, cancelled or non-finite runs, stale handles, non-`.nc` destinations, and
relative paths are rejected. Warning-level quality records remain embedded in
the file so downstream users can assess the result.
