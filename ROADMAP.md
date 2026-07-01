# TsunamiSimulator Roadmap

Single source of truth for delivery. Blocked items live in
[`Roadmap_Blocked.md`](./Roadmap_Blocked.md). Shipped work is summarized in
[`CHANGELOG.md`](./CHANGELOG.md).

---

## Audit-Driven — Rust compilation required

- [ ] P1 — Fix CPU/GPU SWE solver eta reference divergence
  Why: CPU momentum step uses post-continuity eta while GPU kernel uses pre-step eta, producing different wavefronts for the same input. Regression test passes only because tolerance is 1e-3 at low amplitude.
  Where: `src-tauri/src/physics/solver/mod.rs` line ~720, `src-tauri/src/physics/solver/kernels.rs` line ~124

- [ ] P2 — Remove or wire unused `decay_alpha` field in `far_field_amplitude`
  Why: The field is accepted and validated but ignored; the computation uses hardcoded exponents. Misleading API surface.
  Where: `src-tauri/src/commands.rs` lines 192, 217-222

- [ ] P2 — Add earthquake `water_depth_m` range validation
  Why: `earthquake_initial_conditions` accepts any finite depth (including negative) while asteroid/nuclear enforce [0, 12000]. Inconsistent input validation.
  Where: `src-tauri/src/commands.rs` line ~181

- [ ] P3 — Use Release/Acquire ordering for cancel token across threads
  Why: `Relaxed` ordering is correct on x86 but could delay cancellation indefinitely on ARM (future Tauri mobile builds).
  Where: `src-tauri/src/commands.rs` line ~1164, `src-tauri/src/physics/solver/mod.rs` line ~597
