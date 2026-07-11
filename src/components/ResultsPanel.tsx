import type { InitialDisplacement } from "../types/scenario";
import { GlossaryTip } from "./GlossaryTip";

type Props = {
  initial: InitialDisplacement | null;
  timeS: number;
  onTimeChange: (s: number) => void;
  showTimeline?: boolean;
};

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

export function ResultsPanel({ initial, timeS, onTimeChange, showTimeline = true }: Props) {
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

  return (
    <>
      <div className="section">
        <div className="section__title">
          <span>Source metrics</span>
          <span className="section__badge" data-tone="success">Ready</span>
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
            <div className="results__label"><GlossaryTip term="cavity_radius">Cavity radius</GlossaryTip></div>
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
