import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const skipBuild = args.has("--skip-build");
const enforceHardware = args.has("--enforce-hardware");
const port = 4191;
const origin = `http://127.0.0.1:${port}`;
const output = path.join(root, "artifacts", "performance", "renderer-benchmark.json");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? "unknown"}`);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // Preview is starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${origin}.`);
}

function seedSettings(tier) {
  localStorage.setItem("tsunamisim._settings_schema_version", "2");
  localStorage.setItem("tsunamisim.disclaimer_acknowledged_at", JSON.stringify("2026-01-01T00:00:00.000Z"));
  localStorage.setItem("tsunamisim.tour_completed_at", JSON.stringify("2026-01-01T00:00:00.000Z"));
  localStorage.setItem("tsunamisim.token_banner_dismissed_at", JSON.stringify("2026-01-01T00:00:00.000Z"));
  localStorage.setItem("tsunamisim.globe_style", JSON.stringify("natural-earth-2"));
  localStorage.setItem("tsunamisim.renderer_quality", JSON.stringify(tier));
  // Certification measures the requested tier directly. Automatic downgrade
  // behavior is covered separately by deterministic controller tests.
  localStorage.setItem("tsunamisim.renderer_auto_quality", "false");
}

async function measure(browser, tier, width, height) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.addInitScript(seedSettings, tier);
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.locator('.preset-card:has-text("Tohoku")').first().click();
  await page.getByRole("button", { name: "Run simulation" }).click();
  await page.getByRole("button", { name: "Re-run simulation" }).waitFor({ timeout: 30_000 });
  await page.addStyleTag({ content: `
    .app__globe-mount {
      position: fixed !important;
      inset: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      z-index: 99999 !important;
    }
  ` });
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  // Recreate the runtime after the representative SWE field, wavefront,
  // runup, gauges, and analytical overlays are live so startup frames cannot
  // contaminate the measurement window.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("tsunamisim:settings-saved")));
  await page.waitForFunction(() => {
    const diagnostics = window.__CATACLYSM_RENDERER_DIAGNOSTICS__?.();
    return diagnostics && diagnostics.rollingSampleCount < 20;
  });
  await page.waitForFunction(() => {
    const diagnostics = window.__CATACLYSM_RENDERER_DIAGNOSTICS__?.();
    return diagnostics && diagnostics.rollingSampleCount >= 120;
  }, undefined, { timeout: 30_000 });
  const measured = await page.evaluate(() => {
    const canvas = document.querySelector(".cesium-widget canvas");
    return {
      diagnostics: window.__CATACLYSM_RENDERER_DIAGNOSTICS__?.(),
      canvas: canvas instanceof HTMLCanvasElement
        ? { width: canvas.width, height: canvas.height, clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight }
        : null,
    };
  });
  await context.close();
  if (!measured.diagnostics || !measured.canvas) throw new Error(`${tier}: renderer diagnostics unavailable.`);
  return measured;
}

if (!skipBuild) run(npmCommand, ["run", "build"]);
const preview = spawn(process.execPath, [path.join(root, "node_modules", "vite", "bin", "vite.js"), "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root,
  stdio: "ignore",
  windowsHide: true,
});

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: [
      "--enable-gpu",
      "--ignore-gpu-blocklist",
      "--use-angle=d3d11",
      "--disable-software-rasterizer",
      "--disable-gpu-vsync",
      "--disable-frame-rate-limit",
    ],
  });
  const cases = [
    { tier: "High", width: 2_560, height: 1_440, targetFps: 60, targetFrameTimeMs: 1_000 / 60 },
    { tier: "Cinematic", width: 3_840, height: 2_160, targetFps: 30, targetFrameTimeMs: 1_000 / 30 },
  ];
  const results = [];
  for (const item of cases) {
    const measured = await measure(browser, item.tier, item.width, item.height);
    const diagnostics = measured.diagnostics;
    const software = /swiftshader|software|llvmpipe/i.test(`${diagnostics.adapter.vendor} ${diagnostics.adapter.renderer}`);
    const referenceAdapter = /NVIDIA GeForce RTX 4070 SUPER/i.test(diagnostics.adapter.renderer);
    const meanFps = diagnostics.rollingMeanFrameTimeMs === null
      ? null
      : 1_000 / diagnostics.rollingMeanFrameTimeMs;
    const pass = diagnostics.activeTier === item.tier
      && diagnostics.rollingMeanFrameTimeMs !== null
      && diagnostics.rollingMeanFrameTimeMs <= item.targetFrameTimeMs * 1.02
      && diagnostics.rollingP95FrameTimeMs !== null
      && diagnostics.rollingP95FrameTimeMs <= item.targetFrameTimeMs * 1.15
      && measured.canvas.width === item.width
      && measured.canvas.height === item.height
      && (!enforceHardware || (!software && referenceAdapter));
    results.push({ ...item, softwareRenderer: software, referenceAdapter, meanFps, pass, canvas: measured.canvas, diagnostics });
  }
  const report = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    expectedReferenceSystem: {
      os: "Windows 11 24H2 (build 26100)",
      cpu: "Intel Core Ultra 9 285",
      gpu: "NVIDIA GeForce RTX 4070 SUPER",
      driver: "32.0.15.9579",
    },
    enforcement: enforceHardware ? "hardware-required" : "contract-only",
    results,
    passed: results.every((result) => result.pass),
  };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  for (const result of results) {
    console.log(`${result.tier} ${result.width}x${result.height}: mean=${result.meanFps?.toFixed(2)}fps p95=${result.diagnostics.rollingP95FrameTimeMs?.toFixed(2)}ms canvas=${result.canvas.width}x${result.canvas.height} adapter=${result.diagnostics.adapter.renderer} ${result.pass ? "PASS" : "FAIL"}`);
  }
  if (!report.passed) throw new Error(`Renderer benchmark failed; see ${output}`);
} finally {
  await browser?.close();
  preview.kill();
}
