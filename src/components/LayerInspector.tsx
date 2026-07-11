import { UiIcon } from "./UiIcon";

type Props = {
  hasSource: boolean;
  hasWavefront: boolean;
  hasSweField: boolean;
  hasMaxField: boolean;
  arrivalCount: number;
  runupCount: number;
  dartCount: number;
  hasFallout: boolean;
  onOpenSettings: () => void;
};

function LayerRow({ label, detail, active }: { label: string; detail: string; active: boolean }) {
  return (
    <li className="layer-inspector__row" data-active={active ? "true" : "false"}>
      <span className="layer-inspector__state" aria-hidden>{active ? <UiIcon name="check" size={12} /> : null}</span>
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <span className="layer-inspector__status">{active ? "Active" : "Waiting"}</span>
    </li>
  );
}

export function LayerInspector({
  hasSource,
  hasWavefront,
  hasSweField,
  hasMaxField,
  arrivalCount,
  runupCount,
  dartCount,
  hasFallout,
  onOpenSettings,
}: Props) {
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
        <LayerRow label="Source geometry" detail="Initial displacement and source marker" active={hasSource} />
        <LayerRow label="Analytical wavefront" detail="Arrival and attenuation geometry" active={hasWavefront} />
        <LayerRow label="SWE water field" detail="Time-varying shallow-water solution" active={hasSweField} />
        <LayerRow label="Maximum field" detail="Peak, time-of-maximum, and energy products" active={hasMaxField} />
        <LayerRow label="Arrival isochrones" detail={arrivalCount > 0 ? `${arrivalCount} contour levels` : "Generated after propagation"} active={arrivalCount > 0} />
        <LayerRow label="Coastal runup" detail={runupCount > 0 ? `${runupCount} evaluated coastal points` : "Computed from the active source"} active={runupCount > 0} />
        <LayerRow label="DART observations" detail={dartCount > 0 ? `${dartCount} historical buoy records` : "Available for instrumented events"} active={dartCount > 0} />
        <LayerRow label="Fallout plume" detail="Wind-driven deposition geometry" active={hasFallout} />
      </ul>
      <button type="button" className="layer-inspector__configure" onClick={onOpenSettings}>
        Configure globe imagery
      </button>
    </div>
  );
}
