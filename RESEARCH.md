# Research — Cataclysm

Date: 2026-07-11

## Executive Summary

Cataclysm v0.8.0 is a desktop scientific-hazard simulator built with Tauri, React, CesiumJS, and a Rust shallow-water backend. Its strongest current shape is unusually coherent for an educational simulator: cited source models, CPU/GPU solver code, DART comparison, runup products, scenario migration, accessibility checks, and a professional three-pane workspace already exist. The existing HR-00–HR-53 and living-Earth roadmap correctly covers the visual ambition—physically based Earth, ocean, atmosphere, asteroid, nuclear, tsunami, terrain, cinematic rendering, audio, replay, provenance, offline assets, and temporal validation—and should not be duplicated. The highest-value direction is to make the shipped scientific and desktop contract trustworthy before adding more spectacle: ensure release artifacts contain the GPU backend they advertise, make maxima and arrivals independent of display sampling, isolate direct-hazard workspaces from stale tsunami state, fix offline fallback, harden persistence/export boundaries, and turn the current layer inventory into a real simulator layer controller.

Top opportunities, in priority order:

1. **Verified — ship and prove the GPU backend.** v0.8.0 Windows package fingerprints show no Cargo features even though the UI and README describe GPU compute.
2. **Verified — compute scientific maxima and arrivals at solver-step cadence.** `MaxFieldAccumulator` currently samples emitted frames, so changing `n_snapshots` changes quantitative results.
3. **Verified — isolate tsunami, asteroid, and nuclear workspace state.** Direct modes can render unrelated tsunami fields and can re-enable a mixed-domain Compare view.
4. **Verified — repair offline imagery fallback.** imagery failure retries the network-dependent default instead of the bundled Natural Earth fallback.
5. **Verified — close current trust defects.** CSV formula injection, silent settings-write failures, partial settings imports, and unsupported-schema downgrades are present.
6. **Verified — enforce a real release feature matrix.** default, `gpu`, `validation`, and combined Rust builds/tests are not all exercised before packaging.
7. **Verified — correct spherical SWE metrics.** one longitude scale is applied to every latitude row in domains that may span 120 degrees.
8. **Verified — make jobs request-scoped.** global cancellation can cancel both comparison runs and has no memory/concurrency admission policy.
9. **Verified — meet WCAG AA in every desktop state.** live light-theme inspection found 30 contrast failures; Compare also has contrast and duplicate-ID defects.
10. **Verified — add controllable layers and durable recovery.** the Layers tab cannot hide, reorder, or adjust overlays, while crash evidence disappears on reload.

## Product Map

- **Core workflows:** select or author a cited source; run analytical and SWE propagation; inspect wave, runup, gauge, DART, asteroid, or nuclear outputs; compare scenarios; export visual and machine-readable results.
- **User personas:** educators and students; science communicators; technically literate hazard enthusiasts; researchers using Cataclysm for exploratory or illustrative—not operational—analysis.
- **Platforms and distribution:** Tauri desktop application with a 1200×800 minimum; Windows MSI/NSIS is the verified shipped platform. macOS and Linux are source targets but do not have equivalent current release proof. Mobile is intentionally excluded.
- **Key integrations and data flows:** Rust IPC owns tsunami physics and diagnostics; CesiumJS projects backend fields onto WGS84; Esri/Cesium providers supply online Earth imagery/terrain; bundled JSON supplies presets, coasts, and DART records; keyring protects the Cesium token; exports include PNG, video, text, CZML, GeoJSON, KML, CSV, and share URLs.

## Competitive Landscape

### GeoClaw / Clawpack

- Does well: adaptive refinement, wet/dry inundation, spherical grids, restart/checkpoint workflows, every-step gauges, and published validation.
- Learn: make output cadence independent of scientific accumulation, add spherical conservation fixtures, and retain request/checkpoint identity.
- Avoid: a code-first Unix workflow and setup burden that would weaken Cataclysm's desktop-first advantage.

### ANUGA

- Does well: validated finite-volume flooding/tsunami workflows, checkpointing, logging, Python/TOML scenario configuration, MPI/OpenMP paths, and explicit troubleshooting.
- Learn: resource admission, restartable jobs, structured configuration validation, and documented memory/performance behavior are simulator features, not merely developer details.
- Avoid: exposing the full modeling grammar before Cataclysm's current compact scenario model is internally consistent.

### Celeris-WebGPU

- Does well: faster-than-real-time interactive Boussinesq/NLSW simulation, moving shoreline, photorealistic and analytical views, recent spherical-grid and nested-grid work.
- Learn: ship hardware acceleration by default, make capability/fallback state visible, and keep a live scientific view coupled to a high-quality visual view.
- Avoid: coupling product credibility to one GPU path without a deterministic CPU fallback and parity gate.

### Tsunami-HySEA / VOLNA-OP2

- Does well: GPU/performance-portable propagation, earthquake and landslide variants, multi-resolution operational-scale work, and explicit hardware targets.
- Learn: release artifacts must state and test enabled accelerators; large jobs need bounded memory and request-scoped cancellation.
- Avoid: adopting GPL code or specialized HPC dependencies into the MIT desktop core without a deliberate license boundary.

### OpenQuake Engine

- Does well: distinct scenario workflows, versioned input models, explicit configuration, structured outputs, risk-model provenance, and strong separation between engine and presentation.
- Learn: direct hazards need their own source/result state and export contract rather than sharing tsunami state opportunistically.
- Avoid: presenting high-consequence loss numbers with more precision than the model and inputs justify.

### OpenSpace and NASA Worldview

- Does well: ordered layer groups, temporal layers synchronized to global time, opacity/styling controls, bookmarks, offline caches, comparison modes, and data-driven globe profiles.
- Learn: Cataclysm's Layers tab should control visibility, opacity, order, legends, and time coupling; saved state should include the camera and layer stack.
- Avoid: an unrestricted content/profile system before provider licenses, CSP, checksums, and scientific semantics are enforceable.

### ArcGIS Earth and Bentley OpenFlows FLOOD

- Does well: online/offline 3D context, scenario alternatives, import/export interoperability, reality meshes, integrated 1D/2D modeling, and professional decision-aid presentation.
- Learn: honest offline status, scenario isolation, inspectable layer provenance, and failure/recovery states are table stakes for professional simulator software.
- Avoid: cloud/account dependence and opaque proprietary formats as the only path to high-quality context.

### UNIGINE Sim / Unreal Engine / Cesium

- Does well: planet-scale coordinates, terrain streaming, PBR atmosphere/ocean, volumetric weather, real-time fluids, quality tiers, cinematic capture, and 3D Tiles interoperability.
- Learn: retain the existing renderer protocol plan and use hero-effect budgets instead of forcing one fidelity level everywhere.
- Avoid: moving scientific authority into renderer-side effects or replacing reproducible analytical outputs with visual plausibility.

## Security, Privacy, and Reliability

- **Verified — CSV formula injection:** `src/lib/export.ts` quotes delimiters but does not neutralize gauge names beginning with spreadsheet formula characters. Apply a spreadsheet-safe text policy to every CSV cell and test ASCII/full-width initiators.
- **Verified — persistence can lie:** `src/lib/settings.ts` suppresses localStorage/plugin-store write and save failures, while `src/components/Settings.tsx` reports success. Propagate failures and preserve the prior durable snapshot.
- **Verified — import is non-transactional:** settings import applies keys sequentially, has no file-size cap, and stamps a newer schema down to v1. Prevalidate, reject unsupported future schemas, cap input, and commit atomically with rollback.
- **Verified — mixed hazard state:** `src/App.tsx` leaves tsunami source/field/runup/DART state active in direct modes and permits a mixed-domain Compare view. This can visually misattribute outputs.
- **Verified — cancellation is global:** `src-tauri/src/commands.rs` stores all tokens in one vector and `cancel_simulation` cancels all active runs. Closed snapshot receivers are ignored and completion metadata can report requested rather than emitted frames.
- **Verified — ephemeral crash evidence:** `src/lib/diagnosticsLog.ts` is a 500-entry in-memory ring; `src/components/ErrorBoundary.tsx` loses evidence on reload and offers no redacted support-bundle action.
- **Verified — frontend authority is broader than use:** `src-tauri/capabilities/default.json` grants store enumeration, clear, and reload operations not used by `src/lib/settings.ts`. Restrict plugin permissions and explicitly enumerate application commands.
- **Verified — audit status:** `npm audit` reports zero vulnerabilities; `cargo deny check advisories` passes. `cargo audit` reports allowed transitive GTK3/unicode maintenance warnings and `glib` unsoundness relevant to a future Linux package, not the current Windows artifact. Track this in platform release proof rather than claiming all desktop targets are equivalent.
- **Missing guardrails:** per-run memory/concurrency admission; atomic settings import; persistent redacted crash storage; honest offline/provider health; formula-safe CSV; feature-bearing package attestations.
- **Recovery and rollback:** a failed settings import must restore the previous snapshot; a failed imagery provider must switch to bundled data; a crashed UI must offer reset-visual-settings and copy/save diagnostics; cancellation must identify only the requested run.

## Architecture Assessment

- **Build configuration is runtime behavior:** `src-tauri/Cargo.toml`, `package.json`, `scripts/verify.mjs`, and `docs/release/CODESIGNING.md` disagree about GPU delivery. Treat enabled Cargo features as artifact metadata and test the installed artifact's backend status.
- **Scientific output is coupled to visualization sampling:** move `MaxFieldAccumulator` updates in `src-tauri/src/physics/solver/mod.rs` from emitted-frame branches to every accepted solver step; separately downsample only serialized frames.
- **Geodesic metric boundary:** replace the box-center longitude scale in `src-tauri/src/physics/solver/mod.rs` with row-aware spherical metrics and geometric source terms; validate conservation and latitude symmetry before broader global runs.
- **Job boundary:** replace the global cancellation-token vector in `src-tauri/src/commands.rs` with run IDs, per-run state, admission budgets, receiver-closed termination, and actual emitted/cancelled metadata.
- **Hazard workspace boundary:** `src/App.tsx` should derive globe fields, source HUD, inspect, compare, exports, and left-rail content from one discriminated active-workspace state so stale tsunami data cannot leak into asteroid/nuclear modes.
- **Provider boundary:** `src/lib/globe-styles.ts` and `src/components/Globe.tsx` need an explicit provider state machine: offline, connecting, ready, degraded, failed, fallback-ready. Do not retry a failed online default as its own fallback.
- **Settings boundary:** centralize validation, migration, persistence, and rollback in `src/lib/settings.ts`; components should receive a committed result rather than infer success.
- **Layer boundary:** `src/components/LayerInspector.tsx` is only an activity list. Introduce layer descriptors with visibility, opacity, order, legend, time domain, provenance, and analytical/cinematic classification; bind both Cesium and export state to them.
- **Error-state boundary:** runup, attenuation, DART, inspect, and SWE failures currently collapse into empty/waiting/no-overlap states. Use typed loading/empty/error/stale states and preserve the last valid result with a visible stale marker.
- **Documentation truth:** `CONTRIBUTING.md`, `SECURITY.md`, `docs/manual/**`, `docs/science/**`, onboarding, screenshots, and provider copy contain legacy TsunamiSimulator, old version/frame, runtime, repository, or imagery claims. Expand the docs gate beyond missing links/scripts to assert current product/version/default-provider facts.
- **Refactors already covered:** do not add duplicates for splitting `Globe.tsx`, modularizing `commands.rs`, Rust hazard authority, renderer protocol, offline Earth packs, geodesy/datum contracts, cinematic Earth/ocean/effects, Zarr, i18n, or full-canvas temporal visual tests; those are already actionable in `ROADMAP.md`.
- **Test gaps:** no release feature matrix; no installed-package GPU assertion; no snapshot-cadence invariance test; no cross-latitude conservation fixture; no compare/direct-mode isolation test; no offline startup/provider-failure test; no light-theme axe gate; no persistence-failure/rollback test; support scripts/config and Playwright files escape normal type/lint coverage; standalone E2E may preview stale `dist`.
- **Documentation gaps:** current behavior, supported platform truth, provider defaults, numerical limitations, and recovery semantics are not generated or checked from authoritative constants.

## Rejected Ideas

- **Operational warning/evacuation product — rejected.** NOAA and mature tsunami codes require validated forecast workflows and operational data Cataclysm does not claim; preserve the educational/exploratory boundary.
- **Mobile UI — rejected.** The owner explicitly requires desktop-only software; mobile constraints would dilute the dense simulator workspace.
- **Real-time multi-user editing — rejected.** ArcGIS/Bentley collaboration is valuable commercially, but local scenario files, links, and exports fit this product without adding identity, conflict, and server operations.
- **Arbitrary runtime plugins — rejected.** Awesome/geospatial ecosystems show breadth, but untrusted providers/renderers would weaken CSP, licensing, deterministic physics, and supportability. Keep narrow reviewed adapters.
- **Cloud-only simulation — rejected.** Operational/HPC tools gain scale, but mandatory cloud execution contradicts local-first/offline resilience; remote compute can be reconsidered only as an optional protocol client.
- **Embedded AI modeling copilot — rejected.** OpenFlows exposes this commercially, but no verified project evidence shows it improves scientific correctness; it increases provenance and support burden.
- **Exact casualty projections — rejected.** OpenQuake supports consequence models with explicit exposure/vulnerability inputs; Cataclysm's current educational direct-hazard estimate lacks that basis. Prefer ranges/uncertainty or the already-roadmapped facility layer.
- **Replace Rust SWE with GeoClaw/ANUGA/HySEA — rejected.** Their methods inform validation and architecture, but a wholesale engine swap would sacrifice the current cross-platform IPC/API, licensing simplicity, and established tests.
- **Unreal-only product rewrite — rejected.** UNIGINE/Unreal produce stronger hero visuals, but the existing Cesium analytical client remains necessary for accessibility, deterministic overlays, and broad hardware fallback. Continue the dual-renderer protocol already roadmapped.
- **Immediate GTK3 rewrite — rejected.** Tauri itself currently carries the same Linux GTK3 maintenance warnings. Monitor and prove Linux packaging separately instead of inventing a local framework fork.

## Sources

### Open-source simulators and adjacent products

- https://www.clawpack.org/geoclaw.html
- https://www.clawpack.org/v5.9.x/sphere_source.html
- https://www.clawpack.org/v5.12.x/gauges.html
- https://anuga.readthedocs.io/en/stable/
- https://github.com/plynett/plynett.github.io
- https://arxiv.org/abs/1611.05984
- https://edanya.uma.es/hysea/downloads
- https://docs.openquake.org/oq-engine/manual/latest/user-guide/index.html
- https://docs.openspaceproject.com/latest/building-content/globebrowsing/working-with-layers.html
- https://earthdata.nasa.gov/s3fs-public/2025-03/worldview-booklet.pdf
- https://github.com/mandli/tsunami-models
- https://github.com/pka/awesome-3d-tiles

### Commercial and rendering systems

- https://unigine.com/products/sim/overview/
- https://www.bentley.com/software/openflows-flood/
- https://www.esri.com/en-us/arcgis/products/arcgis-earth/overview
- https://cesium.com/platform/cesium-ion/pricing/
- https://developers.google.com/maps/documentation/tile/overview
- https://dev.epicgames.com/documentation/unreal-engine/water-system-in-unreal-engine
- https://dev.epicgames.com/documentation/unreal-engine/niagara-fluids-in-unreal-engine

### Standards, science, and provenance

- https://docs.ogc.org/cs/22-025r4/22-025r4.pdf
- https://www.khronos.org/gltf/pbr
- https://stacspec.org/en/about/stac-spec/
- https://cfconventions.org/cf-conventions/cf-conventions.html
- https://www.w3.org/TR/WCAG22/
- https://nctr.pmel.noaa.gov/model.html
- https://arxiv.org/abs/2606.12162
- https://arxiv.org/abs/2604.25944

### Dependencies and security

- https://github.com/CesiumGS/cesium/releases/tag/1.143
- https://v2.tauri.app/security/capabilities/
- https://owasp.org/www-community/attacks/CSV_Injection

## Open Questions

- None block prioritization or implementation. Code signing credentials and updater endpoints remain explicit external blockers already recorded in `Roadmap_Blocked.md`.
