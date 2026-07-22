import { useEffect, useState } from "react";
import type { HazardResult } from "../hazards";
import {
  moveLayer,
  defaultLayerState,
  orderedLayerSettings,
  updateLayerSetting,
  type LayerId,
  type LayerSetting,
  type LayerState,
} from "../lib/layer-controller";
import { buildLayerEvidence, type EvidenceLayerId } from "../lib/trust-evidence";
import type { InitialDisplacement, Preset } from "../types/scenario";
import type { SourceKind } from "./ResultsPanel";
import type { HumanitarianFacilityState } from "../hooks/useHumanitarianFacilities";
import { OSM_ATTRIBUTION_URL, type HumanitarianFacilityCategory } from "../lib/osm-facilities";
import { TrustDisclosure } from "./TrustDisclosure";
import { UiIcon } from "./UiIcon";
import { useI18n } from "../lib/i18n";
import type { MessageKey } from "../lib/i18n-core";
import type { UsgsOfficialComparison } from "../lib/usgs-earthquakes";
import { getActiveEarthSession, subscribeEarthSession } from "../lib/earth-assets";
import { RUNUP_SCREENING_BANDS } from "../lib/hazard-map-literacy";

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
  humanitarianState?: HumanitarianFacilityState | null;
  usgsComparison?: UsgsOfficialComparison | null;
  layerState: LayerState;
  timeS: number;
  onLayerStateChange: (state: LayerState) => void;
  onRefreshHumanitarian?: () => void;
  onOpenSettings: () => void;
};

type LayerDescriptor = Readonly<{
  id: LayerId;
  evidenceId: EvidenceLayerId;
  label: string;
  detail: string;
  available: boolean;
  prerequisite: string;
  temporal: "static" | "timeline" | "result";
  legendClass: string;
}>;

const FACILITY_CATEGORY_LABEL_KEYS: Record<HumanitarianFacilityCategory, MessageKey> = {
  school: "layers.education",
  health: "layers.healthcare",
  emergency: "layers.response",
};

function LayerControls({
  descriptor,
  setting,
  index,
  count,
  timeS,
  evidence,
  onVisible,
  onOpacity,
  onMove,
  children,
}: {
  descriptor: LayerDescriptor;
  setting: LayerSetting;
  index: number;
  count: number;
  timeS: number;
  evidence: ReturnType<typeof buildLayerEvidence>;
  onVisible: (visible: boolean) => void;
  onOpacity: (opacity: number) => void;
  onMove: (delta: -1 | 1) => void;
  children?: React.ReactNode;
}) {
  const { t, formatNumber } = useI18n();
  const visible = descriptor.available && setting.visible;
  const contextualEvidence = descriptor.available ? evidence : {
    ...evidence,
    confidence: descriptor.prerequisite,
    tone: "limited" as const,
  };
  const temporal = descriptor.temporal === "timeline"
    ? t("layers.timelineTime", { value: formatNumber(Math.round(timeS / 60)) })
    : descriptor.temporal === "result"
      ? t("layers.resultCoupled")
      : t("layers.staticLayer");
  return (
    <li
      className="layer-inspector__row"
      data-active={visible ? "true" : "false"}
      data-available={descriptor.available ? "true" : "false"}
    >
      <div className="layer-inspector__summary">
        <label className="layer-inspector__visibility">
          <input
            type="checkbox"
            checked={visible}
            disabled={!descriptor.available}
            aria-label={descriptor.id === "humanitarian-facilities"
              ? t("layers.showHumanitarian")
              : t("layers.showLayer", { label: descriptor.label })}
            onChange={(event) => onVisible(event.target.checked)}
          />
        </label>
        <span className="layer-inspector__label">
          <strong>{descriptor.label}</strong>
          <small>{descriptor.available ? descriptor.detail : descriptor.prerequisite}</small>
        </span>
        <span className="layer-inspector__status">
          {descriptor.available ? visible ? t("layers.shown") : t("layers.hidden") : t("layers.needsData")}
        </span>
      </div>
      {descriptor.available && (
        <div className="layer-inspector__controls">
          <div className="layer-inspector__order" aria-label={t("layers.layerOrder", { label: descriptor.label })}>
            <button
              type="button"
              aria-label={t("layers.moveUp", { label: descriptor.label })}
              title={t("layers.moveUp", { label: descriptor.label })}
              disabled={index === 0}
              onClick={() => onMove(-1)}
            >↑</button>
            <button
              type="button"
              aria-label={t("layers.moveDown", { label: descriptor.label })}
              title={t("layers.moveDown", { label: descriptor.label })}
              disabled={index === count - 1}
              onClick={() => onMove(1)}
            >↓</button>
          </div>
          <label className="layer-inspector__opacity">
            <span>{t("layers.opacity")}</span>
            <input
              type="range"
              min="10"
              max="100"
              step="5"
              value={Math.round(setting.opacity * 100)}
              aria-label={t("layers.opacityFor", { label: descriptor.label })}
              onChange={(event) => onOpacity(Number(event.target.value) / 100)}
            />
            <output>{formatNumber(Math.round(setting.opacity * 100))}%</output>
          </label>
        </div>
      )}
      {children}
      <details className="layer-inspector__evidence">
        <summary>{t("layers.legendProvenance")}</summary>
        <div className="layer-inspector__legend">
          <span className={`layer-inspector__legend-mark ${descriptor.legendClass}`} aria-hidden />
          <span>{descriptor.detail}</span>
          <span>{temporal}</span>
        </div>
        <TrustDisclosure evidence={contextualEvidence} compact compactStatus={descriptor.available ? undefined : t("layers.evidence")} />
      </details>
    </li>
  );
}

function UsgsOfficialDetails({ comparison }: { comparison: UsgsOfficialComparison }) {
  const { t, formatNumber } = useI18n();
  const contourCount = comparison.shakemap?.contours.length ?? 0;
  return (
    <div className="layer-inspector__usgs-body">
      <p>{comparison.stale ? t("layers.usgsCached") : t("layers.usgsCurrent")}</p>
      <dl>
        {comparison.shakemap && (
          <div><dt>{t("layers.usgsShakeMap")}</dt><dd>{t("layers.usgsMmiContours", { count: formatNumber(contourCount), mmi: formatNumber(comparison.shakemap.maxMmi, { maximumFractionDigits: 1 }) })}</dd></div>
        )}
        {comparison.pager && (
          <div><dt>{t("layers.usgsPager")}</dt><dd>{t("layers.usgsPagerAlert", { level: comparison.pager.alertLevel.toUpperCase() })}</dd></div>
        )}
      </dl>
      <a href={comparison.eventUrl} target="_blank" rel="noreferrer">{t("layers.usgsOpenEvent")}</a>
      <small>{t("layers.usgsNotWarning")}</small>
    </div>
  );
}

function HumanitarianFacilityDetails({
  visible,
  state,
  onRefresh,
}: {
  visible: boolean;
  state: HumanitarianFacilityState | null;
  onRefresh: () => void;
}) {
  const { t, formatNumber } = useI18n();
  const facilities = state?.facilities ?? [];
  const counts = facilities.reduce<Record<HumanitarianFacilityCategory, number>>(
    (current, facility) => ({ ...current, [facility.category]: current[facility.category] + 1 }),
    { school: 0, health: 0, emergency: 0 },
  );
  const stateMessage = !state
    ? t("layers.noRequest")
    : state.status === "loading"
      ? t("layers.queryingOsm")
      : state.status === "ready"
        ? state.cached ? t("layers.loadedCache") : t("layers.mappedFacilities", { count: formatNumber(facilities.length) })
        : state.status === "empty"
          ? state.plan.discs.length === 0 ? t("layers.advanceTimeline") : t("layers.noMappedFacilities")
          : state.status === "offline"
            ? facilities.length > 0 ? t("layers.offlineOlderCache") : t("layers.offlineNoCache")
            : state.message;
  if (!visible) return null;
  return (
    <div className="layer-inspector__facility-body">
      <p className="layer-inspector__network-note">{t("layers.networkNote")}</p>
      <div className="layer-inspector__facility-status" role="status" aria-live="polite">
        <span>{stateMessage}</span>
        {state?.status !== "loading" && <button type="button" onClick={onRefresh}>{t("layers.reload")}</button>}
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
            {facilities.slice(0, 18).map((facility) => (
              <li key={facility.id} data-category={facility.category}>
                <a href={facility.osmUrl} target="_blank" rel="noreferrer">{facility.name}</a>
                <span>{t(FACILITY_CATEGORY_LABEL_KEYS[facility.category])} · {facility.kind.replaceAll("_", " ")}</span>
              </li>
            ))}
          </ol>
        </>
      )}
      <p className="layer-inspector__limitations">{t("layers.limitations")}</p>
      <a className="layer-inspector__osm-credit" href={OSM_ATTRIBUTION_URL} target="_blank" rel="noreferrer">
        © OpenStreetMap contributors
      </a>
    </div>
  );
}

function HazardMapReadingGuide() {
  const { t } = useI18n();
  return (
    <aside className="layer-inspector__map-guide" aria-labelledby="hazard-map-reading-title">
      <strong id="hazard-map-reading-title">{t("layers.hazardMapHeading")}</strong>
      <p>{t("layers.hazardMapNotEvacuation")}</p>
      <div className="layer-inspector__screening-bands" aria-label={t("layers.hazardMapLegendLabel")}>
        {RUNUP_SCREENING_BANDS.map((band) => (
          <span key={band.id}>
            <i aria-hidden data-band={band.id} />
            {t(`layers.hazardMapBand.${band.id}` as MessageKey)}
          </span>
        ))}
      </div>
      <small>{t("layers.hazardMapArrival")}</small>
      <a href="https://tsunami.ioc.unesco.org/en/tsunami-ready" target="_blank" rel="noreferrer">
        {t("layers.hazardMapIoc")}
      </a>
    </aside>
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
  humanitarianState = null,
  usgsComparison = null,
  layerState,
  timeS,
  onLayerStateChange,
  onRefreshHumanitarian = () => undefined,
  onOpenSettings,
}: Props) {
  const { t, formatNumber } = useI18n();
  const [earthSession, setEarthSession] = useState(getActiveEarthSession);
  useEffect(() => subscribeEarthSession(setEarthSession), []);
  const tsunamiDomain = domain === "tsunami";
  const terrainDraping = earthSession.terrainAssetId !== "cesium-wgs84-ellipsoid-26.1.0";
  const evidence = (layer: EvidenceLayerId) => buildLayerEvidence(
    layer,
    preset,
    initial,
    sourceKind,
    directResult,
    tsunamiDomain ? null : domain,
  );
  const descriptors: LayerDescriptor[] = tsunamiDomain ? [
    {
      id: "source", evidenceId: "source", label: t("layers.sourceGeometry"), detail: t("layers.sourceGeometryDetail"),
      available: hasSource, prerequisite: t("layers.prerequisiteSource"), temporal: "static", legendClass: "is-source",
    },
    {
      id: "wavefront", evidenceId: "analytical-wavefront", label: t("layers.wavefront"), detail: t("layers.wavefrontDetail"),
      available: hasWavefront, prerequisite: t("layers.prerequisiteTimeline"), temporal: "timeline", legendClass: "is-wavefront",
    },
    {
      id: "swe-field", evidenceId: "swe-field", label: t("layers.sweField"),
      detail: hasMaxField ? t("layers.sweFieldWithProducts") : t("layers.sweFieldDetail"),
      available: hasSweField, prerequisite: t("layers.prerequisiteSwe"), temporal: "timeline", legendClass: "is-field",
    },
    {
      id: "arrival-isochrones", evidenceId: "arrival-isochrones", label: t("layers.arrivalIsochrones"),
      detail: arrivalCount > 0 ? t("layers.contourLevels", { count: formatNumber(arrivalCount) }) : t("layers.afterPropagation"),
      available: arrivalCount > 0, prerequisite: t("layers.prerequisiteArrivals"), temporal: "result", legendClass: "is-arrival",
    },
    {
      id: "coastal-runup", evidenceId: "coastal-runup", label: t("layers.coastalRunup"),
      detail: runupCount > 0 ? t("layers.coastalPoints", { count: formatNumber(runupCount) }) : t("layers.fromActiveSource"),
      available: runupCount > 0, prerequisite: t("layers.prerequisiteRunup"), temporal: "timeline", legendClass: "is-runup",
    },
    {
      id: "humanitarian-facilities", evidenceId: "humanitarian-facilities", label: t("layers.humanitarian"), detail: t("layers.humanitarianDetail"),
      available: runupCount > 0, prerequisite: t("layers.prerequisiteFacilities"), temporal: "result", legendClass: "is-facility",
    },
    {
      id: "usgs-official", evidenceId: "usgs-official", label: t("layers.usgsOfficial"),
      detail: usgsComparison?.shakemap
        ? t("layers.usgsOfficialDetail", { count: formatNumber(usgsComparison.shakemap.contours.length) })
        : t("layers.usgsPagerOnly"),
      available: Boolean(usgsComparison?.shakemap || usgsComparison?.pager),
      prerequisite: t("layers.prerequisiteUsgs"), temporal: "static", legendClass: "is-usgs",
    },
    {
      id: "dart-observations", evidenceId: "dart-observations", label: t("layers.dart"),
      detail: dartCount > 0 ? t("layers.buoyRecords", { count: formatNumber(dartCount) }) : t("layers.instrumentedEvents"),
      available: dartCount > 0, prerequisite: t("layers.prerequisiteDart"), temporal: "static", legendClass: "is-dart",
    },
  ] : [
    {
      id: "source", evidenceId: "source", label: t("layers.effectsOrigin"), detail: t("layers.effectsOriginDetail"),
      available: hasSource, prerequisite: t("layers.prerequisiteDirect"), temporal: "static", legendClass: "is-source",
    },
    {
      id: "hazard-rings", evidenceId: "hazard-rings", label: t("layers.hazardRings"), detail: t("layers.hazardRingsDetail"),
      available: hasSource, prerequisite: t("layers.prerequisiteDirect"), temporal: "result", legendClass: "is-hazard",
    },
    ...(domain === "nuclear" ? [{
      id: "fallout-plume" as const, evidenceId: "fallout-plume" as const, label: t("layers.fallout"), detail: t("layers.falloutDetail"),
      available: hasFallout, prerequisite: t("layers.prerequisiteFallout"), temporal: "result" as const, legendClass: "is-fallout",
    }] : []),
  ];
  const byId = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]));
  const ordered = orderedLayerSettings(layerState, domain)
    .map((setting) => ({ setting, descriptor: byId.get(setting.id) }))
    .filter((entry): entry is { setting: LayerSetting; descriptor: LayerDescriptor } => Boolean(entry.descriptor));

  return (
    <div className="section layer-inspector">
      <div className="section__title">
        <span>{t("layers.title")}</span>
        <button
          type="button"
          className="layer-inspector__reset"
          onClick={() => onLayerStateChange(defaultLayerState(domain))}
          aria-label={t("layers.resetLayers")}
        >
          <UiIcon name="reset" size={13} />
          {t("layers.reset")}
        </button>
      </div>
      <p className="layer-inspector__intro">{t("layers.controllerIntro")}</p>
      {tsunamiDomain && <HazardMapReadingGuide />}
      <p className="layer-inspector__terrain" data-active={terrainDraping ? "true" : "false"}>
        <span aria-hidden />
        {terrainDraping ? t("layers.terrainDraping") : t("layers.terrainFlat")}
      </p>
      <ul className="layer-inspector__list">
        {ordered.map(({ descriptor, setting }, index) => (
          <LayerControls
            key={descriptor.id}
            descriptor={descriptor}
            setting={setting}
            index={index}
            count={ordered.length}
            timeS={timeS}
            evidence={evidence(descriptor.evidenceId)}
            onVisible={(visible) => onLayerStateChange(updateLayerSetting(layerState, descriptor.id, { visible }))}
            onOpacity={(opacity) => onLayerStateChange(updateLayerSetting(layerState, descriptor.id, { opacity }))}
            onMove={(delta) => onLayerStateChange(moveLayer(layerState, domain, descriptor.id, delta))}
          >
            {descriptor.id === "humanitarian-facilities" && (
              <HumanitarianFacilityDetails
                visible={descriptor.available && setting.visible}
                state={humanitarianState}
                onRefresh={onRefreshHumanitarian}
              />
            )}
            {descriptor.id === "usgs-official" && descriptor.available && usgsComparison && (
              <UsgsOfficialDetails comparison={usgsComparison} />
            )}
          </LayerControls>
        ))}
      </ul>
      <button type="button" className="layer-inspector__configure" onClick={onOpenSettings}>
        {t("layers.configureImagery")}
      </button>
    </div>
  );
}
