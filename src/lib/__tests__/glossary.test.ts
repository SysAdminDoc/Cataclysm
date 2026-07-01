import { describe, it, expect } from "vitest";
import { getGlossaryEntry, getAllEntries, GLOSSARY_KEYS } from "../glossary";

describe("glossary", () => {
  it("returns entry for known term", () => {
    const entry = getGlossaryEntry("mw");
    expect(entry).toBeDefined();
    expect(entry!.term).toContain("Moment Magnitude");
  });

  it("returns undefined for unknown term", () => {
    expect(getGlossaryEntry("nonexistent_term_xyz")).toBeUndefined();
  });

  it("normalises keys with spaces and hyphens", () => {
    expect(getGlossaryEntry("cavity_radius")).toBeDefined();
    expect(getGlossaryEntry("cavity-radius")).toBeDefined();
    expect(getGlossaryEntry("cavity radius")).toBeDefined();
  });

  it("has at least 15 defined terms", () => {
    expect(getAllEntries().length).toBeGreaterThanOrEqual(15);
    expect(GLOSSARY_KEYS.length).toBeGreaterThanOrEqual(15);
  });

  it("every entry has term and definition", () => {
    for (const entry of getAllEntries()) {
      expect(entry.term).toBeTruthy();
      expect(entry.definition).toBeTruthy();
    }
  });
});
