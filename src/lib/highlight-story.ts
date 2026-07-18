import type { ScreenshotMeta, ExportResult } from "./export";
import { downloadBlob, safeFilenamePart } from "./export";
import { buildModelProvenance, type ModelProvenance } from "./model-provenance";

export const HIGHLIGHT_STORY_DURATIONS = [15, 30, 60] as const;

export type HighlightStoryDuration = (typeof HIGHLIGHT_STORY_DURATIONS)[number];
export type HighlightStoryVariant = "clean_cinematic" | "analytical";
export type HighlightMomentKind = "title" | "source" | "development" | "peak" | "outcome" | "provenance";

export type HighlightStoryOptions = Readonly<{
  durationS: HighlightStoryDuration;
  variant: HighlightStoryVariant;
  captions: boolean;
}>;

export type HighlightStoryMoment = Readonly<{
  id: string;
  kind: HighlightMomentKind;
  title: string;
  caption: string;
  storyTimeS: number;
  sourceTimeS: number;
}>;

export type HighlightStoryManifest = Readonly<{
  schema: "cataclysm.highlight-story/1";
  generatedAt: string;
  scenario: Readonly<{ id: string; title: string; type: string }>;
  cut: HighlightStoryOptions & Readonly<{
    frameSource: "cached_authoritative_replay";
    overlayPolicy: HighlightStoryVariant;
  }>;
  moments: readonly HighlightStoryMoment[];
  scaleAnchors: readonly string[];
  uncertaintyLabel: string;
  educationalLabel: string;
  rendererAttribution: string;
  sourceAttribution: string;
  scenarioUrl: string;
  replay: Readonly<{
    fingerprint: string;
    fingerprintAlgorithm: "FNV-1a 32-bit identity label; not an integrity checksum";
    frameCount: number;
    sourceDurationS: number;
    sourceTimesS: readonly number[];
    frameFingerprints: readonly string[];
    frames: readonly unknown[];
  }>;
  provenance: ModelProvenance;
}>;

export type HighlightMomentLabels = Readonly<Record<HighlightMomentKind, Readonly<{ title: string; caption: string }>>>;

export type HighlightStoryBuildInput = Readonly<{
  meta: ScreenshotMeta;
  scenarioId: string;
  scenarioTitle: string;
  options: HighlightStoryOptions;
  availableTimesS: readonly number[];
  frameFingerprints: readonly string[];
  framePayloads: readonly unknown[];
  scaleAnchors: readonly string[];
  scenarioUrl: string;
  uncertaintyLabel?: string;
  educationalLabel?: string;
  labels?: HighlightMomentLabels;
}>;

const DEFAULT_LABELS: HighlightMomentLabels = {
  title: { title: "Scenario", caption: "Scenario identity, time, and educational-use boundary." },
  source: { title: "Source", caption: "The modeled source and its scale anchors." },
  development: { title: "Development", caption: "A cached intermediate frame from the deterministic replay." },
  peak: { title: "Key moment", caption: "The most informative named moment in this cut." },
  outcome: { title: "Outcome", caption: "The final cached state selected for this cut." },
  provenance: { title: "Evidence", caption: "Renderer, source, uncertainty, and attribution." },
};

const CUT_KINDS: Readonly<Record<HighlightStoryDuration, readonly HighlightMomentKind[]>> = {
  15: ["title", "source", "peak", "provenance"],
  30: ["title", "source", "development", "outcome", "provenance"],
  60: ["title", "source", "development", "peak", "outcome", "provenance"],
};

function normalizeTimes(values: readonly number[]): number[] {
  return [...new Set(values.filter((value) => Number.isFinite(value) && value >= 0).map((value) => Math.round(value * 1_000) / 1_000))]
    .sort((left, right) => left - right)
    .slice(0, 2_000);
}

function nearestTime(times: readonly number[], fraction: number): number {
  const duration = times.at(-1) ?? 0;
  const target = duration * Math.min(1, Math.max(0, fraction));
  return times.reduce((best, candidate) => (
    Math.abs(candidate - target) < Math.abs(best - target) ? candidate : best
  ), times[0] ?? 0);
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function buildHighlightStory(input: HighlightStoryBuildInput): HighlightStoryManifest {
  const times = normalizeTimes(input.availableTimesS);
  if (times.length < 2) throw new Error("A highlight story requires at least two cached replay frames.");
  if (input.framePayloads.length !== times.length || input.frameFingerprints.length !== times.length) {
    throw new Error("Highlight story frame payloads, fingerprints, and times must have equal lengths.");
  }
  if (!HIGHLIGHT_STORY_DURATIONS.includes(input.options.durationS)) throw new Error("Unsupported highlight duration.");
  if (!input.scenarioId.trim() || !input.scenarioTitle.trim()) throw new Error("Highlight story scenario identity is required.");
  const provenance = buildModelProvenance(input.meta);
  const labels = input.labels ?? DEFAULT_LABELS;
  const kinds = CUT_KINDS[input.options.durationS];
  const fractions: Readonly<Record<HighlightMomentKind, number>> = {
    title: 0,
    source: 0.08,
    development: 0.35,
    peak: 0.66,
    outcome: 1,
    provenance: 1,
  };
  const moments = kinds.map((kind, index): HighlightStoryMoment => ({
    id: `${index + 1}-${kind}`,
    kind,
    title: labels[kind].title,
    caption: labels[kind].caption,
    storyTimeS: Math.round((input.options.durationS * index / Math.max(1, kinds.length - 1)) * 10) / 10,
    sourceTimeS: nearestTime(times, fractions[kind]),
  }));
  const frameFingerprints = input.frameFingerprints.slice(0, 2_000);
  const fingerprint = fnv1a(JSON.stringify({
    scenarioId: input.scenarioId,
    times,
    frameFingerprints,
    provenance: {
      renderFrame: provenance.renderFrame,
      runQuality: provenance.runQuality,
      solverMode: provenance.solverMode,
    },
  }));
  return {
    schema: "cataclysm.highlight-story/1",
    generatedAt: provenance.generatedAt,
    scenario: { id: input.scenarioId, title: input.scenarioTitle, type: provenance.scenarioType },
    cut: {
      ...input.options,
      frameSource: "cached_authoritative_replay",
      overlayPolicy: input.options.variant,
    },
    moments,
    scaleAnchors: input.scaleAnchors.filter(Boolean).slice(0, 4),
    uncertaintyLabel: input.uncertaintyLabel ?? (provenance.runQuality
      ? `Numerical quality: ${provenance.runQuality.status}; ${provenance.runQuality.warnings.length} warning(s).`
      : provenance.limitation),
    educationalLabel: input.educationalLabel ?? provenance.limitation,
    rendererAttribution: `CesiumJS · Cataclysm ${provenance.appVersion}`,
    sourceAttribution: provenance.citationUrl
      ? `${provenance.citationReference} (${provenance.citationUrl})`
      : provenance.citationReference,
    scenarioUrl: input.scenarioUrl,
    replay: {
      fingerprint,
      fingerprintAlgorithm: "FNV-1a 32-bit identity label; not an integrity checksum",
      frameCount: times.length,
      sourceDurationS: times.at(-1) ?? 0,
      sourceTimesS: times,
      frameFingerprints,
      frames: input.framePayloads.slice(0, 2_000),
    },
    provenance,
  };
}

export function buildHighlightStoryUrl(baseUrl: string, options: HighlightStoryOptions): string {
  const url = new URL(baseUrl);
  url.searchParams.set("highlight", String(options.durationS));
  url.searchParams.set("highlightView", options.variant);
  url.searchParams.set("highlightCaptions", options.captions ? "1" : "0");
  return url.toString();
}

export function parseHighlightStoryOptions(search: string): HighlightStoryOptions | null {
  const params = new URLSearchParams(search);
  const rawDuration = Number(params.get("highlight"));
  if (!HIGHLIGHT_STORY_DURATIONS.includes(rawDuration as HighlightStoryDuration)) return null;
  const variant = params.get("highlightView");
  if (variant !== "clean_cinematic" && variant !== "analytical") return null;
  const captions = params.get("highlightCaptions");
  if (captions !== "0" && captions !== "1") return null;
  return { durationS: rawDuration as HighlightStoryDuration, variant, captions: captions === "1" };
}

export function saveHighlightStory(manifest: HighlightStoryManifest): ExportResult<{ bytes: number; filename: string }> {
  try {
    const text = `${JSON.stringify(manifest, null, 2)}\n`;
    const filename = `cataclysm-${safeFilenamePart(manifest.scenario.id).slice(0, 64)}-${manifest.cut.durationS}s.catstory.json`;
    const result = downloadBlob(new Blob([text], { type: "application/vnd.cataclysm.highlight-story+json" }), filename);
    return result.ok ? { ok: true, bytes: new TextEncoder().encode(text).byteLength, filename } : result;
  } catch (error) {
    return { ok: false, code: "download", message: `Highlight story save failed: ${error instanceof Error ? error.message : String(error)}`, retryable: true };
  }
}
