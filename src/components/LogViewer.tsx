import { useCallback, useEffect, useRef, useState } from "react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { UiIcon } from "./UiIcon";

type LogEntry = {
  level: "log" | "warn" | "error" | "info";
  timestamp: number;
  message: string;
};

const MAX_ENTRIES = 500;
const logBuffer: LogEntry[] = [];
let listeners: (() => void)[] = [];

function notify() {
  for (const fn of listeners) fn();
}

function installIntercepts() {
  if ((console as unknown as Record<string, unknown>).__tsunamisim_patched) return;
  const orig = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
  };
  function push(level: LogEntry["level"], args: unknown[]) {
    const message = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    logBuffer.push({ level, timestamp: Date.now(), message });
    if (logBuffer.length > MAX_ENTRIES) logBuffer.shift();
    notify();
  }
  console.log = (...args: unknown[]) => { orig.log(...args); push("log", args); };
  console.warn = (...args: unknown[]) => { orig.warn(...args); push("warn", args); };
  console.error = (...args: unknown[]) => { orig.error(...args); push("error", args); };
  console.info = (...args: unknown[]) => { orig.info(...args); push("info", args); };
  (console as unknown as Record<string, unknown>).__tsunamisim_patched = true;
}

installIntercepts();

type Props = {
  open: boolean;
  onClose: () => void;
};

export function LogViewer({ open, onClose }: Props) {
  const [entries, setEntries] = useState<LogEntry[]>([...logBuffer]);
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEscapeKey(onClose, open);
  useFocusTrap(dialogRef, open);

  useEffect(() => {
    const update = () => setEntries([...logBuffer]);
    listeners.push(update);
    return () => {
      listeners = listeners.filter((fn) => fn !== update);
    };
  }, []);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [entries]);

  const copyAll = useCallback(() => {
    const text = entries
      .map((e) => {
        const t = new Date(e.timestamp).toISOString().slice(11, 23);
        return `[${t}] [${e.level.toUpperCase()}] ${e.message}`;
      })
      .join("\n");
    const header = [
      `TsunamiSimulator diagnostics`,
      `Captured: ${new Date().toISOString()}`,
      `User-Agent: ${navigator.userAgent}`,
      `Entries: ${entries.length}`,
      `---`,
    ].join("\n");
    navigator.clipboard.writeText(`${header}\n${text}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [entries]);

  const clearLog = useCallback(() => {
    logBuffer.length = 0;
    setEntries([]);
  }, []);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal log-viewer"
        ref={dialogRef}
        role="dialog"
        aria-label="Application log"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2 className="modal__title">Diagnostics log</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close log viewer" type="button">
            <UiIcon name="close" size={16} />
          </button>
        </div>
        <div className="log-viewer__toolbar">
          <span className="log-viewer__count">{entries.length} entries</span>
          <button onClick={copyAll} className="log-viewer__btn" type="button">
            {copied ? "Copied!" : "Copy to clipboard"}
          </button>
          <button onClick={clearLog} className="log-viewer__btn" type="button">
            Clear
          </button>
        </div>
        <div className="log-viewer__list" ref={listRef}>
          {entries.length === 0 && (
            <div className="log-viewer__empty">No log entries yet.</div>
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
