import { afterEach, describe, expect, it, vi } from "vitest";

import type { ScreenshotMeta } from "../export";
import {
  buildHighlightStory,
  buildHighlightStoryUrl,
  parseHighlightStoryOptions,
  saveHighlightStory,
  type HighlightStoryOptions,
} from "../highlight-story";

const meta: ScreenshotMeta = {
  timeS: 3_600,
  generatedAt: "2026-07-18T12:00:00.000Z",
  scenarioName: "Test tsunami",
  scenarioKind: "Earthquake",
  solverMode: "Cached SWE replay",
  citationReference: "Reference study",
  citationUrl: "https://example.com/study",
  limitation: "Educational model only.",
  evidenceIds: ["source", "swe-field"],
};

const base = {
  meta,
  scenarioId: "test-tsunami",
  scenarioTitle: "Test tsunami",
  availableTimesS: [0, 60, 600, 1_800, 3_600],
  frameFingerprints: ["frame-0", "frame-1", "frame-2", "frame-3", "frame-4"],
  framePayloads: [{ t: 0 }, { t: 60 }, { t: 600 }, { t: 1_800 }, { t: 3_600 }],
  scaleAnchors: ["Source 1°, 2°", "Peak 3 m"],
  scenarioUrl: "https://cataclysm.example/?preset=test-tsunami",
};

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("deterministic highlight stories", () => {
  it("assembles named 15, 30, and 60 second cuts from the same cached replay", () => {
    const fingerprints = new Set<string>();
    for (const durationS of [15, 30, 60] as const) {
      const story = buildHighlightStory({
        ...base,
        options: { durationS, variant: "analytical", captions: true },
      });
      expect(story.cut.frameSource).toBe("cached_authoritative_replay");
      expect(story.cut.durationS).toBe(durationS);
      expect(story.moments[0]).toEqual(expect.objectContaining({ kind: "title", sourceTimeS: 0 }));
      expect(story.moments.at(-1)).toEqual(expect.objectContaining({ kind: "provenance", sourceTimeS: 3_600 }));
      expect(story.scaleAnchors).toEqual(["Source 1°, 2°", "Peak 3 m"]);
      expect(story.rendererAttribution).toContain("CesiumJS");
      fingerprints.add(story.replay.fingerprint);
    }
    expect(fingerprints.size).toBe(1);
  });

  it("keeps clean and analytical presentation contracts distinct without changing replay identity", () => {
    const clean = buildHighlightStory({
      ...base,
      options: { durationS: 30, variant: "clean_cinematic", captions: false },
    });
    const analytical = buildHighlightStory({
      ...base,
      options: { durationS: 30, variant: "analytical", captions: true },
    });
    expect(clean.cut.overlayPolicy).toBe("clean_cinematic");
    expect(analytical.cut.overlayPolicy).toBe("analytical");
    expect(clean.replay.fingerprint).toBe(analytical.replay.fingerprint);
  });

  it("round-trips bounded story options in a reproducible scenario link", () => {
    const options: HighlightStoryOptions = { durationS: 60, variant: "analytical", captions: false };
    const url = buildHighlightStoryUrl("https://cataclysm.example/?preset=tohoku", options);
    expect(url).toContain("preset=tohoku");
    expect(parseHighlightStoryOptions(new URL(url).search)).toEqual(options);
    expect(parseHighlightStoryOptions("?highlight=999&highlightView=analytical&highlightCaptions=1")).toBeNull();
  });

  it("saves the frozen manifest as a portable local story file", () => {
    const createObjectUrl = vi.fn(() => "blob:story");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: createObjectUrl, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const story = buildHighlightStory({
      ...base,
      options: { durationS: 30, variant: "analytical", captions: true },
    });

    const result = saveHighlightStory(story);
    expect(result).toEqual(expect.objectContaining({ ok: true, filename: "cataclysm-test-tsunami-30s.catstory.json" }));
    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledOnce();
  });

  it("refuses to invent a story when fewer than two replay frames exist", () => {
    expect(() => buildHighlightStory({
      ...base,
      availableTimesS: [0],
      options: { durationS: 15, variant: "analytical", captions: true },
    })).toThrow(/at least two cached replay frames/i);
  });
});
