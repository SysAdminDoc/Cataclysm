import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  api,
  isTauri,
  type BathymetryPreflight,
  type BathymetryPreflightRequest,
  type BathymetrySampleSemantics,
  type ImportedBathymetryAsset,
} from "../lib/tauri";
import { UiIcon } from "./UiIcon";
import { useI18n } from "../lib/i18n";
import type { MessageKey } from "../lib/i18n-core";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function selectedFileName(path: string, fallback: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? fallback;
}

type NumberFormatter = ReturnType<typeof useI18n>["formatNumber"];
type BusyState = "loading" | "preview" | "import" | "remove" | "restore";

const BUSY_KEYS: Record<BusyState, MessageKey> = {
  import: "bathy.busy.import",
  loading: "bathy.busy.loading",
  preview: "bathy.busy.preview",
  remove: "bathy.busy.remove",
  restore: "bathy.busy.restore",
};

function formatBytes(bytes: number, formatNumber: NumberFormatter): string {
  if (bytes >= 1024 * 1024) return `${formatNumber(bytes / (1024 * 1024), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MiB`;
  if (bytes >= 1024) return `${formatNumber(bytes / 1024, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KiB`;
  return `${formatNumber(bytes)} B`;
}

function Preview({ report }: { report: BathymetryPreflight }) {
  const { t, formatNumber } = useI18n();
  const semantics = report.sample_semantics === "depth_positive_down"
    ? t("bathy.semantics.depth")
    : t("bathy.semantics.elevation");
  return (
    <div className="settings__source-card bathymetry-import__preview" aria-label={t("bathy.preflight")}>
      <div className="settings__source-heading">
        <strong>{report.file_name}</strong>
        <span>{report.format === "geo_tiff" ? "GeoTIFF" : "NetCDF-CF"}</span>
      </div>
      <dl className="settings__source-grid">
        <div><dt>{t("bathy.grid")}</dt><dd>{formatNumber(report.width)} × {formatNumber(report.height)} · {formatBytes(report.file_size_bytes, formatNumber)}</dd></div>
        <div><dt>{t("bathy.resolution")}</dt><dd>{formatNumber(report.resolution_deg[0], { maximumSignificantDigits: 6 })}° × {formatNumber(report.resolution_deg[1], { maximumSignificantDigits: 6 })}°</dd></div>
        <div><dt>{t("bathy.crop")}</dt><dd>{t("bathy.fullRaster")} · {report.bounds_wgs84.map((value) => `${formatNumber(value, { maximumFractionDigits: 6 })}°`).join(", ")}</dd></div>
        <div><dt>{t("bathy.resampling")}</dt><dd>{t("bathy.noResampling")}</dd></div>
        <div><dt>CRS</dt><dd>{report.horizontal_crs} · {report.vertical_datum}</dd></div>
        <div><dt>{t("bathy.verticalValues")}</dt><dd>{semantics} · {report.units}</dd></div>
        <div><dt>{t("bathy.depthRange")}</dt><dd>{formatNumber(report.min_depth_m)}–{formatNumber(report.max_depth_m)} m</dd></div>
        <div><dt>{t("bathy.noData")}</dt><dd>{formatNumber(report.nodata_cell_count)} {t("bathy.cells")}{report.nodata === null ? ` · ${t("bathy.noSentinel")}` : ` · ${formatNumber(report.nodata)}`}</dd></div>
        <div><dt>{t("bathy.wetDry")}</dt><dd>{formatNumber(report.wet_cell_count)} / {formatNumber(report.dry_cell_count)} {t("bathy.cells")}</dd></div>
        <div><dt>SHA-256</dt><dd><code>{report.sha256}</code></dd></div>
        <div><dt>{t("bathy.source")}</dt><dd>{report.source_label}</dd></div>
        <div><dt>{t("bathy.rights")}</dt><dd>{report.rights_statement}</dd></div>
      </dl>
      {report.warnings.length > 0 && (
        <div className="settings__status" data-tone="warning" role="status">
          {report.warnings.join(" ")}
        </div>
      )}
    </div>
  );
}

export function BathymetryImportPanel() {
  const { t, formatNumber } = useI18n();
  const desktop = isTauri();
  const [path, setPath] = useState("");
  const [variable, setVariable] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [rightsStatement, setRightsStatement] = useState("");
  const [sampleSemantics, setSampleSemantics] = useState<BathymetrySampleSemantics>("depth_positive_down");
  const [preview, setPreview] = useState<BathymetryPreflight | null>(null);
  const [assets, setAssets] = useState<ImportedBathymetryAsset[]>([]);
  const [removedAssetId, setRemovedAssetId] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyState | null>(desktop ? "loading" : null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const request = useMemo<BathymetryPreflightRequest>(() => ({
    path,
    variable: variable.trim() || null,
    source_label: sourceLabel.trim(),
    rights_statement: rightsStatement.trim(),
    sample_semantics: sampleSemantics,
  }), [path, variable, sourceLabel, rightsStatement, sampleSemantics]);
  const ready = path.length > 0 && request.source_label.length > 0 && request.rights_statement.length > 0;

  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    api.listImportedBathymetry()
      .then((items) => { if (!cancelled) setAssets(items); })
      .catch((cause) => { if (!cancelled) setError(t("bathy.error.list", { error: errorMessage(cause) })); })
      .finally(() => { if (!cancelled) setBusy(null); });
    return () => { cancelled = true; };
  }, [desktop, t]);

  function invalidatePreview() {
    setPreview(null);
    setMessage(null);
  }

  async function chooseFile() {
    setError(null);
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: t("bathy.pickerTitle"),
        filters: [
          { name: t("bathy.pickerFilter"), extensions: ["tif", "tiff", "nc", "cdf", "nc4"] },
        ],
      });
      if (typeof selected === "string") {
        setPath(selected);
        invalidatePreview();
      }
    } catch (cause) {
      setError(t("bathy.error.picker", { error: errorMessage(cause) }));
    }
  }

  async function runPreflight() {
    if (!ready || busy) return;
    setBusy("preview");
    setError(null);
    setMessage(null);
    try {
      setPreview(await api.preflightBathymetryImport(request));
    } catch (cause) {
      setPreview(null);
      setError(t("bathy.error.preflight", { error: errorMessage(cause) }));
    } finally {
      setBusy(null);
    }
  }

  async function commitImport() {
    if (!preview || busy) return;
    setBusy("import");
    setError(null);
    try {
      const asset = await api.importBathymetry(request, preview.sha256);
      setAssets((current) => [asset, ...current.filter((item) => item.asset_id !== asset.asset_id)]);
      setPreview(asset.report);
      setRemovedAssetId(null);
      setMessage(t("bathy.cached", { file: asset.report.file_name }));
      window.dispatchEvent(new CustomEvent("cataclysm:bathymetry-cache-changed"));
    } catch (cause) {
      setError(t("bathy.error.import", { error: errorMessage(cause) }));
    } finally {
      setBusy(null);
    }
  }

  async function removeAsset(assetId: string) {
    if (busy) return;
    setBusy("remove");
    setError(null);
    try {
      await api.removeImportedBathymetry(assetId);
      setAssets((current) => current.filter((item) => item.asset_id !== assetId));
      setRemovedAssetId(assetId);
      setMessage(t("bathy.removed"));
      window.dispatchEvent(new CustomEvent("cataclysm:bathymetry-cache-changed"));
    } catch (cause) {
      setError(t("bathy.error.remove", { error: errorMessage(cause) }));
    } finally {
      setBusy(null);
    }
  }

  async function restoreAsset() {
    if (!removedAssetId || busy) return;
    setBusy("restore");
    setError(null);
    try {
      const asset = await api.restoreImportedBathymetry(removedAssetId);
      setAssets((current) => [asset, ...current]);
      setRemovedAssetId(null);
      setMessage(t("bathy.restored", { file: asset.report.file_name }));
      window.dispatchEvent(new CustomEvent("cataclysm:bathymetry-cache-changed"));
    } catch (cause) {
      setError(t("bathy.error.restore", { error: errorMessage(cause) }));
    } finally {
      setBusy(null);
    }
  }

  if (!desktop) {
    return (
      <section className="settings__section">
        <h3 className="settings__h3">{t("bathy.heading")}</h3>
        <p className="modal__intro">{t("bathy.browserOnly")}</p>
      </section>
    );
  }

  return (
    <section className="settings__section bathymetry-import">
      <h3 className="settings__h3">{t("bathy.heading")}</h3>
      <p className="modal__intro">{t("bathy.intro")}</p>
      <div className="settings__button-row">
        <button className="scenario-tab" type="button" onClick={() => void chooseFile()} disabled={busy !== null}>
          <UiIcon name="folder" size={14} /> {t("bathy.choose")}
        </button>
        {path && <span className="bathymetry-import__filename">{selectedFileName(path, t("bathy.selectedRaster"))}</span>}
      </div>
      <div className="bathymetry-import__form">
        <label className="settings__field"><span>{t("bathy.variable")}</span><input value={variable} onChange={(event) => { setVariable(event.target.value); invalidatePreview(); }} placeholder={t("bathy.variablePlaceholder")} /></label>
        <label className="settings__field"><span>{t("bathy.verticalConvention")}</span><select value={sampleSemantics} onChange={(event) => { setSampleSemantics(event.target.value as BathymetrySampleSemantics); invalidatePreview(); }}><option value="depth_positive_down">{t("bathy.depthPositive")}</option><option value="elevation_positive_up">{t("bathy.elevationPositive")}</option></select></label>
        <label className="settings__field"><span>{t("bathy.sourceName")}</span><input value={sourceLabel} onChange={(event) => { setSourceLabel(event.target.value); invalidatePreview(); }} maxLength={160} placeholder={t("bathy.sourcePlaceholder")} /></label>
        <label className="settings__field"><span>{t("bathy.rightsUse")}</span><input value={rightsStatement} onChange={(event) => { setRightsStatement(event.target.value); invalidatePreview(); }} maxLength={320} placeholder={t("bathy.rightsPlaceholder")} /></label>
      </div>
      <div className="settings__button-row">
        <button className="scenario-tab" type="button" onClick={() => void runPreflight()} disabled={!ready || busy !== null}>{t("bathy.preview")}</button>
        <button className="scenario-tab" type="button" onClick={() => void commitImport()} disabled={!preview || busy !== null}>{t("bathy.import")}</button>
        {busy && <span className="settings__status" data-tone="muted" role="status">{t(BUSY_KEYS[busy])}</span>}
      </div>
      {preview && <Preview report={preview} />}
      {error && <div className="panel-error" role="alert">{error}</div>}
      {message && <div className="settings__status" data-tone="success" role="status">{message}</div>}
      {removedAssetId && <button className="scenario-tab" type="button" onClick={() => void restoreAsset()} disabled={busy !== null}>{t("bathy.undo")}</button>}
      {assets.length > 0 && (
        <div className="bathymetry-import__assets" aria-label={t("bathy.cacheAria")}>
          <strong>{t("bathy.cache")}</strong>
          {assets.map((asset) => (
            <div className="bathymetry-import__asset" key={asset.asset_id}>
              <span><strong>{asset.report.file_name}</strong><small>{formatNumber(asset.report.width)} × {formatNumber(asset.report.height)} · {formatBytes(asset.report.file_size_bytes, formatNumber)} · {asset.report.source_label}</small></span>
              <button className="scenario-tab" data-tone="danger" type="button" onClick={() => void removeAsset(asset.asset_id)} disabled={busy !== null}>{t("bathy.remove")}</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
