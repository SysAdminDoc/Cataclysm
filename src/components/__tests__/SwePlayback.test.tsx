import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SwePlayback } from "../SwePlayback";
import type { GridSnapshot, InitialDisplacement } from "../../types/scenario";
import { IDEALIZED_SEA_SURFACE_HEIGHT_FIELD } from "../../lib/geodesy";

const tauriApi = vi.hoisted(() => ({
  simulateGridStreaming: vi.fn(),
  cancelSimulation: vi.fn(),
  listImportedBathymetry: vi.fn(),
}));
const exportApi = vi.hoisted(() => ({
  exportGaugeCsv: vi.fn(),
  exportFailureLabel: vi.fn((code: string) => code),
}));

vi.mock("../../lib/tauri", () => ({
  api: tauriApi,
  createSimulationRunId: () => "run-test",
  isTauri: () => true,
}));
vi.mock("../../lib/settings", () => ({
  settings: { getColormap: () => Promise.resolve("diverging") },
}));
vi.mock("../../lib/export", () => exportApi);

const INITIAL: InitialDisplacement = {
  center: { lat_deg: 0, lon_deg: 0, depth_m: 4000 },
  cavity_radius_m: 10_000,
  peak_amplitude_m: 4,
  source_energy_j: 1e16,
  seismic_mw_equivalent: 6,
  label: "Test source",
  source_geometry: {
    kind: "cavity_ring",
    rim_radius_m: 10_000,
    rim_width_m: 2_000,
  },
};

const SNAPSHOTS: GridSnapshot[] = [
  {
    time_s: 0,
    bbox: [-1, -1, 1, 1],
    nx: 2,
    ny: 2,
    height_field: IDEALIZED_SEA_SURFACE_HEIGHT_FIELD,
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
    height_field: IDEALIZED_SEA_SURFACE_HEIGHT_FIELD,
    eta_min_m: -2,
    eta_max_m: 2,
    eta_abs_max_m: 2,
    eta_png_b64: "b",
  },
];

const RUN_QUALITY = {
  status: "pass" as const,
  finite_fields: true,
  minimum_total_depth_m: 1,
  cfl_number: 0.8,
  cfl_margin: 0.2,
  accepted_steps: 30,
  rejected_steps: 0,
  mass_drift_pct: 0.1,
  energy_drift_pct: -0.2,
  sponge_width_cells: 10,
  warnings: [],
  failure: null,
};

describe("SwePlayback", () => {
  beforeEach(() => {
    localStorage.clear();
    tauriApi.simulateGridStreaming.mockReset();
    tauriApi.cancelSimulation.mockReset();
    tauriApi.cancelSimulation.mockResolvedValue(undefined);
    tauriApi.listImportedBathymetry.mockReset();
    tauriApi.listImportedBathymetry.mockResolvedValue([]);
    exportApi.exportGaugeCsv.mockReset();
    exportApi.exportGaugeCsv.mockReturnValue({ ok: true });
  });

  it("describes the actual default grid resolution", () => {
    render(<SwePlayback initial={INITIAL} />);
    expect(screen.getByLabelText("Grid resolution in cells per degree")).toHaveAttribute(
      "title",
      "Higher resolution is more accurate but slower. Default is 8.",
    );
  });

  it("threads a selected content-addressed bathymetry asset into the solver request", async () => {
    const assetId = `local-bathymetry-${"b".repeat(64)}`;
    tauriApi.listImportedBathymetry.mockResolvedValue([{
      asset_id: assetId,
      report: {
        file_name: "coastal-depth.tif",
        source_label: "Harbor survey",
        sha256: "b".repeat(64),
      },
    }]);
    tauriApi.simulateGridStreaming.mockResolvedValue({
      dt_s: 2,
      nx: 2,
      ny: 2,
      used_gpu: false,
      n_snapshots: 0,
      cancelled: false,
      run_quality: RUN_QUALITY,
    });
    const user = userEvent.setup();
    render(<SwePlayback initial={INITIAL} />);

    const source = await screen.findByRole("combobox", { name: "Bathymetry source" });
    await user.selectOptions(source, assetId);
    expect(screen.getByRole("note")).toHaveTextContent(/bilinear solver-grid resampling/i);
    await user.click(screen.getByRole("button", { name: "Run simulation" }));

    expect(tauriApi.simulateGridStreaming).toHaveBeenCalledWith(
      "run-test",
      expect.objectContaining({
        use_real_bathymetry: true,
        bathymetry_asset_id: assetId,
      }),
      expect.any(Function),
      expect.any(Function),
    );
  });

  it("streams progress and hands snapshots to the parent", async () => {
    let pushSnapshot: ((snap: GridSnapshot) => void) | null = null;
    let finish:
      | ((meta: { dt_s: number; nx: number; ny: number; used_gpu: boolean; n_snapshots: number; cancelled: boolean; run_quality: typeof RUN_QUALITY }) => void)
      | null = null;
    tauriApi.simulateGridStreaming.mockImplementation(async (_runId, _req, onSnapshot) => {
      pushSnapshot = onSnapshot;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const onSnapshot = vi.fn();
    const onSnapshotsReady = vi.fn();
    const user = userEvent.setup();
    render(<SwePlayback initial={INITIAL} onSnapshot={onSnapshot} onSnapshotsReady={onSnapshotsReady} />);

    expect(screen.getByText("Use spatially varying ocean depths")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/Low confidence/i);
    expect(screen.getByRole("note")).toHaveTextContent(/GEBCO_2026\/TID-backed terrain/i);

    await user.click(screen.getByRole("button", { name: "Run simulation" }));
    await screen.findByRole("button", { name: "Cancel" });
    await waitFor(() => expect(pushSnapshot).not.toBeNull());
    expect(tauriApi.simulateGridStreaming).toHaveBeenCalledWith(
      "run-test",
      expect.objectContaining({ source_geometry: INITIAL.source_geometry }),
      expect.any(Function),
      expect.any(Function),
    );

    act(() => {
      pushSnapshot?.(SNAPSHOTS[0]);
    });
    expect(await screen.findByText("Streaming frame 1 / 60")).toBeInTheDocument();
    expect(onSnapshot).toHaveBeenCalledWith(SNAPSHOTS[0]);

    act(() => {
      pushSnapshot?.(SNAPSHOTS[1]);
      finish?.({ dt_s: 2, nx: 2, ny: 2, used_gpu: false, n_snapshots: 2, cancelled: false, run_quality: RUN_QUALITY });
    });

    expect(await screen.findByText(/Frame\s+1\/2/i)).toBeInTheDocument();
    expect(screen.getByText(/grid\s+2.2/i)).toBeInTheDocument();
    await waitFor(() => expect(onSnapshotsReady).toHaveBeenCalledWith(SNAPSHOTS));
  });

  it("cancels an in-flight streaming run and ignores late frames", async () => {
    let pushSnapshot: ((snap: GridSnapshot) => void) | null = null;
    tauriApi.simulateGridStreaming.mockImplementation(async (_runId, _req, onSnapshot) => {
      pushSnapshot = onSnapshot;
      return new Promise(() => {});
    });
    const onSnapshot = vi.fn();
    const user = userEvent.setup();
    render(<SwePlayback initial={INITIAL} onSnapshot={onSnapshot} />);

    await user.click(screen.getByRole("button", { name: "Run simulation" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(tauriApi.cancelSimulation).toHaveBeenCalledWith("run-test");
    expect(screen.getByRole("button", { name: "Run simulation" })).toBeInTheDocument();

    act(() => {
      pushSnapshot?.(SNAPSHOTS[0]);
    });
    expect(onSnapshot).not.toHaveBeenCalledWith(SNAPSHOTS[0]);
  });

  it("requests backend gauge samples and exports sampled series", async () => {
    let pushSnapshot: ((snap: GridSnapshot) => void) | null = null;
    let finish:
      | ((meta: { dt_s: number; nx: number; ny: number; used_gpu: boolean; n_snapshots: number; cancelled: boolean; run_quality: typeof RUN_QUALITY }) => void)
      | null = null;
    tauriApi.simulateGridStreaming.mockImplementation(async (_runId, _req, onSnapshot) => {
      pushSnapshot = onSnapshot;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const user = userEvent.setup();
    render(<SwePlayback initial={INITIAL} />);

    await user.type(screen.getByLabelText("Gauge name"), "Harbor");
    await user.type(screen.getByLabelText("Gauge latitude"), "0.25");
    await user.type(screen.getByLabelText("Gauge longitude"), "0.5");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(screen.getByRole("button", { name: "Run simulation" }));

    expect(tauriApi.simulateGridStreaming).toHaveBeenCalledWith(
      "run-test",
      expect.objectContaining({
        gauge_points: [{ id: "gauge-1", lat_deg: 0.25, lon_deg: 0.5 }],
      }),
      expect.any(Function),
      expect.any(Function),
    );

    act(() => {
      pushSnapshot?.({
        ...SNAPSHOTS[0],
        gauge_samples: [{ id: "gauge-1", eta_m: 0.125 }],
      });
      pushSnapshot?.({
        ...SNAPSHOTS[1],
        gauge_samples: [{ id: "gauge-1", eta_m: 0.25 }],
      });
      finish?.({ dt_s: 2, nx: 2, ny: 2, used_gpu: false, n_snapshots: 2, cancelled: false, run_quality: RUN_QUALITY });
    });

    const semanticSummary = await screen.findByText(
      /Harbor has 2 Rust SWE solver gauge_samples samples/,
      { selector: ".chart-data__summary" },
    );
    expect(semanticSummary).toHaveAttribute("aria-live", "off");
    expect(screen.getByRole("img", { name: "Harbor gauge eta time series" })).toHaveAttribute(
      "aria-describedby",
      semanticSummary.id,
    );
    await user.click(screen.getByText(/View Harbor gauge data/));
    const gaugeTable = screen.getByRole("region", { name: "Harbor gauge data table" });
    expect(gaugeTable).toHaveAttribute("tabindex", "0");
    expect(within(gaugeTable).getByRole("rowheader", { name: "Still-water datum" })).toBeInTheDocument();
    expect(within(gaugeTable).getByText(/Nearest active timeline selection/)).toBeInTheDocument();

    exportApi.exportGaugeCsv
      .mockReturnValueOnce({ ok: false, code: "download", message: "downloads denied", retryable: true })
      .mockReturnValue({ ok: true });
    await user.click(await screen.findByRole("button", { name: "Export gauges CSV" }));
    expect(exportApi.exportGaugeCsv).toHaveBeenCalledWith(
      [
        {
          gauge: { id: "gauge-1", name: "Harbor", lat_deg: 0.25, lon_deg: 0.5 },
          samples: [
            { time_s: 0, eta_m: 0.125 },
            { time_s: 60, eta_m: 0.25 },
          ],
        },
      ],
      "Backend SWE solver",
      "Coarse basin/shelf",
      RUN_QUALITY,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("download: downloads denied");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(exportApi.exportGaugeCsv).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("explains invalid gauge coordinates and accepts inclusive boundaries", async () => {
    const user = userEvent.setup();
    render(<SwePlayback initial={INITIAL} />);
    const latitude = screen.getByLabelText("Gauge latitude");
    const longitude = screen.getByLabelText("Gauge longitude");
    const add = screen.getByRole("button", { name: "Add" });

    await user.type(latitude, "91");
    await user.type(longitude, "181");
    expect(latitude).toHaveAttribute("aria-invalid", "true");
    expect(longitude).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Latitude must be between -90 and 90.")).toHaveAttribute("role", "alert");
    expect(screen.getByText("Longitude must be between -180 and 180.")).toHaveAttribute("role", "alert");
    expect(add).toBeDisabled();

    await user.clear(latitude);
    await user.type(latitude, "-90");
    await user.clear(longitude);
    await user.type(longitude, "180");
    expect(latitude).toHaveAttribute("aria-invalid", "false");
    expect(longitude).toHaveAttribute("aria-invalid", "false");
    expect(add).toBeEnabled();
    await user.click(add);
    expect(screen.getByText("Gauge 1")).toBeInTheDocument();
  });

  it("keeps completed output when an equivalent source object is supplied", async () => {
    tauriApi.simulateGridStreaming.mockImplementation(async (_runId, _req, onSnapshot) => {
      onSnapshot(SNAPSHOTS[0]);
      onSnapshot(SNAPSHOTS[1]);
      return { dt_s: 2, nx: 2, ny: 2, used_gpu: false, n_snapshots: 2, cancelled: false, run_quality: RUN_QUALITY };
    });
    const user = userEvent.setup();
    const { rerender } = render(<SwePlayback initial={INITIAL} />);

    await user.click(screen.getByRole("button", { name: "Run simulation" }));
    expect(await screen.findByRole("button", { name: "Re-run simulation" })).toBeInTheDocument();

    rerender(<SwePlayback initial={{ ...INITIAL, center: { ...INITIAL.center } }} />);
    expect(screen.getByRole("button", { name: "Re-run simulation" })).toBeInTheDocument();
    expect(screen.getByText(/Frame\s+1\/2/i)).toBeInTheDocument();
  });

  it("starts automatically when Run & Watch is requested", async () => {
    tauriApi.simulateGridStreaming.mockImplementation(async (_runId, _req, onSnapshot) => {
      onSnapshot(SNAPSHOTS[0]);
      onSnapshot(SNAPSHOTS[1]);
      return {
        dt_s: 2,
        nx: 2,
        ny: 2,
        used_gpu: true,
        n_snapshots: 2,
        cancelled: false,
        run_quality: RUN_QUALITY,
      };
    });

    render(<SwePlayback initial={INITIAL} runAndWatchNonce={1} playbackTimeS={0} />);

    await waitFor(() => expect(tauriApi.simulateGridStreaming).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Frame\s+1\/2/i)).toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "Simulation timeline scrubber" })).not.toBeInTheDocument();
  });

  it("preserves the source and exposes a local retry after a solver failure", async () => {
    tauriApi.simulateGridStreaming.mockRejectedValueOnce(new Error("solver unavailable"));
    const user = userEvent.setup();
    render(<SwePlayback initial={INITIAL} />);

    await user.click(screen.getByRole("button", { name: "Run simulation" }));
    expect(await screen.findByRole("button", { name: "Retry simulation" })).toBeInTheDocument();
    expect(screen.getByText("Use spatially varying ocean depths")).toBeInTheDocument();

    tauriApi.simulateGridStreaming.mockResolvedValue({
      dt_s: 2,
      nx: 2,
      ny: 2,
      used_gpu: false,
      n_snapshots: 0,
      cancelled: false,
      run_quality: RUN_QUALITY,
    });
    await user.click(screen.getByRole("button", { name: "Retry simulation" }));
    await waitFor(() => expect(tauriApi.simulateGridStreaming).toHaveBeenCalledTimes(2));
  });

  it("restores the last valid frames and marks them stale when a re-run fails", async () => {
    tauriApi.simulateGridStreaming
      .mockImplementationOnce(async (_runId, _req, onSnapshot) => {
        onSnapshot(SNAPSHOTS[0]);
        onSnapshot(SNAPSHOTS[1]);
        return {
          dt_s: 2,
          nx: 2,
          ny: 2,
          used_gpu: false,
          n_snapshots: 2,
          cancelled: false,
          run_quality: RUN_QUALITY,
        };
      })
      .mockRejectedValueOnce(new Error("refresh failed"));
    const user = userEvent.setup();
    render(<SwePlayback initial={INITIAL} />);

    await user.click(screen.getByRole("button", { name: "Run simulation" }));
    expect(await screen.findByText(/Frame\s+1\/2/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Re-run simulation" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/showing the last valid run/i);
    expect(screen.getByText(/Frame\s+1\/2/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry simulation" })).toBeInTheDocument();
  });
});
