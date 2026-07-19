import { useEffect, useId, useMemo, useState } from "react";

import { hypotheticalImpactFromApproach, loadCloseApproaches } from "../lib/jpl";
import { useI18n } from "../lib/i18n";
import type { HypotheticalImpactDraft, NeoApproachFeed, NeoCloseApproach } from "../types/jpl";
import { UiIcon } from "./UiIcon";
import { useUnits } from "../hooks/useUnits";
import { formatLength, formatSpeed, quantityText } from "../lib/units";

const AU_KM = 149_597_870.7;
const LUNAR_DISTANCE_KM = 384_400;

type Props = {
  onTryHypotheticalImpact: (draft: HypotheticalImpactDraft) => void;
};

function sameUtcDay(leftIso: string, right: Date): boolean {
  const left = new Date(leftIso);
  return left.getUTCFullYear() === right.getUTCFullYear()
    && left.getUTCMonth() === right.getUTCMonth()
    && left.getUTCDate() === right.getUTCDate();
}

function ApproachDiagram({ approach }: { approach: NeoCloseApproach }) {
  const { t, formatNumber } = useI18n();
  const diagramId = `approach-${useId().replace(/:/g, "")}`;
  const lunarDistances = (approach.nominalDistanceAu * AU_KM) / LUNAR_DISTANCE_KM;
  const trackY = Math.min(70, Math.max(25, 22 + Math.log10(Math.max(lunarDistances, 0.01) + 1) * 27));
  return (
    <figure className="planetary-defense__diagram">
      <svg viewBox="0 0 360 132" role="img" aria-labelledby={`${diagramId}-title ${diagramId}-desc`}>
        <title id={`${diagramId}-title`}>{t("pd.diagramTitle", { name: approach.fullname })}</title>
        <desc id={`${diagramId}-desc`}>{t("pd.diagramDescription")}</desc>
        <defs>
          <linearGradient id={`${diagramId}-track`} x1="0" x2="1">
            <stop offset="0" stopColor="var(--overlay)" stopOpacity="0" />
            <stop offset="0.2" stopColor="var(--accent-active)" />
            <stop offset="0.8" stopColor="var(--accent-active)" />
            <stop offset="1" stopColor="var(--overlay)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <circle cx="180" cy="92" r="20" className="planetary-defense__earth" />
        <circle cx="180" cy="92" r="29" className="planetary-defense__orbit-guide" />
        <path d={`M 12 ${trackY} C 104 ${trackY - 10}, 256 ${trackY + 10}, 348 ${trackY}`} stroke={`url(#${diagramId}-track)`} />
        <circle cx="91" cy={trackY - 5} r="4" className="planetary-defense__object" />
        <path d={`M 97 ${trackY - 5} h 20`} className="planetary-defense__direction" />
        <text x="180" y="96" textAnchor="middle">{t("pd.earth")}</text>
      </svg>
      <figcaption>
        {t("pd.schematic", { distance: formatNumber(lunarDistances, { maximumFractionDigits: 2 }) })}
      </figcaption>
    </figure>
  );
}

export function PlanetaryDefensePanel({ onTryHypotheticalImpact }: Props) {
  const { t, formatNumber, languageTag } = useI18n();
  const unitSystem = useUnits();
  const [feed, setFeed] = useState<NeoApproachFeed | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFeed(null);
    void loadCloseApproaches().then((result) => {
      if (!cancelled) setFeed(result);
    });
    return () => { cancelled = true; };
  }, [refreshNonce]);

  const selected = feed?.approaches.find((approach) => approach.id === selectedId) ?? null;
  const visibleApproaches = useMemo(() => feed?.approaches.slice(0, 5) ?? [], [feed]);
  const today = useMemo(() => {
    if (!feed || feed.status === "reference") return [];
    const now = new Date();
    return visibleApproaches.filter((approach) => sameUtcDay(approach.approachAtIso, now));
  }, [feed, visibleApproaches]);
  const next = useMemo(() => {
    if (!feed) return [];
    if (feed.status === "reference") return visibleApproaches;
    const todayIds = new Set(today.map((approach) => approach.id));
    return visibleApproaches.filter((approach) => !todayIds.has(approach.id));
  }, [feed, today, visibleApproaches]);
  const dateTime = (iso: string) => new Intl.DateTimeFormat(languageTag, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(iso));
  const size = (approach: NeoCloseApproach) => {
    if (approach.diameterMaxM <= 0) return t("pd.sizeUnknown");
    return t("pd.sizeRange", {
      min: quantityText(formatLength(approach.diameterMinM, formatNumber, unitSystem)),
      max: quantityText(formatLength(approach.diameterMaxM, formatNumber, unitSystem)),
    });
  };
  const distance = (approach: NeoCloseApproach) => {
    const km = approach.nominalDistanceAu * AU_KM;
    return t("pd.distanceValue", {
      lunar: formatNumber(km / LUNAR_DISTANCE_KM, { maximumFractionDigits: 2 }),
      distance: quantityText(formatLength(km * 1000, formatNumber, unitSystem)),
    });
  };
  const distanceRange = (approach: NeoCloseApproach) => t("pd.distanceRange", {
    min: quantityText(formatLength(approach.minimumDistanceAu * AU_KM * 1000, formatNumber, unitSystem)),
    max: quantityText(formatLength(approach.maximumDistanceAu * AU_KM * 1000, formatNumber, unitSystem)),
  });
  const renderApproaches = (approaches: NeoCloseApproach[]) => (
    <div className="planetary-defense__list">
      {approaches.map((approach) => (
        <article className="planetary-defense__card" key={approach.id} data-selected={selectedId === approach.id ? "true" : undefined}>
          <header>
            <strong>{approach.fullname}</strong>
            <time dateTime={approach.approachAtIso}>{dateTime(approach.approachAtIso)}</time>
          </header>
          <dl>
            <div><dt>{t("pd.size")}</dt><dd>{size(approach)}</dd></div>
            <div><dt>{t("pd.missDistance")}</dt><dd>{distance(approach)}</dd></div>
            <div><dt>{t("pd.velocity")}</dt><dd>{t("pd.velocityValue", { value: quantityText(formatSpeed(approach.relativeVelocityKmS * 1000, formatNumber, unitSystem)) })}</dd></div>
            <div><dt>{t("pd.uncertainty")}</dt><dd>{approach.timeUncertainty || t("pd.notSupplied")}</dd></div>
          </dl>
          <p>{t("pd.closeNotImpact")}</p>
          <div className="planetary-defense__actions">
            <button type="button" aria-expanded={selectedId === approach.id} onClick={() => setSelectedId((current) => current === approach.id ? null : approach.id)}>
              {selectedId === approach.id ? t("pd.hideApproach") : t("pd.exploreApproach")}
            </button>
            <button type="button" onClick={() => onTryHypotheticalImpact(hypotheticalImpactFromApproach(approach))}>
              {t("pd.tryImpact")}
            </button>
          </div>
        </article>
      ))}
    </div>
  );

  return (
    <section className="planetary-defense" aria-labelledby="planetary-defense-heading">
      <header className="planetary-defense__header">
        <span>
          <small>{t("pd.eyebrow")}</small>
          <h3 id="planetary-defense-heading">{t("pd.title")}</h3>
        </span>
        <button type="button" onClick={() => setRefreshNonce((nonce) => nonce + 1)} disabled={!feed}>
          <UiIcon name="refresh" size={13} /> {t("pd.refresh")}
        </button>
      </header>
      {!feed ? <p className="planetary-defense__loading" role="status">{t("pd.loading")}</p> : (
        <>
          <div className="planetary-defense__status" role="status">
            <strong>{feed.status === "live" ? t("pd.live") : feed.status === "cached" ? t("pd.cached") : t("pd.reference")}</strong>
            {feed.stale && <span>{t("pd.stale")}</span>}
            <time dateTime={feed.fetchedAtIso}>{t("pd.updated", { time: dateTime(feed.fetchedAtIso) })}</time>
          </div>
          {feed.notice && <p className="planetary-defense__notice">{
            feed.status === "cached"
              ? t("pd.notice.cached")
              : feed.stale
                ? t("pd.notice.referenceStale")
                : t("pd.notice.reference")
          }</p>}
          {today.length > 0 && <section aria-labelledby="planetary-defense-today">
            <h4 id="planetary-defense-today">{t("pd.today")}</h4>
            {renderApproaches(today)}
          </section>}
          <section aria-labelledby="planetary-defense-next">
            <h4 id="planetary-defense-next">{feed.status === "reference" ? t("pd.referenceApproaches") : t("pd.nextApproaches")}</h4>
            {renderApproaches(next)}
          </section>
          {selected && (
            <section className="planetary-defense__detail" aria-labelledby="planetary-defense-detail-heading">
              <header>
                <span><small>{t("pd.realApproach")}</small><h4 id="planetary-defense-detail-heading">{selected.fullname}</h4></span>
                <strong>{distance(selected)}</strong>
              </header>
              <ApproachDiagram approach={selected} />
              <dl>
                <div><dt>{t("pd.distanceUncertainty")}</dt><dd>{distanceRange(selected)}</dd></div>
                <div><dt>{t("pd.timeUncertainty")}</dt><dd>{selected.timeUncertainty || t("pd.notSupplied")}</dd></div>
                <div><dt>{t("pd.sizeBasis")}</dt><dd>{selected.diameterBasis === "measured" ? t("pd.measured") : selected.diameterBasis === "estimated_from_h" ? t("pd.estimated") : t("pd.unknown")}</dd></div>
                <div><dt>{t("pd.riskStatus")}</dt><dd>{t("pd.riskBoundary")}</dd></div>
              </dl>
              <p>{t("pd.provenance")}</p>
            </section>
          )}
        </>
      )}
    </section>
  );
}
