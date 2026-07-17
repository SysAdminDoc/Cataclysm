import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  desktop: true,
  save: vi.fn(),
  copy: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: mocks.save }));
vi.mock("../tauri", () => ({
  isTauri: () => mocks.desktop,
  api: { saveScientificExport: mocks.copy },
}));

import { exportScientificNetcdf, exportScientificZarr } from "../scientific-export";

const descriptor = {
  export_id: "a".repeat(32),
  suggested_filename: "cataclysm-run-1.nc",
  bytes: 4096,
  format: "NetCDF-3 Classic" as const,
  conventions: "CF-1.12" as const,
  zarr: {
    suggested_directory: "cataclysm-run-1.zarr",
    bytes: 8192,
    files: 18,
    format: "Zarr v3" as const,
    conventions: "Zarr 3.1 + CF-1.12 metadata" as const,
  },
  zarr_error: null,
};

describe("exportScientificNetcdf", () => {
  beforeEach(() => {
    mocks.desktop = true;
    mocks.save.mockReset();
    mocks.copy.mockReset();
  });

  it("copies an opaque cached artifact to the user-selected NetCDF path", async () => {
    mocks.save.mockResolvedValue("C:\\Exports\\run.nc");
    mocks.copy.mockResolvedValue(4096);

    await expect(exportScientificNetcdf(descriptor)).resolves.toEqual({
      ok: true,
      bytes: 4096,
      destination: "C:\\Exports\\run.nc",
    });
    expect(mocks.save).toHaveBeenCalledWith({
      defaultPath: "cataclysm-run-1.nc",
      filters: [{ name: "CF-NetCDF", extensions: ["nc"] }],
    });
    expect(mocks.copy).toHaveBeenCalledWith("a".repeat(32), "C:\\Exports\\run.nc", "netcdf");
  });

  it("does not invoke IPC when the save dialog is cancelled", async () => {
    mocks.save.mockResolvedValue(null);
    await expect(exportScientificNetcdf(descriptor)).resolves.toMatchObject({
      ok: false,
      code: "cancelled",
    });
    expect(mocks.copy).not.toHaveBeenCalled();
  });

  it("fails closed in browser preview", async () => {
    mocks.desktop = false;
    await expect(exportScientificNetcdf(descriptor)).resolves.toMatchObject({
      ok: false,
      code: "data",
      retryable: false,
    });
    expect(mocks.save).not.toHaveBeenCalled();
  });
});

describe("exportScientificZarr", () => {
  beforeEach(() => {
    mocks.desktop = true;
    mocks.save.mockReset();
    mocks.copy.mockReset();
  });

  it("copies the cached store to a new user-selected Zarr directory", async () => {
    mocks.save.mockResolvedValue("C:\\Exports\\run.zarr");
    mocks.copy.mockResolvedValue(8192);

    await expect(exportScientificZarr(descriptor)).resolves.toEqual({
      ok: true,
      bytes: 8192,
      destination: "C:\\Exports\\run.zarr",
    });
    expect(mocks.save).toHaveBeenCalledWith({
      defaultPath: "cataclysm-run-1.zarr",
      filters: [{ name: "Zarr v3 store", extensions: ["zarr"] }],
    });
    expect(mocks.copy).toHaveBeenCalledWith("a".repeat(32), "C:\\Exports\\run.zarr", "zarr");
  });

  it("fails before opening a dialog when the companion store is unavailable", async () => {
    await expect(exportScientificZarr({
      ...descriptor,
      zarr: null,
      zarr_error: "Zarr generation failed safely.",
    })).resolves.toMatchObject({
      ok: false,
      code: "data",
      message: "Zarr generation failed safely.",
    });
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
