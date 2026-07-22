import { useState } from "react";

import { downloadBlob, exportFailureLabel, type ExportResult } from "../lib/export";
import { useI18n } from "../lib/i18n";
import type { PointProbeReport } from "../render/cesium/inspection";
import type { MaxFieldProbeResult } from "../lib/tauri";
import { useUnits } from "../hooks/useUnits";
import { formatEmbeddedLengthValues, formatLength, formatReadoutValue, formatSpeed, quantityText, type UnitSystem } from "../lib/units";

type Props = {
  primary: PointProbeReport | null;
  comparison?: PointProbeReport | null;
  maxField?: MaxFieldProbeResult | null;
  maxFieldLoading?: boolean;
  maxFieldError?: string | null;
};

type DisplayMetric = Readonly<{ label: string; value: string }>;

function csvCell(value: string | number): string {
  const text = String(value).replaceAll("\r", " ").replaceAll("\n", " ");
  return `"${text.replaceAll('"', '""')}"`;
}

function reportText(
  report: PointProbeReport,
  label: string,
  t: ReturnType<typeof useI18n>["t"],
  formatNumber: ReturnType<typeof useI18n>["formatNumber"],
  unitSystem: UnitSystem,
  extraMetrics: readonly DisplayMetric[] = [],
): string {
  return [
    label,
    t("probe.export.domain", { value: report.domain }),
    t("probe.export.coordinate", { lat: report.lat.toFixed(6), lon: report.lon.toFixed(6) }),
    t("probe.export.range", { value: quantityText(formatLength(report.rangeM, formatNumber, unitSystem)) }),
    t("probe.export.status", { value: report.status }),
    ...report.metrics.map((metric) => `${metric.label}: ${formatReadoutValue(metric.value, formatNumber, unitSystem)}`),
    ...extraMetrics.map((metric) => `${metric.label}: ${metric.value}`),
    t("probe.export.model", { value: report.governingModel }),
    t("probe.export.confidence", { value: report.confidence }),
    ...report.citations.map((citation) => t("probe.export.citation", { value: citation })),
    ...report.assumptions.map((assumption) => t("probe.export.assumption", { value: formatEmbeddedLengthValues(assumption, formatNumber, unitSystem) })),
    ...report.unknowns.map((unknown) => t("probe.export.unknown", { value: formatEmbeddedLengthValues(unknown, formatNumber, unitSystem) })),
  ].join("\n");
}

function reportCsv(
  report: PointProbeReport,
  slot: string,
  formatNumber: ReturnType<typeof useI18n>["formatNumber"],
  unitSystem: UnitSystem,
  extraMetrics: readonly DisplayMetric[] = [],
): Array<Array<string | number>> {
  const base = [slot, report.domain, report.lat, report.lon, report.rangeM, report.status];
  const rows = [
    ...report.metrics.map((metric) => ({
      label: metric.label,
      value: formatReadoutValue(metric.value, formatNumber, unitSystem),
      arrivalTimeS: metric.arrivalTimeS ?? "",
    })),
    ...extraMetrics.map((metric) => ({ ...metric, arrivalTimeS: "" })),
  ].map((metric) => [
    ...base,
    metric.label,
    metric.value,
    metric.arrivalTimeS,
    report.governingModel,
    report.confidence,
    report.citations.join(" | "),
    report.assumptions.map((value) => formatEmbeddedLengthValues(value, formatNumber, unitSystem)).join(" | "),
    report.unknowns.map((value) => formatEmbeddedLengthValues(value, formatNumber, unitSystem)).join(" | "),
    unitSystem,
  ]);
  return rows.length > 0 ? rows : [[
    ...base,
    "",
    "",
    "",
    report.governingModel,
    report.confidence,
    report.citations.join(" | "),
    report.assumptions.map((value) => formatEmbeddedLengthValues(value, formatNumber, unitSystem)).join(" | "),
    report.unknowns.map((value) => formatEmbeddedLengthValues(value, formatNumber, unitSystem)).join(" | "),
    unitSystem,
  ]];
}

export function PointProbePanel({ primary, comparison = null, maxField = null, maxFieldLoading = false, maxFieldError = null }: Props) {
  const { t, formatNumber } = useI18n();
  const unitSystem = useUnits();
  const [failure, setFailure] = useState<Extract<ExportResult, { ok: false }> | null>(null);
  if (!primary) return null;
  const reports = comparison
    ? [[t("probe.slotA"), primary], [t("probe.slotB"), comparison]] as const
    : [[t("probe.single"), primary]] as const;
  const maxFieldMetrics: DisplayMetric[] = maxField ? [
    { label: t("probe.maxField.maxDepth"), value: quantityText(formatLength(maxField.maximum_total_flow_depth_m, formatNumber, unitSystem)) },
    { label: t("probe.maxField.maxSpeed"), value: quantityText(formatSpeed(maxField.maximum_current_speed_m_s, formatNumber, unitSystem)) },
    { label: t("probe.maxField.momentum"), value: `${formatNumber(maxField.maximum_specific_momentum_flux_m3_s2, { maximumFractionDigits: 2 })} m³/s²` },
    { label: t("probe.maxField.drawdown"), value: maxField.maximum_drawdown_m == null ? "—" : quantityText(formatLength(maxField.maximum_drawdown_m, formatNumber, unitSystem)) },
    { label: t("probe.maxField.minDepth"), value: maxField.minimum_total_flow_depth_m == null ? "—" : quantityText(formatLength(maxField.minimum_total_flow_depth_m, formatNumber, unitSystem)) },
    { label: t("probe.maxField.tMaxSpeed"), value: `${formatNumber(maxField.time_of_maximum_current_speed_s, { maximumFractionDigits: 1 })} s` },
  ] : [];

  const exportText = () => {
    const body = reports.map(([label, report], index) => reportText(
      report,
      label,
      t,
      formatNumber,
      unitSystem,
      index === 0 ? maxFieldMetrics : [],
    )).join("\n\n");
    const result = downloadBlob(
      new Blob([`${body}\n`], { type: "text/plain;charset=utf-8" }),
      "cataclysm-point-probe.txt",
    );
    setFailure(result.ok ? null : result);
  };
  const exportCsv = () => {
    const header = [
      "slot", "domain", "latitude_deg", "longitude_deg", "range_m", "status",
      "metric", "value", "arrival_time_s", "governing_model", "confidence",
      "citations", "assumptions", "unknowns", "display_unit_system",
    ];
    const rows = reports.flatMap(([slot, report], index) => reportCsv(
      report,
      slot,
      formatNumber,
      unitSystem,
      index === 0 ? maxFieldMetrics : [],
    ));
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const result = downloadBlob(
      new Blob([`${csv}\r\n`], { type: "text/csv;charset=utf-8" }),
      "cataclysm-point-probe.csv",
    );
    setFailure(result.ok ? null : result);
  };

  return (
    <section className="section" aria-labelledby="point-probe-heading">
      <div className="section__title">
        <span id="point-probe-heading">{t("probe.title")}</span>
        <span className="section__badge">{t("probe.badge")}</span>
      </div>
      {reports.map(([label, report]) => (
        <div className="result-card" key={label}>
          <strong>{label}: {formatNumber(report.lat, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}°, {formatNumber(report.lon, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}°</strong>
          <p>{report.status} · {t("probe.distance", { value: quantityText(formatLength(report.rangeM, formatNumber, unitSystem)) })}</p>
          <dl className="results__metrics">
            {report.metrics.map((metric) => (
              <div key={metric.label}><dt>{metric.label}</dt><dd>{formatReadoutValue(metric.value, formatNumber, unitSystem)}</dd></div>
            ))}
            <div><dt>{t("probe.model")}</dt><dd>{report.governingModel}</dd></div>
            <div><dt>{t("probe.confidence")}</dt><dd>{report.confidence}</dd></div>
          </dl>
          {report === primary && maxFieldLoading && <p role="status">{t("probe.maxField.loading")}</p>}
          {report === primary && maxField && (
            <div className="point-probe__max-field">
              <p><strong>{t("probe.maxField.title")}</strong></p>
              <p>{t("probe.maxField.cell", {
                lat: formatNumber(maxField.cell_lat, { minimumFractionDigits: 4, maximumFractionDigits: 4 }),
                lon: formatNumber(maxField.cell_lon, { minimumFractionDigits: 4, maximumFractionDigits: 4 }),
              })}</p>
              <dl className="results__metrics">
                {maxFieldMetrics.map((metric) => (
                  <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>
                ))}
              </dl>
              <p>{t("probe.maxField.basis")}</p>
            </div>
          )}
          {report === primary && maxFieldError && (
            <p className="panel-error" role="alert">{t("probe.maxField.unavailable", { error: maxFieldError })}</p>
          )}
          <p><strong>{t("probe.basis")}:</strong> {report.citations.join("; ") || t("probe.noCitation")}</p>
          <p><strong>{t("probe.assumptions")}:</strong> {report.assumptions.map((value) => formatEmbeddedLengthValues(value, formatNumber, unitSystem)).join("; ")}</p>
          <p><strong>{t("probe.unknowns")}:</strong> {report.unknowns.map((value) => formatEmbeddedLengthValues(value, formatNumber, unitSystem)).join("; ")}</p>
        </div>
      ))}
      <div className="results__actions">
        <button className="results__export" type="button" onClick={exportText}>{t("probe.exportText")}</button>
        <button className="results__export" type="button" onClick={exportCsv}>{t("probe.exportCsv")}</button>
      </div>
      {failure && (
        <div className="panel-error" role="alert">
          {exportFailureLabel(failure.code)}: {failure.message}
        </div>
      )}
    </section>
  );
}
