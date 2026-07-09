import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DartOverlay } from "../DartOverlay";
import type { GridSnapshot } from "../../types/scenario";

const tauriApi = vi.hoisted(() => ({
  dartBuoyRmse: vi.fn(),
}));

vi.mock("../../lib/tauri", () => ({
  api: tauriApi,
  isTauri: () => true,
}));

function snapshotAt(timeS: number, etaM: number): GridSnapshot {
  return {
    time_s: timeS,
    bbox: [-1, -1, 1, 1],
    nx: 2,
    ny: 2,
    eta_min_m: -1,
    eta_max_m: 1,
    eta_abs_max_m: 1,
    eta_png_b64: "a",
    gauge_samples: [
      { id: "dart-21413", eta_m: etaM },
      { id: "dart-21418", eta_m: etaM },
      { id: "dart-51407", eta_m: etaM },
    ],
  };
}

describe("DartOverlay RMSE", () => {
  beforeEach(() => {
    tauriApi.dartBuoyRmse.mockReset();
  });

  it("renders no RMSE row without SWE snapshots", () => {
    render(<DartOverlay presetId="tohoku_2011" timeS={0} initial={null} />);
    expect(screen.queryByText(/RMSE/)).not.toBeInTheDocument();
    expect(tauriApi.dartBuoyRmse).not.toHaveBeenCalled();
  });

  it("computes and shows RMSE per buoy from dart gauge samples", async () => {
    tauriApi.dartBuoyRmse.mockResolvedValue({
      rmse_m: 0.42,
      n_samples: 12,
      observed_peak_m: 1.3,
      model_peak_m: 0.98,
    });
    render(
      <DartOverlay
        presetId="tohoku_2011"
        timeS={0}
        initial={null}
        sweSnapshots={[snapshotAt(0, 0.1), snapshotAt(1800, 0.5), snapshotAt(3600, 0.2)]}
      />,
    );
    const rows = await screen.findAllByText(/RMSE 0\.42 m/);
    expect(rows.length).toBe(3);
    expect(tauriApi.dartBuoyRmse).toHaveBeenCalledTimes(3);
    const firstCall = tauriApi.dartBuoyRmse.mock.calls[0][0];
    expect(firstCall.model_samples).toEqual([
      [0, 0.1],
      [1800, 0.5],
      [3600, 0.2],
    ]);
    expect(firstCall.observations.length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/model peak 0\.98 m vs observed 1\.30 m/).length,
    ).toBe(3);
  });

  it("shows the no-overlap note when the IPC rejects a buoy", async () => {
    tauriApi.dartBuoyRmse.mockRejectedValue("model and observed series do not overlap");
    render(
      <DartOverlay
        presetId="tohoku_2011"
        timeS={0}
        initial={null}
        sweSnapshots={[snapshotAt(0, 0.1), snapshotAt(3600, 0.2)]}
      />,
    );
    const notes = await screen.findAllByText(/Solver window ends before/);
    expect(notes.length).toBe(3);
  });
});
