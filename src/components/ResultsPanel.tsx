import type { InitialDisplacement } from "../types/scenario";

type Props = {
  initial: InitialDisplacement | null;
  timeS: number;
  onTimeChange: (s: number) => void;
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

export function ResultsPanel({ initial, timeS, onTimeChange }: Props) {
  if (!initial) {
    return (
      <div className="section">
        <div className="section__title">Source Readout</div>
        <p className="empty-copy">
          Select a preset or simulate a custom source to see energy, cavity geometry,
          peak amplitude, and equivalent moment magnitude.
        </p>
      </div>
    );
  }

  const energy = formatEnergy(initial.source_energy_j);
  const cavity = formatLength(initial.cavity_radius_m);
  const amp = formatLength(initial.peak_amplitude_m);
  const wl = initial.dominant_wavelength_m ? formatLength(initial.dominant_wavelength_m) : null;
  const totalT = 6 * 3600;
  // Coerce a non-finite timeS to 0 so a bad upstream value can't apply
  // scaleX(NaN) (which collapses the fill bar) or render "NaN minutes".
  const safeTimeS = Number.isFinite(timeS) ? timeS : 0;
  const progress = Math.max(0, Math.min(1, safeTimeS / totalT));

  return (
    <>
      <div className="section">
        <div className="section__title">Source Readout</div>
        <div className="results">
          <div className="results__cell">
            <div className="results__label">Energy</div>
            <div className="results__value">
              {energy.value}
              {" "}
              <span className="results__unit">{energy.unit}</span>
            </div>
          </div>
          <div className="results__cell" title="Equivalent moment magnitude (Hanks–Kanamori 1979)">
            <div className="results__label">M_w equivalent</div>
            <div className="results__value">{formatMagnitude(initial.seismic_mw_equivalent)}</div>
          </div>
          <div className="results__cell">
            <div className="results__label">Cavity radius</div>
            <div className="results__value">
              {cavity.value}
              {" "}
              <span className="results__unit">{cavity.unit}</span>
            </div>
          </div>
          <div className="results__cell">
            <div className="results__label">Peak amplitude</div>
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

      <div className="section">
        <div className="section__title">Timeline (t = 0 → 6 h)</div>
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
            <span>t = {(safeTimeS / 60).toFixed(0)} min</span>
            <span>{(safeTimeS / 3600).toFixed(2)} h</span>
          </div>
        </div>
      </div>
    </>
  );
}
