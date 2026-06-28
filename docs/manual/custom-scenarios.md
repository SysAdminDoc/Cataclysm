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
| Angle (°) | 1 – 90 | Impact angle from horizontal. 45° is statistically most probable |
| Water depth (m) | 0 – 12,000 | Ocean depth at impact point |

### Nuclear detonation

Models underwater or surface nuclear explosions. Uses Glasstone & Dolan 1977 for blast effects and Le Méhauté 1996 for wave generation efficiency (~5% of yield).

| Parameter | Range | Description |
|---|---|---|
| Yield (kt TNT) | 0.001 – 1,000,000 | Total yield. 1 kt = 4.184 × 10¹² J |
| Burst geometry | Surface / Shallow / Deep / Abyssal | Depth regime affects coupling efficiency |
| Burst depth (m) | 0 – 6,000 | Detonation depth below ocean surface |

### Earthquake (Okada fault)

Models seafloor displacement from a rectangular fault dislocation. Uses Okada 1985 half-space elastic solution with the full I-term correction.

| Parameter | Range | Description |
|---|---|---|
| Magnitude (Mw) | 5.0 – 10.0 | Moment magnitude |
| Depth (m) | 0 – 100,000 | Hypocentre depth below seafloor |
| Strike (°) | 0 – 360 | Azimuth the fault plane faces |
| Dip (°) | 0 – 90 | Angle of fault plane from horizontal |
| Rake (°) | −180 – 180 | Slip direction on the fault. 90° = pure thrust |
| Slip (m) | 0 – 100 | Average coseismic displacement |
| Fault length/width (m) | 0 = auto | 0 derives from Wells–Coppersmith 1994 |

### Landslide

Models subaerial rockslides (Fritz & Hager 2001) or submarine slope failures (Watts et al. 2005).

| Parameter | Range | Description |
|---|---|---|
| Type | Subaerial / Submarine | Subaerial: rock-fall into water. Submarine: slope failure |
| Volume (m³) | 1 – 10¹⁴ | Slide volume. Lituya: ~30M m³; Storegga: ~3000 km³ |
| Density (kg/m³) | 500 – 8,000 | Material density |
| Drop height (m) | 0 – 10,000 | Vertical fall of the slide mass centre |
| Slope (°) | 0 – 90 | Failure surface angle |
| Body width (m) | 1 – 1,000,000 | Width of the receiving water body |

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
4. Toggle **Coastal runup** to see Synolakis 1987 runup predictions at 60+ coastal points

## Export options

| Format | Description |
|---|---|
| **PNG** | Screenshot of the current globe view |
| **Share card** | Branded 1200×800 image with metadata overlay |
| **Video** | 6-second WebM/MP4 recording of the globe |
| **Text** | Screen-reader-friendly text file with parameters and runup table |
| **CZML** | Time-dynamic Cesium playback file (viewable in any CesiumJS app) |
