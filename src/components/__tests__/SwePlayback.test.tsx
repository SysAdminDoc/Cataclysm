import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SwePlayback } from "../SwePlayback";
import type { GridSnapshot, InitialDisplacement } from "../../types/scenario";
import { IDEALIZED_SEA_SURFACE_HEIGHT_FIELD } from "../../lib/geodesy";
import { I18nProvider } from "../../lib/i18n";
import type { PortableJson } from "../../lib/portable-scenario-package";

const tauriApi = vi.hoisted(() => ({
  simulateGridStreaming: vi.fn(),
  simulateSensitivityEnsemble: vi.fn(),
  preflightSimulationResolution: vi.fn(),
  cancelSimulation: vi.fn(),
  listImportedBathymetry: vi.fn(),
  listSolverCheckpoints: vi.fn(),
  removeSolverCheckpoint: vi.fn(),
}));
const exportApi = vi.hoisted(() => ({
  exportGaugeCsv: vi.fn(),
  exportFailureLabel: vi.fn((code: string) => code),
  downloadBlob: vi.fn(() => ({ ok: true })),
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

const RESOLUTION_PREFLIGHT = {
  schema_version: 1,
  requested_cells_per_deg: 8,
  recommended_cells_per_deg: 20,
  selected_cells_per_deg: 8,
  simple_auto_selected: false,
  advanced_override: true,
  dx_m: 13_899,
  dy_m: 13_899,
  estimated_dt_s: 8.9,
  nx: 128,
  ny: 128,
  estimated_steps: 405,
  estimated_cell_steps: 6_635_520,
  estimated_memory_bytes: 2_490_368,
  estimated_runtime_s: 0.4,
  features: [{ id: "cavity_rim_width", size_m: 2_000, cells_across: 0.14 }],
  shortest_feature_id: "cavity_rim_width",
  minimum_cells_across_feature: 0.14,
  numerical_grade: "under_resolved" as const,
  limitations: ["not operational"],
};

describe("SwePlayback", () => {
  beforeEach(() => {
    localStorage.clear();
    tauriApi.simulateGridStreaming.mockReset();
    tauriApi.simulateSensitivityEnsemble.mockReset();
    tauriApi.preflightSimulationResolution.mockReset();
    tauriApi.preflightSimulationResolution.mockResolvedValue(RESOLUTION_PREFLIGHT);
    tauriApi.cancelSimulation.mockReset();
    tauriApi.cancelSimulation.mockResolvedValue(undefined);
    tauriApi.listImportedBathymetry.mockReset();
    tauriApi.listImportedBathymetry.mockResolvedValue([]);
    tauriApi.listSolverCheckpoints.mockReset();
    tauriApi.listSolverCheckpoints.mockResolvedValue([]);
    tauriApi.removeSolverCheckpoint.mockReset();
    tauriApi.removeSolverCheckpoint.mockResolvedValue(true);
    exportApi.exportGaugeCsv.mockReset();
    exportApi.exportGaugeCsv.mockReturnValue({ ok: true });
    exportApi.downloadBlob.mockReset();
    exportApi.downloadBlob.mockReturnValue({ ok: true });
  });

  it("describes the actual default grid resolution", () => {
    render(<SwePlayback initial={INITIAL} />);
    expect(screen.getByLabelText("Grid resolution in cells per degree")).toHaveAttribute(
      "title",
      "Higher resolution is more accurate but slower. Default is 8.",
    );
  });

  it("shows physical adequacy and preserves an advanced override warning", async () => {
    render(<SwePlayback initial={INITIAL} workspaceMode="advanced" />);

    expect(await screen.findByText("Resolution preflight · under-resolved")).toBeInTheDocument();
    expect(screen.getByText("Physical spacing: 13.9 km east–west × 13.9 km north–south · estimated timestep 8.9 s")).toBeInTheDocument();
    expect(screen.getByText("Shortest feature: cavity rim width · 0.1 cells across")).toBeInTheDocument();
    expect(screen.getByText("Advanced resolution override — results and scientific exports retain this warning.")).toBeInTheDocument();
    expect(screen.getByText(/not a forecast or operational-fitness grade/)).toBeInTheDocument();
    expect(tauriApi.preflightSimulationResolution).toHaveBeenCalledWith(
      expect.objectContaining({ resolution_mode: "advanced", cells_per_deg: 8 }),
    );
  });

  it("localizes advanced solver, recovery, bathymetry, and gauge controls", async () => {
    localStorage.setItem("tsunamisim.locale", JSON.stringify("ja"));
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <SwePlayback initial={INITIAL} workspaceMode="advanced" />
      </I18nProvider>,
    );

    expect(screen.getByText("波動伝播")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "シミュレーションを実行" })).toBeEnabled();
    expect(screen.getByText("空間変化する海洋水深を使用")).toBeInTheDocument();
    expect(screen.getByLabelText("1度あたりの格子セル数")).toHaveAttribute(
      "title",
      "解像度を上げると精度が向上しますが、計算は遅くなります。既定値は8です。",
    );
    await user.type(screen.getByLabelText("観測点の緯度"), "91");
    expect(screen.getByText("緯度は-90から90の範囲で入力してください。")).toHaveAttribute("role", "alert");
  });

  it("runs and exports a deterministic sensitivity envelope with cited bounds", async () => {
    tauriApi.simulateSensitivityEnsemble.mockResolvedValue({
      schema_version: 1,
      run_id: "run-test",
      product: "sensitivity_envelope_not_probability_or_forecast",
      seed: 42,
      requested_sample_count: 9,
      completed_members: 8,
      failed_members: 1,
      cancelled_members: 0,
      parameters: [],
      members: [
        { index: 0, parameters: [{ id: "initial_amplitude", factor: 0.82 }], status: "completed", metrics: { peak_elevation_m: 1, arrival_s: 120, runup_m: null }, used_gpu: false, error: null },
        { index: 1, parameters: [{ id: "initial_amplitude", factor: 0.87 }], status: "failed", metrics: { peak_elevation_m: null, arrival_s: null, runup_m: null }, used_gpu: false, error: "quality gate" },
      ],
      peak_elevation_m: { p05: 1, p50: 2, p95: 3, valid_samples: 8 },
      arrival_s: { p05: 100, p50: 120, p95: 150, valid_samples: 8 },
      runup_m: { p05: null, p50: null, p95: null, valid_samples: 0 },
      direct_effects: { applicable: false, reason: "Direct effects are outside this SWE run." },
      resolution_preflight: RESOLUTION_PREFLIGHT,
      caveats: ["This is a sensitivity envelope, not probability or forecast."],
    });
    const user = userEvent.setup();
    const onSensitivityEnvelopeChange = vi.fn();
    render(
      <SwePlayback
        initial={INITIAL}
        workspaceMode="advanced"
        onSensitivityEnvelopeChange={onSensitivityEnvelopeChange}
      />,
    );

    await user.click(screen.getByText("Sensitivity envelope"));
    expect(screen.getByText(/not probability or forecast/i)).toBeInTheDocument();
    expect(screen.getByText("USGS ShakeMap uncertainty")).toHaveAttribute(
      "href",
      "https://www.usgs.gov/publications/quantifying-and-qualifying-usgs-shakemap-uncertainty",
    );
    expect(screen.getByLabelText("Mean water depth")).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Run sensitivity envelope" }));
    await waitFor(() => expect(tauriApi.simulateSensitivityEnsemble).toHaveBeenCalledWith(
      "run-test",
      expect.objectContaining({
        sample_count: 9,
        seed: 42,
        parameters: [expect.objectContaining({
          id: "initial_amplitude",
          lower_factor: 0.8,
          upper_factor: 1.2,
          citation_url: expect.stringContaining("usgs.gov"),
        })],
      }),
    ));
    expect(await screen.findByText("8 completed · 1 failed · 0 cancelled")).toBeInTheDocument();
    expect(onSensitivityEnvelopeChange).toHaveBeenLastCalledWith(expect.objectContaining({
      arrival_s: { p05: 100, p50: 120, p95: 150, valid_samples: 8 },
    }));
    expect(screen.getByText("Resolved nearshore peak / runup proxy")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);

    await user.click(screen.getByRole("button", { name: "Export ensemble JSON" }));
    expect(exportApi.downloadBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      "cataclysm-sensitivity-envelope-seed-42.json",
    );
  });

  it("publishes and restores portable solver settings without starting a run", async () => {
    const onPortableSettingsChange = vi.fn();
    const onSnapshotsReady = vi.fn();
    const onSnapshot = vi.fn();
    const onRunQuality = vi.fn();
    const { rerender } = render(
      <SwePlayback
        initial={INITIAL}
        workspaceMode="advanced"
        onPortableSettingsChange={onPortableSettingsChange}
        onSnapshotsReady={onSnapshotsReady}
        onSnapshot={onSnapshot}
        onRunQuality={onRunQuality}
      />,
    );
    await waitFor(() => expect(onPortableSettingsChange).toHaveBeenCalledWith(expect.objectContaining({
      schema_version: 1,
      cells_per_degree: 8,
      boundary_mode: "sponge",
      frame_count: 60,
    })));

    rerender(
      <SwePlayback
        initial={INITIAL}
        workspaceMode="advanced"
        onPortableSettingsChange={onPortableSettingsChange}
        onSnapshotsReady={onSnapshotsReady}
        onSnapshot={onSnapshot}
        onRunQuality={onRunQuality}
        portableSettingsImport={{
          id: 1,
          settings: {
            schema_version: 1,
            use_spatial_bathymetry: false,
            bathymetry_asset_id: null,
            cells_per_degree: 11,
            resolution_mode: "advanced",
            duration_s: 3600,
            frame_count: 60,
            include_lamb_wave: true,
            boundary_mode: "radiation",
            checkpoint_interval_s: 300,
          },
        }}
        portableResultsImport={{
          id: 1,
          results: {
            schema_version: 1,
            snapshots: SNAPSHOTS,
            max_field: null,
            gauges: [],
            run_quality: RUN_QUALITY,
            isochrones: [],
          } as unknown as PortableJson,
        }}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText("Grid resolution in cells per degree")).toHaveValue("11"));
    expect(screen.getByLabelText("Boundary condition")).toHaveValue("radiation");
    expect(screen.getByLabelText("Recovery checkpoint cadence")).toHaveValue("300");
    expect(screen.getByRole("checkbox", { name: "Include atmospheric pressure wave" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Use spatially varying ocean depths" })).not.toBeChecked();
    await waitFor(() => expect(onSnapshotsReady).toHaveBeenLastCalledWith(SNAPSHOTS));
    expect(onSnapshot).toHaveBeenLastCalledWith(SNAPSHOTS[0]);
    expect(onRunQuality).toHaveBeenLastCalledWith(RUN_QUALITY);
    expect(tauriApi.simulateGridStreaming).not.toHaveBeenCalled();
  });

  it("threads the selected recovery checkpoint cadence into streaming", async () => {
    tauriApi.simulateGridStreaming.mockResolvedValue({
      dt_s: 2,
      nx: 2,
      ny: 2,
      used_gpu: false,
      n_snapshots: 0,
      cancelled: false,
      run_quality: RUN_QUALITY,
      recovered_gauge_history: [],
    });
    const user = userEvent.setup();
    render(<SwePlayback initial={INITIAL} />);

    await user.selectOptions(screen.getByLabelText("Recovery checkpoint cadence"), "300");
    await user.click(screen.getByRole("button", { name: "Run simulation" }));

    expect(tauriApi.simulateGridStreaming).toHaveBeenCalledWith(
      "run-test",
      expect.any(Object),
      expect.any(Function),
      expect.any(Function),
      null,
      300,
    );
  });

  it("renders every extended max-field overlay without exposing grid arrays", async () => {
    tauriApi.simulateGridStreaming.mockImplementation(async (_runId, _req, onSnapshot) => {
      SNAPSHOTS.forEach(onSnapshot);
      return {
        dt_s: 2,
        nx: 2,
        ny: 2,
        used_gpu: false,
        n_snapshots: SNAPSHOTS.length,
        cancelled: false,
        run_quality: RUN_QUALITY,
        resolution_preflight: RESOLUTION_PREFLIGHT,
        recovered_gauge_history: [],
        max_field: {
          bbox: [-1, -1, 1, 1],
          nx: 2,
          ny: 2,
          peak_height_field: IDEALIZED_SEA_SURFACE_HEIGHT_FIELD,
          peak_abs_max_m: 2,
          t_end_s: 60,
          arrival_threshold_m: 0.01,
          peak_png_b64: "peak-png",
          t_of_max_png_b64: "time-png",
          energy_png_b64: "energy-png",
          max_depth_png_b64: "depth-png",
          max_speed_png_b64: "speed-png",
          max_momentum_flux_png_b64: "momentum-png",
          max_drawdown_png_b64: "drawdown-png",
          t_of_max_speed_png_b64: "speed-time-png",
          isochrones: [],
        },
      };
    });
    const user = userEvent.setup();
    const onSnapshot = vi.fn();
    render(<SwePlayback initial={INITIAL} workspaceMode="advanced" onSnapshot={onSnapshot} />);

    await user.click(screen.getByRole("button", { name: "Run simulation" }));
    expect(await screen.findByRole("button", { name: "Flow depth" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Current speed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Momentum" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Drawdown" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "T speed" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Current speed" }));
    expect(onSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({
      eta_png_b64: "speed-png",
      field_tiles: undefined,
    }));
    expect(screen.getByText(/depth-averaged current speed/)).toBeInTheDocument();
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
    await within(source).findByRole("option", { name: /Harbor survey/ });
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
      null,
      60,
    );
  });

  it("streams progress and hands snapshots to the parent", async () => {
    let pushSnapshot: ((snap: GridSnapshot) => void) | null = null;
    let finish:
      | ((meta: { dt_s: number; nx: number; ny: number; used_gpu: boolean; n_snapshots: number; cancelled: boolean; run_quality: typeof RUN_QUALITY; recovered_gauge_history?: Array<{ time_s: number; gauge_samples: Array<{ id: string; eta_m: number | null }> }> }) => void)
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
      null,
      60,
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

  it("offers a retained checkpoint and threads its run ID into strict resume", async () => {
    tauriApi.listSolverCheckpoints.mockResolvedValue([{
      run_id: "interrupted-run",
      scenario_sha256: "a".repeat(64),
      solver_version: "shallow-water-solver-1.0.0",
      created_at_ms: 1,
      time_s: 900,
      t_end_s: 3_600,
      step_index: 450,
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

    await user.click(await screen.findByRole("button", { name: "Resume if compatible" }));
    expect(tauriApi.simulateGridStreaming).toHaveBeenCalledWith(
      "run-test",
      expect.any(Object),
      expect.any(Function),
      expect.any(Function),
      "interrupted-run",
      60,
    );
  });

  it("requests backend gauge samples and exports sampled series", async () => {
    let pushSnapshot: ((snap: GridSnapshot) => void) | null = null;
    let finish:
      | ((meta: { dt_s: number; nx: number; ny: number; used_gpu: boolean; n_snapshots: number; cancelled: boolean; run_quality: typeof RUN_QUALITY; recovered_gauge_history?: Array<{ time_s: number; gauge_samples: Array<{ id: string; eta_m: number | null }> }> }) => void)
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
      null,
      60,
    );

    act(() => {
      pushSnapshot?.({
        ...SNAPSHOTS[1],
        gauge_samples: [{ id: "gauge-1", eta_m: 0.25 }],
      });
      finish?.({
        dt_s: 2,
        nx: 2,
        ny: 2,
        used_gpu: false,
        n_snapshots: 2,
        cancelled: false,
        run_quality: RUN_QUALITY,
        recovered_gauge_history: [{
          time_s: 0,
          gauge_samples: [{ id: "gauge-1", eta_m: 0.125 }],
        }],
      });
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
      "metric",
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("download: downloads denied");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(exportApi.exportGaugeCsv).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("explains invalid gauge coordinates and accepts inclusive boundaries", async () => {
    const user = userEvent.setup();
    const onGaugesChange = vi.fn();
    render(<SwePlayback initial={INITIAL} onGaugesChange={onGaugesChange} />);
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
    await waitFor(() => expect(onGaugesChange).toHaveBeenLastCalledWith([
      { id: "gauge-1", name: "Gauge 1", lat_deg: -90, lon_deg: 180 },
    ]));
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
