import { useEffect, useState } from "react";
import { getRendererQualityDiagnostics, type CesiumQualityDiagnostics } from "../render/quality/cesium-quality-runtime";
import { useI18n } from "../lib/i18n";

export function PerformancePanel({ visible }: { visible: boolean }) {
  const { formatNumber } = useI18n();
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
    <div className="perf-panel" role="status" aria-live="polite" aria-label="Performance diagnostics">
      <div className="perf-panel__header">Performance</div>
      <dl className="perf-panel__grid">
        <dt>Tier</dt>
        <dd data-tone={diag.activeTier === diag.requestedTier ? "normal" : "warning"}>
          {diag.activeTier}{diag.activeTier !== diag.requestedTier ? ` (requested ${diag.requestedTier})` : ""}
        </dd>
        <dt>FPS</dt>
        <dd>{fps ? formatNumber(fps, { maximumFractionDigits: 0 }) : "—"}</dd>
        <dt>P95 frame</dt>
        <dd>{p95 ? `${formatNumber(p95, { maximumFractionDigits: 1 })} ms` : "—"}</dd>
        <dt>Target</dt>
        <dd>{formatNumber(diag.targetFrameTimeMs, { maximumFractionDigits: 1 })} ms ({diag.targetFps} fps)</dd>
        <dt>GPU</dt>
        <dd data-tone={diag.gpuState === "ready" ? "normal" : "warning"}>{diag.gpuState}</dd>
        <dt>Adapter</dt>
        <dd className="perf-panel__adapter">{diag.adapter.renderer}</dd>
        <dt>Auto quality</dt>
        <dd>{diag.automatic ? "on" : "off"}</dd>
        {diag.downgradeCount > 0 && <><dt>Downgrades</dt><dd>{diag.downgradeCount}</dd></>}
        {diag.recoveryCount > 0 && <><dt>Recoveries</dt><dd>{diag.recoveryCount}</dd></>}
        {diag.lastDecision !== "none" && <><dt>Last decision</dt><dd>{diag.lastDecision.replaceAll("_", " ")}</dd></>}
      </dl>
    </div>
  );
}
