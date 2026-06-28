import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SwePlayback } from "../SwePlayback";
import type { GridSnapshot, InitialDisplacement } from "../../types/scenario";

const tauriApi = vi.hoisted(() => ({
  simulateGridStreaming: vi.fn(),
  cancelSimulation: vi.fn(),
}));

vi.mock("../../lib/tauri", () => ({
  api: tauriApi,
  isTauri: () => true,
}));

const INITIAL: InitialDisplacement = {
  center: { lat_deg: 0, lon_deg: 0, depth_m: 4000 },
  cavity_radius_m: 10_000,
  peak_amplitude_m: 4,
  source_energy_j: 1e16,
  seismic_mw_equivalent: 6,
  label: "Test source",
};

const SNAPSHOTS: GridSnapshot[] = [
  {
    time_s: 0,
    bbox: [-1, -1, 1, 1],
    nx: 2,
    ny: 2,
    eta_min_m: -1,
    eta_max_m: 1,
    eta_abs_max_m: 1,
    eta_png_b64: "a",
  },
  {
    time_s: 60,
    bbox: [-1, -1, 1, 1],
    nx: 2,
    ny: 2,
    eta_min_m: -2,
    eta_max_m: 2,
    eta_abs_max_m: 2,
    eta_png_b64: "b",
  },
];

describe("SwePlayback", () => {
  beforeEach(() => {
    localStorage.clear();
    tauriApi.simulateGridStreaming.mockReset();
    tauriApi.cancelSimulation.mockReset();
    tauriApi.cancelSimulation.mockResolvedValue(undefined);
  });

  it("streams progress and hands snapshots to the parent", async () => {
    let pushSnapshot: ((snap: GridSnapshot) => void) | null = null;
    let finish:
      | ((meta: { dt_s: number; nx: number; ny: number; used_gpu: boolean; n_snapshots: number }) => void)
      | null = null;
    tauriApi.simulateGridStreaming.mockImplementation(async (_req, onSnapshot) => {
      pushSnapshot = onSnapshot;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const onSnapshot = vi.fn();
    const onSnapshotsReady = vi.fn();
    const user = userEvent.setup();
    render(<SwePlayback initial={INITIAL} onSnapshot={onSnapshot} onSnapshotsReady={onSnapshotsReady} />);

    expect(screen.getByText("Coarse basin/shelf bathymetry")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/Low confidence/i);
    expect(screen.getByRole("note")).toHaveTextContent(/GEBCO_2026\/TID-backed terrain/i);

    await user.click(screen.getByRole("button", { name: "Run solver" }));
    await screen.findByRole("button", { name: "Cancel" });

    act(() => {
      pushSnapshot?.(SNAPSHOTS[0]);
    });
    expect(await screen.findByText("Streaming frame 1 / 24")).toBeInTheDocument();
    expect(onSnapshot).toHaveBeenCalledWith(SNAPSHOTS[0]);

    act(() => {
      pushSnapshot?.(SNAPSHOTS[1]);
      finish?.({ dt_s: 2, nx: 2, ny: 2, used_gpu: false, n_snapshots: 2 });
    });

    expect(await screen.findByText(/Frame\s+1\/2/i)).toBeInTheDocument();
    expect(screen.getByText(/grid\s+2.2/i)).toBeInTheDocument();
    await waitFor(() => expect(onSnapshotsReady).toHaveBeenCalledWith(SNAPSHOTS));
  });

  it("cancels an in-flight streaming run and ignores late frames", async () => {
    let pushSnapshot: ((snap: GridSnapshot) => void) | null = null;
    tauriApi.simulateGridStreaming.mockImplementation(async (_req, onSnapshot) => {
      pushSnapshot = onSnapshot;
      return new Promise(() => {});
    });
    const onSnapshot = vi.fn();
    const user = userEvent.setup();
    render(<SwePlayback initial={INITIAL} onSnapshot={onSnapshot} />);

    await user.click(screen.getByRole("button", { name: "Run solver" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(tauriApi.cancelSimulation).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Run solver" })).toBeInTheDocument();

    act(() => {
      pushSnapshot?.(SNAPSHOTS[0]);
    });
    expect(onSnapshot).not.toHaveBeenCalledWith(SNAPSHOTS[0]);
  });
});
