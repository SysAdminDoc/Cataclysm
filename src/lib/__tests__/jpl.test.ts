import { describe, expect, it } from "vitest";
import { loadFireballs, parseFireballs, searchNeo } from "../jpl";

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
  });
});
