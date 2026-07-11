import type { InitialDisplacement, Preset } from "../types/scenario";
import { EARTH_ASSET_REGISTRY_VERSION, getActiveEarthSession } from "./earth-assets";
import {
  IDEALIZED_SEA_SURFACE_HEIGHT_FIELD,
  type HeightFieldMetadata,
} from "./geodesy";

export const APP_VERSION = "0.8.0";

export const DEFAULT_BATHYMETRY_SOURCE =
  "Low-confidence coarse basin/shelf approximation; GEBCO_2026/TID raster sampling is not bundled; optional Cesium bathymetric terrain is visual context only.";

export const DEFAULT_SOLVER_MODE =
  "Analytical source geometry with far-field/runup sampling; live SWE snapshots when provided.";

export const EDUCATIONAL_LIMITATION =
  "Educational model only; not an evacuation or warning product. Use official NOAA NTWC/PTWC alerts for real hazards.";

export type ModelProvenanceInput = {
  bathymetryAssetId?: string;
  bathymetrySource?: string;
  generatedAt?: string;
  initial?: InitialDisplacement | null;
  preset?: Preset | null;
  scenarioKind?: Preset["source"]["kind"] | "Custom";
  solverMode?: string;
  timeS?: number;
  solverAssetIds?: string[];
  visualAssetIds?: string[];
};

export type ModelProvenance = {
  appVersion: string;
  assetRegistryVersion: string;
  bathymetryAssetId: string;
  bathymetrySource: string;
  citationReference: string;
  citationUrl: string | null;
  generatedAt: string;
  heightField: HeightFieldMetadata;
  limitation: string;
  scenarioName: string;
  scenarioType: string;
  solverMode: string;
  timeS: number;
  solverAssetIds: string[];
  visualAssetIds: string[];
};

export function buildModelProvenance(input: ModelProvenanceInput): ModelProvenance {
  const earthSession = getActiveEarthSession();
  return {
    appVersion: APP_VERSION,
    assetRegistryVersion: EARTH_ASSET_REGISTRY_VERSION,
    bathymetryAssetId: input.bathymetryAssetId ?? "cataclysm-coarse-bathymetry-v1",
    bathymetrySource: input.bathymetrySource ?? DEFAULT_BATHYMETRY_SOURCE,
    citationReference: input.preset?.reference ?? "Custom scenario - no preset citation.",
    citationUrl: input.preset?.reference_url ?? null,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    heightField: { ...IDEALIZED_SEA_SURFACE_HEIGHT_FIELD },
    limitation: EDUCATIONAL_LIMITATION,
    scenarioName: input.preset?.name ?? input.initial?.label ?? "Custom scenario",
    scenarioType: input.scenarioKind ?? input.preset?.source?.kind ?? "Custom",
    solverMode: input.solverMode ?? DEFAULT_SOLVER_MODE,
    timeS: Number.isFinite(input.timeS) ? input.timeS ?? 0 : 0,
    solverAssetIds: input.solverAssetIds ?? ["cataclysm-coarse-bathymetry-v1"],
    visualAssetIds: input.visualAssetIds ?? [earthSession.imageryAssetId, earthSession.terrainAssetId],
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
    `Bathymetry asset: ${p.bathymetryAssetId}`,
    `Earth asset registry: ${p.assetRegistryVersion}`,
    `Height field: ${p.heightField.horizontal_crs}; ${p.heightField.vertical_datum}; ${p.heightField.vertical_axis}; ${p.heightField.unit}`,
    `Solver assets: ${p.solverAssetIds.join(", ")}`,
    `Visual assets: ${p.visualAssetIds.join(", ")}`,
    `Citation: ${citation}`,
    `Model limitation: ${p.limitation}`,
  ].join("\n");
}
