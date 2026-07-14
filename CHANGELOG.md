# Changelog

All notable changes to Cataclysm (formerly TsunamiSimulator). Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Solver runs now return their run ID and completed/cancelled lifecycle, expose
  active-run memory reservations in diagnostics, and share a 512 MiB admission
  budget. A maximum-resolution streaming run remains valid, while a concurrent
  peer or oversized retained-snapshot request is rejected before grid allocation
  with its dimensions, estimated memory, active reservations, and remediation.
- SWE propagation now uses row-specific spherical cell widths, conservative
  latitude-weighted meridional fluxes, spherical nonlinear metric terms, and
  exact row areas consistently across CPU, GPU, CFL admission, and run-quality
  accounting. High-latitude CPU/GPU parity, still-water, conservation,
  dateline-distance, and polar-bound fixtures guard the geometry.
- SWE runs now retain source-specific frame-zero geometry: earthquake inputs
  propagate the sampled Okada uplift/subsidence field, asteroid and nuclear
  inputs start from a cavity-rim annulus, and landslides use directional
  positive/negative displacement lobes. Older responses still fall back to the
  legacy circular Gaussian.
- Windows release tags and manual release runs now build on a clean isolated
  runner and gate both MSI and NSIS artifacts on the installed application, not
  the raw build output. Each package must report the expected version, persist a
  temporary Cesium token through the OS keychain across restart, complete the
  Tōhoku solver journey through frame 60/60, exercise text export and desktop
  diagnostics without renderer/protocol errors, and uninstall cleanly. The
  workflow also exposes an opt-in WebView2 preview-channel preference.
- Every run now answers "how often does this happen?": asteroid impacts show an
  order-of-magnitude recurrence interval (Earth Impact Effects Program relation,
  Collins et al. 2005), nuclear results show a Hiroshima-scale context anchor
  (labelled non-recurring because weapon effects have no natural rate), and
  earthquake tsunami sources show a global Gutenberg–Richter recurrence estimate.
  All are cited and framed as order-of-magnitude, never predictions.

### Fixed

- Direct-effect reference captures now wait for the authoritative frame to be
  projected and committed through Cesium's full Viewer clock/entity-update path
  before screenshotting. Failed
  Windows release runs also retain the candidate capture evidence, eliminating
  an intermittent camera/new-frame mismatch from the installed-package gate.
- The deterministic reference-capture harness now submits local-only coordinate
  and inspector controls without attaching Cesium requests to Playwright's
  navigation wait, and it waits for direct-render recordings to decode before
  starting an impact/detonation. This removes two Windows release-runner races
  that could fail before the installed MSI/NSIS journey began.
- DART validation now derives overlap, peaks, RMSE, and sustained-threshold
  arrivals from the archived observation and actual SWE gauge series in Rust.
  The chart draws and labels observed/model cursor values separately, reports
  the explicit NOAA-derived 3 cm noise threshold and method, and no longer uses
  a frontend great-circle travel-time estimate as model evidence.
- Diagnostics copied to the clipboard, stored after crashes, or included in a
  support bundle now redact credentials and local paths. Global errors survive
  reload, and the next successful launch offers the unseen report until the user
  explicitly inspects or clears it.
- The DART buoy sparkline now exposes its observed peak, current model value, and
  model-vs-observed arrival delta in its screen-reader label instead of a generic
  "sparkline" description.
- Saved scenarios now carry a stable id and are deleted by id rather than array
  position, so a delete can no longer remove the wrong entry if the list was
  reordered by a concurrent read, and list rows no longer reuse DOM nodes.
- The surface-displacement legend now matches the active solver colormap instead
  of a fixed rainbow ramp: diverging and cividis show a signed trough↔crest key,
  viridis shows a sequential magnitude key, and the CVD-safe maps are labelled as
  such — so a colourblind user is no longer shown a misleading legend.
- Settings Apply, Reset, and import now snapshot keychain, plugin-store, and
  WebView persistence before mutation and report whether rollback completed if
  any write fails. Legacy Cesium tokens are exposed only after keychain storage
  and plaintext-store removal both commit; keychain failures no longer silently
  fall back to plaintext credentials.

- DART buoy RMSE now distinguishes a genuine backend failure from the benign
  "no time overlap" case instead of labelling every error as no-overlap, and
  surfaces real failures in the diagnostics log.
- The "loading source" badge no longer flickers on every timeline tick during
  playback/scrubbing — it now shows only while a newly selected preset loads.
- Guarded the direct-effect animation against a zero tick duration and the
  timeline transport against a zero-length duration, either of which could freeze
  playback on the first frame.
- Clamped the nuclear yield slider's log scale so a zero/degenerate yield can no
  longer feed `-Infinity` into the control.
- Diagnostics log rows now carry a stable id so the list no longer mis-renders
  once its 500-entry ring buffer starts shifting; timeline markers distribute
  evenly when a filter leaves a single event instead of stacking at the edge.
- Sub-tonne source energies now render in compact notation with a `t TNT` tier
  instead of raw exponential Joules, matching the rest of the energy ladder.
- Floored the receiving water depth in the landslide Froude-number calculation so
  a degenerate zero-depth subaerial slide can no longer divide by zero and
  NaN-poison the initial-amplitude estimate (matches the existing guards on the
  thickness-ratio and relative-mass terms).

### Added

- Nuclear casualty results now show an approximate child (under-15) breakdown of
  fatalities and injuries, assuming the affected population mirrors the global
  age structure (~25%, UN World Population Prospects 2024). Labelled a
  demographic slice, not a differential-vulnerability model.

### Fixed

- Cancelled solver runs now resolve promptly instead of busy-polling the render
  stream to its 120 s deadline when a counted frame was never delivered, and a
  superseding run now waits for the previous run's cancellation to register
  before starting so two full CPU simulations no longer run concurrently.
- Gauge/DART sampling now reads a value anywhere inside the simulation bbox,
  including the outer half-cell rim, by edge-clamping into the interpolation
  domain. Frame-edge buoys previously returned no reading with no diagnostic.
- Atmospheric-entry integration now stops with the energy deposited so far when
  the integrator diverges (a near-stopped body drove the 1/velocity term
  unbounded) or exhausts its step budget, instead of reporting a spurious
  authoritative ground impact.
- Legacy sensitive-value migration in settings now routes through the OS keychain
  instead of writing the Cesium token into the plaintext plugin-store, closing a
  latent path that could have persisted a `SENSITIVE_KEYS` value outside the
  keychain-only design.

- Nuclear casualty and latent-cancer estimates now sort effect radii ascending
  before accumulating concentric annuli, so an out-of-order ring (for example
  `thermal_1` falling inside `psi_1` for large airbursts) is no longer dropped by
  a negative area term or mis-assigned an inner zone's lethality. Headline
  numbers change where radii were previously mis-ordered — a 100 kt surface burst
  at 5 000 /km² now reports 98 691 deaths / 329 644 injuries (was 112 019 /
  387 883, which over-counted the 4.4–8.2 km thermal band at 1 psi lethality).
- Rejected sub-floor analytical-basin depths (`mean_depth_m` below 50 m) instead
  of silently clamping them to 50 m, so the simulated depth — and therefore CFL,
  celerity, arrival times, gauges, and exports — always matches the reported
  request. Real-bathymetry runs are unaffected.
- Rejected simulation boxes that cross the ±180° antimeridian instead of emitting
  a degenerate out-of-frame Cesium rectangle (previously the box centre was
  normalized but the span was not, producing west longitudes below −180°).
  Seamless dateline transport remains tracked separately.
- Fixed the Okada seafloor displacement field georeferencing its south-west
  corner: `origin_lon` was left at the grid centre and the longitude spacing
  omitted the `cos(lat)` term, so a consumer treating `(origin_lat, origin_lon)`
  as the corner would misregister the uplift by up to half a grid width.

## [0.10.4] — 2026-07-13 — Simulation admission fix

### Fixed

- Fixed every affected simulation being rejected before its first frame when
  the timestep selector and numerical-integrity gate evaluated different CFL
  definitions. Timestep selection now uses the gate's two-dimensional
  characteristic-speed CFL, including uplift and velocity.
- Fixed desktop render streams failing after solver startup because Tauri's
  WebView2 channel transported raw render packets as validated byte arrays
  rather than the frontend's declared `ArrayBuffer` shape.
- Fixed a desktop channel race where the Rust command result could arrive
  before queued render packets, causing an otherwise healthy run to be marked
  incomplete while frames were still draining through WebView2.

## [0.10.3] — 2026-07-12 — Source-aware result stories

### Added

- Added source-aware Outcome, Science, and Validation result modes. Outcome
  summarizes the maximum sampled effect, first and nearest affected named
  coasts, arrival time, screened reach, confidence, and limitations; Science
  retains model metrics and attenuation; Validation retains coastal records,
  observations, provenance, and CSV export.
- Selecting an outcome place now synchronizes scenario time and focuses the
  Cesium globe with generation-safe camera ownership, reduced-motion support,
  and deterministic cancellation of competing flights.

### Changed

- Reimagined the desktop workspace as a calmer mission-control interface with a
  dominant globe, larger operational typography, compact header, balanced
  scenario/results rails, visual scenario cards, clearer transport/status
  hierarchy, and refreshed dark/light themes based on an implementation mockup.
- Redesigned the scenario library around a selected-scenario preview and denser
  visual source cards, and refreshed the tracked README screenshots from the
  deterministic Run & Watch workflow.
- Direct-hazard consequence estimates now use explicit order-of-magnitude
  display bands and surface their occupancy, shielding, dose-zone, survivor,
  and linear-no-threshold assumptions instead of presenting exact-looking
  population counts.
- Plain-text reports now include the same source-aware coastal story and qualify
  geographic reach as the named screening set rather than a continuous
  inundation footprint.

### Fixed

- WebGL recovery alerts now remain above viewport controls, so Reset renderer
  cannot be obscured by the floating Layers action.

## [0.10.2] — 2026-07-12 — Fail-safe desktop trust boundary

### Security

- Declared every custom Tauri IPC command in the application manifest, grouped
  grants by scientific query, simulation, cancellation, diagnostics, and
  credential access, and restricted those permissions to the main window.
- Added build-time parity and runtime-authority tests proving that undeclared
  commands fail verification and an unprivileged window cannot invoke
  simulation, cancellation, diagnostics, or keychain mutations.

### Fixed

- The mandatory first-run safety notice now opens with a persistence warning
  when acknowledgement settings cannot be read instead of silently failing
  open; a failed write advances only the current session and causes the notice
  to recur on a later launch.
- The deterministic reference recorder now enforces configurable startup,
  phase, scene, and total deadlines; writes an atomic progress heartbeat; closes
  contexts and browsers on every path; and terminates the owned preview process
  tree after timeouts, signals, or exceptions.

### Added

- Added a Rust-authoritative run-quality record with finite-field, minimum
  total-depth, characteristic-CFL, accepted/rejected-step, and sponge-adjusted
  mass/energy drift metrics. CPU candidates now roll back on hard violations;
  invalid runs clear playback and are blocked from scientific exports, while
  warning records remain visible and are stamped into provenance and CSV data.
- Added a versioned scientific input contract shared by all four tsunami source
  models and both direct-hazard models. TypeScript, UI controls, Rust commands,
  defaults, enum choices, inclusive bounds, and manual ranges now derive from
  or validate against the same source, with exhaustive boundary matrix tests.

### Fixed

- CZML playback export now emits a spec-correct time-tagged image material with
  `transparent: true` and material-level `repeat`/`color`; previously those
  properties were nested inside the per-frame interval elements (where a strict
  CesiumJS `CzmlDataSource` ignores them) and the missing transparency could
  render the wave rectangle opaque, hiding the globe in third-party viewers.
- The Settings load-error message is now calm and actionable ("defaults are
  shown … changes will still be saved") instead of exposing the raw error
  object; the underlying error is logged to the console.
- The Results outcome disclaimer used an undefined `--overlay1` CSS variable, so
  its color silently fell back to the inherited text color; it now uses the
  `--subtext` token and renders as intended muted caption text in both themes.
- The hazard-domain summary paragraph referenced an undefined `--type-small`
  font-size token (it inherited the wrong size); it now uses `--type-body`.
- Replaced hardcoded `#006080`/`#ffffff` active-toggle colors (mode and hazard
  switches) with new `--control-active-bg`/`--control-active-fg` theme tokens so
  the selected state stays consistent and theme-aware across Mocha and Latte.
- Normalized two off-scale corner radii in Settings (a `3px` code chip and a
  banned `999px` "pill" source badge) to the `--r-sm` token, complying with the
  project's allowed-radius rule.
- The plain-text results export now routes the preset id through the same
  `safeFilenamePart` sanitizer as the CZML/GeoJSON/KML exporters, closing an
  inconsistency in download-filename handling.

### Changed

- Direct-hazard casualty and latent-cancer figures are now shown as
  **order-of-magnitude estimates** (rounded to two significant figures) with the
  uniform-density assumption stated, replacing false-precision exact integers.
- Settings' "Replay first-run notice" now reopens the educational-use notice
  **immediately** instead of only scheduling it for the next launch, and is
  labelled truthfully.
- The Results panel now opens with a plain-language **"What happened?"** outcome
  lead (source-appropriate headline, peak effect, and energy) instead of raw
  source metrics, and labels are source-aware: earthquakes and landslides show
  "Source region radius" rather than the misleading "Cavity radius" (which now
  appears only for impact and detonation sources).

### Added

- The fatal-error screen now persists a **redacted crash report** (tokens,
  absolute paths, and long hashes stripped) that survives a reload, and offers
  Reset visual settings, Copy diagnostics, and Save diagnostics recovery actions
  alongside Try again / Reload. A successful restart marks the report reviewed
  without deleting it.
- Direct-hazard controls now pair every continuous slider (yield, population
  density, wind, diameter, velocity, angle, density) with a **synchronized exact
  numeric input** (draft-on-blur, clamped to bounds, with units), so precise
  values can be entered instead of only dragged.
- Nuclear results now include a **latent-cancer estimate** (BEIR VII linear
  no-threshold, ~5.5% excess mortality per Sv) — 10- and 30-year delayed cancer
  fatalities plus hereditary effects among survivors — shown beside the prompt
  casualty readout when a population density is set.
- Nuclear detonations now render a **0.25 psi light-damage ring** (windows break
  over a wide area) outside the 1 psi ring, with a matching low-lethality
  glass-cut casualty band. The coefficient is extrapolated from the same
  Glasstone–Dolan scaled-overpressure fit as the other rings.

### Security

- Trimmed the Tauri capability surface to the five store operations the app
  actually uses (`load`/`get`/`set`/`save`/`delete`); the unused enumeration,
  clear, and reload permissions are no longer granted to the webview, and a new
  `npm run verify` capability-surface gate prevents them from creeping back.

### Fixed

- Saved scenarios are now re-validated on read with the same schema check used
  on write, so a tampered or corrupted store, or a record from an older schema,
  is dropped with a diagnostic instead of flowing unvalidated into the UI.
- The `earthquake_initial_conditions` command now range-checks fault strike
  ([0, 360]) and rake ([-180, 180]) in Rust, matching the frontend
  `SCENARIO_BOUNDS` table so both entry paths accept and reject the same inputs.

## [0.10.1] — 2026-07-12 — Auditable coastal screening

- Fixed desktop coastal runup failing as a batch when deep-water reference gauges supplied a zero-slope sentinel.
- Made Rust resolve named coast IDs against the validated bundled database, preventing clients from substituting slope, depth, or provenance records.
- Added explicit source, method, datum, resolution/date, confidence, uncertainty, placeholder status, and stable sample/record IDs for every runup input.
- Labelled current legacy/nominal inputs as low-confidence illustrative estimates in Results, globe inspection, CSV, GeoJSON, KML, and text exports.

## [0.10.0] — 2026-07-12 — Progressive simulator workspace

- Added persisted Simple, Customize, and Advanced workspace detail levels;
  Simple is the default and keeps the globe, scenario, journey, timeline, and
  outcomes dominant.
- Moved exact solver grids, gauges, model confidence, and scientific
  diagnostics to Advanced while Customize retains only understandable rerun,
  ocean-depth, and atmospheric-wave controls.
- Hid custom-source editors until Create my own or Edit is explicit, and kept
  selected scenarios, computed frames, and physics inputs intact across mode
  changes.
- Applied the same disclosure model to direct asteroid and nuclear controls,
  with scale and location available before exact physical parameters.
- Added settings-schema migration, export/import persistence, keyboard,
  state-preservation, browser, accessibility, and desktop visual coverage.

## [0.9.1] — 2026-07-12 — Guided Run & Watch

- Turned Run & Watch into one explicit Prepare / Calculate / Watch /
  Understand journey that opens the outcome overview and begins playback when
  frames are ready.
- Reused completed frames and direct-effect results for immediate replay while
  keeping a visible manual-controls exit and local solver retry.
- Consolidated tsunami playback under the persistent transport, removing the
  duplicate solver playhead and hidden internal autoplay state.
- Added journey, cached replay, single-playhead, failure/retry, and rendered
  desktop regression coverage.

## [0.9.0] â€” 2026-07-11 â€” Universal scenario library

- Replaced the domain-specific empty rail with one persistent library spanning
  tsunami reference events and complete direct asteroid/nuclear what-if scenes.
- Added Quick Start choices for a famous event, a what-if, and custom creation,
  plus bounded recent history, favorites, cross-domain search, and filters.
- Scenario cards now preview deterministic camera framing without starting
  physics; one separate Run & Watch action dispatches exact typed inputs and
  begins tsunami solver playback or direct-effect animation.
- Direct scenario inputs and cameras are derived from the locked reference-scene
  contract instead of maintaining a second copy of source parameters.
- Kept the universal rail mounted while switching hazard domains, deferred the
  long onboarding tour so it cannot cover Quick Start, and rejected unknown
  preset links instead of silently loading a different demo.
- Added keyboard, dark/light WCAG, persistence, adapter, preview-camera, direct
  what-if, visual-regression, and cross-domain journey coverage.

## [0.8.5] â€” 2026-07-11 â€” Live-Earth launch cinematic

- Added a skippable five-second launch sequence over the already-mounted live
  Cesium globe, with ocean, impact, and nuclear visual beats that dissolve
  directly into the simulator without a second loading surface.
- Deferred the first-run educational-use notice until after the identity reveal
  while preserving the safety acknowledgement before any runnable action.
- Added first-launch, every-launch, and never preferences plus an in-app Preview
  action in Settings.
- Added Escape, backdrop, and visible Skip exits, a static reduced-motion path,
  deterministic capture controls, accessibility checks, and a visual-regression
  baseline for the opener.

## [0.8.4] — 2026-07-11 — Perceptual visual-quality gate

- Added scene-specific perceptual contracts for all 12 deterministic reference
  scenes: named subjects and phases, central target regions, scale cues,
  forbidden failure cues, measurable detail/change thresholds, and dated
  approved-or-blocked review decisions.
- Reference captures now produce Before / Event / Aftermath frames and a labelled
  review contact sheet while preserving the locked event-frame hashes.
- Added sharpness, dynamic-range, flat-region, changed-pixel, color-delta, and
  target-coverage measurements with synthetic unit tests.
- Added a fail-closed highlight gate so weak analytical captures remain available
  for regression testing but cannot be reused by the opener, scenario library,
  thumbnails, or promotional exports.
- Made direct-effect reference playback seek the Rust-authored frame stream by
  the requested capture phase, enabling deterministic multi-phase review.

## [0.8.3] — 2026-07-11 — Usability and recovery audit

- Fixed solver lifecycle ownership so changing inspector tabs preserves completed
  wave results, replacing a source cancels its in-flight worker, and Compare runs
  can be cancelled independently without terminating the other slot.
- Fixed preset timeline refreshes replacing scientifically identical source
  objects and clearing solver snapshots, max-field products, and exports.
- Closed abandoned snapshot/render channels promptly and report actual streamed
  frame counts and cancellation state instead of claiming a complete run.
- Reset the inspector scroll position when its workspace or tab changes.
- Unified SWE scrubbing and the persistent playback transport around the
  solver's actual one-hour frame range, eliminating contradictory clocks.
- Fixed source editing to clone the active preset into the custom editor,
  replaced the duplicated Compare library with a compact Slot B selector, and
  labelled both comparison solvers explicitly.
- Added strict coordinate and scientific-number validation, persistent nuclear
  weapon preset selection, formatted slider values for assistive technology,
  Escape/outside-click popover handling, and accessible active-control contrast.
- Fixed custom asteroid sources being treated as non-impact events by
  inspection, attenuation, and coastal-runup calculations.
- Hardened settings persistence: failed desktop writes now surface to the user,
  Cesium tokens fail closed when the OS keychain is unavailable, reset clears
  the keychain, future schemas are never downgraded, and imports are capped and
  validated before changes begin.
- Debounced direct-hazard recomputation, retained valid physics results when an
  animation stream fails, exposed calculation errors in the active panel, and
  made effect animation available directly from Setup.
- Throttled renderer and camera telemetry before React state updates, and made
  verification refuse to attach Playwright to an unknown process on its preview
  port.

## [0.8.2] — 2026-07-11 — Adaptive renderer quality

- Added explicit Low, Medium, High, and Cinematic resolution, feature, and GPU
  memory budgets. The live Cesium renderer now applies the persisted tier,
  measures rolling P95 frame time, degrades and recovers one tier at a time
  with hysteresis, and preserves every authoritative solver field and event.
- Added WebGL context-loss detection, a recoverable renderer reset action, and
  renderer adapter/tier/frame-time telemetry to copied support diagnostics.
- Added the RTX 4070 SUPER hardware benchmark for High 1440p/60 and Cinematic
  4K/30 targets, plus professional desktop settings controls for manual and
  automatic quality selection.
- Fixed streaming GPU fallback so CPU execution continues from the last
  committed solver tick instead of restarting and duplicating visible frame
  times after an adapter failure.

## [0.8.1] — 2026-07-11 — Deterministic renderer systems

- Added renderer protocol v1 (`CATRFRM`) as the Rust-owned frame boundary for
  Cesium and future cinematic clients. Length-prefixed scenario/frame/end
  recordings carry authoritative solver ticks, WGS84/ECEF/local-ENU transforms,
  typed hazard events, raw eta/u/v/bathymetry/wet-mask fields, SI units, model
  provenance, and per-field/payload SHA-256. TypeScript and an independent Node
  conformance client reject incompatible versions, corrupt or oversized fields,
  bad sequence/timing, and transform drift. SWE and direct asteroid/nuclear
  playback now consume the protocol; derived exports identify their exact frame.

### Changed — trustworthy accelerated releases
- Split the 2,031-line Cesium globe into generation-owned planet, imagery,
  camera, interaction, source, runup, analytical-overlay, static-hazard, and
  direct-effect systems. Stable handles update in place; async results fail
  closed across viewer generations; every listener, handler, entity, primitive,
  imagery layer, camera flight, and RAF has explicit teardown before Viewer
  destruction. Forty-six unit files include 100-cycle resource/replay tests,
  and the approved asteroid/nuclear frames remain pixel-identical.
- Added an HR-00 visual-truth gate with 12 fixed Earth/hazard scenes at true
  2560×1440 and 3840×2160. Unmasked captures fix scenario time, effect phase,
  UTC, camera, exposure, quality, and bundled Earth assets; sidecars record
  GPU/WebGL, frame timing, renderer, sun vector, exact canvas dimensions,
  source/request/fixture hashes, and asset provenance. Twenty-four hash locks
  require one-scene, one-resolution review with a reason instead of blanket
  baseline replacement; direct-hazard capture fixtures are exact Rust products.
- Asteroid and nuclear direct-effect products now come exclusively from Rust
  commands, including rings, readouts, casualties, fallout dimensions, and the
  detonation timeline. Frozen parity fixtures cover the former TypeScript
  outputs, invalid non-finite inputs fail closed, and browser preview labels
  direct calculations as desktop-only instead of inventing substitute results.
- Added versioned geodesy and shared surface-mask contracts. Rust and Cesium
  validate WGS84 geodetic/ECEF coordinates against three official NOAA GEOID18
  coastal fixtures, and the declared Unreal local frame uses ENU centimetres;
  unsupported vertical-datum conversion now fails closed without model data.
- SWE snapshots, peak-height fields, model provenance, CZML, GeoJSON, text, and
  gauge CSV output now carry horizontal CRS, vertical datum, axis direction,
  units, and declared error metadata instead of relying on bare metre values.
- The solver bathymetry sampler, wet/dry initialization, browser preview, Rust
  surface probe, picked asteroid material, nuclear surface/water response, and
  impact splash/collision response now consume one versioned
  land/ocean/inland-water/ice/coast mask. Ambiguous coast cells remain
  conservative and preserve the selected target material.
- Added a versioned Earth asset registry and build-blocking provenance/rights
  validator covering providers, source URLs, licenses, attribution, bounds,
  resolution, datum, timestamps, integrity, quality tiers, fallback graphs,
  cache/export/redistribution/derivative permissions, policy review dates, and
  desktop CSP compatibility.
- Globe styles and persisted-setting validation now derive from the registry;
  Esri uses ArcGIS service metadata for dynamic credits. Settings shows the
  selected imagery/terrain source contract, support bundles include every
  provider and asset version without secrets, and model exports carry structured
  solver/visual asset IDs plus the registry version.
- PNG, share-card, comparison, and video export now fail closed for unknown or
  prohibited Earth-asset rights and until location-dependent provider credits
  are live; successful still-image exports stamp the applicable attribution.
- Desktop packaging now runs the strict release gate, builds with the Rust
  `gpu` feature, smokes the packaged binary's compiled capabilities without
  opening the UI, and emits a SHA-256 artifact manifest with enabled features.
- Strict release verification now checks, tests, and lints the default, GPU,
  validation, and combined GPU-plus-validation Rust feature configurations.
- Peak height, time-of-peak, first-arrival, and integrated-energy products now
  observe every accepted solver step on CPU and GPU instead of only display
  frames; 12, 60, and 240-frame runs share identical quantitative outputs.
- Tsunami, asteroid, and nuclear workspaces now park incompatible sources,
  overlays, layers, exports, inspection, comparison state, targets, and effect
  animations when switching domains; direct-effect origins are isolated per
  hazard and returning to Tsunami restores its prior scenario without stale
  cross-domain rendering.
- Added domain-transition smoke coverage plus a visually reviewed nuclear
  workspace baseline with an axe check; the active hazard switch now uses a
  theme-specific high-contrast foreground.
- Offline startup, missing-token providers, initialization faults, and repeated
  tile failures now converge on bundled Natural Earth II with explicit
  connecting, ready, degraded, fallback, and failed health states. Retrying the
  selected online provider preserves the active simulation workspace.
- Gauge CSV exports now neutralize ASCII and full-width spreadsheet formula
  initiators in every text column while preserving trusted numeric columns for
  machine-readable round trips.
- Both desktop themes now use contrast-safe semantic text accents across Setup,
  Results, Layers, Compare, direct Impact/Nuclear results, Settings, and imagery
  recovery. Preset instances have unique ARIA IDs, filter buttons use pressed
  semantics, and source/inspector tabs implement roving arrow/Home/End focus.
- Added a dedicated two-theme WCAG AA browser suite covering 16 simulator states
  plus explicit duplicate-ID checks and keyboard tab-pattern regression tests.

## [0.8.0] — 2026-07-11 — Living-Earth simulator visual system

### Changed — professional desktop workflow
- Re-imagined the simulator from a new image-generated v2 desktop design target
  and implemented the major parity gaps without replacing the React/Cesium
  architecture: source-first setup, stronger Earth dominance, restrained
  technical surfaces, and a clearer command/transport hierarchy.
- Rebuilt the scenario library around metadata-derived Recorded events and
  What-if studies, source-specific glyphs, compact physical metadata, and
  complete selected, busy, search, filter, timeline, focus, and empty states.
- Added a source-model summary with coordinates, depth, magnitude, model
  provenance, edit action, and confidence treatment before solver controls.
- Added a surface-displacement legend, camera altitude/coordinate telemetry,
  heading-aware north indicator, broader Tōhoku/Pacific framing, HDR rendering,
  and theme-aware Cesium source labels.
- Made the primary propagation action visible before advanced solver options,
  clarified ocean-depth/pressure-wave language, added frame telemetry, and
  replaced the misleading six-hour transport in direct Impact/Nuclear modes
  with truthful effect-renderer status.
- Clarified Settings with explicit Cancel / Apply Changes behavior, unsaved-state
  feedback, user-oriented categories, simpler online-map wording, and a
  multi-hazard first-run trust notice.

### Added — design and visual verification
- Added `assets/mockups/cataclysm-professional-simulator-v2.png` as the retained
  image-generation target used for implementation comparison.
- Made headless capture build-safe and deterministic in locale, timezone,
  reduced-motion, service-worker, font, camera, and canvas-settle behavior while
  preserving high-detail Esri imagery for inspected README captures.
- Re-captured dark/light 1600×1000 workspaces and Settings, and deliberately
  refreshed all nine desktop visual-regression baselines after inspection.

### Verification
- 153 Vitest tests and all 23 Playwright smoke, keyboard, accessibility, and
  visual-regression checks pass locally in both themes. Typecheck, lint,
  production build, docs/security gates, Rust checks/tests, and Windows package
  generation are part of the v0.8.0 release verification.

## [0.7.0] — 2026-07-11 — Professional simulator workspace

### Changed — desktop GUI and workflow hierarchy
- Rebuilt the application shell around four persistent simulator zones: a
  filterable scenario library, dominant globe viewport, Setup / Results /
  Layers inspector, and full-width simulation transport.
- Consolidated the command bar into hazard modes, inspect/compare tools, a
  grouped export menu, references, and settings. Exported files now use
  `cataclysm-*` names while legacy storage/event identifiers remain compatible.
- Added a real inspector workflow: propagation and source configuration stay in
  Setup, engineering metrics and observations stay in Results, and live layer
  availability is visible in Layers.
- Reworked Settings into categorized Visuals & map, Performance, and Advanced
  sections with a persistent save footer; refreshed first-run and simulator
  terminology throughout the visible UI.
- Comparison globes now split horizontally on desktop. Solver/playback status is
  derived from application state instead of displaying a permanent ready label.

### Added — visual QA and design reference
- Added a generated professional-simulator design reference under
  `assets/mockups/` and implemented its restrained graphite/cyan visual system,
  dense technical typography, tabbed inspector, and transport hierarchy.
- Added reproducible dark/light desktop screenshot capture via
  `npm run capture:screenshots`; replaced stale README imagery with verified
  1600×1000 captures.
- Expanded Playwright visual coverage to nine desktop states, including both
  themes, first run, active scenarios, solver states, Settings, References, and
  diagnostics. Keyboard and WCAG A/AA browser paths remain covered.

### Verification
- 144 Vitest tests, 14 Playwright smoke/keyboard checks, nine desktop visual
  regression states, lint, typecheck, production web build, Rust checks/tests,
  dependency audit gates, and Windows installer build.

## [0.6.0] — 2026-07-10 — Cataclysm: unified multi-hazard simulator

### Project unification
- **Renamed TsunamiSimulator → Cataclysm** and expanded scope from a tsunami
  simulator to a full multi-hazard disaster simulator. Product name, window
  title, bundle identifier (`com.sysadmindoc.cataclysm`), crate/package names,
  and all provenance/export brand strings updated. Version 0.5.0 → 0.6.0.
- **Absorbed AsteroidSimulator and NukeMap.** Both repos merged in via
  `git subtree` under `legacy/asteroid` and `legacy/nukemap` (full history
  preserved) as the reference for the ongoing UI-parity rebuild.

### Added — unified hazard engine layer (`src/hazards/`)
- **Common `HazardResult` contract**: any hazard resolves to globe-ready effect
  rings (meters), a structured readout, and an optional casualty estimate, so
  new hazards render without touching the Cesium layer. Engine registry in
  `src/hazards/index.ts`.
- **Nuclear engine** (`src/hazards/nuclear/`): NukeMap's `physics.js` ported to
  typed, pure TypeScript — `calcEffects` (fireball, 200/20/5/3/1 psi, thermal
  1°/2°/3°, 500-rem/neutron/gamma radiation, EMP, crater, fallout plume, cloud
  top, base surge, water-burst wave height), Bayesian combined-mortality
  casualty model, and formatters. Curated 9-weapon preset table (Hiroshima →
  Tsar Bomba).
- **Asteroid engine** (`src/hazards/asteroid/`): AsteroidSimulator's physics
  (energy, RK4 atmospheric entry, Holsapple cratering, thermal, airblast,
  seismic, ejecta, impact tsunami) ported in and wrapped to the unified contract.
- **Tests**: two new hazard suites — nuclear regression against HSAJ/NWFAQ
  reference radii and casualty monotonicity; asteroid calibration (Chelyabinsk
  airburst, Chicxulub cratering, ocean-impact tsunami). Full unit suite: 135 tests.

### Added — hazard-mode UI (UNI-01/02/03/04/07)
- **Hazard-mode switch** in the header (Tsunami / Impact / Nuclear). Tsunami keeps
  the Rust scenario path; Impact and Nuclear use the client-side `src/hazards`
  engines.
- **Cesium ring renderer** (`Globe` `hazardRings`/`hazardCenter` props): draws
  `HazardResult` effect zones as concentric, outlined ground ellipses (largest
  first) with a ground-zero marker, and frames the outermost ring. Shared by both
  nuclear and asteroid modes — replaces NukeMap's Leaflet `js/effects.js`.
- **`HazardControls`** panel: weapon-preset picker + log-scale yield slider +
  burst-type + population-density (nuclear); diameter/velocity/angle/density/target
  (asteroid); pick-location-on-globe; live readout, casualty estimate, and ring
  legend bound to the engine result.
- **Tests**: `HazardControls` component suite (+3) and a Playwright smoke test
  that switches to Nuclear mode and asserts the controls + weapon table render.
  Unit suite 138; browser-preview smoke 7/7.

### Notes
- Remaining NukeMap breadth (fallout plume, shelter advisor, WW3 exchange, MIRV,
  immersive + mushroom-cloud, location/ZIP search, target datasets) is scoped as
  `UNI-05/06/08..14` in `ROADMAP.md`. The standalone NukeMap and AsteroidSimulator
  apps stay live until those land and Cataclysm deploys with parity.

## [0.5.0] — 2026-07-09 — Validation, corrected physics, classroom tooling

### Changed — toolchain and supply chain (2026-07-09)
- **`rust-version` raised 1.85 → 1.88.** The declared floor was below the real
  requirement: wgpu/naga 29 needs 1.87 and time-core 0.1.9 needs 1.88.
- **Cargo dependency refresh.** tauri 2.11.2 → 2.11.5, wgpu 29.0.3 → 29.0.4,
  plist pinned to 1.10.0 so quick-xml resolves to 0.41.0 — clears all three
  open RustSec advisories (RUSTSEC-2026-0194/0195 quick-xml DoS,
  RUSTSEC-2026-0204 crossbeam-epoch). `cargo audit` is clean again.
- **CesiumJS 1.142 → 1.143.** Billboard crash fix plus
  `PathGraphics.materialMode` groundwork for arrival-time-colored paths.
- **DOMPurify floor gate.** `scripts/verify.mjs` now fails if any resolved
  dompurify in package-lock.json drops below 3.4.7 (CVE-2026-49978 floor), so
  a lockfile regression can't silently reopen the sanitizer bypass.

### Added — model-vs-observed trust loop (2026-07-09)
- **DART RMSE surfaced in the buoy overlay.** Running the SWE solver on a
  preset with archived DART data (Tōhoku 2011, Indian Ocean 2004, Hunga Tonga
  2022) now samples the model field at each buoy position (hidden `dart-<id>`
  gauge points) and shows per-buoy RMSE, model-vs-observed peak amplitude, and
  sample count under each sparkline via the `dart_buoy_rmse` IPC. Buoys whose
  observations start after the 60-minute solver window show an explicit
  "no overlap" note instead of failing silently.
- **`attenuation_curve` Rust IPC.** The wave-attenuation chart now renders
  decay samples computed by the backend (same amplitude branch as
  `far_field_amplitude`) instead of reimplementing the r^(-5/6) / r^(-1/2)
  power laws in JS — closing the last physics-in-JS carve-out outside the
  browser-preview demo layer. Browser preview keeps a demo approximation.

### Added — max-field products and arrival isochrones (2026-07-09)
- **fgmax-style max-field products.** The solver now accumulates per-cell
  peak |η|, time-of-maximum, and a time-integrated η² energy proxy at
  snapshot cadence (identical CPU/GPU semantics — both observe the read-back
  field). A new Overlay selector in the playback panel switches the globe
  between the live wave, "Peak", "T max" (viridis), and "Energy"
  (qualitative directivity, explicitly not a calibrated PTWC product).
- **First-arrival isochrones.** Marching-squares contours of the
  first-arrival time (|η| ≥ max(1 cm, 1% of source amplitude)) at 5-minute
  multiples, chained into labelled dashed polylines on the globe behind an
  "Arrivals" toggle, and exported as MultiLineString features in the
  GeoJSON export.

### Added — property-based physics tests (2026-07-09)
- **proptest suites over the physics parameter space** (`physics::property_tests`):
  Ward–Asphaug cavity monotonicity in diameter and velocity, amplitude
  saturation at water depth, Synolakis runup positivity/monotonicity (with
  the H/d = 0.78 breaking-gate saturation), SWE closed-basin mass
  conservation (zero-flux, linear, 1% tolerance), and Okada uplift
  boundedness in the pure-thrust regime.

### Fixed — Okada vertical-displacement kernel (2026-07-09)
- **Strike-slip u_z term corrected against Okada 1985.** Property testing
  exposed non-physical growth of |u_z| with fault length for strike-slip
  rakes (up to 7.4×slip on a 302 km rake-0° fault, even at 49 km burial).
  Root causes, confirmed against the reference okada85.m
  (IPGP/deformation-lib): (a) the eqn.-25 strike-slip vertical term used
  `atan(ξη/qR)` where `q·sinδ/(R+η)` belongs; (b) the I4/I5 elastic factor
  used α = 2/3 (DC3D's (λ+μ)/(λ+2μ) convention) where the 1985 I-terms
  take μ/(λ+μ) = 1−2ν = 0.5; (c) the Chinnery substitution used the
  fault-top depth where Okada's `d` is the DOWN-DIP edge depth. The kernel
  is rewritten 1:1 against the reference and now validated to 4 significant
  figures against Okada 1985 Table 2 cases 2 and 3 (strike/dip/tensile),
  plus a boundedness regression on the case that exposed the bug. The
  Tōhoku thrust band still passes; oblique-rake presets (Indian Ocean 2004,
  rake 110°) now compute slightly different — correct — fields. The
  property test runs the full 0–180° rake domain again.

### Fixed — GPU solver path actually runs (2026-07-09)
- **The `gpu` feature could never execute before.** Three stacked latent
  bugs, found the first time the feature was run rather than merely
  compiled: (1) wgpu was built with no platform backend, so
  `Instance::default()` panicked at the first probe — Vulkan/Metal now
  enabled (dx12 excluded: wgpu-hal 29.0.x's dx12 suballocator does not
  compile against gpu-allocator 0.28 + windows-core 0.61/0.62 upstream);
  (2) the device was requested with downlevel limits (4 storage buffers)
  while the kernel binds 7 — now requests 8 clamped to adapter limits;
  (3) the GPU sponge test used CFL 0.4 where the explicit scheme needs 0.3.
  The CPU/GPU parity suite now actually executes on hardware, including a
  new full-physics parity test (nonlinear advection + sponge + Manning,
  |Δη| < 5 mm after 60 steps) locking the 2026-07-01 divergence fix.

### Added — teacher mode (2026-07-09)
- **Classroom profile lock.** Settings export/import now carries a
  `classroom_locked` flag: an imported teacher profile pins globe imagery,
  theme, and colormap and hides token entry, with an explicit Unlock action
  (a convenience lock, deliberately not a security boundary).
- **Printable lesson worksheets.** Every guided lesson (all 7) now carries
  four worksheet prompts and a "Print worksheet" button that prints a clean
  handout — title, summary, numbered questions with ruled answer space,
  name/date line, and the educational-model disclaimer — via a dedicated
  print-mode stylesheet.

### Added — keyboard-only e2e coverage (2026-07-09)
- **Keyboard walkthrough Playwright spec.** The golden path (activate a
  preset card, run the solver, scrub the timeline with arrow keys, export
  the text report) now runs entirely without pointer events, plus a
  focus-trap check that Tab cycles stay inside the Settings dialog and
  Escape closes it. Audit note: decorative `UiIcon` SVGs were already
  correctly `aria-hidden` with labelled host buttons — the earlier research
  claim of missing icon labels was wrong.

### Changed — Cesium ion token moved to the OS keychain (2026-07-09)
- **The ion token no longer lives in settings.json.** Desktop builds store
  it in the OS keychain (Windows Credential Manager / macOS Keychain /
  Linux Secret Service) via the `keyring` crate called directly from two
  new IPC commands — no thin community plugin wrappers, and
  tauri-plugin-stronghold is deprecated for Tauri v3. Legacy plugin-store
  tokens migrate to the keychain on first read and the store copy is
  blanked; a broken secret service falls back to the store path so users
  aren't locked out. Browser preview keeps localStorage (unchanged).

### Added — support diagnostics bundle (2026-07-09)
- **`diagnostics_bundle` IPC + "Copy diagnostics" in the log viewer.** One
  click copies a JSON support bundle: app version, OS/arch, GPU status and
  adapter name, solver backend, settings schema version, and the last 50
  log entries. PII-free by construction — no paths, tokens, or settings
  values.

### Added — new cited presets (2026-07-09)
- **Kamchatka 2025-07-29 M_w 8.8** — USGS finite-fault parameters
  (us6000qw60), the most DART-instrumented tsunami in history — with a
  bundled DART validation pack: stations 21416, 21419, 21415 from the NDBC
  historical archive, harmonically de-tided (residual RMS < 0.5 cm; the
  0.84 m peak at 21416 matches NCTR's published 0.85 m — the second-largest
  DART amplitude ever recorded). Model-vs-observed RMSE works out of the box.
- **Sanriku (Miyako) 2026-04-20 M_w 7.4** (USGS us6000sri7) with a
  "the warning worked" guided lesson: tide-gauge detection 17 minutes
  after rupture, and why magnitude alone misleads.
- **Lisbon 1755** — Barkan, ten Brink & Lin 2009 preferred far-field source
  (Horseshoe Plain, Table 4 verbatim), with source-debate caveat.
- **Amorgos 1956** — Okal et al. 2009 relocated normal-faulting source,
  with the explicit caveat that triggered submarine landslides (not the
  fault) drove the 30 m local runup.
- **Anak Krakatau 2018** — Grilli et al. 2019 flank-collapse parameters
  (0.27 km³, bulk density 1550 kg/m³, caldera depth 250 m).
- **2024 YR4 what-if** (speculative-flagged) with an "anatomy of a viral
  tsunami myth" guided lesson quoting NASA's airburst assessment; Earth
  impact is ruled out and the preset explains why even the upper bound
  is modest.

### Added — educational features
- **Physics glossary tooltip system.** 15 domain terms (Mw, SWE, Okada,
  Synolakis, DART, CFL, runup, eta, cavity radius, attenuation, Boussinesq,
  Manning friction, leapfrog, wavefront, inundation) show inline tooltips on
  hover/focus with brief definitions and citations. Keyboard-accessible.
- **Print stylesheet for classroom handouts.** `Ctrl+P` produces a clean
  white-background page with readable results, source parameters, citations, and
  model-limitation disclaimers. Interactive chrome and globe canvas are hidden.
- **Settings export/import for classroom deployment.** Export saves a JSON file
  (excludes cesium_token). Import validates and applies with unknown keys skipped.
- **Gauge placement from globe inspect mode.** When inspect mode is active and a
  point is clicked, an "Add gauge" button appears in the inspect banner. Clicking
  it creates a gauge at that lat/lon.

### Added — export & accessibility
- **Comparison-mode export.** A "Compare" export button captures both globe
  canvases side-by-side in a single PNG with scenario labels and provenance.
- **Viridis colormap.** Third colormap option (perceptually uniform sequential,
  dark-purple → teal → yellow) alongside diverging and cividis. Passes
  protanopia and deuteranopia simulation.

### Fixed — Rust solver and validation
- **CPU/GPU solver eta divergence fixed.** CPU momentum step now uses pre-step
  η for the pressure gradient, matching the GPU leapfrog kernel. Both paths
  produce identical wavefronts for the same input. Sponge test updated to use
  CFL 0.3 for stability with the explicit scheme.
- **`far_field_amplitude` now uses caller-supplied `decay_alpha`.** Was accepted
  and validated but silently ignored in favor of hardcoded exponents. Now wired
  through with [0, 3] bounds.
- **Earthquake `water_depth_m` validated.** `earthquake_initial_conditions` now
  enforces [0, 12000] m range, consistent with asteroid and nuclear sources.
- **Cancel token uses Release/Acquire ordering.** `Relaxed` was correct on x86
  but could delay cancellation on ARM. All stores use `Release`, all loads use
  `Acquire`.

### Changed — verification & security
- **CSP allowlist verification gate.** `scripts/verify.mjs` now parses the
  configured CSP from `tauri.conf.json` and fails if new exceptions are
  introduced without updating the documented allowlist.

### Fixed — audit pass
- **5 undefined `--subtext0` CSS token references.** SWE gauge coordinates,
  remove buttons, peak readout, and lesson step/icon text were resolving to
  black in both themes. Fixed to `--subtext`.
- **Hardcoded focus ring ignoring theme.** Input focus ring used Mocha-blue
  `rgba(116, 199, 236, 0.25)` instead of theme-aware `var(--focus-ring)`.
- **3 hardcoded `rgba(0,0,0)` shadows.** Globe status badge, hint card, and
  preset hover shadows looked harsh in Latte theme. Replaced with theme tokens.
- **Skip-link using undefined `--surface` token.** Fixed to `--surface0`.
- **Text export showing wrong hemisphere labels.** Southern/western coordinates
  displayed as `-33.86° N` instead of `33.86° S`. Fixed with absolute-value
  formatting.
- **App header version badge drift.** Hardcoded `v0.4.4` string replaced with
  `APP_VERSION` import from model-provenance to prevent version drift.
- **Settings import/reset not applying theme visually.** Import and Reset now
  call `applyTheme()` so the change takes effect immediately.
- **GlossaryTip clipped by overflow ancestors.** Added viewport-edge clamping
  so tooltips reposition when they would render outside the viewport.
- **Scenario URL size guard.** `scenarioFromUrl` now rejects payloads over
  10 KB to prevent out-of-memory on crafted deep links.
- **Settings import prototype pollution guard.** `importSettings` now skips
  `__proto__`, `constructor`, and `prototype` keys and rejects non-object JSON.

### Fixed — deep audit pass 2
- **GPU VRAM budget heuristic caused spurious CPU fallback.** The total-VRAM
  check compared 10× per-buffer size against max_storage_buffer_binding_size,
  rejecting medium grids that fit comfortably in VRAM. Removed in favor of the
  correct per-buffer limit check.
- **Lamb wave latitude correction used source latitude for all cells.** The
  `apply_lamb_wave` function used source latitude for the longitude-to-meters
  cosine correction instead of each cell's own latitude, causing range errors
  on wide grids. Fixed to use cell latitude.
- **CPU momentum gradient read unmasked η from dry-land neighbors.** The
  pressure gradient terms in the CPU solver read raw eta from neighboring cells
  without land-mask checks, producing spurious currents at coastlines. Now uses
  the same land-aware sampling as the GPU kernel.
- **Antarctica missing from shelf-taper bounding boxes.** The `nearest_land_deg`
  function omitted Antarctica from its land boxes despite `is_land` including
  it, preventing shelf tapering near the Antarctic coast.
- **Loading spinner rendered as rounded square.** Used `var(--r-md)` (8px)
  instead of `border-radius: 50%` for a proper circular spinner.
- **Coordinate-entry inputs and Go button invisible in Latte theme.** Border
  color matched background (both `--crust`), producing invisible borders. Fixed
  to use `--surface1`.
- **Undefined `--r-xs` CSS token.** Preset view toggle used an undefined
  `--r-xs` token (fell back to hardcoded 4px). Replaced with `--r-sm`.
- **GlossaryTip popup positions stuck after clamping.** Inline styles from
  viewport-edge clamping persisted after popup close/reopen. Now reset on each
  open.
- **KML export missing single-quote XML entity escape.** `escapeXml` now
  escapes `'` as `&apos;` for complete XML safety.
- **Settings import success suppressed by prior save error.** `saveErr` was not
  cleared on successful import, preventing the success message from appearing.
- **Keyframe definitions scattered across files.** `pulse`, `spin`, and
  `indeterminate` keyframes moved from `_globe.css` to `_animations.css`
  alongside `modal-in`.

### Changed — performance & maintenance
- **CPU solver eliminates per-step Vec clones.** `step_one()` no longer clones
  eta_m, u_ms, v_ms (~96 MB for a 4M-cell grid) every time step. A reusable
  `SolverScratch` buffer set persists across steps and is swapped into the grid
  with `std::mem::swap` in O(1).
- **Dead `is_impact` field removed from `FarFieldRequest`.** The field was
  unused since `decay_alpha` now drives the far-field computation.
- **npm dependencies refreshed.** 9 packages updated within semver ranges
  (Tauri CLI 2.11.4, Playwright 1.61.1, Vite 8.1.2, etc.).
- **styles.css split into 25 component-scoped partials.** Original 3534-line
  monolith reorganized into `src/styles/*.css` with `@import` entry point.
  Build output is functionally identical.

## [0.4.4] — Deep correctness, reliability & UX hardening

### Changed — verification
- **Strict release verification now fails closed on missing Rust policy tools.**
  `npm run verify:release` requires `cargo-audit` and `cargo-deny`; normal
  developer verification still warns when optional Rust policy tools are absent.
- **Runup/inundation overlays now use Cesium buffer collections.** The globe
  renders coastal runup bars and inundation discs through CesiumJS
  `BufferPolylineCollection` / `BufferPolygonCollection` payloads instead of
  rebuilding per-point geometry instances.
- **Local verification now guards docs/script drift.** `scripts/verify.mjs`
  scans public docs for missing `npm run <script>` references and stale local
  Markdown links before running the heavier build/test gate.

### Changed — documentation
- **Public support links repaired.** README now points shipped-feature readers to
  the tracked changelog, and CONTRIBUTING no longer references a missing
  `SECURITY.md` file for vulnerability reports.
- **Removed stale history-doc link.** README no longer points to the absent
  `docs/history/` directory.
- **Shipped-science docs synced to v0.4.4.** Cleared stale "planned" / "v0.3.0"
  references for the now-shipped Okada I-term, wgpu GPU solver, Lamb-wave
  coupling toggle, and local-only verification. Updated README architecture
  diagram, presets.rs Hunga Tonga blurb, solver/validation doc-comments,
  Cargo.toml comments, and science docs (earthquake, landslide, VALIDATION).
- **Unsigned-installer checksum verification guidance.** README Install section
  now shows PowerShell/CMD commands to verify SHA256 against the release-page
  `checksums-sha256.txt`. CODESIGNING.md updated with maintainer checksum
  generation steps and an expanded release checklist.

### Added — guided lessons
- **Teacher-friendly guided scenario path.** Five annotated lessons
  (Chicxulub extinction, Tōhoku 2011 megathrust, Lituya Bay record runup,
  Poseidon propaganda vs physics, Hunga Tonga Lamb-wave coupling) launch from
  a "Guided lessons" section in the preset selector. Each lesson auto-selects
  its preset and walks through 3-4 educational steps explaining source choice,
  propagation physics, model limitations, and next steps.
- **Guided lesson completion now persists.** Pressing Done on a lesson records
  a completion timestamp in settings, and the preset rail shows completed
  lesson badges across reloads.

### Added — user-placed gauges
- **User-placed gauges with CSV time-series export.** Users can place named
  gauges at arbitrary lat/lon coordinates in the SWE panel. Each gauge computes
  an analytical eta time series from the demo source model and displays an
  inline SVG sparkline. All gauge series can be exported as a single CSV with
  columns: gauge_name, lat_deg, lon_deg, time_s, eta_m, solver_mode,
  bathymetry_source. Four new tests cover CSV format, escaping, empty input,
  and multi-gauge output.
- **Desktop gauge CSVs now sample Rust SWE fields.** Tauri solver requests carry
  bounded gauge coordinates, each returned `GridSnapshot` includes per-gauge
  eta samples from the Rust grid, and desktop gauge sparklines/CSV exports use
  those backend samples while browser preview keeps the approximate demo sampler.

### Added — dependency refresh cadence
- **`npm run deps-check` command.** Reports npm outdated packages, npm audit
  results, and cargo-audit/cargo-deny install status with a recommended
  weekly/monthly/quarterly refresh cadence. CONTRIBUTING.md documents the
  cadence and links to the command.

### Added — visual regression
- **Screenshot-backed visual regression tests.** 11 Playwright tests capture
  desktop (1440×900) and narrow (390×844) states for first-run disclaimer,
  active preset cockpit, SWE solver ready/running, Settings modal, Citations
  modal, and log viewer. Cesium WebGL canvas is masked; UI chrome is compared
  against committed PNG baselines with `toHaveScreenshot()`. Axe WCAG A/AA
  scans included for first-run, Settings, and narrow first-run states.

### Added — settings versioning
- **Schema-versioned settings store.** Both the Tauri plugin-store and
  localStorage now carry a `_settings_schema_version` key. Legacy unversioned
  stores are migrated on first read, future/unknown versions log diagnostics
  and fall back to defaults, and `resetAll` preserves the version stamp.
  Five new tests cover migration, fallback, and round-trip scenarios.

### Changed — accessibility & rendering
- **Automated WCAG A/AA regression checks.** Five axe-core Playwright tests
  now gate local verification across the first-run dialog, main cockpit,
  Settings, LogViewer, and a preset-active cockpit. Violations fail the build.
- **Runup overlays migrated to Cesium Primitive API.** Cylinder bars and
  inundation discs now render as batched `CylinderGeometry` /
  `EllipseGeometry` primitives instead of per-point entities. Labels remain
  as entities (Cesium labels are entity-only). Scales to thousands of coastal
  points without entity-system overhead.
- **WCAG 2.2 AA touch targets.** Scenario field help buttons enlarged from
  18 px to 24 px minimum to meet WCAG 2.5.8.
- **Colour contrast bumped.** Muted overlay text raised from Catppuccin
  Overlay0 (#6c7086) to Overlay1 (#7f849c) and active preset card
  blurb/meta promoted to `--text` for WCAG AA compliance on the active
  card background.
- **Semantic fixes.** App title changed from `<span>` to `<h1>`;
  status bar changed from `<footer role="status">` to `<div role="status">`;
  Settings globe-style `<select>` labelled with `aria-label`.
- **Stale keyboard shortcut docs removed.** Manual no longer advertises
  unimplemented F6/F7/F8 shortcuts; all toggle features have visible UI
  controls.

### Fixed — physics correctness
- **Synolakis 1987 coastal run-up corrected.** `synolakis_runup_m` multiplied
  by the offshore *amplitude* instead of the offshore *depth*, so every run-up
  / inundation figure (overlay bars, Inspect readout) under-predicted by a
  factor of `d/H`. The implementation now matches the documented
  `R = 2.831·√(cot β)·H^(5/4)/d^(1/4)` Carrier-Greenspan form, and the
  feature-gated `synolakis_matches_carrier_greenspan_envelope` validation —
  previously failing by up to 100 % — now passes. Added a non-gated
  closed-form regression test so the default suite guards it.
- **Non-finite seismic magnitude eliminated.** A custom landslide with
  `drop_height_m = 0` (admitted by the IPC validator) produced zero kinetic
  energy and a `-inf` `seismic_mw_equivalent` that crossed the IPC boundary
  into the UI. A shared, floored `mw_from_radiated_j` helper now backs the
  asteroid, nuclear, and landslide magnitude paths.
- **Latent NaN sources guarded** in the asteroid cavity-scaling (zero diameter
  / out-of-range angle), nuclear cavity radius (negative burst depth →
  cube-root of a negative number), and Lamb-wave envelope (zero source radius
  → `cos(NaN)` at arrival).

### Fixed — reliability & safety
- **Root render recovery added.** The React root is wrapped in a calm error
  boundary with retry/reload actions, and global `error` /
  `unhandledrejection` events are routed into the diagnostics log.
- **Saved and shared scenarios now have a schema boundary.** Copy/save writes a
  versioned payload, legacy unversioned scenarios migrate on load/paste, and
  invalid clipboard or store payloads are rejected with specific inline
  feedback before they can alter visible scenario state.
- **Scenario slot race fixed.** Selecting a preset now invalidates any
  in-flight custom scenario IPC response so a slow custom result cannot
  overwrite the preset the user just chose.
- **GeoJSON export coordinates hardened.** Inundation export now clamps
  polar/non-finite edge inputs before writing geometry so generated GeoJSON
  does not contain invalid `null` coordinates.
- **SWE Cancel now reaches the Rust worker.** The playback Cancel button
  signals a server-side cancellation token, and the CPU/GPU stepping loops poll
  it between short batches so long simulations bail out promptly instead of
  only dropping the eventual response in the UI.
- **`simulate_grid` compute budget.** The cell count and step count were each
  capped but their *product* was not, so a single request could wedge the
  blocking worker for minutes. A combined cell-steps budget now rejects
  pathological requests up front.
- **`simulate_grid` polar/longitude robustness.** A source beyond ±80°
  latitude no longer builds an inverted (degenerate, silently blank) grid, and
  the source longitude is normalised so the returned bbox stays inside the
  frame Cesium expects. Longitude validation is now a single canonical ±180°
  contract across every command.
- **GPU SWE path.** Fixed a missing `bytemuck` dependency that meant the `gpu`
  feature never compiled. The GPU readback no longer advances simulated time
  over a failed/garbage field — it returns a clean failure so the dispatcher
  falls back to the CPU — and the dispatcher only routes all-wet grids to the
  (linear, land-mask-free) kernel so it can't re-flood continents.
- **SWE sponge boundary** is now applied (thinner) on small grids instead of
  silently reverting to reflective edges.
- **Preset registry** now has a test asserting every shipped preset satisfies
  the same input bounds the live `*_initial_conditions` commands enforce, and
  `find_preset` no longer rebuilds the whole registry on each lookup.

### Fixed — UX & accessibility
- **SWE action label drift fixed.** Manuals and component tests now use the
  current **Run solver** button label, and stale component/e2e assertions were
  refreshed to match the polished empty, chart, diagnostics, Settings, and
  saved-scenario UI states.
- **Muted cockpit contrast fixed.** Waiting badges and footer helper text now
  meet the WCAG AA contrast gate covered by the Playwright axe checks.
- **Bathymetry confidence wording corrected.** README, first-run copy, globe
  style text, and export metadata now state that the solver uses a coarse
  offline bathymetry approximation and that inundation overlays are first-order
  estimates, not operational GEBCO-backed flood products.
- **GEBCO_2026/TID target documented.** Bathymetry docs, coastal-point
  provenance, SWE solver UI, and shared export metadata now label the current
  bathymetry as a low-confidence coarse basin/shelf approximation and name the
  future GEBCO_2026 Type Identifier confidence path without claiming it ships.
- **Colorblind-safe SWE overlays.** Settings now persist a SWE colormap choice:
  the classic blue→red ramp remains the default, with a CVD-safe Cividis
  option for playback PNG overlays.
- **Custom number fields are editable again.** Scenario-builder inputs held a
  draft string and clamp on blur, so clearing a field to retype no longer
  snaps it to its minimum on every keystroke.
- **Failures are no longer silent.** Preset/scenario IPC errors, preset-list
  load failures (with retry), and PNG/share/video export failures now surface
  a visible toast / inline status instead of only a console log.
- **Diagnostics feedback hardened.** The log viewer now tolerates circular
  console payloads, surfaces clipboard-copy failures, and Settings save/reset
  status is announced to assistive technology instead of being visual-only.
- **Solver diagnostics now reach the app log.** GPU fallback, VRAM precheck,
  readback, and PNG encode failures now flow from Rust into LogViewer via a
  Tauri event, and previously silent settings/tour/cancel Promise failures log
  contextual warnings.
- **Visual regression gate stabilized.** Modal screenshots now hide the Cesium
  canvas instead of masking over dialog content, and the desktop/narrow
  baselines were refreshed from the current production render so the visual
  suite passes repeatably.
- **Scenario sharing clipboard guard.** Copy/Paste now reports when the
  Clipboard API is unavailable instead of throwing from the primary scenario
  workflow.
- **Modal focus management.** Settings, Citations, first-run, and tour dialogs
  now move focus inside on open, trap Tab/Shift-Tab, and restore focus on close
  (WCAG 2.4.3 / 2.1.2).
- **Globe NaN-proofing.** The Inspect readout and run-up labels coalesce
  non-finite physics to an em dash, the SWE imagery layer rejects non-finite
  bounding boxes before handing them to Cesium, stale wavefront rings are torn
  down when the source clears, and the Inspect readout now uses the source’s
  real water depth instead of a hardcoded 4000 m.
- Inspect uses the live viewer instance (not a stale closure); the dev-mode
  StrictMode remount no longer leaves a blank globe; SWE Play restarts from the
  top at the final frame and stays usable after Cancel; the Settings Save
  button shows a saving state; the timeline tolerates a non-finite time.

### Fixed — security & DX
- **Citation and Settings external links now fail closed.** The desktop
  `shell:allow-open` capability is synced to a centralized exact-URL policy:
  citation HTTPS links must match the reviewed list, the two remaining HTTP
  papers are documented legacy exceptions, and blocked citation rows show a
  visible alert instead of attempting an unmanaged shell open.
- **Exports now share a provenance payload.** PNG, share-card, text, CZML,
  GeoJSON, and KML exports include app version, generated timestamp, scenario
  type, solver mode, bathymetry source, citation reference/URL, and the
  educational-only model limitation.
- **Local verification contract restored.** Added `npm run verify` as the
  single local gate for typecheck, lint, Vitest, production build, `npm audit`,
  Playwright smoke/a11y coverage, Rust check/test/clippy, and optional
  `cargo-audit` / `cargo-deny` checks when those tools are installed.
- **Local toolchain doctor added.** `npm run doctor` now reports Node, npm,
  Rust/Cargo, Tauri CLI, MSVC linker availability, optional `cargo-audit` /
  `cargo-deny`, workspace path risk, and the Vitest shared-folder fallback
  flags with actionable pass/warn/fail output.
- **DOMPurify advisory cleared.** Added an npm override so Cesium's transitive
  DOMPurify dependency resolves to the patched `3.4.11` line.
- **npm audit is clean at low severity.** Lockfile and npm overrides now keep
  the current Cesium/Vite toolchain on patched DOMPurify, Babel, and esbuild
  lines.
- **High-risk frontend workflows now have regression coverage.** Added tests
  for ScenarioBuilder save/load/delete/copy/paste errors, Settings token/reset
  controls, SWE streaming progress/cancel/snapshot handoff, and a Playwright
  saved-scenario round trip. The e2e preview server now uses a strict
  repo-specific port so tests cannot attach to an unrelated local app.
- **Rust backend tests compile again.** Updated the stale
  `SimulateGridRequest` validation fixture so `cargo test` covers the current
  colormap-aware IPC shape.
- CSP/permissions: tightened the `shell:allow-open` allow-list (scoped Forbes
  to the cited author path, added the explicit repo URL with a trailing-slash
  glob).
- Production builds now **fail loudly if a personal `VITE_CESIUM_TOKEN` would
  be inlined** into the distributable bundle (override with
  `ALLOW_TOKEN_IN_BUNDLE=1`).
- Settings store uses a read-only init probe so it no longer writes an
  `__init_probe` key into the user’s `settings.json`; the video exporter has a
  watchdog so a missing `MediaRecorder` stop event can’t hang forever; export
  filenames neutralise Windows reserved device names and clamp length.
- App version string corrected to `v0.4.0` (was a stale `v0.2.1`); refreshed
  stale "planned / scaffold" docs for the now-shipped Okada and GPU kernel code.

## [0.4.4] - 2026-06-28 - Secondary cockpit state polish

### Changed
- Refined source readouts, attenuation charts, SWE solver controls, DART
  observations, diagnostics, citations, and tour progress so secondary
  surfaces match the cockpit polish level.
- Added clearer waiting/ready/running/error state badges, chart legends,
  source-location summaries, solver setup chips, and diagnostic severity
  counts.
- Improved responsive guardrails for compact data strips in narrow layouts.
- Refreshed the README visual-tour screenshots against the current v0.4.4
  Natural Earth cockpit, SWE playback, comparison mode, scenario builder, and
  citations modal.
- Published the v0.4.4 release contract around locally built Windows MSI/NSIS
  installers; the current artifacts remain unsigned until a Windows
  code-signing certificate is configured.

### Fixed
- Settings now initializes to the Natural Earth default before persisted values
  load, avoiding an old OSM flash in the modal state.
- Synced package, Tauri, Cargo, README badge, and visible app metadata to
  `0.4.4`.
- Fixed Cesium pick/inspect handler cleanup so cancelling globe-pick mode and
  entering comparison mode no longer trips the runtime recovery boundary with
  a destroyed-object error.

## [0.4.3] - 2026-06-26 - Premium cockpit polish

### Changed
- Made Natural Earth II the local-first default globe style so first launch no
  longer depends on network tiles; token-gated imagery failures now fall back
  to Natural Earth instead of OSM.
- Rebuilt the header into grouped analysis, export, and utility command zones
  with a desktop density rule that prevents toolbar clipping at 1280px.
- Refined preset cards, search, empty states, source badges, scenario utility
  actions, saved-scenario states, modal surfaces, tour cards, and diagnostics
  styling for a more cohesive premium cockpit.
- Tightened Settings and first-run microcopy around local-first imagery,
  official warnings, model limits, and privacy of optional Cesium ion tokens.

### Fixed
- Fixed the clipped first/last toolbar controls that could hide Inspect or
  Settings in the 1280px browser preview.
- Synced package, Tauri, Cargo, README badge, manual, and visible app metadata
  to `0.4.3`.

## [0.4.2] - 2026-06-19 - Premium interaction-state polish

### Changed
- Refined the first-run notice into a clearer trust-and-limits brief with
  stronger scanning, official-warning guidance, and model-limit cards.
- Upgraded unavailable header actions from inert disabled buttons to reachable
  controls that explain what is needed before Inspect, export, CZML, or GeoJSON
  actions can run.
- Strengthened the empty globe state with a clearer ready panel and tightened
  the narrow-viewport globe height so mobile users reach presets sooner.
- Settings now reports browser-preview GPU state honestly instead of leaving the
  GPU probe in a perpetual "Checking hardware..." state.

### Fixed
- First-run onboarding now starts after the disclaimer acknowledgement event
  instead of waiting for a later settings save or subsequent launch.
- Synced package, Tauri, Cargo, README badge, and visible app metadata to
  `0.4.2`.

## [0.4.1] - 2026-06-16 - Premium UX polish pass

### Changed
- Refined the main cockpit with a persistent status band, cleaner header
  hierarchy, compact SVG icon controls, and a calmer educational-only status
  treatment that avoids header crowding.
- Added searchable preset selection with result counts, selected-state icons,
  clearer preset metadata, and improved loading / empty states.
- Strengthened first-run, tour, Settings, SWE playback, DART, citations,
  diagnostics, scenario builder, and results-panel polish with clearer copy,
  explicit states, consistent button semantics, and reduced shortcut clutter.
- Replaced fully-rounded UI backdrops with the app's tighter radius system,
  improved focus/hover affordances, and added an indeterminate SWE progress
  treatment for long-running simulations.
- Refreshed README screenshots against the polished desktop cockpit.

### Fixed
- Removed confirmation-dialog dependency from Settings reset/dismiss actions in
  favor of inline status feedback.
- Reworked export filename sanitisation to avoid the ESLint no-control-regex
  blocker while preserving Windows-safe filenames.
- Synced package and Tauri metadata to `0.4.1`.

## [0.4.0] - 2026-05-25 — Premium polish + GPU SWE + Lamb-wave coupling

### Premium polish pass
- **App shell layout fixed and refined**. The first-launch Cesium token
  banner now owns a dedicated grid row instead of displacing the presets,
  globe, and results panels. Desktop keeps the intended three-column
  simulation cockpit; narrow viewports stack into banner, header, globe,
  presets, and controls without horizontal overflow.
- **Toolbar and component system upgraded**. Header actions now use a
  consistent inline-SVG icon treatment, refined active/disabled states,
  improved spacing, and mobile wrapping so all primary commands remain
  discoverable.
- **Primary workflow polish**. Preset cards, source readouts, scenario tabs,
  form fields, SWE controls, empty states, and speculative/caution tags now
  share a more coherent visual system with stronger hierarchy and cleaner
  microcopy.
- **Modal and onboarding refinement**. Settings, citations, disclaimer, and
  tour dialogs now have stronger semantics, calmer copy, consistent spacing,
  and polished status badges for saved, warning, muted, and error states.

### Hardening audit
- **Cesium token storage tightened**. Desktop builds no longer mirror
  `settings.cesium_token` into WebView `localStorage`; older mirrored
  values are migrated into `tauri-plugin-store` when available and then
  purged from `localStorage`. Settings reads now validate corrupted
  theme/style/timestamp values before applying them.
- **IPC edge-case guards expanded**. `far_field_amplitude`,
  `coastal_runup`, `runup_at_points`, `inspect_at_point`,
  `lamb_wave_sample`, and `simulate_grid` now reject non-finite,
  out-of-range, or physically impossible inputs before they can produce
  NaN/Inf outputs across the Tauri boundary. `dart_buoy_rmse` filters
  non-finite model samples and rejects no-overlap series instead of
  returning a NaN success.
- **Browser-preview Inspect fixed**. The Inspect tool now uses the
  deterministic demo math when Tauri IPC is unavailable, so README /
  browser QA sessions no longer log `inspect_at_point` failures.
- **Release workflow activation fixed**. Code-signing and updater
  manifest steps now gate on job-level secret-presence flags; the
  previous step-local env checks could skip signing even when secrets
  existed. Updater manifest generation now fails fast if a signed
  installer or `.sig` file is missing.
- **Export cleanup hardened**. Video export clamps caller-provided
  duration/fps/bitrate, stops capture-stream tracks after recording, and
  refuses to download empty encoder output. Download filenames are
  sanitized before being handed to the browser.
- **Preset/custom race fixed**. Starting a custom scenario now invalidates
  any in-flight preset request immediately, preventing slow preset
  responses from overwriting the custom source.

### v0.4.0 batches
- **F4-01 — wgpu SWE dispatch loop**. Full GPU compute path landed:
  ping-pong storage buffers for η/u/v, dispatch loop with bind-group
  alternation, three readback buffers mapped in parallel, restartable
  across multiple `step` calls (host-side eta/u/v re-uploaded at the
  start of each call). `commands::simulate_grid` now probes the
  adapter when compiled with `--features gpu`; on success runs the
  GPU path and surfaces a `used_gpu: bool` flag on the response so
  the UI badge reads "Live SWE Solver (GPU)" instead of "(CPU)".
  Linux/CI runners without an adapter fall back to CPU cleanly. New
  `swe_gpu_matches_cpu` regression test asserts < 1e-3 m agreement
  between GPU and CPU on a 17×17 flat-ocean Gaussian over 50 steps.
  Manning friction + nonlinear advection in the WGSL kernel
  deferred to v0.5.0.
- **F4-02 — Nonlinear momentum advection**. `SolverMode::Nonlinear`
  is the new default for live `simulate_grid`; computes
  `(u·∇)u` with first-order upwind differencing for stability across
  the steepening shock front. Validation harness opts into
  `SolverMode::Linear` for the Stoker dam-break case.
- **F4-05 — Lamb-wave coupled into SWE solver IC**. New
  `SwGrid::apply_lamb_wave` + `SimulateGridRequest.include_lamb_wave`
  flag wired through `SwePlayback` checkbox. Hunga Tonga 2022
  preset's `controversy_note` updated to reflect partial coupling.
- **F4-06 — DART buoy RMSE IPC**. New `dart_buoy_rmse` command
  computes time-series RMSE between bundled observations and model
  samples; linear-interpolates between bracketing model samples.
- **F4-07 — Lituya Bay validation case**. New entry in the
  `physics::validation` harness runs Heller-Hager + Synolakis at
  Gilbert Inlet geometry; asserts peak runup lands in [200, 1000] m.
- **F4-09 — Branded share-card export**. New `exportGlobeShareCard`
  composites the globe canvas with a 200-px-tall header strip
  carrying preset name, peak amplitude, Mt-TNT energy, citation
  short-ref, project URL. 1200×800 PNG suitable for social posts.
- **I4-04 — Cesium `setView` for reduced-motion users**. Replaces
  `flyTo({ duration: 0 })` so motion-sensitive users skip the
  single-frame jitter on preset switches.
- **I4-05 — Centralised `lib/data.ts` bundled-JSON loader**.
  `CoastalRunupOverlay` and `DartOverlay` now route through
  `getCoastalPoints()` / `getDartEvents()` with validation +
  caching at the boundary.

### Accessibility
- **Skip-to-globe keyboard link** (WCAG 2.4.1). First Tab from any
  page state surfaces a top-of-page link that jumps focus past the
  dense header straight to the globe `<main>` (now `tabIndex={-1}
  id="main-globe"`).
- **First-launch Cesium-token banner**. Dismissible inline banner
  above the header on first launch prompts the user to paste an
  ion token in Settings for satellite imagery; auto-hides once a
  token is set or the user clicks ✕. Dismissal persisted via new
  `settings.token_banner_dismissed_at`. Settings → Reset to
  defaults re-arms the banner.

### Release / supply chain (scaffolded, awaiting maintainer inputs)
- **F-V04 + F-V07 scaffolds** — `release.yml` now emits a Tauri
  updater `latest.json` manifest conditional on
  `TAURI_SIGNING_PRIVATE_KEY` and runs Windows Authenticode +
  macOS notarisation steps conditional on the documented secret
  slots. New `docs/release/CODESIGNING.md` documents the 8 secret
  slots + activation runbook.

### Docs
- **F-V03 — README screenshots + animated demo**. Added five
  production-build screenshots under `assets/screenshots/` plus an
  animated Chicxulub playback GIF, then embedded the gallery in the
  README visual tour.
- **Per-source science notes**. New `docs/science/{asteroid,
  nuclear,earthquake,landslide,shallow_water,lamb_wave}.md` — each
  documents the formula, paper citation, validation case, and
  known caveats. `docs/science/README.md` links them.
- **`VALIDATION.md` refreshed** to reflect the v0.4.0 batch — adds
  rows for the Lituya Bay runup test (F4-07), `dart_buoy_rmse`
  math + edge-case tests (F4-06), and the `swe_gpu_matches_cpu`
  regression test (F4-01). The "Future benchmarks" section
  splits the deferred DART RMSE *display* (frontend integration)
  from the now-shipped DART RMSE *math* (Rust IPC).

### Globe imagery
- **Token-invalid fallback toast**. When the user has explicitly
  chosen a Cesium-ion-backed style (Cesium World Imagery /
  Bathymetry) and the upstream call fails (most often: 401 invalid
  token), the OSM fallback path now surfaces a `role="status"`
  toast over the globe instead of falling back silently. Reads
  "Cesium ion imagery unavailable (invalid token or upstream error)
  — fell back to OSM." Token-less style swaps to OSM-default
  remain silent (they're the documented path).

### Tests
- **`commands::dart_buoy_rmse_skips_out_of_range_obs`** — asserts
  observations outside the model time range are skipped (not
  extrapolated) while still registering in `observed_peak_m`.
- **`commands::dart_buoy_rmse_interpolates_between_samples`** —
  asserts the linear-interp midpoint lookup is correct.
- **`commands::dart_buoy_rmse_rejects_out_of_range_location`** —
  asserts buoy lat > 90° is rejected at the boundary.

### GPU diagnostics
- **`gpu_probe` IPC**. New Tauri command returns
  `"available" | "no-adapter" | "feature-off"`. Lets the frontend
  surface GPU status without paying a full `simulate_grid`
  round-trip. Settings panel grows a new "GPU acceleration (F4-01)"
  section that calls the probe lazily on first open and renders
  one of three colour-coded statuses.

### SWE playback UX
- **Browser preview demo path**. `npm run dev` / `vite preview` now
  render deterministic demo presets, custom-scenario readouts, runup
  points, and SWE frames when Tauri IPC is unavailable. The desktop
  app still uses the Rust backend; the browser path exists for local
  visual QA and documentation capture.
- **Cancel button on in-flight simulations**. `SwePlayback`
  surfaces a Cancel button next to the Computing… state; clicking
  bumps the `reqIdRef` so the response is dropped on arrival and
  the UI returns to idle. The Tauri worker keeps running to
  completion (the IPC layer has no cancel signal yet) so this is
  UI-side defence-in-depth; a future Tauri command + cancel token
  can make it a true server-side cancel.
- **Settings → Advanced → Show token banner again**. Clears the
  first-launch banner's dismissed-at timestamp so it re-arms on
  the next settings-saved event (still gated on the user having
  no token set).

### Earlier v0.3.0 batch (now part of the v0.4.0 release)

### Solver fidelity
- **Full Okada 1985 I-term half-space correction** (F-V02). Tōhoku peak
  vertical magnitude now lands in the [1, 30] m band per Fujii-Satake
  2013 (was ~10× over-predicting in v0.2.x). Wired `OkadaFault` into
  `earthquake_initial_conditions` so EarthquakeSource scenarios report
  the physics-based peak directly.
- **Wet/dry land cell masking** (I-V01). Cells with
  `h <= LAND_DEPTH_THRESHOLD_M (1.01 m)` are excluded from the leapfrog
  update; neighbour land cells contribute zero flux. Eliminates the
  v0.2.x "slow-spread halo" over continental interiors.
- **Sponge-layer boundary conditions** (F-V10). New
  `BoundaryMode { ZeroFlux, Sponge }` enum on `TimeStepper`; default
  switched to `Sponge { width_cells: 10 }` with a cosine taper that
  absorbs outgoing waves over the rim. Long-running simulations no
  longer reflect the wavefront back into the source.
- **Quantitative validation harness** (F-V01). New `physics::validation`
  module behind a `validation` cargo feature. Three benchmark tests:
  Stoker dam-break wave-front position (±25 %), Carrier-Greenspan plane-
  beach runup vs. Synolakis closed-form (±25 % across H/d ∈ [0.005, 0.3]),
  Range 2022 Chicxulub far-field at r = 220 km (OOM). New
  `docs/science/VALIDATION.md`.
- **Hunga Tonga atmospheric Lamb-wave source** (F-V09). New
  `physics::lamb_wave` module + `lamb_wave_sample` Tauri command.
  Closed-form pressure pulse + ocean coupling + Proudman resonance
  depth surfaced. Carvajal 2022 / Matoza 2022 / Kubota 2022 cited.
  SWE-solver IC integration deferred to v0.4.0.

### Power-user UX
- **Click-on-globe Inspect overlay** (F-V11). New header toggle + new
  `inspect_at_point` IPC; clicking the globe pops a Cesium label with
  range / arrival / offshore amplitude / Synolakis runup / inundation
  extent at the clicked point.
- **MP4 / WebM timeline export** (F-V08). `exportGlobeVideo()` via
  browser-native MediaRecorder + canvas.captureStream. Picks the first
  supported video MIME from a candidate list (WebM/VP9 → VP8 → MP4
  H.264 → MP4 generic) so it works on Chromium WebView2 and Safari
  WKWebView. 6 s @ 30 fps @ 6 Mbps default.
- **Inundation polygons** (I-V02). First-order
  `runup_m / tan(slope)` extent on `RunupAtPoint`; rendered as semi-
  transparent severity-coloured ellipses on the globe. True marching-
  squares flood polygons land in v0.4.0 once F4-04 + real GEBCO arrive.
- **Per-preset curated camera framings** (F-V13). New
  `physics::CameraView` + `Preset.camera_view`; populated for all 11
  presets (Lituya 50 km fjord, Chicxulub 5 Mm continent, etc.).
  `flyTo` honours the curated view when present, else falls back to
  the heuristic cavity-radius auto-clamp.
- **5-step onboarding tour** (F-V12). New hand-rolled `Tour.tsx` (no
  react-joyride dep), six positioning variants, keyboard nav
  (Enter/→/←/Esc). Triggered after first-run disclaimer acknowledged.
  Settings → Advanced → "Replay tour" clears the ack.
- **Settings → Advanced**. New "Show first-run again" + "Replay tour" +
  "Reset to defaults" buttons. Each behind a confirm.
- **Runup-bar hover labels** (I-V09). Cesium LabelGraphics with arrival
  time T+HhMM, runup m, offshore amp m. Distance-display-condition
  limits labels to <3 Mm camera range.

### Accessibility & trust
- **No-FOUC theme bootstrap** in `index.html` — applies `data-theme`
  from `localStorage` before React mounts. Returning Latte-theme users
  no longer see a Mocha→Latte flash on launch.
- **Global `:focus-visible` ring** on every interactive element (I-V07
  expanded) — Tab navigation now has a visible focus indicator.
- **`:disabled` button treatment** — disabled actions read as such.
- **`@media (prefers-reduced-motion: reduce)` overrides** (I-V06) — drop
  transitions / hover lift / pulse; Cesium `flyTo` shortens to 0 s.
- **`role="status" aria-live="polite"`** on SwePlayback error + new
  screen-reader-only announcer in CoastalRunupOverlay reporting
  "N coastal points reached" transitions (I-V07).
- **`.sr-only` utility** for visually-hidden screen-reader content.
- **`<noscript>` fallback** in `index.html`.
- **External anchor hardening** — `target="_blank" rel="noopener
  noreferrer"` so middle-/right-click can't navigate the Tauri WebView.

### IPC + supply-chain hardening
- **Every `*_initial_conditions` Tauri command now returns
  `Result<InitialDisplacement, String>`** and validates finite,
  in-range inputs. Stops NaN/Inf from poisoning the physics layer.
- **`runup_at_points`** returns `Result` with a 2 000-point cap.
- **`simulate_grid`** rejects non-finite `source_sigma_m` /
  `mean_depth_m` / `n_snapshots == 0`.
- **`run_preset`** validates `time_s` / `mean_depth_m` and clamps
  `n_samples` to `[2, 2 000]`.
- **`shallow_water::synolakis_runup_m`** rejects NaN / negative
  inputs (uses `|amplitude|`).
- **`solver::run_simulation`** caps total leapfrog steps at 1 000 000
  and rejects non-finite `dt_s` so a pathological CFL value can't
  wedge the worker thread.
- **`CoastalRunupOverlay`** filters bundled coastal-points JSON to
  in-range lat/lon at load.
- **`cargo audit` promoted to fail-on-vuln** (I-V03). Baseline clean
  at v0.2.1; any future Dependabot bump introducing a RUSTSEC-listed
  crate now blocks CI.
- **GitHub Actions bumped to v5** (I-V05) — `checkout`, `setup-node`,
  `upload-artifact`, `download-artifact` all v5; Node 22.

### GPU solver scaffold
- **F-V05 scaffold** — `[features] gpu` cargo flag + `wgpu` 26 +
  `pollster` 0.4 optional deps + `physics::solver::gpu` module +
  `GpuAvailability` adapter probe + `GpuTimeStepper` skeleton.
  Full buffer-binding + dispatch loop deferred to v0.4.0.

### Tests
- **New `presets::tests`** — preset ID uniqueness, non-empty metadata,
  controversy-note presence on speculative entries, finite
  initial-displacement outputs across every preset.
- **New `commands::tests`** — validation rejects NaN/zero/out-of-range
  inputs across all four source types; `run_preset` rejects unknown
  id and clamps absurd `n_samples`; `haversine_m` handles same-point
  + NaN.
- **`physics::okada::tests`** — re-enabled the two previously
  `#[ignore]`d tests (Tōhoku peak in [1, 30] m + strike-slip bounded
  by slip).
- **`physics::solver::tests`** — new `land_cells_stay_dry`,
  `sponge_boundary_absorbs_rim`, `zero_flux_boundary_opts_out_of_sponge`.

### Cleanup
- Dropped unused deps: `zustand`, `@types/cesium`, `ndarray`.
- Dropped dead `forceRender()` no-op in `lib/export.ts`.
- Removed dead `let _ = ...` suppressors + `i_d * 0.0` dead branch in
  `physics::okada`.
- Fixed `clippy::manual_saturating_arithmetic` on the SWE grid pre-
  allocation gate.
- Fixed `clippy::manual_clamp` on the inundation-extent computation.

### Blocked / deferred from v0.3.0 (carried to v0.4.0)
- **F-V04** Code signing — needs maintainer EV cert + Apple Developer enrollment.
- **F-V07** `tauri-plugin-updater` — needs maintainer-generated Ed25519 keypair.
- **I-V04** OS-keychain token — Tauri 2 keychain plugin ecosystem still emerging.
- **F-V06** GEBCO_2026/TID-backed bathymetry — needs distribution-channel decision.

### Planned for v0.4.0+
See `docs/history/RESEARCH_FEATURE_PLAN_v0.4.0.md` for the full v0.4.0 forward plan:
F4-01 wgpu dispatch loop, F4-02 nonlinear advection, F4-03 real GEBCO,
F4-04 wet/dry flood polygons, F4-05 Lamb-wave SWE coupling, F4-06
DART buoy RMSE display, F4-07 Lituya validation, F4-09 share-card
export, F4-10 Boussinesq solver, F4-11 AMR, F4-12 multi-language UI,
plus the carried-forward Phase 3 blocked items above.

---

## [0.2.1] - 2026-05-25 — Hot-fix + hardening

### Fixed
- **CRITICAL**: pressing **Run simulation** on v0.2.0 produced a blank
  globe with no animation. Cesium 1.104+ deprecated the synchronous
  `new SingleTileImageryProvider(...)` constructor and in 1.124 the
  provider's `ready` state never flips, so the SWE PNG layer was
  silently dropped. Switched to the async `.fromUrl(url, { rectangle })`
  factory with a cancellation guard. Also fixed an imagery-rebuild
  effect that nuked overlay layers on globe-style swap mid-simulation —
  the base layer is now removed surgically and `lowerToBottom`'d so
  overlays stay above it.

### Hardening
- IPC commands now enforce explicit bounds and finite-value guards:
  `runup_at_points` returns `Result` with a 2 000-point cap;
  `simulate_grid` rejects non-finite `source_sigma_m` / `mean_depth_m`
  / `n_snapshots == 0`; `run_preset` clamps `n_samples` to `[2, 2 000]`
  and validates `time_s` / `mean_depth_m`.
- Every `*_initial_conditions` Tauri command now returns
  `Result<InitialDisplacement, String>` and validates finite,
  in-range inputs (no more NaN/Inf poisoning the physics layer).
- `shallow_water::synolakis_runup_m` rejects NaN/negative inputs and
  uses `|amplitude|` so a negative leading-trough sample never
  produces NaN runup (previously `powf(5/4)` of negative → NaN poisoned
  every downstream colour-ramp cell).
- `solver::run_simulation` caps total leapfrog steps at 1 000 000 and
  rejects non-finite `dt_s` so a pathological CFL value can't wedge the
  worker thread.
- `Cesium.Rectangle` clamp guards a dateline-straddling scenario from
  constructing an invalid rectangle and blanking the entire scene.
- `CoastalRunupOverlay`: defensive filter drops out-of-range lat/lon
  before the IPC batch.

### UX & accessibility
- Synchronous theme bootstrap in `index.html` reads `localStorage`
  before React mounts so the Latte (light) theme no longer flashes
  through Mocha on launch.
- Global `:focus-visible` ring on every interactive element — Tab
  navigation now has a visible focus indicator.
- `:disabled` visual treatment on `button` so disabled actions read as
  such instead of looking identical to enabled ones.
- External citation links carry `target="_blank" + rel="noopener
  noreferrer"` so middle-/right-click can't navigate the Tauri WebView
  off the React app.
- `ResultsPanel` timeline progress clamps to ≥ 0.
- `<noscript>` fallback in `index.html` for a clear message if the
  WebView fails to bootstrap.

### Tests
- New `presets.rs` test suite: preset ID uniqueness, non-empty metadata,
  controversy-note presence on speculative entries, finite
  initial-displacement outputs for every preset.
- New `commands.rs` unit tests: validation rejects NaN/zero/out-of-range
  inputs across all four source types; `run_preset` rejects unknown id
  and clamps absurd `n_samples`; `haversine_m` handles same-point and
  NaN safely.

### Cleanup
- Dropped dead `forceRender()` no-op from `lib/export.ts`.
- Dropped unused `zustand` (npm) + `@types/cesium` (npm) + `ndarray`
  (cargo) dependencies.
- Removed dead `let _ = ...` suppressors + the `i_d * 0.0` branch in
  `physics::okada`. Kept the `ALPHA` constant under `#[allow(dead_code)]`
  for the v0.3.0 I-term wiring.
- README / SECURITY.md / CONTRIBUTING.md / `.env.example` /
  `data/bathymetry/README.md` synced with the v0.2.x reality (no-token
  default, shipped installers, working SWE solver, etc.).
- Fixed `clippy::manual_saturating_arithmetic` on the SWE grid-size
  pre-allocation gate.

---

## [0.2.0] - 2026-05-25 — Phase 0.2

Working SWE physics, runup overlay, DART overlay, side-by-side comparison, multi-globe selection, no-token-required default.

### Added — Backend (Rust)
- **F2 working CPU SWE solver** (`physics::solver`) — leapfrog with `rayon` row-parallel updates via `par_chunks_mut`. Continuity + linearised momentum + Manning bottom friction + zero-flux boundaries. CFL-safe `recommended_dt_s()` based on max √(gh). Snapshots are PNG-base64 with a diverging blue↔red colormap, ready for Cesium `SingleTileImageryProvider`. `run_simulation(grid, stepper, t_end, n_snapshots)` end-to-end driver.
- **F5 leading-order Okada 1985** (`physics::okada`) — Chinnery-notation surface integral over the four fault corners. Strike-slip + dip-slip + tensile vertical components. Rake decomposition. `From<&EarthquakeSource>` adapter. The full half-space I-term correction is deferred to v0.3.0; the leading-order form over-predicts magnitudes by ~10× but has correct sign / lobe shape.
- **F4 offline bathymetry** (`data::bathymetry`) — coarse basin-mean depth (Pacific 4280 m, Atlantic 3646 m, Indian 3741 m, Southern 3270 m, Arctic 1205 m, Mediterranean 1500 m, Caribbean 2400 m per Charette & Smith 2010) + continental-shelf taper within 5° of land. Zero for land. Wired into `simulate_grid` via the new `use_real_bathymetry` toggle.
- **F6 runup batch command** (`commands::runup_at_points`) — Haversine + far-field decay + Synolakis 1987 closed-form. Returns `RunupAtPoint { id, name, lat, lon, range, offshore_amp, runup_m, arrival_time, has_arrived }`.
- New Tauri command `simulate_grid` exposing the SWE solver to the frontend with bounded grid-size guard (4 M cells max).

### Added — Frontend (React + TS)
- **SwePlayback** component — runs the SWE solver, scrubs through 24 snapshots, paints each as an imagery layer over the globe. Toggle for coarse offline bathymetry.
- **DartOverlay** component — sparkline charts of observed water-surface elevation at 6 DART buoys across Tohoku 2011 / Indian Ocean 2004 / Hunga Tonga 2022. Cursor synced to the timeline scrubber.
- **Side-by-side comparison mode** (F7) — header `⇆ Compare` toggle splits the central column into two stacked globes with two preset selectors. Both share `timeS` but otherwise run independently. Slot tags colour-coded sapphire/pink.
- **Multi-globe-style selector** — 5 imagery options:
  - OpenStreetMap (default, no token)
  - Esri World Imagery satellite (no token)
  - Natural Earth II (bundled with Cesium, no network)
  - Cesium World Imagery (token required)
  - Cesium World Bathymetry terrain (token required)
- **PNG export** of globe view (F10 first slice).
- 60-point coastal database (`src/data/coastal_points.json`) covering all 12 preset regions.
- DART buoy database (`src/data/dart_buoys.json`) covering 3 modern events.

### Changed
- App is now **usable without any Cesium ion token** — OpenStreetMap is the default base layer.
- Settings storage hardened: every write mirrors to `localStorage` so a future `tauri-plugin-store` regression cannot silently lose user data.
- Capability `store:default` alias expanded to explicit `allow-load/get/set/save/has/keys/entries/clear/delete/reload` permissions to fix token-not-persisting bug on some platforms.
- CSP `connect-src` + `img-src` extended to allow `tile.openstreetmap.org` and `*.arcgisonline.com`.

### Fixed
- Token entered via Settings dialog now persists across restart.
- `Globe.tsx` no longer hides itself when a token is missing.
- v0.1.0 macOS release-workflow bash 3.2 `globstar` regression (carried over).
- Several internal CI-only Rust lifetime / move-closure issues.

### Planned for v0.3.0
- Side-by-side comparison mode (synchronized timelines)
- Hunga Tonga atmospheric Lamb-wave source
- DART buoy historical overlay for 2011 Tōhoku / 2004 Sumatra / 2022 Hunga Tonga
- Inundation polygons (wetting/drying SWE)
- Scenario export (PNG/MP4/CZML deep-link)

### Planned for v1.0.0
- Boussinesq dispersive solver (FUNWAVE-TVD-style)
- Adaptive Mesh Refinement (GeoClaw-style)
- Code signing (macOS Gatekeeper, Windows Authenticode)
- `tauri-plugin-updater` auto-update channel
- Population casualty overlay (opt-in)

---

## [0.1.0] - 2026-05-25 — Phase 0.1

First release with a buildable installer. Globe + presets work end-to-end; physics is point-source only (real propagation lands in v0.2.0).

### Added — Backend (Rust)
- `EarthquakeSource` now carries `fault_length_m` / `fault_width_m` with Wells–Coppersmith 1994 fallback scaling. Tōhoku + Sumatra presets pre-fill with Fujii–Satake 2013 / Lay 2005 finite-fault values.
- **Krakatoa 1883** preset (Choi 2003 / Maeno–Imamura 2011 caldera collapse), fixing the README/code drift.
- `Preset` struct carries `reference_url`, `is_speculative`, `controversy_note`.
- `tauri-plugin-store` wired for persistent app-data settings.
- Capabilities `shell:allow-open` tightened to an explicit citation-host allowlist (cesium.com, doi.org, agupubs, science, nature, sciencedirect, researchgate, forbes, tsunamisociety, lanl, nuclearsecrecy, NOAA, GEBCO, OpenTopography, Natural Earth, Clawpack, and the repo).

### Changed — Backend
- `physics::shallow_water::sample_wavefront` switched from log-spaced to front-clustered linear sampling (80% of samples on the leading edge band).
- `commands::run_preset` derives propagation depth from the preset's source water depth when caller passes `mean_depth_m: 0`; eliminates the hardcoded 4000 m bug that broke Lituya Bay arrival times.

### Removed — Backend
- `_suppress_unused_mt_constant` dead-code function in `nuclear.rs`.
- Vestigial `matches!(..)` dead-code suppressor in `commands.rs`.

### Added — Frontend (React + TypeScript)
- **Tabbed scenario builder** (Asteroid / Nuclear / Earthquake / Landslide) — all four IPC commands are now exposed in the UI with bounds-checked inputs.
- **Click-globe-to-set-location** — Pick on Globe button toggles pick mode; the Cesium screen-space click handler reports cartographic coords, Esc cancels.
- **Settings modal** — Cesium ion token paste field, theme toggle, store-backed persistence in `app_data_dir/settings.json`.
- **First-run disclaimer modal** — not-for-evacuation notice shown exactly once; ack timestamp persisted.
- **Citations modal** — full peer-reviewed reference list with click-through (rejected if outside `shell:allow-open` allowlist).
- **Catppuccin Latte light theme** alongside Mocha dark default, toggleable in Settings.
- Speculative presets sort below historical and display a ⚠ icon + amber left-border + controversy note tooltip.
- Globe `cylinder` entity renders the impact cavity in 3D (height = cavity_depth/2.83 per Ward–Asphaug parabola); fly-to range clamped 0.5 Mm – 8 Mm.
- Globe wavefront entities updated **in-place** on time-scrub (no add/remove thrash).
- Empty-state hint when no preset is active; loading badge while Cesium World Bathymetry tileset streams; error badge on tile-load failure; NaN guard on amplitude=0 case.

### Changed — Frontend
- App.tsx no longer duplicates Schmidt–Holsapple math in JavaScript — custom scenarios route through Tauri IPC, browser preview surfaces a console warning instead.
- `vite.config.ts` `rollupOptions.manualChunks` splits Cesium (4.1 MB) and React (194 KB) into separate chunks. App shell minified to 26 KB.
- `Globe.tsx` lazy-loaded via `React.lazy` + `Suspense`.

### Added — Build & Release Infrastructure
- `assets/branding/logo.svg` master + generated `src-tauri/icons/*` (PNG, ICO, ICNS, iOS, Android variants).
- `.github/workflows/ci.yml` — PR + push + dispatch triggers; frontend job (tsc + vite); Rust job 3-OS matrix (ubuntu/windows/macos) with cargo check + test --release + clippy -D warnings; audit job with cargo-audit.
- `.github/workflows/release.yml` — workflow_dispatch with tag + prerelease inputs; 3-OS matrix; auto-uploads msi/exe/dmg/deb/AppImage/rpm/zip/tar.gz; macOS universal-apple-darwin target.
- `.github/dependabot.yml` — weekly npm + cargo, monthly GH Actions, grouped tauri/cesium/react updates.
- `.github/ISSUE_TEMPLATE/{bug,preset-request,physics,config}.yml` + PR template.
- `CONTRIBUTING.md` and `SECURITY.md`.

---

## [0.0.1] - 2026-05-24 — Scaffold

Initial repo scaffold with all source-physics formulas encoded but no propagation solver yet. Details in v0.0.1 git history.
