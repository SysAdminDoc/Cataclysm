import { asyncResultValue, type AsyncResult } from "../lib/async-result";
import type { HazelRunupSearchResponse } from "../lib/ncei-hazel";
import type { HazelValidationSummary } from "../lib/hazel-validation";
import { useI18n } from "../lib/i18n";

type Props = {
  eventId: number | null;
  result: AsyncResult<HazelRunupSearchResponse>;
  summary: HazelValidationSummary | null;
  desktopAvailable: boolean;
  online: boolean;
  onRetry: () => void;
};

function metric(value: number | null, formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string): string {
  return value === null ? "—" : `${formatNumber(value, { maximumFractionDigits: 2 })} m`;
}

export function HazelValidationPanel({
  eventId,
  result,
  summary,
  desktopAvailable,
  online,
  onRetry,
}: Props) {
  const { t, formatNumber } = useI18n();
  const retained = asyncResultValue(result);
  const loading = result.status === "loading";
  const unavailable = eventId !== null && (!desktopAvailable || !online || result.status === "error" || result.status === "stale");
  const empty = result.status === "empty"
    || (result.status === "ready" && retained?.items.length === 0)
    || (summary !== null && summary.validObservedCount === 0);
  return (
    <section className="hazel-validation" aria-labelledby="hazel-validation-title">
      <div className="section__title">
        <span id="hazel-validation-title">{t("hazelValidation.title")}</span>
        {eventId !== null && <span className="section__badge" data-tone={loading ? "muted" : unavailable ? "warning" : "info"}>
          {t("hazelValidation.event", { id: formatNumber(eventId) })}
        </span>}
      </div>
      <p className="hazel-validation__intro">{t("hazelValidation.intro")}</p>
      {eventId === null ? (
        <p className="hazel-validation__status" role="status">{t("hazelValidation.waiting")}</p>
      ) : unavailable ? (
        <div className="hazel-validation__status" role="status">
          <p>{!desktopAvailable ? t("hazelValidation.browserOnly") : !online ? t("hazelValidation.offline") : t("hazelValidation.unavailable")}</p>
          <button type="button" onClick={onRetry}>{t("hazelValidation.retry")}</button>
        </div>
      ) : loading && !summary ? (
        <p className="hazel-validation__status" role="status">{t("hazelValidation.loading")}</p>
      ) : empty ? (
        <p className="hazel-validation__status" role="status">{t("hazelValidation.empty")}</p>
      ) : summary ? (
        <>
          {loading && <p className="hazel-validation__status" role="status">{t("hazelValidation.refreshing")}</p>}
          <dl className="hazel-validation__metrics">
            <div><dt>{t("hazelValidation.observed")}</dt><dd>{formatNumber(summary.validObservedCount)} / {formatNumber(summary.sourceItemCount)}</dd></div>
            <div><dt>{t("hazelValidation.plotted")}</dt><dd>{formatNumber(summary.plottedCount)}</dd></div>
            <div><dt>{t("hazelValidation.matched")}</dt><dd>{formatNumber(summary.matchedCount)}</dd></div>
            <div><dt>{t("hazelValidation.bias")}</dt><dd>{metric(summary.biasM, formatNumber)}</dd></div>
            <div><dt>{t("hazelValidation.rmse")}</dt><dd>{metric(summary.rmseM, formatNumber)}</dd></div>
            <div><dt>{t("hazelValidation.mae")}</dt><dd>{metric(summary.meanAbsoluteErrorM, formatNumber)}</dd></div>
          </dl>
          {summary.matchedCount === 0 && (
            <p className="hazel-validation__status">{t("hazelValidation.noComparable", { radius: formatNumber(summary.matchRadiusM / 1000, { maximumFractionDigits: 0 }) })}</p>
          )}
          {(summary.sourceTruncated || summary.displaySampled) && (
            <p className="hazel-validation__sampling">{t("hazelValidation.sampling", {
              fetched: formatNumber(summary.fetchedItemCount),
              plotted: formatNumber(summary.plottedCount),
            })}</p>
          )}
          <p className="hazel-validation__caveat">{t("hazelValidation.caveat")}</p>
          <a href="https://www.ncei.noaa.gov/products/natural-hazards/tsunamis-earthquakes-volcanoes/tsunamis/global-historical-data" target="_blank" rel="noreferrer">
            {t("hazelValidation.source")}
          </a>
        </>
      ) : null}
    </section>
  );
}
