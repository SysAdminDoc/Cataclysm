import { useMemo } from "react";

import type { NukemapLocationResult } from "../types/nukemap-data";
import type { PointProbeReport } from "../render/cesium/inspection";
import { useI18n } from "../lib/i18n";

type Props = {
  place: NukemapLocationResult;
  report: PointProbeReport | null;
  mode: "tsunami" | "asteroid" | "nuclear";
  sourceLabel: string;
  historicalSource?: boolean;
  pending?: boolean;
  onClear: () => void;
};

export function FamiliarPlacePanel({
  place,
  report,
  mode,
  sourceLabel,
  historicalSource = false,
  pending = false,
  onClear,
}: Props) {
  const { t, formatNumber } = useI18n();
  const isDirect = mode !== "tsunami";
  const arrival = useMemo(() => report?.metrics.find((metric) => (
    metric.arrivalTimeS != null || /arrival/i.test(metric.label)
  )) ?? null, [report]);
  const distance = report
    ? t(isDirect ? "place.distanceFromEvent" : "place.distanceFromSource", {
        value: formatNumber(report.rangeM / 1_000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
      })
    : t("place.waitingValue");
  const densityDistance = place.density.distanceKm == null
    ? null
    : formatNumber(place.density.distanceKm, { maximumFractionDigits: 1 });

  return (
    <section className="familiar-place" aria-labelledby="familiar-place-heading">
      <header className="familiar-place__header">
        <span>
          <small>{isDirect ? t("place.customCopy") : t("place.localProbe")}</small>
          <h2 id="familiar-place-heading">
            {isDirect
              ? t("place.whatIfTitle", { name: place.name })
              : t("place.nearTitle", { name: place.name })}
          </h2>
        </span>
        <button type="button" onClick={onClear}>{t("place.remove")}</button>
      </header>

      <div className="familiar-place__metrics">
        <div>
          <span>{isDirect ? t("place.eventDistance") : t("place.sourceDistance")}</span>
          <strong>{distance}</strong>
        </div>
        <div>
          <span>{t("place.effectTiming")}</span>
          <strong>{pending ? t("place.calculating") : arrival?.value ?? t("place.noTiming")}</strong>
        </div>
      </div>

      <p className="familiar-place__status" role="status">
        {pending
          ? t("place.calculatingFor", { name: place.name })
          : report?.status ?? t("place.waitingForSource")}
      </p>
      <p className="familiar-place__context">
        <strong>{t("place.localContext")}</strong>{" "}
        {place.density.nearestCity && densityDistance
          ? t("place.densityFrom", {
              density: formatNumber(place.density.peoplePerKm2),
              city: place.density.nearestCity,
              distance: densityDistance,
            })
          : t("place.densityOnly", { density: formatNumber(place.density.peoplePerKm2) })}
      </p>
      <p className="familiar-place__origin">
        {isDirect
          ? t("place.customOrigin", { source: sourceLabel, name: place.name })
          : historicalSource
            ? t("place.historicalOrigin", { source: sourceLabel, name: place.name })
            : t("place.modelOrigin", { source: sourceLabel, name: place.name })}
      </p>
      {report && (
        <details className="familiar-place__details">
          <summary>{t("place.modelDetails")}</summary>
          <dl>
            <div><dt>{t("probe.model")}</dt><dd>{report.governingModel}</dd></div>
            <div><dt>{t("probe.confidence")}</dt><dd>{report.confidence}</dd></div>
          </dl>
          <p><strong>{t("probe.basis")}:</strong> {report.citations.join("; ") || t("probe.noCitation")}</p>
          <p><strong>{t("probe.assumptions")}:</strong> {report.assumptions.join("; ")}</p>
          <p><strong>{t("probe.unknowns")}:</strong> {report.unknowns.join("; ")}</p>
        </details>
      )}
      <small className="familiar-place__privacy">{t("place.privacy")}</small>
    </section>
  );
}
