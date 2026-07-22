import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useI18n } from "../lib/i18n";
import { downloadBlob, safeFilenamePart } from "../lib/export";
import {
  MAX_RUN_ARCHIVE_QUOTA_BYTES,
  MIN_RUN_ARCHIVE_QUOTA_BYTES,
  RUN_ARCHIVE_CHANGED_EVENT,
  RunArchiveQuotaError,
  exportRunArchiveRecord,
  runArchiveStore,
  type RunArchiveRecord,
  type RunArchiveSnapshot,
  type RunArchiveWritePreview,
} from "../lib/run-archive";
import { UiIcon } from "./UiIcon";

type Props = {
  pendingRecord: RunArchiveRecord | null;
  onPendingResolved: () => void;
  onClose: () => void;
  onOpen: (record: RunArchiveRecord) => void;
  onRerun: (record: RunArchiveRecord) => void;
};

type Filter = "all" | "pinned" | "warnings";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MiB`;
}

export function RunHistory({ pendingRecord, onPendingResolved, onClose, onOpen, onRerun }: Props) {
  const { t, languageTag, formatNumber } = useI18n();
  useEscapeKey(onClose);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);
  const [snapshot, setSnapshot] = useState<RunArchiveSnapshot | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pendingPreview, setPendingPreview] = useState<RunArchiveWritePreview | null>(null);
  const [quotaPreview, setQuotaPreview] = useState<RunArchiveWritePreview | null>(null);
  const [quotaMiB, setQuotaMiB] = useState(128);

  const refresh = useCallback(async () => {
    setStatus("loading");
    try {
      const next = await runArchiveStore.list();
      setSnapshot(next);
      setQuotaMiB(Math.round(next.quotaBytes / (1024 * 1024)));
      setSelectedIds((ids) => ids.filter((id) => next.records.some((record) => record.id === id)).slice(0, 2));
      setStatus("ready");
      setMessage(null);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const listener = () => void refresh();
    window.addEventListener(RUN_ARCHIVE_CHANGED_EVENT, listener);
    return () => window.removeEventListener(RUN_ARCHIVE_CHANGED_EVENT, listener);
  }, [refresh]);

  useEffect(() => {
    if (!pendingRecord) {
      setPendingPreview(null);
      return;
    }
    runArchiveStore.preview(pendingRecord)
      .then(setPendingPreview)
      .catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
  }, [pendingRecord]);

  const records = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(languageTag);
    return (snapshot?.records ?? []).filter((record) => {
      if (filter === "pinned" && !record.pinned) return false;
      if (filter === "warnings" && record.quality.status === "pass") return false;
      return !needle
        || record.label.toLocaleLowerCase(languageTag).includes(needle)
        || record.scenarioKind.toLocaleLowerCase(languageTag).includes(needle)
        || record.identity.scenarioSha256.includes(needle);
    });
  }, [filter, languageTag, query, snapshot?.records]);

  const comparison = selectedIds.length === 2
    ? selectedIds.map((id) => snapshot?.records.find((record) => record.id === id)).filter((record): record is RunArchiveRecord => Boolean(record))
    : [];

  async function operation(action: () => Promise<void>, success?: string) {
    try {
      await action();
      if (success) setMessage(success);
      await refresh();
    } catch (error) {
      if (error instanceof RunArchiveQuotaError) {
        setQuotaPreview(error.preview);
      } else {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    }
  }

  async function confirmPending() {
    if (!pendingRecord || !pendingPreview?.fits) return;
    await operation(async () => {
      await runArchiveStore.add(pendingRecord, pendingPreview.evictionIds);
      onPendingResolved();
      setPendingPreview(null);
    }, t("history.saved"));
  }

  function exportRecord(record: RunArchiveRecord) {
    const result = downloadBlob(
      new Blob([exportRunArchiveRecord(record)], { type: "application/json;charset=utf-8" }),
      `cataclysm-run-${safeFilenamePart(record.label)}.json`,
    );
    if (!result.ok) setMessage(result.message);
  }

  async function applyQuota(evictionIds: readonly string[] = []) {
    const bytes = quotaMiB * 1024 * 1024;
    await operation(async () => {
      await runArchiveStore.setQuota(bytes, evictionIds);
      setQuotaPreview(null);
    });
  }

  const dateFormatter = new Intl.DateTimeFormat(languageTag, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal run-history"
        ref={dialogRef}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="run-history-title"
      >
        <div className="modal__header">
          <div>
            <span className="run-history__eyebrow">{t("history.eyebrow")}</span>
            <h2 id="run-history-title">{t("history.title")}</h2>
          </div>
          <button onClick={onClose} aria-label={t("history.close")} className="modal__close" type="button">
            <UiIcon name="close" size={16} />
          </button>
        </div>

        <div className="modal__body run-history__body">
          <p className="run-history__intro">{t("history.intro")}</p>

          {pendingRecord && pendingPreview && (
            <section className="run-history__pending" data-fits={pendingPreview.fits ? "true" : "false"} aria-labelledby="run-history-pending-title">
              <div>
                <UiIcon name={pendingPreview.fits ? "info" : "alert"} size={16} />
                <span>
                  <strong id="run-history-pending-title">{t("history.pendingTitle")}</strong>
                  <small>{pendingPreview.fits
                    ? t("history.pendingBody", { count: pendingPreview.evictionIds.length, bytes: formatBytes(pendingPreview.evictionBytes) })
                    : t("history.pendingBlocked")}</small>
                </span>
              </div>
              {pendingPreview.evictionIds.length > 0 && (
                <ul>
                  {pendingPreview.evictionIds.map((id) => {
                    const record = snapshot?.records.find((candidate) => candidate.id === id);
                    return <li key={id}>{record?.label ?? id} · {record ? formatBytes(record.sizeBytes) : ""}</li>;
                  })}
                </ul>
              )}
              <div className="run-history__pending-actions">
                <button type="button" onClick={() => { onPendingResolved(); setPendingPreview(null); }}>{t("history.cancelPending")}</button>
                <button type="button" disabled={!pendingPreview.fits} onClick={() => void confirmPending()}>{t("history.confirmEviction")}</button>
              </div>
            </section>
          )}

          <div className="run-history__summary">
            <span><strong>{snapshot?.records.length ?? 0}</strong> {t("history.localOnly")}</span>
            <span>{t("history.used", {
              used: formatBytes(snapshot?.usedBytes ?? 0),
              quota: formatBytes(snapshot?.quotaBytes ?? DEFAULT_QUOTA_BYTES),
            })}</span>
          </div>

          <div className="run-history__toolbar">
            <label>
              <span className="sr-only">{t("history.search")}</span>
              <UiIcon name="search" size={13} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder={t("history.searchPlaceholder")} aria-label={t("history.search")} />
            </label>
            <div role="group" aria-label={t("history.filter")}>{(["all", "pinned", "warnings"] as const).map((value) => (
              <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
                {t(value === "all" ? "history.filterAll" : value === "pinned" ? "history.filterPinned" : "history.filterWarnings")}
              </button>
            ))}</div>
          </div>

          {message && <div className="run-history__notice" role={status === "error" ? "alert" : "status"}>{status === "error" ? t("history.error", { error: message }) : message}</div>}
          {status === "loading" && <p className="run-history__empty" role="status">{t("history.loading")}</p>}
          {snapshot && snapshot.quarantine.length > 0 && <div className="run-history__quarantine" role="status">{t("history.quarantined", { count: snapshot.quarantine.length })}</div>}
          {status === "ready" && records.length === 0 && <p className="run-history__empty">{t("history.empty")}</p>}

          {records.length > 0 && <ul className="run-history__records" aria-label={t("history.title")}>
            {records.map((record) => (
              <li key={record.id} data-pinned={record.pinned ? "true" : "false"}>
                <div className="run-history__record-heading">
                  <label title={t("history.compareSelect")}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(record.id)}
                      aria-label={`${t("history.compareSelect")}: ${record.label}`}
                      onChange={() => setSelectedIds((current) => current.includes(record.id)
                        ? current.filter((id) => id !== record.id)
                        : [...current.slice(-1), record.id])}
                    />
                  </label>
                  <span><strong>{record.label}</strong><small>{dateFormatter.format(new Date(record.createdAt))} · {record.scenarioKind}</small></span>
                  <span className="run-history__quality" data-status={record.quality.status}>{record.quality.status}</span>
                </div>
                <dl>
                  <div><dt>{t("history.frames", { count: record.summary.frameCount })}</dt><dd>{record.summary.grid ? `${record.summary.grid.nx} × ${record.summary.grid.ny}` : "—"}</dd></div>
                  <div><dt>{t("history.peak", { value: formatNumber(record.summary.peakAbsMaxM, { maximumFractionDigits: 3 }) })}</dt><dd>{t("history.quality", { status: record.quality.status })}</dd></div>
                  <div><dt>SHA-256</dt><dd title={record.identity.scenarioSha256}>{record.identity.scenarioSha256.slice(0, 12)}…</dd></div>
                </dl>
                <div className="run-history__actions">
                  <button type="button" onClick={() => { void runArchiveStore.touch(record.id); onOpen(record); }}>{t("history.open")}</button>
                  <button type="button" onClick={() => onRerun(record)}>{t("history.rerun")}</button>
                  <button type="button" onClick={() => exportRecord(record)}>{t("history.export")}</button>
                  <button type="button" onClick={() => void operation(() => runArchiveStore.setPinned(record.id, !record.pinned))}>{t(record.pinned ? "history.unpin" : "history.pin")}</button>
                  <button type="button" onClick={() => void operation(() => runArchiveStore.remove(record.id), t("history.removed"))}>{t("history.delete")}</button>
                </div>
              </li>
            ))}
          </ul>}

          <section className="run-history__compare" aria-labelledby="run-history-compare-title">
            <h3 id="run-history-compare-title">{t("history.compare")}</h3>
            {comparison.length !== 2 ? <p>{t("history.comparePrompt")}</p> : (
              <div>
                <strong>{comparison[0].label} ↔ {comparison[1].label}</strong>
                <dl>
                  <div><dt>{t("history.comparePeak")}</dt><dd>{formatNumber(comparison[1].summary.peakAbsMaxM - comparison[0].summary.peakAbsMaxM, { signDisplay: "always", maximumFractionDigits: 3 })} m</dd></div>
                  <div><dt>{t("history.compareFrames")}</dt><dd>{formatNumber(comparison[1].summary.frameCount - comparison[0].summary.frameCount, { signDisplay: "always" })}</dd></div>
                  <div><dt>{t("history.compareQuality")}</dt><dd>{comparison[0].quality.status} ↔ {comparison[1].quality.status}</dd></div>
                </dl>
              </div>
            )}
          </section>

          <section className="run-history__management">
            <label>{t("history.quota")}<input type="number" min={MIN_RUN_ARCHIVE_QUOTA_BYTES / (1024 * 1024)} max={MAX_RUN_ARCHIVE_QUOTA_BYTES / (1024 * 1024)} step="16" value={quotaMiB} onChange={(event) => setQuotaMiB(Number(event.target.value))} /></label>
            <button type="button" onClick={() => void applyQuota()}>{t("history.applyQuota")}</button>
          </section>

          {quotaPreview && (
            <section className="run-history__pending" data-fits={quotaPreview.fits ? "true" : "false"}>
              <strong>{t("history.pendingTitle")}</strong>
              <p>{quotaPreview.fits ? t("history.pendingBody", { count: quotaPreview.evictionIds.length, bytes: formatBytes(quotaPreview.evictionBytes) }) : t("history.pendingBlocked")}</p>
              <div className="run-history__pending-actions">
                <button type="button" onClick={() => setQuotaPreview(null)}>{t("history.cancelPending")}</button>
                <button type="button" disabled={!quotaPreview.fits} onClick={() => void applyQuota(quotaPreview.evictionIds)}>{t("history.confirmEviction")}</button>
              </div>
            </section>
          )}

          {snapshot && snapshot.trash.length > 0 && <details className="run-history__trash">
            <summary>{t("history.trash", { count: snapshot.trash.length })}</summary>
            <ul>{snapshot.trash.map((record) => <li key={record.id}><span>{record.label}</span><button type="button" onClick={() => void operation(() => runArchiveStore.restore(record.id), t("history.restored"))}>{t("history.restore")}</button></li>)}</ul>
          </details>}
        </div>
      </div>
    </div>
  );
}

const DEFAULT_QUOTA_BYTES = 128 * 1024 * 1024;
