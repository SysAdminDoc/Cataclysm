import { useState } from "react";
import { downloadBlob, safeFilenamePart, type ExportResult } from "../lib/export";
import { useI18n } from "../lib/i18n";

export type SemanticDataColumn = {
  key: string;
  label: string;
  /** Trusted analytical numbers bypass spreadsheet text hardening so negative
   * and scientific values remain machine-readable. All other cells are
   * treated as untrusted text. */
  dataType?: "text" | "number";
};

export type SemanticDataRow = Record<string, string | number | null | undefined>;

type Props = {
  id: string;
  title: string;
  summary: string;
  columns: SemanticDataColumn[];
  rows: SemanticDataRow[];
  filename: string;
};

const FINITE_DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;

function csvCell(value: SemanticDataRow[string], dataType: SemanticDataColumn["dataType"] = "text"): string {
  if (value == null) return "";
  const text = String(value);
  if (
    dataType === "number"
    && ((typeof value === "number" && Number.isFinite(value)) || (FINITE_DECIMAL.test(text) && Number.isFinite(Number(text))))
  ) {
    return text;
  }
  // Spreadsheet programs may execute cells that begin with these characters.
  // Preserve the displayed text while forcing imported CSV data to stay text.
  const safe = /^[=+\-@\t\r]/u.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function semanticRowsToCsv(columns: SemanticDataColumn[], rows: SemanticDataRow[]): string {
  return [
    columns.map((column) => csvCell(column.label)).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column.key], column.dataType)).join(",")),
  ].join("\r\n");
}

/** A focusable semantic equivalent for a visual analytical chart. It is not a
 * live region: timeline-driven updates remain inspectable without announcing
 * every animation frame. */
export function SemanticDataTable({ id, title, summary, columns, rows, filename }: Props) {
  const { t, formatNumber } = useI18n();
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const [exportFailure, setExportFailure] = useState<Extract<ExportResult, { ok: false }> | null>(null);
  const csv = semanticRowsToCsv(columns, rows);

  async function copyCsv() {
    if (!navigator.clipboard?.writeText) {
      setCopyStatus("error");
      return;
    }
    try {
      await navigator.clipboard.writeText(csv);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  }

  function exportCsv() {
    const result = downloadBlob(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
      safeFilenamePart(filename),
    );
    setExportFailure(result.ok ? null : result);
  }

  return (
    <div className="chart-data" data-semantic-chart>
      <p id={`${id}-summary`} className="chart-data__summary" aria-live="off">
        {summary}
      </p>
      <details className="chart-data__details">
        <summary>{t(rows.length === 1 ? "dataTable.view.one" : "dataTable.view.many", {
          title,
          count: formatNumber(rows.length),
        })}</summary>
        <div className="chart-data__actions">
          <button type="button" aria-label={t("dataTable.copyAria", { title })} onClick={() => void copyCsv()}>{t("dataTable.copy")}</button>
          <button type="button" aria-label={t("dataTable.exportAria", { title })} onClick={exportCsv}>{t("dataTable.export")}</button>
          {copyStatus !== "idle" && (
            <span role={copyStatus === "error" ? "alert" : "status"}>
              {copyStatus === "copied" ? t("dataTable.copied") : t("dataTable.copyUnavailable")}
            </span>
          )}
        </div>
        {exportFailure && (
          <div className="panel-error" role="alert">
            <span>{t("dataTable.exportFailed", { error: exportFailure.message })}</span>
            {exportFailure.retryable && <button type="button" aria-label={t("dataTable.retryAria", { title })} onClick={exportCsv}>{t("dataTable.retry")}</button>}
          </div>
        )}
        <div
          className="chart-data__scroll"
          role="region"
          aria-label={t("dataTable.region", { title })}
          tabIndex={0}
          aria-live="off"
        >
          <table>
            <caption className="sr-only">{title}. {summary}</caption>
            <thead>
              <tr>{columns.map((column) => <th key={column.key} scope="col">{column.label}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  {columns.map((column, columnIndex) => columnIndex === 0
                    ? <th key={column.key} scope="row">{row[column.key] ?? "—"}</th>
                    : <td key={column.key}>{row[column.key] ?? "—"}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
