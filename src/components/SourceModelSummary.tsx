import type { InitialDisplacement, Preset } from "../types/scenario";
import { buildSourceEvidence } from "../lib/trust-evidence";
import { TrustDisclosure } from "./TrustDisclosure";
import { UiIcon } from "./UiIcon";
import { useI18n } from "../lib/i18n";
import { useUnits } from "../hooks/useUnits";
import { formatDepth, formatEmbeddedLengthValues, formatLength, formatSpeed, formatVolume, quantityText, type UnitSystem } from "../lib/units";

type Props = {
  preset: Preset | null;
  initial: InitialDisplacement | null;
  onEdit?: () => void;
};

function formatCoord(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(2)}° ${value >= 0 ? positive : negative}`;
}

type Translate = ReturnType<typeof useI18n>["t"];
type FormatNumber = ReturnType<typeof useI18n>["formatNumber"];

function formatSource(preset: Preset | null, t: Translate, formatNumber: FormatNumber, unitSystem: UnitSystem): { type: string; magnitude: string; model: string } {
  if (!preset) return { type: t("source.custom"), magnitude: t("source.scenarioDefined"), model: t("source.cataclysmModel") };
  const { source } = preset;
  if (source.kind === "Earthquake") {
    return { type: t("source.earthquake"), magnitude: `Mᵥ ${formatNumber(source.source.mw, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`, model: t("source.okadaModel") };
  }
  if (source.kind === "Asteroid") {
    return {
      type: t("source.asteroidImpact"),
      magnitude: `${quantityText(formatLength(source.source.diameter_m, formatNumber, unitSystem))} · ${quantityText(formatSpeed(source.source.velocity_m_s, formatNumber, unitSystem))}`,
      model: t("source.wardAsphaugModel"),
    };
  }
  if (source.kind === "Nuclear") {
    return {
      type: t("source.underwaterDetonation"),
      magnitude: `${formatNumber(source.source.yield_kt)} kt TNT`,
      model: t("source.glasstoneModel"),
    };
  }
  if (source.kind === "Meteotsunami") {
    return {
      type: t("source.meteotsunami"),
      magnitude: `${formatNumber(source.source.peak_pressure_pa)} Pa · ${quantityText(formatSpeed(source.source.speed_m_s, formatNumber, unitSystem))}`,
      model: t("source.pressureGradientModel"),
    };
  }
  return {
    type: source.source.kind === "Subaerial" ? t("source.subaerialLandslide") : t("source.submarineLandslide"),
    magnitude: t("source.volumeMillion", { value: quantityText(formatVolume(source.source.volume_m3, formatNumber, unitSystem)) }),
    model: source.source.kind === "Subaerial" ? t("source.fritzHagerModel") : t("source.wattsModel"),
  };
}

export function SourceModelSummary({ preset, initial, onEdit }: Props) {
  const { t, formatNumber } = useI18n();
  const unitSystem = useUnits();
  if (!initial) {
    return (
      <section className="source-model" data-ready="false" aria-label={t("source.model")}>
        <div className="source-model__header">
          <span>{t("source.model")}</span>
          <span className="section__badge" data-tone="muted">{t("source.notConfigured")}</span>
        </div>
        <div className="empty-state empty-state--compact">
          <span className="empty-state__icon" aria-hidden />
          <div>
            <strong>{t("source.noActive")}</strong>
            <p>{t("source.noActiveBody")}</p>
          </div>
        </div>
      </section>
    );
  }

  const source = formatSource(preset, t, formatNumber, unitSystem);
  const depth = initial.center.depth_m ?? 0;
  const confidence = preset?.is_speculative ? t("source.scenarioConfidence") : t("source.referenceConfidence");
  const evidence = buildSourceEvidence(preset, initial, preset?.source.kind ?? null);

  return (
    <section className="source-model" data-ready="true" aria-label={t("source.summary")}>
      <div className="source-model__header">
        <span>{t("source.model")}</span>
        <span className="section__badge" data-tone="success">
          <UiIcon name="check" size={12} /> {t("source.modelReady")}
        </span>
      </div>
      <dl className="source-model__rows">
        <div><dt>{t("source.scenario")}</dt><dd>{preset?.name ?? formatEmbeddedLengthValues(initial.label, formatNumber, unitSystem)}</dd></div>
        <div><dt>{t("source.eventType")}</dt><dd>{source.type}</dd></div>
        {preset?.date && <div><dt>{t("source.date")}</dt><dd>{preset.date}</dd></div>}
        <div>
          <dt>{t("source.location")}</dt>
          <dd>{formatCoord(initial.center.lat_deg, "N", "S")}, {formatCoord(initial.center.lon_deg, "E", "W")}</dd>
        </div>
        <div><dt>{t("source.depth")}</dt><dd>{quantityText(formatDepth(depth, formatNumber, unitSystem))}</dd></div>
        <div><dt>{t("source.magnitude")}</dt><dd>{source.magnitude}</dd></div>
        <div><dt>{t("source.model")}</dt><dd>{source.model}</dd></div>
      </dl>
      {onEdit && (
        <button className="source-model__edit" type="button" onClick={onEdit}>
          <UiIcon name="mapPin" size={14} /> {t("source.editParameters")}
        </button>
      )}
      <div className="source-model__confidence">
        <div>
          <span>{t("source.modelConfidence")}</span>
          <strong>{confidence}</strong>
        </div>
        <div className="source-model__confidence-track" data-speculative={preset?.is_speculative ? "true" : "false"} aria-hidden>
          <span /><span /><span /><span /><span />
        </div>
        <small>{preset?.is_speculative ? t("source.whatIfNote") : t("source.referenceNote")}</small>
      </div>
      <div className="source-model__trust">
        <TrustDisclosure evidence={evidence} compact />
      </div>
    </section>
  );
}
