# Getting Started

## Installation

Download the latest installer from the [Releases page](https://github.com/SysAdminDoc/TsunamiSimulator/releases):

- **Windows**: `.msi` or `.exe` installer
- **macOS**: Universal `.dmg` (Intel + Apple Silicon)
- **Linux**: `.AppImage`, `.deb`, or `.rpm`

The app launches immediately with the **OpenStreetMap** globe — no account or token required.

## Optional: Cesium ion token

For high-resolution satellite imagery and bathymetric terrain, you can add a free Cesium ion token:

1. Sign up at [cesium.com/ion/signup](https://cesium.com/ion/signup) (free tier is sufficient)
2. Copy your default access token from the dashboard
3. In TsunamiSimulator, click **Settings** in the toolbar
4. Paste the token and click **Save**

Without a token, the app uses OpenStreetMap tiles, which are perfectly functional for all simulation features.

## Your first simulation

### Using a preset

1. **Choose a preset** from the left panel. Each card shows a historical or hypothetical tsunami event with its source paper citation.
2. The globe flies to the event location and displays the source parameters in the **Results panel** on the right.
3. Click **Run simulation** in the **SWE Playback** section (right panel) to start the shallow-water solver.
4. Use the **timeline scrubber** to step through 24 snapshots of the propagating wave.
5. Press **Play** to animate the sequence automatically.

### Building a custom scenario

1. Scroll down in the right panel to **Custom scenario**.
2. Select a source type tab: **Asteroid**, **Nuclear**, **Earthquake**, or **Landslide**.
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

## Keyboard shortcuts

| Key | Action |
|---|---|
| **F6** | Toggle coastal runup overlay |
| **F7** | Toggle side-by-side comparison mode |
| **F8** | Toggle DART buoy overlay |
| **Esc** | Cancel pick mode or inspect mode |
| **Tab** | Navigate through all controls |

## Next steps

- [Presets guide](presets.md) — details on each historical preset
- [Custom scenarios](custom-scenarios.md) — parameter ranges and physics
- [Physics explainer](physics-explainer.md) — how the solver works
