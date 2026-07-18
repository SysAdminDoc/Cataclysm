import { useEffect, useMemo, useState } from "react";
import { buildMirvPreview, MIRV_PRESETS, type MirvPreview } from "../lib/mirv";
import { useI18n } from "../lib/i18n";

export function MIRVPatternPanel({
  center,
  preview,
  onPreviewChange,
  onApplyYield,
}: {
  center: Readonly<{ lat: number; lon: number }> | null;
  preview: MirvPreview | null;
  onPreviewChange: (preview: MirvPreview | null) => void;
  onApplyYield: (yieldKt: number) => void;
}) {
  const { t, formatNumber } = useI18n();
  const [presetId, setPresetId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const preset = useMemo(() => MIRV_PRESETS.find((candidate) => candidate.id === presetId) ?? null, [presetId]);

  useEffect(() => {
    if (!center || !preset) {
      onPreviewChange(null);
      setError(null);
      return;
    }
    try {
      onPreviewChange(buildMirvPreview(center, preset));
      setError(null);
    } catch (cause) {
      onPreviewChange(null);
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message.includes("center must be")
        ? t("mirv.error.center")
        : message.includes("requires 1–20")
          ? t("mirv.error.warheads")
          : message.includes("spread must be")
            ? t("mirv.error.spread")
            : message);
    }
    return () => onPreviewChange(null);
  }, [center, onPreviewChange, preset, t]);

  return (
    <section className="section mirv" aria-labelledby="mirv-title">
      <div className="section__title">
        <span id="mirv-title">{t("mirv.title")}</span>
        <span className="section__badge" data-tone={preview ? "warning" : "muted"}>{preview ? t("mirv.preview") : t("mirv.off")}</span>
      </div>
      <p className="mirv__intro">
        {t("mirv.intro")}
      </p>
      <label className="mirv__field">
        <span>{t("mirv.payload")}</span>
        <select value={presetId} onChange={(event) => setPresetId(event.target.value)}>
          <option value="">{t("mirv.previewOff")}</option>
          {MIRV_PRESETS.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name} — {formatNumber(candidate.warheads)} × {formatNumber(candidate.yieldKt)} kT
            </option>
          ))}
        </select>
      </label>
      {!center && preset && <p className="mirv__notice" role="status">{t("mirv.chooseOrigin")}</p>}
      {error && <p className="mirv__notice" role="alert">{error}</p>}
      {preview && (
        <div className="mirv__preview">
          <div className="mirv__summary">
            <div><span>{t("mirv.pattern")}</span><strong>{t(`mirv.pattern.${preview.preset.pattern}` as Parameters<typeof t>[0])}</strong></div>
            <div><span>{t("mirv.warheads")}</span><strong>{formatNumber(preview.points.length)}</strong></div>
            <div><span>{t("mirv.spread")}</span><strong>{formatNumber(preview.preset.spreadKm)} km</strong></div>
            <div><span>{t("mirv.perWarhead")}</span><strong>{formatNumber(preview.preset.yieldKt)} kT</strong></div>
          </div>
          <button type="button" onClick={() => onApplyYield(preview.preset.yieldKt)}>{t("mirv.useYield")}</button>
          <details>
            <summary>{t("mirv.aimPointList")}</summary>
            <ol>
              {preview.points.map((point) => (
                <li key={point.id}>
                  {t("mirv.aimPoint", { index: formatNumber(point.index), lat: formatNumber(point.lat, { minimumFractionDigits: 4, maximumFractionDigits: 4 }), lon: formatNumber(point.lon, { minimumFractionDigits: 4, maximumFractionDigits: 4 }), delay: formatNumber(point.delayMs) })}
                </li>
              ))}
            </ol>
          </details>
        </div>
      )}
    </section>
  );
}
