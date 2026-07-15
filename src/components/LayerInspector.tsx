import type { HazardResult } from "../hazards";
import { buildLayerEvidence, type EvidenceLayerId } from "../lib/trust-evidence";
import type { InitialDisplacement, Preset } from "../types/scenario";
import type { SourceKind } from "./ResultsPanel";
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
      <TrustDisclosure evidence={contextualEvidence} compact />
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
