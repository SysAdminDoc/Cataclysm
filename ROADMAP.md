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

### P2 — cited presets, products, and architecture

- [ ] P2 — Modularize commands.rs into submodules
  Why: 1,944 lines and growing with each new IPC; split into types/validators/simulation/source/query keeps the boundary reviewable. Returns from Roadmap_Blocked (stale MSVC blocker).
  Evidence: src-tauri/src/commands.rs line count; Roadmap_Blocked "Modularize commands.rs".
  Touches: src-tauri/src/commands/ (new module tree), src-tauri/src/lib.rs.
  Acceptance: no behavior change; all 67+ Rust tests pass; no file exceeds ~600 lines.
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
