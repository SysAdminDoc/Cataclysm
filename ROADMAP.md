# TsunamiSimulator Roadmap

Single source of truth for delivery. Blocked items live in
[`Roadmap_Blocked.md`](./Roadmap_Blocked.md). Shipped work is summarized in
[`CHANGELOG.md`](./CHANGELOG.md).

---

## Research-Driven Additions

### P0 — Now

- [ ] P0 — Upgrade Vite 7.3 → 8.0 (Rolldown bundler)
  Why: 10-30x faster builds via Rust-based Rolldown bundler; browser console forwarding for Tauri WebView debugging
  Evidence: Vite 8 announcement (vite.dev/blog/announcing-vite8); Rolldown replaces esbuild+Rollup
  Touches: package.json, vite.config.ts; verify CesiumJS manualChunks compatibility with Rolldown
  Acceptance: `npm run build` completes significantly faster; `npm run tauri dev` hot-reload works; all CI jobs pass
  Complexity: S

- [ ] P0 — Add cargo-deny to CI pipeline
  Why: License auditing, duplicate dependency detection, and crate ban-lists are absent; cargo-audit alone misses license and duplication risks
  Evidence: Microsoft Rust training supply-chain guide; corgea.com Rust security best practices 2025
  Touches: src-tauri/deny.toml (new), .github/workflows/ci.yml (new job)
  Acceptance: CI job runs `cargo deny check` clean; deny.toml configured with license allowlist and advisory DB
  Complexity: S

- [ ] P0 — Upgrade rayon 1.10 → 1.12
  Why: `par_array_windows` enables fixed-size windowed parallel computations; bug fixes for WASM edge cases and Range iteration
  Evidence: rayon RELEASES.md (v1.11.0 + v1.12.0)
  Touches: src-tauri/Cargo.toml
  Acceptance: `cargo check` + `cargo test --release` pass; no behavioral change
  Complexity: S

### P1 — Next

- [ ] P1 — Upgrade TypeScript 5.7 → 6.0
  Why: `strict: true` default catches latent type bugs; Temporal API types for time-series data; `es2025` target; prepares for 10x-faster TS 7.0 native port
  Evidence: TypeScript 6.0 announcement (devblogs.microsoft.com/typescript/announcing-typescript-6-0/)
  Touches: package.json, tsconfig.json; fix any new strict-mode type errors
  Acceptance: `npx tsc --noEmit` passes with TypeScript 6.0; no runtime regressions; all CI jobs pass
  Complexity: M

- [ ] P1 — Unblock property-based tests for physics modules
  Why: MSVC linker blocker resolved 2026-06-01 (CLAUDE.md); proptest catches edge-case physics bugs that hand-written unit tests miss (monotonicity, conservation, bound violations)
  Evidence: CLAUDE.md MSVC resolution note; Roadmap_Blocked.md "Property-based tests" item cites MSVC as sole blocker
  Touches: src-tauri/Cargo.toml (add proptest dev-dep), src-tauri/src/physics/asteroid.rs, okada.rs, solver/mod.rs
  Acceptance: `cargo test` runs proptest strategies for cavity-diameter monotonicity, Okada slip bound, SWE mass conservation
  Complexity: M

- [ ] P1 — Unblock modularize commands.rs
  Why: MSVC linker resolved; 1742-line monolith hinders navigation, review, and independent testing
  Evidence: CLAUDE.md MSVC resolution; Roadmap_Blocked.md "Modularize commands.rs" cites cargo check as blocker
  Touches: src-tauri/src/commands.rs → commands/{mod,types,validators,simulation,source,query}.rs
  Acceptance: `cargo check --all-targets` + `cargo test --release` pass; no IPC contract change; same 15 Tauri commands registered
  Complexity: M

- [ ] P1 — GEBCO REST API for on-demand solver bathymetry
  Why: Newly published GEBCO REST API (2026 peer-reviewed paper) enables real depth queries at solver resolution without downloading the blocked 440 MB grid; partially unblocks F-V06
  Evidence: GEBCO API paper (ScienceDirect S2665963826000291); download.gebco.net subsetting tool
  Touches: src-tauri/Cargo.toml (add reqwest with rustls), src-tauri/src/data/bathymetry.rs (API client alongside offline fallback)
  Acceptance: `simulate_grid` uses GEBCO API depth at source region when online; falls back to coarse offline bathymetry when offline or rate-limited
  Complexity: L

- [ ] P1 — Arrival-time isochrone overlay on globe
  Why: Table-stakes in operational tools (MOST, ComMIT, Tsunami-HySEA); shows when the wave reaches each coastline; absent from every consumer tool surveyed
  Evidence: NOAA MOST visualization; ComMIT GUI documentation; Tsunami-HySEA publications
  Touches: src-tauri/src/commands.rs (new `isochrone_contours` IPC), src/components/Globe.tsx (contour entity rendering)
  Acceptance: Concentric contour lines on globe showing T+1h, T+2h, etc. wave arrival times; updates when source or depth changes
  Complexity: M

- [ ] P1 — Use Tauri emit_str* for SWE streaming IPC
  Why: Pre-serialized JSON over IPC avoids double-serialization overhead on high-frequency SWE snapshot delivery (24 PNG snapshots per simulation)
  Evidence: Tauri 2.3.0 changelog — emit_str/emit_str_to methods added for pre-serialized payloads
  Touches: src-tauri/src/commands.rs (simulate_grid_streaming serialization path)
  Acceptance: Measurable throughput improvement on SWE streaming; no behavioral change
  Complexity: S

### P2 — Later

- [ ] P2 — Unblock build-time demo data generation from Rust
  Why: MSVC resolved; replaces the 665-line demo.ts JS physics reimplementation (known drift risk per CLAUDE.md) with Rust-generated JSON fixtures
  Evidence: CLAUDE.md demo.ts drift note and "BROWSER PREVIEW — APPROXIMATE" watermark; MSVC resolution 2026-06-01
  Touches: src-tauri/Cargo.toml (new [[bin]] target), new src-tauri/src/bin/gen_demo.rs, src/lib/demo.ts (remove physics, keep data)
  Acceptance: Browser preview uses Rust-generated JSON fixtures; demo.ts contains only preset data and lookup functions, no physics formulas
  Complexity: L

- [ ] P2 — Wave attenuation chart panel
  Why: Interactive height-vs-distance plot complements the spatial globe visualization; Impact: Earth! and NUKEMAP show numerical readouts but no chart; no consumer tool surveyed offers this
  Evidence: Impact: Earth! distance-based output; NUKEMAP damage zones; DART sparklines already in the app (DartOverlay.tsx)
  Touches: new src/components/AttenuationChart.tsx, App.tsx layout integration
  Acceptance: Chart shows amplitude-vs-distance curve synced with time scrubber; updates live during SWE playback
  Complexity: M

- [ ] P2 — Scenario deep-link URL sharing
  Why: Shareable links without clipboard copy/paste; standard in consumer tools (NUKEMAP, TerriaJS)
  Evidence: NUKEMAP URL-based scenario sharing; TerriaJS shareable URLs with encoded state
  Touches: src/lib/scenario-schema.ts (URL encoding/decoding), App.tsx (URL query parsing on mount)
  Acceptance: "Copy link" button produces URL that restores full scenario state including source type and parameters
  Complexity: M

- [ ] P2 — Playwright CDP-based Tauri desktop testing
  Why: Current e2e tests run against browser preview only (vite preview on port 4187); CDP testing exercises the real WebView2 + Rust IPC path
  Evidence: playwright-cdp project (github.com/Haprog/playwright-cdp); Playwright 1.58 isLocal CDP option
  Touches: playwright.config.ts (add Tauri CDP project), tests/ (new desktop-specific test file)
  Acceptance: At least 3 smoke tests run against actual Tauri WebView2 window on Windows CI
  Complexity: M

- [ ] P2 — Historical event timeline visualization
  Why: Chronological visual of all 10+ presets from 66 Ma to present; makes the preset catalog more discoverable and educational
  Evidence: IRIS Earthquake Browser timeline; TsunamiLab museum exhibition patterns
  Touches: new src/components/TimelineView.tsx, PresetSelector.tsx (alternate view toggle)
  Acceptance: Scrollable horizontal timeline with clickable event markers; clicking selects the corresponding preset
  Complexity: S

- [ ] P2 — KMZ/KML export for Google Earth
  Why: Google Earth compatibility for offline viewing and classroom presentations; NUKEMAP ships KMZ export; CZML export already exists in the app
  Evidence: NUKEMAP KMZ export feature; existing exportCzml() in src/lib/export.ts
  Touches: src/lib/export.ts (add KML generation function)
  Acceptance: Exported KMZ opens in Google Earth Pro showing wavefront ring and runup bar positions
  Complexity: M

- [ ] P2 — Unblock structured error reporting with diagnostics bundle
  Why: MSVC resolved; Rust-side diagnostics (GPU adapter name, wgpu version, OS info) enable actionable bug reports from users
  Evidence: CLAUDE.md MSVC resolution; Roadmap_Blocked.md lists this as blocked on MSVC + new IPC command
  Touches: src-tauri/src/commands.rs (new `diagnostics_bundle` IPC command), src/components/LogViewer.tsx (copy diagnostics button)
  Acceptance: LogViewer "Copy diagnostics" button includes GPU adapter name, driver version, OS, app version, feature flags
  Complexity: S

- [ ] P2 — React 19.2 Activity component for panel state preservation
  Why: Switching between compare/normal mode or between panels destroys component state; Activity preserves hidden subtrees without unmounting effects
  Evidence: React 19.2 blog post (react.dev/blog/2025/10/01/react-19-2)
  Touches: package.json (React 19.0→19.2), App.tsx panel management for compare/SWE/settings panels
  Acceptance: SWE playback state survives compare mode toggle; simulation snapshots not lost on panel switch
  Complexity: S
