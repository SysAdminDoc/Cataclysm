import { useEffect, useState } from "react";
import { useI18n } from "../lib/i18n";
import { useUnits } from "../hooks/useUnits";
import { formatLength, formatSpeed, quantityText } from "../lib/units";
import { NumericField } from "./NumericField";
import {
  ASTEROID_DEFLECTION_BOUNDS,
  estimateAsteroidDeflection,
  INITIAL_ASTEROID_DEFLECTION,
} from "../lib/asteroid-deflection";
import type { AsteroidDeflectionEstimate, AsteroidImpactInput } from "../types/scenario";

type Props = {
  asteroid: AsteroidImpactInput;
};

type EstimateState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; value: AsteroidDeflectionEstimate }
  | { status: "error"; message: string };

function quantity(value: number, formatNumber: ReturnType<typeof useI18n>["formatNumber"], unitSystem: ReturnType<typeof useUnits>) {
  return quantityText(formatLength(value, formatNumber, unitSystem));
}

export function AsteroidDeflectionPanel({ asteroid }: Props) {
  const { t, formatNumber } = useI18n();
  const unitSystem = useUnits();
  const [enabled, setEnabled] = useState(false);
  const [impulse_n_s, setImpulse] = useState(INITIAL_ASTEROID_DEFLECTION.impulse_n_s);
  const [lead_time_days, setLeadTime] = useState(INITIAL_ASTEROID_DEFLECTION.lead_time_days);
  const [estimate, setEstimate] = useState<EstimateState>({ status: "idle" });

  useEffect(() => {
    if (!enabled) {
      setEstimate({ status: "idle" });
      return;
    }
    let cancelled = false;
    setEstimate({ status: "loading" });
    estimateAsteroidDeflection(asteroid, { impulse_n_s, lead_time_days })
      .then((value) => {
        if (!cancelled) setEstimate({ status: "ready", value });
      })
      .catch((error) => {
        if (!cancelled) setEstimate({ status: "error", message: String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [asteroid, enabled, impulse_n_s, lead_time_days]);

  const ready = estimate.status === "ready" ? estimate.value : null;
  const miss = ready ? quantity(ready.nominal_miss_distance_m, formatNumber, unitSystem) : null;
  const envelope = ready
    ? `${quantity(ready.nominal_miss_distance_low_m, formatNumber, unitSystem)} – ${quantity(ready.nominal_miss_distance_high_m, formatNumber, unitSystem)}`
    : null;
  const deltaV = ready ? formatSpeed(ready.delta_v_m_s, formatNumber, unitSystem) : null;
  const earthRadius = ready ? quantity(ready.earth_radius_m, formatNumber, unitSystem) : null;

  return (
    <section className="scenario-form__deflection" aria-labelledby="asteroid-deflection-title">
      <div className="scenario-form__deflection-header">
        <div>
          <strong id="asteroid-deflection-title">{t("builder.deflectionTitle")}</strong>
          <p>{t("builder.deflectionBody")}</p>
        </div>
        <label className="scenario-form__deflection-toggle">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          <span>{t("builder.deflectionToggle")}</span>
        </label>
      </div>

      {enabled && (
        <>
          <div className="scenario-form__deflection-fields">
            <NumericField
              layout="scenario"
              label={t("builder.deflectionImpulse")}
              value={impulse_n_s}
              min={ASTEROID_DEFLECTION_BOUNDS.impulse_n_s.min}
              max={ASTEROID_DEFLECTION_BOUNDS.impulse_n_s.max}
              step="any"
              unit="N·s"
              help={t("builder.deflectionImpulseHelp")}
              onCommit={setImpulse}
            />
            <NumericField
              layout="scenario"
              label={t("builder.deflectionLeadTime")}
              value={lead_time_days}
              min={ASTEROID_DEFLECTION_BOUNDS.lead_time_days.min}
              max={ASTEROID_DEFLECTION_BOUNDS.lead_time_days.max}
              step="any"
              unit={t("builder.deflectionDaysUnit")}
              help={t("builder.deflectionLeadTimeHelp")}
              onCommit={setLeadTime}
            />
          </div>

          <div className="scenario-form__deflection-model" role="note">
            <strong>{t("builder.deflectionModelHeading")}</strong>
            <p>{t("builder.deflectionModelBody")}</p>
            <a
              href="https://www.jpl.nasa.gov/news/nasas-dart-mission-changed-orbit-of-asteroid-didymos-around-sun/"
              target="_blank"
              rel="noreferrer noopener"
            >
              {t("builder.deflectionDartReference")}
            </a>
          </div>

          {estimate.status === "loading" && (
            <p className="scenario-form__deflection-status" role="status">{t("builder.deflectionLoading")}</p>
          )}
          {estimate.status === "error" && (
            <p className="scenario-form__deflection-status" data-tone="error" role="alert">
              {t("builder.deflectionError", { error: estimate.message })}
            </p>
          )}
          {ready && miss && envelope && deltaV && earthRadius && (
            <div className="scenario-form__deflection-result" data-outcome={ready.impact_avoided ? "miss" : "impact"} role="status">
              <strong>
                {t(ready.impact_avoided ? "builder.deflectionOutcomeMiss" : "builder.deflectionOutcomeImpact")}
              </strong>
              <div className="scenario-form__deflection-metrics">
                <span>
                  <small>{t("builder.deflectionMissDistance")}</small>
                  <b>{miss}</b>
                </span>
                <span>
                  <small>{t("builder.deflectionDeltaV")}</small>
                  <b>{deltaV.value} {deltaV.unit}</b>
                </span>
                <span>
                  <small>{t("builder.deflectionEnvelope")}</small>
                  <b>{envelope}</b>
                </span>
              </div>
              <label className="scenario-form__deflection-scale">
                <span>{t("builder.deflectionEarthScale", { earth: earthRadius })}</span>
                <progress
                  max={1}
                  value={ready.earth_radius_fraction}
                  aria-label={t("builder.deflectionEarthScaleAria", { earth: earthRadius })}
                />
                <small>{t("builder.deflectionScaleNote")}</small>
              </label>
            </div>
          )}
        </>
      )}
    </section>
  );
}
