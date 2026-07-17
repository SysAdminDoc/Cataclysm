import { describe, expect, it } from "vitest";
import {
  canImportHistoricalEvent,
  eventValidityLabel,
  historicalEventImport,
  parseHistoricalEventSearch,
  type HazelTsunamiEvent,
} from "../ncei-hazel";

const CHILE_1960: HazelTsunamiEvent = {
  id: 1902,
  year: 1960,
  month: 5,
  day: 22,
  eventValidity: 4,
  causeCode: 1,
  eqMagnitude: 9.5,
  country: "CHILE",
  locationName: "SOUTHERN CHILE",
  latitude: -38.143,
  longitude: -73.407,
  numRunups: 1279,
};

describe("NCEI HazEL event mapping", () => {
  it("parses the acceptance query into a bounded API request", () => {
    expect(parseHistoricalEventSearch("1960 Chile")).toEqual({
      ok: true,
      request: { year: 1960, location: "Chile" },
    });
    expect(parseHistoricalEventSearch("Chile 1960")).toEqual({
      ok: true,
      request: { year: 1960, location: "Chile" },
    });
    expect(parseHistoricalEventSearch(" ")).toEqual({
      ok: false,
      reason: "Enter a year, location, or both.",
    });
    expect(parseHistoricalEventSearch("x").ok).toBe(false);
  });

  it("imports only observed earthquake magnitude and epicentre", () => {
    const result = historicalEventImport(CHILE_1960);
    expect(result?.scenario).toMatchObject({
      kind: "Earthquake",
      source: {
        mw: 9.5,
        location: { lat_deg: -38.143, lon_deg: -73.407 },
        fault_length_m: 0,
        fault_width_m: 0,
      },
    });
    expect(result?.provenanceNote).toContain("HazEL event 1902");
    expect(result?.provenanceNote).toContain("Fault geometry, slip, depth, and water depth remain Cataclysm defaults");
    expect(eventValidityLabel(CHILE_1960.eventValidity)).toBe("Definite tsunami");
  });

  it("fails closed for non-earthquake or incomplete records", () => {
    expect(canImportHistoricalEvent({ ...CHILE_1960, causeCode: 3 })).toBe(false);
    expect(historicalEventImport({ ...CHILE_1960, latitude: null })).toBeNull();
    expect(historicalEventImport({ ...CHILE_1960, eqMagnitude: 20 })).toBeNull();
  });
});
