# Research — Cataclysm
Date: 2026-07-14 — replaces all prior research. An incremental external scan the
same day (dependency changelogs, competitor/community signal, standards) added the
"Emerging Capabilities & Physics-Breadth" section below and its roadmap items; the
trust-boundary analysis is unchanged and still leads.

## Executive Summary

Cataclysm v0.10.4 is a local-first Tauri desktop laboratory for educational tsunami, asteroid, and nuclear-hazard exploration. Its strongest current shape is the combination of Rust-authoritative physics, fail-closed scientific contracts, reproducible provenance, CPU/GPU SWE playback, and a polished Cesium workspace that remains explicitly non-operational. The previous research file was stale: its headline correctness defects are fixed in `CHANGELOG.md:61-110` and commits `aa4565b` through `94506a8`. The highest-value direction is therefore trust-boundary closure, not another hazard: (1) transactional settings/keychain mutation; (2) redacted, visible crash diagnostics; (3) solver-derived and correctly labelled DART validation; (4) installed MSI/NSIS end-to-end testing; (5) unambiguous scenario migrations; (6) typed, recoverable export failures; (7) expiring Rust advisory exceptions; (8) automated grid/time convergence evidence; (9) resolution-adequacy preflight; and (10) a durable local run archive. Lower-priority citation and GeoPackage work improves scientific reuse without changing the product boundary.

## Product Map

- Core workflows: choose one of 17 Rust presets or build asteroid, nuclear, earthquake, and landslide sources; run CPU/GPU SWE propagation; scrub frames, gauges, DART observations, maxima, and coastal screening; compare two scenarios; export visual and scientific artifacts.
- Supporting workflows: guided lessons, onboarding/classroom lock, saved and URL-shared scenarios, settings profiles, diagnostics, dark/light themes, and direct asteroid/nuclear effect timelines.
- Personas: educators, students, science communicators, hazard enthusiasts, and exploratory researchers; explicitly not warning centers, evacuation planners, or engineering-design users.
- Platforms/distribution: Windows MSI/NSIS is the verified release surface; macOS/Linux are source-build targets; browser preview is illustrative; native mobile is not a supported product.
- Integrations/data flows: typed React/Tauri IPC into Rust physics; checksummed renderer packets into Cesium; bundled bathymetry, surface/geodesy contracts, coastal points, and NOAA DART data; optional Esri/OSM/Cesium imagery; OS-keychain Cesium token; provenance-gated PNG/video/CZML/GeoJSON/KML/CSV/text exports.

## Competitive Landscape

- **GeoClaw** — Verified: mature AMR, wet/dry inundation, fixed-grid maxima, and NOAA-style validation. Learn its convergence discipline and resolution-aware hierarchy. Avoid implying Cataclysm's coarse regular grid is an operational inundation model before the existing wet/dry and local-data roadmap lands.
- **Tsunami-HySEA** — Verified: GPU propagation, NetCDF interoperability, versioned releases, Zenodo, and `CITATION.cff`. Learn its machine-readable scientific identity and reproducible benchmark artifacts. Avoid CUDA/SYCL specialization and GPL code reuse in this MIT, cross-platform stack.
- **SWEpy** — Verified: open GPU far-/near-field workflows, benchmarked output, and research-oriented field interchange. Learn its explicit separation of model scales and verification products. Avoid replacing the current Rust authority with a second Python execution stack.
- **BROWNI and Celeris** — Verified: low-friction interactive GPU simulation makes wave science approachable in browsers. Learn immediate feedback and measurement-driven visualization. Avoid growing `src/lib/demo.ts` into a second physics authority; the existing Rust-to-WASM roadmap is the safer convergence path.
- **ANUGA** — Verified: unstructured meshes, wetting/drying, checkpoints, and CRS-aware workflows. Learn restartability and mesh-adequacy communication. Avoid importing its operational flood scope or Python/C toolchain wholesale.
- **TOAST** — Verified: observed/simulated trace comparison, arrival picks, incident history, logs, simulation profiles, and playback packages. Learn its separation of observations from simulations and its durable incident/run database. Avoid bulletins, live warning aggregation, dissemination, and multi-user server architecture.
- **OpenQuake** — Verified: calculation history, explicit created/executing/complete/failed states, prior-run logs, immutable outputs, and continuation from earlier calculations. Learn its local job archive and failure inspectability. Avoid turning Cataclysm into a server/cluster product.
- **NUKEMAP and DisasterMap.ca** — Verified: compelling what-if framing, historical anchors, discoverable multi-hazard controls, and paid demand for richer scenario comparison. Learn approachable consequence framing and evidence-at-point. Avoid false precision, spectacle-first casualty claims, proprietary exposure data, and operational language.

## Security, Privacy, and Reliability

- **Verified — sensitive settings can remain inconsistent.** `src/components/Settings.tsx:105-140` writes seven values concurrently and can partially persist after one rejection; `src/lib/settings.ts:648-701` partially resets keychain/localStorage/plugin-store state; `src/lib/settings.ts:313-335` returns a legacy plaintext token even when its keychain migration fails. Reuse the import snapshot/rollback pattern and make sensitive migration fail closed.
- **Verified guard gap / Likely exposure — copied diagnostics bypass redaction.** `src/components/LogViewer.tsx:83-142` serializes raw log messages and user-agent data while claiming the bundle contains no paths or tokens. `redactSensitive` is applied only to persisted crash reports in `src/lib/diagnosticsLog.ts:119-198`; network/Cesium errors can contain query tokens or absolute paths. Redact at every copy/export boundary and add leak fixtures.
- **Verified — crash evidence is hidden after reload.** `src/main.tsx:27-51` logs global errors without persisting them and marks a prior report seen immediately after `createRoot`; only a new render crash reads the stored report in `src/components/ErrorBoundary.tsx:39-47`. Surface unseen evidence in startup recovery/LogViewer and mark it seen only after inspection.
- **Verified — DART accessible and visual claims confuse observations with model output.** `src/components/DartOverlay.tsx:34-127` samples `buoy.observations` but announces it as “model” and computes model arrival in frontend JavaScript from haversine distance and `sqrt(g·depth)`. Actual SWE gauge series already reach `dart_buoy_rmse` in `src-tauri/src/commands.rs:609-684`; derive arrivals there and expose the method/overlap.
- **Verified — scenario canonicalization silently resolves conflicting fields.** `src/lib/scenario-schema.ts:234-248` discards a valid but disagreeing nested `location.depth_m`, and `:383-429` accepts the `version` alias while always reporting it migrated. Conflicting aliases/duplicates must reject without mutation.
- **Verified — export exceptions escape recovery.** Canvas, codec, stream, and final-download operations in `src/lib/export.ts:203-508` can throw outside protected handling; `src/App.tsx:1240-1308` does not consistently catch them. All exporters need typed results, guaranteed cleanup, visible retry, and injected-failure tests.
- **Verified on 2026-07-14 — dependency vulnerability scans are clean, but Rust advisory debt is implicit.** `npm audit` and `cargo audit` found no vulnerabilities; `cargo audit` reported 17 warning-class transitive advisories, including `glib` RUSTSEC-2024-0429, while `src-tauri/deny.toml` intentionally limits unmaintained failures to workspace dependencies. Add dated, expiring exceptions rather than forcing an unsupported GTK migration.
- **Verified — the release gate stops before installation.** `scripts/build-release.mjs:62-127` probes the raw release binary and hashes bundles, but does not install or drive MSI/NSIS output. The WebView2 transport/completion failures documented in `CHANGELOG.md:100-110` passed browser/raw-binary checks; an isolated installed-package smoke is required.

## Architecture Assessment

- `src-tauri/src/commands.rs` (2,863 lines), `src-tauri/src/physics/direct_hazard.rs` (1,926), `src/App.tsx` (1,880), the SWE solver (1,504), and `src/components/Globe.tsx` (999) remain concentration risks. Existing roadmap decomposition items already cover `commands.rs` and `App.tsx`; add regression seams rather than duplicate refactor rows.
- The solver has mass/quality checks and analytical fixtures but no automated three-level spatial/temporal convergence or Grid Convergence Index report. Add a deterministic CPU/GPU harness before using resolution as a quality claim.
- `src/components/SwePlayback.tsx:535-548` exposes only cells per degree, while `src-tauri/src/commands.rs:905-1079` guards broad cell/work bounds. A convergence-calibrated preflight should report physical cell size, source-feature coverage, timestep, memory/runtime, and under-resolution.
- Persistence covers settings, scenarios, and crash reports; checkpoints and portable packages are planned, but successful completed results have no routine local history. A bounded immutable archive should reuse run identity, provenance, checkpoints, and normalized-rerun contracts rather than invent another result schema.
- `src/lib/demo.ts` remains a 764-line illustrative physics fork; retire it through the existing Rust/WASM item, not further feature growth.
- Product-truth drift is extensive but already roadmapped: former-name/old-repository references, Rust 1.78 vs 1.88, Esri-vs-OSM default claims, unavailable macOS/Linux downloads, stale GPU/DART science notes, v0.10.3 screenshots, and shipped keychain/diagnostics/DART work still listed in `Roadmap_Blocked.md`. Strengthen the existing product-truth gate and visual matrix with ledger reconciliation, baseline-version checks, and one deterministic unmasked integrated globe scene per theme; do not add duplicate rows.
- Existing roadmap coverage is sufficient for i18n/l10n, WCAG/reflow/forced-colors, semantic chart data, offline installation, CLI, portable packages, checkpoints, model upgrades/reruns, wet/dry physics, USGS feeds, Zarr/VTK, supply-chain provenance, and non-executable extensibility. The Settings radiogroup keyboard gap belongs in the existing accessibility item.

## Emerging Capabilities & Physics-Breadth (2026-07-14 incremental scan)

The trust-boundary items above remain the priority; this scan adds a second
dimension — credibility-through-physics-breadth and low-cost capability wins —
verified against v0.10.4 source so no already-shipped work is re-proposed.

- **Physics breadth is the clearest differentiation vector.** Airburst physics
  already exists in `direct_hazard.rs` but presents as impact/crater, reinforcing
  the field's #1 misconception (that everything craters); surfacing the
  airburst-vs-crater outcome, an overpressure window-glass injury layer
  (injuries ≫ deaths), a firestorm/smoke-loft overlay, and a parameterized
  volcanic-collapse tsunami source are all cited, mostly medium-effort, and each
  couples two existing modules. A live competitor (Universe Sandbox) is actively
  building atmospheric-entry/fragmentation for 2026, so this is contested ground.
- **Capability wins are shippable at current pins.** Video export already exists
  via `MediaRecorder` (real-time, lossy) — the gap is a deterministic WebCodecs
  `VideoEncoder` path that honors the replay contract. CesiumJS ≤1.143 already
  offers `Buffer*` primitive collections (batched overlays) and async/quadtree
  picking (non-blocking inspect); React 19.2's `<Activity>` preserves the
  expensive Cesium/panel state that hazard-mode switching currently tears down.
  wgpu 30 (HDR fireball output, `SHADER_I16`) is a real but breaking upgrade.
- **Education-adoption plumbing converts a demo into a classroom tool.** An
  NGSS-aligned "mitigation" design mode, an asteroid-deflection teaching mode, and
  event sonification (engagement plus a genuine non-visual accessibility channel)
  target curriculum fit; a web/LMS/Chromebook distribution channel is the highest
  reach but is blocked on the WASM port and a hosting decision.
- **Supply-chain and scaling hygiene.** The Sept-2025 npm chalk/debug compromise
  argues for `npm audit signatures`/provenance in the local gate; a 2025
  peer-reviewed hydrodynamic impact calculator (Svetsov et al.) can validate or
  refresh the 2005 Collins–Melosh–Marcus scaling. Note verified false leads:
  Tauri ships with `features = []` (no `tray-icon`/GTK advisory surface, so the
  libappindicator cluster does not apply here), and video export is not missing.

## Rejected Ideas

- **Operational forecast, warning bulletins, evacuation routing, or multi-user incident command** — Rejected; TOAST demonstrates the value, but this contradicts the local-first educational safety boundary and would require live authoritative data, staffing, and service operations.
- **General executable plugins** — Rejected; TOAST's simulation plugins are useful in an operational server, but arbitrary code would weaken Rust physics authority and Tauri capability boundaries. The existing non-executable package plan is the safe extension surface.
- **Native mobile app** — Rejected; the 1200×800 desktop workspace, Tauri desktop commands, local solver memory, and detailed analytical panels do not map to a credible mobile workflow. Maintain narrow reflow for accessibility, not a mobile product claim.
- **Cloud accounts/collaboration as parity with commercial flood platforms** — Rejected; Flood Platform/OpenQuake show demand, but accounts, tenancy, billing, and remote compute conflict with offline-first scope. Portable packages and local archives deliver the relevant value.
- **ML surrogate or coastal digital twin now** — Rejected; research prototypes are promising, but training provenance, domain validity, uncertainty, and independent verification are unresolved; `Roadmap_Blocked.md` already records the source and dependency.
- **Hyper-real Unreal/cinematic renderer now** — Rejected; Universe Sandbox and Cesium demonstrate visual appeal, but the existing blocked HR program correctly waits for authoritative local geometry/assets and renderer validation.
- **Cesium terrain as solver bathymetry** — Rejected; visual tiles do not provide the datum, rights, continuity, and deterministic sampling contract required by the Rust solver. Preserve the visual/scientific separation.
- **Precomputed global replay catalog as the primary engine** — Under consideration only; the 2026-07 browser simulator in the community source shows instant playback value, but it duplicates cached replays/WASM and creates large versioned storage obligations before archive-size measurements exist.
- **Blanket major dependency upgrades** — Rejected; current React/Vite/Tauri/Cesium/wgpu versions are current or near-current and audits are clean. Upgrade only for a measured feature, fix, or advisory.

## Sources

### OSS and scientific ecosystem

- https://github.com/mandli/tsunami-models
- https://www.clawpack.org/geoclaw.html
- https://github.com/fengyanshi/FUNWAVE-TVD
- https://github.com/edanya-uma/Tsunami-HySEA
- https://gmd.copernicus.org/articles/19/3953/2026/
- https://www.sciencedirect.com/science/article/abs/pii/S0098300421002600
- https://arxiv.org/abs/1611.05984
- https://anuga.readthedocs.io/en/stable/
- https://docs.gempa.de/toast-client/current/base/gui.html
- https://docs.openquake.org/oq-engine/3.19/manual/getting-started/running-calculations/web-ui.html

### Commercial and adjacent products

- https://blog.nuclearsecrecy.com/2026/02/10/nukemap-roadmap/
- https://www.disastermap.ca/
- https://www.floodplatform.com/
- https://universesandbox.com/

### Standards and verification

- https://nctr.pmel.noaa.gov/benchmark/index.html
- https://nctr.pmel.noaa.gov/benchmark/Basic/Basic_Convergence/index.html
- https://nctr.pmel.noaa.gov/tda_documentation.html
- https://www.grc.nasa.gov/www/wind/valid/tutorial/spatconv.html
- https://docs.ogc.org/is/12-128r19/12-128r19.html
- https://citation-file-format.github.io/

### Platform, dependencies, and security

- https://v2.tauri.app/develop/tests/webdriver/
- https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/webdriver
- https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/prerelease-testing
- https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- https://rustsec.org/advisories/RUSTSEC-2024-0429.html
- https://vite.dev/blog/announcing-vite8
- https://github.com/gfx-rs/wgpu/releases
- https://cesium.com/blog/2026/07/01/cesium-releases-in-july-2026/

### Discovery and community signal

- https://github.com/acgeospatial/awesome-earthobservation-code
- https://www.reddit.com/r/EarthScience/comments/1utdi5e/web_project_3d_globe_tsunami_simulator_historical/
- https://news.ycombinator.com/item?id=33870612

### Emerging capabilities and physics-breadth (2026-07-14 incremental scan)

- https://cesium.com/blog/2026/06/01/cesium-releases-in-june-2026/
- https://cesium.com/blog/2026/04/01/cesium-releases-in-april-2026/
- https://cesium.com/blog/2025/12/01/cesium-releases-in-december-2025/
- https://react.dev/blog/2025/10/01/react-19-2
- https://github.com/gfx-rs/wgpu/blob/trunk/CHANGELOG.md
- https://developer.chrome.com/docs/web-platform/best-practices/webcodecs
- https://universesandbox.com/blog/2026/03/universe-sandbox-roadmap-2026/
- https://onlinelibrary.wiley.com/doi/10.1111/maps.13085
- https://onlinelibrary.wiley.com/doi/10.1111/maps.14329
- https://link.springer.com/article/10.1007/s00024-024-03515-y
- https://plynett.github.io/
- https://www.jpl.nasa.gov/news/nasas-dart-mission-changed-orbit-of-asteroid-didymos-around-sun/
- https://www.teachengineering.org/activities/view/cub_natdis_lesson06_activity1
- https://semgrep.dev/blog/2025/chalk-debug-and-color-on-npm-compromised-in-new-supply-chain-attack/

## Open Questions

- Should public software citation identify the manifest author `SysAdminDoc`, a personal name/ORCID, or a project organization, and is there an existing DOI/preferred paper? This is the only blocker to exact `CITATION.cff` authorship metadata.
- What default disk quota and frame-retention policy is acceptable for the local run archive? The answer determines whether full fields are opt-in or retained automatically.
