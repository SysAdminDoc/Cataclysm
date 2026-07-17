import { useEffect, useMemo, useState } from "react";
import { buildMirvPreview, MIRV_PRESETS, type MirvPreview } from "../lib/mirv";

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
      setError(cause instanceof Error ? cause.message : String(cause));
    }
    return () => onPreviewChange(null);
  }, [center, onPreviewChange, preset]);

  return (
    <section className="section mirv" aria-labelledby="mirv-title">
      <div className="section__title">
        <span id="mirv-title">MIRV pattern preview</span>
        <span className="section__badge" data-tone={preview ? "warning" : "muted"}>{preview ? "Preview" : "Off"}</span>
      </div>
      <p className="mirv__intro">
        Preview the preserved NukeMap dispersal geometry around the current effects origin. Markers are illustrative aim points; no detonation or casualty result is created.
      </p>
      <label className="mirv__field">
        <span>Payload preset</span>
        <select value={presetId} onChange={(event) => setPresetId(event.target.value)}>
          <option value="">MIRV preview off</option>
          {MIRV_PRESETS.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name} — {candidate.warheads} × {candidate.yieldKt.toLocaleString()} kT
            </option>
          ))}
        </select>
      </label>
      {!center && preset && <p className="mirv__notice" role="status">Choose an effects origin to place the pattern.</p>}
      {error && <p className="mirv__notice" role="alert">{error}</p>}
      {preview && (
        <div className="mirv__preview">
          <div className="mirv__summary">
            <div><span>Pattern</span><strong>{preview.preset.pattern}</strong></div>
            <div><span>Warheads</span><strong>{preview.points.length}</strong></div>
            <div><span>Spread</span><strong>{preview.preset.spreadKm} km</strong></div>
            <div><span>Per warhead</span><strong>{preview.preset.yieldKt.toLocaleString()} kT</strong></div>
          </div>
          <button type="button" onClick={() => onApplyYield(preview.preset.yieldKt)}>Use this per-warhead yield</button>
          <details>
            <summary>Accessible aim-point list</summary>
            <ol>
              {preview.points.map((point) => (
                <li key={point.id}>
                  Warhead {point.index}: {point.lat.toFixed(4)}°, {point.lon.toFixed(4)}° at +{point.delayMs} ms
                </li>
              ))}
            </ol>
          </details>
        </div>
      )}
    </section>
  );
}
