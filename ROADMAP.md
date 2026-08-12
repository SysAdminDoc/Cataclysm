# Cataclysm Roadmap

Actionable work only. Historical and completed roadmap material is archived in CHANGELOG.md; blocked work is kept in Roadmap_Blocked.md.

## Actionable Items

- [ ] P3 — Add an NGSS engineering-design "mitigation" mode
  Why: classroom natural-hazard units (NGSS 4-ESS3-2, TeachEngineering "Survive That Tsunami!") are explicitly design-solution oriented, and letting a user place a barrier/sea wall and re-run makes the app curriculum-adoptable rather than a passive demo.
  Evidence: TeachEngineering tsunami design activity https://www.teachengineering.org/activities/view/cub_natdis_lesson06_activity1; NGSS 4-ESS3-2 https://thewonderofscience.com/4ess32; solver bathymetry/land-mask handling in `src-tauri/src/physics/solver/`.
  Touches: user-placed barrier objects that raise local bathymetry / add reflective cells, re-run + before/after comparison, mitigation UI, education copy tying to the standard.
  Acceptance: a user can place a simple barrier on the coast, re-run, and compare inundation with and without it; the barrier is represented as a documented bathymetry/reflectivity modification with stated simplifications; results are labelled educational.
  Complexity: L

- [ ] P3 — OS notification and optional chime on long-run completion
  Why: solver runs (grid/streaming, ensembles) can take a while and users may look away; a completion notification is a small no-network quality-of-life win with no privacy cost.
  Evidence: Verified absent — no notification plugin in `package.json`/`Cargo.toml`; long runs surface only in-app via `SimulationTransport`. Tauri notification plugin (local OS notifications) https://v2.tauri.app/plugin/notification/.
  Touches: `@tauri-apps/plugin-notification` (+ capability grant scoped to the main window), `src/components/SwePlayback.tsx`/`App.tsx` (fire on run completion/failure), a Settings toggle honoring the existing sonification/quiet preferences, `src/lib/settings.ts`.
  Acceptance: when a long run finishes or fails while the window is unfocused, an opt-in local OS notification (and optional short chime reusing the sonification path) fires; the toggle defaults consistently with existing audio/quiet settings; nothing is transmitted off-device; disabled in teacher/classroom-locked mode if it would disrupt a lesson.
  Complexity: S

- [ ] P3 — Interactive "poke the wave" exploratory sandbox (non-reproducible mode)
  Why: Celeris' entire engagement hook is letting users perturb the wave field live and watch it respond — a powerful teaching affordance Cataclysm's wgpu solver can support; scoped explicitly as an exploratory mode that never feeds the deterministic/archived pipeline so it doesn't violate the reproducibility rules.
  Evidence: Celeris-WebGPU interactive editing https://plynett.github.io/ · https://github.com/plynett/plynett.github.io; existing GPU solver in `src-tauri/src/physics/solver/gpu.rs`. Reproducibility constraint per CLAUDE.md (max-field products must observe every accepted step) — this mode is deliberately outside that pipeline.
  Touches: a sandbox toggle in the playback UI, an IPC path that injects a bounded surface perturbation at a picked globe point into a running/paused linear-mode solve, clear "Exploratory — not a validated or exportable run" labelling, guardrails preventing sandbox state from being archived/exported/compared.
  Acceptance: in an explicitly-labelled exploratory mode, clicking the globe injects a bounded disturbance and the wave field visibly responds; the mode cannot produce archived, compared, or exported results and is visually distinct from validated runs; leaving the mode restores the authoritative run state; determinism of the normal pipeline is unaffected.
  Complexity: L
