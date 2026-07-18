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
        expect(lesson.worksheet).toHaveLength(canonical.worksheet.length);
        expect(lesson.steps.every((step) => step.title.trim() && step.body.trim())).toBe(true);
        expect(lesson.worksheet.every((question) => question.trim())).toBe(true);
      });
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
