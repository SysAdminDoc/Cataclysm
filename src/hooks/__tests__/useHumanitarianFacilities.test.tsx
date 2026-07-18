import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunupAtPointResult } from "../../lib/tauri";
import {
  FACILITY_CACHE_TTL_MS,
  buildFacilityQueryPlan,
  writeFacilityCache,
} from "../../lib/osm-facilities";
import { useHumanitarianFacilities } from "../useHumanitarianFacilities";

const RUNUP = {
  id: "coast-1",
  name: "Sample coast",
  lat: 0,
  lon: 0,
  beach_slope_deg: 2,
  offshore_depth_m: 50,
  slope_provenance: {},
  depth_provenance: {},
  quantitative_confidence: "medium",
  quantitative_label: "screening_estimate",
  range_m: 100_000,
  offshore_amplitude_m: 1,
  runup_m: 4,
  arrival_time_s: 900,
  has_arrived: true,
  inundation_extent_m: 1_000,
} as RunupAtPointResult;

describe("useHumanitarianFacilities", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("makes no request while the layer is off", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { result } = renderHook(() => useHumanitarianFacilities(false, [RUNUP]));

    expect(result.current.state.status).toBe("idle");
    expect(result.current.state.message).toContain("no network request");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows a stale local cache without requesting the network when offline", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const plan = buildFacilityQueryPlan([RUNUP]);
    writeFacilityCache({
      signature: plan.signature,
      fetchedAt: Date.now() - FACILITY_CACHE_TTL_MS - 1,
      osmDataTimestamp: "2026-07-01T00:00:00Z",
      facilities: [{
        id: "node/7",
        osmType: "node",
        osmId: 7,
        osmUrl: "https://www.openstreetmap.org/node/7",
        name: "Cached Clinic",
        category: "health",
        kind: "clinic",
        lat: 0,
        lon: 0,
        runupPointIds: ["coast-1"],
      }],
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const { result } = renderHook(() => useHumanitarianFacilities(true, [RUNUP]));

    await waitFor(() => expect(result.current.state.status).toBe("offline"));
    expect(result.current.state.facilities[0].name).toBe("Cached Clinic");
    expect(result.current.state.stale).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
