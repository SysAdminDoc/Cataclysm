import { useState } from "react";

import { downloadBlob, exportFailureLabel, type ExportResult } from "../lib/export";
import type { PointProbeReport } from "../render/cesium/inspection";

type Props = {
  primary: PointProbeReport | null;
  comparison?: PointProbeReport | null;
};

function csvCell(value: string | number): string {
  const text = String(value).replaceAll("\r", " ").replaceAll("\n", " ");
  return `"${text.replaceAll('"', '""')}"`;
}

function reportText(report: PointProbeReport, label: string): string {
  return [
    label,
    `Domain: ${report.domain}`,
    `Coordinate: ${report.lat.toFixed(6)}, ${report.lon.toFixed(6)}`,
    `Range: ${report.rangeM.toFixed(1)} m`,
    `Status: ${report.status}`,
    ...report.metrics.map((metric) => `${metric.label}: ${metric.value}`),
    `Governing model: ${report.governingModel}`,
    `Confidence: ${report.confidence}`,
    ...report.citations.map((citation) => `Citation: ${citation}`),
    ...report.assumptions.map((assumption) => `Assumption: ${assumption}`),
    ...report.unknowns.map((unknown) => `Unknown: ${unknown}`),
  ].join("\n");
}

function reportCsv(report: PointProbeReport, slot: string): Array<Array<string | number>> {
  const base = [slot, report.domain, report.lat, report.lon, report.rangeM, report.status];
  const rows = report.metrics.map((metric) => [
    ...base,
    metric.label,
    metric.value,
    metric.arrivalTimeS ?? "",
    report.governingModel,
    report.confidence,
    report.citations.join(" | "),
    report.assumptions.join(" | "),
    report.unknowns.join(" | "),
  ]);
  return rows.length > 0 ? rows : [[
    ...base,
    "",
    "",
    "",
    report.governingModel,
    report.confidence,
    report.citations.join(" | "),
    report.assumptions.join(" | "),
    report.unknowns.join(" | "),
  ]];
}

export function PointProbePanel({ primary, comparison = null }: Props) {
  const [failure, setFailure] = useState<Extract<ExportResult, { ok: false }> | null>(null);
  if (!primary) return null;
  const reports = comparison
    ? [["Slot A", primary], ["Slot B", comparison]] as const
    : [["Probe", primary]] as const;

  const exportText = () => {
    const body = reports.map(([label, report]) => reportText(report, label)).join("\n\n");
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
      "citations", "assumptions", "unknowns",
    ];
    const rows = reports.flatMap(([slot, report]) => reportCsv(report, slot));
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
        <span id="point-probe-heading">Point probe</span>
        <span className="section__badge">Explainable</span>
      </div>
      {reports.map(([label, report]) => (
        <div className="result-card" key={label}>
          <strong>{label}: {report.lat.toFixed(2)}°, {report.lon.toFixed(2)}°</strong>
          <p>{report.status} · {(report.rangeM / 1_000).toFixed(1)} km from source</p>
          <dl className="results__metrics">
            {report.metrics.map((metric) => (
              <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>
            ))}
            <div><dt>Model</dt><dd>{report.governingModel}</dd></div>
            <div><dt>Confidence</dt><dd>{report.confidence}</dd></div>
          </dl>
          <p><strong>Basis:</strong> {report.citations.join("; ") || "No citation supplied"}</p>
          <p><strong>Assumptions:</strong> {report.assumptions.join("; ")}</p>
          <p><strong>Unknowns:</strong> {report.unknowns.join("; ")}</p>
        </div>
      ))}
      <div className="results__actions">
        <button className="results__export" type="button" onClick={exportText}>Export probe text</button>
        <button className="results__export" type="button" onClick={exportCsv}>Export probe CSV</button>
      </div>
      {failure && (
        <div className="panel-error" role="alert">
          {exportFailureLabel(failure.code)}: {failure.message}
        </div>
      )}
    </section>
  );
}
