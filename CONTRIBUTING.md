# Contributing to TsunamiSimulator

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
- Rust stable ≥ 1.78 (install via `rustup`)
- Tauri CLI v2: `cargo install tauri-cli --version "^2.0"`
- Platform deps:
  - **Windows**: Visual Studio 2022/2026 with "Desktop development with C++" workload (provides MSVC `link.exe`)
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libsoup-3.0-dev`

Run:

```bash
git clone https://github.com/SysAdminDoc/TsunamiSimulator
cd TsunamiSimulator
cp .env.example .env  # optional: paste a Cesium ion token; or use the Settings UI at runtime
npm install
npm run tauri dev
```

Before opening a PR, run:

```bash
npx tsc --noEmit                              # TypeScript typecheck
npx vite build                                # Production build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --release --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

CI runs all of the above on Linux, Windows, and macOS for every PR.

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

Use the issue templates in `.github/ISSUE_TEMPLATE/`. For security issues
follow `SECURITY.md` (private disclosure).

## License

By contributing you agree your contributions are licensed under the
[MIT License](./LICENSE).
