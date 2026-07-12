export type LogLevel = "log" | "warn" | "error" | "info";

export type LogEntry = {
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
  logBuffer.push({ level, timestamp: Date.now(), message });
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
const CRASH_LOG_TAIL = 40;

export type CrashReport = {
  at: number;
  name: string;
  message: string;
  componentStack: string | null;
  recentLogs: LogEntry[];
  seen: boolean;
};

/** Strip Cesium ion / JWT tokens, absolute paths, and long hex/base64 blobs. */
export function redactSensitive(text: string): string {
  return text
    .replace(/eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, "[redacted-token]")
    .replace(/[A-Za-z]:\\[^\s"')]+/g, "[redacted-path]")
    .replace(/\/(?:Users|home)\/[^\s"')/]+(?:\/[^\s"')]*)?/g, "[redacted-path]")
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, "[redacted-hex]");
}

export function persistCrashReport(input: {
  name: string;
  message: string;
  componentStack?: string | null;
}): void {
  if (typeof localStorage === "undefined") return;
  const report: CrashReport = {
    at: Date.now(),
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
  } catch {
    // Never let crash persistence throw on top of an existing crash.
  }
}

export function readPersistedCrashReport(): CrashReport | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(CRASH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CrashReport;
    if (typeof parsed?.message !== "string") return null;
    return parsed;
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
  } catch {
    // ignore
  }
}

export function clearPersistedCrashReport(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(CRASH_KEY);
  } catch {
    // ignore
  }
}
