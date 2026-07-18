import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../tauri", () => ({
  isTauri: () => true,
  api: { jplApiRequest: bridge.request },
}));

import { loadCloseApproaches } from "../jpl";

const CAD_PAYLOAD = {
  signature: { version: "1.5" },
  fields: ["des", "cd", "dist", "dist_min", "dist_max", "v_rel", "v_inf", "t_sigma_f", "h", "diameter", "diameter_sigma", "fullname"],
  data: [["99942", "2029-Apr-13 21:46", "0.000254099", "0.000254085", "0.000254112", "7.422", "5.842", "< 00:01", "19.7", "0.34", "0.04", "99942 Apophis (2004 MN4)"]],
};

describe("JPL close-approach cache", () => {
  beforeEach(() => {
    localStorage.clear();
    bridge.request.mockReset();
  });

  it("keeps the last successful bounded feed browsable when refresh fails", async () => {
    bridge.request.mockResolvedValueOnce(CAD_PAYLOAD);
    const live = await loadCloseApproaches();
    expect(live).toEqual(expect.objectContaining({ status: "live", stale: false }));
    expect(bridge.request).toHaveBeenCalledWith("cad", {
      "date-min": "now",
      "date-max": "+60",
      "dist-max": "0.05",
      sort: "date",
      limit: "12",
      diameter: "true",
      fullname: "true",
    });

    bridge.request.mockRejectedValueOnce(new Error("offline"));
    const cached = await loadCloseApproaches();
    expect(cached).toEqual(expect.objectContaining({
      status: "cached",
      stale: true,
      approaches: [expect.objectContaining({ designation: "99942" })],
    }));
  });

  it("falls back to clearly non-current references when live data and cache are absent", async () => {
    bridge.request.mockRejectedValueOnce(new Error("offline"));
    const fallback = await loadCloseApproaches();
    expect(fallback.status).toBe("reference");
    expect(fallback.stale).toBe(true);
    expect(fallback.notice).toMatch(/not today's feed/i);
  });

  it("rejects a malformed on-device approach cache", async () => {
    bridge.request.mockResolvedValueOnce(CAD_PAYLOAD);
    await loadCloseApproaches();
    const key = "cataclysm.neo.close-approaches.v1";
    const cached = JSON.parse(localStorage.getItem(key) ?? "null") as {
      approaches: Array<{ nominalDistanceAu: number }>;
    };
    cached.approaches[0].nominalDistanceAu = -1;
    localStorage.setItem(key, JSON.stringify(cached));

    bridge.request.mockRejectedValueOnce(new Error("offline"));
    const fallback = await loadCloseApproaches();
    expect(fallback).toEqual(expect.objectContaining({ status: "reference", stale: true }));
  });
});
