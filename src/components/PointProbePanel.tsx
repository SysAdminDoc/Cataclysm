import { useState } from "react";

import { downloadBlob, exportFailureLabel, type ExportResult } from "../lib/export";
import { useI18n } from "../lib/i18n";
import type { PointProbeReport } from "../render/cesium/inspection";
import { useUnits } from "../hooks/useUnits";
import { formatEmbeddedLengthValues, formatLength, formatReadoutValue, quantityText, type UnitSystem } from "../lib/units";

type Props = {
  primary: PointProbeReport | null;
  comparison?: PointProbeReport | null;
};

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
): string {
  return [
    label,
    t("probe.export.domain", { value: report.domain }),
    t("probe.export.coordinate", { lat: report.lat.toFixed(6), lon: report.lon.toFixed(6) }),
    t("probe.export.range", { value: quantityText(formatLength(report.rangeM, formatNumber, unitSystem)) }),
    t("probe.export.status", { value: report.status }),
    ...report.metrics.map((metric) => `${metric.label}: ${formatReadoutValue(metric.value, formatNumber, unitSystem)}`),
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
): Array<Array<string | number>> {
  const base = [slot, report.domain, report.lat, report.lon, report.rangeM, report.status];
  const rows = report.metrics.map((metric) => [
    ...base,
    metric.label,
    formatReadoutValue(metric.value, formatNumber, unitSystem),
    metric.arrivalTimeS ?? "",
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

export function PointProbePanel({ primary, comparison = null }: Props) {
  const { t, formatNumber } = useI18n();
  const unitSystem = useUnits();
  const [failure, setFailure] = useState<Extract<ExportResult, { ok: false }> | null>(null);
  if (!primary) return null;
  const reports = comparison
    ? [[t("probe.slotA"), primary], [t("probe.slotB"), comparison]] as const
    : [[t("probe.single"), primary]] as const;

  const exportText = () => {
    const body = reports.map(([label, report]) => reportText(report, label, t, formatNumber, unitSystem)).join("\n\n");
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
    const rows = reports.flatMap(([slot, report]) => reportCsv(report, slot, formatNumber, unitSystem));
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
