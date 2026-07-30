import { EARTH_ASSET_REGISTRY_VERSION } from "./earth-assets";
import type { PortableScenarioSolverSettings } from "./portable-scenario-package";

export const RUN_RESULT_SCHEMA_VERSION = 1;

export type RunDataReference = Readonly<{
  id: string;
  kind: string;
  relative_path: string;
  embedded: boolean;
  sha256?: string;
}>;

export type RunIdentitySnapshot = Readonly<{
  appVersion: string;
  solverVersion: string;
  scenarioSchemaVersion: number;
  resultSchemaVersion: number;
  archiveSchemaVersion: number;
  scenarioSha256: string;
  settingsSha256: string;
  dataSha256: string;
  resultSha256: string | null;
  renderProtocolVersion: string | null;
  renderScenarioSha256: string | null;
}>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export async function sha256Json(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildRunDataSha256(input: {
  solverSettings: PortableScenarioSolverSettings;
  dataReferences?: readonly RunDataReference[];
  assetRegistryVersion?: string;
}): Promise<string> {
  const references = [...(input.dataReferences ?? [])]
    .map((reference) => ({
      id: reference.id,
      kind: reference.kind,
      relative_path: reference.relative_path,
      embedded: reference.embedded,
      sha256: reference.sha256 ?? null,
    }))
    .sort((left, right) => (
      left.id.localeCompare(right.id)
      || left.relative_path.localeCompare(right.relative_path)
    ));
  return sha256Json({
    schemaVersion: 1,
    assetRegistryVersion: input.assetRegistryVersion ?? EARTH_ASSET_REGISTRY_VERSION,
    bathymetryAssetId: input.solverSettings.bathymetry_asset_id,
    useSpatialBathymetry: input.solverSettings.use_spatial_bathymetry,
    dataReferences: references,
  });
}
