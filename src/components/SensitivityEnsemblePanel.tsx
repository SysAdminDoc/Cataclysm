import { useEffect, useRef, useState } from "react";
import { downloadBlob } from "../lib/export";
import { useI18n } from "../lib/i18n";
import type { MessageKey } from "../lib/i18n-core";
import { settings, type ColormapId } from "../lib/settings";
import { api, createSimulationRunId, isTauri } from "../lib/tauri";
import type {
  InitialDisplacement,
  MetricPercentiles,
  SensitivityEnsembleRequest,
  SensitivityEnsembleResponse,
  SensitivityParameterId,
  SimulateGridRequest,
} from "../types/scenario";
import { UiIcon } from "./UiIcon";

type Props = {
  initial: InitialDisplacement;
  useBathymetry: boolean;
  bathymetryAssetId: string;
  cellsPerDegree: number;
  includeLambWave: boolean;
  boundaryMode: "sponge" | "radiation";
};

type ParameterDraft = {
  id: SensitivityParameterId;
  labelKey: MessageKey;
  selected: boolean;
  lower: number;
  upper: number;
  citationLabel: string;
  citationUrl: string;
};

type ExportArtifact = {
  schema_version: 1;
  exported_at_utc: string;
  request: SensitivityEnsembleRequest;
  response: SensitivityEnsembleResponse;
};

const DEFAULT_PARAMETERS: ParameterDraft[] = [
  {
    id: "initial_amplitude",
    labelKey: "swe.sensitivityAmplitude",
    selected: true,
    lower: 0.8,
    upper: 1.2,
    citationLabel: "USGS ShakeMap uncertainty",
    citationUrl: "https://www.usgs.gov/publications/quantifying-and-qualifying-usgs-shakemap-uncertainty",
  },
  {
    id: "source_width",
    labelKey: "swe.sensitivityWidth",
    selected: false,
    lower: 0.75,
    upper: 1.25,
    citationLabel: "USGS probabilistic tsunami hazard analysis",
    citationUrl: "https://www.usgs.gov/publications/probabilistic-tsunami-hazard-analysis-multiple-sources-and-global-applications",
  },
  {
    id: "mean_depth",
    labelKey: "swe.sensitivityDepth",
    selected: false,
    lower: 0.9,
    upper: 1.1,
    citationLabel: "OpenQuake scenario workflow",
    citationUrl: "https://docs.openquake.org/oq-engine/3.22/manual/user-guide/workflows/scenario-hazard.html",
  },
];

function makeGridRequest(
  initial: InitialDisplacement,
  props: Omit<Props, "initial">,
  colormap: ColormapId,
): SimulateGridRequest {
  const halfDeg = Math.min(25, Math.max(2, (initial.cavity_radius_m / 1000) * 0.05 + 4));
  return {
    source: initial.center,
    initial_amplitude_m: initial.peak_amplitude_m,
    source_sigma_m: Math.max(initial.cavity_radius_m, 5000),
    source_geometry: initial.source_geometry ?? null,
    mean_depth_m: Math.max(initial.center.depth_m ?? 4000, 50),
    use_real_bathymetry: props.useBathymetry,
    bathymetry_asset_id: props.useBathymetry && props.bathymetryAssetId
      ? props.bathymetryAssetId
      : null,
    box_half_size_deg: halfDeg,
    cells_per_deg: props.cellsPerDegree,
    resolution_mode: "advanced",
    t_end_s: 60 * 60,
    n_snapshots: 2,
    include_lamb_wave: props.includeLambWave,
    meteotsunami_forcing: initial.meteotsunami_forcing ?? null,
    colormap,
    boundary_mode: props.boundaryMode,
    gauge_points: [],
  };
}

function metricText(value: number | null, suffix: string, formatNumber: ReturnType<typeof useI18n>["formatNumber"]): string {
  return value === null
    ? "—"
    : `${formatNumber(value, { maximumFractionDigits: value < 10 ? 2 : 1 })} ${suffix}`;
}

export function SensitivityEnsemblePanel(props: Props) {
  const { t, formatNumber } = useI18n();
  const [parameters, setParameters] = useState<ParameterDraft[]>(DEFAULT_PARAMETERS);
  const [sampleCount, setSampleCount] = useState(9);
  const [seed, setSeed] = useState(42);
  const [status, setStatus] = useState<"idle" | "running" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [artifact, setArtifact] = useState<ExportArtifact | null>(null);
  const runIdRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => () => {
    requestIdRef.current += 1;
    const runId = runIdRef.current;
    runIdRef.current = null;
    if (runId) void api.cancelSimulation(runId).catch(() => {});
  }, []);

  useEffect(() => {
    setArtifact(null);
    setError(null);
    setStatus("idle");
  }, [props.initial]);

  const selected = parameters.filter((parameter) => parameter.selected);
  const boundsValid = selected.length > 0 && selected.every((parameter) => (
    Number.isFinite(parameter.lower)
    && Number.isFinite(parameter.upper)
    && parameter.lower >= 0.1
    && parameter.lower < 1
    && parameter.upper > 1
    && parameter.upper <= 10
  ));

  const updateParameter = (id: SensitivityParameterId, update: Partial<ParameterDraft>) => {
    setParameters((current) => current.map((parameter) => (
      parameter.id === id ? { ...parameter, ...update } : parameter
    )));
  };

  const run = async () => {
    if (!boundsValid || !isTauri()) return;
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    const runId = createSimulationRunId();
    runIdRef.current = runId;
    setStatus("running");
    setError(null);
    try {
      const colormap = await settings.getColormap();
      const request: SensitivityEnsembleRequest = {
        base: makeGridRequest(props.initial, props, colormap),
        parameters: selected.map((parameter) => ({
          id: parameter.id,
          lower_factor: parameter.lower,
          upper_factor: parameter.upper,
          bound_basis: "User-declared educational sensitivity range; the citation documents uncertainty or scenario-ensemble practice and does not prescribe this numeric range.",
          citation_url: parameter.citationUrl,
        })),
        sample_count: sampleCount,
        seed,
      };
      const response = await api.simulateSensitivityEnsemble(runId, request);
      if (requestId !== requestIdRef.current) return;
      runIdRef.current = null;
      setArtifact({
        schema_version: 1,
        exported_at_utc: new Date().toISOString(),
        request,
        response,
      });
      setStatus("ready");
    } catch (cause) {
      if (requestId !== requestIdRef.current) return;
      runIdRef.current = null;
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("error");
    }
  };

  const cancel = () => {
    requestIdRef.current += 1;
    const runId = runIdRef.current;
    runIdRef.current = null;
    if (runId) void api.cancelSimulation(runId).catch(() => {});
    setStatus("idle");
    setError(null);
  };

  const exportJson = () => {
    if (!artifact) return;
    const result = downloadBlob(
      new Blob([`${JSON.stringify(artifact, null, 2)}\n`], { type: "application/json" }),
      `cataclysm-sensitivity-envelope-seed-${artifact.response.seed}.json`,
    );
    if (!result.ok) setError(result.message);
  };

  const rows: Array<{ label: string; values: MetricPercentiles; suffix: string }> = artifact ? [
    { label: t("swe.sensitivityPeak"), values: artifact.response.peak_elevation_m, suffix: "m" },
    { label: t("swe.sensitivityArrival"), values: artifact.response.arrival_s, suffix: "s" },
    { label: t("swe.sensitivityRunup"), values: artifact.response.runup_m, suffix: "m" },
  ] : [];

  return (
    <details className="swe__sensitivity">
      <summary>
        <span>{t("swe.sensitivityTitle")}</span>
        <small>{t("swe.sensitivityNotProbability")}</small>
      </summary>
      <div className="swe__sensitivity-body">
        <p>{t("swe.sensitivityIntro")}</p>
        <p className="swe__sensitivity-warning">{t("swe.sensitivityRangeCaveat")}</p>
        <div className="swe__sensitivity-parameters">
          {parameters.map((parameter) => {
            const disabled = parameter.id === "mean_depth" && props.useBathymetry;
            return (
              <div className="swe__sensitivity-parameter" key={parameter.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={parameter.selected && !disabled}
                    disabled={disabled || status === "running"}
                    onChange={(event) => updateParameter(parameter.id, { selected: event.target.checked })}
                  />
                  <strong>{t(parameter.labelKey)}</strong>
                </label>
                <div className="swe__sensitivity-bounds">
                  <label>
                    {t("swe.sensitivityLower")}
                    <input
                      type="number"
                      min="0.1"
                      max="0.99"
                      step="0.05"
                      value={parameter.lower}
                      disabled={!parameter.selected || disabled || status === "running"}
                      onChange={(event) => updateParameter(parameter.id, { lower: Number(event.target.value) })}
                      aria-label={`${t(parameter.labelKey)} ${t("swe.sensitivityLower")}`}
                    />
                  </label>
                  <label>
                    {t("swe.sensitivityUpper")}
                    <input
                      type="number"
                      min="1.01"
                      max="10"
                      step="0.05"
                      value={parameter.upper}
                      disabled={!parameter.selected || disabled || status === "running"}
                      onChange={(event) => updateParameter(parameter.id, { upper: Number(event.target.value) })}
                      aria-label={`${t(parameter.labelKey)} ${t("swe.sensitivityUpper")}`}
                    />
                  </label>
                  <a href={parameter.citationUrl} target="_blank" rel="noreferrer">{parameter.citationLabel}</a>
                </div>
                {disabled && <small>{t("swe.sensitivityDepthDisabled")}</small>}
              </div>
            );
          })}
        </div>
        <div className="swe__sensitivity-controls">
          <label>
            {t("swe.sensitivitySamples")}
            <select
              value={sampleCount}
              disabled={status === "running"}
              onChange={(event) => setSampleCount(Number(event.target.value))}
            >
              {[5, 9, 15, 21, 31].map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
          </label>
          <label>
            {t("swe.sensitivitySeed")}
            <input
              type="number"
              min="0"
              max={Number.MAX_SAFE_INTEGER}
              step="1"
              value={seed}
              disabled={status === "running"}
              onChange={(event) => setSeed(Math.max(0, Math.trunc(Number(event.target.value))))}
            />
          </label>
          {status === "running" ? (
            <button type="button" onClick={cancel}>{t("swe.cancel")}</button>
          ) : (
            <button type="button" className="primary" disabled={!boundsValid} onClick={() => void run()}>
              {t("swe.sensitivityRun")}
            </button>
          )}
        </div>
        {!boundsValid && <p className="panel-error" role="alert">{t("swe.sensitivityBoundsInvalid")}</p>}
        {status === "running" && <p role="status">{t("swe.sensitivityRunning", { count: formatNumber(sampleCount) })}</p>}
        {error && <p className="panel-error" role="alert">{error}</p>}
        {artifact && (
          <div className="swe__sensitivity-results">
            <div className="swe__sensitivity-result-head">
              <strong>{t("swe.sensitivityResults")}</strong>
              <span>{t("swe.sensitivityMemberCounts", {
                completed: formatNumber(artifact.response.completed_members),
                failed: formatNumber(artifact.response.failed_members),
                cancelled: formatNumber(artifact.response.cancelled_members),
              })}</span>
            </div>
            <table>
              <caption>{t("swe.sensitivityTableCaption")}</caption>
              <thead><tr><th scope="col">{t("swe.sensitivityMetric")}</th><th scope="col">P05</th><th scope="col">P50</th><th scope="col">P95</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}<small>{t("swe.sensitivityValid", { count: formatNumber(row.values.valid_samples) })}</small></th>
                    <td>{metricText(row.values.p05, row.suffix, formatNumber)}</td>
                    <td>{metricText(row.values.p50, row.suffix, formatNumber)}</td>
                    <td>{metricText(row.values.p95, row.suffix, formatNumber)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>{artifact.response.direct_effects.reason}</p>
            <p className="swe__sensitivity-warning">{artifact.response.caveats[0]}</p>
            <button type="button" onClick={exportJson}>
              <UiIcon name="download" size={14} />
              {t("swe.sensitivityExport")}
            </button>
          </div>
        )}
      </div>
    </details>
  );
}
