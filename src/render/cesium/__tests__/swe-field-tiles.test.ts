import { describe, expect, it } from "vitest";
import type { GridSnapshot } from "../../../types/scenario";
import { resolveSweImageryTiles } from "../swe-field-tiles";

const SNAPSHOT: GridSnapshot = {
  time_s: 0,
  bbox: [178, -2, 182, 2],
  nx: 16,
  ny: 8,
  height_field: {
    horizontal_crs: "EPSG:4326",
    vertical_datum: "idealized_mean_sea_level",
    vertical_axis: "positive_up",
    unit: "metre",
    declared_vertical_error_m: 4_000,
  },
  eta_min_m: -1,
  eta_max_m: 1,
  eta_abs_max_m: 1,
  eta_png_b64: "legacy-full-field",
};

describe("resolveSweImageryTiles", () => {
  it("maps a dateline field into complete non-wrapping tiles", () => {
    const tiles = resolveSweImageryTiles({
      ...SNAPSHOT,
      field_tiles: [
        { column_offset: 0, column_count: 8, bbox: [178, -2, 180, 2], eta_png_b64: "east" },
        { column_offset: 8, column_count: 8, bbox: [-180, -2, -178, 2], eta_png_b64: "west" },
      ],
    });

    expect(tiles).toEqual([
      { bbox: [178, -2, 180, 2], pngBase64: "east" },
      { bbox: [-180, -2, -178, 2], pngBase64: "west" },
    ]);
  });

  it("rejects incomplete tiles instead of falling back to the cropped legacy image", () => {
    expect(resolveSweImageryTiles({
      ...SNAPSHOT,
      field_tiles: [
        { column_offset: 0, column_count: 7, bbox: [178, -2, 179.75, 2], eta_png_b64: "partial" },
      ],
    })).toEqual([]);
  });

  it("keeps a valid legacy single rectangle", () => {
    expect(resolveSweImageryTiles({ ...SNAPSHOT, bbox: [-2, -2, 2, 2] })).toEqual([
      { bbox: [-2, -2, 2, 2], pngBase64: "legacy-full-field" },
    ]);
  });
});
