# Contributing to Cataclysm

Thanks for your interest. The short version: this project exists to combine
peer-reviewed tsunami physics with an interactive 3D globe in a desktop app.
Contributions should advance one or both of those goals.

## Ground rules

1. **Physics needs citations.** Any change to a formula or coefficient must
   reference a peer-reviewed paper or authoritative report (e.g. NOAA, USGS,
   DOE, DNA technical report). The `src-tauri/src/physics/*` modules document
   the source paper in their module-level docstring; new modules should follow
   the same convention.
2. **Preset parameters need primary sources.** Every preset in
   `src-tauri/src/presets.rs` cites the paper its parameters come from. Don't
   add a preset whose parameters can't be traced.
3. **One logical change per PR.** Small, reviewable diffs are easier to land.
4. **No AI attribution in committed artifacts** — code, commit messages,
   PR descriptions, or docs. `CLAUDE.md`, `.claude/`, and any agent working
   files stay gitignored.

## Development setup

Prerequisites:

- Node.js ≥ 20
- Rust stable ≥ 1.91 (install via `rustup`)
- Platform deps:
  - **Windows**: Visual Studio 2022/2026 with "Desktop development with C++" workload (provides MSVC `link.exe`)
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libsoup-3.0-dev`

The Tauri CLI ships as the `@tauri-apps/cli` npm dev dependency, so
`npm install` is enough — no separate `cargo install tauri-cli` step.

Run:

```bash
git clone https://github.com/SysAdminDoc/Cataclysm
cd Cataclysm
npm install
npm run tauri dev
```

The app boots on the bundled Natural Earth II globe out of the box, so the
first run does not need network tiles or a token. To use the Cesium ion-backed
globe styles (World Imagery / GEBCO bathymetry), either `cp .env.example .env`
and paste a free token, or paste it into Settings at runtime.

Before opening a PR or pushing directly, run the local verification gate:

```bash
npm run verify
```

Current product facts live in `src/data/product-truth.json`. When changing the
name, release version, runtime floor, playback cadence, Earth-provider default,
or release policy, update that manifest and run `npm run verify:product-truth`;
the full gate rejects stale docs, onboarding copy, metadata, or ledger rows.

That command covers application and support-code typechecking, JavaScript
syntax checks, repository-wide lint, unit tests, production build, npm audit,
Playwright browser-preview checks, Rust check/test/clippy, and Rust
advisory/license tools when `cargo-audit` or `cargo-deny` are installed. During
active debugging, the individual gates are:

```bash
npm run typecheck                             # App + tests/config TS + support JS syntax
npm run lint                                  # Source, tests, scripts, and root configs
npm run test:e2e                              # Build or prove a fresh dist, then Playwright
npx vite build                                # Production build
npm audit --audit-level=moderate              # npm supply-chain check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --release --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

`npm run test:e2e` records a deterministic digest of the production inputs in
`dist/build-provenance.json`. It reuses `dist` only when that digest and all
required PWA outputs match; Playwright's preview server independently rejects a
missing or stale record so invoking Playwright directly cannot test old output.

GitHub Actions are intentionally not used for this repo. Builds, tests, release
bundles, and advisory checks are local maintainer responsibilities.

## Dependency refresh cadence

Since Dependabot is not used, dependency maintenance is manual. Run:

```bash
npm run deps-check
```

This reports npm outdated packages, npm audit results, and the install status
of `cargo-audit` / `cargo-deny`. Recommended cadence:

| Frequency | Action |
|-----------|--------|
| Weekly | `npm audit` |
| Monthly | `npm outdated` → `npm update` → commit lockfile |
| Monthly | `cargo update` → `cargo audit` → `cargo deny check` (when tools are installed) |
| Quarterly | Review and apply major version bumps (check changelogs before upgrading) |

After updating, run `npm run verify` before pushing.

## Architecture

- **Frontend** (`src/`) — React 19 + TypeScript + Vite + CesiumJS. Owns
  rendering, controls, time-scrub UX.
- **Backend** (`src-tauri/`) — Rust + Tauri 2. Owns *all* physics. Don't add
  formulas to the React side; they belong in `src-tauri/src/physics/`.
- **IPC** — frontend talks to backend via typed `tauri::invoke` wrappers in
  `src/lib/tauri.ts`. Add new wrappers there when you add new commands.
- **Settings** — persisted via `tauri-plugin-store`. See `src/lib/settings.ts`.
- **Capabilities** — `src-tauri/capabilities/default.json` lists allowed
  shell-open URLs. Add new citation hosts here; deny by default.

## Adding a preset

1. Add the source-physics parameters to `src-tauri/src/presets.rs::all_presets()`.
2. Include a `reference` (Author year + journal + page) and a `reference_url`
   pointing to the publisher or DOI.
3. Add the citation host to `src-tauri/capabilities/default.json` if it's a
   new domain.
4. Add the BibTeX entry to `docs/science/REFERENCES.bib`.
5. Note any controversy / speculative status via `is_speculative: true` and a
   `controversy_note` — see Cumbre Vieja, Poseidon presets for the pattern.

## Style

- Rust: standard `rustfmt`. Constants with units in their names
  (`cavity_radius_m`, `J_PER_MT_TNT`). Function-level docstrings cite the
  source paper.
- TypeScript: strict mode is on. Don't disable it. Functional React with
  hooks; no class components.
- CSS: corner radii are restricted to `{0, 4, 6, 8, 10, 12}` px — see
  `src/styles.css` `--r-sm/md/lg`. No pill / stadium / fully-rounded
  backdrops on text-bearing elements.

## Reporting bugs

Use the issue templates in `.github/ISSUE_TEMPLATE/`. For security issues,
open a private GitHub vulnerability report from the repository Security tab.

## License

By contributing you agree your contributions are licensed under the
[MIT License](./LICENSE).
