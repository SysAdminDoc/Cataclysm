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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function selectedFileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? "Selected raster";
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

function Preview({ report }: { report: BathymetryPreflight }) {
  return (
    <div className="settings__source-card bathymetry-import__preview" aria-label="Bathymetry preflight report">
      <div className="settings__source-heading">
        <strong>{report.file_name}</strong>
        <span>{report.format === "geo_tiff" ? "GeoTIFF" : "NetCDF-CF"}</span>
      </div>
      <dl className="settings__source-grid">
        <div><dt>Grid</dt><dd>{report.width.toLocaleString()} × {report.height.toLocaleString()} · {formatBytes(report.file_size_bytes)}</dd></div>
        <div><dt>Resolution</dt><dd>{report.resolution_deg[0].toPrecision(6)}° × {report.resolution_deg[1].toPrecision(6)}°</dd></div>
        <div><dt>Crop</dt><dd>Full raster · {report.bounds_wgs84.join("°, ")}°</dd></div>
        <div><dt>Resampling</dt><dd>None at import; source grid preserved</dd></div>
        <div><dt>CRS</dt><dd>{report.horizontal_crs} · {report.vertical_datum}</dd></div>
        <div><dt>Vertical values</dt><dd>{report.sample_semantics.replaceAll("_", " ")} · {report.units}</dd></div>
        <div><dt>Depth range</dt><dd>{report.min_depth_m.toLocaleString()}–{report.max_depth_m.toLocaleString()} m</dd></div>
        <div><dt>NoData</dt><dd>{report.nodata_cell_count.toLocaleString()} cells{report.nodata === null ? " · no sentinel" : ` · ${report.nodata}`}</dd></div>
        <div><dt>Wet / dry</dt><dd>{report.wet_cell_count.toLocaleString()} / {report.dry_cell_count.toLocaleString()} cells</dd></div>
        <div><dt>SHA-256</dt><dd><code>{report.sha256}</code></dd></div>
        <div><dt>Source</dt><dd>{report.source_label}</dd></div>
        <div><dt>Rights</dt><dd>{report.rights_statement}</dd></div>
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
  const desktop = isTauri();
  const [path, setPath] = useState("");
  const [variable, setVariable] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [rightsStatement, setRightsStatement] = useState("");
  const [sampleSemantics, setSampleSemantics] = useState<BathymetrySampleSemantics>("depth_positive_down");
  const [preview, setPreview] = useState<BathymetryPreflight | null>(null);
  const [assets, setAssets] = useState<ImportedBathymetryAsset[]>([]);
  const [removedAssetId, setRemovedAssetId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"loading" | "preview" | "import" | "remove" | "restore" | null>(desktop ? "loading" : null);
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
      .catch((cause) => { if (!cancelled) setError(`Cached bathymetry could not be listed: ${errorMessage(cause)}`); })
      .finally(() => { if (!cancelled) setBusy(null); });
    return () => { cancelled = true; };
  }, [desktop]);

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
        title: "Select scientific bathymetry raster",
        filters: [
          { name: "Scientific bathymetry", extensions: ["tif", "tiff", "nc", "cdf", "nc4"] },
        ],
      });
      if (typeof selected === "string") {
        setPath(selected);
        invalidatePreview();
      }
    } catch (cause) {
      setError(`The bathymetry picker could not be opened: ${errorMessage(cause)}`);
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
      setError(`Preflight failed: ${errorMessage(cause)}`);
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
      setMessage(`${asset.report.file_name} is cached for offline use.`);
      window.dispatchEvent(new CustomEvent("cataclysm:bathymetry-cache-changed"));
    } catch (cause) {
      setError(`Import failed: ${errorMessage(cause)}`);
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
      setMessage("Bathymetry moved to the local recovery area.");
      window.dispatchEvent(new CustomEvent("cataclysm:bathymetry-cache-changed"));
    } catch (cause) {
      setError(`Remove failed: ${errorMessage(cause)}`);
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
      setMessage(`${asset.report.file_name} was restored.`);
      window.dispatchEvent(new CustomEvent("cataclysm:bathymetry-cache-changed"));
    } catch (cause) {
      setError(`Restore failed: ${errorMessage(cause)}`);
    } finally {
      setBusy(null);
    }
  }

  if (!desktop) {
    return (
      <section className="settings__section">
        <h3 className="settings__h3">Local scientific bathymetry</h3>
        <p className="modal__intro">Import is available in the desktop app. Browser preview keeps using the bundled coarse bathymetry.</p>
      </section>
    );
  }

  return (
    <section className="settings__section bathymetry-import">
      <h3 className="settings__h3">Local scientific bathymetry</h3>
      <p className="modal__intro">Preview a documented WGS 84 GeoTIFF or NetCDF-CF raster before copying it into the bounded offline cache. Unknown coordinate, datum, axis, or unit metadata is rejected.</p>
      <div className="settings__button-row">
        <button className="scenario-tab" type="button" onClick={() => void chooseFile()} disabled={busy !== null}>
          <UiIcon name="folder" size={14} /> Choose raster
        </button>
        {path && <span className="bathymetry-import__filename">{selectedFileName(path)}</span>}
      </div>
      <div className="bathymetry-import__form">
        <label className="settings__field"><span>NetCDF variable (optional)</span><input value={variable} onChange={(event) => { setVariable(event.target.value); invalidatePreview(); }} placeholder="Auto-detect one depth variable" /></label>
        <label className="settings__field"><span>Vertical convention</span><select value={sampleSemantics} onChange={(event) => { setSampleSemantics(event.target.value as BathymetrySampleSemantics); invalidatePreview(); }}><option value="depth_positive_down">Depth, positive down</option><option value="elevation_positive_up">Elevation, positive up</option></select></label>
        <label className="settings__field"><span>Source / dataset name</span><input value={sourceLabel} onChange={(event) => { setSourceLabel(event.target.value); invalidatePreview(); }} maxLength={160} placeholder="Required provenance label" /></label>
        <label className="settings__field"><span>Rights / permitted use</span><input value={rightsStatement} onChange={(event) => { setRightsStatement(event.target.value); invalidatePreview(); }} maxLength={320} placeholder="Required license or rights statement" /></label>
      </div>
      <div className="settings__button-row">
        <button className="scenario-tab" type="button" onClick={() => void runPreflight()} disabled={!ready || busy !== null}>Preview and validate</button>
        <button className="scenario-tab" type="button" onClick={() => void commitImport()} disabled={!preview || busy !== null}>Import verified raster</button>
        {busy && <span className="settings__status" data-tone="muted" role="status">{busy === "loading" ? "Loading cache…" : `${busy[0].toUpperCase()}${busy.slice(1)} in progress…`}</span>}
      </div>
      {preview && <Preview report={preview} />}
      {error && <div className="panel-error" role="alert">{error}</div>}
      {message && <div className="settings__status" data-tone="success" role="status">{message}</div>}
      {removedAssetId && <button className="scenario-tab" type="button" onClick={() => void restoreAsset()} disabled={busy !== null}>Undo remove</button>}
      {assets.length > 0 && (
        <div className="bathymetry-import__assets" aria-label="Cached bathymetry rasters">
          <strong>Offline cache</strong>
          {assets.map((asset) => (
            <div className="bathymetry-import__asset" key={asset.asset_id}>
              <span><strong>{asset.report.file_name}</strong><small>{asset.report.width.toLocaleString()} × {asset.report.height.toLocaleString()} · {formatBytes(asset.report.file_size_bytes)} · {asset.report.source_label}</small></span>
              <button className="scenario-tab" data-tone="danger" type="button" onClick={() => void removeAsset(asset.asset_id)} disabled={busy !== null}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
