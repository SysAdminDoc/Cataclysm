import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  RecorderDeadlineError,
  createProgressTracker,
  deadlineFrom,
  dispatchLocalStateClick,
  operationTimeoutForDeadline,
  settleCommittedWebGlFrame,
  terminateProcessTree,
  withDeadline,
} from "./reference-recorder-lifecycle.mjs";

test("local state clicks bypass Playwright navigation waits", async () => {
  const events = [];
  const locator = {
    dispatchEvent: async (event) => events.push(event),
    click: async () => assert.fail("local state controls must not use Playwright click"),
  };
  await dispatchLocalStateClick(locator);
  assert.deepEqual(events, ["click"]);
});

test("reference workflows never attach navigation waits to local state controls", async () => {
  const source = await readFile(new URL("./capture-reference-scenes.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\.click\s*\(/);
  assert.match(source, /dispatchLocalStateClick/);
});

test("deadline rejects a hanging phase within its budget", async () => {
  const started = Date.now();
  await assert.rejects(
    withDeadline("fixture scene:render", 50, () => new Promise(() => {})),
    (error) => error instanceof RecorderDeadlineError
      && error.label === "fixture scene:render"
      && error.timeoutMs === 50,
  );
  assert.ok(Date.now() - started < 1_000);
});

test("deadline arguments reject invalid values", () => {
  assert.equal(deadlineFrom([], "--phase-timeout-ms", "UNSET_TEST_TIMEOUT", 123), 123);
  assert.throws(
    () => deadlineFrom(["--phase-timeout-ms", "0"], "--phase-timeout-ms", "UNSET_TEST_TIMEOUT", 123),
    /positive integer/,
  );
});

test("Playwright operations consume the phase budget without racing its deadline", () => {
  assert.equal(operationTimeoutForDeadline(180_000), 175_000);
  assert.equal(operationTimeoutForDeadline(1_000), 900);
  assert.equal(operationTimeoutForDeadline(1), 1);
  assert.throws(() => operationTimeoutForDeadline(0), /positive integer/);
});

test("committed WebGL frames finish before and across compositor frames", async () => {
  const operations = [];
  const previousDocument = globalThis.document;
  const previousCanvas = globalThis.HTMLCanvasElement;
  const previousAnimationFrame = globalThis.requestAnimationFrame;
  class FakeCanvas {
    getContext(kind) {
      operations.push(`context:${kind}`);
      return kind === "webgl2" ? { finish: () => operations.push("finish") } : null;
    }
  }
  globalThis.HTMLCanvasElement = FakeCanvas;
  globalThis.document = { querySelector: () => new FakeCanvas() };
  globalThis.requestAnimationFrame = (callback) => {
    operations.push("animation-frame");
    queueMicrotask(() => callback(0));
  };
  try {
    await settleCommittedWebGlFrame({ evaluate: (callback) => callback() });
    assert.deepEqual(operations, [
      "context:webgl2",
      "finish",
      "animation-frame",
      "finish",
      "animation-frame",
      "finish",
    ]);
  } finally {
    globalThis.document = previousDocument;
    globalThis.HTMLCanvasElement = previousCanvas;
    globalThis.requestAnimationFrame = previousAnimationFrame;
  }
});

test("progress tracker atomically records the active phase and last artifact", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cataclysm-recorder-"));
  const filePath = path.join(directory, "progress.json");
  try {
    const tracker = createProgressTracker(filePath, {
      mode: "verify",
      totalTimeoutMs: 5_000,
      startedAt: new Date("2026-07-12T00:00:00.000Z"),
    });
    await tracker.update({
      status: "running",
      sceneId: "tohoku",
      resolution: "1440p",
      phase: "analyze",
      lastCompletedArtifact: "tohoku@1440p.png",
    });
    const persisted = JSON.parse(await readFile(filePath, "utf8"));
    assert.equal(persisted.sceneId, "tohoku");
    assert.equal(persisted.resolution, "1440p");
    assert.equal(persisted.phase, "analyze");
    assert.equal(persisted.lastCompletedArtifact, "tohoku@1440p.png");
    assert.equal(persisted.totalTimeoutMs, 5_000);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("owned preview process is terminated after a hanging phase", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: process.platform !== "win32",
    stdio: "ignore",
    windowsHide: true,
  });
  try {
    await assert.rejects(
      withDeadline("fixture preview", 50, () => new Promise(() => {})),
      RecorderDeadlineError,
    );
  } finally {
    await terminateProcessTree(child);
  }
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});
