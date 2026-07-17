import { save } from "@tauri-apps/plugin-dialog";
import type { ScientificExportDescriptor } from "../types/scenario";
import { type ExportResult } from "./export";
import { api, isTauri } from "./tauri";

export async function exportScientificNetcdf(
  descriptor: ScientificExportDescriptor,
): Promise<ExportResult<{ bytes: number; destination: string }>> {
  if (!isTauri()) {
    return {
      ok: false,
      code: "data",
      message: "CF-NetCDF export is available in the desktop app after a completed SWE run.",
      retryable: false,
    };
  }
  try {
    const destination = await save({
      defaultPath: descriptor.suggested_filename,
      filters: [{ name: "CF-NetCDF", extensions: ["nc"] }],
    });
    if (!destination) {
      return {
        ok: false,
        code: "cancelled",
        message: "NetCDF export was cancelled.",
        retryable: true,
      };
    }
    const bytes = await api.saveScientificExport(descriptor.export_id, destination, "netcdf");
    return { ok: true, bytes, destination };
  } catch (error) {
    console.error("[export] CF-NetCDF export failed", error);
    return {
      ok: false,
      code: "filesystem",
      message: `CF-NetCDF export failed: ${error instanceof Error ? error.message : String(error)}`,
      retryable: true,
    };
  }
}

export async function exportScientificZarr(
  descriptor: ScientificExportDescriptor,
): Promise<ExportResult<{ bytes: number; destination: string }>> {
  if (!isTauri()) {
    return {
      ok: false,
      code: "data",
      message: "Zarr export is available in the desktop app after a completed SWE run.",
      retryable: false,
    };
  }
  if (!descriptor.zarr) {
    return {
      ok: false,
      code: "data",
      message: descriptor.zarr_error ?? "This run does not have a Zarr export. Rerun the SWE solver.",
      retryable: true,
    };
  }
  try {
    const destination = await save({
      defaultPath: descriptor.zarr.suggested_directory,
      filters: [{ name: "Zarr v3 store", extensions: ["zarr"] }],
    });
    if (!destination) {
      return {
        ok: false,
        code: "cancelled",
        message: "Zarr export was cancelled.",
        retryable: true,
      };
    }
    const bytes = await api.saveScientificExport(descriptor.export_id, destination, "zarr");
    return { ok: true, bytes, destination };
  } catch (error) {
    console.error("[export] Zarr export failed", error);
    return {
      ok: false,
      code: "filesystem",
      message: `Zarr export failed: ${error instanceof Error ? error.message : String(error)}`,
      retryable: true,
    };
  }
}
