import { describe, expect, it } from "vitest";
import {
  hypotheticalImpactFromApproach,
  loadCloseApproaches,
  loadFireballs,
  parseCloseApproaches,
  parseFireballs,
  searchNeo,
} from "../jpl";

describe("JPL data adapters", () => {
  it("parses located fireballs by field name and applies hemisphere signs", () => {
    const events = parseFireballs({
      fields: ["date", "impact-e", "lon-dir", "lat", "energy", "lon", "lat-dir", "alt", "vel"],
      data: [["2026-01-02 03:04:05", "2.5", "W", "12.5", "4.2", "33.5", "S", "24", "18"]],
    });
    expect(events).toEqual([expect.objectContaining({
      date: "2026-01-02 03:04:05",
      lat: -12.5,
      lon: -33.5,
      impactEnergyKt: 2.5,
      radiatedEnergy10J: 4.2,
      altitudeKm: 24,
      velocityKmS: 18,
      source: "NASA/JPL CNEOS",
    })]);
  });

  it("drops incomplete or out-of-range location rows", () => {
    expect(parseFireballs({
      fields: ["date", "lat", "lat-dir", "lon", "lon-dir"],
      data: [["2026-01-01", null, null, null, null], ["2026-01-02", "95", "N", "20", "E"]],
    })).toEqual([]);
  });

  it("uses bounded offline references when the desktop bridge is absent", async () => {
    const feed = await loadFireballs();
    expect(feed.events).toHaveLength(3);
    expect(feed.notice).toMatch(/desktop-only/i);
    await expect(searchNeo("Apophis")).resolves.toEqual(expect.objectContaining({
      fullname: expect.stringContaining("Apophis"),
      source: "Built-in fallback",
    }));
    await expect(searchNeo("unknown object")).rejects.toThrow(/desktop app/i);
    const approaches = await loadCloseApproaches();
    expect(approaches.status).toBe("reference");
    expect(approaches.approaches[0].source).toBe("Built-in reference");
  });

  it("parses bounded CAD 1.5 fields with measured and H-estimated size ranges", () => {
    const approaches = parseCloseApproaches({
      signature: { version: "1.5" },
      fields: ["des", "cd", "dist", "dist_min", "dist_max", "v_rel", "v_inf", "t_sigma_f", "h", "diameter", "diameter_sigma", "fullname"],
      data: [
        ["99942", "2029-Apr-13 21:46", "0.000254099", "0.000254085", "0.000254112", "7.422", "5.842", "< 00:01", "19.7", "0.34", "0.04", " 99942 Apophis (2004 MN4)"],
        ["2001 AV43", "2029-Nov-11 15:25", "0.0020927", "0.0020912", "0.0020941", "3.998", "3.666", "00:03", "24.6", null, null, " (2001 AV43)"],
      ],
    });
    expect(approaches).toHaveLength(2);
    expect(approaches[0]).toEqual(expect.objectContaining({
      fullname: "99942 Apophis (2004 MN4)",
      approachAtIso: "2029-04-13T21:46:00.000Z",
      diameterMinM: 300,
      diameterMaxM: 380,
      diameterBasis: "measured",
    }));
    expect(approaches[1].diameterBasis).toBe("estimated_from_h");
    expect(approaches[1].diameterMaxM).toBeGreaterThan(approaches[1].diameterMinM);
  });

  it("creates an explicit non-prediction impact draft from approach facts", async () => {
    const feed = await loadCloseApproaches();
    const draft = hypotheticalImpactFromApproach(feed.approaches[0]);
    expect(draft.diameterM).toBeGreaterThan(0);
    expect(draft.velocityMps).toBeGreaterThan(feed.approaches[0].infinityVelocityKmS * 1_000);
    expect(draft.assumptions.join(" ")).toMatch(/what-if input, not a predicted trajectory/i);
  });
});
