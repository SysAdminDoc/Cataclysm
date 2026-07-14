import { describe, expect, it } from "vitest";
import { commitReferenceFrame } from "../reference-frame-commit";

describe("commitReferenceFrame", () => {
  it("uses the full viewer render before publishing frame identity", () => {
    const operations: string[] = [];
    const root = document.createElement("html");
    const cleanup = commitReferenceFrame(
      {
        scene: { requestRender: () => operations.push("request") },
        render: () => {
          operations.push("viewer-render");
          expect(root.dataset.referenceDirectFrameCommitted).toBeUndefined();
        },
      },
      root,
      "scenario:58:60",
    );

    expect(operations).toEqual(["request", "viewer-render"]);
    expect(root.dataset.referenceDirectFrameCommitted).toBe("scenario:58:60");
    cleanup();
    expect(root.dataset.referenceDirectFrameCommitted).toBeUndefined();
  });
});
