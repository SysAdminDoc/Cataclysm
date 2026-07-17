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

import { exportScientificNetcdf } from "../scientific-export";

const descriptor = {
  export_id: "a".repeat(32),
  suggested_filename: "cataclysm-run-1.nc",
  bytes: 4096,
  format: "NetCDF-3 Classic" as const,
  conventions: "CF-1.12" as const,
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
    expect(mocks.copy).toHaveBeenCalledWith("a".repeat(32), "C:\\Exports\\run.nc");
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
