# Roadmap

Nuclear weapon effects simulator with 12 effect rings, 38 weapon presets, full WW3 engine (427 targets, 708 warheads, 7 scenarios), HEMP, water burst, SVG mushroom cloud, PWA. Physics from Glasstone & Dolan.

## Audit Findings (v3.7.0)

- [ ] P2 — Yield preview ring churn during slider drag
  Why: Creates/destroys ~60 Leaflet layers per second during drag. Could cause jank on low-end devices.
  Where: js/app.js (yield-slider input handler)

- [ ] P2 — DeliveryArc uses linear interpolation instead of great-circle
  Why: Premium module single-weapon delivery arc is linear (lat/lng lerp), not great-circle. Wrong path for long distances.
  Where: js/premium.js (NM.DeliveryArc, line 311)

- [ ] P2 — RadDecay.calculate cumDose computed from fixed start time
  Why: cumDose field always integrates from hour 1 regardless of actual fallout arrival time. UI table is correct (uses integratedDose), but API return value misleads consumers.
  Where: js/extras.js (RadDecay.calculate, line 179)

- [ ] P3 — Missile flight calculator boost time constant for all types
  Why: 180-second boost phase is reasonable for ICBMs but overstated for SRBMs (typically 30-60s). Inflates SRBM flight times.
  Where: js/advanced.js (MissileFlight.calculate)

- [ ] P3 — Sound module lacks DynamicsCompressorNode
  Why: Multiple simultaneous large detonations with no limiter could cause audio clipping.
  Where: js/sound.js

- [ ] P3 — SVG mushroom cloud turbulence filters may cause frame drops
  Why: 3 feTurbulence filters with up to 5 octaves per cloud. Multiple overlapping clouds could drop frames.
  Where: js/mushroom3d.js

- [ ] P3 — Experience mode polyline leak on deactivation
  Why: Polylines drawn on click are removed after 10-second timeout. If mode is toggled off, pending removals still run but lines are visible until timer fires.
  Where: js/advanced.js (Experience mode)

