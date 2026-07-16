# Research — Cataclysm
Date: 2026-07-16 — replaces all prior research.

## Executive Summary

**Verified.** Cataclysm is a mature (v0.10.4), local-first Tauri 2 + React 19 + CesiumJS desktop simulator whose physics is Rust-authoritative: SWE tsunami solver (CPU rayon + wgpu GPU with CPU parity), Okada 1985 seafloor deformation, Ward–Asphaug asteroid ocean-impact coupling, nuclear/landslide/Lamb-wave sources, fgmax max-fields + isochrones, DART RMSE validation, and a heavily contract-gated build. Its strongest shape is *proof and trust*: explicit uncertainty/provenance, fail-closed exporters, forced-colors/WCAG work, native-panic recovery, and reproducible reference captures. The live roadmap is already unusually complete — six prior research passes captured nearly every parity and leapfrog idea (meteotsunami, WSEG-10 fallout, NTHMP benchmarks, GEBCO import, casualty plurality, Zarr/VTK export, i18n, SBOM). This pass confirms that breadth and adds a small set of *net-new, verified* opportunities the prior passes missed.

The highest-value net-new direction remains **credibility over breadth**, plus a few sharp UX/data wins:
1. **Slab2-derived auto-fault geometry** — the biggest un-addressed usability barrier (users hand-enter strike/dip/rake today; verified absent in `earthquake.rs`).
2. **Nuclear-effects validation harness** vs Glasstone & Dolan / EM-1 tables — the tsunami side has NTHMP-grade validation planned; the nuclear side has none.
3. **First-arrival ETA quick-preview** reusing the existing `SolverMode::Linear` — instant feedback before the long nonlinear run (easyWave two-tier pattern).
4. **HazEL observed-runup validation overlay** — extends the planned HazEL browser from a param-loader into a validation surface (26k observed runup points vs simulated).
5. **Unified user-data schema-migration framework** — many versioned JSON contracts + per-key settings migration exist, but no holistic upgrade/migration test harness.
6. **Data & Network trust panel** + reachable-origin self-test — on-brand for the trust-first positioning; enumerates every CSP origin and asserts no-telemetry.
7. **OS notification/chime on long-run completion** — small, no-network quick win for long solver runs.
8. **Interactive "poke the wave" exploratory sandbox** (Celeris-style) — an engagement hook, scoped as non-reproducible/non-archived to preserve the deterministic pipeline.

## Product Map
- **Core workflows:** pick a hazard mode (Tsunami / Impact / Nuclear) → choose a cited preset or build a custom scenario → run the Rust solver (grid/streaming) → inspect the Cesium globe (runup, inundation, DART, isochrones) → compare/export (PNG/CZML/GeoJSON/KML/CSV/story).
- **Personas:** educators/students (guided lessons, teacher mode, worksheets); analysts/enthusiasts wanting scientific grounding over toy sims; the maintainer as sole developer under strict local-build discipline.
- **Platforms/distribution:** Windows desktop only, unsigned MSI/NSIS, local builds (no CI-produced binaries by policy). macOS/Linux are source-build paths. Browser preview is an approximate carve-out (`src/lib/demo.ts`).
- **Integrations/data:** CesiumJS + optional Cesium Ion token (OS keychain), bundled Natural Earth II fallback, DART/NDBC buoy references, cited historical presets. Physics never runs in JS; all quantitative output flows through `tauri::invoke`.

## Competitive Landscape

- **GeoClaw / Clawpack (BSD-3)** — reference OSS SWE tsunami+overland-flood with patch-based AMR, well-balanced wet/dry. *Learn:* the `geohints` cautionary list is a ready-made QA checklist; never report runup without stating grid resolution. *Avoid:* full AMR is XL and already correctly parked as blocked — don't let it gate releases.
- **Tsunami-/Meteo-/Landslide-HySEA (academic license)** — GPU finite-volume, unified generation→propagation→inundation, meteotsunami and granular-landslide sources. *Learn:* the unified pipeline and meteotsunami forcing (already on roadmap). *Avoid:* CUDA-only and non-permissive — study architecture, never lift code; Cataclysm's portable wgpu path is a genuine differentiator.
- **Celeris-WebGPU (MIT, Lynett)** — interactive Boussinesq nearshore solver in the browser, education-targeted, real-time wave-field editing. *Learn:* interactive "poke the field" is the engagement hook (new item below); readable WGSL reference. *Avoid:* their interactivity is inherently non-reproducible — keep it out of the validated/archived run pipeline.
- **NUKEMAP + AWEL.js roadmap (Wellerstein)** — the nuclear-effects reference; 2026 roadmap ships WSEG-10 in shaders, DELFIC, selectable casualty models, OSM institution overlays. *Learn:* most already mirrored on-roadmap; the un-mirrored gap is a *validation harness* against Glasstone & Dolan / EM-1 (new item). *Avoid:* browser/2D-map ceiling — Cataclysm's 3D-globe desktop + coastal-detonation-tsunami combo is the edge.
- **Asteroid Launcher (neal.fun)** — viral consumer impact sim; its #1 complaint is *no ocean/tsunami and flat terrain*. *Learn:* that exact gap is already Cataclysm's implemented differentiator (Ward–Asphaug coupling verified in `asteroid.rs`) — surface it more prominently in copy/onboarding. *Avoid:* toy casualty framing.
- **DisasterMap.ca (2026)** — the closest *product-level* competitor: earthquake+tsunami+asteroid+nuclear on one map, NASADEM elevation, GEM faults, USGS ShakeMap MMI rings, nuclear-plant tracker, event *chaining*. *Learn:* event chaining and MMI/liquefaction framing; the critical-infrastructure angle. *Avoid:* their ring-overlay approximation — Cataclysm's real SWE physics + Rust/GPU + true 3D globe is the differentiator to defend.
- **NASA CNEOS / SSD-API + USGS Slab2/ComCat** — authoritative feeds. *Learn:* Slab2 subduction geometry auto-generates realistic fault planes (new item); SBDB/Sentry real NEO params already planned (UNI-08).

## Security, Privacy, and Reliability
- **No new exploitable CVE surfaced** in the stack. `scripts/verify.mjs` already gates `npm audit` (moderate), `cargo audit`, `cargo deny`, a rust-advisory baseline with expiring exceptions, deterministic third-party notices, and a release-contract-drift fail-closed check — stronger supply-chain hygiene than most peers.
- **Known constraint (tracked, not a gap):** wgpu dx12 feature stays disabled (upstream gpu-allocator 0.28 vs windows 0.61/0.62); wgpu-hal pinned 29.0.4. Do not re-add dx12 until fixed upstream (CLAUDE.md).
- **Reliability hot-spot (evidence: `git log`):** the deterministic reference-capture / visual-regression harness (`scripts/capture-reference-scenes.mjs`, `tests/visual-regression.spec.ts`, `tests/reference-baselines.json`) is the single largest ongoing churn sink (~15+ recent commits on frame-timing/font-drift/capture nondeterminism). Not a feature gap, but the most fragile subsystem — a dedicated stability item is warranted if churn continues.
- **Recovery gaps already addressed:** native-panic evidence, transactional/atomic settings persistence with rollback, recoverable scenario deletion, typed/retryable export failures. Net-new reliability gap: **no holistic cross-version user-data migration harness** (per-key ad-hoc migration only in `settings.ts`) — see roadmap.
- **Privacy posture strong but implicit:** individual features promise no-network/no-location, but there is no consolidated data-flow surface or automated assertion that the running app opens no unexpected origins — see roadmap.

## Architecture Assessment
- **God-files (verified line counts):** `src-tauri/src/commands.rs` (3466 — modularization already tracked), `src/App.tsx` (2174), `src-tauri/src/physics/solver/mod.rs` (1954), `src-tauri/src/physics/direct_hazard.rs` (1926), `src/lib/export.ts` (1101), `src/lib/settings.ts` (1011). Only `commands.rs` and `Globe.tsx` splits are currently tracked; `App.tsx` and `direct_hazard.rs` are untracked structural debt (mention only — no correctness impact).
- **Test posture excellent:** 200 Rust `#[test]` fns (every physics module covered except trivial `constants.rs`/`mod.rs`), ~72 Vitest files, 6 Playwright specs (smoke/a11y/keyboard/visual/state/async). No code-comment TODO/FIXME/HACK debt exists — all open work already lives in the two roadmap files. The word "placeholder" in code is domain provenance data (low-confidence coastal points), not debt.
- **Contract discipline is a strength to preserve:** source-input, earth-assets, geodesy, surface-mask, and render-protocol contracts are JSON-defined and mirrored Rust↔TS with validators. The migration-framework item should extend this pattern, not bypass it.
- **Doc gap:** no consolidated nuclear-effects validation doc analogous to `docs/science/VALIDATION.md` (new item). `CITATION.cff` is already on roadmap.

## Rejected Ideas
- **Mobile / iOS / Android / responsive-touch UI** — contradicts the explicit desktop-only philosophy (desktop-only visual baselines, 1200×800 GPU-heavy contract). Source: inventory gap scan; CLAUDE.md.
- **Opt-in anonymous usage telemetry / analytics** — contradicts the local-only, no-network-transmit privacy posture. The consistent alternative (a *local-only* health/perf panel) is folded into the Data & Network trust item. Source: NUKEMAP-style analytics; rejected on philosophy.
- **Multi-user / cloud sessions / accounts / teacher-roster dashboard** — contradicts local-only/offline positioning; the one-way Classroom share is already parked as blocked. Source: Nuclear War Simulator / classroom competitors.
- **Third-party plugin/extension SDK & marketplace** — premature against the single-binary, contract-gated model; the planned headless CLI + non-executable scenario packages cover the real need. Under Consideration only if a CLI ships first. Source: inventory gap scan.
- **Ocean-impact → tsunami coupling as "new"** — already implemented (`src-tauri/src/physics/asteroid.rs`, Ward & Asphaug 2000 cavity→IC). Not a gap; only a marketing/onboarding-visibility opportunity.
- **Real NEO import from JPL SBDB/Sentry as "new"** — already tracked as UNI-08. Source: CNEOS API.
- **Boussinesq dispersion / AMR / population-casualty grid as "new"** — all already tracked (Boussinesq/AMR blocked; GHS-POP casualty blocked). Correctly parked. Source: FUNWAVE/JAGURS/GeoClaw.
- **AWEL-style browser WebGL fallout shaders** — Cataclysm's fallout must stay Rust-authoritative (WSEG-10 item already Rust-side); duplicating in a WebGL shader would violate the "physics in Rust only" rule. Source: NUKEMAP roadmap.

## Sources
Tsunami/SWE OSS:
- https://www.clawpack.org/geoclaw · https://www.clawpack.org/geohints.html
- https://github.com/edanya-uma/Tsunami-HySEA · https://edanya.uma.es/hysea/models/meteo-hysea
- https://plynett.github.io/ · https://github.com/plynett/plynett.github.io
- https://github.com/jagurs-admin/jagurs · https://git.gfz-potsdam.de/id2/geoperil/easyWave
- https://www1.udel.edu/kirby/papers/shi-etal-cacr-11-04-version2.0.pdf
- https://github.com/rjleveque/nthmp-benchmark-problems

Impact:
- https://www.eaps.purdue.edu/impactcrater/ · https://neal.fun/asteroid-launcher/
- https://academic.oup.com/gji/article/153/3/F6/2122672 · https://ssd-api.jpl.nasa.gov

Nuclear:
- https://nuclearsecrecy.com/nukemap/ · https://blog.nuclearsecrecy.com/2026/02/10/nukemap-roadmap/
- https://github.com/GOFAI/glasstone · https://nuclearwarsimulator.com/technical-details/

Data/standards:
- https://www.ngdc.noaa.gov/hazel/view/hazards/tsunami/event-search
- https://www.gebco.net/data-products-gridded-bathymetry-data/gebco2024-grid
- https://github.com/usgs/slab2 · https://earthquake.usgs.gov/slab2/
- https://www.ncei.noaa.gov/products/etopo-global-relief-model

Rendering/ecosystem:
- https://github.com/CesiumGS/cesium/releases · https://github.com/CesiumGS/cesium/wiki/Ocean-Details
- https://community.cesium.com/t/is-there-a-plan-to-support-webgpu/23381
- https://github.com/pka/awesome-georust · https://rustsec.org/advisories/ · https://v2.tauri.app/security/

Community/competitor:
- https://news.ycombinator.com/item?id=33870612 · https://www.disastermap.ca/

## Open Questions
- **Slab2 distribution size:** the full Slab2 netCDF grids are large — is a curated, bundled subduction-geometry lookup (major zones only) acceptable, or must this be a first-run download like GEBCO? (Determines whether the auto-fault item is actionable now or belongs in `Roadmap_Blocked.md`.)
- **Reference-capture churn:** is the visual-regression harness instability considered acceptable maintenance cost, or should a stabilization pass be prioritized over new features? (Affects whether to add a dedicated hardening item.)
