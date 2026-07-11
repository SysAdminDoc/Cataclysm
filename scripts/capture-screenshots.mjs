import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const root = process.cwd();
const outputDir = path.join(root, "assets", "screenshots");
const port = 4188;
const origin = `http://127.0.0.1:${port}`;
const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");

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
  localStorage.setItem("tsunamisim._settings_schema_version", "1");
  localStorage.setItem("tsunamisim.disclaimer_acknowledged_at", now);
  localStorage.setItem("tsunamisim.tour_completed_at", now);
  localStorage.setItem("tsunamisim.token_banner_dismissed_at", now);
  localStorage.setItem("tsunamisim.theme", JSON.stringify(theme));
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
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    await context.addInitScript(seedPreview, theme);
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.locator('.preset-card:has-text("Tohoku")').click();
    await page.waitForTimeout(750);
    await capture(page, theme === "mocha" ? "simulator-workspace-dark.png" : "simulator-workspace-light.png");

    if (theme === "mocha") {
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("dialog").waitFor();
      await capture(page, "settings-dark.png");
    }
    await context.close();
  }
} finally {
  await browser?.close();
  server.kill();
}
