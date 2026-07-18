import type { HazardResult } from "../hazards";
import { buildLayerEvidence, type EvidenceLayerId } from "../lib/trust-evidence";
import type { InitialDisplacement, Preset } from "../types/scenario";
import type { SourceKind } from "./ResultsPanel";
import type { HumanitarianFacilityState } from "../hooks/useHumanitarianFacilities";
import { OSM_ATTRIBUTION_URL, type HumanitarianFacilityCategory } from "../lib/osm-facilities";
import { TrustDisclosure } from "./TrustDisclosure";
import { UiIcon } from "./UiIcon";
import { useI18n } from "../lib/i18n";
import type { MessageKey } from "../lib/i18n-core";

type Props = {
  domain: "tsunami" | "asteroid" | "nuclear";
  hasSource: boolean;
  hasWavefront: boolean;
  hasSweField: boolean;
  hasMaxField: boolean;
  arrivalCount: number;
  runupCount: number;
  dartCount: number;
  hasFallout: boolean;
  preset?: Preset | null;
  initial?: InitialDisplacement | null;
  sourceKind?: SourceKind;
  directResult?: HazardResult | null;
  humanitarianEnabled?: boolean;
  humanitarianState?: HumanitarianFacilityState | null;
  onHumanitarianEnabledChange?: (enabled: boolean) => void;
  onRefreshHumanitarian?: () => void;
  onOpenSettings: () => void;
};

function LayerRow({ label, detail, active, evidence }: { label: string; detail: string; active: boolean; evidence: ReturnType<typeof buildLayerEvidence> }) {
  const { t } = useI18n();
  const contextualEvidence = active ? evidence : {
    ...evidence,
    confidence: t("layers.waitingPrerequisite"),
    tone: "limited" as const,
  };
  return (
    <li className="layer-inspector__row" data-active={active ? "true" : "false"}>
      <div className="layer-inspector__summary">
        <span className="layer-inspector__state" aria-hidden>{active ? <UiIcon name="check" size={12} /> : null}</span>
        <span className="layer-inspector__label">
          <strong>{label}</strong>
          <small>{detail}</small>
        </span>
        <span className="layer-inspector__status">{active ? t("layers.active") : t("layers.waiting")}</span>
      </div>
      <TrustDisclosure evidence={contextualEvidence} compact compactStatus={active ? undefined : t("layers.evidence")} />
    </li>
  );
}

const FACILITY_CATEGORY_LABEL_KEYS: Record<HumanitarianFacilityCategory, MessageKey> = {
  school: "layers.education",
  health: "layers.healthcare",
  emergency: "layers.response",
};

function HumanitarianFacilityLayer({
  enabled,
  state,
  evidence,
  onEnabledChange,
  onRefresh,
}: {
  enabled: boolean;
  state: HumanitarianFacilityState | null;
  evidence: ReturnType<typeof buildLayerEvidence>;
  onEnabledChange: (enabled: boolean) => void;
  onRefresh: () => void;
}) {
  const { t, formatNumber } = useI18n();
  const facilities = state?.facilities ?? [];
  const counts = facilities.reduce<Record<HumanitarianFacilityCategory, number>>(
    (current, facility) => ({ ...current, [facility.category]: current[facility.category] + 1 }),
    { school: 0, health: 0, emergency: 0 },
  );
  const status = !enabled
    ? t("layers.off")
    : state?.status === "loading"
      ? t("layers.loading")
      : state?.status === "offline"
        ? facilities.length > 0 ? t("layers.offlineCache") : t("layers.offline")
        : state?.status === "error"
          ? facilities.length > 0 ? t("layers.cached") : t("layers.unavailable")
          : facilities.length > 0
            ? t("layers.mapped", { count: formatNumber(facilities.length) })
            : t("layers.noMatches");
  const stateMessage = !state
    ? ""
    : state.status === "idle"
      ? t("layers.noRequest")
      : state.status === "loading"
        ? t("layers.queryingOsm")
        : state.status === "ready"
          ? state.cached ? t("layers.loadedCache") : t("layers.mappedFacilities", { count: formatNumber(facilities.length) })
          : state.status === "empty"
            ? state.plan.discs.length === 0 ? t("layers.advanceTimeline") : t("layers.noMappedFacilities")
            : state.status === "offline"
              ? facilities.length > 0 ? t("layers.offlineOlderCache") : t("layers.offlineNoCache")
              : state.cached ? `${state.message} ${t("layers.showingCache")}` : state.message;
  const visibleFacilities = facilities.slice(0, 18);
  return (
    <li className="layer-inspector__row layer-inspector__row--facilities" data-active={enabled ? "true" : "false"}>
      <div className="layer-inspector__summary">
        <span className="layer-inspector__state" aria-hidden>{enabled ? <UiIcon name="check" size={12} /> : null}</span>
        <span className="layer-inspector__label">
          <strong>{t("layers.humanitarian")}</strong>
          <small>{t("layers.humanitarianDetail")}</small>
        </span>
        <label className="layer-inspector__switch">
          <input
            type="checkbox"
            aria-label={t("layers.showHumanitarian")}
            checked={enabled}
            onChange={(event) => onEnabledChange(event.target.checked)}
          />
          <span>{status}</span>
        </label>
      </div>
      <div className="layer-inspector__facility-body" data-visible={enabled ? "true" : "false"}>
        <p className="layer-inspector__network-note">
          {t("layers.networkNote")}
        </p>
        {enabled && state && (
          <>
            <div className="layer-inspector__facility-status" role="status" aria-live="polite">
              <span>{stateMessage}</span>
              {state.status !== "loading" && (
                <button type="button" onClick={onRefresh}>{t("layers.reload")}</button>
              )}
            </div>
            {facilities.length > 0 && (
              <>
                <dl className="layer-inspector__facility-counts">
                  {(Object.keys(FACILITY_CATEGORY_LABEL_KEYS) as HumanitarianFacilityCategory[]).map((category) => (
                    <div key={category}>
                      <dt>{t(FACILITY_CATEGORY_LABEL_KEYS[category])}</dt>
                      <dd>{formatNumber(counts[category])}</dd>
                    </div>
                  ))}
                </dl>
                <ol className="layer-inspector__facility-list">
                  {visibleFacilities.map((facility) => (
                    <li key={facility.id} data-category={facility.category}>
                      <a href={facility.osmUrl} target="_blank" rel="noreferrer">{facility.name}</a>
                      <span>{t(FACILITY_CATEGORY_LABEL_KEYS[facility.category])} · {facility.kind.replaceAll("_", " ")}</span>
                    </li>
                  ))}
                </ol>
                {facilities.length > visibleFacilities.length && (
                  <p className="layer-inspector__facility-more">
                    {t("layers.moreMapped", { count: formatNumber(facilities.length - visibleFacilities.length) })}
                  </p>
                )}
              </>
            )}
            {(state.plan.truncatedDiscCount > 0 || state.plan.clampedDiscCount > 0) && (
              <p className="layer-inspector__facility-budget">
                {t(state.plan.clampedDiscCount > 0 ? "layers.queryGuardrailsCapped" : "layers.queryGuardrails", {
                  active: formatNumber(state.plan.discs.length),
                  total: formatNumber(state.plan.totalEligibleDiscs),
                  capped: formatNumber(state.plan.clampedDiscCount),
                })}
              </p>
            )}
          </>
        )}
        <p className="layer-inspector__limitations">
          {t("layers.limitations")}
        </p>
        <a className="layer-inspector__osm-credit" href={OSM_ATTRIBUTION_URL} target="_blank" rel="noreferrer">
          © OpenStreetMap contributors
        </a>
      </div>
      <TrustDisclosure evidence={evidence} compact />
    </li>
  );
}

export function LayerInspector({
  domain,
  hasSource,
  hasWavefront,
  hasSweField,
  hasMaxField,
  arrivalCount,
  runupCount,
  dartCount,
  hasFallout,
  preset = null,
  initial = null,
  sourceKind = null,
  directResult = null,
  humanitarianEnabled = false,
  humanitarianState = null,
  onHumanitarianEnabledChange = () => undefined,
  onRefreshHumanitarian = () => undefined,
  onOpenSettings,
}: Props) {
  const { t, formatNumber } = useI18n();
  const tsunamiDomain = domain === "tsunami";
  const evidence = (layer: EvidenceLayerId) => buildLayerEvidence(
    layer,
    preset,
    initial,
    sourceKind,
    directResult,
    tsunamiDomain ? null : domain,
  );
  return (
    <div className="section layer-inspector">
      <div className="section__title">
        <span>{t("layers.title")}</span>
        <span className="section__badge" data-tone={hasSource ? "success" : "muted"}>{hasSource ? t("layers.sourceReady") : t("layers.noSource")}</span>
      </div>
      <p className="layer-inspector__intro">
        {t("layers.intro")}
      </p>
      <ul className="layer-inspector__list">
        <LayerRow label={tsunamiDomain ? t("layers.sourceGeometry") : t("layers.effectsOrigin")} detail={tsunamiDomain ? t("layers.sourceGeometryDetail") : t("layers.effectsOriginDetail")} active={hasSource} evidence={evidence("source")} />
        {tsunamiDomain && <LayerRow label={t("layers.wavefront")} detail={t("layers.wavefrontDetail")} active={hasWavefront} evidence={evidence("analytical-wavefront")} />}
        {tsunamiDomain && <LayerRow label={t("layers.sweField")} detail={t("layers.sweFieldDetail")} active={hasSweField} evidence={evidence("swe-field")} />}
        {tsunamiDomain && <LayerRow label={t("layers.maximumField")} detail={t("layers.maximumFieldDetail")} active={hasMaxField} evidence={evidence("maximum-field")} />}
        {tsunamiDomain && <LayerRow label={t("layers.arrivalIsochrones")} detail={arrivalCount > 0 ? t("layers.contourLevels", { count: formatNumber(arrivalCount) }) : t("layers.afterPropagation")} active={arrivalCount > 0} evidence={evidence("arrival-isochrones")} />}
        {tsunamiDomain && <LayerRow label={t("layers.coastalRunup")} detail={runupCount > 0 ? t("layers.coastalPoints", { count: formatNumber(runupCount) }) : t("layers.fromActiveSource")} active={runupCount > 0} evidence={evidence("coastal-runup")} />}
        {tsunamiDomain && (
          <HumanitarianFacilityLayer
            enabled={humanitarianEnabled}
            state={humanitarianState}
            evidence={evidence("humanitarian-facilities")}
            onEnabledChange={onHumanitarianEnabledChange}
            onRefresh={onRefreshHumanitarian}
          />
        )}
        {tsunamiDomain && <LayerRow label={t("layers.dart")} detail={dartCount > 0 ? t("layers.buoyRecords", { count: formatNumber(dartCount) }) : t("layers.instrumentedEvents")} active={dartCount > 0} evidence={evidence("dart-observations")} />}
        {!tsunamiDomain && <LayerRow label={t("layers.hazardRings")} detail={t("layers.hazardRingsDetail")} active={hasSource} evidence={evidence("hazard-rings")} />}
        {domain === "nuclear" && <LayerRow label={t("layers.fallout")} detail={t("layers.falloutDetail")} active={hasFallout} evidence={evidence("fallout-plume")} />}
      </ul>
      <button type="button" className="layer-inspector__configure" onClick={onOpenSettings}>
        {t("layers.configureImagery")}
      </button>
    </div>
  );
}
