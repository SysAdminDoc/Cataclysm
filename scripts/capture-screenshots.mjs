import { spawn, spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const root = process.cwd();
const outputDir = path.join(root, "assets", "screenshots");
const port = 4188;
const origin = `http://127.0.0.1:${port}`;
const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");

function buildProductionPreview() {
  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/c", "npm", "run", "build"]
    : ["run", "build"];
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  });

  if (result.error) {
    throw new Error(`Production build failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Production build failed with exit code ${result.status ?? "unknown"}.`);
  }
}

buildProductionPreview();
await mkdir(outputDir, { recursive: true });

const server = spawn(process.execPath, [viteBin, "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root,
  stdio: "ignore",
  windowsHide: true,
});

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // Preview server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${origin}`);
}

function seedPreview(theme = "mocha") {
  const now = JSON.stringify(new Date().toISOString());
  localStorage.setItem("tsunamisim._settings_schema_version", "3");
  localStorage.setItem("tsunamisim.launch_experience_seen_at", now);
  localStorage.setItem("tsunamisim.disclaimer_acknowledged_at", now);
  localStorage.setItem("tsunamisim.tour_completed_at", now);
  localStorage.setItem("tsunamisim.token_banner_dismissed_at", now);
  localStorage.setItem("tsunamisim.theme", JSON.stringify(theme));
  // README captures intentionally use the best no-token online imagery. Strict
  // visual-regression fixtures continue to use a masked/deterministic globe.
  localStorage.setItem("tsunamisim.globe_style", JSON.stringify("esri-world-imagery"));
}

async function waitForStableWorkspace(page) {
  await page.getByRole("button", { name: "Run simulation" }).waitFor({ state: "visible" });
  await page.locator('.app__globe-status[data-status="loading"]').waitFor({ state: "detached" });

  const canvas = page.locator(".cesium-widget canvas");
  await canvas.waitFor({ state: "visible" });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  let previous;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const current = await canvas.screenshot({ animations: "disabled", scale: "css" });
    if (previous?.equals(current)) return;
    previous = current;
    await page.waitForTimeout(100);
  }
  throw new Error("Cesium globe did not settle before screenshot capture.");
}

async function capture(page, fileName) {
  await page.screenshot({
    path: path.join(outputDir, fileName),
    fullPage: true,
    animations: "disabled",
  });
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });

  for (const theme of ["mocha", "latte"]) {
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 1,
      locale: "en-US",
      timezoneId: "UTC",
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    await context.addInitScript(seedPreview, theme);
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.locator('.preset-card:has-text("Tohoku")').click();
    await waitForStableWorkspace(page);
    await capture(page, theme === "mocha" ? "simulator-workspace-dark.png" : "simulator-workspace-light.png");

    if (theme === "mocha") {
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("dialog").waitFor();
      await page.getByRole("button", { name: "Simulation performance", exact: true }).click();
      await capture(page, "settings-dark.png");
    }
    await context.close();
  }
} finally {
  await browser?.close();
  server.kill();
}
