import { describe, expect, it } from "vitest";
import { colormapLegend } from "../colormap-legend";

describe("colormapLegend", () => {
  it("marks diverging and cividis as signed and viridis as magnitude", () => {
    expect(colormapLegend("diverging").signed).toBe(true);
    expect(colormapLegend("cividis").signed).toBe(true);
    expect(colormapLegend("viridis").signed).toBe(false);
  });

  it("gives signed maps a centred zero and magnitude maps a zero origin", () => {
    expect(colormapLegend("diverging").scale).toEqual(["−10", "−1", "0", "+1", "+10"]);
    expect(colormapLegend("viridis").scale[0]).toBe("0");
  });

  it("returns a usable CSS gradient and caption for every colormap", () => {
    for (const id of ["diverging", "cividis", "viridis"] as const) {
      const legend = colormapLegend(id);
      expect(legend.gradient).toMatch(/^linear-gradient\(/);
      expect(legend.caption).toContain("metres");
      expect(legend.scale).toHaveLength(5);
    }
    // CVD-safe maps advertise it in the caption.
    expect(colormapLegend("cividis").caption).toContain("CVD-safe");
    expect(colormapLegend("viridis").caption).toContain("CVD-safe");
  });
});
