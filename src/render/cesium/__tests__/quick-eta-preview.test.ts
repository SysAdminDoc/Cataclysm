import { describe, expect, it } from "vitest";

import { isValidQuickEtaPreview, quickEtaArrivalRange } from "../quick-eta-preview";
import type { QuickEtaPreview } from "../../../types/scenario";

const preview: QuickEtaPreview = {
  bbox: [-10, -5, 10, 5],
  nx: 2,
  ny: 2,
  arrival_s: [null, 120, 60, 180],
  elapsed_wall_ms: 14,
};

describe("quick ETA preview contract", () => {
  it("accepts bounded backend output and reports reached-cell timing", () => {
    expect(isValidQuickEtaPreview(preview)).toBe(true);
    expect(quickEtaArrivalRange(preview)).toEqual({
      minimumS: 60,
      maximumS: 180,
      reachedCells: 3,
    });
  });

  it("rejects malformed or non-finite preview cells", () => {
    expect(isValidQuickEtaPreview({ ...preview, arrival_s: [null, 120] })).toBe(false);
    expect(isValidQuickEtaPreview({ ...preview, arrival_s: [null, Number.NaN, 60, 180] })).toBe(false);
    expect(quickEtaArrivalRange(null)).toBeNull();
  });
});
