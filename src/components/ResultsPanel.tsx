import type { InitialDisplacement } from "../types/scenario";
import type { RunupAtPointResult } from "../lib/tauri";
import { exportRunupCsv } from "../lib/export";
import { GlossaryTip } from "./GlossaryTip";

/** The four modelled tsunami source families. `null` covers presets/custom
 * scenarios whose discrete kind is not known to the caller. */
export type SourceKind = "Asteroid" | "Nuclear" | "Earthquake" | "Landslide" | null;

type Props = {
  initial: InitialDisplacement | null;
  timeS: number;
  onTimeChange: (s: number) => void;
  showTimeline?: boolean;
  /** Discrete source family, used to label metrics correctly (an earthquake
   * has no impact "cavity") and to lead with a plain-language outcome. */
  sourceKind?: SourceKind;
  runupResults?: RunupAtPointResult[];
};

/** Source-aware label for `cavity_radius_m`: a real cavity only exists for
 * impact/detonation sources; for fault and slide sources the same field is the
 * effective generating-region radius, so calling it a "cavity" is misleading. */
function cavityLabel(kind: SourceKind): { term: string; text: string } {
  switch (kind) {
    case "Earthquake":
    case "Landslide":
      return { term: "cavity_radius", text: "Source region radius" };
    default:
      return { term: "cavity_radius", text: "Cavity radius" };
  }
}

/** Plain-language "what happened" lead so Results opens with the outcome rather
 * than internal quantities. Kept honest and source-appropriate. */
function describeOutcome(
  initial: InitialDisplacement,
  kind: SourceKind,
): { headline: string; detail: string } {
  const energy = formatEnergy(initial.source_energy_j);
  const energyText = energy.value === "—" ? "an uncertain amount of energy" : `${energy.value} ${energy.unit}`;
  const amp = formatLength(initial.peak_amplitude_m);
  const ampText = amp.value === "—" ? "an uncertain height" : `${amp.value} ${amp.unit}`;
  const mw = formatMagnitude(initial.seismic_mw_equivalent);
  switch (kind) {
    case "Earthquake":
      return {
        headline: `Magnitude ${mw} seafloor earthquake`,
        detail: `Peak seafloor uplift of ${ampText} displaces the water column, radiating a tsunami. Released about ${energyText}.`,
      };
    case "Asteroid":
      return {
        headline: `Asteroid impact releasing ${energyText}`,
        detail: `The impact excavates a water cavity whose ${ampText} rim collapse launches the wave.`,
      };
    case "Nuclear":
      return {
        headline: `Underwater detonation releasing ${energyText}`,
        detail: `The explosion cavity collapse raises a ${ampText} initial water mound (tsunami-equivalent M ${mw}).`,
      };
    case "Landslide":
      return {
        headline: `Landslide-generated wave`,
        detail: `The moving mass pushes up a ${ampText} initial wave, releasing about ${energyText} (tsunami-equivalent M ${mw}).`,
      };
    default:
      return {
        headline: initial.label || "Modelled tsunami source",
        detail: `Initial disturbance of ${ampText}, releasing about ${energyText}.`,
      };
  }
}

function formatEnergy(j: number): { value: string; unit: string } {
  if (!Number.isFinite(j)) return { value: "—", unit: "" };
  const mt = j / 4.184e15;
  if (mt >= 1) {
    const value =
      mt >= 10_000
        ? Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(mt)
        : mt.toLocaleString(undefined, { maximumFractionDigits: 1 });
    return { value, unit: "Mt TNT" };
  }
  const kt = j / 4.184e12;
  if (kt >= 1) return { value: kt.toLocaleString(undefined, { maximumFractionDigits: 1 }), unit: "kt TNT" };
  return { value: j.toExponential(2), unit: "J" };
}

function formatLength(m: number): { value: string; unit: string } {
  if (!Number.isFinite(m)) return { value: "—", unit: "" };
  if (m >= 1000) return { value: (m / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 }), unit: "km" };
  return { value: m.toLocaleString(undefined, { maximumFractionDigits: 1 }), unit: "m" };
}

function formatMagnitude(mw: number): string {
  return Number.isFinite(mw) ? mw.toFixed(2) : "—";
}

function formatCoord(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}° ${ns}, ${Math.abs(lon).toFixed(2)}° ${ew}`;
}

export function ResultsPanel({ initial, timeS, onTimeChange, showTimeline = true, sourceKind = null, runupResults = [] }: Props) {
  if (!initial) {
    return (
      <div className="section">
        <div className="section__title">
          <span>Source metrics</span>
          <span className="section__badge" data-tone="muted">Waiting</span>
        </div>
        <div className="empty-state">
          <span className="empty-state__icon" aria-hidden />
          <div>
            <strong>Choose a source to unlock readouts</strong>
            <p>
              Presets and custom scenarios populate energy, source geometry,
              peak wave amplitude, and equivalent moment magnitude.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const energy = formatEnergy(initial.source_energy_j);
  const cavity = formatLength(initial.cavity_radius_m);
  const amp = formatLength(initial.peak_amplitude_m);
  const wl = initial.dominant_wavelength_m ? formatLength(initial.dominant_wavelength_m) : null;
  const depth = formatLength(initial.center.depth_m ?? 0);
  const totalT = 6 * 3600;
  // Coerce a non-finite timeS to 0 so a bad upstream value can't apply
  // scaleX(NaN) (which collapses the fill bar) or render "NaN minutes".
  const safeTimeS = Number.isFinite(timeS) ? timeS : 0;
  const progress = Math.max(0, Math.min(1, safeTimeS / totalT));
  const outcome = describeOutcome(initial, sourceKind);
  const cavity_label = cavityLabel(sourceKind);
  const coastalResults = [...runupResults]
    .filter((result) => result.has_arrived)
    .sort((left, right) => right.runup_m - left.runup_m)
    .slice(0, 3);

  return (
    <>
      <div className="section">
        <div className="section__title">
          <span>What happened?</span>
          <span className="section__badge" data-tone="success">Ready</span>
        </div>
        <div className="results__outcome">
          <strong className="results__outcome-headline">{outcome.headline}</strong>
          <p className="results__outcome-detail">{outcome.detail}</p>
          <span className="results__outcome-note">
            Modelled first-order tsunami source — educational estimate, not a forecast.
          </span>
        </div>
        <div className="source-summary" aria-label="Source center">
          <span>{formatCoord(initial.center.lat_deg, initial.center.lon_deg)}</span>
          <span>{depth.value} {depth.unit} depth</span>
        </div>
        <div className="results">
          <div className="results__cell" data-tone="primary">
            <div className="results__label">Energy</div>
            <div className="results__value">
              {energy.value}
              {" "}
              <span className="results__unit">{energy.unit}</span>
            </div>
          </div>
          <div className="results__cell" data-tone="secondary">
            <div className="results__label"><GlossaryTip term="mw">Tsunami-equivalent M_w</GlossaryTip></div>
            <div className="results__value">{formatMagnitude(initial.seismic_mw_equivalent)}</div>
          </div>
          <div className="results__cell">
            <div className="results__label"><GlossaryTip term={cavity_label.term}>{cavity_label.text}</GlossaryTip></div>
            <div className="results__value">
              {cavity.value}
              {" "}
              <span className="results__unit">{cavity.unit}</span>
            </div>
          </div>
          <div className="results__cell">
            <div className="results__label">Peak source displacement</div>
            <div className="results__value">
              {amp.value}
              {" "}
              <span className="results__unit">{amp.unit}</span>
            </div>
          </div>
          {wl && (
            <div className="results__cell results__cell--wide">
              <div className="results__label">Dominant wavelength</div>
              <div className="results__value">
                {wl.value}
                {" "}
                <span className="results__unit">{wl.unit}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {coastalResults.length > 0 && <div className="section">
        <div className="section__title">
          <span>Coastal screening estimates</span>
          <span className="section__badge" data-tone="muted">Low confidence</span>
        </div>
        <p className="results__outcome-note">
          Illustrative values use nominal or legacy inputs. Expand a point to audit the exact records.
        </p>
        <button className="results__export" type="button" onClick={() => exportRunupCsv(runupResults)}>
          Export coastal CSV with provenance
        </button>
        {coastalResults.map((result) => <details className="results__provenance" key={result.id}>
          <summary>{result.name} · ~{result.runup_m.toFixed(1)} m runup</summary>
          <dl>
            <dt>Slope</dt><dd>{result.beach_slope_deg}° ± {result.slope_provenance.uncertainty_value ?? "unknown"} {result.slope_provenance.uncertainty_unit}</dd>
            <dt>Slope record</dt><dd>{result.slope_provenance.sample_id} / {result.slope_provenance.record_id}</dd>
            <dt>Depth</dt><dd>{result.offshore_depth_m} m ± {result.depth_provenance.uncertainty_value ?? "unknown"} {result.depth_provenance.uncertainty_unit}</dd>
            <dt>Depth record</dt><dd>{result.depth_provenance.sample_id} / {result.depth_provenance.record_id}</dd>
            <dt>Source and method</dt><dd>{result.slope_provenance.source}; {result.slope_provenance.method}</dd>
            <dt>Datum / resolution / date</dt><dd>{result.slope_provenance.datum}; {result.slope_provenance.resolution}; {result.slope_provenance.observed_or_published}</dd>
          </dl>
        </details>)}
      </div>}

      {showTimeline && <div className="section">
        <div className="section__title">
          <span>Timeline</span>
          <span className="section__badge">{(safeTimeS / 3600).toFixed(2)} h</span>
        </div>
        <div className="timeline">
          <input
            type="range"
            min={0}
            max={totalT}
            step={60}
            value={safeTimeS}
            onChange={(e) => onTimeChange(Number(e.target.value))}
            aria-label="Scenario timeline scrubber"
            aria-valuetext={`${Math.round(safeTimeS / 60)} minutes after source event`}
          />
          <div className="timeline__bar">
            <div className="timeline__fill" style={{ transform: `scaleX(${progress})` }} />
          </div>
          <div className="timeline__readout">
            <span>{(safeTimeS / 60).toFixed(0)} min after source</span>
            <span>{(safeTimeS / 3600).toFixed(2)} h</span>
          </div>
        </div>
      </div>}
    </>
  );
}
