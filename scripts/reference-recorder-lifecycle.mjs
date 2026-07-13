import { spawnSync } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export class RecorderDeadlineError extends Error {
  constructor(label, timeoutMs) {
    super(`${label} exceeded its ${timeoutMs} ms deadline`);
    this.name = "RecorderDeadlineError";
    this.label = label;
    this.timeoutMs = timeoutMs;
  }
}

export function deadlineFrom(args, flag, envName, fallbackMs) {
  const index = args.indexOf(flag);
  const raw = index >= 0 ? args[index + 1] : process.env[envName];
  if (raw === undefined) return fallbackMs;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${flag} / ${envName} must be a positive integer number of milliseconds.`);
  }
  return value;
}

export async function withDeadline(label, timeoutMs, operation) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new RecorderDeadlineError(label, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function isRunning(child) {
  return Boolean(child?.pid) && child.exitCode === null && child.signalCode === null;
}

function waitForExit(child, timeoutMs) {
  if (!isRunning(child)) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export async function terminateProcessTree(child, { graceMs = 1_500 } = {}) {
  if (!isRunning(child)) return;
  const pid = child.pid;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        child.kill("SIGTERM");
      } catch {
        return;
      }
    }
  }
  await waitForExit(child, graceMs);
  if (!isRunning(child)) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        // The process exited between the state check and the signal.
      }
    }
  }
  await waitForExit(child, graceMs);
}

export function createProgressTracker(filePath, {
  mode,
  totalTimeoutMs,
  startedAt = new Date(),
} = {}) {
  const startedMs = startedAt.getTime();
  let sequence = Promise.resolve();
  let state = {
    schemaVersion: 1,
    mode,
    status: "starting",
    sceneId: null,
    resolution: null,
    phase: "initializing",
    elapsedMs: 0,
    lastCompletedArtifact: null,
    totalTimeoutMs,
    updatedAt: startedAt.toISOString(),
  };

  return {
    get state() {
      return { ...state };
    },
    update(patch) {
      state = {
        ...state,
        ...patch,
        elapsedMs: Math.max(0, Date.now() - startedMs),
        updatedAt: new Date().toISOString(),
      };
      const snapshot = `${JSON.stringify(state, null, 2)}\n`;
      sequence = sequence.then(async () => {
        await mkdir(path.dirname(filePath), { recursive: true });
        const temporaryPath = `${filePath}.tmp`;
        await writeFile(temporaryPath, snapshot);
        await rename(temporaryPath, filePath);
      });
      return sequence;
    },
    flush() {
      return sequence;
    },
  };
}
