export type LogLevel = "log" | "warn" | "error" | "info";

export type LogEntry = {
  /** Monotonic id, stable across ring-buffer shifts so UI list keys don't
   *  reuse DOM nodes for logically different rows once the buffer is full. */
  id: number;
  level: LogLevel;
  timestamp: number;
  message: string;
};

export type SolverDiagnosticPayload = {
  level?: LogLevel;
  message?: string;
};

const MAX_ENTRIES = 500;
const logBuffer: LogEntry[] = [];
let entrySeq = 0;
let listeners: (() => void)[] = [];

function notify() {
  for (const fn of listeners) fn();
}

function formatLogArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  if (arg === null) return "null";
  if (typeof arg === "undefined") return "undefined";
  if (typeof arg === "number" || typeof arg === "boolean" || typeof arg === "bigint") {
    return String(arg);
  }

  const seen = new WeakSet<object>();
  try {
    const serialized = JSON.stringify(arg, (_key, value: unknown) => {
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) return "[Circular]";
        seen.add(value);
      }
      return value;
    });
    return serialized ?? String(arg);
  } catch {
    return Object.prototype.toString.call(arg);
  }
}

function pushLogEntry(level: LogLevel, message: string) {
  logBuffer.push({ id: entrySeq++, level, timestamp: Date.now(), message: redactSensitive(message) });
  if (logBuffer.length > MAX_ENTRIES) logBuffer.shift();
  notify();
}

function normalizeLevel(level: unknown): LogLevel {
  return level === "log" || level === "info" || level === "error" || level === "warn" ? level : "warn";
}

export function installConsoleLogInterception() {
  if ((console as unknown as Record<string, unknown>).__tsunamisim_patched) return;
  const orig = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
  };
  function push(level: LogLevel, args: unknown[]) {
    pushLogEntry(level, args.map(formatLogArg).join(" "));
  }
  function safePush(level: LogLevel, args: unknown[]) {
    try {
      push(level, args);
    } catch {
      // Logging should never become the reason the application fails.
    }
  }
  console.log = (...args: unknown[]) => {
    orig.log(...args);
    safePush("log", args);
  };
  console.warn = (...args: unknown[]) => {
    orig.warn(...args);
    safePush("warn", args);
  };
  console.error = (...args: unknown[]) => {
    orig.error(...args);
    safePush("error", args);
  };
  console.info = (...args: unknown[]) => {
    orig.info(...args);
    safePush("info", args);
  };
  (console as unknown as Record<string, unknown>).__tsunamisim_patched = true;
}

export function pushExternalDiagnostic(payload: unknown) {
  const diagnostic = payload as SolverDiagnosticPayload;
  const message = typeof diagnostic.message === "string" ? diagnostic.message : formatLogArg(payload);
  pushLogEntry(normalizeLevel(diagnostic.level), message);
}

export function subscribeDiagnostics(listener: () => void) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((fn) => fn !== listener);
  };
}

export function readDiagnosticsLog() {
  return [...logBuffer];
}

export function clearDiagnosticsLog() {
  logBuffer.length = 0;
  notify();
}

// --- Persistent, redacted crash evidence ---------------------------------
// A crash report must survive a reload (so the failure can still be reviewed)
// but must never persist secrets, absolute file paths, or private scenario
// content. Everything written here is passed through `redactSensitive`.

const CRASH_KEY = "tsunamisim.last_crash";
export const CRASH_REPORT_CHANGED_EVENT = "tsunamisim:crash-report-changed";
const CRASH_LOG_TAIL = 40;

export type CrashSource = "react-boundary" | "window-error" | "unhandled-rejection";

export type CrashReport = {
  at: number;
  source: CrashSource;
  name: string;
  message: string;
  componentStack: string | null;
  recentLogs: LogEntry[];
  seen: boolean;
};

/** Strip credentials and local filesystem locations before diagnostics cross a
 * persistence, clipboard, or download boundary. */
export function redactSensitive(text: string): string {
  return text
    .replace(/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g, "[redacted-token]")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]{8,}={0,2}/gi, "$1[redacted-token]")
    .replace(/([?&](?:access[_-]?token|token|api[_-]?key|apikey|client[_-]?secret|secret|password)=)[^&#\s]+/gi, "$1[redacted]")
    .replace(/\b((?:access[_-]?token|api[_-]?key|apikey|client[_-]?secret|password)\s*[:=]\s*)[^\s,;&#]+/gi, "$1[redacted]")
    .replace(/\b[A-Za-z]:[\\/](?:[^\\/\r\n]+[\\/])*[^\\/\r\n\s,;:]+/g, "[redacted-path]")
    .replace(/\\\\[^\\\s]+\\[^\\\s]+(?:\\[^\\\r\n\s"'<>|]+)*/g, "[redacted-path]")
    .replace(/(?<![:/\w])\/(?:[^/\s"'()<>{}[\]]+\/)*[^/\s"'()<>{}[\]]+/g, "[redacted-path]")
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, "[redacted-long-value]")
    .replace(/\b(?=[A-Za-z0-9+/_=-]{32,}\b)(?=[A-Za-z0-9+/_=-]*[A-Za-z])(?=[A-Za-z0-9+/_=-]*\d)[A-Za-z0-9+/_=-]+\b/g, "[redacted-long-value]");
}

/** JSON serialization for clipboard/download boundaries. Strings are redacted
 * recursively and circular values cannot abort diagnostics export. */
export function serializeRedactedDiagnostics(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, current: unknown) => {
    if (typeof current === "string") return redactSensitive(current);
    if (typeof current === "object" && current !== null) {
      if (seen.has(current)) return "[Circular]";
      seen.add(current);
    }
    return current;
  }, 2);
}

function notifyCrashReportChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CRASH_REPORT_CHANGED_EVENT));
}

export function persistCrashReport(input: {
  source?: CrashSource;
  name: string;
  message: string;
  componentStack?: string | null;
}): void {
  if (typeof localStorage === "undefined") return;
  const report: CrashReport = {
    at: Date.now(),
    source: input.source ?? "react-boundary",
    name: redactSensitive(input.name),
    message: redactSensitive(input.message),
    componentStack: input.componentStack ? redactSensitive(input.componentStack) : null,
    recentLogs: logBuffer.slice(-CRASH_LOG_TAIL).map((e) => ({
      ...e,
      message: redactSensitive(e.message),
    })),
    seen: false,
  };
  try {
    localStorage.setItem(CRASH_KEY, JSON.stringify(report));
    notifyCrashReportChanged();
  } catch {
    // Never let crash persistence throw on top of an existing crash.
  }
}

export function readPersistedCrashReport(): CrashReport | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(CRASH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CrashReport>;
    if (typeof parsed?.message !== "string" || typeof parsed.name !== "string") return null;
    const source: CrashSource = parsed.source === "window-error" || parsed.source === "unhandled-rejection"
      ? parsed.source
      : "react-boundary";
    const recentLogs = Array.isArray(parsed.recentLogs)
      ? parsed.recentLogs.slice(-CRASH_LOG_TAIL).flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const candidate = entry as Partial<LogEntry>;
          if (typeof candidate.message !== "string") return [];
          return [{
            id: Number.isSafeInteger(candidate.id) ? candidate.id as number : 0,
            level: normalizeLevel(candidate.level),
            timestamp: typeof candidate.timestamp === "number" && Number.isFinite(candidate.timestamp)
              ? candidate.timestamp
              : 0,
            message: redactSensitive(candidate.message),
          }];
        })
      : [];
    return {
      at: typeof parsed.at === "number" && Number.isFinite(parsed.at) ? parsed.at : 0,
      source,
      name: redactSensitive(parsed.name),
      message: redactSensitive(parsed.message),
      componentStack: typeof parsed.componentStack === "string"
        ? redactSensitive(parsed.componentStack)
        : null,
      recentLogs,
      seen: parsed.seen === true,
    };
  } catch {
    return null;
  }
}

/** Mark the stored report reviewed without deleting it, so a successful restart
 * does not silently erase evidence of the prior crash. */
export function markCrashReportSeen(): void {
  const report = readPersistedCrashReport();
  if (!report || report.seen) return;
  try {
    localStorage.setItem(CRASH_KEY, JSON.stringify({ ...report, seen: true }));
    notifyCrashReportChanged();
  } catch {
    // ignore
  }
}

export function clearPersistedCrashReport(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(CRASH_KEY);
    notifyCrashReportChanged();
  } catch {
    // ignore
  }
}

export function persistUnhandledFailure(source: Exclude<CrashSource, "react-boundary">, value: unknown): void {
  const name = value instanceof Error ? value.name : source === "window-error" ? "WindowError" : "UnhandledRejection";
  const message = value instanceof Error ? value.message : formatLogArg(value);
  persistCrashReport({ source, name, message });
}

const installedGlobalHandlers = new WeakMap<Window, () => void>();

/** Capture global failures into the same redacted report used by the React
 * boundary. Returns a cleanup callback for tests/HMR. */
export function installGlobalCrashHandlers(target: Window = window): () => void {
  const existing = installedGlobalHandlers.get(target);
  if (existing) return existing;
  const onError = (event: ErrorEvent) => {
    const failure = event.error ?? event.message;
    console.error("[app] Unhandled window error", failure);
    persistUnhandledFailure("window-error", failure);
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    console.error("[app] Unhandled promise rejection", event.reason);
    persistUnhandledFailure("unhandled-rejection", event.reason);
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onUnhandledRejection);
  const cleanup = () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onUnhandledRejection);
    installedGlobalHandlers.delete(target);
  };
  installedGlobalHandlers.set(target, cleanup);
  return cleanup;
}
