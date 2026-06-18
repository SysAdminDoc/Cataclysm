# Changelog

All notable changes to TsunamiSimulator. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — Deep correctness, reliability & UX hardening

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
- **Bathymetry confidence wording corrected.** README, first-run copy, globe
  style text, and export metadata now state that the solver uses a coarse
  offline bathymetry approximation and that inundation overlays are first-order
  estimates, not operational GEBCO-backed flood products.
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
- **npm audit is clean at low severity.** Updated the lockfile to
  `@babel/core` 7.29.7 and added a direct/overridden `esbuild` 0.28.1 dev
  dependency while keeping the known-good Vite 7.3.5 build line.
- **High-risk frontend workflows now have regression coverage.** Added tests
  for ScenarioBuilder save/load/delete/copy/paste errors, Settings token/reset
  controls, SWE streaming progress/cancel/snapshot handoff, and a Playwright
  saved-scenario round trip. The e2e preview server now uses a strict
  repo-specific port so tests cannot attach to an unrelated local app.
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
- **F-V06** Real GEBCO 2024 — needs distribution-channel decision.

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
