import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canImportRecentEarthquake,
  loadRecentUsgsEarthquakes,
  loadUsgsEarthquakeDetail,
  recentEarthquakeImport,
  type UsgsEarthquakeDetail,
  type UsgsRecentEarthquakesResponse,
} from "../usgs-earthquakes";

const mocks = vi.hoisted(() => ({
  desktop: true,
  recent: vi.fn(),
  detail: vi.fn(),
}));

vi.mock("../tauri", () => ({
  isTauri: () => mocks.desktop,
  api: {
    usgsRecentEarthquakes: mocks.recent,
    usgsEarthquakeDetail: mocks.detail,
  },
}));

const EVENT = {
  id: "us7000test",
  title: "M 7.2 - Test trench",
  place: "Test trench",
  magnitude: 7.2,
  magnitudeType: "mww",
  timeMs: 1_752_000_000_000,
  updatedMs: 1_752_000_600_000,
  latitude: 38.2,
  longitude: 142.4,
  depthKm: 24,
  status: "reviewed",
  significance: 800,
  tsunamiFlag: true,
  alertLevel: "yellow",
  maxMmi: 7.4,
  hasShakemap: true,
  hasPager: true,
  hasFiniteFault: true,
  hasMomentTensor: true,
  eventUrl: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000test",
} as const;

const RESPONSE: UsgsRecentEarthquakesResponse = {
  generatedAtMs: 1_752_000_700_000,
  sourceUrl: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson",
  events: [EVENT],
};

const DETAIL: UsgsEarthquakeDetail = {
  event: EVENT,
  okadaSource: {
    basis: "finite_fault",
    strikeDeg: 195,
    dipDeg: 12,
    rakeDeg: 88,
    averageSlipM: 2.4,
    faultLengthM: 110_000,
    faultWidthM: 55_000,
    scalarMomentNm: 7.5e19,
    reviewStatus: "reviewed",
    assumptions: ["Average slip reconstructed from scalar moment and fault area."],
  },
  shakemap: {
    maxMmi: 7.4,
    mapStatus: "RELEASED",
    reviewStatus: "reviewed",
    processTimestamp: "2026-07-20T10:00:00Z",
    bounds: [140, 36, 144, 40],
    contours: [{ mmi: 6, color: "#f7d038", points: [[141, 37], [143, 39]] }],
  },
  pager: { alertLevel: "yellow", maxMmi: 7.4, reviewStatus: "reviewed" },
  fetchedAtMs: 1_752_000_800_000,
};

describe("recent USGS earthquake discovery", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.desktop = true;
    mocks.recent.mockReset();
    mocks.detail.mockReset();
  });

  it("validates, caches, and returns the fixed USGS feed", async () => {
    mocks.recent.mockResolvedValue(RESPONSE);
    await expect(loadRecentUsgsEarthquakes()).resolves.toMatchObject({ status: "live", stale: false, events: [EVENT] });
    expect(localStorage.getItem("cataclysm.usgs.recent-earthquakes.v1")).toContain("us7000test");
  });

  it("falls back to a visibly stale on-device cache", async () => {
    mocks.recent.mockResolvedValueOnce(RESPONSE);
    await loadRecentUsgsEarthquakes();
    mocks.recent.mockRejectedValueOnce(new Error("offline"));
    await expect(loadRecentUsgsEarthquakes()).resolves.toMatchObject({ status: "cached", stale: true });
  });

  it("caches selected details and maps the full cited source contract", async () => {
    mocks.detail.mockResolvedValue(DETAIL);
    const live = await loadUsgsEarthquakeDetail(EVENT.id);
    expect(live).toEqual({ detail: DETAIL, stale: false });
    expect(canImportRecentEarthquake(DETAIL)).toBe(true);
    expect(recentEarthquakeImport(DETAIL, false)).toMatchObject({
      scenario: {
        kind: "Earthquake",
        source: {
          mw: 7.2,
          depth_m: 24_000,
          strike_deg: 195,
          dip_deg: 12,
          rake_deg: 88,
          slip_m: 2.4,
          fault_length_m: 110_000,
          fault_width_m: 55_000,
          location: { lat_deg: 38.2, lon_deg: 142.4 },
        },
      },
      provenanceNote: expect.stringContaining("not a live warning"),
      officialComparison: { eventId: EVENT.id, shakemap: DETAIL.shakemap, pager: DETAIL.pager },
    });

    mocks.detail.mockRejectedValue(new Error("offline"));
    await expect(loadUsgsEarthquakeDetail(EVENT.id)).resolves.toEqual({ detail: DETAIL, stale: true });
  });

  it("fails closed on untrusted event identifiers and responses", async () => {
    await expect(loadUsgsEarthquakeDetail("../event")).rejects.toThrow("Invalid USGS event ID");
    mocks.recent.mockResolvedValue({ ...RESPONSE, sourceUrl: "https://example.com/feed" });
    const result = await loadRecentUsgsEarthquakes();
    expect(result.status).toBe("unavailable");
    expect(mocks.detail).not.toHaveBeenCalled();
  });
});
