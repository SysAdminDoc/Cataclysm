import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunupAtPointResult } from "../tauri";
import {
  FACILITY_CACHE_TTL_MS,
  MAX_FACILITY_DISCS,
  OVERPASS_ENDPOINT,
  buildFacilityQueryPlan,
  fetchHumanitarianFacilities,
  parseOverpassFacilities,
  readFacilityCache,
  writeFacilityCache,
  type FacilityDataset,
  type HumanitarianFacility,
} from "../osm-facilities";

function runup(overrides: Partial<RunupAtPointResult> = {}): RunupAtPointResult {
  return {
    id: "coast-1",
    name: "Sample coast",
    lat: 38,
    lon: 142,
    beach_slope_deg: 2,
    offshore_depth_m: 50,
    slope_provenance: {} as RunupAtPointResult["slope_provenance"],
    depth_provenance: {} as RunupAtPointResult["depth_provenance"],
    quantitative_confidence: "medium",
    quantitative_label: "screening_estimate",
    range_m: 100_000,
    offshore_amplitude_m: 1,
    runup_m: 4,
    arrival_time_s: 900,
    has_arrived: true,
    inundation_extent_m: 1_000,
    ...overrides,
  };
}

function facility(overrides: Partial<HumanitarianFacility> = {}): HumanitarianFacility {
  return {
    id: "node/7",
    osmType: "node",
    osmId: 7,
    osmUrl: "https://www.openstreetmap.org/node/7",
    name: "Harbor Clinic",
    category: "health",
    kind: "clinic",
    lat: 38,
    lon: 142,
    runupPointIds: ["coast-1"],
    ...overrides,
  };
}

describe("OpenStreetMap humanitarian facility queries", () => {
  beforeEach(() => localStorage.clear());

  it("queries only active positive extents and applies public-service budgets", () => {
    const results = Array.from({ length: MAX_FACILITY_DISCS + 4 }, (_, index) => runup({
      id: `coast-${index}`,
      name: `Coast ${index}`,
      lat: 10 + index * 0.1,
      lon: 120,
      inundation_extent_m: index === 0 ? 40_000 : 1_000 + index,
    }));
    results.push(runup({ id: "not-arrived", has_arrived: false }));
    results.push(runup({ id: "zero", inundation_extent_m: 0 }));

    const plan = buildFacilityQueryPlan(results);

    expect(plan.discs).toHaveLength(MAX_FACILITY_DISCS);
    expect(plan.totalEligibleDiscs).toBe(MAX_FACILITY_DISCS + 4);
    expect(plan.truncatedDiscCount).toBe(4);
    expect(plan.clampedDiscCount).toBe(1);
    expect(plan.discs[0].radiusM).toBe(25_000);
    expect(plan.query).toContain('[out:json][timeout:15][maxsize:67108864]');
    expect(plan.query).toContain('nwr["amenity"~"^(school|kindergarten|college|university|hospital|clinic|doctors|fire_station|police|ambulance_station)$"]');
    expect(plan.query).not.toContain("Coast 1");
    expect(plan.query).not.toContain("not-arrived");
  });

  it("parses nodes and feature centers, deduplicates, and rejects bbox-only false positives", () => {
    const plan = buildFacilityQueryPlan([runup({ lat: 0, lon: 0, inundation_extent_m: 1_000 })]);
    const parsed = parseOverpassFacilities({
      elements: [
        { type: "node", id: 1, lat: 0.004, lon: 0, tags: { amenity: "school", name: "Coast School" } },
        { type: "way", id: 2, center: { lat: 0, lon: 0.005 }, tags: { healthcare: "hospital", name: "Coast Hospital" } },
        { type: "relation", id: 3, center: { lat: 0, lon: 0.006 }, tags: { amenity: "fire_station" } },
        { type: "node", id: 4, lat: 0.02, lon: 0, tags: { amenity: "clinic", name: "Outside bbox candidate" } },
        { type: "node", id: 5, lat: 0, lon: 0, tags: { amenity: "cafe", name: "Not in category" } },
        { type: "node", id: 1, lat: 0.004, lon: 0, tags: { amenity: "school", name: "Coast School" } },
      ],
    }, plan);

    expect(parsed.map((entry) => [entry.name, entry.category])).toEqual([
      ["Coast Hospital", "health"],
      ["Coast School", "school"],
      ["Unnamed fire station", "emergency"],
    ]);
    expect(parsed.every((entry) => entry.runupPointIds.includes("coast-1"))).toBe(true);
  });

  it("posts encoded Overpass QL and records the upstream data timestamp", async () => {
    const plan = buildFacilityQueryPlan([runup({ lat: 0, lon: 0 })]);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      osm3s: { timestamp_osm_base: "2026-07-17T15:00:00Z" },
      elements: [{ type: "node", id: 9, lat: 0, lon: 0, tags: { amenity: "clinic", name: "Clinic" } }],
    }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

    const dataset = await fetchHumanitarianFacilities(plan, { fetchImpl, now: () => 1234 });

    expect(fetchImpl).toHaveBeenCalledWith(OVERPASS_ENDPOINT, expect.objectContaining({ method: "POST" }));
    const request = vi.mocked(fetchImpl).mock.calls[0][1] as RequestInit;
    expect(String(request.body)).toContain("data=%5Bout%3Ajson%5D");
    expect(dataset.facilities).toHaveLength(1);
    expect(dataset.fetchedAt).toBe(1234);
    expect(dataset.osmDataTimestamp).toBe("2026-07-17T15:00:00Z");
  });

  it("rejects an oversized response before parsing it", async () => {
    const plan = buildFacilityQueryPlan([runup({ lat: 0, lon: 0 })]);
    const fetchImpl = vi.fn(async () => new Response("{}", {
      status: 200,
      headers: { "content-length": String(2 * 1024 * 1024 + 1) },
    })) as unknown as typeof fetch;

    await expect(fetchHumanitarianFacilities(plan, { fetchImpl })).rejects.toThrow("2 MB safety limit");
  });

  it("keeps a bounded fresh cache and exposes older data only as a stale fallback", () => {
    const now = Date.now();
    const dataset: FacilityDataset = {
      facilities: [facility()],
      fetchedAt: now - FACILITY_CACHE_TTL_MS - 1,
      osmDataTimestamp: "2026-07-01T00:00:00Z",
      signature: "v1-old",
    };
    writeFacilityCache(dataset);

    expect(readFacilityCache(dataset.signature, { now })).toBeNull();
    expect(readFacilityCache(dataset.signature, { now, allowStale: true })).toEqual({ dataset, stale: true });

    for (let index = 0; index < 10; index += 1) {
      writeFacilityCache({ ...dataset, signature: `v1-${index}`, fetchedAt: now + index });
    }
    const stored = JSON.parse(localStorage.getItem("cataclysm.osm-humanitarian-facilities.v1") ?? "null") as { entries: unknown[] };
    expect(stored.entries).toHaveLength(8);
  });
});
