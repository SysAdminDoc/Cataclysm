import { describe, it, expect } from "vitest";
import { suggestedFilename, type ScreenshotMeta } from "../export";

describe("suggestedFilename", () => {
  it("generates a filename with preset id", () => {
    const meta: ScreenshotMeta = {
      preset: { id: "chicxulub", name: "Chicxulub" } as never,
      timeS: 900,
    };
    const name = suggestedFilename(meta, "png");
    expect(name).toMatch(/^tsunamisim-chicxulub-t15min-.*\.png$/);
  });

  it("uses 'custom-scenario' when no preset", () => {
    const meta: ScreenshotMeta = { timeS: 1800 };
    const name = suggestedFilename(meta);
    expect(name).toContain("custom-scenario");
    expect(name).toContain("t30min");
    expect(name).toMatch(/\.png$/);
  });

  it("sanitizes unsafe characters in preset id", () => {
    const meta: ScreenshotMeta = {
      preset: { id: 'test<>:"/\\|?*name', name: "Test" } as never,
      timeS: 0,
    };
    const name = suggestedFilename(meta);
    expect(name).not.toMatch(/[<>:"/\\|?*]/);
  });

  it("handles Windows reserved device names", () => {
    const meta: ScreenshotMeta = {
      preset: { id: "CON", name: "CON" } as never,
      timeS: 0,
    };
    const name = suggestedFilename(meta);
    expect(name).toContain("_CON");
  });

  it("supports different extensions", () => {
    const meta: ScreenshotMeta = { timeS: 0 };
    expect(suggestedFilename(meta, "webm")).toMatch(/\.webm$/);
    expect(suggestedFilename(meta, "mp4")).toMatch(/\.mp4$/);
  });
});
