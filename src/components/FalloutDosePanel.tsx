// Early-fallout dose screening surface for nuclear mode. The dose field itself
// comes from the Rust-authoritative WSEG-10 / Glasstone-Dolan model through
// `api.falloutDoseProbe`; this component owns only its downwind/wind/time query
// controls and the presentation of the returned report.

import { useEffect, useRef, useState } from "react";
import { api, isTauri } from "../lib/tauri";
import type { FalloutDoseReport } from "../hazards";
import { useI18n } from "../lib/i18n";
import type { MessageKey } from "../lib/i18n-core";
import { NumericField } from "./NumericField";

const FIELD_CLASS_KEYS: Record<string, MessageKey> = {
  dangerous_fallout_field: "hazard.fallout.field.dangerous_fallout_field",
  hot_fallout_field: "hazard.fallout.field.hot_fallout_field",
  below_displayed_field: "hazard.fallout.field.below_displayed_field",
};

/** Present a sievert quantity without manufacturing false precision: fixed
 * digits in the readable band, scientific notation for the vanishing tail. */
function formatDose(
  sv: number,
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string,
): string {
  if (!Number.isFinite(sv) || sv <= 0) return "0";
  if (sv >= 0.01) return formatNumber(sv, { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  return sv.toExponential(2);
}

export function FalloutDosePanel({
  yieldKt,
  fissionFraction,
  backendAvailable = true,
}: {
  yieldKt: number;
  fissionFraction: number;
  backendAvailable?: boolean;
}) {
  const { t, formatNumber } = useI18n();
  const [downwindKm, setDownwindKm] = useState(16);
  const [crosswindKm, setCrosswindKm] = useState(0);
  const [windSpeedKmh, setWindSpeedKmh] = useState(40);
  const [selectedTimeH, setSelectedTimeH] = useState(24);
  const [report, setReport] = useState<FalloutDoseReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const available = backendAvailable && isTauri();

  useEffect(() => {
    if (!available) {
      setReport(null);
      setError(null);
      setLoading(false);
      return;
    }
    const current = ++requestId.current;
    setLoading(true);
    setError(null);
    api
      .falloutDoseProbe({ yieldKt, fissionFraction, downwindKm, crosswindKm, windSpeedKmh, selectedTimeH })
      .then((next) => {
        if (current !== requestId.current) return;
        setReport(next);
        setLoading(false);
      })
      .catch(() => {
        if (current !== requestId.current) return;
        setReport(null);
        setError(t("hazard.fallout.error"));
        setLoading(false);
      });
  }, [available, yieldKt, fissionFraction, downwindKm, crosswindKm, windSpeedKmh, selectedTimeH, t]);

  const fieldClassKey = report ? FIELD_CLASS_KEYS[report.fieldClass] : null;

  return (
    <details className="hazard__fallout">
      <summary>{t("hazard.fallout.title")}</summary>
      <p>{t("hazard.fallout.description", { model: report?.model ?? "WSEG-10" })}</p>

      <div className="hazard__fallout-controls">
        <NumericField
          layout="hazard"
          label={t("hazard.fallout.downwind")}
          unit="km"
          value={downwindKm}
          min={0.5}
          max={500}
          step="any"
          onCommit={setDownwindKm}
          slider={{ value: downwindKm, min: 0.5, max: 200, step: 0.5, onChange: setDownwindKm, valueText: `${formatNumber(downwindKm)} km` }}
        />
        <NumericField
          layout="hazard"
          label={t("hazard.fallout.crosswind")}
          unit="km"
          value={crosswindKm}
          min={0}
          max={200}
          step="any"
          onCommit={setCrosswindKm}
          slider={{ value: crosswindKm, min: 0, max: 100, step: 0.5, onChange: setCrosswindKm, valueText: `${formatNumber(crosswindKm)} km` }}
        />
        <NumericField
          layout="hazard"
          label={t("hazard.fallout.windSpeed")}
          unit="km/h"
          value={windSpeedKmh}
          min={5}
          max={200}
          step="any"
          onCommit={setWindSpeedKmh}
          slider={{ value: windSpeedKmh, min: 5, max: 120, step: 1, onChange: setWindSpeedKmh, valueText: `${formatNumber(windSpeedKmh)} km/h` }}
        />
        <NumericField
          layout="hazard"
          label={t("hazard.fallout.time")}
          unit="h"
          value={selectedTimeH}
          min={0.5}
          max={336}
          step="any"
          onCommit={setSelectedTimeH}
          slider={{ value: selectedTimeH, min: 0.5, max: 168, step: 0.5, onChange: setSelectedTimeH, valueText: `${formatNumber(selectedTimeH)} h` }}
        />
      </div>

      {!available && <p className="hazard__fallout-note">{t("hazard.fallout.unavailable")}</p>}
      {available && loading && !report && <p className="hazard__fallout-note" role="status">{t("hazard.fallout.loading")}</p>}
      {available && error && <p className="hazard__fallout-note" role="alert">{error}</p>}

      {report && (
        <>
          <ul className="hazard__fallout-summary">
            {fieldClassKey && (
              <li data-field-class={report.fieldClass}>
                <span>{t(fieldClassKey)}</span>
              </li>
            )}
            <li>
              <span>{t("hazard.fallout.arrival")}</span>
              <strong>{formatNumber(report.arrivalTimeH, { maximumFractionDigits: 1 })} h</strong>
            </li>
            <li>
              <span>{t("hazard.fallout.h1rate")}</span>
              <strong>{formatDose(report.hPlus1DoseRateSvH, formatNumber)} Sv/h</strong>
            </li>
          </ul>

          <div className="hazard__fallout-table" role="region" aria-label={t("hazard.fallout.region")} tabIndex={0}>
            <table>
              <caption>{t("hazard.fallout.caption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("hazard.fallout.shelterColumn")}</th>
                  <th scope="col">
                    {t("hazard.fallout.rateColumn")}
                    <small>Sv/h · {formatNumber(report.selectedTimeH, { maximumFractionDigits: 1 })} h</small>
                  </th>
                  <th scope="col">
                    {t("hazard.fallout.cumulativeColumn")}
                    <small>Sv · {formatNumber(report.selectedTimeH, { maximumFractionDigits: 1 })} h</small>
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.shelterCurves.map((curve) => (
                  <tr key={curve.shelterType}>
                    <th scope="row">{curve.shelterType}</th>
                    <td>{formatDose(curve.selected.doseRateSvH, formatNumber)}</td>
                    <td>{formatDose(curve.selected.cumulativeDoseSv, formatNumber)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="hazard__fallout-disclaimer">{report.disclaimer}</p>

          <details className="hazard__fallout-limits">
            <summary>{t("hazard.fallout.assumptions")}</summary>
            <ul>{report.assumptions.map((line) => <li key={line}>{line}</li>)}</ul>
            <p>{t("hazard.fallout.uncertainty")}</p>
            <ul>{report.uncertainty.map((line) => <li key={line}>{line}</li>)}</ul>
          </details>

          <div className="hazard__fallout-sources">
            <span>{t("hazard.fallout.sources")}:</span>
            <ul>
              {report.citations.map((citation) => (
                <li key={citation.url}>
                  {citation.label} <small>{citation.url}</small>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </details>
  );
}
