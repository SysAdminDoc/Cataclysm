// Direct-hazard controls are presentation-only. Rust supplies every result,
// including the detonation timeline and fallout dimensions.

import { useState } from "react";
import { sourceBound, sourceEnumValues } from "../lib/scenario-schema";
import {
  WEAPON_PRESETS,
  type AsteroidDetail,
  type AsteroidInput,
  type AsteroidVisualReport,
  type BurstType,
  type HazardResult,
  type NuclearDetail,
  type NuclearInput,
  type NuclearShelterReport,
  type TargetType,
} from "../hazards";
import { CraterDiagram } from "./CraterDiagram";
import { NeoSearch } from "./NeoSearch";
import { LocationSearch } from "./LocationSearch";
import { TrajectoryChart } from "./TrajectoryChart";
import type { NukemapLocationResult } from "../types/nukemap-data";
import type { WorkspaceMode } from "../lib/settings";
import { buildDirectResultEvidence } from "../lib/trust-evidence";
import { NumericField } from "./NumericField";
import { TrustDisclosure } from "./TrustDisclosure";

/** Place a point estimate in its one-significant-digit display bucket. This
 * removes false precision without manufacturing a statistical uncertainty. */
function magnitudeDisplayBand(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  const magnitude = Math.pow(10, Math.floor(Math.log10(n)));
  const lower = Math.floor(n / magnitude) * magnitude;
  const upper = lower + magnitude;
  return `${lower.toLocaleString()}–${upper.toLocaleString()}`;
}

type NumericEntry = {
  value: number;
  min: number;
  max: number;
  step: number | "any";
  unit?: string;
  onCommit: (v: number) => void;
};

type HazardMode = "nuclear" | "asteroid";

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  numeric,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  /** When present, a synchronized exact numeric input in real units replaces
   * the read-only value; the slider stays as an optional coarse control. */
  numeric?: NumericEntry;
}) {
  const formattedValue = format ? format(value) : String(value);
  if (numeric) {
    return (
      <NumericField
        layout="hazard"
        label={label}
        value={numeric.value}
        min={numeric.min}
        max={numeric.max}
        step={numeric.step}
        unit={numeric.unit}
        onCommit={numeric.onCommit}
        slider={{ value, min, max, step, onChange, valueText: formattedValue }}
      />
    );
  }
  return (
    <label className="hazard__row">
      <span className="hazard__row-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        aria-valuetext={formattedValue}
        onChange={(e) => onChange(Number(e.target.value))}
        className="hazard__slider"
      />
      <span className="hazard__row-value">{formattedValue}</span>
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
  onLocationSelect,
  pickActive,
  result,
  asteroidVisuals,
  shelterReport,
  showFireballs = false,
  fireballCount = 0,
  fireballsLoading = false,
  fireballNotice,
  onToggleFireballs,
  windFromDeg,
  onWindChange,
  onDetonate,
  backendAvailable = true,
  display = "all",
  pending = false,
  error = null,
  canAnimate = true,
  workspaceMode = "advanced",
}: {
  mode: HazardMode;
  nuclear: NuclearInput;
  asteroid: AsteroidInput;
  onNuclearChange: (next: NuclearInput) => void;
  onAsteroidChange: (next: AsteroidInput) => void;
  center: { lat: number; lon: number } | null;
  onTogglePick: () => void;
  onLocationSelect?: (result: NukemapLocationResult) => void;
  pickActive: boolean;
  result: HazardResult | null;
  asteroidVisuals?: AsteroidVisualReport | null;
  shelterReport?: NuclearShelterReport | null;
  showFireballs?: boolean;
  fireballCount?: number;
  fireballsLoading?: boolean;
  fireballNotice?: string | null;
  onToggleFireballs?: () => void;
  windFromDeg: number;
  onWindChange: (deg: number) => void;
  onDetonate: () => void;
  backendAvailable?: boolean;
  display?: "all" | "setup" | "results";
  pending?: boolean;
  error?: string | null;
  canAnimate?: boolean;
  workspaceMode?: WorkspaceMode;
}) {
  const nuclearYield = sourceBound("DirectNuclear", "yield_kt");
  const inferredWeaponId = WEAPON_PRESETS.find((preset) =>
    preset.yieldKt === nuclear.yieldKt && preset.burstType === nuclear.burstType,
  )?.id ?? "";
  const [preferredWeaponId, setPreferredWeaponId] = useState(inferredWeaponId);
  const preferredWeapon = WEAPON_PRESETS.find((preset) => preset.id === preferredWeaponId);
  const selectedWeaponId = preferredWeapon?.yieldKt === nuclear.yieldKt
    && preferredWeapon.burstType === nuclear.burstType
    ? preferredWeaponId
    : inferredWeaponId;
  const populationDensity = sourceBound("DirectNuclear", "population_density");
  const windFrom = sourceBound("DirectNuclear", "wind_from_deg");
  const asteroidDiameter = sourceBound("DirectAsteroid", "diameter_m");
  const asteroidVelocity = sourceBound("DirectAsteroid", "velocity_km_s");
  const asteroidAngle = sourceBound("DirectAsteroid", "angle_deg");
  const asteroidDensity = sourceBound("DirectAsteroid", "density_kg_m3");
  const nuclearBurstTypes = sourceEnumValues("DirectNuclear", "burst_type", true);
  const asteroidTargetTypes = sourceEnumValues("DirectAsteroid", "target_type", true);
  const asteroidEffects = mode === "asteroid" ? (result?.detail as AsteroidDetail | undefined) : undefined;
  const nuclearEffects = mode === "nuclear" ? (result?.detail as NuclearDetail | undefined) : undefined;
  const timeline = nuclearEffects?.timeline ?? [];
  const hasFallout = Boolean(nuclearEffects?.fallout);
  const showSetup = display !== "results";
  const showResults = display !== "setup";
  return (
    <div className="section hazard">
      <div className="section__title">
        <span>{display === "results" ? "Hazard results" : mode === "nuclear" ? "Nuclear detonation" : "Asteroid impact"}</span>
        <span className="section__badge" data-tone={result ? "success" : "muted"}>{result ? "Ready" : "Setup"}</span>
      </div>

      {showSetup && <>
      {onLocationSelect && <LocationSearch onSelect={onLocationSelect} />}
      <div className="hazard__location">
        <button
          type="button"
          className="hazard__pick"
          data-active={pickActive ? "true" : "false"}
          aria-pressed={pickActive}
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
              value={selectedWeaponId}
              onChange={(e) => {
                const p = WEAPON_PRESETS.find((w) => w.id === e.target.value);
                if (p) {
                  setPreferredWeaponId(p.id);
                  onNuclearChange({ ...nuclear, yieldKt: p.yieldKt, burstType: p.burstType });
                }
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
            value={Math.log10(Math.max(nuclear.yieldKt, nuclearYield.min))}
            min={Math.log10(nuclearYield.min)}
            max={Math.log10(nuclearYield.max)}
            step={0.01}
            onChange={(v) => onNuclearChange({ ...nuclear, yieldKt: Math.pow(10, v) })}
            format={() => {
              const kt = nuclear.yieldKt;
              return kt < 1 ? `${(kt * 1000).toFixed(0)} t` : kt < 1000 ? `${kt.toFixed(0)} kT` : `${(kt / 1000).toFixed(1)} MT`;
            }}
            numeric={{
              value: nuclear.yieldKt,
              min: nuclearYield.min,
              max: nuclearYield.max,
              step: "any",
              unit: "kT",
              onCommit: (v) => onNuclearChange({ ...nuclear, yieldKt: v }),
            }}
          />
          {workspaceMode !== "simple" && <label className="hazard__row">
            <span className="hazard__row-label">Burst type</span>
            <select
              className="hazard__select"
              value={nuclear.burstType}
              onChange={(e) => onNuclearChange({ ...nuclear, burstType: e.target.value as BurstType })}
            >
              {nuclearBurstTypes.map((value) => (
                <option key={value} value={value}>
                  {value === "airburst" ? "Air burst (optimal height)" : value === "surface" ? "Surface" : value === "hemp" ? "High-altitude EMP (400 km)" : "Water"}
                </option>
              ))}
            </select>
          </label>}
          {nuclear.burstType === "hemp" && (
            <p className="hazard__hint">HEMP mode suppresses ground blast, thermal, prompt-radiation, fallout, and casualty rings. The displayed EMP radius is an educational line-of-sight footprint, not a grid vulnerability forecast.</p>
          )}
          {workspaceMode === "advanced" && <Slider
            label="Population density"
            value={nuclear.populationDensity ?? 0}
            min={populationDensity.min}
            max={populationDensity.max}
            step={100}
            onChange={(v) => onNuclearChange({ ...nuclear, populationDensity: v })}
            format={(v) => (v === 0 ? "off" : `${v.toLocaleString()} /km²`)}
            numeric={{
              value: nuclear.populationDensity ?? 0,
              min: populationDensity.min,
              max: populationDensity.max,
              step: 1,
              unit: "/km²",
              onCommit: (v) => onNuclearChange({ ...nuclear, populationDensity: v }),
            }}
          />}
          {workspaceMode === "advanced" && hasFallout && (
            <Slider
              label="Wind from"
              value={windFromDeg}
              min={windFrom.min}
              max={windFrom.max}
              step={1}
              onChange={onWindChange}
              format={(v) => `${v.toFixed(0)}° (${["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(v / 45) % 8]})`}
              numeric={{
                value: windFromDeg,
                min: windFrom.min,
                max: windFrom.max,
                step: 1,
                unit: "°",
                onCommit: onWindChange,
              }}
            />
          )}
        </>
      ) : (
        <>
          <Slider
            label="Diameter"
            value={asteroid.diameterM}
            min={asteroidDiameter.min}
            max={asteroidDiameter.max}
            step={1}
            onChange={(v) => onAsteroidChange({ ...asteroid, diameterM: v })}
            format={(v) => (v < 1000 ? `${v.toFixed(0)} m` : `${(v / 1000).toFixed(1)} km`)}
            numeric={{
              value: asteroid.diameterM,
              min: asteroidDiameter.min,
              max: asteroidDiameter.max,
              step: 1,
              unit: "m",
              onCommit: (v) => onAsteroidChange({ ...asteroid, diameterM: v }),
            }}
          />
          {workspaceMode !== "simple" && <Slider
            label="Velocity"
            value={asteroid.velocityKmS}
            min={asteroidVelocity.min}
            max={asteroidVelocity.max}
            step={0.5}
            onChange={(v) => onAsteroidChange({ ...asteroid, velocityKmS: v })}
            format={(v) => `${v.toFixed(1)} km/s`}
            numeric={{
              value: asteroid.velocityKmS,
              min: asteroidVelocity.min,
              max: asteroidVelocity.max,
              step: "any",
              unit: "km/s",
              onCommit: (v) => onAsteroidChange({ ...asteroid, velocityKmS: v }),
            }}
          />}
          {workspaceMode !== "simple" && <Slider
            label="Impact angle"
            value={asteroid.angleDeg}
            min={asteroidAngle.min}
            max={asteroidAngle.max}
            step={1}
            onChange={(v) => onAsteroidChange({ ...asteroid, angleDeg: v })}
            format={(v) => `${v.toFixed(0)}°`}
            numeric={{
              value: asteroid.angleDeg,
              min: asteroidAngle.min,
              max: asteroidAngle.max,
              step: 1,
              unit: "°",
              onCommit: (v) => onAsteroidChange({ ...asteroid, angleDeg: v }),
            }}
          />}
          {workspaceMode === "advanced" && <Slider
            label="Density"
            value={asteroid.densityKgM3}
            min={asteroidDensity.min}
            max={asteroidDensity.max}
            step={50}
            onChange={(v) => onAsteroidChange({ ...asteroid, densityKgM3: v })}
            format={(v) => `${v.toLocaleString()} kg/m³`}
            numeric={{
              value: asteroid.densityKgM3,
              min: asteroidDensity.min,
              max: asteroidDensity.max,
              step: 1,
              unit: "kg/m³",
              onCommit: (v) => onAsteroidChange({ ...asteroid, densityKgM3: v }),
            }}
          />}
          <label className="hazard__row">
            <span className="hazard__row-label">Target</span>
            <select
              className="hazard__select"
              value={asteroid.targetType}
              onChange={(e) => onAsteroidChange({ ...asteroid, targetType: e.target.value as TargetType })}
            >
              {asteroidTargetTypes.map((value) => (
                <option key={value} value={value}>{value === "sedimentary_rock" ? "Sedimentary rock" : value === "crystalline_rock" ? "Crystalline rock" : "Water (ocean)"}</option>
              ))}
            </select>
          </label>
          <NeoSearch
            onSelect={(neo) => onAsteroidChange({
              ...asteroid,
              diameterM: Math.min(asteroidDiameter.max, Math.max(asteroidDiameter.min, neo.diameterM)),
              velocityKmS: Math.min(asteroidVelocity.max, Math.max(asteroidVelocity.min, neo.velocityMps / 1_000)),
              densityKgM3: Math.min(asteroidDensity.max, Math.max(asteroidDensity.min, neo.densityKgM3)),
            })}
          />
          {onToggleFireballs ? (
            <div className="fireball-feed">
              <button type="button" aria-pressed={showFireballs} onClick={onToggleFireballs}>
                {showFireballs ? "Hide CNEOS fireballs" : "Show CNEOS fireballs"}
              </button>
              <span role="status">
                {fireballsLoading
                  ? "Loading located events…"
                  : showFireballs
                    ? `${fireballCount} located event${fireballCount === 1 ? "" : "s"} on globe`
                    : "Off"}
              </span>
              {showFireballs && fireballNotice ? <p>{fireballNotice}</p> : null}
            </div>
          ) : null}
        </>
      )}
      </>}

      {showSetup && !showResults && !result && (
        <p className="hazard__hint" role={error ? "alert" : "status"}>
          {error
            ? error
            : !backendAvailable && center
              ? "Direct hazard physics requires the desktop app; browser preview cannot calculate effects."
              : pending && center
                ? "Computing authoritative effects…"
                : center
                  ? "Ready to calculate effects."
                  : "Pick a location on the globe to model effects."}
        </p>
      )}

      {showSetup && result && (
        <button type="button" className="hazard__detonate" onClick={onDetonate} disabled={!canAnimate}>
          {canAnimate
            ? mode === "asteroid" ? "Impact animation" : "Detonation animation"
            : "Animation unavailable"}
        </button>
      )}

      {showResults && (result ? (
        <div className="hazard__results">
          <TrustDisclosure evidence={buildDirectResultEvidence(result)} />
          <div className="hazard__readout">
            {result.readout.map((r) => (
              <div className="hazard__stat" key={r.label} title={r.hint}>
                <span className="hazard__stat-label">{r.label}</span>
                <span className="hazard__stat-value">{r.value}</span>
              </div>
            ))}
          </div>
          {mode === "asteroid" && asteroidEffects && asteroidVisuals ? (
            <section className="hazard__diagrams" aria-label="Impact profile">
              <h3>Impact profile</h3>
              <p>Bounded visualization samples retained by {asteroidVisuals.model}; the browser only draws the returned values.</p>
              <TrajectoryChart
                trajectory={asteroidVisuals.trajectory}
                reachesGround={asteroidEffects.atmosphericEntry.reachesGround}
                breakupAltitude={asteroidEffects.atmosphericEntry.breakupAltitude}
                airburstAltitude={asteroidEffects.atmosphericEntry.airburstAltitude}
              />
              {asteroidVisuals.crater ? <CraterDiagram crater={asteroidVisuals.crater} /> : null}
            </section>
          ) : null}
          {result.casualties && (
            <div className="hazard__casualties">
              <strong>{magnitudeDisplayBand(result.casualties.deaths)}</strong> fatalities ·{" "}
              <strong>{magnitudeDisplayBand(result.casualties.injuries)}</strong> injuries
              <span className="hazard__casualties-detail">
                incl. ~<strong>{magnitudeDisplayBand(result.casualties.childDeaths)}</strong> child
                deaths · ~<strong>{magnitudeDisplayBand(result.casualties.childInjuries)}</strong>{" "}
                child injuries
              </span>
              <span className="hazard__casualties-note">
                Order-of-magnitude display bands around one model estimate—not statistical
                confidence intervals. Assumes {result.casualties.populationDensity.toLocaleString()} people/km²
                uniformly distributed, with fixed indoor/outdoor occupancy and shielding factors, and
                a ~25% under-15 share (UN WPP 2024) for the child slice (educational only).
              </span>
            </div>
          )}
          {nuclearEffects?.latentCancer && (
            <div className="hazard__casualties">
              <strong>{magnitudeDisplayBand(nuclearEffects.latentCancer.cancers30yr)}</strong> latent
              cancer deaths over 30 yr ·{" "}
              <strong>{magnitudeDisplayBand(nuclearEffects.latentCancer.cancers10yr)}</strong> within 10 yr
              <span className="hazard__casualties-note">
                Order-of-magnitude display bands, not confidence intervals. BEIR VII
                linear-no-threshold (~5.5%/Sv), fixed dose zones, and a 50% outer-zone
                survivor assumption; {magnitudeDisplayBand(nuclearEffects.latentCancer.exposed)} exposed
                and {" "}{magnitudeDisplayBand(nuclearEffects.latentCancer.geneticEffects)} hereditary effects.
              </span>
            </div>
          )}
          {mode === "nuclear" && shelterReport?.zones.length ? (
            <details className="hazard__shelter">
              <summary>Shelter screening by effect zone</summary>
              <p>
                Educational comparison scores from the Rust-authoritative {shelterReport.model}.
                These are not personal survival odds or protective-action guidance.
              </p>
              <div className="hazard__shelter-table" role="region" aria-label="Shelter screening table" tabIndex={0}>
                <table>
                  <caption>Relative survival screening score by modeled effect radius</caption>
                  <thead>
                    <tr>
                      <th scope="col">Shelter</th>
                      {shelterReport.zones.map((zone) => (
                        <th
                          scope="col"
                          key={zone.label}
                          aria-label={`${zone.label} ${zone.distanceKm.toFixed(1)} km`}
                        >
                          {zone.label}
                          <small>{zone.distanceKm.toFixed(1)} km</small>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shelterReport.zones[0].shelters.map((shelter, shelterIndex) => (
                      <tr key={shelter.shelterType}>
                        <th scope="row">{shelter.shelterType}</th>
                        {shelterReport.zones.map((zone) => {
                          const assessment = zone.shelters[shelterIndex];
                          return (
                            <td
                              key={zone.label}
                              data-blast-ok={assessment.blastOk ? "true" : "false"}
                              title={`${zone.overpressurePsi.toFixed(1)} psi · ${zone.thermalCalCm2.toFixed(1)} cal/cm²`}
                            >
                              {assessment.survivalPct}%
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="hazard__shelter-limits">
                {shelterReport.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
              </ul>
            </details>
          ) : null}
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

          <button type="button" className="hazard__detonate" onClick={onDetonate} disabled={!canAnimate}>
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
        <p className="hazard__hint" role={error ? "alert" : "status"}>
          {error
            ? error
            : !backendAvailable && center
            ? "Direct hazard physics requires the desktop app; browser preview cannot calculate effects."
            : pending && center
              ? "Computing authoritative effects…"
              : center
                ? "Ready to calculate effects."
                : "Pick a location on the globe to model effects."}
        </p>
      ))}
    </div>
  );
}
