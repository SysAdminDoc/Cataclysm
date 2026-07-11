// Cataclysm — client-side hazard controls (nuclear / asteroid). Renders the
// input form for the active standalone hazard plus its result readout. Physics
// runs through the ported src/hazards engines; the parent draws the rings on
// the shared Cesium globe.

import { WEAPON_PRESETS, type AsteroidInput, type HazardResult, type NuclearInput } from "../hazards";
import type { BurstType, NuclearEffects } from "../hazards/nuclear/physics";
import { calcTimeline } from "../hazards/nuclear/timeline";
import type { TargetType } from "../hazards/asteroid/physics/types";

type HazardMode = "nuclear" | "asteroid";

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <label className="hazard__row">
      <span className="hazard__row-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="hazard__slider"
      />
      <span className="hazard__row-value">{format ? format(value) : String(value)}</span>
    </label>
  );
}

export function HazardControls({
  mode,
  nuclear,
  asteroid,
  onNuclearChange,
  onAsteroidChange,
  center,
  onTogglePick,
  pickActive,
  result,
  windFromDeg,
  onWindChange,
  onDetonate,
}: {
  mode: HazardMode;
  nuclear: NuclearInput;
  asteroid: AsteroidInput;
  onNuclearChange: (next: NuclearInput) => void;
  onAsteroidChange: (next: AsteroidInput) => void;
  center: { lat: number; lon: number } | null;
  onTogglePick: () => void;
  pickActive: boolean;
  result: HazardResult | null;
  windFromDeg: number;
  onWindChange: (deg: number) => void;
  onDetonate: () => void;
}) {
  const nuclearEffects = mode === "nuclear" ? (result?.detail as NuclearEffects | undefined) : undefined;
  const timeline = nuclearEffects ? calcTimeline(nuclearEffects) : [];
  const hasFallout = Boolean(nuclearEffects?.fallout);
  return (
    <div className="section hazard">
      <div className="section__title">
        <span>{mode === "nuclear" ? "Nuclear detonation" : "Asteroid impact"}</span>
        <span className="section__badge">client-side</span>
      </div>

      <div className="hazard__location">
        <button
          type="button"
          className="hazard__pick"
          data-active={pickActive ? "true" : "false"}
          onClick={onTogglePick}
        >
          {pickActive ? "Click the globe…" : center ? "Change location" : "Pick location on globe"}
        </button>
        <span className="hazard__coord">
          {center ? `${center.lat.toFixed(2)}°, ${center.lon.toFixed(2)}°` : "no location set"}
        </span>
      </div>

      {mode === "nuclear" ? (
        <>
          <label className="hazard__row">
            <span className="hazard__row-label">Weapon preset</span>
            <select
              className="hazard__select"
              value=""
              onChange={(e) => {
                const p = WEAPON_PRESETS.find((w) => w.id === e.target.value);
                if (p) onNuclearChange({ ...nuclear, yieldKt: p.yieldKt, burstType: p.burstType });
              }}
            >
              <option value="">Custom…</option>
              {WEAPON_PRESETS.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} — {w.note}
                </option>
              ))}
            </select>
          </label>
          <Slider
            label="Yield"
            value={Math.log10(nuclear.yieldKt)}
            min={-3}
            max={5}
            step={0.01}
            onChange={(v) => onNuclearChange({ ...nuclear, yieldKt: Math.pow(10, v) })}
            format={() => {
              const kt = nuclear.yieldKt;
              return kt < 1 ? `${(kt * 1000).toFixed(0)} t` : kt < 1000 ? `${kt.toFixed(0)} kT` : `${(kt / 1000).toFixed(1)} MT`;
            }}
          />
          <label className="hazard__row">
            <span className="hazard__row-label">Burst type</span>
            <select
              className="hazard__select"
              value={nuclear.burstType}
              onChange={(e) => onNuclearChange({ ...nuclear, burstType: e.target.value as BurstType })}
            >
              <option value="airburst">Air burst (optimal height)</option>
              <option value="surface">Surface</option>
              <option value="water">Water</option>
            </select>
          </label>
          <Slider
            label="Population density"
            value={nuclear.populationDensity ?? 0}
            min={0}
            max={20000}
            step={100}
            onChange={(v) => onNuclearChange({ ...nuclear, populationDensity: v })}
            format={(v) => (v === 0 ? "off" : `${v.toLocaleString()} /km²`)}
          />
          {hasFallout && (
            <Slider
              label="Wind from"
              value={windFromDeg}
              min={0}
              max={359}
              step={1}
              onChange={onWindChange}
              format={(v) => `${v.toFixed(0)}° (${["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(v / 45) % 8]})`}
            />
          )}
        </>
      ) : (
        <>
          <Slider
            label="Diameter"
            value={asteroid.diameterM}
            min={1}
            max={20000}
            step={1}
            onChange={(v) => onAsteroidChange({ ...asteroid, diameterM: v })}
            format={(v) => (v < 1000 ? `${v.toFixed(0)} m` : `${(v / 1000).toFixed(1)} km`)}
          />
          <Slider
            label="Velocity"
            value={asteroid.velocityKmS}
            min={11}
            max={72}
            step={0.5}
            onChange={(v) => onAsteroidChange({ ...asteroid, velocityKmS: v })}
            format={(v) => `${v.toFixed(1)} km/s`}
          />
          <Slider
            label="Impact angle"
            value={asteroid.angleDeg}
            min={5}
            max={90}
            step={1}
            onChange={(v) => onAsteroidChange({ ...asteroid, angleDeg: v })}
            format={(v) => `${v.toFixed(0)}°`}
          />
          <Slider
            label="Density"
            value={asteroid.densityKgM3}
            min={500}
            max={9000}
            step={50}
            onChange={(v) => onAsteroidChange({ ...asteroid, densityKgM3: v })}
            format={(v) => `${v.toLocaleString()} kg/m³`}
          />
          <label className="hazard__row">
            <span className="hazard__row-label">Target</span>
            <select
              className="hazard__select"
              value={asteroid.targetType}
              onChange={(e) => onAsteroidChange({ ...asteroid, targetType: e.target.value as TargetType })}
            >
              <option value="sedimentary_rock">Sedimentary rock</option>
              <option value="crystalline_rock">Crystalline rock</option>
              <option value="water">Water (ocean)</option>
            </select>
          </label>
        </>
      )}

      {result ? (
        <div className="hazard__results">
          <div className="hazard__readout">
            {result.readout.map((r) => (
              <div className="hazard__stat" key={r.label} title={r.hint}>
                <span className="hazard__stat-label">{r.label}</span>
                <span className="hazard__stat-value">{r.value}</span>
              </div>
            ))}
          </div>
          {result.casualties && (
            <div className="hazard__casualties">
              <strong>{result.casualties.deaths.toLocaleString()}</strong> est. fatalities ·{" "}
              <strong>{result.casualties.injuries.toLocaleString()}</strong> injuries
              <span className="hazard__casualties-note">
                at {result.casualties.populationDensity.toLocaleString()} /km² (educational estimate)
              </span>
            </div>
          )}
          <ul className="hazard__ring-legend">
            {result.rings.map((ring) => (
              <li key={ring.label}>
                <i style={{ background: ring.color }} aria-hidden />
                <span>{ring.label}</span>
                <span className="hazard__ring-radius">
                  {ring.radiusM < 1000 ? `${ring.radiusM.toFixed(0)} m` : `${(ring.radiusM / 1000).toFixed(1)} km`}
                </span>
              </li>
            ))}
          </ul>

          <button type="button" className="hazard__detonate" onClick={onDetonate}>
            {mode === "asteroid" ? "☄ Impact — asteroid from space" : "▶ Detonate — animate shockwave"}
          </button>

          {timeline.length > 0 && (
            <div className="hazard__timeline">
              <div className="hazard__timeline-title">Detonation timeline</div>
              <ol className="hazard__timeline-list">
                {timeline.map((ev, i) => (
                  <li key={`${ev.time}-${i}`} data-cat={ev.category}>
                    <span className="hazard__timeline-time">{ev.time}</span>
                    <span className="hazard__timeline-desc">{ev.description}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      ) : (
        <p className="hazard__hint">Pick a location on the globe to model effects.</p>
      )}
    </div>
  );
}
