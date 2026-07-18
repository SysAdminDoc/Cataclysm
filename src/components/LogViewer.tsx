import { useCallback, useEffect, useRef, useState } from "react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import {
  clearDiagnosticsLog,
  clearPersistedCrashReport,
  installConsoleLogInterception,
  markCrashReportSeen,
  pushExternalDiagnostic,
  readDiagnosticsLog,
  readPersistedCrashReport,
  redactSensitive,
  serializeRedactedDiagnostics,
  subscribeDiagnostics,
  type CrashReport,
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
import { useI18n } from "../lib/i18n";
import type { MessageKey } from "../lib/i18n-core";

type CopyStatus = "idle" | "copied" | "error";

let tauriDiagnosticsListenerInstalled = false;

const LOG_LEVEL_KEYS: Record<LogEntry["level"], MessageKey> = {
  error: "log.level.error",
  info: "log.level.info",
  log: "log.level.log",
  warn: "log.level.warn",
};

const CRASH_SOURCE_KEYS: Record<CrashReport["source"], MessageKey> = {
  "native-panic": "log.crashSource.native",
  "react-boundary": "log.crashSource.react",
  "unhandled-rejection": "log.crashSource.rejection",
  "window-error": "log.crashSource.window",
};

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
  const { t, formatNumber, languageTag } = useI18n();
  const [entries, setEntries] = useState<LogEntry[]>(readDiagnosticsLog());
  const [crashReport, setCrashReport] = useState<CrashReport | null>(null);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const followTailRef = useRef(true);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEscapeKey(onClose, open);
  useFocusTrap(dialogRef, open);

  useEffect(() => {
    const update = () => setEntries(readDiagnosticsLog());
    return subscribeDiagnostics(update);
  }, []);

  useEffect(() => {
    if (!open) return;
    const report = readPersistedCrashReport();
    setCrashReport(report);
    if (report && !report.seen) markCrashReportSeen();
  }, [open]);

  useEffect(() => {
    if (followTailRef.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [entries]);

  useEffect(() => {
    if (!open) return;
    followTailRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

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
        return `[${t}] [${e.level.toUpperCase()}] ${redactSensitive(e.message)}`;
      })
      .join("\n");
    const header = [
      `Cataclysm diagnostics`,
      `Captured: ${new Date().toISOString()}`,
      `User-Agent: ${redactSensitive(navigator.userAgent)}`,
      `Entries: ${entries.length}`,
      `---`,
    ].join("\n");
    const writeText = navigator.clipboard?.writeText;
    if (!writeText) {
      setTransientCopyStatus("error");
      return;
    }
    writeText.call(navigator.clipboard, redactSensitive(`${header}\n${text}`)).then(
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
      previous_crash: crashReport,
      recent_log: entries.slice(-50).map((e) => ({
        t: new Date(e.timestamp).toISOString(),
        level: e.level,
        message: redactSensitive(e.message),
      })),
    };
    writeText.call(navigator.clipboard, serializeRedactedDiagnostics(bundle)).then(
      () => setTransientCopyStatus("copied"),
      () => setTransientCopyStatus("error"),
    );
  }, [crashReport, entries, setTransientCopyStatus]);

  const clearLog = useCallback(() => {
    clearDiagnosticsLog();
  }, []);

  const clearCrashReport = useCallback(() => {
    clearPersistedCrashReport();
    setCrashReport(null);
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
        aria-label={t("log.aria")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2 className="modal__title">{t("log.title")}</h2>
          <button className="modal__close" onClick={onClose} aria-label={t("log.close")} type="button">
            <UiIcon name="close" size={16} />
          </button>
        </div>
        <p className="log-viewer__intro">
          {t("log.intro")}
        </p>
        <div className="log-viewer__summary" aria-label={t("log.severity")}>
          <span data-level="error">{t("log.errors", { count: formatNumber(counts.error) })}</span>
          <span data-level="warn">{t("log.warnings", { count: formatNumber(counts.warn) })}</span>
          <span data-level="info">{t("log.info", { count: formatNumber(counts.info) })}</span>
        </div>
        {crashReport && (
          <section className="log-viewer__crash" aria-label={t("log.previousCrash")}>
            <div>
              <span>{t("log.previousCrash")}</span>
              <strong>{crashReport.name}: {crashReport.message}</strong>
              <small>
                {new Date(crashReport.at).toLocaleString(languageTag)} · {t(CRASH_SOURCE_KEYS[crashReport.source])}
              </small>
            </div>
            <details>
              <summary>{t("log.inspectEvidence")}</summary>
              <pre>{serializeRedactedDiagnostics(crashReport)}</pre>
            </details>
            <button className="log-viewer__btn" type="button" onClick={clearCrashReport}>
              {t("log.clearReport")}
            </button>
          </section>
        )}
        <div className="log-viewer__toolbar">
          <span className="log-viewer__count">{t(entries.length === 1 ? "log.entries.one" : "log.entries.many", { count: formatNumber(entries.length) })}</span>
          <button
            onClick={copyAll}
            className="log-viewer__btn"
            type="button"
            aria-describedby={copyStatus !== "idle" ? "log-copy-status" : undefined}
          >
            <UiIcon name="copy" size={14} />
            {t("log.copy")}
          </button>
          <button
            onClick={copyBundle}
            className="log-viewer__btn"
            type="button"
            title={t("log.copyDiagnosticsTitle")}
          >
            <UiIcon name="copy" size={14} />
            {t("log.copyDiagnostics")}
          </button>
          {copyStatus !== "idle" && (
            <span
              id="log-copy-status"
              className="log-viewer__copy-status"
              data-tone={copyStatus === "copied" ? "success" : "error"}
              role={copyStatus === "copied" ? "status" : "alert"}
            >
              {copyStatus === "copied" ? t("log.copied") : t("log.copyFailed")}
            </span>
          )}
          <button onClick={clearLog} className="log-viewer__btn" type="button">
            <UiIcon name="trash" size={14} />
            {t("log.clear")}
          </button>
        </div>
        <div
          className="log-viewer__list"
          ref={listRef}
          onScroll={(event) => {
            const list = event.currentTarget;
            followTailRef.current = list.scrollHeight - list.scrollTop - list.clientHeight <= 24;
          }}
        >
          {entries.length === 0 && (
            <div className="empty-state empty-state--compact log-viewer__empty">
              <span className="empty-state__icon" aria-hidden />
              <div>
                <strong>{t("log.empty")}</strong>
                <p>{t("log.emptyBody")}</p>
              </div>
            </div>
          )}
          {entries.map((e) => (
            <div key={e.id} className="log-viewer__entry" data-level={e.level}>
              <span className="log-viewer__time">
                {new Date(e.timestamp).toISOString().slice(11, 23)}
              </span>
              <span className="log-viewer__level">{t(LOG_LEVEL_KEYS[e.level])}</span>
              <span className="log-viewer__msg">{e.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
