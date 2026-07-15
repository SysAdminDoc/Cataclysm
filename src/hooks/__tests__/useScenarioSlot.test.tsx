import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { INITIAL_ASTEROID } from "../../lib/scenario-schema";
import { api } from "../../lib/tauri";
import type { InitialDisplacement, RunPresetResponse } from "../../types/scenario";
import { useScenarioSlot } from "../useScenarioSlot";

vi.mock("../../lib/tauri", () => ({
  isTauri: () => true,
  api: {
    asteroidInitialConditions: vi.fn(),
    nuclearInitialConditions: vi.fn(),
    earthquakeInitialConditions: vi.fn(),
    landslideInitialConditions: vi.fn(),
    runPreset: vi.fn(),
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeInitial(label: string): InitialDisplacement {
  return {
    center: { lat_deg: 1, lon_deg: 2, depth_m: 4000 },
    cavity_radius_m: 5000,
    peak_amplitude_m: 2,
    source_energy_j: 1e15,
    seismic_mw_equivalent: 7,
    label,
  };
}

function makePresetResponse(id: string, label: string): RunPresetResponse {
  return {
    preset: {
      id,
      name: label,
      date: "test",
      blurb: "test preset",
      reference: "test reference",
      source: { kind: "Asteroid", source: INITIAL_ASTEROID },
    },
    initial: makeInitial(label),
    wavefront: { time_s: 900, ranges_m: [1000], amplitudes_m: [1] },
  };
}

describe("useScenarioSlot", () => {
  beforeEach(() => {
    vi.mocked(api.asteroidInitialConditions).mockReset();
    vi.mocked(api.nuclearInitialConditions).mockReset();
    vi.mocked(api.earthquakeInitialConditions).mockReset();
    vi.mocked(api.landslideInitialConditions).mockReset();
    vi.mocked(api.runPreset).mockReset();
  });

  it("ignores stale custom scenario responses after a preset is selected", async () => {
    const custom = deferred<InitialDisplacement>();
    const preset = deferred<RunPresetResponse>();
    vi.mocked(api.asteroidInitialConditions).mockReturnValue(custom.promise);
    vi.mocked(api.runPreset).mockReturnValue(preset.promise);

    const { result } = renderHook(() => useScenarioSlot(900));

    act(() => {
      result.current.simulate({ kind: "Asteroid", source: INITIAL_ASTEROID });
    });
    await waitFor(() => expect(api.asteroidInitialConditions).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.setActivePresetId("tohoku");
    });
    await waitFor(() => expect(api.runPreset).toHaveBeenCalledTimes(1));

    await act(async () => {
      preset.resolve(makePresetResponse("tohoku", "Preset result"));
      await preset.promise;
    });
    expect(result.current.initial?.label).toBe("Preset result");

    await act(async () => {
      custom.resolve(makeInitial("Stale custom result"));
      await custom.promise;
    });

    expect(result.current.initial?.label).toBe("Preset result");
  });

  it("preserves the scientific source while timeline-only preset results refresh", async () => {
    vi.mocked(api.runPreset).mockResolvedValue(makePresetResponse("tohoku", "Preset result"));
    const { result, rerender } = renderHook(({ timeS }) => useScenarioSlot(timeS), {
      initialProps: { timeS: 0 },
    });

    act(() => result.current.setActivePresetId("tohoku"));
    await waitFor(() => expect(result.current.initial).not.toBeNull());
    const originalInitial = result.current.initial;

    rerender({ timeS: 900 });
    await waitFor(() => expect(api.runPreset).toHaveBeenLastCalledWith(
      expect.objectContaining({ preset_id: "tohoku", time_s: 900 }),
    ));
    await waitFor(() => expect(result.current.busyPresetId).toBeNull());

    expect(result.current.initial).toBe(originalInitial);
  });

  it("retains a stale preset result after refresh failure and retries locally", async () => {
    vi.mocked(api.runPreset)
      .mockResolvedValueOnce(makePresetResponse("tohoku", "Preset result"))
      .mockRejectedValueOnce(new Error("backend unavailable"))
      .mockResolvedValueOnce(makePresetResponse("tohoku", "Preset result"));
    const { result, rerender } = renderHook(({ timeS }) => useScenarioSlot(timeS), {
      initialProps: { timeS: 0 },
    });

    act(() => result.current.setActivePresetId("tohoku"));
    await waitFor(() => expect(result.current.sourceResult.status).toBe("ready"));
    const originalInitial = result.current.initial;

    rerender({ timeS: 900 });
    await waitFor(() => expect(result.current.sourceResult.status).toBe("stale"));
    expect(result.current.initial).toBe(originalInitial);
    expect(result.current.error).toContain("backend unavailable");

    act(() => result.current.retrySource());
    await waitFor(() => expect(api.runPreset).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.sourceResult.status).toBe("ready"));
  });
});
