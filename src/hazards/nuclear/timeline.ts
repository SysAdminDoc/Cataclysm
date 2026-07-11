// Detonation timeline — ported from NukeMap NM.calcTimeline (js/physics.js).
// Pure: derives the sequence of physical events (prompt radiation → thermal
// flash → fireball → blast arrival → firestorm → fallout) from the effects.

import { type NuclearEffects, fmtR } from "./physics";

export type TimelineCategory = "radiation" | "thermal" | "blast" | "firestorm" | "cloud" | "fallout";

export interface TimelineEvent {
  time: string; // human-readable ("0 ms", "12.4 sec", "~5 min")
  description: string;
  category: TimelineCategory;
}

function fmtTime(s: number): string {
  if (s < 1) return `${(s * 1000).toFixed(0)} ms`;
  if (s < 60) return `${s.toFixed(1)} sec`;
  return `${(s / 60).toFixed(1)} min`;
}

// Mean blast-front speed (km/s) used by NukeMap for arrival timing — ~sound
// speed, accounting for the initial supersonic shock and Mach stem.
const BLAST_SPEED_KM_S = 0.34;

export function calcTimeline(effects: NuclearEffects): TimelineEvent[] {
  const Y = effects.yieldKt;
  const events: TimelineEvent[] = [
    { time: "0 ms", description: "Detonation. X-ray pulse heats the air to millions of degrees.", category: "radiation" },
    {
      time: "0.01 ms",
      description: `Prompt neutron/gamma pulse. Lethal radiation to ${fmtR(effects.neutronRad)} (neutrons), ${fmtR(effects.gammaRad)} (gamma).`,
      category: "radiation",
    },
    {
      time: "0.1 ms",
      description: `Thermal flash. Temporary flash blindness to ${fmtR(effects.flashBlindDay)} (day) / ${fmtR(effects.flashBlindNight)} (night).`,
      category: "thermal",
    },
    {
      time: `${(0.0013 * Math.pow(Y, 0.4) * 1000).toFixed(0)} ms`,
      description: `Fireball reaches maximum size (${fmtR(effects.fireball)} radius). Surface ~10,000,000 °C.`,
      category: "thermal",
    },
    {
      time: fmtTime(effects.psi5 / BLAST_SPEED_KM_S),
      description: `Blast wave at 5 psi (${fmtR(effects.psi5)}). Most buildings destroyed; ~160 mph winds.`,
      category: "blast",
    },
    {
      time: fmtTime(effects.psi1 / BLAST_SPEED_KM_S),
      description: `Blast wave at 1 psi (${fmtR(effects.psi1)}). Windows shatter into shrapnel.`,
      category: "blast",
    },
  ];

  if (effects.firestormR > 0.1) {
    events.push({
      time: "~5 min",
      description: `Firestorm ignites within ${fmtR(effects.firestormR)}. Hurricane-force inward winds feed the fire.`,
      category: "firestorm",
    });
  }

  if (effects.isSurface && effects.fallout) {
    events.push(
      { time: "~10 min", description: `Mushroom cloud stabilizes at ~${effects.cloudTopH.toFixed(1)} km. Fallout begins.`, category: "cloud" },
      { time: "~30 min", description: `Heaviest fallout within ${fmtR(effects.fallout.heavy.length)} downwind.`, category: "fallout" },
      { time: "~24 hrs", description: `Light fallout extends ${fmtR(effects.fallout.light.length)} downwind. 7:10 decay rule applies.`, category: "fallout" },
    );
  } else {
    events.push({ time: "~10 min", description: `Mushroom cloud reaches ~${effects.cloudTopH.toFixed(1)} km altitude.`, category: "cloud" });
  }

  return events;
}
