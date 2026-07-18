# Getting Started

## Installation

Download the latest installer from the [Releases page](https://github.com/SysAdminDoc/TsunamiSimulator/releases):

- **Windows**: `.msi` or `.exe` installer
- **macOS**: Universal `.dmg` (Intel + Apple Silicon)
- **Linux**: `.AppImage`, `.deb`, or `.rpm`

The app launches immediately with the bundled **Natural Earth II** globe — no account, token, or network tiles required.

## Optional: Cesium ion token

For high-resolution satellite imagery and bathymetric terrain, you can add a free Cesium ion token:

1. Sign up at [cesium.com/ion/signup](https://cesium.com/ion/signup) (free tier is sufficient)
2. Copy your default access token from the dashboard
3. In TsunamiSimulator, click **Settings** in the toolbar
4. Paste the token and click **Save**

Without a token, the app uses the local Natural Earth globe by default. OpenStreetMap and Esri imagery are also available as no-token online styles.

## Interface language

Open **Settings → Earth & appearance** to choose English, Spanish, Japanese,
or Bahasa Indonesia. The choice is stored only in the local settings profile
and is included when that profile is exported. Guided-lesson controls, all
seven lesson narratives and worksheets, and the scientific glossary are
translated now; interface text that has not yet moved to the catalog falls
back to canonical English.

## Your first simulation

### Using a preset

1. **Choose a preset** from the left panel. Each card shows a historical or hypothetical tsunami event with its source paper citation.
2. The globe flies to the event location and displays the source parameters in the **Results panel** on the right.
3. Click **Run solver** in the **SWE Playback** section (right panel) to start the shallow-water solver.
4. Use the **timeline scrubber** to step through 24 snapshots of the propagating wave.
5. Press **Play** to animate the sequence automatically.

### Building a custom scenario

1. Scroll down in the right panel to **Custom scenario**.
2. Select a source type tab: **Asteroid**, **Nuclear**, **Earthquake**, **Landslide**, or **Meteotsunami**.
3. Fill in the parameters. Each field has a **?** help button explaining the physics and citing the source paper.
4. Set the location by either:
   - Clicking **Pick on globe** and clicking the map, or
   - Typing latitude and longitude directly
5. Click **Simulate** to compute the initial conditions.
6. Run the SWE solver as above.

## Understanding the readout

The **Results panel** shows:

| Field | Meaning |
|---|---|
| **Peak amplitude** | Maximum water surface displacement at the source (meters) |
| **Cavity radius** | Radius of the initial water cavity (meters) |
| **Source energy** | Total energy released, in joules and Mt TNT equivalent |
| **Seismic Mw** | Equivalent moment magnitude (energy-based) |
| **Wavelength** | Dominant wavelength of the generated wave |

## Keyboard navigation

| Key | Action |
|---|---|
| **Esc** | Cancel pick mode, inspect mode, or close any dialog |
| **Tab** | Navigate through all controls |

## Next steps

- [Presets guide](presets.md) — details on each historical preset
- [Custom scenarios](custom-scenarios.md) — parameter ranges and physics
- [Physics explainer](physics-explainer.md) — how the solver works
