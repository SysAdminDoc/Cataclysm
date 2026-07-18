import type { HazardResult } from "../hazards";
import { buildLayerEvidence, type EvidenceLayerId } from "../lib/trust-evidence";
import type { InitialDisplacement, Preset } from "../types/scenario";
import type { SourceKind } from "./ResultsPanel";
import type { HumanitarianFacilityState } from "../hooks/useHumanitarianFacilities";
import { OSM_ATTRIBUTION_URL, type HumanitarianFacilityCategory } from "../lib/osm-facilities";
import { TrustDisclosure } from "./TrustDisclosure";
import { UiIcon } from "./UiIcon";

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
  const contextualEvidence = active ? evidence : {
    ...evidence,
    confidence: "Waiting for prerequisite output",
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
        <span className="layer-inspector__status">{active ? "Active" : "Waiting"}</span>
      </div>
      <TrustDisclosure evidence={contextualEvidence} compact compactStatus={active ? undefined : "Evidence"} />
    </li>
  );
}

const FACILITY_CATEGORY_LABELS: Record<HumanitarianFacilityCategory, string> = {
  school: "Education",
  health: "Healthcare",
  emergency: "Response",
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
  const facilities = state?.facilities ?? [];
  const counts = facilities.reduce<Record<HumanitarianFacilityCategory, number>>(
    (current, facility) => ({ ...current, [facility.category]: current[facility.category] + 1 }),
    { school: 0, health: 0, emergency: 0 },
  );
  const status = !enabled
    ? "Off"
    : state?.status === "loading"
      ? "Loading"
      : state?.status === "offline"
        ? facilities.length > 0 ? "Offline cache" : "Offline"
        : state?.status === "error"
          ? facilities.length > 0 ? "Cached" : "Unavailable"
          : facilities.length > 0
            ? `${facilities.length} mapped`
            : "No matches";
  const visibleFacilities = facilities.slice(0, 18);
  return (
    <li className="layer-inspector__row layer-inspector__row--facilities" data-active={enabled ? "true" : "false"}>
      <div className="layer-inspector__summary">
        <span className="layer-inspector__state" aria-hidden>{enabled ? <UiIcon name="check" size={12} /> : null}</span>
        <span className="layer-inspector__label">
          <strong>Humanitarian facilities</strong>
          <small>Schools, healthcare, and response sites inside runup screening extents</small>
        </span>
        <label className="layer-inspector__switch">
          <input
            type="checkbox"
            aria-label="Show humanitarian facilities from OpenStreetMap"
            checked={enabled}
            onChange={(event) => onEnabledChange(event.target.checked)}
          />
          <span>{status}</span>
        </label>
      </div>
      <div className="layer-inspector__facility-body" data-visible={enabled ? "true" : "false"}>
        <p className="layer-inspector__network-note">
          Opting in sends the active modeled coastal extent boxes to the public Overpass service. Scenario names and source parameters are not sent.
        </p>
        {enabled && state && (
          <>
            <div className="layer-inspector__facility-status" role="status" aria-live="polite">
              <span>{state.message}</span>
              {state.status !== "loading" && (
                <button type="button" onClick={onRefresh}>Reload</button>
              )}
            </div>
            {facilities.length > 0 && (
              <>
                <dl className="layer-inspector__facility-counts">
                  {(Object.keys(FACILITY_CATEGORY_LABELS) as HumanitarianFacilityCategory[]).map((category) => (
                    <div key={category}>
                      <dt>{FACILITY_CATEGORY_LABELS[category]}</dt>
                      <dd>{counts[category]}</dd>
                    </div>
                  ))}
                </dl>
                <ol className="layer-inspector__facility-list">
                  {visibleFacilities.map((facility) => (
                    <li key={facility.id} data-category={facility.category}>
                      <a href={facility.osmUrl} target="_blank" rel="noreferrer">{facility.name}</a>
                      <span>{FACILITY_CATEGORY_LABELS[facility.category]} · {facility.kind.replaceAll("_", " ")}</span>
                    </li>
                  ))}
                </ol>
                {facilities.length > visibleFacilities.length && (
                  <p className="layer-inspector__facility-more">
                    {facilities.length - visibleFacilities.length} more mapped on the globe.
                  </p>
                )}
              </>
            )}
            {(state.plan.truncatedDiscCount > 0 || state.plan.clampedDiscCount > 0) && (
              <p className="layer-inspector__facility-budget">
                Public-query guardrails: {state.plan.discs.length} of {state.plan.totalEligibleDiscs} active extents queried
                {state.plan.clampedDiscCount > 0 ? `; ${state.plan.clampedDiscCount} capped at 25 km` : ""}.
              </p>
            )}
          </>
        )}
        <p className="layer-inspector__limitations">
          Community mapping varies. This screening does not establish damage, operability, access, evacuation status, or emergency needs.
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
        <span>Visualization layers</span>
        <span className="section__badge" data-tone={hasSource ? "success" : "muted"}>{hasSource ? "Source ready" : "No source"}</span>
      </div>
      <p className="layer-inspector__intro">
        Layers activate from simulation output. Quantitative overlays remain synchronized with the active source and scenario time.
      </p>
      <ul className="layer-inspector__list">
        <LayerRow label={tsunamiDomain ? "Source geometry" : "Effects origin"} detail={tsunamiDomain ? "Initial displacement and source marker" : "Direct hazard target and effect center"} active={hasSource} evidence={evidence("source")} />
        {tsunamiDomain && <LayerRow label="Analytical wavefront" detail="Arrival and attenuation geometry" active={hasWavefront} evidence={evidence("analytical-wavefront")} />}
        {tsunamiDomain && <LayerRow label="SWE water field" detail="Time-varying shallow-water solution" active={hasSweField} evidence={evidence("swe-field")} />}
        {tsunamiDomain && <LayerRow label="Maximum field" detail="Peak, time-of-maximum, and energy products" active={hasMaxField} evidence={evidence("maximum-field")} />}
        {tsunamiDomain && <LayerRow label="Arrival isochrones" detail={arrivalCount > 0 ? `${arrivalCount} contour levels` : "Generated after propagation"} active={arrivalCount > 0} evidence={evidence("arrival-isochrones")} />}
        {tsunamiDomain && <LayerRow label="Coastal runup" detail={runupCount > 0 ? `${runupCount} evaluated coastal points` : "Computed from the active source"} active={runupCount > 0} evidence={evidence("coastal-runup")} />}
        {tsunamiDomain && (
          <HumanitarianFacilityLayer
            enabled={humanitarianEnabled}
            state={humanitarianState}
            evidence={evidence("humanitarian-facilities")}
            onEnabledChange={onHumanitarianEnabledChange}
            onRefresh={onRefreshHumanitarian}
          />
        )}
        {tsunamiDomain && <LayerRow label="DART observations" detail={dartCount > 0 ? `${dartCount} historical buoy records` : "Available for instrumented events"} active={dartCount > 0} evidence={evidence("dart-observations")} />}
        {!tsunamiDomain && <LayerRow label="Hazard effect rings" detail="Domain-specific physical thresholds" active={hasSource} evidence={evidence("hazard-rings")} />}
        {domain === "nuclear" && <LayerRow label="Fallout plume" detail="Wind-driven deposition geometry" active={hasFallout} evidence={evidence("fallout-plume")} />}
      </ul>
      <button type="button" className="layer-inspector__configure" onClick={onOpenSettings}>
        Configure globe imagery
      </button>
    </div>
  );
}
