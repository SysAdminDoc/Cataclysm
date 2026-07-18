import { useEffect, useState } from "react";
import { getRendererQualityDiagnostics, type CesiumQualityDiagnostics } from "../render/quality/cesium-quality-runtime";
import { useI18n } from "../lib/i18n";
import type { MessageKey } from "../lib/i18n-core";

export function PerformancePanel({ visible }: { visible: boolean }) {
  const { formatNumber, t } = useI18n();
  const [diag, setDiag] = useState<CesiumQualityDiagnostics | null>(null);

  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => {
      setDiag(getRendererQualityDiagnostics());
    }, 500);
    setDiag(getRendererQualityDiagnostics());
    return () => clearInterval(id);
  }, [visible]);

  if (!visible || !diag) return null;

  const p95 = diag.rollingP95FrameTimeMs;
  const mean = diag.rollingMeanFrameTimeMs;
  const fps = mean && mean > 0 ? 1000 / mean : null;

  return (
    <div className="perf-panel" role="status" aria-live="polite" aria-label={t("perf.aria")}>
      <div className="perf-panel__header">{t("app.performance")}</div>
      <dl className="perf-panel__grid">
        <dt>{t("perf.tier")}</dt>
        <dd data-tone={diag.activeTier === diag.requestedTier ? "normal" : "warning"}>
          {t(`globe.quality.${diag.activeTier}` as MessageKey)}
          {diag.activeTier !== diag.requestedTier
            ? ` (${t("perf.requested", { tier: t(`globe.quality.${diag.requestedTier}` as MessageKey) })})`
            : ""}
        </dd>
        <dt>{t("perf.fps")}</dt>
        <dd>{fps ? formatNumber(fps, { maximumFractionDigits: 0 }) : "—"}</dd>
        <dt>{t("perf.p95")}</dt>
        <dd>{p95 ? `${formatNumber(p95, { maximumFractionDigits: 1 })} ms` : "—"}</dd>
        <dt>{t("perf.target")}</dt>
        <dd>{formatNumber(diag.targetFrameTimeMs, { maximumFractionDigits: 1 })} ms ({formatNumber(diag.targetFps)} fps)</dd>
        <dt>{t("perf.gpu")}</dt>
        <dd data-tone={diag.gpuState === "ready" ? "normal" : "warning"}>{t(`perf.gpu.${diag.gpuState}` as MessageKey)}</dd>
        <dt>{t("perf.adapter")}</dt>
        <dd className="perf-panel__adapter">{diag.adapter.renderer}</dd>
        <dt>{t("perf.autoQuality")}</dt>
        <dd>{diag.automatic ? t("perf.on") : t("perf.off")}</dd>
        {diag.downgradeCount > 0 && <><dt>{t("perf.downgrades")}</dt><dd>{formatNumber(diag.downgradeCount)}</dd></>}
        {diag.recoveryCount > 0 && <><dt>{t("perf.recoveries")}</dt><dd>{formatNumber(diag.recoveryCount)}</dd></>}
        {diag.lastDecision !== "none" && <><dt>{t("perf.lastDecision")}</dt><dd>{t(`perf.decision.${diag.lastDecision}` as MessageKey)}</dd></>}
      </dl>
    </div>
  );
}
