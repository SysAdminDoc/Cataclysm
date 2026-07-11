import type { InitialDisplacement, Preset } from "../types/scenario";

export const APP_VERSION = "0.7.0";

export const DEFAULT_BATHYMETRY_SOURCE =
  "Low-confidence coarse basin/shelf approximation; GEBCO_2026/TID raster sampling is not bundled; optional Cesium bathymetric terrain is visual context only.";

export const DEFAULT_SOLVER_MODE =
  "Analytical source geometry with far-field/runup sampling; live SWE snapshots when provided.";

export const EDUCATIONAL_LIMITATION =
  "Educational model only; not an evacuation or warning product. Use official NOAA NTWC/PTWC alerts for real hazards.";

export type ModelProvenanceInput = {
  bathymetrySource?: string;
  generatedAt?: string;
  initial?: InitialDisplacement | null;
  preset?: Preset | null;
  scenarioKind?: Preset["source"]["kind"] | "Custom";
  solverMode?: string;
  timeS?: number;
};

export type ModelProvenance = {
  appVersion: string;
  bathymetrySource: string;
  citationReference: string;
  citationUrl: string | null;
  generatedAt: string;
  limitation: string;
  scenarioName: string;
  scenarioType: string;
  solverMode: string;
  timeS: number;
};

export function buildModelProvenance(input: ModelProvenanceInput): ModelProvenance {
  return {
    appVersion: APP_VERSION,
    bathymetrySource: input.bathymetrySource ?? DEFAULT_BATHYMETRY_SOURCE,
    citationReference: input.preset?.reference ?? "Custom scenario - no preset citation.",
    citationUrl: input.preset?.reference_url ?? null,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    limitation: EDUCATIONAL_LIMITATION,
    scenarioName: input.preset?.name ?? input.initial?.label ?? "Custom scenario",
    scenarioType: input.scenarioKind ?? input.preset?.source?.kind ?? "Custom",
    solverMode: input.solverMode ?? DEFAULT_SOLVER_MODE,
    timeS: Number.isFinite(input.timeS) ? input.timeS ?? 0 : 0,
  };
}

export function provenanceSummary(input: ModelProvenanceInput): string {
  const p = buildModelProvenance(input);
  const citation = p.citationUrl ? `${p.citationReference} (${p.citationUrl})` : p.citationReference;
  return [
    `Cataclysm v${p.appVersion}`,
    `Generated: ${p.generatedAt}`,
    `Scenario: ${p.scenarioName}`,
    `Scenario type: ${p.scenarioType}`,
    `Solver mode: ${p.solverMode}`,
    `Bathymetry source: ${p.bathymetrySource}`,
    `Citation: ${citation}`,
    `Model limitation: ${p.limitation}`,
  ].join("\n");
}
