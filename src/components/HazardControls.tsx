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
import { useI18n } from "../lib/i18n";
import { useUnits } from "../hooks/useUnits";
import {
  formatEmbeddedLengthValues,
  formatLength,
  formatMassDensity,
  formatPopulationDensity,
  formatReadoutValue,
  formatSpeed,
  quantityText,
} from "../lib/units";

const FEET_PER_METER = 3.28084;
const MILES_PER_METER = 0.000621371;
const MPH_PER_KM_S = 2236.94;
const LB_FT3_PER_KG_M3 = 0.06242796;
const PEOPLE_SQMI_PER_PEOPLE_SQKM = 2.589988;

/** Place a point estimate in its one-significant-digit display bucket. This
 * removes false precision without manufacturing a statistical uncertainty. */
function magnitudeDisplayBand(n: number, formatNumber: (value: number) => string): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  const magnitude = Math.pow(10, Math.floor(Math.log10(n)));
  const lower = Math.floor(n / magnitude) * magnitude;
  const upper = lower + magnitude;
  return `${formatNumber(lower)}–${formatNumber(upper)}`;
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
  scenarioContext,
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
  scenarioContext?: { title: string; description: string; assumptions: readonly string[] };
}) {
  const { t, formatNumber } = useI18n();
  const unitSystem = useUnits();
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
  const populationFactor = unitSystem === "imperial" ? PEOPLE_SQMI_PER_PEOPLE_SQKM : 1;
  const populationUnit = unitSystem === "imperial" ? "people/mi²" : "people/km²";
  const diameterFactor = unitSystem === "imperial"
    ? asteroid.diameterM * MILES_PER_METER >= 0.1 ? MILES_PER_METER : FEET_PER_METER
    : 1;
  const diameterUnit = unitSystem === "imperial"
    ? diameterFactor === MILES_PER_METER ? "mi" : "ft"
    : "m";
  const velocityFactor = unitSystem === "imperial" ? MPH_PER_KM_S : 1;
  const velocityUnit = unitSystem === "imperial" ? "mph" : "km/s";
  const densityFactor = unitSystem === "imperial" ? LB_FT3_PER_KG_M3 : 1;
  const densityUnit = unitSystem === "imperial" ? "lb/ft³" : "kg/m³";
  const nuclearBurstTypes = sourceEnumValues("DirectNuclear", "burst_type", true);
  const asteroidTargetTypes = sourceEnumValues("DirectAsteroid", "target_type", true);
  const asteroidEffects = mode === "asteroid" ? (result?.detail as AsteroidDetail | undefined) : undefined;
  const nuclearEffects = mode === "nuclear" ? (result?.detail as NuclearDetail | undefined) : undefined;
  const timeline = nuclearEffects?.timeline ?? [];
  const hasFallout = Boolean(nuclearEffects?.fallout);
  const showSetup = display !== "results";
  const showResults = display !== "setup";
  const compass = t("hazard.compass").split("|");
  const profileKey = asteroidEffects?.atmosphericEntry.reachesGround
    ? "hazard.profile.impact" as const
    : "hazard.profile.airburst" as const;
  const stateMessage = !backendAvailable && center
    ? t("hazard.state.desktop")
    : pending && center
      ? t("hazard.state.computing")
      : center
        ? t("hazard.state.ready")
        : t("hazard.state.pick");
  return (
    <div className="section hazard">
      <div className="section__title">
        <span>{display === "results" ? t("hazard.title.results") : mode === "nuclear" ? t("hazard.title.nuclear") : t("hazard.title.asteroid")}</span>
        <span className="section__badge" data-tone={result ? "success" : "muted"}>{result ? t("hazard.status.ready") : t("hazard.status.setup")}</span>
      </div>

      {scenarioContext && (
        <aside className="hazard__scenario-context" aria-label={scenarioContext.title}>
          <strong>{scenarioContext.title}</strong>
          <p>{formatEmbeddedLengthValues(scenarioContext.description, formatNumber, unitSystem)}</p>
          <details>
            <summary>{t("pd.assumptions")}</summary>
            <ul>{scenarioContext.assumptions.map((assumption) => <li key={assumption}>{formatEmbeddedLengthValues(assumption, formatNumber, unitSystem)}</li>)}</ul>
          </details>
        </aside>
      )}

      {showSetup && <>
      {onLocationSelect && <LocationSearch onSelect={onLocationSelect} purpose="target" />}
      <div className="hazard__location">
        <button
          type="button"
          className="hazard__pick"
          data-active={pickActive ? "true" : "false"}
          aria-pressed={pickActive}
          onClick={onTogglePick}
        >
          {pickActive ? t("hazard.location.click") : center ? t("hazard.location.change") : t("hazard.location.pick")}
        </button>
        <span className="hazard__coord">
          {center
            ? `${formatNumber(center.lat, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}°, ${formatNumber(center.lon, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}°`
            : t("hazard.location.unset")}
        </span>
      </div>

      {mode === "nuclear" ? (
        <>
          <label className="hazard__row">
            <span className="hazard__row-label">{t("hazard.weaponPreset")}</span>
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
              <option value="">{t("hazard.custom")}</option>
              {WEAPON_PRESETS.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} — {formatEmbeddedLengthValues(w.note, formatNumber, unitSystem)}
                </option>
              ))}
            </select>
          </label>
          <Slider
            label={t("hazard.field.yield")}
            value={Math.log10(Math.max(nuclear.yieldKt, nuclearYield.min))}
            min={Math.log10(nuclearYield.min)}
            max={Math.log10(nuclearYield.max)}
            step={0.01}
            onChange={(v) => onNuclearChange({ ...nuclear, yieldKt: Math.pow(10, v) })}
            format={() => {
              const kt = nuclear.yieldKt;
              return kt < 1
                ? `${formatNumber(kt * 1000, { maximumFractionDigits: 0 })} t`
                : kt < 1000
                  ? `${formatNumber(kt, { maximumFractionDigits: 0 })} kT`
                  : `${formatNumber(kt / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MT`;
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
            <span className="hazard__row-label">{t("hazard.field.burstType")}</span>
            <select
              className="hazard__select"
              value={nuclear.burstType}
              onChange={(e) => onNuclearChange({ ...nuclear, burstType: e.target.value as BurstType })}
            >
              {nuclearBurstTypes.map((value) => (
                <option key={value} value={value}>
                  {value === "airburst"
                    ? t("hazard.burst.air")
                    : value === "surface"
                      ? t("hazard.burst.surface")
                      : value === "hemp"
                        ? t("hazard.burst.hemp", { altitude: quantityText(formatLength(400_000, formatNumber, unitSystem)) })
                        : t("hazard.burst.water")}
                </option>
              ))}
            </select>
          </label>}
          {nuclear.burstType === "hemp" && (
            <p className="hazard__hint">{t("hazard.hempNotice")}</p>
          )}
          {workspaceMode === "advanced" && <Slider
            label={t("hazard.field.populationDensity")}
            value={nuclear.populationDensity ?? 0}
            min={populationDensity.min}
            max={populationDensity.max}
            step={100}
            onChange={(v) => onNuclearChange({ ...nuclear, populationDensity: v })}
            format={(v) => (v === 0 ? t("hazard.off") : quantityText(formatPopulationDensity(v, formatNumber, unitSystem)))}
            numeric={{
              value: (nuclear.populationDensity ?? 0) * populationFactor,
              min: populationDensity.min * populationFactor,
              max: populationDensity.max * populationFactor,
              step: 1,
              unit: populationUnit,
              onCommit: (v) => onNuclearChange({ ...nuclear, populationDensity: v / populationFactor }),
            }}
          />}
          {workspaceMode === "advanced" && hasFallout && (
            <Slider
              label={t("hazard.field.windFrom")}
              value={windFromDeg}
              min={windFrom.min}
              max={windFrom.max}
              step={1}
              onChange={onWindChange}
              format={(v) => `${formatNumber(v, { maximumFractionDigits: 0 })}° (${compass[Math.round(v / 45) % 8]})`}
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
            label={t("hazard.field.diameter")}
            value={asteroid.diameterM}
            min={asteroidDiameter.min}
            max={asteroidDiameter.max}
            step={1}
            onChange={(v) => onAsteroidChange({ ...asteroid, diameterM: v })}
            format={(v) => quantityText(formatLength(v, formatNumber, unitSystem))}
            numeric={{
              value: asteroid.diameterM * diameterFactor,
              min: asteroidDiameter.min * diameterFactor,
              max: asteroidDiameter.max * diameterFactor,
              step: "any",
              unit: diameterUnit,
              onCommit: (v) => onAsteroidChange({ ...asteroid, diameterM: v / diameterFactor }),
            }}
          />
          {workspaceMode !== "simple" && <Slider
            label={t("hazard.field.velocity")}
            value={asteroid.velocityKmS}
            min={asteroidVelocity.min}
            max={asteroidVelocity.max}
            step={0.5}
            onChange={(v) => onAsteroidChange({ ...asteroid, velocityKmS: v })}
            format={(v) => quantityText(formatSpeed(v * 1000, formatNumber, unitSystem))}
            numeric={{
              value: asteroid.velocityKmS * velocityFactor,
              min: asteroidVelocity.min * velocityFactor,
              max: asteroidVelocity.max * velocityFactor,
              step: "any",
              unit: velocityUnit,
              onCommit: (v) => onAsteroidChange({ ...asteroid, velocityKmS: v / velocityFactor }),
            }}
          />}
          {workspaceMode !== "simple" && <Slider
            label={t("hazard.field.impactAngle")}
            value={asteroid.angleDeg}
            min={asteroidAngle.min}
            max={asteroidAngle.max}
            step={1}
            onChange={(v) => onAsteroidChange({ ...asteroid, angleDeg: v })}
            format={(v) => `${formatNumber(v, { maximumFractionDigits: 0 })}°`}
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
            label={t("hazard.field.density")}
            value={asteroid.densityKgM3}
            min={asteroidDensity.min}
            max={asteroidDensity.max}
            step={50}
            onChange={(v) => onAsteroidChange({ ...asteroid, densityKgM3: v })}
            format={(v) => quantityText(formatMassDensity(v, formatNumber, unitSystem))}
            numeric={{
              value: asteroid.densityKgM3 * densityFactor,
              min: asteroidDensity.min * densityFactor,
              max: asteroidDensity.max * densityFactor,
              step: "any",
              unit: densityUnit,
              onCommit: (v) => onAsteroidChange({ ...asteroid, densityKgM3: v / densityFactor }),
            }}
          />}
          <label className="hazard__row">
            <span className="hazard__row-label">{t("hazard.field.target")}</span>
            <select
              className="hazard__select"
              value={asteroid.targetType}
              onChange={(e) => onAsteroidChange({ ...asteroid, targetType: e.target.value as TargetType })}
            >
              {asteroidTargetTypes.map((value) => (
                <option key={value} value={value}>{value === "sedimentary_rock" ? t("hazard.target.sedimentary") : value === "crystalline_rock" ? t("hazard.target.crystalline") : t("hazard.target.water")}</option>
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
                {showFireballs ? t("hazard.fireballs.hide") : t("hazard.fireballs.show")}
              </button>
              <span role="status">
                {fireballsLoading
                  ? t("hazard.fireballs.loading")
                  : showFireballs
                    ? fireballCount === 1 ? t("hazard.fireballs.one") : t("hazard.fireballs.many", { count: formatNumber(fireballCount) })
                    : t("hazard.off")}
              </span>
              {showFireballs && fireballNotice ? <p>{fireballNotice}</p> : null}
            </div>
          ) : null}
        </>
      )}
      </>}

      {showSetup && !showResults && !result && (
        <p className="hazard__hint" role={error ? "alert" : "status"}>
          {error ?? stateMessage}
        </p>
      )}

      {showSetup && result && (
        <button type="button" className="hazard__detonate" onClick={onDetonate} disabled={!canAnimate}>
          {canAnimate
            ? mode === "asteroid" ? t("hazard.animation.impact") : t("hazard.animation.detonation")
            : t("hazard.animation.unavailable")}
        </button>
      )}

      {showResults && (result ? (
        <div className="hazard__results">
          <TrustDisclosure evidence={buildDirectResultEvidence(result)} />
          <div className="hazard__readout">
            {result.readout.map((r) => (
              <div className="hazard__stat" key={r.label} title={r.hint ? formatEmbeddedLengthValues(r.hint, formatNumber, unitSystem) : undefined}>
                <span className="hazard__stat-label">{r.label}</span>
                <span className="hazard__stat-value">{formatReadoutValue(r.value, formatNumber, unitSystem)}</span>
              </div>
            ))}
          </div>
          {mode === "asteroid" && asteroidEffects && asteroidVisuals ? (
            <section className="hazard__diagrams" aria-label={t(profileKey)}>
              <h3>{t(profileKey)}</h3>
              <p>{t("hazard.profile.description", { model: asteroidVisuals.model })}</p>
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
              <strong>{magnitudeDisplayBand(result.casualties.deaths, formatNumber)}</strong> {t("hazard.fatalities")} ·{" "}
              <strong>{magnitudeDisplayBand(result.casualties.injuries, formatNumber)}</strong> {t("hazard.injuries")}
              <span className="hazard__casualties-detail">
                {t("hazard.includingApprox")}<strong>{magnitudeDisplayBand(result.casualties.childDeaths, formatNumber)}</strong> {t("hazard.childDeaths")} · ~<strong>{magnitudeDisplayBand(result.casualties.childInjuries, formatNumber)}</strong>{" "}
                {t("hazard.childInjuries")}
              </span>
              <span className="hazard__casualties-note">
                {t("hazard.casualtyNote", { density: quantityText(formatPopulationDensity(result.casualties.populationDensity, formatNumber, unitSystem)) })}
              </span>
            </div>
          )}
          {nuclearEffects?.latentCancer && (
            <div className="hazard__casualties">
              <strong>{magnitudeDisplayBand(nuclearEffects.latentCancer.cancers30yr, formatNumber)}</strong> {t("hazard.latent30")} ·{" "}
              <strong>{magnitudeDisplayBand(nuclearEffects.latentCancer.cancers10yr, formatNumber)}</strong> {t("hazard.within10")}
              <span className="hazard__casualties-note">
                {t("hazard.latentNote", {
                  exposed: magnitudeDisplayBand(nuclearEffects.latentCancer.exposed, formatNumber),
                  genetic: magnitudeDisplayBand(nuclearEffects.latentCancer.geneticEffects, formatNumber),
                })}
              </span>
            </div>
          )}
          {mode === "nuclear" && shelterReport?.zones.length ? (
            <details className="hazard__shelter">
              <summary>{t("hazard.shelter.title")}</summary>
              <p>
                {t("hazard.shelter.description", { model: shelterReport.model })}
              </p>
              <div className="hazard__shelter-table" role="region" aria-label={t("hazard.shelter.region")} tabIndex={0}>
                <table>
                  <caption>{t("hazard.shelter.caption")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("hazard.shelter.column")}</th>
                      {shelterReport.zones.map((zone) => (
                        <th
                          scope="col"
                          key={zone.label}
                          aria-label={t("hazard.shelter.zone", { label: zone.label, distance: quantityText(formatLength(zone.distanceKm * 1000, formatNumber, unitSystem)) })}
                        >
                          {zone.label}
                          <small>{quantityText(formatLength(zone.distanceKm * 1000, formatNumber, unitSystem))}</small>
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
                              title={`${formatNumber(zone.overpressurePsi, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} psi · ${formatNumber(zone.thermalCalCm2, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} cal/cm²`}
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
                {shelterReport.limitations.map((limitation) => <li key={limitation}>{formatEmbeddedLengthValues(limitation, formatNumber, unitSystem)}</li>)}
              </ul>
            </details>
          ) : null}
          <ul className="hazard__ring-legend">
            {result.rings.map((ring) => (
              <li key={ring.label}>
                <i data-ring-color={ring.color} aria-hidden />
                <span>{ring.label}</span>
                <span className="hazard__ring-radius">
                  {quantityText(formatLength(ring.radiusM, formatNumber, unitSystem))}
                </span>
              </li>
            ))}
          </ul>

          <button type="button" className="hazard__detonate" onClick={onDetonate} disabled={!canAnimate}>
            {mode === "asteroid" ? t("hazard.action.impact") : t("hazard.action.detonate")}
          </button>

          {timeline.length > 0 && (
            <div className="hazard__timeline">
              <div className="hazard__timeline-title">{t("hazard.timeline")}</div>
              <ol className="hazard__timeline-list">
                {timeline.map((ev, i) => (
                  <li key={`${ev.time}-${i}`} data-cat={ev.category}>
                    <span className="hazard__timeline-time">{ev.time}</span>
                    <span className="hazard__timeline-desc">{formatEmbeddedLengthValues(ev.description, formatNumber, unitSystem)}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      ) : (
        <p className="hazard__hint" role={error ? "alert" : "status"}>
          {error ?? stateMessage}
        </p>
      ))}
    </div>
  );
}
