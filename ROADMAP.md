# TsunamiSimulator Roadmap

Single source of truth for delivery. Blocked items live in
[`Roadmap_Blocked.md`](./Roadmap_Blocked.md). Shipped work is summarized in
[`CHANGELOG.md`](./CHANGELOG.md).

---

## Research-Driven Additions (2026-07-09)

Grounded in `RESEARCH.md` (2026-07-09). Items marked "returns from
Roadmap_Blocked" had "Needs MSVC linker / Rust compilation" blockers that are
stale: the VsDevCmd wrapper works and `npm run verify` runs 67 Rust release
tests locally.

### P1 — trust, validation, and returned blockers

- [ ] P1 — Property-based tests for physics modules (proptest)
  Why: physics modules have no direct unit tests (validated only via preset benchmarks); property tests catch parameter-space regressions cheaply. Returns from Roadmap_Blocked (stale MSVC blocker).
  Evidence: internal recon — no `#[test]` in src-tauri/src/physics/{asteroid,nuclear,landslide,earthquake}.rs; proptest crate.
  Touches: src-tauri/Cargo.toml (dev-dep), src-tauri/src/physics/*.
  Acceptance: proptest suites for asteroid cavity monotonicity in diameter/velocity, Okada displacement bounds vs slip, SWE mass conservation over N steps (closed basin, no sponge), runup positivity; all pass in `npm run verify`.
  Complexity: M

- [ ] P1 — Kamchatka 2025-07-29 Mw 8.8 preset + DART validation pack
  Why: the most-instrumented tsunami in history — USGS finite-fault parameters and 40-buoy validation data are published; it converts the app into a checkable credibility showcase and answers the exact event laypeople searched for.
  Evidence: Ocean Engineering trans-Pacific propagation study (rupture ~390-600 km × 140-200 km, peak slip ~30-40 m, 52.512°N 160.324°E) https://www.sciencedirect.com/science/article/pii/S002980182601749X; NCTR event page https://nctr.pmel.noaa.gov/kamchatka20250729/; NCEI DART archive (netCDF/CSV via THREDDS).
  Touches: src-tauri/src/presets.rs (cited entry), src/data/dart_buoys.json (new event + 2-3 buoys, downsampled like existing events), docs/science/REFERENCES.bib, src/data/coastal_points.json (verify Kamchatka/Hawaii/California points exist).
  Acceptance: preset loads with citation; SWE run shows DART sparkline comparison for the new buoys; preset tests (id uniqueness, finite outputs) pass.
  Complexity: M

- [ ] P1 — Arrival-time isochrone layer (NOAA TTT-style)
  Why: "when does it reach X" was the dominant lay question during Kamchatka; NOAA travel-time maps are the reference product; arrival times already exist per-point in `runup_at_points`.
  Evidence: NCEI TTT maps https://www.ncei.noaa.gov/products/natural-hazards/tsunamis-earthquakes-volcanoes/tsunamis/travel-time-maps; HN thread https://news.ycombinator.com/item?id=44729865; existing arrival-time math in src-tauri/src/commands.rs (`runup_at_points`).
  Touches: src-tauri/src/commands.rs or solver (gridded travel-time from first eta-threshold crossing per cell), src/components/Globe.tsx (contour/labelled-ring layer, toggleable), src/lib/export.ts (include in PNG/GeoJSON).
  Acceptance: toggling "Arrival times" renders labelled isochrones (e.g., 1 h intervals) on the globe for a completed SWE run; exported GeoJSON contains the contours.
  Complexity: M

- [ ] P1 — Max-field products: peak-amplitude and time-of-maximum layers
  Why: fgmax-style maximum fields are GeoClaw's most-used hazard product and SFINCS added a time-of-max flag in 2025; the solver currently discards per-cell history, so this is a cheap accumulator with high analysis value.
  Evidence: GeoClaw fgmax usage + issue #691; SFINCS v2.3.0 release notes https://github.com/Deltares/SFINCS/releases; src-tauri/src/physics/solver/mod.rs (no max tracking today).
  Touches: src-tauri/src/physics/solver/mod.rs and solver/gpu.rs (per-cell running max eta + t_of_max), GridSnapshot/final-result types, src/components/Globe.tsx (two new overlay choices), src/lib/export.ts (GeoJSON/CSV export).
  Acceptance: after a run, "Peak amplitude" and "Time of maximum" layers render from Rust-computed fields on both CPU and GPU paths (parity-tested), and export to GeoJSON.
  Complexity: M

- [ ] P1 — CPU/GPU kernel parity regression test
  Why: CPU/GPU eta divergence was a real shipped bug (fixed 2026-07-01, commit 8626470) and the WGSL kernel has zero automated coverage; a parity test locks the fix.
  Evidence: CHANGELOG "[Unreleased] CPU/GPU solver eta divergence fixed"; internal recon — no GPU tests.
  Touches: src-tauri/src/physics/solver/ (feature-gated `#[cfg(feature = "gpu")]` test comparing CPU vs GPU eta fields after N steps on a small grid; skip cleanly when no adapter).
  Acceptance: `cargo test --release --features gpu` asserts max |eta_cpu − eta_gpu| under a documented tolerance on a 64×64 grid; test skips (not fails) when no adapter is present.
  Complexity: M

### P2 — cited presets, products, and architecture

- [ ] P2 — Krakatau 1883 caldera-collapse preset (Choi 2003 "hole and ring" source)
  Why: fills the volcanic-source gap with the most iconic caldera event; Choi 2003 gives a simple citable initial displacement (~6 km diameter ring, 270 m depth) implementable with existing initial-displacement machinery — a lighter path than the blocked Maeno & Imamura model.
  Evidence: Choi et al. 2003, NHESS https://nhess.copernicus.org/articles/3/321/2003/; cross-ref Roadmap_Blocked "Volcanic caldera collapse source model" (P3) — this item partially supersedes it.
  Touches: src-tauri/src/physics/ (hole-and-ring IC helper), src-tauri/src/presets.rs, docs/science/, REFERENCES.bib.
  Acceptance: Krakatau 1883 preset runs end-to-end with citation; Sunda Strait coastal points show runup; preset tests pass.
  Complexity: M

- [ ] P2 — Anak Krakatau 2018 flank-collapse preset
  Why: modern, well-studied landslide tsunami (Grilli et al. 2019 parameters) that exercises the existing Fritz–Hager landslide module with zero new physics.
  Evidence: Grilli et al. 2019 https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6697749/.
  Touches: src-tauri/src/presets.rs, REFERENCES.bib, src/data/coastal_points.json (Sunda Strait points if missing).
  Acceptance: preset loads with cited volume/drop-height/slope parameters; finite-output preset test passes.
  Complexity: S

- [ ] P2 — Lisbon 1755 earthquake preset
  Why: 270th anniversary (2025-11) drove institutional attention; Barkan's USGS far-field study provides citable fault parameters; strong Atlantic coverage gap in the current Pacific-heavy preset list.
  Evidence: Barkan et al., USGS https://pubs.usgs.gov/publication/70036556; IOC anniversary events.
  Touches: src-tauri/src/presets.rs, REFERENCES.bib, src/data/coastal_points.json (Lisbon/Cádiz/Madeira/Caribbean points).
  Acceptance: preset runs with citation; Atlantic coastal points show arrivals; preset tests pass.
  Complexity: S

- [ ] P2 — Santorini–Amorgos scenario preset (2025 swarm context)
  Why: the 2025 swarm (20,000+ quakes) made Aegean tsunami risk front-page news and JMSE published deterministic scenario fault parameters in 2025-10.
  Evidence: JMSE 13(10):2005 https://doi.org/10.3390/jmse13102005; 1956 Amorgos analog.
  Touches: src-tauri/src/presets.rs, REFERENCES.bib, src/data/coastal_points.json (Aegean points).
  Acceptance: preset runs with cited fault geometry; preset tests pass.
  Complexity: S

- [ ] P2 — Sanriku (Miyako) 2026-04-20 Mw 7.7 preset + "the warning worked" lesson
  Why: recent NCTR-modeled Japan event; pairs with a guided lesson about detection 17 minutes post-rupture — a positive warning-system story complementing Tōhoku.
  Evidence: NCTR event page https://nctr.pmel.noaa.gov/miyako20260420/; peer-reviewed source parameters may still be in review — use USGS finite-fault, flag confidence in the preset comment.
  Touches: src-tauri/src/presets.rs, src/lib/guided-lessons.ts, REFERENCES.bib.
  Acceptance: preset runs; new 3-step lesson persists completion like existing lessons.
  Complexity: S

- [ ] P2 — 2024 YR4 "what-if" asteroid preset with airburst myth-busting lesson
  Why: the Feb 2025 news cycle spawned viral "88 m wave" misinformation; NASA's counter-explanation (a ~60 m airbursting object is unlikely to produce a significant tsunami) is a perfect Poseidon-debunk-pattern lesson exercising the Ward–Asphaug module.
  Evidence: NASA 2024 YR4 facts https://science.nasa.gov/solar-system/asteroids/2024-yr4-facts/; existing poseidon-debunk lesson pattern (src/lib/guided-lessons.ts).
  Touches: src-tauri/src/presets.rs, src/lib/guided-lessons.ts, REFERENCES.bib.
  Acceptance: preset + 3-step myth-busting lesson ship; lesson states the airburst caveat explicitly.
  Complexity: S

- [ ] P2 — Tsunami energy/directivity map layer (RIFT-style)
  Why: PTWC energy maps are the standard visual in every event's news coverage; computable from existing SWE fields as an integrated eta² directivity product.
  Evidence: NOAA energy map product https://noaa.hub.arcgis.com/content/9c4e79757d3b45f7a522fc7072d60c15.
  Touches: src-tauri/src/physics/solver/mod.rs (time-integrated energy accumulator, builds on max-field plumbing), src/components/Globe.tsx, src/lib/export.ts.
  Acceptance: "Energy" overlay renders a directivity-lobed field for a completed run; documented as qualitative (not PTWC-calibrated) in the glossary.
  Complexity: M

- [ ] P2 — Modularize commands.rs into submodules
  Why: 1,944 lines and growing with each new IPC; split into types/validators/simulation/source/query keeps the boundary reviewable. Returns from Roadmap_Blocked (stale MSVC blocker).
  Evidence: src-tauri/src/commands.rs line count; Roadmap_Blocked "Modularize commands.rs".
  Touches: src-tauri/src/commands/ (new module tree), src-tauri/src/lib.rs.
  Acceptance: no behavior change; all 67+ Rust tests pass; no file exceeds ~600 lines.
  Complexity: M

- [ ] P2 — `diagnostics_bundle` IPC + copyable support bundle in LogViewer
  Why: support-ready diagnostics (GPU adapter name/driver, wgpu version, solver mode, settings schema version, OS) cut triage time; the Rust-side blocker was stale MSVC. Returns from Roadmap_Blocked.
  Evidence: Roadmap_Blocked "Structured error reporting with diagnostics bundle"; src/components/LogViewer.tsx severity counts already exist.
  Touches: src-tauri/src/commands.rs (new command), src/components/LogViewer.tsx ("Copy diagnostics" button), src/lib/tauri.ts.
  Acceptance: one click copies a JSON bundle (app version, OS, GPU adapter, solver mode, recent log entries) to the clipboard; no PII/token included.
  Complexity: M

- [ ] P2 — Port inundation/gauge overlays to Cesium `GeoJsonPrimitive` + arrival-colored paths via `PathGraphics.materialMode`
  Why: Cesium 1.142's `GeoJsonPrimitive` bypasses the Entity layer for exactly this app's dynamic vector loads; 1.143's "PORTIONS" material mode enables per-interval arrival-time coloring of propagation paths — both free perf/visual wins after the 1.143 bump.
  Evidence: Cesium CHANGES.md 1.142/1.143; runup overlays already migrated to Primitive API (2026-06-19 CLAUDE.md status) — this extends the pattern.
  Touches: src/components/Globe.tsx, src/components/CoastalRunupOverlay.tsx.
  Acceptance: inundation discs and gauge markers render via primitives with no visual regression (Playwright visual baselines updated deliberately); frame rate on a 500-point run measurably improves or holds.
  Complexity: M

- [ ] P2 — Store the Cesium ion token in the OS keychain via the `keyring` crate
  Why: the token sits in plain settings.json today; the old blocker ("tauri-plugin-keyring ecosystem still emerging") is resolvable by calling the mature `keyring` crate directly from a Tauri command — lower supply-chain risk than thin wrapper plugins, and stronghold is deprecated. Unblocks I-V04 from Roadmap_Blocked.
  Evidence: keyring crate; tauri-plugin-stronghold deprecation https://v2.tauri.app/plugin/stronghold/.
  Touches: src-tauri/Cargo.toml (keyring dep), src-tauri/src/commands.rs (get/set/delete token commands), src/components/Settings.tsx, src/lib/settings.ts (migration: move existing token, blank the store copy).
  Acceptance: token round-trips through Windows Credential Manager (and Keychain/Secret Service on other OSes); settings.json no longer contains it; migration preserves an existing token.
  Complexity: M

- [ ] P2 — Keyboard navigation and SVG icon accessibility audit
  Why: recon found `UiIcon.tsx` SVGs without aria-labels and no systematic tab-order/arrow-key coverage beyond modal focus traps; the axe suite checks static WCAG rules, not keyboard operability.
  Evidence: internal recon 2026-07-09 (src/components/UiIcon.tsx; useFocusTrap.ts covers modals only).
  Touches: src/components/UiIcon.tsx (aria-label/aria-hidden discipline), preset rail/timeline/gauge list keyboard handlers, tests/ (Playwright keyboard-only walkthrough spec).
  Acceptance: a keyboard-only Playwright spec completes the core flow (pick preset → run solver → scrub → export) without pointer events; axe suite stays green.
  Complexity: M

- [ ] P2 — NCEI HazEL historical tsunami event browser
  Why: the NCEI Natural Hazards REST API serves 2,200+ tsunami sources and 26,000+ runup records as free JSON — a one-click "load a real historical event" picker built on it dwarfs the 12-preset registry without bloating the binary.
  Evidence: https://www.ngdc.noaa.gov/hazel/ (public REST API backing).
  Touches: src/components/ (new browser modal, online-only with clear offline state), src-tauri capability/CSP allowlist for the NCEI host, src/lib/ (API client + mapping to scenario parameters with confidence caveats).
  Acceptance: searching "1960 Chile" lists the event and loads magnitude/epicenter into the scenario builder with a provenance note; feature degrades gracefully offline; CSP gate updated deliberately.
  Complexity: M

- [ ] P2 — Compile the physics crate to WASM for browser preview (retire demo.ts physics)
  Why: `demo.ts` (703 lines) forks physics truth and its numbers drift — the documented carve-out exists only because the browser can't call Rust; wasm-bindgen removes that constraint, deletes the drift class entirely, and is the foundation for any future web demo (Celeris-WebGPU is capturing the zero-install audience). Supersedes blocked "Build-time demo data generation from Rust".
  Evidence: src/lib/demo.ts; CLAUDE.md carve-out note; Celeris June 2026 momentum https://github.com/plynett/plynett.github.io/commits/main.
  Touches: src-tauri (physics crate split or wasm feature + wasm-bindgen exports for source models, far-field, runup — solver optional), vite.config.ts (wasm asset), src/lib/demo.ts (thin wrapper over WASM), CSP (wasm-eval already effectively allowed via unsafe-eval).
  Acceptance: browser preview source readouts/attenuation/runup numbers come from the same Rust code as desktop (spot-check equality); "APPROXIMATE" watermark scope narrows to the JS SWE playback only (or is removed if the solver is also compiled); bundle size delta documented.
  Complexity: L

- [ ] P2 — Meteotsunami source type (moving pressure disturbance, Proudman resonance)
  Why: demand triangulates three ways — GeoClaw issue #694 requests parameterized pressure forcing, EDANYA ships a dedicated Meteo-HySEA code, and the record June 2025 Lake Superior meteotsunami (45-inch surge) is a citable preset; the Lamb-wave module is precedent for atmospheric coupling but this needs time-dependent forcing in the solver loop.
  Evidence: https://github.com/clawpack/geoclaw/issues (#694); https://www.glerl.noaa.gov/blog/2025/07/18/june-21-2025-storm-causes-significant-meteotsunami-and-seiche-on-lake-superior/; Meteo-HySEA https://cheese2.eu/news/the-power-of-hysea-advancing-tsunami-simulations/.
  Touches: src-tauri/src/physics/ (new source module: pressure amplitude, disturbance speed/heading, track), solver/mod.rs + gpu.rs (per-step pressure-gradient forcing term), ScenarioBuilder.tsx (fifth source type), docs/science/, presets.rs (Lake Superior 2025-06-21 preset).
  Acceptance: a moving-pressure scenario reproduces Proudman amplification when disturbance speed ≈ √(gh) (validation test); Lake Superior preset ships with GLERL citation.
  Complexity: L

- [ ] P2 — NTHMP benchmark cases in the validation harness
  Why: the canonical benchmark data is publicly downloadable (rjleveque/nthmp-benchmark-problems) — the "data acquisition" half of the blocked item is stale; start with the 1-2 propagation benchmarks solvable by a non-dispersive SWE code (e.g., BP4 solitary wave on a simple beach analog to existing Synolakis work) rather than the full suite.
  Evidence: https://github.com/rjleveque/nthmp-benchmark-problems; existing validation feature (Stoker, Carrier-Greenspan, Range 2022) in src-tauri/src/physics/validation.rs. Cross-ref Roadmap_Blocked "NTHMP benchmark suite integration" (P3/XL) — this is the tractable first slice.
  Touches: src-tauri/src/physics/validation.rs (new feature-gated cases + vendored benchmark data snippets with license note), docs/science/VALIDATION.md.
  Acceptance: at least one NTHMP propagation benchmark passes within a documented tolerance under `cargo test --release --features validation`; VALIDATION.md documents which benchmarks are out of reach without Boussinesq/AMR and why.
  Complexity: L

### P3 — education distribution and larger bets

- [ ] P3 — Zarr v3 scientific output export via `zarrs` (pure Rust)
  Why: gives researchers a chunked, self-describing raw-field export without the C-library NetCDF burden that keeps the NetCDF item blocked; zarrs 0.23.x is spec-complete Zarr v3.1. Note: raises rust-version to 1.91 (schedule after the P0 1.87 bump).
  Evidence: https://crates.io/crates/zarrs; Roadmap_Blocked "NetCDF output export" C-dependency blocker.
  Touches: src-tauri/Cargo.toml, new export command (eta/max-field arrays + CF-style attrs), src/lib/export.ts (menu entry, desktop-only).
  Acceptance: an exported store opens in Python (`zarr.open`) with correct dims/coords/units; documented in the manual.
  Complexity: M

- [ ] P3 — Teacher mode: locked settings profiles + printable worksheet pack
  Why: PhET monetized exactly this (PhET Studio, 2025) and TeachEngineering/TPT show worksheet demand; the settings export/import and print stylesheet shipped in v0.4.x are the natural base.
  Evidence: https://phet-io.colorado.edu/io-solutions/; https://www.teachengineering.org/lessons/view/cub_natdis_lesson06; existing settings export/import (commit 816384e-era) and print stylesheet.
  Touches: src/lib/settings.ts (locked-profile flag honored on import), src/components/Settings.tsx, docs/manual/ (2-3 printable worksheet pages per guided lesson using the print stylesheet).
  Acceptance: importing a "classroom" profile hides token entry and pins presets/colormap; each of the 5 lessons has a printable worksheet reachable from the lesson UI.
  Complexity: M

- [ ] P3 — Humanitarian-impact layer: OSM schools/hospitals/critical facilities inside the runup zone
  Why: NUKEMAP's 2026 roadmap names this the top public-facing addition; it is the ethically softer alternative to the rejected casualty overlay — counts of facilities, not people.
  Evidence: https://blog.nuclearsecrecy.com/2026/02/10/nukemap-roadmap/.
  Touches: src/lib/ (Overpass API client, online-only, cached), Globe.tsx (facility pins within inundation discs), CSP allowlist, disclaimer copy (first-order estimate framing).
  Acceptance: for a completed run, an opt-in layer lists/pins OSM-tagged schools+hospitals inside inundation extents with an explicit limitations note; degrades gracefully offline.
  Complexity: L

- [ ] P3 — SWOT satellite swath overlay for the Kamchatka preset
  Why: June 2026 SWOT coverage is the first detailed satellite imaging of a tsunami in motion — an observed-vs-simulated visual no competitor has; depends on the Kamchatka preset and a PO.DAAC licensing check (see RESEARCH.md Open Questions).
  Evidence: https://www.sciencedaily.com/releases/2026/06/260623011002.htm; HN https://news.ycombinator.com/item?id=46133555.
  Touches: src/data/ (processed swath GeoJSON), Globe.tsx (toggleable overlay on the Kamchatka preset), docs/science/.
  Acceptance: Kamchatka preset offers a "SWOT observed" overlay with timestamp and attribution; simulated wavefront at the same epoch renders alongside.
  Complexity: M

- [ ] P3 — i18n foundation + Spanish/Japanese/Bahasa Indonesia
  Why: IOC/ITIC distributes tsunami education in exactly these languages and PhET's translated+offline model proves distribution value; do the string-catalog extraction first, translations second. Cross-ref Roadmap_Blocked "Multi-language UI" — this refines its language order with evidence.
  Evidence: http://itic.ioc-unesco.org/index.php?option=com_content&view=article&id=1349&Itemid=+1075&lang=en; https://phet.colorado.edu/en/simulations/translated.
  Touches: all user-facing strings (extraction to catalog), src/lib/ (locale plumbing), Settings.tsx (language picker), glossary/lesson content.
  Acceptance: language switch swaps full UI including lessons/glossary; en remains canonical; missing keys fall back to en with a dev warning.
  Complexity: XL
