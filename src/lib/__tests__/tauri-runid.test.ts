import { describe, expect, it, vi, beforeEach } from "vitest";

const invokeMock = vi.fn((_cmd: string, _payload?: unknown): Promise<unknown> => Promise.resolve({}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, payload?: unknown) => invokeMock(cmd, payload),
  Channel: class {},
}));

import { api, createSimulationRunId } from "../tauri";

describe("simulateGrid run id", () => {
  beforeEach(() => invokeMock.mockClear());

  const req = {
    source: { lat_deg: 0, lon_deg: 0, depth_m: 4000 },
    initial_amplitude_m: 1,
    source_sigma_m: 10000,
    mean_depth_m: 4000,
    box_half_size_deg: 5,
    cells_per_deg: 10,
    t_end_s: 100,
    n_snapshots: 4,
  };

  it("threads a caller-supplied run id so the run is cancellable", async () => {
    await api.simulateGrid(req, "run-explicit");
    expect(invokeMock).toHaveBeenCalledWith("simulate_grid", { runId: "run-explicit", req });
  });

  it("defaults to a generated run id when none is supplied", async () => {
    await api.simulateGrid(req);
    const payload = invokeMock.mock.calls[0][1] as { runId: string };
    expect(payload.runId).toMatch(/^run-/);
  });

  it("generates unique run ids", () => {
    expect(createSimulationRunId()).not.toBe(createSimulationRunId());
  });
});
