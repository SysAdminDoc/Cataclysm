import { APP_VERSION } from "./model-provenance";
import type { RunArchiveRecord } from "./run-archive";
import {
  RUN_RESULT_SCHEMA_VERSION,
  buildRunDataSha256,
  sha256Json,
  type RunIdentitySnapshot,
} from "./run-identity";
import { SCENARIO_SCHEMA_VERSION } from "./scenario-schema";
import { currentUserDataSchemaVersion } from "./user-data-migrations";

export const CURRENT_RENDER_PROTOCOL_VERSION = "1.0";
export const RUN_DELTA_EXPORT_SCHEMA_VERSION = 1;
const MAX_DIRECT_EFFECT_NODES = 10_000;
const MAX_DIRECT_EFFECT_DELTAS = 256;
const MAX_DIRECT_EFFECT_DEPTH = 20;

export type RunDifferenceCategory = "solver" | "schema" | "source" | "settings" | "data";

export type RunIdentityDifference = Readonly<{
  id: string;
  category: RunDifferenceCategory;
  label: string;
  historical: string;
  current: string;
  changed: boolean;
}>;

export type NormalizedRerunPreflight = Readonly<{
  historicalRunId: string;
  mode: "normalized-current-model";
  currentIdentity: RunIdentitySnapshot;
  differences: readonly RunIdentityDifference[];
  changedCategories: readonly RunDifferenceCategory[];
}>;

export type ScalarDelta = Readonly<{
  historical: number;
  current: number;
  delta: number;
}>;

export type FieldDeltaSummary = Readonly<{
  peakAbsMaxM: ScalarDelta;
  matchedFrames: number;
  meanAbsFramePeakDeltaM: number | null;
  maxAbsFramePeakDeltaM: number | null;
}>;

export type GaugeDeltaSummary = Readonly<{
  id: string;
  name: string;
  matchedSamples: number;
  historicalPeakAbsM: number;
  currentPeakAbsM: number;
  peakAbsDeltaM: number;
  meanDeltaM: number;
  rmseM: number;
}>;

export type DirectEffectDelta = Readonly<{
  path: string;
  historical: number;
  current: number;
  delta: number;
}>;

export type RunDeltaReport = Readonly<{
  historicalRunId: string;
  currentRunId: string;
  linkedNormalizedRerun: boolean;
  identityDifferences: readonly RunIdentityDifference[];
  attributedTo: readonly RunDifferenceCategory[];
  field: FieldDeltaSummary;
  gauges: readonly GaugeDeltaSummary[];
  directEffects: readonly DirectEffectDelta[];
}>;

function text(value: string | number | null): string {
  return value === null ? "not recorded" : String(value);
}

function difference(
  id: string,
  category: RunDifferenceCategory,
  label: string,
  historical: string | number | null,
  current: string | number | null,
): RunIdentityDifference {
  const before = text(historical);
  const after = text(current);
  return { id, category, label, historical: before, current: after, changed: before !== after };
}

function identityDifferences(
  historical: RunIdentitySnapshot,
  current: RunIdentitySnapshot,
): RunIdentityDifference[] {
  return [
    difference("app-version", "solver", "Application version", historical.appVersion, current.appVersion),
    difference("solver-version", "solver", "Solver version", historical.solverVersion, current.solverVersion),
    difference("scenario-schema", "schema", "Scenario schema", historical.scenarioSchemaVersion, current.scenarioSchemaVersion),
    difference("result-schema", "schema", "Result schema", historical.resultSchemaVersion, current.resultSchemaVersion),
    difference("archive-schema", "schema", "Archive schema", historical.archiveSchemaVersion, current.archiveSchemaVersion),
    difference("render-protocol", "schema", "Render protocol", historical.renderProtocolVersion, current.renderProtocolVersion),
    difference("source-digest", "source", "Source input SHA-256", historical.scenarioSha256, current.scenarioSha256),
    difference("settings-digest", "settings", "Solver settings SHA-256", historical.settingsSha256, current.settingsSha256),
    difference("data-digest", "data", "Scientific data SHA-256", historical.dataSha256, current.dataSha256),
  ];
}

function changedCategories(differences: readonly RunIdentityDifference[]): RunDifferenceCategory[] {
  return [...new Set(differences.filter((item) => item.changed).map((item) => item.category))];
}

export async function buildNormalizedRerunPreflight(
  historical: RunArchiveRecord,
): Promise<NormalizedRerunPreflight> {
  const currentIdentity: RunIdentitySnapshot = {
    appVersion: APP_VERSION,
    solverVersion: APP_VERSION,
    scenarioSchemaVersion: SCENARIO_SCHEMA_VERSION,
    resultSchemaVersion: RUN_RESULT_SCHEMA_VERSION,
    archiveSchemaVersion: currentUserDataSchemaVersion("runArchive"),
    scenarioSha256: await sha256Json(historical.inputs.scenario),
    settingsSha256: await sha256Json(historical.inputs.solverSettings),
    dataSha256: await buildRunDataSha256({
      solverSettings: historical.inputs.solverSettings,
      dataReferences: historical.inputs.dataReferences,
    }),
    resultSha256: null,
    renderProtocolVersion: CURRENT_RENDER_PROTOCOL_VERSION,
    renderScenarioSha256: null,
  };
  const differences = identityDifferences(historical.identity, currentIdentity);
  return {
    historicalRunId: historical.id,
    mode: "normalized-current-model",
    currentIdentity,
    differences,
    changedCategories: changedCategories(differences),
  };
}

function scalarDelta(historical: number, current: number): ScalarDelta {
  return { historical, current, delta: current - historical };
}

function normalizedFramePairs(
  historical: RunArchiveRecord,
  current: RunArchiveRecord,
): Array<readonly [RunArchiveRecord["results"]["snapshots"][number], RunArchiveRecord["results"]["snapshots"][number]]> {
  const before = historical.results.snapshots;
  const after = current.results.snapshots;
  if (before.length === 0 || after.length === 0) return [];
  return before.map((frame, index) => {
    const fraction = before.length === 1 ? 0 : index / (before.length - 1);
    const targetIndex = Math.round(fraction * (after.length - 1));
    return [frame, after[targetIndex]] as const;
  });
}

function fieldSummary(historical: RunArchiveRecord, current: RunArchiveRecord): FieldDeltaSummary {
  const pairs = normalizedFramePairs(historical, current);
  const absoluteDeltas = pairs.map(([before, after]) => Math.abs(after.eta_abs_max_m - before.eta_abs_max_m));
  return {
    peakAbsMaxM: scalarDelta(historical.summary.peakAbsMaxM, current.summary.peakAbsMaxM),
    matchedFrames: pairs.length,
    meanAbsFramePeakDeltaM: absoluteDeltas.length > 0
      ? absoluteDeltas.reduce((sum, value) => sum + value, 0) / absoluteDeltas.length
      : null,
    maxAbsFramePeakDeltaM: absoluteDeltas.length > 0 ? Math.max(...absoluteDeltas) : null,
  };
}

function gaugeSummaries(historical: RunArchiveRecord, current: RunArchiveRecord): GaugeDeltaSummary[] {
  const names = new Map([
    ...historical.results.gauges.map((gauge) => [gauge.id, gauge.name] as const),
    ...current.results.gauges.map((gauge) => [gauge.id, gauge.name] as const),
  ]);
  const samples = new Map<string, Array<readonly [number, number]>>();
  for (const [before, after] of normalizedFramePairs(historical, current)) {
    const afterById = new Map((after.gauge_samples ?? [])
      .filter((sample): sample is { id: string; eta_m: number } => sample.eta_m !== null)
      .map((sample) => [sample.id, sample.eta_m]));
    for (const sample of before.gauge_samples ?? []) {
      if (sample.eta_m === null) continue;
      const currentSample = afterById.get(sample.id);
      if (currentSample === undefined) continue;
      const values = samples.get(sample.id) ?? [];
      values.push([sample.eta_m, currentSample]);
      samples.set(sample.id, values);
    }
  }
  return [...samples.entries()]
    .map(([id, values]) => {
      const deltas = values.map(([before, after]) => after - before);
      const historicalPeakAbsM = Math.max(...values.map(([before]) => Math.abs(before)));
      const currentPeakAbsM = Math.max(...values.map(([, after]) => Math.abs(after)));
      return {
        id,
        name: names.get(id) ?? id,
        matchedSamples: values.length,
        historicalPeakAbsM,
        currentPeakAbsM,
        peakAbsDeltaM: currentPeakAbsM - historicalPeakAbsM,
        meanDeltaM: deltas.reduce((sum, value) => sum + value, 0) / deltas.length,
        rmseM: Math.sqrt(deltas.reduce((sum, value) => sum + value * value, 0) / deltas.length),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function numericLeaves(value: unknown): Map<string, number> {
  const result = new Map<string, number>();
  const pending: Array<{ value: unknown; path: string; depth: number }> = [{ value, path: "", depth: 0 }];
  let visited = 0;
  while (pending.length > 0 && visited < MAX_DIRECT_EFFECT_NODES && result.size < MAX_DIRECT_EFFECT_DELTAS) {
    const current = pending.pop()!;
    visited += 1;
    if (typeof current.value === "number" && Number.isFinite(current.value)) {
      result.set(current.path || "value", current.value);
      continue;
    }
    if (current.depth >= MAX_DIRECT_EFFECT_DEPTH) continue;
    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        pending.push({
          value: current.value[index],
          path: `${current.path}[${index}]`,
          depth: current.depth + 1,
        });
      }
    } else if (current.value && typeof current.value === "object") {
      const entries = Object.entries(current.value as Record<string, unknown>)
        .sort(([left], [right]) => right.localeCompare(left));
      for (const [key, child] of entries) {
        pending.push({
          value: child,
          path: current.path ? `${current.path}.${key}` : key,
          depth: current.depth + 1,
        });
      }
    }
  }
  return result;
}

function directEffectDeltas(historical: RunArchiveRecord, current: RunArchiveRecord): DirectEffectDelta[] {
  const before = numericLeaves(historical.results.directEffects);
  const after = numericLeaves(current.results.directEffects);
  return [...before.entries()]
    .flatMap(([path, historicalValue]) => {
      const currentValue = after.get(path);
      return currentValue === undefined
        ? []
        : [{ path, historical: historicalValue, current: currentValue, delta: currentValue - historicalValue }];
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function compareArchivedRuns(
  historical: RunArchiveRecord,
  current: RunArchiveRecord,
): RunDeltaReport {
  const differences = identityDifferences(historical.identity, current.identity);
  return {
    historicalRunId: historical.id,
    currentRunId: current.id,
    linkedNormalizedRerun: current.parentRunId === historical.id || historical.parentRunId === current.id,
    identityDifferences: differences,
    attributedTo: changedCategories(differences),
    field: fieldSummary(historical, current),
    gauges: gaugeSummaries(historical, current),
    directEffects: directEffectDeltas(historical, current),
  };
}

export function exportRunDeltaReport(
  historical: RunArchiveRecord,
  current: RunArchiveRecord,
  exportedAt = new Date().toISOString(),
): string {
  return JSON.stringify({
    schemaVersion: RUN_DELTA_EXPORT_SCHEMA_VERSION,
    exportedAt,
    report: compareArchivedRuns(historical, current),
    identities: {
      historical: historical.identity,
      current: current.identity,
    },
  }, null, 2);
}
