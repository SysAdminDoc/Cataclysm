import type { InitialDisplacement, Preset } from "../types/scenario";
import { buildModelProvenance, provenanceSummary, type ModelProvenanceInput } from "./model-provenance";
import {
  downloadBlob,
  preflightRunQuality,
  safeFilenamePart,
  type ExportResult,
} from "./export";
import { buildCoastalOutcomeStory, formatOutcomeTime } from "./result-story";
import type { RunupAtPointResult } from "./tauri";
import {
  formatDepth,
  formatEnergy as formatDisplayEnergy,
  formatLength,
  quantityText,
} from "./units";

export type TextExportData = ModelProvenanceInput & {
  preset?: Preset | null;
  initial?: InitialDisplacement | null;
  timeS: number;
  runupResults?: RunupAtPointResult[];
  sourceKind?: "Asteroid" | "Nuclear" | "Earthquake" | "Landslide" | "Meteotsunami" | null;
};

export function generateTextExport(data: TextExportData): string {
  const lines: string[] = [];
  const unitSystem = data.unitSystem ?? "metric";
  const formatNumber = (value: number, options?: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat("en-US", options).format(value);
  const length = (meters: number) => quantityText(formatLength(meters, formatNumber, unitSystem));
  const depth = (meters: number) => quantityText(formatDepth(meters, formatNumber, unitSystem));
  lines.push("Cataclysm — Scenario Results Export");
  lines.push("==========================================");
  lines.push("");

  const provenance = buildModelProvenance(data);
  lines.push("Provenance");
  lines.push("----------");
  lines.push(provenanceSummary({ ...data, generatedAt: provenance.generatedAt }));
  lines.push("");

  if (data.preset) {
    lines.push(`Preset: ${data.preset.name}`);
    lines.push(`Date: ${data.preset.date}`);
    lines.push(`Reference: ${data.preset.reference}`);
    if (data.preset.is_speculative) {
      lines.push("Note: This is a speculative/controversial scenario.");
      if (data.preset.controversy_note) {
        lines.push(`  ${data.preset.controversy_note}`);
      }
    }
    lines.push("");
  }

  if (data.initial) {
    const i = data.initial;
    const story = buildCoastalOutcomeStory(data.runupResults ?? [], data.timeS);
    lines.push("Outcome Summary");
    lines.push("---------------");
    lines.push(`Maximum source displacement: ${length(i.peak_amplitude_m)}`);
    if (story.maximum && story.maximum.runup_m >= 0.1) {
      lines.push(`Maximum affected named coast: ~${length(story.maximum.runup_m)} at ${story.maximum.name} (${formatOutcomeTime(story.maximum.arrival_time_s)})`);
    }
    if (story.firstAffected) {
      lines.push(`First affected named coast: ${story.firstAffected.name} at ${formatOutcomeTime(story.firstAffected.arrival_time_s)}`);
    }
    if (story.nearest) {
      lines.push(`Nearest affected named coast: ${story.nearest.name} at ${length(story.nearest.range_m)} from source`);
    }
    if (story.reachM !== null) {
      lines.push(`Farthest affected named coast in screening set: ${length(story.reachM)}`);
    }
    lines.push(`Coastal confidence: ${story.confidence}. ${story.limitation}`);
    lines.push("Reach describes named screening points, not a continuous inundation footprint.");
    lines.push("");

    lines.push("Source Parameters");
    lines.push("-----------------");
    lines.push(`Label: ${i.label}`);
    const ns = i.center.lat_deg >= 0 ? "N" : "S";
    const ew = i.center.lon_deg >= 0 ? "E" : "W";
    lines.push(`Location: ${Math.abs(i.center.lat_deg).toFixed(4)}° ${ns}, ${Math.abs(i.center.lon_deg).toFixed(4)}° ${ew}`);
    if (i.center.depth_m !== undefined) {
      lines.push(`Water depth: ${depth(i.center.depth_m)}`);
    }
    lines.push(`Peak amplitude: ${length(i.peak_amplitude_m)}`);
    const radiusLabel = data.sourceKind === "Earthquake" || data.sourceKind === "Landslide"
      ? "Source region radius"
      : "Cavity radius";
    lines.push(`${radiusLabel}: ${length(i.cavity_radius_m)}`);
    const energy = formatDisplayEnergy(i.source_energy_j, formatNumber, unitSystem);
    lines.push(`Source energy: ${quantityText(energy)}${energy.anchor ? ` (${energy.anchor})` : ""}`);
    lines.push(`Seismic equivalent: Mw ${i.seismic_mw_equivalent.toFixed(1)}`);
    if (i.dominant_wavelength_m) {
      lines.push(`Dominant wavelength: ${length(i.dominant_wavelength_m)}`);
    }
    lines.push("");
  }

  lines.push(`Simulation time: ${(data.timeS / 60).toFixed(0)} minutes`);
  lines.push("");

  if (data.runupResults && data.runupResults.length > 0) {
    lines.push("Coastal Runup Results");
    lines.push("---------------------");
    lines.push(
      padRow(["Location", "Lat", "Lon", "Runup", "Offshore", "Arrival", "Status"]),
    );
    lines.push("-".repeat(100));

    const sorted = [...data.runupResults].sort((a, b) => b.runup_m - a.runup_m);
    for (const r of sorted) {
      const arrivalMin = r.arrival_time_s / 60;
      const arrival = !Number.isFinite(arrivalMin)
        ? "—"
        : arrivalMin < 60
          ? `T+${arrivalMin.toFixed(0)}m`
          : `T+${Math.floor(arrivalMin / 60)}h${String(Math.round(arrivalMin % 60)).padStart(2, "0")}`;
      lines.push(
        padRow([
          r.name,
          r.lat.toFixed(2),
          r.lon.toFixed(2),
          r.has_arrived ? length(r.runup_m) : "—",
          Number.isFinite(r.offshore_amplitude_m) ? length(r.offshore_amplitude_m) : "—",
          arrival,
          r.has_arrived ? "Arrived" : "In transit",
        ]),
      );
    }
    lines.push("");
    lines.push("Coastal Input Provenance");
    lines.push("------------------------");
    for (const r of sorted) {
      lines.push(`${r.name} [${r.quantitative_label}; ${r.quantitative_confidence} confidence]`);
      lines.push(`  Slope ${r.beach_slope_deg} deg: ${r.slope_provenance.sample_id} / ${r.slope_provenance.record_id}`);
      lines.push(`    ${r.slope_provenance.source}; ${r.slope_provenance.method}; ${r.slope_provenance.datum}; ${r.slope_provenance.resolution}; ${r.slope_provenance.observed_or_published}; uncertainty ${r.slope_provenance.uncertainty_value ?? "unknown"} ${r.slope_provenance.uncertainty_unit}`);
      lines.push(`  Depth ${depth(r.offshore_depth_m)}: ${r.depth_provenance.sample_id} / ${r.depth_provenance.record_id}`);
      lines.push(`    ${r.depth_provenance.source}; ${r.depth_provenance.method}; ${r.depth_provenance.datum}; ${r.depth_provenance.resolution}; ${r.depth_provenance.observed_or_published}; uncertainty ${r.depth_provenance.uncertainty_value ?? "unknown"} ${r.depth_provenance.uncertainty_unit}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("Educational only — not for evacuation planning.");
  lines.push("Generated by Cataclysm (github.com/SysAdminDoc/Cataclysm)");

  return lines.join("\n");
}

function padRow(cols: string[]): string {
  const widths = [24, 8, 8, 10, 14, 10, 10];
  return cols.map((c, i) => c.padEnd(widths[i] ?? 10)).join("  ");
}

export function downloadTextExport(data: TextExportData): ExportResult {
  const quality = preflightRunQuality(data);
  if (!quality.ok) {
    return { ok: false, code: "preflight", message: quality.reason, retryable: false };
  }
  try {
    const text = generateTextExport(data);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const presetId = safeFilenamePart(data.preset?.id ?? "custom-scenario");
    return downloadBlob(blob, `cataclysm-${presetId}-results.txt`);
  } catch (error) {
    console.error("[export] Text serialization failed", error);
    return {
      ok: false,
      code: "data",
      message: `Text serialization failed: ${error instanceof Error ? error.message : String(error)}`,
      retryable: true,
    };
  }
}
