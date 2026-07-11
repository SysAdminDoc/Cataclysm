// Asteroid impact hazard engine — wraps AsteroidSimulator's physics
// (ported in from that repo) into the unified HazardResult contract.

import type { EffectRing, GeoPoint, HazardEngine, HazardResult, ReadoutItem } from "../types";
import { simulate } from "./physics";
import type { ImpactEffects, TargetType } from "./physics/types";

export interface AsteroidInput {
  diameterM: number;
  densityKgM3: number;
  velocityKmS: number; // km/s at the UI boundary; converted to m/s here
  angleDeg: number;
  targetType: TargetType;
  waterDepthM?: number;
  beachSlopeRad?: number;
}

const fmtM = (m: number): string => {
  if (!Number.isFinite(m)) return "--";
  if (m < 1000) return `${m.toFixed(0)} m`;
  if (m < 100000) return `${(m / 1000).toFixed(2)} km`;
  return `${(m / 1000).toFixed(0)} km`;
};

const fmtEnergy = (mt: number): string =>
  mt >= 1e6 ? `${(mt / 1e6).toFixed(1)} Gt` : mt >= 1 ? `${mt.toFixed(1)} Mt` : `${(mt * 1000).toFixed(0)} kt`;

function rings(e: ImpactEffects): EffectRing[] {
  const defs: Array<[string, number, string, string, string]> = [
    ["1st° burns", e.thermal.thermalRadiusFirstDegree, "#f5c2e7", "thermal", "First-degree burns to exposed skin."],
    ["Window breakage (1 psi)", e.airblast.radiusWindowBreakage, "#f9e2af", "blast", "Glass shatters; light injuries."],
    ["3rd° burns", e.thermal.thermalRadiusThirdDegree, "#fab387", "thermal", "Third-degree burns; widespread ignition."],
    ["Severe damage (7 psi)", e.airblast.radiusSevereDamage, "#cba6f7", "blast", "Most buildings collapse."],
    ["Total destruction (20 psi)", e.airblast.radiusTotalDestruction, "#89b4fa", "blast", "Reinforced structures destroyed."],
    ["Fireball", e.thermal.fireballRadius, "#f5e0dc", "fireball", "Thermal fireball radius."],
    ["Final crater", e.crater ? e.crater.finalDiameter / 2 : 0, "#eba0ac", "crater", "Excavated crater (radius)."],
  ];
  return defs
    .filter(([, m]) => m > 0.5)
    .map(([label, radiusM, color, category, description]) => ({ label, radiusM, color, category, description }))
    .sort((a, b) => b.radiusM - a.radiusM);
}

function readout(e: ImpactEffects): ReadoutItem[] {
  const items: ReadoutItem[] = [
    { label: "Impact energy", value: fmtEnergy(e.energy.megatons) },
    { label: "Reaches ground", value: e.atmosphericEntry.reachesGround ? "Yes" : "No (airburst)", hint: e.atmosphericEntry.reachesGround ? undefined : `burst @ ${fmtM(e.atmosphericEntry.airburstAltitude)}` },
    { label: "Seismic magnitude", value: `M ${e.seismic.magnitude.toFixed(1)}` },
    { label: "Fireball radius", value: fmtM(e.thermal.fireballRadius) },
    { label: "20 psi radius", value: fmtM(e.airblast.radiusTotalDestruction) },
  ];
  if (e.crater) {
    items.push({ label: "Crater diameter", value: fmtM(e.crater.finalDiameter), hint: e.crater.isComplex ? "complex crater" : "simple crater" });
  }
  if (e.tsunami.applies) {
    items.push({ label: "Tsunami runup", value: fmtM(e.tsunami.runupHeight) });
  }
  return items;
}

export const asteroidEngine: HazardEngine<AsteroidInput> = {
  kind: "asteroid",
  label: "Asteroid impact",
  run(input: AsteroidInput, center: GeoPoint): HazardResult {
    const effects = simulate({
      diameter: input.diameterM,
      density: input.densityKgM3,
      velocity: input.velocityKmS * 1000,
      angle: input.angleDeg,
      targetType: input.targetType,
      waterDepth: input.waterDepthM ?? 0,
      beachSlope: input.beachSlopeRad ?? 0.02,
      distance: 1000,
    });
    return {
      kind: "asteroid",
      center,
      rings: rings(effects),
      readout: readout(effects),
      detail: effects,
    };
  },
};
