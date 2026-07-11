import { useCallback, useEffect, useRef, useState } from "react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import {
  clearDiagnosticsLog,
  installConsoleLogInterception,
  pushExternalDiagnostic,
  readDiagnosticsLog,
  subscribeDiagnostics,
  type LogEntry,
  type SolverDiagnosticPayload,
} from "../lib/diagnosticsLog";
import { api, isTauri } from "../lib/tauri";
import { APP_VERSION } from "../lib/model-provenance";
import { SETTINGS_SCHEMA_VERSION } from "../lib/settings";
import { getEarthDiagnosticsSnapshot } from "../lib/earth-assets";
import { getGeodesyDiagnosticsSnapshot } from "../lib/geodesy";
import { getSurfaceMaskDiagnosticsSnapshot } from "../lib/surface";
import { UiIcon } from "./UiIcon";
import { getRendererQualityDiagnostics } from "../render/quality/cesium-quality-runtime";

type CopyStatus = "idle" | "copied" | "error";

let tauriDiagnosticsListenerInstalled = false;

installConsoleLogInterception();

function installTauriDiagnosticsListener() {
  if (tauriDiagnosticsListenerInstalled || !isTauri()) return;
  tauriDiagnosticsListenerInstalled = true;
  import("@tauri-apps/api/event")
    .then(({ listen }) =>
      listen<SolverDiagnosticPayload>("solver-diagnostic", (event) => {
        pushExternalDiagnostic(event.payload);
      }),
    )
    .catch((err) => {
      console.warn("[diagnostics] failed to attach Rust solver diagnostics listener", err);
    });
}

installTauriDiagnosticsListener();

type Props = {
  open: boolean;
  onClose: () => void;
};

export function LogViewer({ open, onClose }: Props) {
  const [entries, setEntries] = useState<LogEntry[]>(readDiagnosticsLog());
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEscapeKey(onClose, open);
  useFocusTrap(dialogRef, open);

  useEffect(() => {
    const update = () => setEntries(readDiagnosticsLog());
    return subscribeDiagnostics(update);
  }, []);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [entries]);

  useEffect(() => {
    return () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    };
  }, []);

  const setTransientCopyStatus = useCallback((status: CopyStatus) => {
    setCopyStatus(status);
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    if (status !== "idle") {
      copyTimer.current = window.setTimeout(() => setCopyStatus("idle"), 2500);
    }
  }, []);

  const copyAll = useCallback(() => {
    const text = entries
      .map((e) => {
        const t = new Date(e.timestamp).toISOString().slice(11, 23);
        return `[${t}] [${e.level.toUpperCase()}] ${e.message}`;
      })
      .join("\n");
    const header = [
      `Cataclysm diagnostics`,
      `Captured: ${new Date().toISOString()}`,
      `User-Agent: ${navigator.userAgent}`,
      `Entries: ${entries.length}`,
      `---`,
    ].join("\n");
    const writeText = navigator.clipboard?.writeText;
    if (!writeText) {
      setTransientCopyStatus("error");
      return;
    }
    writeText.call(navigator.clipboard, `${header}\n${text}`).then(
      () => setTransientCopyStatus("copied"),
      () => setTransientCopyStatus("error"),
    );
  }, [entries, setTransientCopyStatus]);

  // Support bundle: backend facts (versions, GPU adapter, solver) from the
  // diagnostics_bundle IPC + the recent log tail. PII-free by construction —
  // no paths, no tokens, no settings values.
  const copyBundle = useCallback(async () => {
    const writeText = navigator.clipboard?.writeText;
    if (!writeText) {
      setTransientCopyStatus("error");
      return;
    }
    let backend: Record<string, unknown> = { mode: "browser preview" };
    if (isTauri()) {
      try {
        backend = await api.diagnosticsBundle();
      } catch (err) {
        backend = { mode: "desktop", diagnostics_bundle_error: String(err) };
      }
    }
    const bundle = {
      captured_at: new Date().toISOString(),
      frontend_version: APP_VERSION,
      settings_schema_version: SETTINGS_SCHEMA_VERSION,
      earth_assets: getEarthDiagnosticsSnapshot(),
      geodesy_contract: getGeodesyDiagnosticsSnapshot(),
      surface_mask_contract: getSurfaceMaskDiagnosticsSnapshot(),
      renderer_quality: getRendererQualityDiagnostics(),
      user_agent: navigator.userAgent,
      backend,
      recent_log: entries.slice(-50).map((e) => ({
        t: new Date(e.timestamp).toISOString(),
        level: e.level,
        message: e.message,
      })),
    };
    writeText.call(navigator.clipboard, JSON.stringify(bundle, null, 2)).then(
      () => setTransientCopyStatus("copied"),
      () => setTransientCopyStatus("error"),
    );
  }, [entries, setTransientCopyStatus]);

  const clearLog = useCallback(() => {
    clearDiagnosticsLog();
  }, []);

  if (!open) return null;

  const counts = entries.reduce(
    (acc, entry) => {
      acc[entry.level] += 1;
      return acc;
    },
    { error: 0, info: 0, log: 0, warn: 0 } as Record<LogEntry["level"], number>,
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal log-viewer"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Application log"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2 className="modal__title">Diagnostics log</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close log viewer" type="button">
            <UiIcon name="close" size={16} />
          </button>
        </div>
        <p className="log-viewer__intro">
          Local session diagnostics for export, imagery, and solver errors. Copy this log when reporting a reproducible issue.
        </p>
        <div className="log-viewer__summary" aria-label="Log severity counts">
          <span data-level="error">{counts.error} errors</span>
          <span data-level="warn">{counts.warn} warnings</span>
          <span data-level="info">{counts.info} info</span>
        </div>
        <div className="log-viewer__toolbar">
          <span className="log-viewer__count">{entries.length} entries</span>
          <button
            onClick={copyAll}
            className="log-viewer__btn"
            type="button"
            aria-describedby={copyStatus !== "idle" ? "log-copy-status" : undefined}
          >
            <UiIcon name="copy" size={14} />
            Copy log
          </button>
          <button
            onClick={copyBundle}
            className="log-viewer__btn"
            type="button"
            title="Copy a JSON support bundle: app/OS/GPU facts plus the last 50 log entries. Contains no paths, tokens, or settings values."
          >
            <UiIcon name="copy" size={14} />
            Copy diagnostics
          </button>
          {copyStatus !== "idle" && (
            <span
              id="log-copy-status"
              className="log-viewer__copy-status"
              data-tone={copyStatus === "copied" ? "success" : "error"}
              role={copyStatus === "copied" ? "status" : "alert"}
            >
              {copyStatus === "copied" ? "Copied." : "Copy failed."}
            </span>
          )}
          <button onClick={clearLog} className="log-viewer__btn" type="button">
            <UiIcon name="trash" size={14} />
            Clear
          </button>
        </div>
        <div className="log-viewer__list" ref={listRef}>
          {entries.length === 0 && (
            <div className="empty-state empty-state--compact log-viewer__empty">
              <span className="empty-state__icon" aria-hidden />
              <div>
                <strong>No diagnostics yet</strong>
                <p>Warnings and export or solver failures will appear here during this session.</p>
              </div>
            </div>
          )}
          {entries.map((e, i) => (
            <div key={i} className="log-viewer__entry" data-level={e.level}>
              <span className="log-viewer__time">
                {new Date(e.timestamp).toISOString().slice(11, 23)}
              </span>
              <span className="log-viewer__level">{e.level}</span>
              <span className="log-viewer__msg">{e.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
