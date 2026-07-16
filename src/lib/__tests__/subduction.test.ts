import { describe, expect, it } from "vitest";
import {
  MAX_MATCH_DISTANCE_KM,
  SUBDUCTION_ZONES,
  faultGeometryFromZone,
  greatCircleKm,
  nearestSubductionZone,
} from "../subduction";
import sourceInputContract from "../../data/source-input-contract.json";

const EQ_FIELDS = (sourceInputContract as {
  sources: {
    Earthquake: {
      fields: Record<
        string,
        { minimum: number; maximum: number }
      >;
    };
  };
}).sources.Earthquake.fields;

describe("subduction-zone geometry lookup", () => {
  it("has a non-empty, well-formed registry", () => {
    expect(SUBDUCTION_ZONES.length).toBeGreaterThan(8);
    for (const zone of SUBDUCTION_ZONES) {
      expect(zone.id).toBeTruthy();
      expect(zone.name).toBeTruthy();
      expect(zone.reference_event).toBeTruthy();
      expect(Number.isFinite(zone.strike_deg)).toBe(true);
    }
    const ids = SUBDUCTION_ZONES.map((z) => z.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("great-circle distance is symmetric and zero on identity", () => {
    expect(greatCircleKm(38.3, 142.4, 38.3, 142.4)).toBeCloseTo(0, 6);
    const a = greatCircleKm(0, 0, 10, 10);
    const b = greatCircleKm(10, 10, 0, 0);
    expect(a).toBeCloseTo(b, 6);
    // Tokyo (35.68,139.77) -> Sendai (38.27,140.87) is ~300 km.
    expect(greatCircleKm(35.68, 139.77, 38.27, 140.87)).toBeGreaterThan(250);
    expect(greatCircleKm(35.68, 139.77, 38.27, 140.87)).toBeLessThan(350);
  });

  it("resolves a Tohoku-region epicentre to the Japan Trench and matches the Rust preset geometry", () => {
    // Same epicentre used by the Rust `tohoku_2011()` preset.
    const match = nearestSubductionZone(38.297, 142.372);
    expect(match).not.toBeNull();
    expect(match!.onMappedZone).toBe(true);
    expect(match!.zone.id).toBe("japan-kuril");
    const g = faultGeometryFromZone(match!.zone);
    // The Rust preset uses strike 195, dip 12, rake 85 — cross-check within tolerance.
    expect(Math.abs(g.strike_deg - 195)).toBeLessThanOrEqual(15);
    expect(Math.abs(g.dip_deg - 12)).toBeLessThanOrEqual(6);
    expect(Math.abs(g.rake_deg - 85)).toBeLessThanOrEqual(15);
  });

  it("resolves a Sumatra-region epicentre to the Sunda Trench", () => {
    const match = nearestSubductionZone(3.316, 95.854);
    expect(match!.zone.id).toBe("sunda-sumatra");
    expect(match!.onMappedZone).toBe(true);
  });

  it("flags a far-from-any-zone point (mid-Atlantic) as not on a mapped zone", () => {
    const match = nearestSubductionZone(30, -40);
    expect(match).not.toBeNull();
    expect(match!.onMappedZone).toBe(false);
    expect(match!.distanceKm).toBeGreaterThan(MAX_MATCH_DISTANCE_KM);
  });

  it("returns null for non-finite input", () => {
    expect(nearestSubductionZone(Number.NaN, 10)).toBeNull();
  });

  it("derives geometry that stays within the earthquake input contract bounds", () => {
    for (const zone of SUBDUCTION_ZONES) {
      const g = faultGeometryFromZone(zone);
      expect(g.strike_deg).toBeGreaterThanOrEqual(EQ_FIELDS.strike_deg.minimum);
      expect(g.strike_deg).toBeLessThanOrEqual(EQ_FIELDS.strike_deg.maximum);
      expect(g.dip_deg).toBeGreaterThanOrEqual(EQ_FIELDS.dip_deg.minimum);
      expect(g.dip_deg).toBeLessThanOrEqual(EQ_FIELDS.dip_deg.maximum);
      expect(g.rake_deg).toBeGreaterThanOrEqual(EQ_FIELDS.rake_deg.minimum);
      expect(g.rake_deg).toBeLessThanOrEqual(EQ_FIELDS.rake_deg.maximum);
      expect(g.depth_m).toBeGreaterThanOrEqual(EQ_FIELDS.depth_m.minimum);
      expect(g.depth_m).toBeLessThanOrEqual(EQ_FIELDS.depth_m.maximum);
      // Length/width left to Rust auto-sizing.
      expect(g.fault_length_m).toBe(0);
      expect(g.fault_width_m).toBe(0);
    }
  });
});
