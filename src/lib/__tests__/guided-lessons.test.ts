import { describe, expect, it } from "vitest";
import { getGuidedLessons, GUIDED_LESSONS } from "../guided-lessons";

describe("guided lesson catalogs", () => {
  it("keeps English canonical and ships complete translated lesson structures", () => {
    expect(getGuidedLessons("en")).toBe(GUIDED_LESSONS);
    for (const locale of ["es", "ja", "id"] as const) {
      const localized = getGuidedLessons(locale);
      expect(localized).toHaveLength(GUIDED_LESSONS.length);
      localized.forEach((lesson, index) => {
        const canonical = GUIDED_LESSONS[index];
        expect(lesson.id).toBe(canonical.id);
        expect(lesson.presetId).toBe(canonical.presetId);
        expect(lesson.title).not.toBe(canonical.title);
        expect(lesson.summary.trim()).not.toBe("");
        expect(lesson.steps).toHaveLength(canonical.steps.length);
        expect(lesson.story).toBe(canonical.story);
        expect(lesson.story.cues).toHaveLength(canonical.steps.length);
        expect(lesson.worksheet).toHaveLength(canonical.worksheet.length);
        expect(lesson.steps.every((step) => step.title.trim() && step.body.trim())).toBe(true);
        expect(lesson.worksheet.every((question) => question.trim())).toBe(true);
      });
    }
  });

  it("gives every lesson executable, bounded story cues", () => {
    for (const lesson of GUIDED_LESSONS) {
      expect(lesson.story.cues).toHaveLength(lesson.steps.length);
      expect(lesson.story.cues[0]).toMatchObject({ target: "setup", panel: "setup" });
      expect(lesson.story.cues.some((cue) => cue.camera)).toBe(true);
      expect(lesson.story.cues.some((cue) => cue.timeS !== undefined)).toBe(true);
      expect(lesson.story.cues.some((cue) => cue.playback === "play")).toBe(true);
      expect(lesson.story.cues.every((cue) => !cue.camera || (
        Number.isFinite(cue.camera.lat)
        && cue.camera.lat >= -90
        && cue.camera.lat <= 90
        && Number.isFinite(cue.camera.lon)
        && cue.camera.lon >= -180
        && cue.camera.lon <= 180
        && cue.camera.rangeM >= 20_000
      ))).toBe(true);
    }
  });

  it("retains the reviewed scientific constants and citations in every language", () => {
    for (const locale of ["en", "es", "ja", "id"] as const) {
      const allText = JSON.stringify(getGuidedLessons(locale));
      expect(allText).toContain("r^(−5/6)");
      expect(allText).toContain("Okada");
      expect(allText).toContain("DART");
      expect(allText).toContain("524");
      expect(allText).toContain("310 m/s");
      expect(allText).toContain("17");
      expect(allText).toContain("88 m");
    }
  });
});
