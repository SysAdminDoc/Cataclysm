import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  desktop: true,
  open: vi.fn(),
  list: vi.fn(),
  preflight: vi.fn(),
  importRaster: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("../../lib/tauri", () => ({
  isTauri: () => mocks.desktop,
  api: {
    listImportedBathymetry: mocks.list,
    preflightBathymetryImport: mocks.preflight,
    importBathymetry: mocks.importRaster,
    removeImportedBathymetry: mocks.remove,
    restoreImportedBathymetry: mocks.restore,
  },
}));

import { BathymetryImportPanel } from "../BathymetryImportPanel";

const report = {
  format: "geo_tiff" as const,
  file_name: "depth.tif",
  file_size_bytes: 4096,
  sha256: "a".repeat(64),
  source_label: "Local survey",
  rights_statement: "CC BY 4.0",
  variable: "band_1",
  width: 120,
  height: 80,
  bounds_wgs84: [-2, -1, 2, 1] as [number, number, number, number],
  resolution_deg: [0.033333, 0.025] as [number, number],
  horizontal_crs: "EPSG:4326" as const,
  vertical_datum: "EPSG:5715",
  units: "m" as const,
  sample_semantics: "depth_positive_down" as const,
  nodata: -9999,
  valid_cell_count: 9500,
  nodata_cell_count: 100,
  wet_cell_count: 9200,
  dry_cell_count: 300,
  min_depth_m: 1,
  max_depth_m: 6400,
  warnings: [],
};

const asset = {
  schema_version: 1,
  asset_id: `local-bathymetry-${report.sha256}`,
  imported_at_ms: 1_784_240_000_000,
  cache_file: `${report.sha256}.tif`,
  report,
};

describe("BathymetryImportPanel", () => {
  beforeEach(() => {
    mocks.desktop = true;
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([]);
    mocks.open.mockResolvedValue("C:\\science\\depth.tif");
    mocks.preflight.mockResolvedValue(report);
    mocks.importRaster.mockResolvedValue(asset);
    mocks.remove.mockResolvedValue(undefined);
    mocks.restore.mockResolvedValue(asset);
  });

  it("previews provenance and grid decisions before committing the selected raster", async () => {
    const user = userEvent.setup();
    render(<BathymetryImportPanel />);
    const choose = screen.getByRole("button", { name: "Choose raster" });
    await waitFor(() => expect(choose).toBeEnabled());
    await user.click(choose);
    expect(await screen.findByText("depth.tif")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Required provenance label"), "Local survey");
    await user.type(screen.getByPlaceholderText("Required license or rights statement"), "CC BY 4.0");
    const commit = screen.getByRole("button", { name: "Import verified raster" });
    expect(commit).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Preview and validate" }));

    expect(await screen.findByLabelText("Bathymetry preflight report")).toHaveTextContent("Full raster");
    expect(screen.getByLabelText("Bathymetry preflight report")).toHaveTextContent("None at import; source grid preserved");
    expect(mocks.preflight).toHaveBeenCalledWith(expect.objectContaining({
      path: "C:\\science\\depth.tif",
      source_label: "Local survey",
      rights_statement: "CC BY 4.0",
      sample_semantics: "depth_positive_down",
    }));
    expect(commit).toBeEnabled();
    await user.click(commit);

    expect(mocks.importRaster).toHaveBeenCalledWith(expect.objectContaining({ path: "C:\\science\\depth.tif" }), report.sha256);
    expect(await screen.findByText("depth.tif is cached for offline use.")).toBeInTheDocument();
    expect(screen.getByLabelText("Cached bathymetry rasters")).toHaveTextContent("Local survey");
  });

  it("removes and restores a cached raster through the recovery action", async () => {
    mocks.list.mockResolvedValue([asset]);
    const user = userEvent.setup();
    render(<BathymetryImportPanel />);
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    expect(mocks.remove).toHaveBeenCalledWith(asset.asset_id);
    expect(await screen.findByText("Bathymetry moved to the local recovery area.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo remove" }));
    expect(mocks.restore).toHaveBeenCalledWith(asset.asset_id);
    expect(await screen.findByText("depth.tif was restored.")).toBeInTheDocument();
  });

  it("keeps browser preview explicit and does not expose a nonfunctional picker", () => {
    mocks.desktop = false;
    render(<BathymetryImportPanel />);
    expect(screen.getByText(/Import is available in the desktop app/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose raster" })).not.toBeInTheDocument();
  });
});
