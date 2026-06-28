# TsunamiSimulator Roadmap

Single source of truth for delivery. Blocked items live in
[`Roadmap_Blocked.md`](./Roadmap_Blocked.md). Shipped work is summarized in
[`CHANGELOG.md`](./CHANGELOG.md).

---

## Research-Driven Additions

### P2

### P3

- [ ] P3 — Design a teacher-friendly guided scenario path
  Why: Comparable public education tools win by making complex models legible quickly; TsunamiSimulator has strong science but no structured lesson flow beyond the first-run tour.
  Evidence: README personas and "NukeMap for tsunamis" positioning; NOAA Science On a Sphere / Impact: Earth / NUKEMAP education patterns; `src/components/Tour.tsx`
  Touches: `src/components/Tour.tsx`, `src/components/PresetSelector.tsx`, `docs/manual/getting-started.md`, optional preset metadata
  Acceptance: Users can launch 3-5 guided scenarios that explain source choice, model limitations, expected readouts, and export/share next steps without adding new physics.
  Complexity: M
