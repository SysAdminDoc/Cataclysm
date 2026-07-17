import type { InitialDisplacement, Preset } from "../types/scenario";
import { buildSourceEvidence } from "../lib/trust-evidence";
import { TrustDisclosure } from "./TrustDisclosure";
import { UiIcon } from "./UiIcon";

type Props = {
  preset: Preset | null;
  initial: InitialDisplacement | null;
  onEdit?: () => void;
};

function formatCoord(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(2)}° ${value >= 0 ? positive : negative}`;
}

function formatSource(preset: Preset | null): { type: string; magnitude: string; model: string } {
  if (!preset) return { type: "Custom source", magnitude: "Scenario-defined", model: "Cataclysm analytical model" };
  const { source } = preset;
  if (source.kind === "Earthquake") {
    return { type: "Earthquake", magnitude: `Mᵥ ${source.source.mw.toFixed(1)}`, model: "Okada dislocation model" };
  }
  if (source.kind === "Asteroid") {
    return {
      type: "Asteroid impact",
      magnitude: `${source.source.diameter_m.toLocaleString()} m · ${(source.source.velocity_m_s / 1000).toFixed(1)} km/s`,
      model: "Ward–Asphaug impact source",
    };
  }
  if (source.kind === "Nuclear") {
    return {
      type: "Underwater detonation",
      magnitude: `${source.source.yield_kt.toLocaleString()} kt TNT`,
      model: "Glasstone–Dolan source model",
    };
  }
  if (source.kind === "Meteotsunami") {
    return {
      type: "Meteotsunami",
      magnitude: `${source.source.peak_pressure_pa.toLocaleString()} Pa · ${source.source.speed_m_s.toFixed(1)} m/s`,
      model: "Moving pressure-gradient source",
    };
  }
  return {
    type: source.source.kind === "Subaerial" ? "Subaerial landslide" : "Submarine landslide",
    magnitude: `${(source.source.volume_m3 / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1 })} million m³`,
    model: source.source.kind === "Subaerial" ? "Fritz–Hager model" : "Watts model",
  };
}

export function SourceModelSummary({ preset, initial, onEdit }: Props) {
  if (!initial) {
    return (
      <section className="source-model" data-ready="false" aria-label="Source model">
        <div className="source-model__header">
          <span>Source model</span>
          <span className="section__badge" data-tone="muted">Not configured</span>
        </div>
        <div className="empty-state empty-state--compact">
          <span className="empty-state__icon" aria-hidden />
          <div>
            <strong>No active source</strong>
            <p>Choose a reference event or define a source below.</p>
          </div>
        </div>
      </section>
    );
  }

  const source = formatSource(preset);
  const depth = initial.center.depth_m ?? 0;
  const confidence = preset?.is_speculative ? "Scenario" : "Reference";
  const evidence = buildSourceEvidence(preset, initial, preset?.source.kind ?? null);

  return (
    <section className="source-model" data-ready="true" aria-label="Source model summary">
      <div className="source-model__header">
        <span>Source model</span>
        <span className="section__badge" data-tone="success">
          <UiIcon name="check" size={12} /> Model ready
        </span>
      </div>
      <dl className="source-model__rows">
        <div><dt>Scenario</dt><dd>{preset?.name ?? initial.label}</dd></div>
        <div><dt>Event type</dt><dd>{source.type}</dd></div>
        {preset?.date && <div><dt>Date</dt><dd>{preset.date}</dd></div>}
        <div>
          <dt>Location</dt>
          <dd>{formatCoord(initial.center.lat_deg, "N", "S")}, {formatCoord(initial.center.lon_deg, "E", "W")}</dd>
        </div>
        <div><dt>Depth</dt><dd>{depth >= 1000 ? `${(depth / 1000).toFixed(1)} km` : `${depth.toFixed(0)} m`}</dd></div>
        <div><dt>Magnitude</dt><dd>{source.magnitude}</dd></div>
        <div><dt>Source model</dt><dd>{source.model}</dd></div>
      </dl>
      {onEdit && (
        <button className="source-model__edit" type="button" onClick={onEdit}>
          <UiIcon name="mapPin" size={14} /> Edit source parameters
        </button>
      )}
      <div className="source-model__confidence">
        <div>
          <span>Model confidence</span>
          <strong>{confidence}</strong>
        </div>
        <div className="source-model__confidence-track" data-speculative={preset?.is_speculative ? "true" : "false"} aria-hidden>
          <span /><span /><span /><span /><span />
        </div>
        <small>{preset?.is_speculative ? "What-if assumptions are preserved in exports." : "Peer-reviewed parameters with documented model limits."}</small>
      </div>
      <div className="source-model__trust">
        <TrustDisclosure evidence={evidence} compact />
      </div>
    </section>
  );
}
