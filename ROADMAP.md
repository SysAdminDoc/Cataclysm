# TsunamiSimulator Roadmap

Single source of truth for delivery. Blocked items live in
[`Roadmap_Blocked.md`](./Roadmap_Blocked.md). Shipped work is summarized in
[`CHANGELOG.md`](./CHANGELOG.md).

---

## Audit-Driven — Performance

- [ ] P3 — Eliminate per-step Vec clones in CPU solver
  Why: `step_one()` clones eta_m, u_ms, v_ms (~96 MB for a 4M-cell grid) every time step. A double-buffer swap pattern would eliminate the allocation churn.
  Where: `src-tauri/src/physics/solver/mod.rs` lines 619-621

## Audit-Driven — Cleanup

- [ ] P3 — Remove dead `is_impact` field from `FarFieldRequest`
  Why: The field exists in the IPC contract but is unused since `decay_alpha` now drives the computation. Marked `serde(default)` for backward compat; should be removed from both Rust struct and TypeScript type.
  Where: `src-tauri/src/commands.rs` line 196, `src/lib/tauri.ts` line 75
