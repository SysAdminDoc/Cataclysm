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
