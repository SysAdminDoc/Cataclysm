import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DartOverlay } from "../DartOverlay";
import type { GridSnapshot } from "../../types/scenario";
import { IDEALIZED_SEA_SURFACE_HEIGHT_FIELD } from "../../lib/geodesy";

const tauriApi = vi.hoisted(() => ({
  dartBuoyRmse: vi.fn(),
}));

function comparisonResult(overrides: Record<string, unknown> = {}) {
  return {
    rmse_m: 0.42,
    n_samples: 12,
    overlap_start_s: 0,
    overlap_end_s: 3600,
    observed_peak_m: 1.3,
    model_peak_m: 0.98,
    noise_floor_m: 0.03,
    noise_method: "fixed 0.03 m NOAA DART North-Pacific minimum for de-tided residuals",
    arrival_threshold_m: 0.03,
    arrival_method: "first of two consecutive |eta| samples at or above threshold; isolated samples are screened as artifacts",
    observed_arrival_s: 600,
    model_arrival_s: 900,
    arrival_residual_s: 300,
    ...overrides,
  };
}

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
    height_field: IDEALIZED_SEA_SURFACE_HEIGHT_FIELD,
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
    render(<DartOverlay presetId="tohoku_2011" timeS={0} />);
    expect(document.querySelector(".dart__rmse")).toBeNull();
    expect(screen.queryByText("SWE model")).not.toBeInTheDocument();
    expect(screen.queryByText("Arrival markers")).not.toBeInTheDocument();
    expect(tauriApi.dartBuoyRmse).not.toHaveBeenCalled();
  });

  it("shows Rust-derived overlap, peaks, arrivals, and method from dart gauge samples", async () => {
    tauriApi.dartBuoyRmse.mockResolvedValue(comparisonResult());
    render(
      <DartOverlay
        presetId="tohoku_2011"
        timeS={0}
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
      screen.getAllByText(/observed peak 1\.30 m · model peak 0\.98 m/, {
        selector: ".dart__rmse span",
      }).length,
    ).toBe(3);
    expect(screen.getAllByText(/overlap 0 min–60 min · 12 paired samples/)).toHaveLength(3);
    expect(screen.getAllByText(/observed 10 min · model 15 min · residual \+5 min/, { selector: ".dart__rmse span" })).toHaveLength(3);
    expect(screen.getAllByText(/threshold 3 cm; noise: fixed 0\.03 m NOAA/, { selector: ".dart__rmse span" })).toHaveLength(3);
    expect(screen.getByText("SWE model")).toBeInTheDocument();
    expect(screen.getByText("Arrival markers")).toBeInTheDocument();
    expect(
      screen.getAllByRole("img", {
        name: /observed 0\.00 m at the timeline cursor; model 0\.10 m at the timeline cursor/,
      }),
    ).toHaveLength(3);
  });

  it("exposes observed/model samples, active selection, threshold, confidence, and provenance", async () => {
    tauriApi.dartBuoyRmse.mockResolvedValue(comparisonResult());
    const user = userEvent.setup();
    render(
      <DartOverlay
        presetId="tohoku_2011"
        timeS={1800}
        sweSnapshots={[snapshotAt(0, 0.1), snapshotAt(1800, 0.5), snapshotAt(3600, 0.2)]}
      />,
    );
    await screen.findAllByText(/RMSE 0\.42 m/);
    const summaries = document.querySelectorAll<HTMLElement>(".chart-data__summary");
    expect(summaries).toHaveLength(3);
    summaries.forEach((summary) => expect(summary).toHaveAttribute("aria-live", "off"));
    const firstChart = screen.getAllByRole("img", { name: /DART water level/ })[0];
    expect(firstChart).toHaveAttribute("aria-describedby", summaries[0].id);

    await user.click(screen.getByText(/View 21413 .* DART comparison data/));
    const tableRegion = screen.getByRole("region", { name: /21413 .* DART comparison data table/ });
    expect(within(tableRegion).getAllByRole("rowheader", { name: "Observed DART water level" }).length).toBeGreaterThan(1);
    expect(within(tableRegion).getAllByRole("rowheader", { name: "SWE model gauge" })).toHaveLength(3);
    expect(within(tableRegion).getByRole("rowheader", { name: "Arrival detection threshold" })).toBeInTheDocument();
    expect(within(tableRegion).getByRole("rowheader", { name: "Observed timeline selection" })).toBeInTheDocument();
    expect(within(tableRegion).getAllByText(/NOAA NDBC\/NCEI DART archive/).length).toBeGreaterThan(1);
  });

  it("shows structured no-overlap without misclassifying it as an IPC failure", async () => {
    tauriApi.dartBuoyRmse.mockResolvedValue(comparisonResult({
      rmse_m: null,
      n_samples: 0,
      overlap_start_s: null,
      overlap_end_s: null,
      observed_arrival_s: null,
      model_arrival_s: null,
      arrival_residual_s: null,
    }));
    render(
      <DartOverlay
        presetId="tohoku_2011"
        timeS={0}
        sweSnapshots={[snapshotAt(0, 0.1), snapshotAt(3600, 0.2)]}
      />,
    );
    const notes = await screen.findAllByText(/No shared observation\/model time window/);
    expect(notes.length).toBe(3);
  });

  it("surfaces a real comparison failure separately from no-overlap", async () => {
    tauriApi.dartBuoyRmse.mockRejectedValue("invalid finite series");
    const user = userEvent.setup();
    render(
      <DartOverlay
        presetId="tohoku_2011"
        timeS={0}
        sweSnapshots={[snapshotAt(0, 0.1), snapshotAt(3600, 0.2)]}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't compute DART comparison/);
    expect(screen.getByRole("button", { name: "Retry DART comparison" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry DART comparison" }));
    await waitFor(() => expect(tauriApi.dartBuoyRmse).toHaveBeenCalledTimes(6));
  });

  it("retains successful buoy comparisons when one station fails", async () => {
    tauriApi.dartBuoyRmse
      .mockResolvedValueOnce(comparisonResult())
      .mockRejectedValueOnce(new Error("station timeout"))
      .mockResolvedValueOnce(comparisonResult({ rmse_m: 0.31 }));
    render(
      <DartOverlay
        presetId="tohoku_2011"
        timeS={0}
        sweSnapshots={[snapshotAt(0, 0.1), snapshotAt(3600, 0.2)]}
      />,
    );

    expect(await screen.findAllByText(/RMSE 0\.(42|31) m/)).toHaveLength(2);
    expect(screen.getByRole("alert")).toHaveTextContent(/Successful buoy results remain available/);
    expect(screen.getByRole("button", { name: "Retry failed comparisons" })).toBeInTheDocument();
  });

  it("retains the last valid comparison as stale when a refresh fails", async () => {
    tauriApi.dartBuoyRmse.mockResolvedValue(comparisonResult());
    const { rerender } = render(
      <DartOverlay
        presetId="tohoku_2011"
        timeS={0}
        sweSnapshots={[snapshotAt(0, 0.1), snapshotAt(3600, 0.2)]}
      />,
    );
    expect(await screen.findAllByText(/RMSE 0\.42 m/)).toHaveLength(3);

    tauriApi.dartBuoyRmse.mockRejectedValue(new Error("refresh failed"));
    rerender(
      <DartOverlay
        presetId="tohoku_2011"
        timeS={0}
        sweSnapshots={[snapshotAt(0, 0.15), snapshotAt(3600, 0.25)]}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/Showing the last valid DART comparison/);
    expect(screen.getAllByText(/RMSE 0\.42 m/)).toHaveLength(3);
  });
});
